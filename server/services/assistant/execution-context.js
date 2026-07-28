/**
 * Assistant execution context builder.
 *
 * Converts a persisted assistant request into the runtime context passed to the
 * executor. Identity comes from the stored request record; workspace details
 * may come from the normalized request input.
 */

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
    messageService: options.messageService || null,
  };
}
