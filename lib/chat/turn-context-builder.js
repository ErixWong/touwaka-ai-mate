/**
 * Turn context builder.
 *
 * This module builds the data envelope for one stream chat turn after the
 * async prerequisites have already been resolved by ChatService.
 */

import { buildRootAgentInvocationContext } from '../agent/agent-invocation-context.js';

export function buildToolContext({ user_id, expert_id, session, agent_invocation = null }) {
  return { user_id, expert_id, session, agent_invocation };
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

function getToolNames(tools = []) {
  return tools
    .map(tool => tool?.function?.name)
    .filter(Boolean);
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
  const llmPayload = buildStreamLlmPayload({ modelConfig, messages, tools });
  const agentInvocation = buildRootAgentInvocationContext({
    principal_user_id: user_id,
    agent_id: expert_id,
    topic_id,
    task_id,
    request_id,
    workspace_scope: taskContext?.absolute_workspace_path
      ? {
          workdir: taskContext.absolute_workspace_path,
          logical_workdir: taskContext.logical_workspace_path || null,
          workspace_mode: taskContext.workspace_mode || null,
          current_path: taskContext.current_path || '',
        }
      : {},
    capability_scope: {
      tools: getToolNames(tools),
    },
  });
  const toolContext = buildToolContext({
    user_id,
    expert_id,
    session,
    agent_invocation: agentInvocation,
  });

  return {
    agent_invocation: agentInvocation,
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
      agent_invocation: agentInvocation,
    },
  };
}
