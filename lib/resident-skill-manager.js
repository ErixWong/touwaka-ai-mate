/**
 * ResidentSkillManager - 驻留式技能管理器
 * 
 * 管理驻留式技能工具的生命周期：
 * - 服务器启动时自动启动标记为 is_resident = 1 的工具
 * - 通过 stdio 与子进程通信
 * - 提供任务提交和结果获取接口
 * 
 * Issue: #80, #433
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import { getDataBasePath } from './paths.js';

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
 * 通讯记录最大数量
 */
const MAX_COMMUNICATIONS = 10;

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
    
    // Issue #433: 增强状态信息
    this.pid = null;
    this.startedAt = null;
    this.totalTasks = 0;
    this.successCount = 0;
    this.errorCount = 0;
    this.communications = []; // 最近通讯记录（最多10条）
  }

  /**
   * 添加通讯记录
   * @param {string} direction - 'out' 发送, 'in' 接收
   * @param {string} taskId - 任务ID
   * @param {string} type - 消息类型
   * @param {string} summary - 摘要（不含敏感信息）
   * @param {string} status - success/error/pending
   */
  addCommunication(direction, taskId, type, summary, status) {
    const record = {
      timestamp: new Date().toISOString(),
      direction,
      task_id: taskId,
      type,
      summary,
      status,
    };
    
    this.communications.push(record);
    
    // 保持最多 MAX_COMMUNICATIONS 条记录
    if (this.communications.length > MAX_COMMUNICATIONS) {
      this.communications.shift();
    }
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
    const dataBasePath = getDataBasePath();
    const fullPath = path.join(dataBasePath, skillPath, scriptPath);

    logger.info(`Starting resident process: ${this.tool.name} from ${fullPath}`);

    try {
      // 获取白名单配置
      const whitelist = await this.getWhitelist();

      // 启动子进程
      // cwd 设置为项目根目录，让 ES Module 能正确解析 node_modules
      this.process = spawn('node', [fullPath], {
        cwd: process.cwd(),
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
      
      // Issue #433: 记录 PID 和启动时间
      this.pid = this.process.pid;
      this.startedAt = new Date().toISOString();

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
    * @param {Object} userContext - 用户上下文 { userId, accessToken, expertId, isAdmin }
    * @param {number} timeout - 超时时间（毫秒）
    * @returns {Promise<Object>} 任务结果
    */
  async invoke(params, userContext = {}, timeout = 60000) {
    if (this.state !== ProcessState.RUNNING) {
      throw new Error(`ResidentProcess ${this.tool.name} is not running`);
    }

    const taskId = `${Date.now()}-${++this.taskCounter}`;
    
    // Issue #433: 统计任务数
    this.totalTasks++;

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        // Issue #433: 记录超时
        this.errorCount++;
        this.addCommunication('out', taskId, 'invoke', `任务超时 (${timeout}ms)`, 'error');
        reject(new Error(`Task ${taskId} timed out after ${timeout}ms`));
      }, timeout);

      // 存储待处理任务
      this.pendingTasks.set(taskId, { resolve, reject, timeoutId });

      // Issue #433: 生成摘要（不含敏感信息）
      const summary = this.generateInvokeSummary(params);
      this.addCommunication('out', taskId, 'invoke', summary, 'pending');

      // 发送任务（包含用户上下文）
      this.sendCommand('invoke', {
        task_id: taskId,
        params,
        user: {
          userId: userContext.userId || '',
          accessToken: userContext.accessToken || '',
          expertId: userContext.expertId || '',
          isAdmin: userContext.isAdmin || false,
        },
      });
    });
  }

  /**
   * 生成 invoke 摘要（不含敏感信息）
   * Issue #433
   */
  generateInvokeSummary(params) {
    const keys = Object.keys(params || {});
    if (keys.length === 0) return '调用（无参数）';
    
    // 只显示关键参数，不显示敏感信息
    const safeKeys = keys.filter(k => !['password', 'token', 'secret', 'apiKey', 'api_key'].includes(k.toLowerCase()));
    const preview = safeKeys.slice(0, 3).map(k => `${k}=${typeof params[k] === 'string' ? params[k].substring(0, 20) : JSON.stringify(params[k]).substring(0, 20)}`).join(', ');
    
    return `调用: ${preview}${keys.length > 3 ? '...' : ''}`;
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

      // Issue #433: 更新统计和通讯记录
      if (error) {
        this.errorCount++;
        this.addCommunication('in', task_id, 'response', `错误: ${error.substring(0, 50)}`, 'error');
        task.reject(new Error(error));
      } else {
        this.successCount++;
        const resultSummary = this.generateResultSummary(result);
        this.addCommunication('in', task_id, 'response', resultSummary, 'success');
        task.resolve(result);
      }
    }
  }

  /**
   * 生成结果摘要
   * Issue #433
   */
  generateResultSummary(result) {
    if (!result) return '返回: 空';
    if (typeof result === 'string') return `返回: ${result.substring(0, 50)}${result.length > 50 ? '...' : ''}`;
    if (typeof result === 'object') {
      const keys = Object.keys(result);
      if (keys.length === 0) return '返回: {}';
      return `返回: {${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
    }
    return '返回: 数据';
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
      // 检查是否已存在（防止重复启动）
      if (this.processes.has(tool.id)) {
        logger.warn(`ResidentProcess ${tool.name} already running, skipping`);
        continue;
      }

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
   * @param {Object} userContext - 用户上下文 { userId, accessToken, expertId, isAdmin }
   * @param {number} timeout - 超时时间
   */
  async invoke(toolId, params, userContext = {}, timeout = 60000) {
    const proc = this.processes.get(toolId);
    if (!proc) {
      throw new Error(`Resident tool ${toolId} not found or not running`);
    }
    return proc.invoke(params, userContext, timeout);
  }

  /**
   * 通过工具名调用
   * @param {string} skillId - 技能ID
   * @param {string} toolName - 工具名
   * @param {Object} params - 参数
   * @param {Object} userContext - 用户上下文 { userId, accessToken, expertId, isAdmin }
   * @param {number} timeout - 超时时间
   */
  async invokeByName(skillId, toolName, params, userContext = {}, timeout = 60000) {
    // 查找工具ID
    const tool = await this.Tool.findOne({
      where: { skill_id: skillId, name: toolName },
      raw: true,
    });

    if (!tool) {
      throw new Error(`Tool ${toolName} not found in skill ${skillId}`);
    }

    return this.invoke(tool.id, params, userContext, timeout);
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
    * Issue #433: 增强返回信息
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
        pid: proc.pid,
        started_at: proc.startedAt,
        pending_tasks: proc.pendingTasks.size,
        total_tasks: proc.totalTasks,
        success_count: proc.successCount,
        error_count: proc.errorCount,
        recent_communications: proc.communications.slice(-MAX_COMMUNICATIONS),
      });
    }
    return status;
  }

  /**
    * 重启驻留进程
    * Issue #433
    * @param {string} toolId - 工具ID
    * @returns {Promise<Object>} 新进程状态
    */
  async restart(toolId) {
    const proc = this.processes.get(toolId);
    if (!proc) {
      throw new Error(`Resident tool ${toolId} not found`);
    }

    const oldPid = proc.pid;
    logger.info(`Restarting resident process: ${proc.tool.name} (old PID: ${oldPid})`);

    // 停止进程
    await proc.stop();

    // 重置统计（保留通讯记录用于调试）
    proc.pid = null;
    proc.startedAt = null;
    // 不重置 totalTasks/successCount/errorCount，保留历史统计

    // 重新启动
    await proc.start();

    logger.info(`Resident process restarted: ${proc.tool.name} (new PID: ${proc.pid})`);

    return {
      tool_id: toolId,
      tool_name: proc.tool.name,
      old_pid: oldPid,
      new_pid: proc.pid,
      started_at: proc.startedAt,
      state: proc.state,
    };
  }
}

export { ResidentSkillManager, ResidentProcess, ProcessState };
export default ResidentSkillManager;