/**
 * Tests for ExpertChildAgentRunner.
 *
 * Usage:
 *   node tests/test-expert-child-agent-runner.mjs
 */

import assert from 'node:assert/strict';
import { ExpertChildAgentRunner } from '../lib/agent/expert-child-agent-runner.js';
import { buildChildAgentRunProjection } from '../lib/agent/child-run-projection.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createDelegation(overrides = {}) {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_expert_runner_parent',
    principal_user_id: 'user_expert_runner',
    agent_id: 'expert_parent',
    topic_id: 'topic_1',
    task_id: 'task_1',
    request_id: 'request_parent',
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_expert_runner_1',
    callee_agent_id: 'expert_child',
    capability_scope: { tools: ['search'] },
  });

  return {
    status: 'accepted',
    parent_invocation: parent,
    child_invocation: child,
    callee_definition: {
      agent_id: 'expert_child',
      source_type: 'expert',
      display_name: 'Research Child',
      system_prompt: 'Be precise.',
      execution_policy: { mode: 'llm' },
    },
    task: 'Search project',
    input: { query: 'agent runtime' },
    expected_output: 'summary',
    requested_scope: { tools: ['search', 'write_file'] },
    effective_scope: { tools: ['search'] },
    ...overrides,
  };
}

function createExpertService() {
  const modelConfig = {
    model_name: 'child-model',
    provider_name: 'provider_1',
    base_url: 'https://example.test/v1',
    max_tokens: 4096,
    max_output_tokens: 2048,
  };

  return {
    getDefaultModelConfig() {
      return modelConfig;
    },
    getThinkingConfig(inputModelConfig) {
      return {
        thinking: false,
        reasoning: null,
        reasoning_effort: null,
        enable_thinking: false,
        chat_template_kwargs: null,
        model_name_seen: inputModelConfig.model_name,
      };
    },
  };
}

async function testMapsProjectionToAgentLoopInput() {
  const delegation = createDelegation();
  const projection = buildChildAgentRunProjection(delegation);
  const expertService = createExpertService();
  const loopCalls = [];
  const runner = new ExpertChildAgentRunner({
    agent_loop: {
      async run(service, input) {
        loopCalls.push({ service, input });
        return {
          fullContent: 'child result',
          llmCallsCount: 1,
          allToolCalls: [],
        };
      },
    },
    get_expert_service: async expert_id => {
      assert.equal(expert_id, 'expert_child');
      return expertService;
    },
  });
  const session = { userId: 'user_expert_runner' };
  const deltas = [];
  const onDelta = event => deltas.push(event);
  const shouldStop = () => false;
  const runtimeState = {};

  const result = await runner.run({
    delegation,
    invocation_context: delegation.child_invocation,
    projection,
    session,
    onDelta,
    shouldStop,
    runtimeState,
  });

  assert.equal(result.fullContent, 'child result');
  assert.equal(loopCalls.length, 1);
  assert.equal(loopCalls[0].service, expertService);
  assert.deepEqual(loopCalls[0].input.currentMessages, projection.messages);
  assert.deepEqual(loopCalls[0].input.llmPayload.messages, projection.messages);
  assert.equal(loopCalls[0].input.llmPayload.model, 'child-model');
  assert.equal(loopCalls[0].input.llmPayload._debug.tools_count, 0);
  assert.equal(loopCalls[0].input.modelConfig.model_name, 'child-model');
  assert.equal(loopCalls[0].input.thinkingConfig.model_name_seen, 'child-model');
  assert.deepEqual(loopCalls[0].input.tools, []);
  assert.equal(loopCalls[0].input.user_id, 'user_expert_runner');
  assert.equal(loopCalls[0].input.expert_id, 'expert_child');
  assert.equal(loopCalls[0].input.topic_id, 'topic_1');
  assert.equal(loopCalls[0].input.task_id, 'task_1');
  assert.equal(loopCalls[0].input.request_id, 'child_run_expert_runner_1');
  assert.equal(loopCalls[0].input.session, session);
  assert.equal(loopCalls[0].input.onDelta, onDelta);
  assert.equal(loopCalls[0].input.shouldStop, shouldStop);
  assert.equal(loopCalls[0].input.runtimeState, runtimeState);
  assert.equal(loopCalls[0].input.agent_invocation_context, delegation.child_invocation);
}

async function testUsesScopedToolsWithEffectiveScope() {
  const delegation = createDelegation({
    effective_scope: { tools: ['search', 'read_file'] },
  });
  const projection = buildChildAgentRunProjection(delegation);
  const expertService = createExpertService();
  const tool = { type: 'function', function: { name: 'search' } };
  const scopedToolCalls = [];
  const loopCalls = [];
  const runner = new ExpertChildAgentRunner({
    agent_loop: {
      async run(service, input) {
        loopCalls.push({ service, input });
        return { fullContent: 'ok', allToolCalls: [], llmCallsCount: 1 };
      },
    },
    get_expert_service: async () => expertService,
    get_scoped_tools: async input => {
      scopedToolCalls.push(input);
      return [tool];
    },
  });

  await runner.run({
    delegation,
    invocation_context: delegation.child_invocation,
    projection,
  });

  assert.equal(scopedToolCalls.length, 1);
  assert.equal(scopedToolCalls[0].expert_service, expertService);
  assert.equal(scopedToolCalls[0].delegation, delegation);
  assert.equal(scopedToolCalls[0].invocation_context, delegation.child_invocation);
  assert.deepEqual(scopedToolCalls[0].effective_scope, { tools: ['search', 'read_file'] });
  assert.deepEqual(loopCalls[0].input.tools, [tool]);
  assert.equal(loopCalls[0].input.llmPayload._debug.tools_count, 1);
}

async function testRejectsNonExpertCalleeDefinition() {
  const delegation = createDelegation({
    callee_definition: {
      agent_id: 'assistant_child',
      source_type: 'assistant',
    },
  });
  const runner = new ExpertChildAgentRunner({
    agent_loop: { run: async () => ({}) },
    get_expert_service: async () => createExpertService(),
  });

  await assert.rejects(() => runner.run({
    delegation,
    invocation_context: delegation.child_invocation,
    projection: {
      messages: [{ role: 'user', content: 'hello' }],
    },
  }), /only supports expert/);
}

async function testDefaultsToNoTools() {
  const delegation = createDelegation();
  const projection = buildChildAgentRunProjection(delegation);
  const loopCalls = [];
  const runner = new ExpertChildAgentRunner({
    agent_loop: {
      async run(_service, input) {
        loopCalls.push(input);
        return { fullContent: 'ok', allToolCalls: [], llmCallsCount: 1 };
      },
    },
    get_expert_service: async () => createExpertService(),
  });

  await runner.run({
    delegation,
    invocation_context: delegation.child_invocation,
    projection,
  });

  assert.deepEqual(loopCalls[0].tools, []);
  assert.equal(loopCalls[0].llmPayload._debug.tools_count, 0);
}

async function main() {
  await testMapsProjectionToAgentLoopInput();
  await testUsesScopedToolsWithEffectiveScope();
  await testRejectsNonExpertCalleeDefinition();
  await testDefaultsToNoTools();

  console.log('Expert child agent runner tests passed.');
}

main();
