/**
 * LLM Retry Utilities
 * 统一 LLM 调用的重试逻辑
 * 
 * 从 LLMClient 和 InternalLLMService 中提取公共部分
 */

import logger from './logger.js';

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2000,     // 基础延迟（毫秒）
  maxDelayMs: 30000,     // 最大延迟（毫秒）
  backoffMultiplier: 2,  // 退避乘数
};

/**
 * 判断错误是否可重试
 * @param {Error} error - 错误对象
 * @returns {boolean} 是否可重试
 */
export function isRetryableError(error) {
  if (!error) return false;

  // 网络相关错误
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'ECONNABORTED'].includes(error.code)) {
    return true;
  }

  const message = error.message || '';

  // Socket 相关错误
  if (message.includes('socket hang up') ||
      message.includes('connection reset') ||
      message.includes('broken pipe')) {
    return true;
  }

  // HTTP 状态码相关
  // 429: 请求过多
  if (message.includes('429') || message.includes('Too Many Requests')) {
    return true;
  }

  // 503: 服务暂时不可用
  if (message.includes('503') || message.includes('Service Unavailable')) {
    return true;
  }

  // 502/504: 网关错误
  if (message.includes('502') || message.includes('504')) {
    return true;
  }

  // 超时错误
  if (message.includes('timeout') || message.includes('Timeout')) {
    return true;
  }

  // 5xx 服务器错误
  if (message.match(/HTTP 5\d{2}/)) {
    return true;
  }

  return false;
}

/**
 * 带指数退避的重试执行器
 * @param {Function} fn - 要执行的异步函数
 * @param {Object} options - 配置选项
 * @param {number} options.maxRetries - 最大重试次数（默认 3）
 * @param {number} options.baseDelayMs - 基础延迟毫秒数（默认 2000）
 * @param {number} options.maxDelayMs - 最大延迟毫秒数（默认 30000）
 * @param {number} options.backoffMultiplier - 退避乘数（默认 2）
 * @param {string} options.loggerPrefix - 日志前缀（默认 '[Retry]'）
 * @returns {Promise<any>} 函数执行结果
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = DEFAULT_RETRY_CONFIG.maxRetries,
    baseDelayMs = DEFAULT_RETRY_CONFIG.baseDelayMs,
    maxDelayMs = DEFAULT_RETRY_CONFIG.maxDelayMs,
    backoffMultiplier = DEFAULT_RETRY_CONFIG.backoffMultiplier,
    loggerPrefix = '[Retry]',
  } = options;

  const errors = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      errors.push(error);

      // 判断是否应该重试
      if (!isRetryableError(error) || attempt === maxRetries) {
        const aggregateError = new Error(
          `${loggerPrefix} Failed after ${attempt} attempts: ${error.message}`
        );
        aggregateError.errors = errors;
        throw aggregateError;
      }

      // 指数退避计算延迟
      const delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);
      logger.warn(
        `${loggerPrefix} Attempt ${attempt}/${maxRetries} failed, ` +
        `retrying in ${delay / 1000}s: ${error.message}`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export default {
  isRetryableError,
  retryWithBackoff,
  DEFAULT_RETRY_CONFIG,
};