/**
 * Turn context builder.
 *
 * This module builds the data envelope for one stream chat turn after the
 * async prerequisites have already been resolved by ChatService.
 */

export function buildToolContext({ user_id, expert_id, session }) {
  return { user_id, expert_id, session };
}

export function buildStreamLlmPayload({ modelConfig, messages, tools }) {
  return {
    model: modelConfig.model_name,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    _debug: {
      model_config: {
        provider_name: modelConfig.provider_name,
        base_url: modelConfig.base_url,
        max_tokens: modelConfig.max_tokens,
        max_output_tokens: modelConfig.max_output_tokens,
      },
      context_messages_count: messages.length,
      tools_count: tools.length,
    },
  };
}

export function buildStreamTurnContext({
  user_id,
  expert_id,
  topic_id,
  task_id,
  taskContext,
  session,
  request_id,
  modelConfig,
  thinkingConfig,
  messages,
  tools,
}) {
  const toolContext = buildToolContext({ user_id, expert_id, session });
  const llmPayload = buildStreamLlmPayload({ modelConfig, messages, tools });

  return {
    caller: {
      user_id,
      session,
    },
    expert: {
      expert_id,
    },
    scope: {
      topic_id,
      task_id,
      taskContext,
      request_id,
    },
    toolContext,
    llmPayload,
    roundInput: {
      modelConfig,
      thinkingConfig,
      tools,
      currentMessages: messages,
      llmPayload,
      user_id,
      expert_id,
      taskContext,
      topic_id,
      task_id,
      session,
      request_id,
    },
  };
}
