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
  const truncatedText = userPrompt.substring(0, safeChars) + '\n\n[... 文本超出模型上下文限制已截断 ...]';

  return { systemPrompt, userPrompt: truncatedText, truncated: true };
}

export default {
  estimateTokens,
  estimateMessagesTokens,
  truncateMessages,
  truncateForContext,
  IMAGE_TOKEN_COST,
  CHARS_PER_TOKEN_ZH,
  CHARS_PER_TOKEN_EN,
  MESSAGE_OVERHEAD_TOKENS,
};