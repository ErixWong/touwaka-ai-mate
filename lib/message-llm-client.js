import { call as baseCall, callStream as baseCallStream, callWithRetry as baseCallWithRetry } from './chat/base-llm.js';
import { appendNoThinkPrompt, resolveThinkingRequestConfig } from './llm-thinking-config.js';

function applyThinkingPolicy(model, messages, options = {}) {
  const { thinking_policy, logger_prefix = '[MessageLLMClient]', ...restOptions } = options;

  if (thinking_policy !== 'enable' && thinking_policy !== 'disable') {
    return { messages, options: restOptions };
  }

  const thinkingConfig = resolveThinkingRequestConfig(model, {
    enable_reasoning: thinking_policy === 'enable',
    logger_prefix,
  });

  const processedMessages = Array.isArray(messages)
    ? messages.map((message) => {
        if (message?.role === 'system' && typeof message.content === 'string') {
          return {
            ...message,
            content: appendNoThinkPrompt(message.content, thinkingConfig.append_no_think),
          };
        }
        return message;
      })
    : messages;

  return {
    messages: processedMessages,
    options: {
      ...restOptions,
      thinking: restOptions.thinking ?? thinkingConfig.thinking,
      reasoning: restOptions.reasoning ?? thinkingConfig.reasoning,
      reasoning_effort: restOptions.reasoning_effort ?? thinkingConfig.reasoning_effort,
      enable_thinking: restOptions.enable_thinking ?? thinkingConfig.enable_thinking,
      chat_template_kwargs: restOptions.chat_template_kwargs ?? thinkingConfig.chat_template_kwargs,
    },
  };
}

async function invoke(model, messages, options = {}) {
  const resolved = applyThinkingPolicy(model, messages, options);
  return baseCall(model, resolved.messages, resolved.options);
}

async function invokeWithRetry(model, messages, options = {}) {
  const resolved = applyThinkingPolicy(model, messages, options);
  return baseCallWithRetry(model, resolved.messages, resolved.options);
}

async function invokeStream(model, messages, options = {}) {
  const resolved = applyThinkingPolicy(model, messages, options);
  return baseCallStream(model, resolved.messages, resolved.options);
}

export {
  invoke,
  invokeWithRetry,
  invokeStream,
};

export default {
  invoke,
  invokeWithRetry,
  invokeStream,
};
