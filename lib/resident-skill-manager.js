/**
 * ResidentSkillManager - 驻留式技能管理器
 * 
 * 管理驻留式技能工具的生命周期：
 * - 服务器启动时自动启动标记为 is_resident = 1 的工具
 * - 通过 stdio 与子进程通信
 * - 提供任务提交和结果获取接口
 * 
 * Issue: #80
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import Utils from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 驻留进程状态
 */
const ProcessState = {
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
};

/**
 * 驻留进程实例
 */
class ResidentProcess {
  constructor(tool, skill, db) {
    this.tool = tool;
    this.skill = skill;
    this.db = db;
    this.process = null;
    this.state = ProcessState.STOPPED;
    this.pendingTasks = new Map(); // taskId -> { resolve, reject, timeout }
    this.taskCounter = 0;
    this.buffer = '';
  }

  /**
   * 启动驻留进程
   */
  async start() {
    if (this.state !== ProcessState.STOPPED) {
      logger.warn(`ResidentProcess ${this.tool.name} already started or starting`);
      return;
    }

    this.state = ProcessState.STARTING;

    const skillPath = this.skill.source_path;
    const scriptPath = this.tool.script_path || 'index.js';
    const fullPath = path.join(process.cwd(), 'data', skillPath, scriptPath);

    logger.info(`Starting resident process: ${this.tool.name} from ${fullPath}`);

    try {
      // 获取白名单配置
      const whitelist = await this.getWhitelist();

      // 启动子进程
      this.process = spawn('node', [fullPath], {
        cwd: path.dirname(fullPath),
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV || 'development',
          ALLOWED_NODE_MODULES: JSON.stringify(whitelist.nodeModules),
          ALLOWED_PYTHON_PACKAGES: JSON.stringify(whitelist.pythonPackages),
          RESIDENT_MODE: 'true', // 标记为驻留模式
        },
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
      });

      // 设置状态为运行中
      this.state = ProcessState.RUNNING;

      // 监听 stdout（接收响应）
      this.process.stdout.on('data', (data) => {
        this.handleStdout(data);
      });

      // 监听 stderr（日志和错误）
      this.process.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          logger.info(`[${this.tool.name}] ${message}`);
        }
      });

      // 监听进程退出
      this.process.on('close', (code, signal) => {
        logger.info(`ResidentProcess ${this.tool.name} exited with code ${code}, signal ${signal}`);
        this.state = ProcessState.STOPPED;
        this.rejectAllPending(`Process exited with code ${code}`);
      });

      // 监听错误
      this.process.on('error', (err) => {
        logger.error(`ResidentProcess ${this.tool.name} error:`, err);
        this.state = ProcessState.ERROR;
        this.rejectAllPending(err.message);
      });

      logger.info(`ResidentProcess ${this.tool.name} started successfully`);

    } catch (error) {
      logger.error(`Failed to start ResidentProcess ${this.tool.name}:`, error);
      this.state = ProcessState.ERROR;
      throw error;
    }
  }

  /**
   * 停止驻留进程
   */
  async stop() {
    if (this.state !== ProcessState.RUNNING) {
      return;
    }

    this.state = ProcessState.STOPPING;

    // 发送退出命令
    this.sendCommand('exit', {});

    // 等待进程退出或强制终止
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGTERM');
        }
        resolve();
      }, 5000);

      this.process.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.state = ProcessState.STOPPED;
    logger.info(`ResidentProcess ${this.tool.name} stopped`);
  }

  /**
   * 提交任务
   * @param {Object} params - 任务参数
   * @param {number} timeout - 超时时间（毫秒）
   * @returns {Promise<Object>} 任务结果
   */
  async invoke(params, timeout = 60000) {
    if (this.state !== ProcessState.RUNNING) {
      throw new Error(`ResidentProcess ${this.tool.name} is not running`);
    }

    const taskId = `${Date.now()}-${++this.taskCounter}`;

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        reject(new Error(`Task ${taskId} timed out after ${timeout}ms`));
      }, timeout);

      // 存储待处理任务
      this.pendingTasks.set(taskId, { resolve, reject, timeoutId });

      // 发送任务
      this.sendCommand('invoke', { task_id: taskId, params });
    });
  }

  /**
   * 发送命令到子进程
   */
  sendCommand(command, data) {
    if (!this.process || !this.process.stdin.writable) {
      logger.error(`ResidentProcess ${this.tool.name} stdin not writable`);
      return false;
    }

    const message = JSON.stringify({ command, ...data }) + '\n';
    this.process.stdin.write(message);
    return true;
  }

  /**
   * 处理 stdout 数据
   */
  handleStdout(data) {
    this.buffer += data.toString();

    // 按行分割处理
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 保留不完整的行

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line);
        this.handleResponse(response);
      } catch (err) {
        logger.warn(`[${this.tool.name}] Invalid JSON response: ${line}`);
      }
    }
  }

  /**
   * 处理响应
   */
  handleResponse(response) {
    const { type, task_id, result, error, message } = response;

    // 状态消息
    if (type === 'log') {
      logger.info(`[${this.tool.name}] ${message}`);
      return;
    }

    // 任务响应
    if (task_id && this.pendingTasks.has(task_id)) {
      const task = this.pendingTasks.get(task_id);
      clearTimeout(task.timeoutId);
      this.pendingTasks.delete(task_id);

      if (error) {
        task.reject(new Error(error));
      } else {
        task.resolve(result);
      }
    }
  }

  /**
   * 拒绝所有待处理任务
   */
  rejectAllPending(reason) {
    for (const [taskId, task] of this.pendingTasks) {
      clearTimeout(task.timeoutId);
      task.reject(new Error(reason));
    }
    this.pendingTasks.clear();
  }

  /**
   * 获取白名单配置
   */
  async getWhitelist() {
    const SystemSetting = this.db.getModel('system_setting');
    
    let nodeModules = [];
    let pythonPackages = [];

    try {
      const [nodeSetting, pythonSetting] = await Promise.all([
        SystemSetting.findOne({ where: { key: 'allowed_node_modules' }, raw: true }),
        SystemSetting.findOne({ where: { key: 'allowed_python_packages' }, raw: true }),
      ]);

      if (nodeSetting?.value) {
        nodeModules = typeof nodeSetting.value === 'string' 
          ? JSON.parse(nodeSetting.value) 
          : nodeSetting.value;
      }

      if (pythonSetting?.value) {
        pythonPackages = typeof pythonSetting.value === 'string'
          ? JSON.parse(pythonSetting.value)
          : pythonSetting.value;
      }
    } catch (err) {
      logger.warn('Failed to load whitelist from database, using empty lists');
    }

    return { nodeModules, pythonPackages };
  }
}

