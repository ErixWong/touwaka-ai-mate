/**
 * Tests for resident child run scheduler adapter.
 *
 * Usage:
 *   node tests/test-resident-child-run-scheduler.mjs
 */

import assert from 'node:assert/strict';
import { ResidentChildRunScheduler } from '../lib/agent/resident-child-run-scheduler.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createDelegation() {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_resident_parent',
    principal_user_id: 'user_resident',
    agent_id: 'expert_parent',
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_resident_1',
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

function createResidentSkillManager(handler) {
  const calls = [];

  return {
    calls,
    async invokeByName(skillId, toolName, params, userContext, timeoutMs) {
      calls.push({ skillId, toolName, params, userContext, timeoutMs });
      return await handler(params);
    },
  };
}

async function testForwardsSchedulerActionsToResidentWorker() {
  const resident = createResidentSkillManager(async params => ({
    child_run_id: params.child_run_id || params.delegation.child_invocation.run_id,
    status: params.action === 'cancel' ? 'cancelled' : 'running',
  }));
  const scheduler = new ResidentChildRunScheduler({
    resident_skill_manager: resident,
    skill_id: 'agent-child-runner',
    tool_name: 'invoke',
    timeout_ms: 3210,
  });
  const session = { userId: 'user_resident' };

  const started = await scheduler.start(createDelegation(), { session });
  const status = await scheduler.getStatus(started.child_run_id);
  const cancelled = await scheduler.cancel(started.child_run_id);

  assert.equal(started.child_run_id, 'child_run_resident_1');
  assert.equal(status.status, 'running');
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(resident.calls.map(call => call.params.action), ['start', 'status', 'cancel']);
  assert.equal(resident.calls[0].skillId, 'agent-child-runner');
  assert.equal(resident.calls[0].toolName, 'invoke');
  assert.equal(resident.calls[0].params.delegation.child_invocation.run_id, 'child_run_resident_1');
  assert.deepEqual(resident.calls[0].params.options, { session });
  assert.deepEqual(resident.calls[0].userContext, { session });
  assert.equal(resident.calls[0].timeoutMs, 3210);
}

async function testReadsResultAndEvents() {
  const resident = createResidentSkillManager(async params => {
    if (params.action === 'result') {
      return {
        child_run_id: params.child_run_id,
        status: 'completed',
        result: { fullContent: 'done' },
      };
    }
    if (params.action === 'events') {
      return [{ type: 'delta', content: 'done' }];
    }
    return { child_run_id: params.child_run_id, status: 'completed' };
  });
  const scheduler = new ResidentChildRunScheduler({
    resident_skill_manager: resident,
  });

  const result = await scheduler.getResult('child_run_resident_result');
  const events = await scheduler.getEvents('child_run_resident_result');

  assert.equal(result.result.fullContent, 'done');
  assert.deepEqual(events, [{ type: 'delta', content: 'done' }]);
  assert.deepEqual(resident.calls.map(call => call.params.action), ['result', 'events']);
}

async function testWaitForCompletionPollsResidentStatus() {
  let statusCalls = 0;
  const resident = createResidentSkillManager(async params => {
    assert.equal(params.action, 'status');
    statusCalls += 1;
    return {
      child_run_id: params.child_run_id,
      status: statusCalls < 2 ? 'running' : 'completed',
    };
  });
  const scheduler = new ResidentChildRunScheduler({
    resident_skill_manager: resident,
    poll_interval_ms: 0,
    wait_timeout_ms: 1000,
  });

  const finalStatus = await scheduler.waitForCompletion('child_run_resident_wait');

  assert.equal(finalStatus.status, 'completed');
  assert.equal(statusCalls, 2);
}

function testRejectsMissingResidentManager() {
  assert.throws(() => new ResidentChildRunScheduler(), /resident_skill_manager\.invokeByName is required/);
}

async function main() {
  await testForwardsSchedulerActionsToResidentWorker();
  await testReadsResultAndEvents();
  await testWaitForCompletionPollsResidentStatus();
  testRejectsMissingResidentManager();

  console.log('Resident child run scheduler tests passed.');
}

main();
