import assert from 'node:assert/strict';
import CapabilityRegistry, {
  CAPABILITY_KINDS,
} from '../lib/capability-registry.js';
import ToolManager from '../lib/tool-manager.js';

function testRoleFiltering() {
  const registry = new CapabilityRegistry();
  registry.register({
    id: 'execute',
    kind: CAPABILITY_KINDS.BUILTIN,
    definition: { type: 'function', function: { name: 'execute' } },
    metadata: { allowedRoles: ['admin', 'creator'] },
  });
  registry.register({
    id: 'recall',
    kind: CAPABILITY_KINDS.BUILTIN,
    definition: { type: 'function', function: { name: 'recall' } },
  });

  assert.deepEqual(registry.list({ kind: CAPABILITY_KINDS.BUILTIN, context: {} }).map(item => item.id), ['recall']);
  assert.deepEqual(
    registry.list({ kind: CAPABILITY_KINDS.BUILTIN, context: { session: { roles: ['creator'] } } }).map(item => item.id),
    ['execute', 'recall'],
  );
  assert.equal(registry.isAllowed('execute', { session: { roles: ['admin'] } }), true);
  assert.equal(registry.isAllowed('execute', { session: { roles: ['user'] } }), false);
}

async function testResidentInjectionDoesNotReadGlobal() {
  const calls = [];
  const injected = {
    async invokeByName(...args) {
      calls.push(args);
      return { tools: [] };
    },
  };
  const globalManager = {
    async invokeByName() {
      throw new Error('global resident manager must not be used');
    },
  };

  const previous = globalThis.residentSkillManager;
  globalThis.residentSkillManager = globalManager;
  try {
    const manager = new ToolManager(null, 'capability-registry-test', {
      residentSkillManager: injected,
    });
    await manager.getMcpToolDefinitions({ userId: 'user-1' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'mcp-client');
  } finally {
    if (previous === undefined) {
      delete globalThis.residentSkillManager;
    } else {
      globalThis.residentSkillManager = previous;
    }
  }
}

async function testRestrictedBuiltinExecutionIsDenied() {
  const manager = new ToolManager(null, 'capability-registry-permission-test');
  const result = await manager.executeBuiltinTool(
    'execute',
    { type: 'javascript', code: '1 + 1' },
    {},
    'execute',
  );
  assert.equal(result.permissionDenied, true);
}

testRoleFiltering();
await testResidentInjectionDoesNotReadGlobal();
await testRestrictedBuiltinExecutionIsDenied();
console.log('Capability registry and resident injection tests passed.');
