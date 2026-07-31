/**
 * Tests for agent-child-runner resident skill entrypoint.
 *
 * Usage:
 *   node tests/test-agent-child-runner-skill-entry.mjs
 */

import assert from 'node:assert/strict';
import { AgentChildRunnerWorker } from '../lib/agent/agent-child-runner-worker.js';
import {
  getTools,
  __testing,
} from '../data/skills/agent-child-runner/index.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createDelegation() {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_skill_entry_parent',
    principal_user_id: 'user_skill_entry',
    agent_id: 'expert_parent',
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_skill_entry_1',
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
      display_name: 'Child Expert',
      execution_policy: { mode: 'llm' },
    },
    task: 'Search project',
    requested_scope: { tools: ['search'] },
    effective_scope: { tools: ['search'] },
  };
}

async function testToolDefinition() {
  const tools = getTools();

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'invoke');
  assert.equal(tools[0].script_path, 'index.js');
  assert.equal(tools[0].is_resident, true);
  assert.deepEqual(tools[0].parameters.required, ['action']);
}

async function testProcessCommandDispatchesToWorker() {
  const worker = new AgentChildRunnerWorker({
    async execute_child_run() {
      return { fullContent: 'done' };
    },
  });
  const originalWorker = __testing.getWorker();
  __testing.setWorker(worker);

  try {
    const started = __testing.processCommand('invoke', {
      action: 'start',
      delegation: createDelegation(),
    });
    const finalStatus = await worker.waitForCompletion(started.child_run_id);
    const result = __testing.processCommand('invoke', {
      action: 'result',
      child_run_id: started.child_run_id,
    });

    assert.equal(finalStatus.status, 'completed');
    assert.equal(result.result.fullContent, 'done');
  } finally {
    __testing.setWorker(originalWorker);
  }
}

async function testResolveApiBase() {
  assert.equal(
    __testing.resolveApiBase({ API_PORT: '3017' }),
    'http://localhost:3017'
  );
  assert.equal(
    __testing.resolveApiBase({ INTERNAL_API_BASE: 'http://127.0.0.1:4010/' }),
    'http://127.0.0.1:4010'
  );
  assert.equal(
    __testing.resolveApiBase({ API_BASE: 'http://localhost:3018/api/' }),
    'http://localhost:3018/api'
  );
  assert.equal(
    __testing.resolveApiBase({ INTERNAL_API_PROTOCOL: 'https', INTERNAL_API_HOST: 'api.internal', PORT: '4443' }),
    'https://api.internal:4443'
  );
}

async function main() {
  await testToolDefinition();
  await testProcessCommandDispatchesToWorker();
  await testResolveApiBase();

  console.log('Agent child runner skill entry tests passed.');
}

main();
