/**
 * Tests for in-memory agent delegate control runtime.
 *
 * Usage:
 *   node tests/test-agent-delegate-control-runtime.mjs
 */

import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { AgentRuntime } from '../lib/agent/agent-runtime.js';
import {
  AGENT_DELEGATE_TOOL_NAMES,
} from '../lib/agent/agent-delegate-control-facade.js';
import {
  createInMemoryAgentDelegateControlRuntime,
  createResidentAgentDelegateControlRuntime,
} from '../lib/agent/agent-delegate-control-runtime.js';
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

const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function createParentInvocation(workspaceScope = {}) {
  return buildRootAgentInvocationContext({
    run_id: 'root_run_control_runtime_parent',
    principal_user_id: 'user_control_runtime',
    agent_id: 'expert_parent',
    topic_id: 'topic_control_runtime',
    task_id: 'task_control_runtime',
    workspace_scope: workspaceScope,
  });
}

function createStartContext({ workspaceScope = {} } = {}) {
  return {
    parent_invocation: createParentInvocation(workspaceScope),
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
      ...workspaceScope,
    },
    session: { userId: 'user_control_runtime' },
  };
}

async function testRuntimeStartsAndCompletesChildRunEndToEnd() {
  const events = [];
  const loopCalls = [];
  const toolContextCalls = [];
  const expertService = createExpertService(toolContextCalls);
  const runtime = createInMemoryAgentDelegateControlRuntime({
    definition_resolver: {
      async resolve({ source_type, agent_id }) {
        assert.equal(source_type, 'expert');
        assert.equal(agent_id, 'expert_child');
        return {
          agent_id: 'expert_child',
          source_type: 'expert',
          display_name: 'Research Child',
          system_prompt: 'Stay inside the delegated task.',
          execution_policy: { mode: 'llm' },
          capability_declarations: {
            skills: [{ skill_id: 'skill_search', mark: 'search' }],
          },
          is_active: true,
        };
      },
    },
    agent_runtime: new AgentRuntime({
      event_sink: event => events.push(event),
    }),
    agent_loop: {
      async run(receivedExpertService, input) {
        loopCalls.push({ receivedExpertService, input });
        input.onDelta?.({ type: 'delta', content: 'child answer' });
        return {
          fullContent: 'child answer',
          fullReasoningContent: '',
          tokenUsage: {
            prompt_tokens: 2,
            completion_tokens: 3,
            total_tokens: 5,
          },
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
    event_sink: event => events.push(event),
  });

  const started = await runtime.control_facade.handleToolCall(
    AGENT_DELEGATE_TOOL_NAMES.START,
    {
      source_type: 'expert',
      agent_id: 'expert_child',
      task: 'Search project',
      input: { query: 'agent runtime' },
      expected_output: 'summary',
      requested_scope: { tools: ['search'] },
    },
    createStartContext(),
  );
  assert.equal(started.success, true);
  assert.equal(started.data.status, 'queued');

  const finalStatus = await runtime.child_run_scheduler.waitForCompletion(started.data.child_run_id);
  assert.equal(finalStatus.status, 'completed');

  const status = await runtime.control_facade.handleToolCall(AGENT_DELEGATE_TOOL_NAMES.STATUS, {
    child_run_id: started.data.child_run_id,
  });
  assert.equal(status.success, true);
  assert.equal(status.data.status, 'completed');

  const result = await runtime.control_facade.handleToolCall(AGENT_DELEGATE_TOOL_NAMES.RESULT, {
    child_run_id: started.data.child_run_id,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.result.fullContent, 'child answer');
  assert.deepEqual(result.data.events, [{ type: 'delta', content: 'child answer' }]);
  assert.deepEqual(events.map(event => event.type), [
    'delegation_created',
    'agent_run_created',
    'agent_run_started',
    'agent_run_completed',
  ]);
  assert.equal(loopCalls.length, 1);
  assert.equal(loopCalls[0].receivedExpertService, expertService);
  assert.equal(loopCalls[0].input.user_id, 'user_control_runtime');
  assert.equal(loopCalls[0].input.expert_id, 'expert_child');
  assert.equal(loopCalls[0].input.topic_id, 'topic_control_runtime');
  assert.equal(loopCalls[0].input.task_id, 'task_control_runtime');
  assert.deepEqual(loopCalls[0].input.tools.map(tool => tool.function.name), ['search']);
  assert.match(loopCalls[0].input.currentMessages[0].content, /Research Child/);
  assert.equal(JSON.parse(loopCalls[0].input.currentMessages[1].content).task, 'Search project');
  assert.deepEqual(toolContextCalls, [{
    user_id: 'user_control_runtime',
    userId: 'user_control_runtime',
    expert_id: 'expert_child',
    expertId: 'expert_child',
    session: { userId: 'user_control_runtime' },
    taskContext: null,
  }]);
}

async function testRuntimeResolvesDelegatedImageAttachmentIntoFirstChildTurn() {
  const root = path.join(process.cwd(), 'temp', 'agent-delegate-control-runtime-attachment-test');
  const workspace = path.join(root, 'workspace');
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });
  const imagePath = path.join(workspace, 'input.png');
  await fs.writeFile(imagePath, Buffer.from(PNG_1X1_BASE64, 'base64'));

  const loopCalls = [];
  const toolContextCalls = [];
  const runtime = createInMemoryAgentDelegateControlRuntime({
    definition_resolver: {
      async resolve() {
        return {
          agent_id: 'expert_child',
          source_type: 'expert',
          display_name: 'Vision Child',
          system_prompt: 'Read images carefully.',
          execution_policy: { mode: 'llm' },
          capability_declarations: {
            skills: [{ skill_id: 'skill_search', mark: 'search' }],
          },
          is_active: true,
        };
      },
    },
    agent_runtime: new AgentRuntime(),
    agent_loop: {
      async run(_receivedExpertService, input) {
        loopCalls.push(input);
        return {
          fullContent: 'child saw image',
          allToolCalls: [],
          finalMessages: input.currentMessages,
          llmCallsCount: 1,
        };
      },
    },
    get_expert_service: async () => ({
      ...createExpertService(toolContextCalls),
      getDefaultModelConfig() {
        return {
          model_name: 'child-vision-model',
          provider_name: 'provider_1',
          base_url: 'https://example.test/v1',
          max_tokens: 4096,
          max_output_tokens: 1024,
          model_type: 'multimodal',
        };
      },
    }),
  });

  const started = await runtime.control_facade.handleToolCall(
    AGENT_DELEGATE_TOOL_NAMES.START,
    {
      source_type: 'expert',
      agent_id: 'expert_child',
      task: 'OCR image',
      input: {
        attachments: [
          {
            type: 'image',
            source: 'workspace_path',
            path: imagePath,
            purpose: 'ocr',
          },
        ],
      },
      requested_scope: { tools: ['search'] },
    },
    createStartContext({
      workspaceScope: {
        workdir: workspace,
        logical_workdir: 'temp/agent-delegate-control-runtime-attachment-test/workspace',
        workspace_mode: 'test',
        current_path: '',
      },
    }),
  );

  assert.equal(started.success, true);
  await runtime.child_run_scheduler.waitForCompletion(started.data.child_run_id);
  assert.equal(loopCalls.length, 1);
  assert.equal(Array.isArray(loopCalls[0].currentMessages[1].content), true);
  assert.equal(loopCalls[0].currentMessages[1].content[0].type, 'text');
  assert.equal(loopCalls[0].currentMessages[1].content[1].type, 'image_url');
  assert.match(loopCalls[0].currentMessages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.deepEqual(loopCalls[0].llmPayload.messages, loopCalls[0].currentMessages);
}

function testRuntimeRequiresCompositionDependencies() {
  assert.throws(() => createInMemoryAgentDelegateControlRuntime({
    definition_resolver: {},
    agent_runtime: new AgentRuntime(),
    agent_loop: { run: async () => ({}) },
  }), /get_expert_service is required/);
}

async function testResidentRuntimeUsesResidentScheduler() {
  const calls = [];
  const runtime = createResidentAgentDelegateControlRuntime({
    definition_resolver: {
      async resolve() {
        return {
          agent_id: 'expert_child',
          source_type: 'expert',
          display_name: 'Resident Child',
          execution_policy: { mode: 'llm' },
          capability_declarations: {
            skills: [{ skill_id: 'skill_search', mark: 'search' }],
          },
          is_active: true,
        };
      },
    },
    resident_skill_manager: {
      async invokeByName(skillId, toolName, params, userContext, timeoutMs) {
        calls.push({ skillId, toolName, params, userContext, timeoutMs });
        return {
          child_run_id: params.child_run_id || params.delegation.child_invocation.run_id,
          status: params.action === 'start' ? 'queued' : 'running',
        };
      },
    },
    timeout_ms: 1234,
  });

  const started = await runtime.control_facade.handleToolCall(
    AGENT_DELEGATE_TOOL_NAMES.START,
    {
      source_type: 'expert',
      agent_id: 'expert_child',
      task: 'Search project',
      requested_scope: { tools: ['search'] },
    },
    createStartContext(),
  );
  assert.equal(started.success, true);
  assert.equal(started.data.child_run_id, started.data.run.child_run_id);

  const status = await runtime.control_facade.handleToolCall(
    AGENT_DELEGATE_TOOL_NAMES.STATUS,
    { child_run_id: started.data.child_run_id },
    createStartContext(),
  );
  assert.equal(status.success, true);
  assert.equal(status.data.status, 'running');
  assert.deepEqual(calls.map(call => call.params.action), ['start', 'status']);
  assert.equal(calls[0].skillId, 'agent-child-runner');
  assert.equal(calls[0].toolName, 'invoke');
  assert.equal(calls[0].timeoutMs, 1234);
}

async function main() {
  await testRuntimeStartsAndCompletesChildRunEndToEnd();
  await testRuntimeResolvesDelegatedImageAttachmentIntoFirstChildTurn();
  await testResidentRuntimeUsesResidentScheduler();
  testRuntimeRequiresCompositionDependencies();

  console.log('Agent delegate control runtime tests passed.');
}

main();
