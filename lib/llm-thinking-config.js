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

function buildDisabledConfig(format) {
  switch (format) {
    case 'glm':
      return { thinking: { type: 'disabled' }, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: false };
    case 'qwen':
      return { thinking: null, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: { enable_thinking: false }, append_no_think: false };
    case 'deepseek':
      return { thinking: { type: 'disabled' }, reasoning: null, reasoning_effort: undefined, enable_thinking: undefined, chat_template_kwargs: undefined, append_no_think: false };
    case 'openai':
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
    : buildDisabledConfig(format);

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
