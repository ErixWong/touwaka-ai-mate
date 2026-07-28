/**
 * Tests for ChildAgentExecutor.
 *
 * Usage:
 *   node tests/test-child-agent-executor.mjs
 */

import assert from 'node:assert/strict';
import { AgentRuntime } from '../lib/agent/agent-runtime.js';
import { ChildAgentExecutor } from '../lib/agent/child-agent-executor.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createDelegation() {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_executor_parent',
    principal_user_id: 'user_1',
    agent_id: 'expert_parent',
    topic_id: 'topic_1',
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_executor_1',
    callee_agent_id: 'expert_child',
    capability_scope: { tools: ['search'] },
  });

  return Object.freeze({
    status: 'accepted',
    parent_invocation: parent,
    child_invocation: child,
    callee_definition: {
      agent_id: 'expert_child',
      source_type: 'expert',
      display_name: 'Child',
      execution_policy: { mode: 'llm' },
    },
    task: 'Search project',
    input: { query: 'agent' },
    expected_output: 'summary',
    requested_scope: { tools: ['search'] },
    effective_scope: { tools: ['search'] },
  });
}

async function testExecuteRunsChildThroughRuntime() {
  const events = [];
  const delegation = createDelegation();
  const executorInputs = [];
  const executor = new ChildAgentExecutor({
    agent_runtime: new AgentRuntime({
      event_sink: event => events.push(event),
    }),
    run_child: async input => {
      executorInputs.push(input);
      return {
        fullContent: 'Child result',
        llmCallsCount: 1,
        allToolCalls: [],
      };
    },
  });

  const result = await executor.execute(delegation);

  assert.equal(result.fullContent, 'Child result');
  assert.equal(result.agent_invocation_context, delegation.child_invocation);
  assert.equal(executorInputs.length, 1);
  assert.equal(executorInputs[0].invocation_context, delegation.child_invocation);
  assert.equal(executorInputs[0].principal_user_id, undefined);
  assert.equal(executorInputs[0].child_invocation.principal_user_id, 'user_1');
  assert.equal(executorInputs[0].child_invocation.caller_agent_id, 'expert_parent');
  assert.deepEqual(executorInputs[0].effective_scope, { tools: ['search'] });
  assert.deepEqual(events.map(event => event.type), [
    'agent_run_created',
    'agent_run_started',
    'agent_run_completed',
  ]);
  assert.equal(events[0].parent_run_id, delegation.parent_invocation.run_id);
  assert.equal(events[0].caller_agent_id, 'expert_parent');
  assert.equal(events[0].callee_agent_id, 'expert_child');
}

async function testExecutePropagatesFailureAsRuntimeEvent() {
  const events = [];
  const executor = new ChildAgentExecutor({
    agent_runtime: new AgentRuntime({
      event_sink: event => events.push(event),
    }),
    run_child: async () => {
      throw new Error('child failed');
    },
  });

  await assert.rejects(() => executor.execute(createDelegation()), /child failed/);
  assert.equal(events.at(-1).type, 'agent_run_failed');
  assert.equal(events.at(-1).payload.error, 'child failed');
}

function testRejectsMissingRunChild() {
  assert.throws(() => new ChildAgentExecutor({
    agent_runtime: new AgentRuntime(),
  }), /run_child is required/);
}

async function main() {
  await testExecuteRunsChildThroughRuntime();
  await testExecutePropagatesFailureAsRuntimeEvent();
  testRejectsMissingRunChild();

  console.log('Child agent executor tests passed.');
}

main();
