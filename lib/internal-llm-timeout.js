import { getSystemSettingService } from '../server/services/system-setting.service.js';

const DEFAULT_INTERNAL_LLM_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 获取 Internal LLM 超时配置（毫秒）
 * 优先从系统设置的 task_timeout 读取，若不可用则回退到文档默认值
 *
 * 两档 timeout 模型说明：
 * - fast_timeout: 快速回复类操作（如轮询、短请求），默认 120 秒
 * - task_timeout: 长时间任务（如 LLM 调用、OCR 处理），默认 300 秒
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 超时值（毫秒）
 */
export async function getInternalLlmTimeoutMs(db) {
  if (!db) {
    return DEFAULT_INTERNAL_LLM_TIMEOUT_MS;
  }

  try {
    const settingService = getSystemSettingService(db);
    // Internal LLM 属于长时间任务，使用 task_timeout
    const timeoutSeconds = await settingService.getTimeout('task_timeout');
    if (typeof timeoutSeconds === 'number' && timeoutSeconds > 0) {
      return timeoutSeconds * 1000;
    }
  } catch {
    // ignore and fallback
  }

  return DEFAULT_INTERNAL_LLM_TIMEOUT_MS;
}

/**
 * 获取快速操作超时配置（毫秒）
 * 用于轮询、短请求等快速操作场景
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 超时值（毫秒）
 */
export async function getFastTimeoutMs(db) {
  if (!db) {
    return 120 * 1000;
  }

  try {
    const settingService = getSystemSettingService(db);
    const timeoutSeconds = await settingService.getTimeout('fast_timeout');
    if (typeof timeoutSeconds === 'number' && timeoutSeconds > 0) {
      return timeoutSeconds * 1000;
    }
  } catch {
    // ignore and fallback
  }

  return 120 * 1000;
}

/**
 * 获取长时间任务超时配置（毫秒）
 * 用于 LLM 调用、OCR 处理等需要较长时间的操作
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<number>} 超时值（毫秒）
 */
export async function getTaskTimeoutMs(db) {
  return getInternalLlmTimeoutMs(db);
}

export { DEFAULT_INTERNAL_LLM_TIMEOUT_MS };