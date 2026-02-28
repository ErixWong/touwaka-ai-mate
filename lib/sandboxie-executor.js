/**
 * SandboxieExecutor - Windows Sandboxie Plus 沙箱执行器
 * 
 * 使用 Sandboxie Plus 实现用户隔离
 * 需要 Sandboxie Plus 已安装
 */

import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import logger from './logger.js';

// 项目根目录
const PROJECT_ROOT = path.resolve(process.cwd());
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config', 'sandboxie');

class SandboxieExecutor {
  constructor() {
    // Sandboxie Plus 安装路径（默认）
    this.startExe = process.env.SANDBOXIE_PATH || 'C:\\Program Files\\Sandboxie-Plus\\Start.exe';
    this.sbieCtrl = process.env.SANDBOXIE_CTRL || 'C:\\Program Files\\Sandboxie-Plus\\SbieCtrl.exe';
    this.configDir = CONFIG_DIR;
    
    // 角色到配置模板的映射
    this.roleTemplates = {
      'admin': 'admin',
      'power_user': 'power-user',
      'user': 'user',
    };
  }

  /**
   * 检查 Sandboxie 是否可用
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return new Promise((resolve) => {
      exec(`"${this.startExe}" /?`, (error) => {
        if (error) {
          logger.warn('[SandboxieExecutor] Sandboxie not found or not accessible');
          resolve(false);
        } else {
          logger.info('[SandboxieExecutor] Sandboxie is available');
          resolve(true);
        }
      });
    });
  }

  /**
   * 获取角色对应的配置模板名称
   * @param {string} role - 用户角色
   * @returns {string} 模板名称
   */
  getTemplateName(role) {
    return this.roleTemplates[role] || 'user';
  }

