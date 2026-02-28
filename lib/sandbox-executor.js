/**
 * SandboxExecutor - 跨平台沙箱执行器
 * 
 * Windows: 使用 Sandboxie Plus
 * Linux: 使用 Firejail
 * 
 * 用户隔离架构核心组件
 */

import SandboxieExecutor from './sandboxie-executor.js';
import FirejailExecutor from './firejail-executor.js';
import logger from './logger.js';

class SandboxExecutor {
  constructor() {
    this.platform = process.platform;
    this.executor = null;
    
    if (this.platform === 'win32') {
      this.executor = new SandboxieExecutor();
    } else if (this.platform === 'linux') {
      this.executor = new FirejailExecutor();
    } else {
      throw new Error(`Unsupported platform: ${this.platform}. Only Windows and Linux are supported.`);
    }
    
    logger.info(`[SandboxExecutor] Initialized for platform: ${this.platform}`);
  }

  /**
   * 获取当前沙箱类型
   * @returns {string} 'sandboxie' | 'firejail'
   */
  getSandboxType() {
    return this.platform === 'win32' ? 'sandboxie' : 'firejail';
  }

  /**
   * 在沙箱中执行命令
   * @param {string} userId - 用户ID
   * @param {string} role - 用户角色 (admin/power_user/user)
   * @param {string} command - 要执行的命令
   * @param {object} options - 执行选项
   * @param {number} options.timeout - 超时时间（毫秒）
   * @param {string} options.cwd - 工作目录
   * @returns {Promise<{success: boolean, stdout: string, stderr: string, code: number}>}
   */
  async execute(userId, role, command, options = {}) {
    logger.info(`[SandboxExecutor] Executing command for user ${userId} (role: ${role})`);
    logger.debug(`[SandboxExecutor] Command: ${command}`);
    
    try {
      const result = await this.executor.execute(userId, role, command, options);
      
      if (result.code === 0) {
        logger.info(`[SandboxExecutor] Command executed successfully`);
      } else {
        logger.warn(`[SandboxExecutor] Command exited with code ${result.code}`);
      }
      
      return result;
    } catch (error) {
      logger.error(`[SandboxExecutor] Execution failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查沙箱是否可用
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    if (!this.executor) return false;
    if (this.executor.isAvailable) {
      return this.executor.isAvailable();
    }
    return true;
  }

  /**
   * 创建用户沙箱
   * @param {string} userId - 用户ID
   * @param {string} role - 用户角色
   * @returns {Promise<object>}
   */
  async createSandbox(userId, role) {
    if (this.executor.createSandbox) {
      return this.executor.createSandbox(userId, role);
    }
    return { sandboxName: `user_${userId}`, created: true };
  }

  /**
   * 删除用户沙箱
   * @param {string} userId - 用户ID
   * @returns {Promise<object>}
   */
  async deleteSandbox(userId) {
    if (this.executor.deleteSandbox) {
      return this.executor.deleteSandbox(userId);
    }
    return { sandboxName: `user_${userId}`, deleted: true };
  }
}

export default SandboxExecutor;