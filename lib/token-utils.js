/**
 * Token Utils - Token 估算与 Context 截断工具
 * 
 * 统一实现，消除重复
 */

const IMAGE_TOKEN_COST = 1000;
const CHARS_PER_TOKEN_ZH = 1.5;
const CHARS_PER_TOKEN_EN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;

const CHARS_ZH_RE = /[\u4e00-\u9fa5]/g;

/**
 * 估算文本的 token 数
 * - 中文约 1.5 字符/token (每个 token ≈ 1.5 个中文字符)
 * - 英文约 4 字符/token (每个 token ≈ 4 个英文字符)
 */
export function estimateTokens(text) {
  if (!text) return 0;

  if (Array.isArray(text)) {
    let total = 0;
    for (const item of text) {
      if (item.type === 'text' && item.text) {
        total += estimateTokens(item.text);
      } else if (item.type === 'image_url') {
        total += IMAGE_TOKEN_COST;
      }
    }
    return total;
  }

  const chineseChars = (text.match(CHARS_ZH_RE) || []).length;
  const otherChars = text.length - chineseChars;

  return Math.ceil(chineseChars / CHARS_PER_TOKEN_ZH + otherChars / CHARS_PER_TOKEN_EN);
}

/**
 * 估算消息数组的 token 数量
 */
export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    total += MESSAGE_OVERHEAD_TOKENS;
    total += estimateTokens(msg.content);
    if (msg.name) {
      total += estimateTokens(msg.name);
    }
    if (msg.tool_calls) {
      total += estimateTokens(JSON.stringify(msg.tool_calls));
    }
  }
  return total;
}

/**
 * 根据模型上下文限制截断消息数组
 */
export function truncateMessages(messages, maxTokens = 128000, safetyRatio = 0.8) {
  const limit = Math.floor(maxTokens * safetyRatio);
  const systemMessages = messages.filter(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');

  let total = estimateMessagesTokens(systemMessages);
  const truncated = [...systemMessages];

  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const msg = otherMessages[i];
    const msgTokens = estimateTokens(msg.content) + MESSAGE_OVERHEAD_TOKENS;
    if (total + msgTokens > limit) break;
    truncated.splice(systemMessages.length, 0, msg);
    total += msgTokens;
  }

  return truncated;
}

/**
 * 根据模型上下文限制截断文本
 */
export function truncateForContext(model, systemPrompt, userPrompt) {
  const maxTokens = model.max_tokens || 128000;
  const maxOutput = model.max_output_tokens || 4096;
  const maxInput = maxTokens - maxOutput;
  const limit = Math.floor(maxInput * 0.85);

  const systemTokens = estimateTokens(systemPrompt);
  const userTokens = estimateTokens(userPrompt);
  const totalTokens = systemTokens + userTokens;

  if (totalTokens <= limit) {
    return { systemPrompt, userPrompt, truncated: false };
  }

  const availableForUser = limit - systemTokens;
  if (availableForUser <= 0) {
    return { systemPrompt, userPrompt, truncated: true };
  }

  const charsPerToken = userTokens > 0 ? userPrompt.length / userTokens : CHARS_PER_TOKEN_EN;
  const safeChars = Math.floor(availableForUser * charsPerToken * 0.9);
  let truncatedText = userPrompt.substring(0, safeChars);
  
  // 修复可能的 Unicode 代理字符截断问题
  // 如果截断位置在代理字符对中间，移除最后一个不完整的字符
  if (truncatedText.length > 0) {
    const lastChar = truncatedText.charCodeAt(truncatedText.length - 1);
    if (lastChar >= 0xD800 && lastChar <= 0xDBFF) {
      truncatedText = truncatedText.substring(0, truncatedText.length - 1);
    }
  }
  
  truncatedText += '\n\n[... 文本超出模型上下文限制已截断 ...]';

  return { systemPrompt, userPrompt: truncatedText, truncated: true };
}

/**
 * 安全截断字符串，避免切断 Unicode 代理字符对
 * @param {string} str - 要截断的字符串
 * @param {number} maxLength - 最大长度
 * @param {string} suffix - 截断后添加的后缀（可选）
 * @returns {string} 截断后的字符串
 */
export function safeTruncate(str, maxLength, suffix = '') {
  if (!str || str.length <= maxLength) {
    return str || '';
  }
  let truncated = str.substring(0, maxLength);
  const lastChar = truncated.charCodeAt(truncated.length - 1);
  if (lastChar >= 0xD800 && lastChar <= 0xDBFF) {
    truncated = truncated.substring(0, truncated.length - 1);
  }
  return truncated + suffix;
}

/**
 * 清理字符串中的损坏 Unicode 代理字符
 * 移除孤立的代理字符（没有配对的高低代理字符）
 * @param {string} str - 要清理的字符串
 * @returns {string} 清理后的字符串
 */
export function cleanSurrogates(str) {
  if (!str) return '';
  
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    
    // 高代理字符 (0xD800-0xDBFF) 需要后面跟着低代理字符
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      const nextCharCode = str.charCodeAt(i + 1);
      if (nextCharCode >= 0xDC00 && nextCharCode <= 0xDFFF) {
        result += str[i] + str[i + 1];
        i++; // 跳过低代理字符
      } else {
        // 孤立的高代理字符，跳过（移除）
      }
    }
    // 低代理字符 (0xDC00-0xDFFF) 如果前面没有高代理字符，则是孤立的
    else if (charCode >= 0xDC00 && charCode <= 0xDFFF) {
      const prevCharCode = str.charCodeAt(i - 1);
      if (!(prevCharCode >= 0xD800 && prevCharCode <= 0xDBFF)) {
        // 孤立的低代理字符，跳过（移除）
      } else {
        // 已在处理高代理字符时添加，这里不重复添加
      }
    }
    else {
      result += str[i];
    }
  }
  return result;
}

export default {
  estimateTokens,
  estimateMessagesTokens,
  truncateMessages,
  truncateForContext,
  safeTruncate,
  cleanSurrogates,
  IMAGE_TOKEN_COST,
  CHARS_PER_TOKEN_ZH,
  CHARS_PER_TOKEN_EN,
  MESSAGE_OVERHEAD_TOKENS,
};