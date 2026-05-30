/**
 * LLM Payload 缓存模块
 * 
 * 负责缓存 LLM 请求的 payload，用于调试和日志分析
 * 
 * 【基础设施层】
 * 用途：仅用于用户对话调试，服务重启后丢失
 */

import logger from '../logger.js';

class LLMPayloadCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * 保存 LLM Payload 到缓存
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {Object} payload - LLM 请求 payload
   */
  save(user_id, expert_id, payload) {
    const cacheKey = `${user_id}:${expert_id}`;
    this.cache.set(cacheKey, {
      ...payload,
      cached_at: new Date().toISOString(),
    });
    logger.debug(`[LLMPayloadCache] Payload 已缓存: ${cacheKey}`);
  }

  /**
   * 获取最近一次 LLM Payload
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @returns {Object|null} LLM Payload 或 null
   */
  get(user_id, expert_id) {
    const cacheKey = `${user_id}:${expert_id}`;
    return this.cache.get(cacheKey) || null;
  }

  /**
   * 清除指定用户的缓存
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   */
  clear(user_id, expert_id) {
    const cacheKey = `${user_id}:${expert_id}`;
    this.cache.delete(cacheKey);
    logger.debug(`[LLMPayloadCache] 缓存已清除: ${cacheKey}`);
  }

  /**
   * 清除所有缓存
   */
  clearAll() {
    this.cache.clear();
    logger.info('[LLMPayloadCache] 所有缓存已清除');
  }
}

export default LLMPayloadCache;