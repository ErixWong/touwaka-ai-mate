/**
 * Tests for child run scheduler.
 *
 * Usage:
 *   node tests/test-child-run-scheduler.mjs
 */

import assert from 'node:assert/strict';
import { InMemoryChildRunScheduler } from '../lib/agent/child-run-scheduler.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createDelegation(runId = 'child_run_scheduler_1') {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_scheduler_parent',
    principal_user_id: 'user_scheduler',
    agent_id: 'expert_parent',
    topic_id: 'topic_scheduler',
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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function waitOneTurn() {
  await Promise.resolve();
}

async function testStartsAndCompletesChildRun() {
  const executorCalls = [];
  const deltas = [];
  const scheduler = new InMemoryChildRunScheduler({
    create_child_executor: runOptions => ({
      async execute(delegation) {
        executorCalls.push({ delegation, runOptions });
        runOptions.onDelta({ type: 'delta', content: 'hello' });
        return {
          fullContent: 'child result',
          llmCallsCount: 1,
          allToolCalls: [],
        };
      },
    }),
  });
  const delegation = createDelegation();
  const session = { userId: 'user_scheduler' };

  const queued = scheduler.start(delegation, {
    session,
    onDelta: event => deltas.push(event),
  });
  assert.equal(queued.child_run_id, 'child_run_scheduler_1');
  assert.equal(queued.parent_run_id, 'root_run_scheduler_parent');
  assert.equal(queued.status, 'queued');
  assert.equal(queued.has_result, false);

  const finalStatus = await scheduler.waitForCompletion('child_run_scheduler_1');
  assert.equal(finalStatus.status, 'completed');
  assert.equal(finalStatus.has_result, true);
  assert.equal(finalStatus.event_count, 1);
  assert.equal(executorCalls.length, 1);
  assert.equal(executorCalls[0].delegation, delegation);
  assert.equal(executorCalls[0].runOptions.session, session);
  assert.equal(executorCalls[0].runOptions.shouldStop(), false);
  assert.deepEqual(deltas, [{ type: 'delta', content: 'hello' }]);

  const result = scheduler.getResult('child_run_scheduler_1');
  assert.equal(result.result.fullContent, 'child result');
  assert.deepEqual(result.events, [{ type: 'delta', content: 'hello' }]);
}

async function testCancelsRunningChildRun() {
  const entered = createDeferred();
  const release = createDeferred();
  let shouldStopFromRun = null;
  const scheduler = new InMemoryChildRunScheduler({
    create_child_executor: runOptions => ({
      async execute() {
        shouldStopFromRun = runOptions.shouldStop;
        entered.resolve();
        await release.promise;
        if (runOptions.shouldStop()) {
          throw new Error('Request aborted by user');
        }
        return { fullContent: 'should not complete', allToolCalls: [], llmCallsCount: 1 };
      },
    }),
  });

  scheduler.start(createDelegation('child_run_scheduler_cancel'));
  await entered.promise;
  assert.equal(scheduler.getStatus('child_run_scheduler_cancel').status, 'running');
  assert.equal(shouldStopFromRun(), false);

  const cancelling = scheduler.cancel('child_run_scheduler_cancel');
  assert.equal(cancelling.cancel_requested, true);
  assert.equal(cancelling.status, 'running');
  assert.equal(shouldStopFromRun(), true);

  release.resolve();
  const finalStatus = await scheduler.waitForCompletion('child_run_scheduler_cancel');
  assert.equal(finalStatus.status, 'cancelled');
  assert.equal(finalStatus.error, 'Request aborted by user');
  assert.throws(() => scheduler.getResult('child_run_scheduler_cancel'), /not completed: cancelled/);
}

async function testCapturesFailedChildRun() {
  const scheduler = new InMemoryChildRunScheduler({
    create_child_executor: () => ({
      async execute() {
        throw new Error('child exploded');
      },
    }),
  });

  scheduler.start(createDelegation('child_run_scheduler_failed'));
  const finalStatus = await scheduler.waitForCompletion('child_run_scheduler_failed');

  assert.equal(finalStatus.status, 'failed');
  assert.equal(finalStatus.error, 'child exploded');
  assert.equal(finalStatus.has_result, false);
}

async function testRejectsDuplicateRunIdAndUnknownRun() {
  const scheduler = new InMemoryChildRunScheduler({
    create_child_executor: () => ({
      async execute() {
        return { fullContent: 'ok', allToolCalls: [], llmCallsCount: 1 };
      },
    }),
  });
  const delegation = createDelegation('child_run_scheduler_duplicate');

  scheduler.start(delegation);
  assert.throws(() => scheduler.start(delegation), /already scheduled/);
  assert.throws(() => scheduler.getStatus('missing_child_run'), /not found/);
  await scheduler.waitForCompletion('child_run_scheduler_duplicate');
}

async function testCannotReadResultBeforeCompletion() {
  const release = createDeferred();
  const scheduler = new InMemoryChildRunScheduler({
    create_child_executor: () => ({
      async execute() {
        await release.promise;
        return { fullContent: 'ok', allToolCalls: [], llmCallsCount: 1 };
      },
    }),
  });

  scheduler.start(createDelegation('child_run_scheduler_pending'));
  await waitOneTurn();
  assert.throws(() => scheduler.getResult('child_run_scheduler_pending'), /not completed/);
  release.resolve();
  await scheduler.waitForCompletion('child_run_scheduler_pending');
  assert.equal(scheduler.getResult('child_run_scheduler_pending').result.fullContent, 'ok');
}

async function main() {
  await testStartsAndCompletesChildRun();
  await testCancelsRunningChildRun();
  await testCapturesFailedChildRun();
  await testRejectsDuplicateRunIdAndUnknownRun();
  await testCannotReadResultBeforeCompletion();

  console.log('Child run scheduler tests passed.');
}

main();
