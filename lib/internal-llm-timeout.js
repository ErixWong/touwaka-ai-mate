import { getSystemSettingService } from '../server/services/system-setting.service.js';

const DEFAULT_INTERNAL_LLM_TIMEOUT_MS = 30 * 60 * 1000;

export async function getInternalLlmTimeoutMs(db) {
  // 内部链路统一从系统设置读取 timeout.internal_llm。
  // 若设置不可用，则回退到文档化的 30 分钟默认值；
  // 该默认值属于统一系统级兜底，不是阶段级 timeout。
  if (!db) {
    return DEFAULT_INTERNAL_LLM_TIMEOUT_MS;
  }

  try {
    const settingService = getSystemSettingService(db);
    const timeoutSeconds = await settingService.getTimeout('internal_llm');
    if (typeof timeoutSeconds === 'number' && timeoutSeconds > 0) {
      return timeoutSeconds * 1000;
    }
  } catch {
    // ignore and fallback
  }

  return DEFAULT_INTERNAL_LLM_TIMEOUT_MS;
}

export { DEFAULT_INTERNAL_LLM_TIMEOUT_MS };