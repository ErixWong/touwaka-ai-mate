import logger from './logger.js';

const THINKING_FORMATS = ['openai', 'deepseek', 'glm', 'qwen', 'none'];

function normalizeThinkingFormat(value) {
  if (typeof value !== 'string') return 'none';
  return THINKING_FORMATS.includes(value) ? value : 'none';
}

function detectThinkingFormat(modelName = '') {
  const normalizedModelName = String(modelName).toLowerCase();

  if (!normalizedModelName) return 'none';
  if (normalizedModelName.startsWith('o1-') || normalizedModelName.startsWith('o3-') || normalizedModelName.startsWith('o4-') || normalizedModelName.startsWith('gpt-5')) {
    return 'openai';
  }
  if (normalizedModelName.startsWith('glm-')) {
    return 'glm';
  }
  if (normalizedModelName.includes('qwen') || normalizedModelName.startsWith('qwq')) {
    return 'qwen';
  }
  if (normalizedModelName.includes('deepseek')) {
    return 'deepseek';
  }
  return 'none';
}

function getConfiguredThinkingFormat(model) {
  if (model?.supports_reasoning) {
    const configuredFormat = normalizeThinkingFormat(model.thinking_format);
    if (configuredFormat !== 'none') {
      return { format: configuredFormat, source: 'config' };
    }
  }

  const detectedFormat = detectThinkingFormat(model?.model_name);
  return { format: detectedFormat, source: detectedFormat === 'none' ? 'none' : 'auto-detect' };
}

function buildEnabledConfig(format) {
  switch (format) {
    case 'openai':
      return { thinking: null, reasoning: { effort: 'medium' }, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: false };
    case 'glm':
      return { thinking: { type: 'enabled' }, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: false };
    case 'qwen':
      return { thinking: null, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: { enable_thinking: true }, append_no_think: false };
    case 'deepseek':
      return { thinking: { type: 'enabled' }, reasoning: null, reasoning_effort: 'high', enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: false };
    default:
      return { thinking: null, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: false };
  }
}

/**
 * 关闭思考时的请求参数。
 *
 * openai 形态不能“什么都不发”：OpenAI 兼容网关上的 reasoning 模型（如 qwen3.8-flash-next
 * 走 OpenAI 兼容入口）默认就带思考，只追加 `/no_think` 文本提示它们不认，实测每块仍烧
 * 3~5k reasoning tokens、180~260s。真正的开关是 `reasoning_effort: "none"`（实测 0 reasoning
 * tokens / 18s）。o1/o3/o4 系列不认 `none`，保留旧行为。
 */
function buildDisabledConfig(format, modelName = '') {
  const name = String(modelName || '').toLowerCase();
  const legacyOpenAIReasoning = /^(o1|o3|o4)-/.test(name);

  switch (format) {
    case 'glm':
      return { thinking: { type: 'disabled' }, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: false };
    case 'qwen':
      return { thinking: null, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: { enable_thinking: false }, append_no_think: false };
    case 'deepseek':
      return { thinking: { type: 'disabled' }, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: false };
    case 'openai':
      if (legacyOpenAIReasoning) {
        return { thinking: null, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: true };
      }
      return { thinking: null, reasoning: null, reasoning_effort: 'none', enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: false };
    case 'none':
    default:
      return { thinking: null, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: true };
  }
}

function resolveThinkingRequestConfig(model, options = {}) {
  const { enable_reasoning = false, logger_prefix = '[LLMThinkingConfig]' } = options;
  const { format, source } = getConfiguredThinkingFormat(model);

  if (!model?.model_name) {
    return {
        format: 'none',
        source: 'none',
        thinking: null,
        reasoning: null,
        reasoning_effort: undefined,
        enable_thinking: undefined,
        chat_template_kwargs: undefined,
        append_no_think: false,
      };
  }

  const config = enable_reasoning
    ? buildEnabledConfig(format)
    : buildDisabledConfig(format, model?.model_name);

  logger.info(`${logger_prefix} ${enable_reasoning ? '启用' : '关闭'}思考配置:`, {
    model_name: model.model_name,
    format,
    source,
    enable_reasoning,
    has_thinking: !!config.thinking,
    has_reasoning: !!config.reasoning,
    reasoning_effort: config.reasoning_effort,
    enable_thinking: config.enable_thinking,
    chat_template_kwargs: config.chat_template_kwargs,
    append_no_think: config.append_no_think,
  });

  return {
    format,
    source,
    ...config,
  };
}

function appendNoThinkPrompt(systemPrompt = '', appendNoThink = false) {
  if (!appendNoThink) return systemPrompt;
  if (typeof systemPrompt !== 'string' || !systemPrompt.includes('/no_think')) {
    return `${systemPrompt}\n/no_think`;
  }
  return systemPrompt;
}

export {
  THINKING_FORMATS,
  normalizeThinkingFormat,
  detectThinkingFormat,
  getConfiguredThinkingFormat,
  resolveThinkingRequestConfig,
  appendNoThinkPrompt,
};
