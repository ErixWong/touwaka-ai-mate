/**
 * BackgroundTaskScheduler - 通用后台任务调度器
 *
 * 支持注册多种后台任务，统一管理生命周期
 *
 * 使用示例：
 * ```js
 * const scheduler = new BackgroundTaskScheduler(db);
 *
 * // 注册任务
 * scheduler.register({
 *   name: 'embedding-worker',
 *   interval: 30000,
 *   handler: async (db) => { ... }
 * });
 *
 * // 启动所有任务
 * scheduler.startAll();
 * ```
 */

import logger from './logger.js';

class BackgroundTaskScheduler {
  constructor(db) {
    this.db = db;
    this.tasks = new Map(); // name -> { interval, handler, intervalId, isRunning }
  }

  /**
   * 注册后台任务
   * @param {Object} options 任务配置
   * @param {string} options.name 任务名称（唯一标识）
   * @param {number} options.interval 执行间隔（毫秒）
   * @param {Function} options.handler 任务处理函数，接收 db 参数
   * @param {boolean} options.immediate 是否立即执行一次（默认 true）
   */
  register({ name, interval, handler, immediate = true }) {
    if (this.tasks.has(name)) {
      logger.warn(`[Scheduler] Task "${name}" already registered, overwriting`);
    }

    this.tasks.set(name, {
      interval,
      handler,
      intervalId: null,
      isRunning: false,
      immediate,
    });

    logger.info(`[Scheduler] Task "${name}" registered (interval: ${interval}ms)`);
  }

  /**
   * 启动指定任务
   * @param {string} name 任务名称
   */
  start(name) {
    const task = this.tasks.get(name);
    if (!task) {
      logger.error(`[Scheduler] Task "${name}" not found`);
      return;
    }

    if (task.isRunning) {
      logger.warn(`[Scheduler] Task "${name}" is already running`);
      return;
    }

    task.isRunning = true;

    // 立即执行一次
    if (task.immediate) {
      this._executeTask(name).catch(err => {
        logger.error(`[Scheduler] Task "${name}" initial execution error:`, err);
      });
    }

    // 设置定时器
    task.intervalId = setInterval(() => {
      this._executeTask(name).catch(err => {
        logger.error(`[Scheduler] Task "${name}" execution error:`, err);
      });
    }, task.interval);

    logger.info(`[Scheduler] Task "${name}" started`);
  }

  /**
   * 停止指定任务
   * @param {string} name 任务名称
   */
  stop(name) {
    const task = this.tasks.get(name);
    if (!task) {
      logger.error(`[Scheduler] Task "${name}" not found`);
      return;
    }

    if (task.intervalId) {
      clearInterval(task.intervalId);
      task.intervalId = null;
    }

    task.isRunning = false;
    logger.info(`[Scheduler] Task "${name}" stopped`);
  }

  /**
   * 启动所有已注册的任务
   */
  startAll() {
    for (const name of this.tasks.keys()) {
      this.start(name);
    }
    logger.info(`[Scheduler] All tasks started (${this.tasks.size} tasks)`);
  }

  /**
   * 停止所有任务
   */
  stopAll() {
    for (const name of this.tasks.keys()) {
      this.stop(name);
    }
    logger.info('[Scheduler] All tasks stopped');
  }

  /**
   * 获取任务状态
   * @param {string} name 任务名称
   * @returns {Object|null} 任务状态
   */
  getStatus(name) {
    const task = this.tasks.get(name);
    if (!task) return null;

    return {
      name,
      interval: task.interval,
      isRunning: task.isRunning,
    };
  }

  /**
   * 获取所有任务状态
   * @returns {Array} 任务状态列表
   */
  getAllStatus() {
    const result = [];
    for (const [name, task] of this.tasks) {
      result.push({
        name,
        interval: task.interval,
        isRunning: task.isRunning,
      });
    }
    return result;
  }

  /**
   * 执行任务（内部方法）
   */
  async _executeTask(name) {
    const task = this.tasks.get(name);
    if (!task || !task.handler) return;

    try {
      await task.handler(this.db);
    } catch (error) {
      logger.error(`[Scheduler] Task "${name}" handler error:`, error);
      throw error;
    }
  }
}

export default BackgroundTaskScheduler;