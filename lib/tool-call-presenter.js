/**
 * Tool call presentation helpers.
 *
 * These helpers only shape tool call data for logs/UI events. They do not
 * execute tools, filter permissions, or serialize tool results for LLM input.
 */

export function toToolCallArray(toolCalls) {
  if (!toolCalls) {
    return [];
  }
  return Array.isArray(toolCalls) ? toolCalls : [toolCalls];
}

export function getToolCallId(toolCall) {
  return toolCall?.function?.name || toolCall?.name || null;
}

export function formatToolCallDisplayName(toolCall, toolManager) {
  const toolId = getToolCallId(toolCall);
  if (!toolId) {
    return '';
  }

  if (toolManager && typeof toolManager.formatToolDisplay === 'function') {
    return toolManager.formatToolDisplay(toolId);
  }

  return toolId;
}

export function presentToolCalls(toolCalls, toolManager) {
  return toToolCallArray(toolCalls).map(toolCall => ({
    ...toolCall,
    displayName: formatToolCallDisplayName(toolCall, toolManager),
  }));
}

export function getToolCallDisplayNames(toolCalls, toolManager) {
  return toToolCallArray(toolCalls).map(toolCall =>
    formatToolCallDisplayName(toolCall, toolManager)
  );
}
