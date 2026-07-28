/**
 * Tests for expert child scoped tool adapter.
 *
 * Usage:
 *   node tests/test-expert-child-scoped-tools.mjs
 */

import assert from 'node:assert/strict';
import {
  getExpertChildScopedTools,
  getToolDefinitionName,
} from '../lib/agent/expert-child-scoped-tools.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createChildInvocation() {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_scoped_tools_parent',
    principal_user_id: 'user_scoped_tools',
    agent_id: 'expert_parent',
    topic_id: 'topic_scoped_tools',
  });

  return deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_scoped_tools_1',
    callee_agent_id: 'expert_child',
    capability_scope: { tools: ['search'] },
  });
}

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

async function testFiltersToolsByEffectiveScope() {
  const invocation_context = createChildInvocation();
  const toolContextCalls = [];
  const tools = [
    createTool('execute'),
    createTool('search'),
    createTool('read_file'),
    { name: 'legacy_shape_tool' },
  ];
  const session = { userId: 'user_scoped_tools' };
  const expert_service = {
    toolManager: {
      async getToolDefinitions(context) {
        toolContextCalls.push(context);
        return tools;
      },
    },
  };

  const scopedTools = await getExpertChildScopedTools({
    expert_service,
    invocation_context,
    effective_scope: { tools: ['search', 'legacy_shape_tool', 'missing_tool', 'search'] },
    session,
  });

  assert.deepEqual(scopedTools, [
    tools[1],
    tools[3],
  ]);
  assert.deepEqual(toolContextCalls, [{
    user_id: 'user_scoped_tools',
    userId: 'user_scoped_tools',
    expert_id: 'expert_child',
    expertId: 'expert_child',
    session,
  }]);
}

async function testEmptyScopeDoesNotLoadToolDefinitions() {
  let getToolDefinitionsCalled = false;
  const scopedTools = await getExpertChildScopedTools({
    expert_service: {
      toolManager: {
        async getToolDefinitions() {
          getToolDefinitionsCalled = true;
          return [createTool('search')];
        },
      },
    },
    invocation_context: createChildInvocation(),
    effective_scope: {},
  });

  assert.deepEqual(scopedTools, []);
  assert.equal(getToolDefinitionsCalled, false);
}

async function testRejectsMissingToolManagerWhenScopeRequestsTools() {
  await assert.rejects(() => getExpertChildScopedTools({
    expert_service: {},
    invocation_context: createChildInvocation(),
    effective_scope: { tools: ['search'] },
  }), /toolManager\.getToolDefinitions is required/);
}

function testExtractsToolDefinitionName() {
  assert.equal(getToolDefinitionName(createTool('search')), 'search');
  assert.equal(getToolDefinitionName({ name: 'flat_tool' }), 'flat_tool');
  assert.equal(getToolDefinitionName({}), null);
}

async function main() {
  await testFiltersToolsByEffectiveScope();
  await testEmptyScopeDoesNotLoadToolDefinitions();
  await testRejectsMissingToolManagerWhenScopeRequestsTools();
  testExtractsToolDefinitionName();

  console.log('Expert child scoped tools tests passed.');
}

main();
