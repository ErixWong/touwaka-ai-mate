/**
 * Tests for agent invocation and event contracts.
 *
 * Usage:
 *   node tests/test-agent-invocation-context.mjs
 */

import assert from 'node:assert/strict';
import {
  buildAgentInvocationContext,
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';
import {
  buildAgentEvent,
  isAgentEventType,
} from '../lib/agent/agent-event.js';

function testBuildRootInvocation() {
  const context = buildRootAgentInvocationContext({
    run_id: 'root_run_1',
    principal_user_id: 'user_1',
    agent_id: 'expert_1',
    topic_id: 'topic_1',
    task_id: 'task_1',
    request_id: 'request_1',
    workspace_scope: { workdir: 'D:/workspace/task' },
    capability_scope: { tools: ['document_search'] },
  });

  assert.deepEqual(context, {
    run_id: 'root_run_1',
    parent_run_id: null,
    principal_user_id: 'user_1',
    caller_agent_id: null,
    callee_agent_id: 'expert_1',
    delegation_depth: 0,
    delegation_chain: ['expert_1'],
    topic_id: 'topic_1',
    task_id: 'task_1',
    request_id: 'request_1',
    workspace_scope: { workdir: 'D:/workspace/task' },
    capability_scope: { tools: ['document_search'] },
    invocation_mode: 'llm',
    source: 'root_chat',
  });
}

function testDeriveChildInvocation() {
  const root = buildRootAgentInvocationContext({
    run_id: 'root_run_2',
    principal_user_id: 'user_2',
    agent_id: 'expert_parent',
    topic_id: 'topic_2',
    workspace_scope: { workdir: 'D:/workspace/task' },
    capability_scope: { tools: ['document_search'] },
  });

  const child = deriveChildAgentInvocationContext(root, {
    run_id: 'child_run_1',
    callee_agent_id: 'expert_child',
    request_id: 'request_child',
  });

  assert.equal(child.parent_run_id, 'root_run_2');
  assert.equal(child.principal_user_id, 'user_2');
  assert.equal(child.caller_agent_id, 'expert_parent');
  assert.equal(child.callee_agent_id, 'expert_child');
  assert.equal(child.delegation_depth, 1);
  assert.deepEqual(child.delegation_chain, ['expert_parent', 'expert_child']);
  assert.deepEqual(child.workspace_scope, { workdir: 'D:/workspace/task' });
  assert.deepEqual(child.capability_scope, { tools: ['document_search'] });
}

function testChildCannotOverridePrincipal() {
  const root = buildRootAgentInvocationContext({
    run_id: 'root_run_3',
    principal_user_id: 'real_user',
    agent_id: 'expert_parent',
  });

  const child = deriveChildAgentInvocationContext(root, {
    callee_agent_id: 'expert_child',
    principal_user_id: 'spoofed_user',
  });

  assert.equal(child.principal_user_id, 'real_user');
}

function testRejectsDepthOverflow() {
  const root = buildRootAgentInvocationContext({
    run_id: 'root_run_4',
    principal_user_id: 'user_4',
    agent_id: 'expert_parent',
  });
  const first = deriveChildAgentInvocationContext(root, {
    callee_agent_id: 'expert_child_1',
    max_delegation_depth: 1,
  });

  assert.throws(() => deriveChildAgentInvocationContext(first, {
    callee_agent_id: 'expert_child_2',
    max_delegation_depth: 1,
  }), /delegation_depth exceeds max_delegation_depth/);
}

function testRejectsCycles() {
  const root = buildRootAgentInvocationContext({
    run_id: 'root_run_5',
    principal_user_id: 'user_5',
    agent_id: 'expert_parent',
  });

  assert.throws(() => deriveChildAgentInvocationContext(root, {
    callee_agent_id: 'expert_parent',
  }), /delegation cycle detected/);
}

function testRejectsMissingPrincipal() {
  assert.throws(() => buildAgentInvocationContext({
    callee_agent_id: 'expert_1',
  }), /principal_user_id is required/);
}

function testBuildAgentEvent() {
  const context = buildRootAgentInvocationContext({
    run_id: 'root_run_6',
    principal_user_id: 'user_6',
    agent_id: 'expert_6',
  });

  const event = buildAgentEvent({
    event_id: 'evt_1',
    type: 'agent_run_started',
    invocation_context: context,
    payload: { reason: 'test' },
    created_at: '2026-07-28T00:00:00.000Z',
  });

  assert.equal(isAgentEventType('agent_run_started'), true);
  assert.equal(isAgentEventType('unknown'), false);
  assert.deepEqual(event, {
    event_id: 'evt_1',
    type: 'agent_run_started',
    run_id: 'root_run_6',
    parent_run_id: null,
    principal_user_id: 'user_6',
    caller_agent_id: null,
    callee_agent_id: 'expert_6',
    delegation_depth: 0,
    payload: { reason: 'test' },
    created_at: '2026-07-28T00:00:00.000Z',
  });
}

function main() {
  testBuildRootInvocation();
  testDeriveChildInvocation();
  testChildCannotOverridePrincipal();
  testRejectsDepthOverflow();
  testRejectsCycles();
  testRejectsMissingPrincipal();
  testBuildAgentEvent();

  console.log('Agent invocation context tests passed.');
}

main();
