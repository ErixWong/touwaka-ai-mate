/**
 * Token Cleanup Job - Token 清理任务
 * 
 * 定期清理过期的预览 Token 和旧的访问日志
 * Issue #140: 将文件预览窗口嵌入任务面板
 */

import logger from '../../lib/logger.js';

// 清理间隔（毫秒）
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1小时

// 日志保留天数
const LOG_RETENTION_DAYS = 30;

class TokenCleanupJob {
  constructor(db) {
    this.db = db;
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * 启动清理任务
   */
  start() {
    if (this.intervalId) {
      logger.warn('[TokenCleanup] Job already running');
      return;
    }

    // 立即执行一次
    this.runCleanup();

    // 定时执行
    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, CLEANUP_INTERVAL);

    logger.info('[TokenCleanup] Job started, interval: 1 hour');
  }

  /**
   * 停止清理任务
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[TokenCleanup] Job stopped');
    }
  }

  /**
   * 执行清理
   */
  async runCleanup() {
    if (this.isRunning) {
      logger.warn('[TokenCleanup] Previous cleanup still running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // 1. 清理过期 Token
      const tokensDeleted = await this.cleanupExpiredTokens();

      // 2. 清理旧访问日志
      const logsDeleted = await this.cleanupOldLogs();

      const duration = Date.now() - startTime;
      logger.info(`[TokenCleanup] Completed in ${duration}ms: ${tokensDeleted} tokens, ${logsDeleted} logs deleted`);
    } catch (error) {
      logger.error('[TokenCleanup] Error:', error.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 清理过期 Token
   */
  async cleanupExpiredTokens() {
    try {
      const [result] = await this.db.query(
        `DELETE FROM task_token WHERE expires_at < NOW()`
      );
      return result.affectedRows || 0;
    } catch (error) {
      logger.error('[TokenCleanup] Failed to cleanup expired tokens:', error.message);
      return 0;
    }
  }

  /**
   * 清理旧访问日志
   */
  async cleanupOldLogs() {
    try {
      const cutoffDate = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const [result] = await this.db.query(
        `DELETE FROM task_token_access_log WHERE accessed_at < ?`,
        [cutoffDate]
      );
      return result.affectedRows || 0;
    } catch (error) {
      logger.error('[TokenCleanup] Failed to cleanup old logs:', error.message);
      return 0;
    }
  }
}

export default TokenCleanupJob;