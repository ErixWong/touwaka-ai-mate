/**
 * Process-level test for agent-child-runner resident skill.
 *
 * Usage:
 *   node tests/test-agent-child-runner-resident-process.mjs
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createDelegation() {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_process_parent',
    principal_user_id: 'user_process',
    agent_id: 'expert_parent',
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_process_1',
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
    try {
      if (req.method !== 'POST' || req.url !== '/internal/agent/child-run/execute') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 404, message: 'not found' }));
        return;
      }

      const body = await readRequestBody(req);
      calls.push({
        authorization: req.headers.authorization,
        body,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 200,
        message: 'success',
        data: {
          result: {
            fullContent: 'resident child result',
            received_run_id: body.delegation?.child_invocation?.run_id,
          },
          events: [
            { type: 'delta', content: 'resident event' },
          ],
        },
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 500, message: error.message }));
    }
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function waitForLine(proc, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for resident process stdout'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      proc.stdout.off('data', onData);
      proc.off('exit', onExit);
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`Resident process exited before response: ${code}`));
    }

    function onData(chunk) {
      buffer += chunk.toString();
      const index = buffer.indexOf('\n');
      if (index === -1) {
        return;
      }

      cleanup();
      const line = buffer.slice(0, index).trim();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    }

    proc.stdout.on('data', onData);
    proc.on('exit', onExit);
  });
}

async function sendCommand(proc, envelope) {
  const responsePromise = waitForLine(proc);
  proc.stdin.write(`${JSON.stringify(envelope)}\n`);
  return await responsePromise;
}

async function waitForCompletedStatus(proc, childRunId) {
  for (let i = 0; i < 20; i += 1) {
    const response = await sendCommand(proc, {
      command: 'invoke',
      task_id: `status_${i}`,
      params: {
        action: 'status',
        child_run_id: childRunId,
      },
    });
    assert.equal(response.success, true);
    if (response.result.status === 'completed') {
      return response.result;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for completed resident child run');
}

async function testResidentProcessStartStatusResult() {
  const calls = [];
  const server = await startInternalApiServer(calls);
  const address = server.address();
  const apiBase = `http://127.0.0.1:${address.port}`;
  const proc = spawn(process.execPath, ['data/skills/agent-child-runner/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_BASE: apiBase,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    const ready = await waitForLine(proc);
    assert.equal(ready.type, 'ready');
    assert.equal(ready.name, 'agent-child-runner');

    const session = {
      userId: 'user_process',
      accessToken: 'token_process',
    };
    const started = await sendCommand(proc, {
      command: 'invoke',
      task_id: 'start_1',
      params: {
        action: 'start',
        delegation: createDelegation(),
        options: { session },
      },
    });

    assert.equal(started.success, true);
    assert.equal(started.result.child_run_id, 'child_run_process_1');
    assert.equal(started.result.status, 'queued');

    const completed = await waitForCompletedStatus(proc, started.result.child_run_id);
    assert.equal(completed.status, 'completed');

    const result = await sendCommand(proc, {
      command: 'invoke',
      task_id: 'result_1',
      params: {
        action: 'result',
        child_run_id: started.result.child_run_id,
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.result.result.fullContent, 'resident child result');
    assert.equal(result.result.result.received_run_id, 'child_run_process_1');
    assert.deepEqual(result.result.events, [{ type: 'delta', content: 'resident event' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, 'Bearer token_process');
    assert.equal(calls[0].body.session, undefined);
  } finally {
    proc.kill();
    server.close();
  }

  assert.equal(stderr, '');
}

async function testResidentProcessDerivesApiBaseFromApiPort() {
  const calls = [];
  const server = await startInternalApiServer(calls);
  const address = server.address();
  const proc = spawn(process.execPath, ['data/skills/agent-child-runner/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_BASE: '',
      API_PORT: String(address.port),
      INTERNAL_API_HOST: '127.0.0.1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    const ready = await waitForLine(proc);
    assert.equal(ready.type, 'ready');

    const started = await sendCommand(proc, {
      command: 'invoke',
      task_id: 'start_port_fallback',
      params: {
        action: 'start',
        delegation: createDelegation(),
        options: {
          session: {
            userId: 'user_process',
            accessToken: 'token_port_fallback',
          },
        },
      },
    });

    assert.equal(started.success, true);
    const completed = await waitForCompletedStatus(proc, started.result.child_run_id);
    assert.equal(completed.status, 'completed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, 'Bearer token_port_fallback');
  } finally {
    proc.kill();
    server.close();
  }

  assert.equal(stderr, '');
}

async function main() {
  await testResidentProcessStartStatusResult();
  await testResidentProcessDerivesApiBaseFromApiPort();

  console.log('Agent child runner resident process tests passed.');
}

main();
