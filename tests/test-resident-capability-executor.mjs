import assert from 'node:assert/strict';
import ResidentCapabilityExecutor, {
  buildResidentCapabilityId,
} from '../lib/resident-capability-executor.js';
import AppClock from '../lib/app-clock.js';

function createDbStub() {
  const tools = [
    {
      id: 'agent-child-runner-invoke',
      skill_id: 'agent-child-runner',
      name: 'invoke',
      description: 'child runner',
      parameters: { type: 'object', properties: {} },
      script_path: 'index.js',
      is_resident: true,
    },
    {
      id: 'mcp-client-invoke',
      skill_id: 'mcp-client',
      name: 'invoke',
      description: 'mcp client',
      parameters: { type: 'object', properties: {} },
      script_path: 'index.js',
      is_resident: true,
    },
    {
      id: 'kb-editor-invoke',
      skill_id: 'kb-editor',
      name: 'create_article',
      description: 'retired KB editor',
      parameters: { type: 'object', properties: {} },
      script_path: 'index.js',
      is_resident: true,
    },
  ];
  const skills = [
    { id: 'agent-child-runner', name: 'Agent Child Runner', is_active: true, source_path: 'skills/agent-child-runner' },
    { id: 'mcp-client', name: 'MCP Client', is_active: true, source_path: 'skills/mcp-client' },
    { id: 'kb-editor', name: 'KB Editor', is_active: true, source_path: 'skills/kb-editor' },
  ];

  return {
    getModel(name) {
      if (name === 'skill_tool') {
        return { findAll: async () => tools };
      }
      if (name === 'skill') {
        return { findAll: async () => skills };
      }
      return {};
    },
  };
}

async function main() {
  const calls = [];
  const executor = new ResidentCapabilityExecutor(createDbStub(), {
    residentSkillManager: {
      async invokeByName(...args) {
        calls.push(args);
        return { ok: true };
      },
    },
  });

  await executor.initialize();

  const agentCapabilityId = buildResidentCapabilityId('agent-child-runner', 'invoke');
  const mcpCapabilityId = buildResidentCapabilityId('mcp-client', 'invoke');
  const kbCapabilityId = buildResidentCapabilityId('kb-editor', 'create_article');

  assert.equal(executor.capabilityRegistry.has(agentCapabilityId), true);
  assert.equal(executor.capabilityRegistry.has(mcpCapabilityId), true);
  assert.equal(executor.capabilityRegistry.has(kbCapabilityId), false);

  const result = await executor.invoke({
    capabilityId: agentCapabilityId,
    params: { action: 'status' },
    userContext: { userId: 'user_1' },
    scope: 'internal',
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls[0], [
    'agent-child-runner',
    'invoke',
    { action: 'status' },
    { userId: 'user_1' },
    60000,
  ]);

  await assert.rejects(
    () => executor.invoke({
      capabilityId: mcpCapabilityId,
      params: { action: 'call_tool' },
      scope: 'internal',
    }),
    error => error.statusCode === 403 && error.code === 'RESIDENT_CAPABILITY_SCOPE_DENIED',
  );

  await executor.invoke({
    capabilityId: mcpCapabilityId,
    params: { action: 'list_tools' },
    scope: 'system',
  });
  assert.equal(calls.length, 2);

  const appClock = Object.create(AppClock.prototype);
  appClock.residentCapabilityExecutor = executor;
  appClock.skillLoader = {
    async executeSkillTool() {
      throw new Error('AppClock should use the resident capability executor');
    },
  };
  await appClock.callSkill('agent-child-runner', 'invoke', { action: 'status' });
  assert.equal(calls.length, 3);

  console.log('Resident capability executor tests passed.');
}

main();