/**
 * 驻留式技能管理器
 */
class ResidentSkillManager {
  constructor(db) {
    this.db = db;
    this.processes = new Map(); // toolId -> ResidentProcess
    this.Tool = db.getModel('skill_tool');
    this.Skill = db.getModel('skill');
  }

  /**
   * 初始化：启动所有驻留进程
   */
  async initialize() {
    logger.info('ResidentSkillManager initializing...');

    // 查询所有驻留工具
    const residentTools = await this.Tool.findAll({
      where: { is_resident: true },
      raw: true,
    });

    if (residentTools.length === 0) {
      logger.info('No resident tools found');
      return;
    }

    // 获取对应的技能信息
    const skillIds = [...new Set(residentTools.map(t => t.skill_id))];
    const skills = await this.Skill.findAll({
      where: { id: skillIds },
      raw: true,
    });

    const skillMap = new Map(skills.map(s => [s.id, s]));

    // 启动每个驻留进程
    for (const tool of residentTools) {
      const skill = skillMap.get(tool.skill_id);
      if (!skill) {
        logger.warn(`Skill not found for tool ${tool.name} (skill_id: ${tool.skill_id})`);
        continue;
      }

      try {
        const proc = new ResidentProcess(tool, skill, this.db);
        await proc.start();
        this.processes.set(tool.id, proc);
      } catch (err) {
        logger.error(`Failed to start resident tool ${tool.name}:`, err);
      }
    }

    logger.info(`ResidentSkillManager initialized with ${this.processes.size} processes`);
  }

  /**
   * 调用驻留工具
   * @param {string} toolId - 工具ID
   * @param {Object} params - 参数
   * @param {number} timeout - 超时时间
   */
  async invoke(toolId, params, timeout = 60000) {
    const proc = this.processes.get(toolId);
    if (!proc) {
      throw new Error(`Resident tool ${toolId} not found or not running`);
    }
    return proc.invoke(params, timeout);
  }

  /**
   * 通过工具名调用
   */
  async invokeByName(skillId, toolName, params, timeout = 60000) {
    // 查找工具ID
    const tool = await this.Tool.findOne({
      where: { skill_id: skillId, name: toolName },
      raw: true,
    });

    if (!tool) {
      throw new Error(`Tool ${toolName} not found in skill ${skillId}`);
    }

    return this.invoke(tool.id, params, timeout);
  }

  /**
   * 停止所有驻留进程
   */
  async shutdown() {
    logger.info('ResidentSkillManager shutting down...');

    const stopPromises = [];
    for (const [toolId, proc] of this.processes) {
      stopPromises.push(proc.stop());
    }

    await Promise.all(stopPromises);
    this.processes.clear();

    logger.info('ResidentSkillManager shutdown complete');
  }

  /**
   * 获取所有驻留进程状态
   */
  getStatus() {
    const status = [];
    for (const [toolId, proc] of this.processes) {
      status.push({
        tool_id: toolId,
        tool_name: proc.tool.name,
        skill_id: proc.skill.id,
        skill_name: proc.skill.name,
        state: proc.state,
        pending_tasks: proc.pendingTasks.size,
      });
    }
    return status;
  }
}

export { ResidentSkillManager, ResidentProcess, ProcessState };
export default ResidentSkillManager;