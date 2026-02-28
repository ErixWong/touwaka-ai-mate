/**
 * SandboxMonitor - 沙箱执行监控
 * 
 * 记录执行历史、统计和告警
 */

import fs from 'fs';
import path from 'path';
import logger from './logger.js';

// 监控数据存储路径
const MONITOR_DIR = process.env.SANDBOX_MONITOR_DIR || './logs/sandbox';
const HISTORY_FILE = path.join(MONITOR_DIR, 'execution-history.jsonl');
const STATS_FILE = path.join(MONITOR_DIR, 'stats.json');

class SandboxMonitor {
  constructor() {
    this.stats = this.loadStats();
    this.ensureLogDir();
  }

  /**
   * 确保日志目录存在
   */
  ensureLogDir() {
    if (!fs.existsSync(MONITOR_DIR)) {
      fs.mkdirSync(MONITOR_DIR, { recursive: true });
    }
  }

  /**
   * 加载统计数据
   */
  loadStats() {
    try {
      if (fs.existsSync(STATS_FILE)) {
        return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      }
    } catch (error) {
      logger.warn('[SandboxMonitor] Failed to load stats, using defaults');
    }
    
    return {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      permissionDeniedCount: 0,
      byRole: {
        user: { total: 0, success: 0, failure: 0 },
        power_user: { total: 0, success: 0, failure: 0 },
        admin: { total: 0, success: 0, failure: 0 },
      },
      byPlatform: {
        windows: { total: 0, success: 0, failure: 0 },
        linux: { total: 0, success: 0, failure: 0 },
      },
      lastUpdated: null,
    };
  }

  /**
   * 保存统计数据
   */
  saveStats() {
    this.stats.lastUpdated = new Date().toISOString();
    fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2), 'utf-8');
  }

  /**
   * 记录执行
   * @param {object} record - 执行记录
   */
  recordExecution(record) {
    const {
      userId,
      role,
      command,
      success,
      exitCode,
      duration,
      timedOut,
      permissionDenied,
      sandboxed,
      error,
    } = record;

    // 更新统计
    this.stats.totalExecutions++;
    
    if (permissionDenied) {
      this.stats.permissionDeniedCount++;
    } else if (timedOut) {
      this.stats.timeoutCount++;
    } else if (success) {
      this.stats.successCount++;
    } else {
      this.stats.failureCount++;
    }

    // 按角色统计
    if (!this.stats.byRole[role]) {
      this.stats.byRole[role] = { total: 0, success: 0, failure: 0 };
    }
    this.stats.byRole[role].total++;
    if (success) {
      this.stats.byRole[role].success++;
    } else {
      this.stats.byRole[role].failure++;
    }

    // 按平台统计
    const platform = process.platform === 'win32' ? 'windows' : 'linux';
    this.stats.byPlatform[platform].total++;
    if (success) {
      this.stats.byPlatform[platform].success++;
    } else {
      this.stats.byPlatform[platform].failure++;
    }

    // 写入历史记录
    const historyEntry = {
      timestamp: new Date().toISOString(),
      userId,
      role,
      command: command.slice(0, 200), // 限制长度
      success,
      exitCode,
      duration,
      timedOut: timedOut || false,
      permissionDenied: permissionDenied || false,
      sandboxed: sandboxed || false,
      error: error ? error.slice(0, 500) : null,
    };

    fs.appendFileSync(HISTORY_FILE, JSON.stringify(historyEntry) + '\n', 'utf-8');

    // 保存统计
    this.saveStats();

    // 告警检查
    this.checkAlerts(record);
  }

  /**
   * 检查告警条件
   */
  checkAlerts(record) {
    const { timedOut, permissionDenied, error } = record;

    // 超时告警
    if (timedOut) {
      logger.warn(`[SandboxMonitor] Command timeout alert: user=${record.userId}, command=${record.command?.slice(0, 50)}`);
    }

    // 权限拒绝告警（可能是攻击尝试）
    if (permissionDenied) {
      logger.warn(`[SandboxMonitor] Permission denied alert: user=${record.userId}, role=${record.role}`);
    }

    // 沙箱不可用告警
    if (error && error.includes('Sandbox not available')) {
      logger.error(`[SandboxMonitor] Sandbox unavailable alert: ${error}`);
    }
  }

  /**
   * 获取统计摘要
   */
  getStatsSummary() {
    const { totalExecutions, successCount, failureCount, timeoutCount, permissionDeniedCount } = this.stats;
    
    return {
      total: totalExecutions,
      success: successCount,
      failure: failureCount,
      timeout: timeoutCount,
      permissionDenied: permissionDeniedCount,
      successRate: totalExecutions > 0 ? (successCount / totalExecutions * 100).toFixed(2) + '%' : 'N/A',
      byRole: this.stats.byRole,
      byPlatform: this.stats.byPlatform,
    };
  }

  /**
   * 获取最近的执行记录
   * @param {number} limit - 返回条数
   */
  getRecentHistory(limit = 50) {
    try {
      if (!fs.existsSync(HISTORY_FILE)) {
        return [];
      }
      
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      return lines
        .slice(-limit)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      logger.error('[SandboxMonitor] Failed to read history:', error);
      return [];
    }
  }

  /**
   * 清理历史记录（保留最近N条）
   * @param {number} keepCount - 保留条数
   */
  cleanHistory(keepCount = 1000) {
    try {
      if (!fs.existsSync(HISTORY_FILE)) {
        return;
      }
      
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      if (lines.length > keepCount) {
        const kept = lines.slice(-keepCount);
        fs.writeFileSync(HISTORY_FILE, kept.join('\n') + '\n', 'utf-8');
        logger.info(`[SandboxMonitor] Cleaned history, kept ${keepCount} records`);
      }
    } catch (error) {
      logger.error('[SandboxMonitor] Failed to clean history:', error);
    }
  }

  /**
   * 重置统计数据
   */
  resetStats() {
    this.stats = {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      permissionDeniedCount: 0,
      byRole: {
        user: { total: 0, success: 0, failure: 0 },
        power_user: { total: 0, success: 0, failure: 0 },
        admin: { total: 0, success: 0, failure: 0 },
      },
      byPlatform: {
        windows: { total: 0, success: 0, failure: 0 },
        linux: { total: 0, success: 0, failure: 0 },
      },
      lastUpdated: null,
    };
    this.saveStats();
    logger.info('[SandboxMonitor] Stats reset');
  }
}

// 单例
let monitorInstance = null;

export function getSandboxMonitor() {
  if (!monitorInstance) {
    monitorInstance = new SandboxMonitor();
  }
  return monitorInstance;
}

export default {
  getSandboxMonitor,
};