/**
 * Tests for ToolManager agent delegate control tool exposure and dispatch.
 *
 * Usage:
 *   node tests/test-tool-manager-agent-delegate-control.mjs
 */

import assert from 'node:assert/strict';
import ToolManager from '../lib/tool-manager.js';
import { AgentRuntime } from '../lib/agent/agent-runtime.js';
import {
  AGENT_DELEGATE_TOOL_NAMES,
  buildAgentDelegateControlToolDefinitions,
} from '../lib/agent/agent-delegate-control-facade.js';
import { createInMemoryAgentDelegateControlRuntime } from '../lib/agent/agent-delegate-control-runtime.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createRootInvocation() {
  return buildRootAgentInvocationContext({
    run_id: 'root_run_tool_manager_delegate',
    principal_user_id: 'user_delegate_tool',
    agent_id: 'expert_parent',
    capability_scope: {
      tools: ['search', AGENT_DELEGATE_TOOL_NAMES.START],
    },
  });
}

function createChildInvocation() {
  return deriveChildAgentInvocationContext(createRootInvocation(), {
    run_id: 'child_run_tool_manager_delegate',
    callee_agent_id: 'expert_child',
    capability_scope: { tools: ['search'] },
  });
}

function createFacade(calls = []) {
  return {
    getToolDefinitions() {
      return buildAgentDelegateControlToolDefinitions();
    },
    async handleToolCall(tool_name, params, context) {
      calls.push({ tool_name, params, context });
      return {
        success: true,
        data: {
          routed: tool_name,
          context,
        },
      };
    },
  };
}

function getToolNames(tools) {
  return tools.map(tool => tool.function?.name || tool.name);
}

function createExpertService() {
  return {
    getDefaultModelConfig() {
      return {
        model_name: 'child-model',
        provider_name: 'provider_1',
        base_url: 'https://example.test/v1',
        max_tokens: 4096,
        max_output_tokens: 1024,
      };
    },
    getThinkingConfig() {
      return {
        thinking: false,
        reasoning: null,
        reasoning_effort: null,
        enable_thinking: false,
        chat_template_kwargs: null,
      };
    },
    toolManager: {
      async getToolDefinitions() {
        return [{
          type: 'function',
          function: {
            name: 'search',
            description: 'Search tool',
            parameters: { type: 'object', properties: {} },
          },
        }];
      },
    },
  };
}

async function testExposesControlToolsOnlyForRootContext() {
  const manager = new ToolManager(null, 'expert_parent', {
    agentDelegateControlFacade: createFacade(),
  });

  const rootTools = await manager.getToolDefinitions({
    agent_invocation: createRootInvocation(),
  });
  const childTools = await manager.getToolDefinitions({
    agent_invocation: createChildInvocation(),
  });

  assert.ok(getToolNames(rootTools).includes(AGENT_DELEGATE_TOOL_NAMES.START));
  assert.ok(getToolNames(rootTools).includes(AGENT_DELEGATE_TOOL_NAMES.STATUS));
  assert.equal(getToolNames(childTools).includes(AGENT_DELEGATE_TOOL_NAMES.START), false);
}

async function testDoesNotExposeControlToolsWithoutRuntime() {
  const manager = new ToolManager(null, 'expert_parent');
  const tools = await manager.getToolDefinitions({
    agent_invocation: createRootInvocation(),
  });

  assert.equal(getToolNames(tools).includes(AGENT_DELEGATE_TOOL_NAMES.START), false);
}

async function testDispatchesControlToolWithParentInvocationAndScopes() {
  const calls = [];
  const manager = new ToolManager(null, 'expert_parent', {
    agentDelegateControlFacade: createFacade(calls),
  });
  const rootInvocation = createRootInvocation();
  const session = { userId: 'user_delegate_tool' };

  const result = await manager.executeTool(
    AGENT_DELEGATE_TOOL_NAMES.START,
    {
      source_type: 'expert',
      agent_id: 'expert_child',
      task: 'Search project',
      requested_scope: { tools: ['search'] },
    },
    {
      agent_invocation: rootInvocation,
      session,
    },
  );

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool_name, AGENT_DELEGATE_TOOL_NAMES.START);
  assert.equal(calls[0].context.parent_invocation, rootInvocation);
  assert.deepEqual(calls[0].context.caller_scope, rootInvocation.capability_scope);
  assert.deepEqual(calls[0].context.principal_scope, rootInvocation.capability_scope);
  assert.deepEqual(calls[0].context.workspace_scope, rootInvocation.capability_scope);
  assert.equal(calls[0].context.session, session);
}

async function testRejectsControlToolExecutionForChildContext() {
  const manager = new ToolManager(null, 'expert_child', {
    agentDelegateControlFacade: createFacade(),
  });

  const result = await manager.executeTool(
    AGENT_DELEGATE_TOOL_NAMES.STATUS,
    { child_run_id: 'child_run_1' },
    { agent_invocation: createChildInvocation() },
  );

  assert.equal(result.success, false);
  assert.match(result.error, /only available to root agent runs/);
}

async function testRejectsControlToolExecutionWithoutRuntime() {
  const manager = new ToolManager(null, 'expert_parent');

  const result = await manager.executeTool(
    AGENT_DELEGATE_TOOL_NAMES.STATUS,
    { child_run_id: 'child_run_1' },
    { agent_invocation: createRootInvocation() },
  );

  assert.equal(result.success, false);
  assert.match(result.error, /runtime is not configured/);
}

async function testToolManagerRunsControlRuntimeEndToEnd() {
  const loopCalls = [];
  const controlRuntime = createInMemoryAgentDelegateControlRuntime({
    definition_resolver: {
      async resolve() {
        return {
          agent_id: 'expert_child',
          source_type: 'expert',
          display_name: 'Child Expert',
          system_prompt: 'Search carefully.',
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
      async run(expertService, input) {
        loopCalls.push({ expertService, input });
        return {
          fullContent: 'child result',
          allToolCalls: [],
          llmCallsCount: 1,
        };
      },
    },
    get_expert_service: async () => createExpertService(),
  });
  const manager = new ToolManager(null, 'expert_parent', {
    agentDelegateControlRuntime: controlRuntime,
  });
  const rootInvocation = createRootInvocation();

  const startResult = await manager.executeTool(
    AGENT_DELEGATE_TOOL_NAMES.START,
    {
      source_type: 'expert',
      agent_id: 'expert_child',
      task: 'Search project',
      requested_scope: { tools: ['search'] },
    },
    {
      agent_invocation: rootInvocation,
      session: { userId: 'user_delegate_tool' },
    },
  );
  assert.equal(startResult.success, true);

  await controlRuntime.child_run_scheduler.waitForCompletion(startResult.data.child_run_id);
  const result = await manager.executeTool(
    AGENT_DELEGATE_TOOL_NAMES.RESULT,
    { child_run_id: startResult.data.child_run_id },
    { agent_invocation: rootInvocation },
  );

  assert.equal(result.success, true);
  assert.equal(result.data.result.fullContent, 'child result');
  assert.equal(loopCalls.length, 1);
  assert.deepEqual(loopCalls[0].input.tools.map(tool => tool.function.name), ['search']);
}

async function main() {
  await testExposesControlToolsOnlyForRootContext();
  await testDoesNotExposeControlToolsWithoutRuntime();
  await testDispatchesControlToolWithParentInvocationAndScopes();
  await testRejectsControlToolExecutionForChildContext();
  await testRejectsControlToolExecutionWithoutRuntime();
  await testToolManagerRunsControlRuntimeEndToEnd();

  console.log('ToolManager agent delegate control tests passed.');
}

main();
