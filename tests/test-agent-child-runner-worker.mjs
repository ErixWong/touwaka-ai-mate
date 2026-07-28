/**
 * Tests for resident child Agent runner worker.
 *
 * Usage:
 *   node tests/test-agent-child-runner-worker.mjs
 */

import assert from 'node:assert/strict';
import { AgentChildRunnerWorker } from '../lib/agent/agent-child-runner-worker.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createDelegation(runId = 'child_run_worker_1') {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_worker_parent',
    principal_user_id: 'user_worker',
    agent_id: 'expert_parent',
    topic_id: 'topic_worker',
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: runId,
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
      display_name: 'Child Expert',
      execution_policy: { mode: 'llm' },
    },
    task: 'Search project',
    input: { query: 'agent runtime' },
    expected_output: 'summary',
    requested_scope: { tools: ['search'] },
    effective_scope: { tools: ['search'] },
  });
}

function nextTick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function testStartCompletesAndReturnsResult() {
  const worker = new AgentChildRunnerWorker({
    async execute_child_run(input) {
      assert.equal(input.delegation.child_invocation.run_id, 'child_run_worker_1');
      assert.deepEqual(input.session, { userId: 'user_worker' });
      input.onDelta({ type: 'delta', content: 'done' });
      return { fullContent: 'child result' };
    },
  });

  const started = worker.handleAction({
    action: 'start',
    delegation: createDelegation(),
    options: { session: { userId: 'user_worker' } },
  });
  assert.equal(started.status, 'queued');
  assert.equal(started.child_run_id, 'child_run_worker_1');

  const finalStatus = await worker.waitForCompletion(started.child_run_id);
  assert.equal(finalStatus.status, 'completed');

  const result = worker.handleAction({
    action: 'result',
    child_run_id: started.child_run_id,
  });
  assert.equal(result.result.fullContent, 'child result');
  assert.deepEqual(result.events, [{ type: 'delta', content: 'done' }]);

  const events = worker.handleAction({
    action: 'events',
    child_run_id: started.child_run_id,
  });
  assert.deepEqual(events, [{ type: 'delta', content: 'done' }]);
}

async function testCancelRunningRun() {
  let releaseRun;
  const enteredRun = new Promise(resolve => {
    releaseRun = resolve;
  });
  const worker = new AgentChildRunnerWorker({
    async execute_child_run(input) {
      enteredRun.then(() => {});
      await new Promise(resolve => {
        releaseRun = resolve;
      });
      if (input.shouldStop()) {
        throw new Error('Request aborted by user');
      }
      return { fullContent: 'unexpected' };
    },
  });

  const started = worker.start(createDelegation('child_run_worker_cancel'));
  await nextTick();
  assert.equal(worker.getStatus(started.child_run_id).status, 'running');

  const cancelled = worker.cancel(started.child_run_id);
  assert.equal(cancelled.cancel_requested, true);
  releaseRun();

  const finalStatus = await worker.waitForCompletion(started.child_run_id);
  assert.equal(finalStatus.status, 'cancelled');
  assert.equal(finalStatus.error, 'Request aborted by user');
}

async function testFailedRunStatus() {
  const worker = new AgentChildRunnerWorker({
    async execute_child_run() {
      throw new Error('child exploded');
    },
  });

  const started = worker.start(createDelegation('child_run_worker_failed'));
  const finalStatus = await worker.waitForCompletion(started.child_run_id);

  assert.equal(finalStatus.status, 'failed');
  assert.equal(finalStatus.error, 'child exploded');
  assert.throws(() => worker.getResult(started.child_run_id), /child run is not completed: failed/);
}

function testRequiresExecutor() {
  assert.throws(() => new AgentChildRunnerWorker(), /execute_child_run is required/);
}

async function main() {
  await testStartCompletesAndReturnsResult();
  await testCancelRunningRun();
  await testFailedRunStatus();
  testRequiresExecutor();

  console.log('Agent child runner worker tests passed.');
}

main();
