/**
 * LLM URL 归一化工具
 *
 * 统一项目内所有 LLM 调用路径的 base_url 归一化规则。
 * 这是唯一的 URL 归一化定义源，所有模块（provider.controller、config-loader、base-llm 等）
 * 统一复用以避免规则漂移。
 */

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i;
const HAS_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const TRAILING_SLASH_RE = /\/+$/;

/**
 * 归一化 LLM base_url
 *
 * 规则：
 *   1. 非字符串输入直接返回原值（由调用方按需校验）
 *   2. 空字符串直接返回空字符串
 *   3. 已含协议则仅去尾斜杠
 *   4. 本地地址默认补 http://
 *   5. 非本地地址默认补 https://
 *   6. 所有路径统一去尾斜杠
 *
 * @param {*} baseUrl - 待归一化的 base_url
 * @returns {string|*} 归一化后的 base_url，非字符串直接返回原值
 */
export function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string') return baseUrl;

  const trimmed = baseUrl.trim();
  if (!trimmed) return trimmed;

  if (HAS_PROTOCOL_RE.test(trimmed)) {
    return trimmed.replace(TRAILING_SLASH_RE, '');
  }

  const useHttp = LOCAL_HOST_RE.test(trimmed);
  const normalized = `${useHttp ? 'http' : 'https'}://${trimmed}`;
  return normalized.replace(TRAILING_SLASH_RE, '');
}
