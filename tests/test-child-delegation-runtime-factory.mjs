/**
 * Tests for child delegation runtime factory.
 *
 * Usage:
 *   node tests/test-child-delegation-runtime-factory.mjs
 */

import assert from 'node:assert/strict';
import { AgentRuntime } from '../lib/agent/agent-runtime.js';
import { AgentDelegationService } from '../lib/agent/agent-delegation-service.js';
import { createExpertChildDelegationExecutor } from '../lib/agent/child-delegation-runtime-factory.js';
import { buildRootAgentInvocationContext } from '../lib/agent/agent-invocation-context.js';

function createTool(name) {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} tool`,
      parameters: { type: 'object', properties: {} },
    },
  };
}

function createExpertService(toolContextCalls) {
  const modelConfig = {
    model_name: 'child-model',
    provider_name: 'provider_1',
    base_url: 'https://example.test/v1',
    max_tokens: 4096,
    max_output_tokens: 1024,
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
    toolManager: {
      async getToolDefinitions(context) {
        toolContextCalls.push(context);
        return [
          createTool('search'),
          createTool('write_file'),
        ];
      },
    },
  };
}

function createDelegationService(events) {
  return new AgentDelegationService({
    definition_resolver: {
      async resolve({ source_type, agent_id }) {
        assert.equal(source_type, 'expert');
        assert.equal(agent_id, 'expert_child');
        return {
          agent_id: 'expert_child',
          source_type: 'expert',
          display_name: 'Child Expert',
          system_prompt: 'Use only delegated tools.',
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

async function testComposesDelegationExecutorRunnerAndScopedTools() {
  const events = [];
  const loopCalls = [];
  const toolContextCalls = [];
  const expertService = createExpertService(toolContextCalls);
  const session = { userId: 'user_factory' };
  const onDeltaEvents = [];
  const runtimeState = {};
  const parent_invocation = buildRootAgentInvocationContext({
    run_id: 'root_run_factory_parent',
    principal_user_id: 'user_factory',
    agent_id: 'expert_parent',
    topic_id: 'topic_factory',
    task_id: 'task_factory',
  });
  const service = createDelegationService(events);
  const executor = createExpertChildDelegationExecutor({
    agent_runtime: new AgentRuntime({
      event_sink: event => events.push(event),
    }),
    agent_loop: {
      async run(receivedExpertService, input) {
        loopCalls.push({ receivedExpertService, input });
        input.onDelta?.({ type: 'delta', content: 'child' });
        return {
          fullContent: 'child result',
          fullReasoningContent: '',
          tokenUsage: null,
          allToolCalls: [],
          finalMessages: input.currentMessages,
          llmCallsCount: 1,
        };
      },
    },
    get_expert_service: async expert_id => {
      assert.equal(expert_id, 'expert_child');
      return expertService;
    },
    run_options: {
      session,
      onDelta: event => onDeltaEvents.push(event),
      runtimeState,
    },
  });

  const result = await service.delegateAndExecute({
    parent_invocation,
    target: { source_type: 'expert', agent_id: 'expert_child' },
    task: 'Search the project',
    input: { query: 'agent runtime' },
    expected_output: 'summary',
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
    requested_scope: { tools: ['search'] },
  }, executor);

  assert.equal(result.status, 'accepted');
  assert.equal(result.execution_result.fullContent, 'child result');
  assert.equal(result.execution_result.agent_invocation_context, result.child_invocation);
  assert.deepEqual(result.effective_scope.tools, ['search']);
  assert.deepEqual(events.map(event => event.type), [
    'delegation_created',
    'agent_run_created',
    'agent_run_started',
    'agent_run_completed',
  ]);
  assert.equal(loopCalls.length, 1);
  assert.equal(loopCalls[0].receivedExpertService, expertService);
  assert.equal(loopCalls[0].input.user_id, 'user_factory');
  assert.equal(loopCalls[0].input.expert_id, 'expert_child');
  assert.equal(loopCalls[0].input.topic_id, 'topic_factory');
  assert.equal(loopCalls[0].input.task_id, 'task_factory');
  assert.equal(loopCalls[0].input.session, session);
  assert.equal(loopCalls[0].input.runtimeState, runtimeState);
  assert.deepEqual(loopCalls[0].input.tools.map(tool => tool.function.name), ['search']);
  assert.equal(loopCalls[0].input.llmPayload._debug.tools_count, 1);
  assert.match(loopCalls[0].input.currentMessages[0].content, /Child Expert/);
  assert.equal(JSON.parse(loopCalls[0].input.currentMessages[1].content).task, 'Search the project');
  assert.deepEqual(toolContextCalls, [{
    user_id: 'user_factory',
    userId: 'user_factory',
    expert_id: 'expert_child',
    expertId: 'expert_child',
    session,
  }]);
  assert.deepEqual(onDeltaEvents, [{ type: 'delta', content: 'child' }]);
}

async function testFactoryRequiresRuntimeDependencies() {
  assert.throws(() => createExpertChildDelegationExecutor({
    agent_runtime: new AgentRuntime(),
    agent_loop: { run: async () => ({}) },
  }), /get_expert_service is required/);
}

async function main() {
  await testComposesDelegationExecutorRunnerAndScopedTools();
  await testFactoryRequiresRuntimeDependencies();

  console.log('Child delegation runtime factory tests passed.');
}

main();
