/**
 * Agent event contract.
 *
 * Events are intentionally persistence-agnostic for now. Later phases can map
 * them to SSE or future agent_run tables.
 */

import Utils from '../utils.js';

const AGENT_EVENT_TYPES = Object.freeze([
  'agent_run_created',
  'agent_run_started',
  'agent_tool_called',
  'agent_tool_completed',
  'delegation_created',
  'delegation_completed',
  'delegation_failed',
  'agent_run_completed',
  'agent_run_failed',
  'agent_run_cancelled',
]);

function normalizeNullableString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizePayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

export function isAgentEventType(type) {
  return AGENT_EVENT_TYPES.includes(type);
}

export function buildAgentEvent({
  type,
  invocation_context,
  payload = {},
  event_id,
  created_at,
} = {}) {
  if (!isAgentEventType(type)) {
    throw new Error(`Unknown agent event type: ${type}`);
  }
  if (!invocation_context || typeof invocation_context !== 'object') {
    throw new Error('invocation_context is required');
  }

  return Object.freeze({
    event_id: normalizeNullableString(event_id) || `evt_${Utils.newID(16)}`,
    type,
    run_id: invocation_context.run_id,
    parent_run_id: invocation_context.parent_run_id || null,
    principal_user_id: invocation_context.principal_user_id,
    caller_agent_id: invocation_context.caller_agent_id || null,
    callee_agent_id: invocation_context.callee_agent_id,
    delegation_depth: invocation_context.delegation_depth,
    payload: Object.freeze({ ...normalizePayload(payload) }),
    created_at: created_at || new Date().toISOString(),
  });
}

export { AGENT_EVENT_TYPES };

export default {
  AGENT_EVENT_TYPES,
  buildAgentEvent,
  isAgentEventType,
};
