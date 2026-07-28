/**
 * Tests for ToolManager.executeTool dispatch boundaries.
 *
 * Usage:
 *   node tests/test-tool-manager-dispatch.mjs
 */

import assert from 'node:assert/strict';
import ToolManager from '../lib/tool-manager.js';
import { setAssistantManager } from '../server/services/assistant/index.js';

function createManager() {
  return new ToolManager(null, 'expert-dispatch-test');
}

async function testBuiltinWinsOverRegistry() {
  const manager = createManager();
  const calls = [];

  manager.toolRegistry.set('execute', {
    skillId: 'fake-skill',
    skillName: 'Fake Skill',
    toolName: 'execute',
    scriptPath: 'index.js',
  });
  manager.executeBuiltinTool = async (toolId, params, context, display) => {
    calls.push({ route: 'builtin', toolId, params, context, display });
    return { success: true, route: 'builtin' };
  };
  manager.skillLoader.executeSkillTool = async () => {
    calls.push({ route: 'skill' });
    return {};
  };

  const result = await manager.executeTool('execute', { type: 'javascript' }, {});

  assert.deepEqual(result, { success: true, route: 'builtin' });
  assert.deepEqual(calls.map(call => call.route), ['builtin']);
}

async function testMcpWinsOverRegistry() {
  const manager = createManager();
  const calls = [];

  manager.toolRegistry.set('mcp_demo_search', {
    skillId: 'fake-skill',
    skillName: 'Fake Skill',
    toolName: 'mcp_demo_search',
    scriptPath: 'index.js',
  });
  manager.executeMcpTool = async (toolId, params, context, display) => {
    calls.push({ route: 'mcp', toolId, params, context, display });
    return { success: true, route: 'mcp' };
  };
  manager.skillLoader.executeSkillTool = async () => {
    calls.push({ route: 'skill' });
    return {};
  };

  const result = await manager.executeTool('mcp_demo_search', { q: 'hello' }, {});

  assert.deepEqual(result, { success: true, route: 'mcp' });
  assert.deepEqual(calls.map(call => call.route), ['mcp']);
}

async function testAssistantWinsOverRegistry() {
  const manager = createManager();
  const calls = [];

  manager.toolRegistry.set('assistant_summon', {
    skillId: 'fake-skill',
    skillName: 'Fake Skill',
    toolName: 'assistant_summon',
    scriptPath: 'index.js',
  });
  manager.skillLoader.executeSkillTool = async () => {
    calls.push({ route: 'skill' });
    return {};
  };

  setAssistantManager({
    executeTool: async (toolId, params, context) => {
      calls.push({ route: 'assistant', toolId, params, context });
      return { success: true, route: 'assistant', context };
    },
  });

  try {
    const result = await manager.executeTool(
      'assistant_summon',
      { assistant_id: 'helper-1' },
      {
        expertId: 'expert-1',
        userId: 'user-1',
        contactId: 'contact-1',
        topicId: 'topic-1',
        taskContext: { absolute_workspace_path: 'D:/work/task' },
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.route, 'assistant');
    assert.deepEqual(calls.map(call => call.route), ['assistant']);
    assert.deepEqual(result.context, {
      expertId: 'expert-1',
      userId: 'user-1',
      contactId: 'contact-1',
      topicId: 'topic-1',
      taskContext: { absolute_workspace_path: 'D:/work/task' },
    });
  } finally {
    setAssistantManager(null);
  }
}

async function testResidentDispatchesBeforeSkillRunner() {
  const manager = createManager();
  const calls = [];

  manager.toolRegistry.set('ssh__exec', {
    skillId: 'ssh',
    skillName: 'SSH',
    toolName: 'exec',
    scriptPath: 'resident://exec',
  });
  manager.executeResidentTool = async (scriptPath, skillId, params, context, display, toolId) => {
    calls.push({ route: 'resident', scriptPath, skillId, params, context, display, toolId });
    return { success: true, route: 'resident' };
  };
  manager.skillLoader.executeSkillTool = async () => {
    calls.push({ route: 'skill' });
    return {};
  };

  const result = await manager.executeTool('ssh__exec', { command: 'uptime' }, {});

  assert.deepEqual(result, { success: true, route: 'resident' });
  assert.deepEqual(calls.map(call => call.route), ['resident']);
  assert.equal(calls[0].scriptPath, 'resident://exec');
  assert.equal(calls[0].skillId, 'ssh');
  assert.equal(calls[0].toolId, 'ssh__exec');
}

async function testNormalSkillDispatchesToSkillRunner() {
  const manager = createManager();
  const calls = [];

  manager.skills.set('searxng', { id: 'searxng', name: 'SearXNG' });
  manager.toolRegistry.set('searxng__search', {
    skillId: 'searxng',
    skillName: 'SearXNG',
    toolName: 'search',
    scriptPath: 'index.js',
  });
  manager.skillLoader.executeSkillTool = async (skillId, toolName, params, context, scriptPath) => {
    calls.push({ route: 'skill', skillId, toolName, params, context, scriptPath });
    return { found: true };
  };

  const result = await manager.executeTool(
    'searxng__search',
    { query: 'tool dispatch' },
    {
      user_id: 'user-1',
      expert_id: 'expert-1',
      accessToken: 'token-1',
      session: { isAdmin: true, roles: ['creator'] },
      taskContext: { absolute_workspace_path: 'D:/work/task' },
    }
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.data, { found: true });
  assert.equal(result.toolId, 'searxng__search');
  assert.equal(result.toolName, 'SearXNG/search');
  assert.deepEqual(calls.map(call => call.route), ['skill']);
  assert.equal(calls[0].skillId, 'searxng');
  assert.equal(calls[0].toolName, 'search');
  assert.deepEqual(calls[0].params, { query: 'tool dispatch' });
  assert.equal(calls[0].context.userId, 'user-1');
  assert.equal(calls[0].context.expertId, 'expert-1');
  assert.equal(calls[0].context.accessToken, 'token-1');
  assert.equal(calls[0].context.workingDirectory, 'D:/work/task');
  assert.equal(calls[0].context.isAdmin, true);
  assert.equal(calls[0].context.isSkillCreator, true);
  assert.equal(calls[0].scriptPath, 'index.js');
}

async function testMissingToolReturnsHonestError() {
  const manager = createManager();

  const result = await manager.executeTool('missing_tool', {}, {});

  assert.deepEqual(result, {
    success: false,
    error: 'Tool not found: missing_tool',
  });
}

async function main() {
  await testBuiltinWinsOverRegistry();
  await testMcpWinsOverRegistry();
  await testAssistantWinsOverRegistry();
  await testResidentDispatchesBeforeSkillRunner();
  await testNormalSkillDispatchesToSkillRunner();
  await testMissingToolReturnsHonestError();

  console.log('ToolManager dispatch tests passed.');
}

main().catch(error => {
  setAssistantManager(null);
  console.error(error);
  process.exit(1);
});
