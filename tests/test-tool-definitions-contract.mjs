/**
 * Contract tests for ToolManager.getToolDefinitions().
 *
 * These tests protect the final LLM-visible tool definition shape. Execution
 * metadata such as _meta may exist internally, but must not leak into the
 * definitions sent to the model.
 *
 * Usage:
 *   node tests/test-tool-definitions-contract.mjs
 */

import assert from 'node:assert/strict';
import ToolManager from '../lib/tool-manager.js';

function createManager(options = {}) {
  return new ToolManager(null, 'expert-tool-definitions-test', options);
}

function assertNoMetaFields(value, path = 'tool') {
  if (!value || typeof value !== 'object') {
    return;
  }

  assert.equal(value._meta, undefined, `${path} must not expose _meta`);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoMetaFields(item, `${path}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    assertNoMetaFields(child, `${path}.${key}`);
  }
}

function findTool(tools, name) {
  return tools.find(tool => (tool.function?.name || tool.name) === name);
}

async function testFinalDefinitionsStripInternalMeta() {
  const mcpCalls = [];
  const residentSkillManager = {
    invokeByName: async (skillId, toolName, params, context, timeoutMs) => {
      mcpCalls.push({ skillId, toolName, params, context, timeoutMs });
      return {
        tools: [
          {
            name: 'mcp_demo_lookup',
            server_name: 'demo',
            original_name: 'lookup',
            description: 'Lookup demo data',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
        ],
      };
    },
  };
  const manager = createManager({ residentSkillManager });

  manager.skills.set('demo-skill', {
    id: 'demo-skill',
    name: 'Demo Skill',
  });

  manager.skillLoader.getToolDefinitions = (skill) => {
    assert.equal(skill.id, 'demo-skill');
    return [
      {
        type: 'function',
        function: {
          name: 'demo__search',
          description: 'Demo search tool',
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string' },
            },
            required: ['q'],
          },
        },
        _meta: {
          skillId: 'demo-skill',
          toolName: 'search',
        },
      },
    ];
  };

  {
    const tools = await manager.getToolDefinitions({
      userId: 'user-1',
      session: { roles: ['admin'] },
    });
    const toolNames = tools.map(tool => tool.function?.name || tool.name);

    assert.ok(toolNames.includes('execute'), 'builtin tools should be included');
    assert.ok(toolNames.includes('demo__search'), 'skill tools should be included');
    assert.ok(toolNames.includes('mcp_demo_lookup'), 'MCP tools should be included');

    for (const tool of tools) {
      assertNoMetaFields(tool, tool.function?.name || tool.name || 'tool');
    }

    assert.equal(findTool(tools, 'demo__search').function.parameters.required[0], 'q');
    assert.equal(findTool(tools, 'mcp_demo_lookup').function.description, '[MCP/demo] Lookup demo data');
    assert.deepEqual(mcpCalls, [
      {
        skillId: 'mcp-client',
        toolName: 'invoke',
        params: { action: 'list_tools' },
        context: { userId: 'user-1' },
        timeoutMs: 30000,
      },
    ]);
  }
}

async function testUnavailableOptionalSourcesDoNotBreakDefinitions() {
  const manager = createManager();

  const tools = await manager.getToolDefinitions({});
  const toolNames = tools.map(tool => tool.function?.name || tool.name);

  assert.equal(findTool(tools, 'execute'), undefined, 'restricted builtin tools must be hidden from ordinary users');
  assert.ok(toolNames.includes('recall'), 'ordinary users should retain unrestricted builtin tools');
  assert.equal(findTool(tools, 'mcp_demo_lookup'), undefined);
  for (const tool of tools) {
    assertNoMetaFields(tool, tool.function?.name || tool.name || 'tool');
  }
}

async function main() {
  await testFinalDefinitionsStripInternalMeta();
  await testUnavailableOptionalSourcesDoNotBreakDefinitions();

  console.log('ToolManager getToolDefinitions contract tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
