#!/usr/bin/env node
/**
 * Agent child runner resident skill.
 *
 * Owns asynchronous child run state in a resident process. Actual child Agent
 * execution is delegated back to the main service through an internal API so
 * the main process keeps the canonical AgentLoop, ToolManager, and DB services.
 */

import { pathToFileURL } from 'url';
import { AgentChildRunnerWorker } from '../../../lib/agent/agent-child-runner-worker.js';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

let buffer = '';

function log(message, ...args) {
  process.stderr.write(`[agent-child-runner] ${new Date().toISOString()} ${message}`);
  if (args.length > 0) {
    process.stderr.write(' ' + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '));
  }
  process.stderr.write('\n');
}

function sendResponse(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

function buildAuthHeaders(session = {}) {
  const accessToken = session.accessToken || session.token || process.env.INTERNAL_TOKEN || '';
  return accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
}

async function executeChildRunViaInternalApi({
  delegation,
  session = null,
}) {
  const response = await fetch(`${API_BASE}/internal/agent/child-run/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(session || {}),
    },
    body: JSON.stringify({
      delegation,
      session,
    }),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Invalid internal child run response: ${text.slice(0, 200)}`);
    }
  }

  if (!response.ok) {
    throw new Error(payload?.message || `HTTP ${response.status}: ${response.statusText}`);
  }
  if (payload && payload.code !== undefined && payload.code !== 200) {
    throw new Error(payload.message || 'Internal child run failed');
  }

  return payload?.data ?? payload;
}

function createDefaultWorker() {
  return new AgentChildRunnerWorker({
    execute_child_run: executeChildRunViaInternalApi,
  });
}

export function getTools() {
  return [
    {
      name: 'invoke',
      description: 'Agent child runner resident process entrypoint',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'status', 'result', 'events', 'cancel'],
          },
          delegation: {
            type: 'object',
          },
          child_run_id: {
            type: 'string',
          },
          options: {
            type: 'object',
          },
        },
        required: ['action'],
      },
      script_path: 'index.js',
      is_resident: true,
    },
  ];
}

let worker = createDefaultWorker();

function processCommand(command, params = {}) {
  switch (command) {
    case 'invoke':
      return worker.handleAction(params);
    case 'ping':
      return {
        pong: true,
        runs: worker.runs.size,
        timestamp: Date.now(),
      };
    case 'exit':
      process.exit(0);
      return null;
    default:
      return worker.handleAction({ action: command, ...params });
  }
}

async function processCommandLine(line) {
  let commandEnvelope;
  try {
    commandEnvelope = JSON.parse(line);
  } catch (error) {
    sendResponse({
      task_id: null,
      success: false,
      error: `Invalid JSON: ${error.message}`,
    });
    return;
  }

  const { command = 'invoke', task_id, params = {} } = commandEnvelope;
  try {
    const result = await processCommand(command, params);
    sendResponse({
      task_id,
      success: true,
      result,
    });
  } catch (error) {
    sendResponse({
      task_id,
      success: false,
      error: error?.message || String(error),
    });
  }
}

async function main() {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        processCommandLine(line).catch(error => {
          log(`Command processing error: ${error.message}`);
        });
      }
    }
  });

  process.stdin.on('end', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  sendResponse({
    type: 'ready',
    name: 'agent-child-runner',
    pid: process.pid,
    timestamp: Date.now(),
  });
}

export const __testing = {
  createDefaultWorker,
  executeChildRunViaInternalApi,
  getWorker() {
    return worker;
  },
  setWorker(nextWorker) {
    worker = nextWorker;
  },
  processCommand,
  processCommandLine,
};

function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch(error => {
    log(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}
