/**
 * Agent invocation context contract.
 *
 * This is the runtime envelope shared by root chat turns and delegated child
 * agent runs. It separates the human authorization principal from the agent
 * caller/callee chain and from LLM protocol roles.
 */

import Utils from '../utils.js';

const DEFAULT_INVOCATION_MODE = 'llm';
const DEFAULT_SOURCE = 'agent_runtime';
const DEFAULT_MAX_DELEGATION_DEPTH = 2;

function createRunId(prefix = 'run') {
  return `${prefix}_${Utils.newID(16)}`;
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function assertRequiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
}

function normalizeNullableString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeDepth(value) {
  const depth = Number(value ?? 0);
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error('delegation_depth must be a non-negative integer');
  }
  return depth;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function normalizeDelegationChain(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim());
}

function assertDepthAllowed(depth, maxDepth) {
  const limit = Number(maxDepth ?? DEFAULT_MAX_DELEGATION_DEPTH);
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error('max_delegation_depth must be a non-negative integer');
  }
  if (depth > limit) {
    throw new Error(`delegation_depth exceeds max_delegation_depth (${limit})`);
  }
}

function freezeContext(context) {
  return Object.freeze({
    ...context,
    workspace_scope: Object.freeze({ ...context.workspace_scope }),
    capability_scope: Object.freeze({ ...context.capability_scope }),
    delegation_chain: Object.freeze([...context.delegation_chain]),
  });
}

export function buildAgentInvocationContext(input = {}) {
  assertObject(input, 'input');

  const principal_user_id = normalizeNullableString(input.principal_user_id);
  const callee_agent_id = normalizeNullableString(input.callee_agent_id);
  const caller_agent_id = normalizeNullableString(input.caller_agent_id);
  const run_id = normalizeNullableString(input.run_id) || createRunId();
  const parent_run_id = normalizeNullableString(input.parent_run_id);
  const delegation_depth = normalizeDepth(input.delegation_depth);

  assertRequiredString(principal_user_id, 'principal_user_id');
  assertRequiredString(callee_agent_id, 'callee_agent_id');
  assertDepthAllowed(delegation_depth, input.max_delegation_depth);

  return freezeContext({
    run_id,
    parent_run_id,
    principal_user_id,
    caller_agent_id,
    callee_agent_id,
    delegation_depth,
    delegation_chain: normalizeDelegationChain(input.delegation_chain),
    topic_id: normalizeNullableString(input.topic_id),
    task_id: normalizeNullableString(input.task_id),
    request_id: normalizeNullableString(input.request_id),
    workspace_scope: normalizeObject(input.workspace_scope),
    capability_scope: normalizeObject(input.capability_scope),
    invocation_mode: normalizeNullableString(input.invocation_mode) || DEFAULT_INVOCATION_MODE,
    source: normalizeNullableString(input.source) || DEFAULT_SOURCE,
  });
}

export function buildRootAgentInvocationContext(input = {}) {
  assertObject(input, 'input');

  const agent_id = normalizeNullableString(input.agent_id || input.callee_agent_id);

  return buildAgentInvocationContext({
    ...input,
    run_id: input.run_id || createRunId('root_run'),
    parent_run_id: null,
    principal_user_id: input.principal_user_id,
    caller_agent_id: null,
    callee_agent_id: agent_id,
    delegation_depth: 0,
    delegation_chain: agent_id ? [agent_id] : [],
    source: input.source || 'root_chat',
  });
}

export function deriveChildAgentInvocationContext(parent, input = {}) {
  assertObject(parent, 'parent');
  assertObject(input, 'input');
  assertRequiredString(parent.run_id, 'parent.run_id');
  assertRequiredString(parent.principal_user_id, 'parent.principal_user_id');
  assertRequiredString(parent.callee_agent_id, 'parent.callee_agent_id');

  const callee_agent_id = normalizeNullableString(input.callee_agent_id || input.agent_id);
  assertRequiredString(callee_agent_id, 'callee_agent_id');

  const parentChain = normalizeDelegationChain(parent.delegation_chain);
  const currentChain = parentChain.length > 0
    ? parentChain
    : [parent.callee_agent_id];
  if (currentChain.includes(callee_agent_id)) {
    throw new Error(`delegation cycle detected for agent: ${callee_agent_id}`);
  }

  return buildAgentInvocationContext({
    ...input,
    run_id: input.run_id || createRunId('child_run'),
    parent_run_id: parent.run_id,
    principal_user_id: parent.principal_user_id,
    caller_agent_id: parent.callee_agent_id,
    callee_agent_id,
    delegation_depth: normalizeDepth(parent.delegation_depth) + 1,
    delegation_chain: [...currentChain, callee_agent_id],
    topic_id: input.topic_id ?? parent.topic_id,
    task_id: input.task_id ?? parent.task_id,
    request_id: input.request_id,
    workspace_scope: input.workspace_scope ?? parent.workspace_scope,
    capability_scope: input.capability_scope ?? parent.capability_scope,
    invocation_mode: input.invocation_mode || DEFAULT_INVOCATION_MODE,
    source: input.source || 'agent_delegate',
  });
}

export default {
  buildAgentInvocationContext,
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
};
