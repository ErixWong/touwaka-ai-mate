/**
 * Tests for AgentRuntime root facade.
 *
 * Usage:
 *   node tests/test-agent-runtime.mjs
 */

import assert from 'node:assert/strict';
import { AgentRuntime } from '../lib/agent/agent-runtime.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

async function testRunRootWrapsExecutorResult() {
  const events = [];
  const runtime = new AgentRuntime({
    event_sink: event => events.push(event),
  });

  const result = await runtime.runRoot({
    run_id: 'root_run_runtime_1',
    principal_user_id: 'user_1',
    agent_id: 'expert_1',
    topic_id: 'topic_1',
    request_id: 'request_1',
    capability_scope: { tools: ['search'] },
  }, async ({ invocation_context }) => {
    assert.equal(invocation_context.run_id, 'root_run_runtime_1');
    assert.equal(invocation_context.principal_user_id, 'user_1');
    assert.equal(invocation_context.caller_agent_id, null);
    assert.equal(invocation_context.callee_agent_id, 'expert_1');

    return {
      fullContent: 'Done',
      fullReasoningContent: 'Thinking',
      tokenUsage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
      allToolCalls: [{ function: { name: 'search' } }],
      finalMessages: [{ role: 'assistant', content: 'Done' }],
      llmCallsCount: 1,
    };
  });

  assert.equal(result.fullContent, 'Done');
  assert.equal(result.agent_invocation_context.run_id, 'root_run_runtime_1');
  assert.deepEqual(events.map(event => event.type), [
    'agent_run_created',
    'agent_run_started',
    'agent_run_completed',
  ]);
  assert.equal(events[2].payload.llm_calls_count, 1);
  assert.equal(events[2].payload.tool_call_count, 1);
  assert.deepEqual(events[2].payload.token_usage, {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  });
}

async function testRunRootEmitsFailure() {
  const events = [];
  const runtime = new AgentRuntime({
    event_sink: event => events.push(event),
  });

  await assert.rejects(() => runtime.runRoot({
    run_id: 'root_run_runtime_2',
    principal_user_id: 'user_2',
    agent_id: 'expert_2',
  }, async () => {
    throw new Error('LLM failed');
  }), /LLM failed/);

  assert.deepEqual(events.map(event => event.type), [
    'agent_run_created',
    'agent_run_started',
    'agent_run_failed',
  ]);
  assert.equal(events[2].payload.error, 'LLM failed');
}

async function testRunRootEmitsCancelled() {
  const events = [];
  const runtime = new AgentRuntime({
    event_sink: event => events.push(event),
  });

  await assert.rejects(() => runtime.runRoot({
    run_id: 'root_run_runtime_3',
    principal_user_id: 'user_3',
    agent_id: 'expert_3',
  }, async () => {
    throw new Error('Request aborted by user');
  }), /Request aborted by user/);

  assert.equal(events[2].type, 'agent_run_cancelled');
}

async function testRunChildWrapsExecutorResult() {
  const events = [];
  const runtime = new AgentRuntime({
    event_sink: event => events.push(event),
  });
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_runtime_child_parent',
    principal_user_id: 'user_child',
    agent_id: 'expert_parent',
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_runtime_1',
    callee_agent_id: 'expert_child',
    capability_scope: { tools: ['search'] },
  });

  const result = await runtime.runChild({
    invocation_context: child,
  }, async ({ invocation_context }) => {
    assert.equal(invocation_context.parent_run_id, parent.run_id);
    assert.equal(invocation_context.principal_user_id, 'user_child');
    assert.equal(invocation_context.caller_agent_id, 'expert_parent');
    assert.equal(invocation_context.callee_agent_id, 'expert_child');
    assert.equal(invocation_context.delegation_depth, 1);

    return {
      fullContent: 'Child done',
      allToolCalls: [],
      llmCallsCount: 1,
    };
  });

  assert.equal(result.fullContent, 'Child done');
  assert.equal(result.agent_invocation_context, child);
  assert.deepEqual(events.map(event => event.type), [
    'agent_run_created',
    'agent_run_started',
    'agent_run_completed',
  ]);
  assert.equal(events[0].parent_run_id, parent.run_id);
  assert.equal(events[0].caller_agent_id, 'expert_parent');
  assert.equal(events[0].callee_agent_id, 'expert_child');
  assert.equal(events[2].payload.llm_calls_count, 1);
}

async function testRunChildRejectsRootInvocation() {
  const runtime = new AgentRuntime();
  const root = buildRootAgentInvocationContext({
    run_id: 'root_run_runtime_not_child',
    principal_user_id: 'user_root',
    agent_id: 'expert_root',
  });

  await assert.rejects(() => runtime.runChild({
    invocation_context: root,
  }, async () => ({ fullContent: 'should not run' })), /parent_run_id is required/);
}

async function main() {
  await testRunRootWrapsExecutorResult();
  await testRunRootEmitsFailure();
  await testRunRootEmitsCancelled();
  await testRunChildWrapsExecutorResult();
  await testRunChildRejectsRootInvocation();

  console.log('Agent runtime tests passed.');
}

main();
