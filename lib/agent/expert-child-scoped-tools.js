/**
 * Expert child scoped tools adapter.
 *
 * Produces LLM-visible tool definitions for a child expert by intersecting the
 * child invocation's effective scope with the child expert's existing tools.
 */

function normalizeAllowedToolNames(effective_scope = {}) {
  if (!Array.isArray(effective_scope.tools)) {
    return [];
  }

  return [...new Set(effective_scope.tools
    .filter(tool => typeof tool === 'string' && tool.trim())
    .map(tool => tool.trim()))];
}

export function getToolDefinitionName(tool) {
  return tool?.function?.name || tool?.name || null;
}

function buildChildToolContext({ invocation_context, session }) {
  const user_id = invocation_context.principal_user_id;
  const expert_id = invocation_context.callee_agent_id;

  return {
    user_id,
    userId: user_id,
    expert_id,
    expertId: expert_id,
    session,
  };
}

export async function getExpertChildScopedTools({
  expert_service,
  invocation_context,
  effective_scope = {},
  session = null,
} = {}) {
  const allowedToolNames = normalizeAllowedToolNames(effective_scope);
  if (allowedToolNames.length === 0) {
    return [];
  }

  if (!expert_service?.toolManager || typeof expert_service.toolManager.getToolDefinitions !== 'function') {
    throw new Error('expert_service.toolManager.getToolDefinitions is required');
  }

  const toolContext = buildChildToolContext({ invocation_context, session });
  const allTools = await expert_service.toolManager.getToolDefinitions(toolContext);
  const allowed = new Set(allowedToolNames);

  return (Array.isArray(allTools) ? allTools : [])
    .filter(tool => allowed.has(getToolDefinitionName(tool)));
}

export default {
  getExpertChildScopedTools,
  getToolDefinitionName,
};
