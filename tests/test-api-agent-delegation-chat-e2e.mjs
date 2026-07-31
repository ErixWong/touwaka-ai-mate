/**
 * API smoke test for expert chat -> agent_delegate_* -> child expert result.
 *
 * This test talks to a running API server. It is intentionally a smoke test:
 * with real models, tool calling is model-dependent. For deterministic CI,
 * point the selected experts at a scripted OpenAI-compatible test provider.
 *
 * Usage:
 *   $env:API_BASE='http://localhost:3017'
 *   $env:TEST_ACCOUNT='admin'
 *   $env:TEST_PASSWORD='password123'
 *   $env:PARENT_EXPERT_ID='...'
 *   $env:CHILD_EXPERT_ID='...'
 *   node tests/test-api-agent-delegation-chat-e2e.mjs
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';

const API_BASE = process.env.API_BASE || 'http://localhost:3017';
const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const PARENT_EXPERT_ID = process.env.PARENT_EXPERT_ID || '';
const CHILD_EXPERT_ID = process.env.CHILD_EXPERT_ID || '';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120000);
const MARKER = `SUB_AGENT_E2E_${Date.now()}`;

function requestJson(path, {
  method = 'GET',
  token = null,
  body = null,
  timeout_ms = 30000,
} = {}) {
  const url = new URL(path, API_BASE);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: timeout_ms,
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
      });
      res.on('end', () => {
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out: ${method} ${url}`));
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function parseSseChunk(buffer, onEvent) {
  let remaining = buffer;
  let index = remaining.indexOf('\n\n');
  while (index !== -1) {
    const raw = remaining.slice(0, index);
    remaining = remaining.slice(index + 2);
    index = remaining.indexOf('\n\n');

    const event = { event: 'message', data: '' };
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) {
        event.event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        event.data += line.slice('data:'.length).trim();
      }
    }
    if (event.data) {
      try {
        event.data = JSON.parse(event.data);
      } catch {
        // Keep raw data.
      }
    }
    onEvent(event);
  }
  return remaining;
}

function openSse({ expert_id, token, onEvent }) {
  const url = new URL('/api/chat/stream', API_BASE);
  url.searchParams.set('expert_id', expert_id);
  url.searchParams.set('token', token);
  const transport = url.protocol === 'https:' ? https : http;

  const req = transport.get(url, {
    headers: { Accept: 'text/event-stream' },
  });

  let connected = false;
  let buffer = '';
  const connectedPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for SSE connected event'));
    }, 10000);

    req.on('response', res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer = parseSseChunk(buffer + chunk, event => {
          onEvent(event);
          if (!connected && event.event === 'connected') {
            connected = true;
            clearTimeout(timer);
            resolve();
          }
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });

  return {
    connected: connectedPromise,
    close() {
      req.destroy();
    },
  };
}

async function login() {
  const response = await requestJson('/api/auth/login', {
    method: 'POST',
    body: {
      account: TEST_ACCOUNT,
      password: TEST_PASSWORD,
    },
  });
  assert.equal(response.status, 200, `login HTTP ${response.status}: ${JSON.stringify(response.data)}`);
  assert.equal(response.data?.code, 200, `login API failed: ${JSON.stringify(response.data)}`);
  const token = response.data?.data?.accessToken || response.data?.data?.access_token;
  assert.equal(typeof token, 'string', 'login did not return accessToken');
  return token;
}

async function getAccessibleExperts(token) {
  const response = await requestJson('/api/chat/experts', { token });
  assert.equal(response.status, 200, `experts HTTP ${response.status}: ${JSON.stringify(response.data)}`);
  assert.equal(response.data?.code, 200, `experts API failed: ${JSON.stringify(response.data)}`);
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

function selectExperts(experts) {
  if (PARENT_EXPERT_ID && CHILD_EXPERT_ID) {
    return { parent_expert_id: PARENT_EXPERT_ID, child_expert_id: CHILD_EXPERT_ID };
  }
  if (experts.length < 2) {
    throw new Error(`Need at least two accessible experts, got ${experts.length}. Set PARENT_EXPERT_ID and CHILD_EXPERT_ID explicitly.`);
  }

  return {
    parent_expert_id: PARENT_EXPERT_ID || experts[0].id,
    child_expert_id: CHILD_EXPERT_ID || experts.find(expert => expert.id !== experts[0].id)?.id,
  };
}

async function waitForComplete(events, request_id) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
    const terminal = events.find(event =>
      (event.event === 'complete' || event.event === 'error') &&
      event.data?.request_id === request_id
    );
    if (terminal) {
      return terminal;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for chat completion: ${request_id}`);
}

function summarizeEvents(events) {
  return events.map(event => ({
    event: event.event,
    request_id: event.data?.request_id || null,
    tool_name: event.data?.tool_name || event.data?.name || null,
    content_preview: typeof event.data?.content === 'string'
      ? event.data.content.slice(0, 80)
      : null,
  }));
}

function getLatestToolResult(events, toolName) {
  return events
    .filter(event => event.event === 'tool_result' && event.data?.result?.toolName === toolName)
    .at(-1)?.data?.result || null;
}

function assertSuccessfulToolResult(events, toolName) {
  const result = getLatestToolResult(events, toolName);
  assert.ok(result, `missing tool_result for ${toolName}`);
  assert.equal(
    result.success,
    true,
    `${toolName} failed: ${result.error || JSON.stringify(result.data)}`
  );
  return result;
}

async function main() {
  console.log(`[agent-chat-e2e] API_BASE=${API_BASE}`);
  const token = await login();
  const experts = await getAccessibleExperts(token);
  const { parent_expert_id, child_expert_id } = selectExperts(experts);
  console.log(`[agent-chat-e2e] parent=${parent_expert_id}`);
  console.log(`[agent-chat-e2e] child=${child_expert_id}`);
  console.log(`[agent-chat-e2e] marker=${MARKER}`);

  const events = [];
  const sse = openSse({
    expert_id: parent_expert_id,
    token,
    onEvent: event => {
      events.push(event);
      if (['connected', 'tool_call', 'tool_result', 'complete', 'error'].includes(event.event)) {
        console.log(`[sse] ${event.event} ${JSON.stringify({
          request_id: event.data?.request_id || null,
          tool_name: event.data?.tool_name || event.data?.name || null,
        })}`);
      }
    },
  });

  try {
    await sse.connected;
    const prompt = [
      `这是一次自动化 E2E 测试，测试标记是 ${MARKER}。`,
      `请必须调用工具 agent_delegate_start，把任务交给子专家 ${child_expert_id}。`,
      `子专家任务：只返回 "${MARKER} CHILD_OK"。`,
      '子专家完成后，请调用 agent_delegate_status 和 agent_delegate_result 读取结果。',
      `最后你的回答必须包含 "SUB_AGENT_RESULT: ${MARKER} CHILD_OK"。`,
    ].join('\n');

    const sent = await requestJson('/api/chat', {
      method: 'POST',
      token,
      body: {
        expert_id: parent_expert_id,
        content: prompt,
      },
    });
    assert.equal(sent.status, 200, `chat HTTP ${sent.status}: ${JSON.stringify(sent.data)}`);
    assert.equal(sent.data?.code, 200, `chat API failed: ${JSON.stringify(sent.data)}`);
    const request_id = sent.data?.data?.request_id;
    assert.equal(typeof request_id, 'string', 'chat did not return request_id');
    console.log(`[agent-chat-e2e] request_id=${request_id}`);

    const terminal = await waitForComplete(events, request_id);
    assert.notEqual(terminal.event, 'error', `chat SSE error: ${JSON.stringify(terminal.data)}`);

    const relevant = events.filter(event => event.data?.request_id === request_id);
    const toolEvents = relevant.filter(event => event.event === 'tool_call' || event.event === 'tool_result');
    const text = JSON.stringify(relevant);
    const finalContent = relevant
      .filter(event => event.event === 'delta' && typeof event.data?.content === 'string')
      .map(event => event.data.content)
      .join('');
    assert.match(text, /agent_delegate_start/, 'parent did not call agent_delegate_start');
    assert.match(text, /agent_delegate_result/, 'parent did not call agent_delegate_result');

    const startResult = assertSuccessfulToolResult(relevant, 'agent_delegate_start');
    assert.equal(typeof startResult.data?.child_run_id, 'string', 'agent_delegate_start did not return child_run_id');

    const statusResult = assertSuccessfulToolResult(relevant, 'agent_delegate_status');
    assert.notEqual(
      statusResult.data?.status,
      'failed',
      `child run failed: ${statusResult.data?.error || JSON.stringify(statusResult.data)}`
    );

    const resultResult = assertSuccessfulToolResult(relevant, 'agent_delegate_result');
    const expectedChildContent = `${MARKER} CHILD_OK`;
    const childResultText = JSON.stringify(resultResult.data?.result ?? resultResult.data);
    assert.match(
      childResultText,
      new RegExp(MARKER),
      'agent_delegate_result did not include child marker'
    );
    assert.match(
      childResultText,
      /CHILD_OK/,
      'agent_delegate_result did not include child success marker'
    );
    assert.match(
      finalContent,
      new RegExp(`SUB_AGENT_RESULT:\\s*${expectedChildContent}`),
      'final answer did not include verified child result'
    );

    console.log('[agent-chat-e2e] passed');
    console.log(JSON.stringify({
      request_id,
      tool_event_count: toolEvents.length,
      events: summarizeEvents(relevant),
    }, null, 2));
  } finally {
    sse.close();
  }
}

main().catch(error => {
  console.error('[agent-chat-e2e] failed:', error.message);
  process.exit(1);
});
