/**
 * Assistant execution context builder.
 *
 * Converts a persisted assistant request into the runtime context passed to the
 * executor. Identity comes from the stored request record; workspace details
 * may come from the normalized request input.
 */

import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../../../lib/agent/agent-invocation-context.js';

export function buildAssistantExecutionContext(request, options = {}) {
  const input = request?.input && typeof request.input === 'object'
    ? request.input
    : {};
  const workspace = input.workspace && typeof input.workspace === 'object'
    ? input.workspace
    : {};

  return {
    requestId: options.requestId || request?.request_id,
    workdir: workspace.workdir,
    topicId: request?.topic_id || workspace.topic_id,
    expertId: request?.expert_id || workspace.expert_id,
    userId: request?.user_id || null,
    contactId: request?.contact_id || null,
    agent_invocation: buildLegacyAssistantInvocationContext(request, input, workspace, options),
    messageService: options.messageService || null,
  };
}

export function buildLegacyAssistantInvocationContext(request, input = {}, workspace = {}, options = {}) {
  const userId = request?.user_id || options.userId || null;
  const rootExpertId = request?.expert_id || workspace.expert_id || options.expertId || null;
  const assistantId = request?.assistant_id || options.assistantId || null;

  if (!userId || !rootExpertId || !assistantId) {
    return null;
  }

  const rootInvocation = options.parentInvocation || buildRootAgentInvocationContext({
    run_id: options.parentRunId || `legacy_parent_${request?.request_id || 'unknown'}`,
    principal_user_id: userId,
    agent_id: rootExpertId,
    topic_id: request?.topic_id || workspace.topic_id,
    request_id: request?.request_id,
    workspace_scope: workspace.workdir ? { workdir: workspace.workdir } : {},
    capability_scope: {},
    source: 'legacy_assistant_parent',
  });

  return deriveChildAgentInvocationContext(rootInvocation, {
    run_id: options.runId || `legacy_child_${request?.request_id || 'unknown'}`,
    callee_agent_id: assistantId,
    request_id: options.requestId || request?.request_id,
    workspace_scope: workspace.workdir ? { workdir: workspace.workdir } : rootInvocation.workspace_scope,
    capability_scope: {
      legacy_inherited_tools: Array.isArray(input.inherited_tools)
        ? input.inherited_tools
        : [],
    },
    invocation_mode: 'legacy_assistant',
    source: 'legacy_assistant',
  });
}
