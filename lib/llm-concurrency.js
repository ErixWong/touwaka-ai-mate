/**
 * 全局 LLM 上游并发闸门。
 *
 * 为什么需要：文档清洗、大纲、分块、embedding、agent 会话各自都有并发逻辑，
 * 叠加起来会同时向上游打几十路请求（实测：97 篇文档导入期间出现 28 路并行清洗，
 * 上游随即 ECONNRESET / 429，然后各家重试再放大，彻底雪崩）。
 * 进程级闸门把「同时在上游飞着的请求数」硬性压到 LLM_MAX_CONCURRENCY（默认 4），
 * 排队而不是失败，重试风暴也无法突破上限。
 *
 * 注意：闸门必须包住「整个请求生命周期」（流式要包到流结束），
 * 否则释放早了等于没限流。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import logger from './logger.js';

const rawLimit = parseInt(process.env.LLM_MAX_CONCURRENCY, 10);
export const LLM_MAX_CONCURRENCY = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 4;

// 重入保护：同一调用链里已经在槽位内的代码（比如 agent 在流式回调里再调 LLM）
// 直接放行，否则 4 个槽位全被外层占住时内层会永久等待 → 死锁。
const slotContext = new AsyncLocalStorage();

let active = 0;
const waiters = [];
let peakActive = 0;

// 打满或排队时低频播报一次，便于线上确认闸门真的在兜住并发
let lastReportAt = 0;
function maybeReport() {
  const now = Date.now();
  if (now - lastReportAt < 30000) return;
  if (active < LLM_MAX_CONCURRENCY && waiters.length === 0) return;
  lastReportAt = now;
  logger.info(
    `[LLMGate] active=${active}/${LLM_MAX_CONCURRENCY} queued=${waiters.length} peak=${peakActive}`
  );
}

// 等待队列两级 FIFO：高优先永远插队，同级先来先服务。
// 为什么需要插队：折叠摘要器 / 判官这类非流式小请求跑在 agent 轮次的**关键路径**上，
// 而引擎给它的死线只有几十秒（`summarizerTimeoutMs` 默认 30s）。4 个槽位被长流式
// 轮次占满时，普通 FIFO 会让它排队到超时被 abort —— 摘要器一死整次 run 以
// `summarizer_failed` 收尾。插队只改**顺序**，不改总并发上限。
function takeWaiter() {
  const i = waiters.findIndex((w) => w.high);
  return i < 0 ? waiters.shift() : waiters.splice(i, 1)[0];
}

function drain() {
  while (active < LLM_MAX_CONCURRENCY && waiters.length > 0) {
    const w = takeWaiter();
    active += 1;
    if (active > peakActive) peakActive = active;
    w.resolve();
  }
}

/**
 * 占用一个上游并发槽位。
 *
 * @param {{ priority?: 'normal'|'high' }} [opts] `high` = 关键路径上的短请求（折叠摘要器、判官）
 * @returns {Promise<void>}
 */
export function acquireLLMSlot({ priority = 'normal' } = {}) {
  if (active < LLM_MAX_CONCURRENCY) {
    active += 1;
    if (active > peakActive) peakActive = active;
    maybeReport();
    return Promise.resolve();
  }
  return new Promise(resolve => {
    waiters.push({ resolve, high: priority === 'high' });
    maybeReport();
  });
}

/**
 * 释放一个上游并发槽位。
 */
export function releaseLLMSlot() {
  if (slotContext.getStore() === true) return;
  if (active > 0) active -= 1;
  drain();
}

/**
 * 在闸门内执行一段异步逻辑。
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ priority?: 'normal'|'high' }} [opts]
 * @returns {Promise<T>}
 */
export async function withLLMSlot(fn, { priority = 'normal' } = {}) {
  if (slotContext.getStore() === true) return await fn();
  await acquireLLMSlot({ priority });
  try {
    return await slotContext.run(true, fn);
  } finally {
    releaseLLMSlot();
  }
}

/**
 * 当前闸门状态，供诊断接口与日志使用。
 *
 * @returns {{limit:number, active:number, queued:number, peak:number}}
 */
export function llmConcurrencyStats() {
  return {
    limit: LLM_MAX_CONCURRENCY,
    active,
    queued: waiters.length,
    queued_high: waiters.filter(w => w.high).length,
    peak: peakActive,
  };
}

/*
 * ── embedding 独立并发闸 ──────────────────────────────────────────────
 *
 * 为什么单独一条：embedding 请求轻（单条 ~2s、非流式），而 LLM 清洗轮次是重活
 * （单轮几十秒~分钟级流式）。两者挤同一个 4 槽闸时，重的清洗流会把轻的 embedding
 * 挤到排队超时被 abort → 误判 "empty vector" → 整篇 embedding_failed。给 embedding
 * 单开 EMBEDDING_MAX_CONCURRENCY（默认 8）一条道，与 LLM 的 4 互不抢占，从根上消除饿死，
 * 同时把总上游并发硬上限压在 4 + 8 = 12（远低于当年雪崩的 28 路）。
 *
 * embedding 请求短小均匀，不需要 LLM 闸那套 high 插队，纯 FIFO 即可。
 */
const rawEmbLimit = parseInt(process.env.EMBEDDING_MAX_CONCURRENCY, 10);
export const EMBEDDING_MAX_CONCURRENCY = Number.isFinite(rawEmbLimit) && rawEmbLimit > 0 ? rawEmbLimit : 8;

const embSlotContext = new AsyncLocalStorage();
let embActive = 0;
const embWaiters = [];
let embPeak = 0;
let embLastReportAt = 0;

function maybeReportEmb() {
  const now = Date.now();
  if (now - embLastReportAt < 30000) return;
  if (embActive < EMBEDDING_MAX_CONCURRENCY && embWaiters.length === 0) return;
  embLastReportAt = now;
  logger.info(
    `[EmbedGate] active=${embActive}/${EMBEDDING_MAX_CONCURRENCY} queued=${embWaiters.length} peak=${embPeak}`
  );
}

function drainEmb() {
  while (embActive < EMBEDDING_MAX_CONCURRENCY && embWaiters.length > 0) {
    const w = embWaiters.shift();
    embActive += 1;
    if (embActive > embPeak) embPeak = embActive;
    w.resolve();
  }
}

export function acquireEmbeddingSlot() {
  if (embActive < EMBEDDING_MAX_CONCURRENCY) {
    embActive += 1;
    if (embActive > embPeak) embPeak = embActive;
    maybeReportEmb();
    return Promise.resolve();
  }
  return new Promise(resolve => {
    embWaiters.push({ resolve });
    maybeReportEmb();
  });
}

export function releaseEmbeddingSlot() {
  if (embSlotContext.getStore() === true) return;
  if (embActive > 0) embActive -= 1;
  drainEmb();
}

export async function withEmbeddingSlot(fn) {
  if (embSlotContext.getStore() === true) return await fn();
  await acquireEmbeddingSlot();
  try {
    return await embSlotContext.run(true, fn);
  } finally {
    releaseEmbeddingSlot();
  }
}

export function embeddingConcurrencyStats() {
  return {
    limit: EMBEDDING_MAX_CONCURRENCY,
    active: embActive,
    queued: embWaiters.length,
    peak: embPeak,
  };
}