  /**
   * 在沙箱中执行命令
   * 
   * 注意：Sandboxie 需要预先配置沙箱模板
   * 请在 Sandboxie.ini 中添加以下配置：
   * 
   * [user_{userId}]
   * Template=UserRuntime
   * Enabled=y
   * 
   * 或者使用 generateSandboxConfig() 方法生成配置
   * 
   * @param {string} userId - 用户ID
   * @param {string} role - 用户角色
   * @param {string} command - 要执行的命令
   * @param {object} options - 执行选项
   */
  async execute(userId, role, command, options = {}) {
    const sandboxName = `user_${userId}`;
    const timeout = options.timeout || 30000;
    
    // 工作目录
    const workDir = options.cwd 
      ? this.resolveWorkPath(options.cwd, userId)
      : this.getUserWorkDir(userId);

    // 检查沙箱是否已配置
    const isConfigured = await this.checkSandboxConfig(sandboxName);
    if (!isConfigured) {
      logger.warn(`[SandboxieExecutor] Sandbox "${sandboxName}" not configured.`);
      logger.warn(`[SandboxieExecutor] Please add the following to Sandboxie.ini:`);
      logger.warn(this.generateSandboxConfig(sandboxName, role));
      
      // 返回错误提示用户需要配置
      return {
        success: false,
        code: -1,
        stdout: '',
        stderr: `Sandbox "${sandboxName}" not configured. Please add configuration to Sandboxie.ini. See logs for details.`,
        configRequired: true,
        sandboxName,
      };
    }

    // 构建 Sandboxie 命令
    const args = [
      `/box:${sandboxName}`,
      `/nosbiectrl`,
      `cmd.exe`, '/c', command
    ];

    logger.debug(`[SandboxieExecutor] Executing in sandbox: ${sandboxName}`);
    logger.debug(`[SandboxieExecutor] Role: ${role}, WorkDir: ${workDir}`);

    return new Promise((resolve, reject) => {
      const child = spawn(this.startExe, args, {
        cwd: workDir,
        env: {
          ...process.env,
          USER_ID: userId,
          WORK_DIR: workDir,
          ROLE: role,
        },
        timeout,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          code,
          stdout: stdout.slice(0, 50000),  // 限制输出大小
          stderr: stderr.slice(0, 10000),
          timedOut,
        });
      });

      child.on('error', (error) => {
        logger.error(`[SandboxieExecutor] Process error: ${error.message}`);
        reject(new Error(`Sandboxie execution failed: ${error.message}`));
      });

      // 超时处理
      setTimeout(() => {
        timedOut = true;
        child.kill();
        resolve({
          success: false,
          code: -1,
          stdout,
          stderr: stderr + '\n[Timeout] Command execution timed out',
          timedOut: true,
        });
      }, timeout);
    });
  }

  /**
   * 创建用户沙箱配置
   * 注意：此方法只生成配置内容，需要手动添加到 Sandboxie.ini
   * 
   * @param {string} userId - 用户ID
   * @param {string} role - 用户角色
   * @returns {object} 配置信息
   */
  async createSandbox(userId, role) {
    const sandboxName = `user_${userId}`;
    
    logger.info(`[SandboxieExecutor] Generating sandbox config: ${sandboxName}`);
    
    // 生成配置内容
    const configContent = this.generateSandboxConfig(sandboxName, role);
    
    return {
      sandboxName,
      role,
      created: true,
      configRequired: true,
      configContent,
      message: 'Please add the following to Sandboxie.ini (usually at C:\\Users\\<username>\\AppData\\Local\\Sandboxie\\Sandboxie.ini)',
    };
  }

  /**
   * 检查沙箱是否已配置
   * 通过尝试执行一个简单命令来验证
   * 
   * @param {string} sandboxName - 沙箱名称
   * @returns {Promise<boolean>} 是否已配置
   */
  async checkSandboxConfig(sandboxName) {
    return new Promise((resolve) => {
      exec(`"${this.startExe}" /box:${sandboxName} echo test`, (error, stdout) => {
        // 如果能成功执行，说明沙箱已配置
        resolve(!error && stdout.includes('test'));
      });
    });
  }

  /**
   * 生成沙箱配置内容
   * 
   * @param {string} sandboxName - 沙箱名称
   * @param {string} role - 用户角色
   * @returns {string} 配置内容
   */
  generateSandboxConfig(sandboxName, role) {
    const projectRoot = PROJECT_ROOT.replace(/\\/g, '\\\\');
    
    if (role === 'admin') {
      return `
[${sandboxName}]
# 管理员沙箱配置
# 完整访问项目目录
OpenFilePath=${projectRoot}\\
AllowNetworkAccess=y
Enabled=y
`;
    } else if (role === 'power_user') {
      return `
[${sandboxName}]
# Power User 沙箱配置
# 技能目录读写
OpenFilePath=${projectRoot}\\skills\\
# 用户工作目录读写
OpenFilePath=${projectRoot}\\data\\work\\*\\
# 禁止访问敏感文件
ClosedFilePath=${projectRoot}\\.env
ClosedFilePath=*.key
ClosedFilePath=*.pem
AllowNetworkAccess=y
Enabled=y
`;
    } else {
      return `
[${sandboxName}]
# 普通用户沙箱配置
# 用户工作目录读写
OpenFilePath=${projectRoot}\\data\\work\\*\\
# 技能目录只读
ReadFilePath=${projectRoot}\\skills\\
# 禁止访问敏感文件和其他用户目录
ClosedFilePath=${projectRoot}\\.env
ClosedFilePath=${projectRoot}\\data\\work\\*
ClosedFilePath=*.key
ClosedFilePath=*.pem
AllowNetworkAccess=y
Enabled=y
`;
    }
  }

  /**
   * 删除用户沙箱
   * @param {string} userId - 用户ID
   */
  async deleteSandbox(userId) {
    const sandboxName = `user_${userId}`;
    
    return new Promise((resolve, reject) => {
      exec(`"${this.sbieCtrl}" /terminate:${sandboxName}`, (error, stdout, stderr) => {
        if (error) {
          logger.warn(`[SandboxieExecutor] Failed to terminate sandbox: ${error.message}`);
        }
        
        exec(`"${this.sbieCtrl}" /delete_sandbox:${sandboxName}`, (error, stdout, stderr) => {
          if (error) {
            logger.error(`[SandboxieExecutor] Failed to delete sandbox: ${error.message}`);
            reject(new Error(`Failed to delete sandbox: ${error.message}`));
          } else {
            logger.info(`[SandboxieExecutor] Sandbox deleted: ${sandboxName}`);
            resolve({ sandboxName, deleted: true });
          }
        });
      });
    });
  }

  /**
   * 检查沙箱是否正在运行
   * @param {string} userId - 用户ID
   */
  async isSandboxRunning(userId) {
    const sandboxName = `user_${userId}`;
    
    return new Promise((resolve) => {
      exec(`"${this.startExe}" /box:${sandboxName} echo check`, (error, stdout) => {
        resolve(!error && stdout.includes('check'));
      });
    });
  }

  /**
   * 获取用户工作目录
   * @param {string} userId - 用户ID
   * @returns {string} 工作目录路径
   */
  getUserWorkDir(userId) {
    return path.join(PROJECT_ROOT, 'data', 'work', userId);
  }

  /**
   * 解析工作路径
   * @param {string} cwd - 相对或绝对路径
   * @param {string} userId - 用户ID
   * @returns {string} 解析后的路径
   */
  resolveWorkPath(cwd, userId) {
    if (path.isAbsolute(cwd)) {
      return cwd;
    }
    
    // 相对路径基于用户工作目录
    return path.join(this.getUserWorkDir(userId), cwd);
  }

  /**
   * 生成 Sandboxie 配置模板内容
   * 用于手动添加到 Sandboxie.ini
   */
  generateConfigTemplate(role) {
    const templates = {
      'user': `
[Template_UserRuntime]
# 普通用户沙箱配置
OpenFilePath=%PROJECT_ROOT%\\data\\work\\%USER_ID%\\
ReadFilePath=%PROJECT_ROOT%\\skills\\
ClosedFilePath=%PROJECT_ROOT%\\.env
ClosedFilePath=%PROJECT_ROOT%\\data\\work\\*
ClosedFilePath=*.key
ClosedFilePath=*.pem
AllowNetworkAccess=y
`,
      'power_user': `
[Template_PowerUserRuntime]
# Power User 沙箱配置
OpenFilePath=%PROJECT_ROOT%\\skills\\
OpenFilePath=%PROJECT_ROOT%\\data\\work\\%USER_ID%\\
ClosedFilePath=%PROJECT_ROOT%\\.env
ClosedFilePath=*.key
ClosedFilePath=*.pem
AllowNetworkAccess=y
`,
      'admin': `
[Template_AdminRuntime]
# 管理员沙箱配置
OpenFilePath=%PROJECT_ROOT%\\
AllowNetworkAccess=y
`,
    };

    return templates[role] || templates['user'];
  }
}

export default SandboxieExecutor;