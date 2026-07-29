/**
 * Tests for internal agent delegate control facade.
 *
 * Usage:
 *   node tests/test-agent-delegate-control-facade.mjs
 */

import assert from 'node:assert/strict';
import {
  AgentDelegateControlFacade,
  AGENT_DELEGATE_TOOL_NAMES,
  buildAgentDelegateControlToolDefinitions,
} from '../lib/agent/agent-delegate-control-facade.js';
import { AgentDelegationService } from '../lib/agent/agent-delegation-service.js';
import { InMemoryChildRunScheduler } from '../lib/agent/child-run-scheduler.js';
import { buildRootAgentInvocationContext } from '../lib/agent/agent-invocation-context.js';

function createParentInvocation() {
  return buildRootAgentInvocationContext({
    run_id: 'root_run_delegate_control_parent',
    principal_user_id: 'user_delegate_control',
    agent_id: 'expert_parent',
    topic_id: 'topic_delegate_control',
  });
}

function createDelegationService(events = []) {
  return new AgentDelegationService({
    definition_resolver: {
      async resolve({ source_type, agent_id }) {
        assert.equal(source_type, 'expert');
        assert.equal(agent_id, 'expert_child');
        return {
          agent_id: 'expert_child',
          source_type: 'expert',
          display_name: 'Child Expert',
          execution_policy: { mode: 'llm' },
          capability_declarations: {
            skills: [{ skill_id: 'skill_search', mark: 'search' }],
          },
          is_active: true,
        };
      },
    },
    event_sink: event => events.push(event),
  });
}

function createFacade({ execute, events = [] } = {}) {
  const scheduler = new InMemoryChildRunScheduler({
    create_child_executor: runOptions => ({
      async execute(delegation) {
        return execute
          ? execute(delegation, runOptions)
          : {
              fullContent: 'child result',
              allToolCalls: [],
              llmCallsCount: 1,
              agent_invocation_context: delegation.child_invocation,
            };
      },
    }),
  });

  return {
    scheduler,
    facade: new AgentDelegateControlFacade({
      delegation_service: createDelegationService(events),
      child_run_scheduler: scheduler,
    }),
  };
}

function createStartContext() {
  return {
    parent_invocation: createParentInvocation(),
    caller_scope: {
      tools: ['search', 'write_file'],
      skills: ['search'],
      can_use_skills: true,
    },
    principal_scope: {
      tools: ['search'],
      skills: ['search'],
      can_use_skills: true,
    },
    workspace_scope: {
      tools: ['search'],
      skills: ['search'],
      can_use_skills: true,
    },
    session: { userId: 'user_delegate_control' },
  };
}

function createStartParams(overrides = {}) {
  return {
    source_type: 'expert',
    agent_id: 'expert_child',
    task: 'Search project',
    input: { query: 'agent runtime' },
    expected_output: 'summary',
    requested_scope: { tools: ['search'] },
    ...overrides,
  };
}

async function testStartStatusAndResultFlow() {
  const events = [];
  const { facade, scheduler } = createFacade({ events });

  const started = await facade.start(createStartParams(), createStartContext());
  assert.equal(started.child_run_id, started.run.child_run_id);
  assert.equal(started.status, 'queued');
  assert.equal(started.run.parent_run_id, 'root_run_delegate_control_parent');

  const finalStatus = await scheduler.waitForCompletion(started.child_run_id);
  assert.equal(finalStatus.status, 'completed');
  assert.equal((await facade.status({ child_run_id: started.child_run_id })).status, 'completed');

  const result = await facade.result({ child_run_id: started.child_run_id });
  assert.equal(result.result.fullContent, 'child result');
  assert.equal(result.result.agent_invocation_context.run_id, started.child_run_id);
  assert.equal(events[0].type, 'delegation_created');
}

async function testHandleToolCallWrapsSuccessAndErrors() {
  const { facade, scheduler } = createFacade();

  const started = await facade.handleToolCall(
    AGENT_DELEGATE_TOOL_NAMES.START,
    createStartParams(),
    createStartContext(),
  );
  assert.equal(started.success, true);
  await scheduler.waitForCompletion(started.data.child_run_id);

  const status = await facade.handleToolCall(AGENT_DELEGATE_TOOL_NAMES.STATUS, {
    child_run_id: started.data.child_run_id,
  });
  assert.equal(status.success, true);
  assert.equal(status.data.status, 'completed');

  const result = await facade.handleToolCall(AGENT_DELEGATE_TOOL_NAMES.RESULT, {
    child_run_id: started.data.child_run_id,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.result.fullContent, 'child result');

  const unknown = await facade.handleToolCall('unknown_tool', {}, {});
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /Unknown agent delegate control tool/);
}

async function testCancelFlow() {
  let release;
  const entered = new Promise(resolve => {
    release = resolve;
  });
  let continueRun;
  const canContinue = new Promise(resolve => {
    continueRun = resolve;
  });
  const { facade, scheduler } = createFacade({
    execute: async (_delegation, runOptions) => {
      release();
      await canContinue;
      if (runOptions.shouldStop()) {
        throw new Error('Request aborted by user');
      }
      return { fullContent: 'late result', allToolCalls: [], llmCallsCount: 1 };
    },
  });

  const started = await facade.start(createStartParams(), createStartContext());
  await entered;
  assert.equal((await facade.status({ child_run_id: started.child_run_id })).status, 'running');

  const cancelling = await facade.cancel({ child_run_id: started.child_run_id });
  assert.equal(cancelling.cancel_requested, true);
  continueRun();

  const finalStatus = await scheduler.waitForCompletion(started.child_run_id);
  assert.equal(finalStatus.status, 'cancelled');
  assert.match(finalStatus.error, /Request aborted/);
}

function testBuildsUnregisteredToolDefinitions() {
  const definitions = buildAgentDelegateControlToolDefinitions();
  const names = definitions.map(tool => tool.function.name);

  assert.deepEqual(names, [
    AGENT_DELEGATE_TOOL_NAMES.START,
    AGENT_DELEGATE_TOOL_NAMES.STATUS,
    AGENT_DELEGATE_TOOL_NAMES.RESULT,
    AGENT_DELEGATE_TOOL_NAMES.CANCEL,
  ]);
  assert.deepEqual(definitions[0].function.parameters.required, ['source_type', 'agent_id', 'task']);
  assert.equal(definitions[0].function.parameters.properties.requested_scope.type, 'object');
  assert.deepEqual(definitions[1].function.parameters.required, ['child_run_id']);
}

async function testStartRejectsDeniedScope() {
  const { facade } = createFacade();

  await assert.rejects(() => facade.start(createStartParams({
    requested_scope: { tools: ['write_file'] },
  }), createStartContext()), /Requested capability denied/);
}

async function main() {
  await testStartStatusAndResultFlow();
  await testHandleToolCallWrapsSuccessAndErrors();
  await testCancelFlow();
  testBuildsUnregisteredToolDefinitions();
  await testStartRejectsDeniedScope();

  console.log('Agent delegate control facade tests passed.');
}

main();
