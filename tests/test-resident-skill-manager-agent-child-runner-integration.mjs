/**
 * Integration test for ResidentSkillManager discovering agent-child-runner.
 *
 * Usage:
 *   node tests/test-resident-skill-manager-agent-child-runner-integration.mjs
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import ResidentSkillManager from '../lib/resident-skill-manager.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

const TOOL = Object.freeze({
  id: 'agent-child-runner-invoke',
  skill_id: 'agent-child-runner',
  name: 'invoke',
  description: 'Agent Child Runner 驻留进程入口工具',
  script_path: 'index.js',
  is_resident: true,
});

const SKILL = Object.freeze({
  id: 'agent-child-runner',
  name: 'Agent Child Runner',
  source_path: 'skills/agent-child-runner',
});

function createDelegation() {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_manager_parent',
    principal_user_id: 'user_manager',
    agent_id: 'expert_parent',
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_manager_1',
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

function createDbStub() {
  return {
    getModel(name) {
      if (name === 'skill_tool') {
        return {
          async findAll({ where }) {
            return where?.is_resident ? [TOOL] : [];
          },
          async findOne({ where }) {
            return where?.skill_id === TOOL.skill_id && where?.name === TOOL.name
              ? TOOL
              : null;
          },
        };
      }
      if (name === 'skill') {
        return {
          async findAll({ where }) {
            return Array.isArray(where?.id) && where.id.includes(SKILL.id)
              ? [SKILL]
              : [];
          },
        };
      }
      if (name === 'system_setting') {
        return {
          async findOne() {
            return null;
          },
        };
      }
      return {};
    },
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function startInternalApiServer(calls) {
  const server = http.createServer(async (req, res) => {
    const body = await readRequestBody(req);
    calls.push({ url: req.url, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      code: 200,
      message: 'success',
      data: {
        fullContent: 'manager resident result',
        received_run_id: body.delegation?.child_invocation?.run_id,
      },
    }));
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function waitForCompleted(manager, childRunId) {
  for (let i = 0; i < 20; i += 1) {
    const status = await manager.invokeByName('agent-child-runner', 'invoke', {
      action: 'status',
      child_run_id: childRunId,
    }, {}, 5000);
    if (status.status === 'completed') {
      return status;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for ResidentSkillManager child run');
}

async function testResidentSkillManagerRunsAgentChildRunner() {
  const calls = [];
  const server = await startInternalApiServer(calls);
  const address = server.address();
  const originalApiBase = process.env.API_BASE;
  process.env.API_BASE = `http://127.0.0.1:${address.port}`;

  const manager = new ResidentSkillManager(createDbStub());
  try {
    await manager.initialize();
    const status = manager.getStatus();
    assert.equal(status.length, 1);
    assert.equal(status[0].skill_id, 'agent-child-runner');
    assert.equal(status[0].tool_name, 'invoke');
    assert.equal(status[0].state, 'running');

    const started = await manager.invokeByName('agent-child-runner', 'invoke', {
      action: 'start',
      delegation: createDelegation(),
      options: {
        session: {
          userId: 'user_manager',
          accessToken: 'token_manager',
        },
      },
    }, {}, 5000);
    assert.equal(started.child_run_id, 'child_run_manager_1');

    const completed = await waitForCompleted(manager, started.child_run_id);
    assert.equal(completed.status, 'completed');

    const result = await manager.invokeByName('agent-child-runner', 'invoke', {
      action: 'result',
      child_run_id: started.child_run_id,
    }, {}, 5000);
    assert.equal(result.result.fullContent, 'manager resident result');
    assert.equal(result.result.received_run_id, 'child_run_manager_1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/internal/agent/child-run/execute');
  } finally {
    await manager.shutdown();
    server.close();
    if (originalApiBase === undefined) {
      delete process.env.API_BASE;
    } else {
      process.env.API_BASE = originalApiBase;
    }
  }
}

async function main() {
  await testResidentSkillManagerRunsAgentChildRunner();

  console.log('ResidentSkillManager agent child runner integration tests passed.');
}

main();
