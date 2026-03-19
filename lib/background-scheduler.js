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
    this.tasks = new Map(); // name -> { interval, handler, intervalId, isRunning, isExecuting }
  }

  /**
   * 注册后台任务
   * @param {Object} options 任务配置
   * @param {string} options.name 任务名称（唯一标识）
   * @param {number} options.interval 执行间隔（毫秒）
   * @param {Function} options.handler 任务处理函数，接收 db 参数
   * @param {boolean} options.immediate 是否立即执行一次（默认 true）
   * @param {boolean} options.preventOverlap 是否防止重叠执行（默认 true）
   */
  register({ name, interval, handler, immediate = true, preventOverlap = true }) {
    // 参数验证
    if (!name || typeof name !== 'string') {
      throw new Error('[Scheduler] Task name must be a non-empty string');
    }
    if (!interval || typeof interval !== 'number' || interval < 1000) {
      throw new Error('[Scheduler] Task interval must be a number >= 1000ms');
    }
    if (!handler || typeof handler !== 'function') {
      throw new Error('[Scheduler] Task handler must be a function');
    }

    if (this.tasks.has(name)) {
      logger.warn(`[Scheduler] Task "${name}" already registered, overwriting`);
    }

    this.tasks.set(name, {
      interval,
      handler,
      intervalId: null,
      isRunning: false,
      isExecuting: false, // 防止重叠执行
      immediate,
      preventOverlap,
    });

    logger.info(`[Scheduler] Task "${name}" registered (interval: ${interval}ms, preventOverlap: ${preventOverlap})`);
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
      this._executeTask(name);
    }

    // 设置定时器
    task.intervalId = setInterval(() => {
      this._executeTask(name);
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
      isExecuting: task.isExecuting,
      lastStartTime: task.lastStartTime,
      lastEndTime: task.lastEndTime,
      executingDuration: task.isExecuting && task.lastStartTime
        ? Date.now() - task.lastStartTime
        : null,
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
        isExecuting: task.isExecuting,
        lastStartTime: task.lastStartTime,
        lastEndTime: task.lastEndTime,
        executingDuration: task.isExecuting && task.lastStartTime
          ? Date.now() - task.lastStartTime
          : null,
      });
    }
    return result;
  }

  /**
   * 强制重置任务执行状态
   * 用于处理任务卡住（isExecuting 长期为 true）的情况
   * @param {string} name 任务名称
   * @returns {boolean} 是否成功重置
   */
  forceReset(name) {
    const task = this.tasks.get(name);
    if (!task) {
      logger.error(`[Scheduler] Task "${name}" not found`);
      return false;
    }

    if (!task.isExecuting) {
      logger.info(`[Scheduler] Task "${name}" is not executing, no need to reset`);
      return true;
    }

    const duration = task.lastStartTime ? Date.now() - task.lastStartTime : 0;
    logger.warn(`[Scheduler] Force resetting task "${name}" (was executing for ${duration}ms)`);
    console.log(`[Scheduler] ⚠️ 强制重置任务 "${name}" (已执行 ${Math.round(duration / 1000)} 秒)`);

    task.isExecuting = false;
    task.lastEndTime = Date.now();
    return true;
  }

  /**
   * 执行任务（内部方法）
   * 支持防止重叠执行
   */
  async _executeTask(name) {
    const task = this.tasks.get(name);
    if (!task || !task.handler) return;

    // 每次触发时打印日志
    console.log(`[Scheduler] ⏰ 触发任务: ${name} (间隔: ${task.interval}ms)`);

    // 防止重叠执行
    if (task.preventOverlap && task.isExecuting) {
      console.log(`[Scheduler] ⏸️ 任务 "${name}" 正在执行中，跳过本轮`);
      logger.debug(`[Scheduler] Task "${name}" is already executing, skipping this run`);
      return;
    }

    task.isExecuting = true;
    task.lastStartTime = Date.now(); // 记录开始时间
    try {
      // 添加超时保护（默认 10 分钟）
      const timeout = task.timeout || 10 * 60 * 1000;
      await Promise.race([
        task.handler(this.db),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Task "${name}" timeout after ${timeout}ms`)), timeout)
        )
      ]);
    } catch (error) {
      logger.error(`[Scheduler] Task "${name}" handler error:`, error);
      // 不再 throw，避免未处理的 Promise rejection
    } finally {
      task.isExecuting = false;
      task.lastEndTime = Date.now(); // 记录结束时间
    }
  }
}

export default BackgroundTaskScheduler;