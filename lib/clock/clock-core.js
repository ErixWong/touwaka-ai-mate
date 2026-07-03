/**
 * ClockCore - 统一时钟核心（Phase 1 最小骨架）
 *
 * 职责：
 * - 只支持 internal_job 的注册、启动、停止
 * - 提供 interval 调度、preventOverlap、cooldown、failure count
 * - Phase 1 不吞并 app_tick，不替换 AppClock
 *
 * 使用示例：
 *   const clock = new ClockCore(db);
 *   clock.register('doc-pipeline-worker', {
 *     interval: 10000,
 *     handler: async (context) => { ... },
 *   });
 *   clock.startAll();
 */

import logger from '../logger.js';

class ClockCore {
  constructor(db, config = {}) {
    this.db = db;
    this.jobs = new Map();
    this.maxConsecutiveFailures = config.maxConsecutiveFailures || 3;
    this.failureCooldownMs = config.failureCooldownMs || 2 * 60 * 1000;
    this.jobFailures = new Map();
    this.running = false;
  }

  /**
   * 注册 internal job
   * @param {string} name - 唯一 job 名称
   * @param {Object} options
   * @param {number} options.interval - 执行间隔 (ms)
   * @param {Function} options.handler - async (context) => result
   * @param {boolean} options.immediate - 是否立即执行一次
   * @param {boolean} options.preventOverlap - 是否防重叠
   */
  register(name, { interval, handler, immediate = true, preventOverlap = true }) {
    if (!name || typeof name !== 'string') {
      throw new Error('[ClockCore] Job name must be a non-empty string');
    }
    if (!interval || typeof interval !== 'number' || interval < 1000) {
      throw new Error('[ClockCore] Job interval must be >= 1000ms');
    }
    if (!handler || typeof handler !== 'function') {
      throw new Error('[ClockCore] Job handler must be a function');
    }

    if (this.jobs.has(name)) {
      logger.warn(`[ClockCore] Job "${name}" already registered, overwriting`);
    }

    this.jobs.set(name, {
      interval,
      handler,
      intervalId: null,
      isRunning: false,
      isExecuting: false,
      immediate,
      preventOverlap,
    });

    logger.info(`[ClockCore] Internal job "${name}" registered (interval=${interval}ms)`);
  }

  /**
   * 启动单个 job
   */
  start(name) {
    const job = this.jobs.get(name);
    if (!job) {
      logger.error(`[ClockCore] Job "${name}" not found`);
      return;
    }
    if (job.isRunning) {
      logger.warn(`[ClockCore] Job "${name}" already running`);
      return;
    }

    job.isRunning = true;

    if (job.immediate) {
      this._executeJob(name);
    }

    job.intervalId = setInterval(() => {
      this._executeJob(name);
    }, job.interval);

    logger.info(`[ClockCore] Job "${name}" started`);
  }

  /**
   * 停止单个 job
   */
  stop(name) {
    const job = this.jobs.get(name);
    if (!job) return;

    if (job.intervalId) {
      clearInterval(job.intervalId);
      job.intervalId = null;
    }
    job.isRunning = false;
    logger.info(`[ClockCore] Job "${name}" stopped`);
  }

  /**
   * 启动所有已注册 job
   */
  startAll() {
    for (const name of this.jobs.keys()) {
      this.start(name);
    }
    this.running = true;
    logger.info(`[ClockCore] All jobs started (${this.jobs.size} total)`);
  }

  /**
   * 停止所有 job
   */
  stopAll() {
    for (const name of this.jobs.keys()) {
      this.stop(name);
    }
    this.running = false;
    logger.info('[ClockCore] All jobs stopped');
  }

  /**
   * 获取 job 状态
   */
  getStatus(name) {
    const job = this.jobs.get(name);
    if (!job) return null;
    return {
      name,
      interval: job.interval,
      isRunning: job.isRunning,
      isExecuting: job.isExecuting,
      consecutiveFailures: this.jobFailures.get(name) || 0,
    };
  }

  /**
   * 获取所有 job 状态
   */
  getAllStatus() {
    const result = [];
    for (const [name, job] of this.jobs) {
      result.push({
        name,
        interval: job.interval,
        isRunning: job.isRunning,
        isExecuting: job.isExecuting,
        consecutiveFailures: this.jobFailures.get(name) || 0,
      });
    }
    return result;
  }

  /**
   * 执行 job（带 cooldown / failure count / preventOverlap）
   *
   * Phase 1 日志策略：
   * - 不写入 app_tick_log / app_tick_run（因 app_tick_log.registry_id 为 FK 到 app_clock_registry，
   *   internal job 无对应 registry 记录，无法满足 NOT NULL 约束）
   * - 改用 logger 输出执行摘要，后续 Phase 统一迁移到新 job 日志表
   */
  async _executeJob(name) {
    const job = this.jobs.get(name);
    if (!job || !job.isRunning) return;

    // 检查是否在 cooldown
    const failures = this.jobFailures.get(name) || 0;
    if (failures >= this.maxConsecutiveFailures) {
      return;
    }

    // 防止重叠执行
    if (job.preventOverlap && job.isExecuting) {
      return;
    }

    job.isExecuting = true;
    const startTime = Date.now();

    try {
      // 构造上下文
      const context = {
        db: this.db,
        jobName: name,
      };

      // 执行 handler
      const result = await job.handler(context);

      // 成功：重置失败计数
      this.jobFailures.set(name, 0);

      const elapsed = Date.now() - startTime;
      if (result && !result.skipped) {
        logger.info(`[ClockCore] Job "${name}" completed in ${elapsed}ms: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      // 累加失败计数
      const newFailures = (this.jobFailures.get(name) || 0) + 1;
      this.jobFailures.set(name, newFailures);

      const elapsed = Date.now() - startTime;
      logger.error(`[ClockCore] Job "${name}" failed (${newFailures}/${this.maxConsecutiveFailures}, ${elapsed}ms): ${error.message}`);

      // 达到上限后启动 cooldown
      if (newFailures >= this.maxConsecutiveFailures) {
        logger.warn(`[ClockCore] Job "${name}" entering cooldown for ${this.failureCooldownMs}ms`);
        setTimeout(() => {
          this.jobFailures.set(name, 0);
          logger.info(`[ClockCore] Job "${name}" cooldown expired, resuming`);
        }, this.failureCooldownMs);
      }
    } finally {
      job.isExecuting = false;
    }
  }
}

export default ClockCore;
