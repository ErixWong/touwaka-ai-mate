/**
 * Tool call snapshot builder.
 *
 * Produces the assistant-message-facing summary of tool calls. The full tool
 * result remains stored in separate tool messages; this module only prepares
 * a compact renderable snapshot for completion payloads.
 */

export function buildResultPreview(result) {
  const rawResult = result?.data;

  if (typeof rawResult === 'string') {
    return rawResult.slice(0, 200);
  }

  if (rawResult !== undefined) {
    try {
      return JSON.stringify(rawResult).slice(0, 200);
    } catch (error) {
      return '[unserializable result]';
    }
  }

  if (result?.error) {
    return String(result.error).slice(0, 200);
  }

  return null;
}

export function buildToolCallSnapshot(toolCallsWithResults = []) {
  if (!Array.isArray(toolCallsWithResults) || toolCallsWithResults.length === 0) {
    return [];
  }

  return toolCallsWithResults.map(call => ({
    tool_call_id: call.id || call.tool_call_id || null,
    name: call.function?.name || call.name || 'unknown',
    display_name: call.displayName || call.function?.name || call.name || 'unknown',
    arguments: call.function?.arguments || call.arguments || null,
    success: call.result?.success !== false,
    duration: call.duration || 0,
    result_preview: buildResultPreview(call.result),
    tool_message_id: call.tool_message_id || null,
    timestamp: call.timestamp || new Date().toISOString(),
  }));
}
