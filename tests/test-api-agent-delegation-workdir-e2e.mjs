/**
 * API smoke test for root expert -> child expert workspace propagation.
 *
 * Talks to a running API server with real experts. It passes a repo task
 * working_path to /api/chat and verifies the child result contains the
 * workspace.current_workdir projected into the child delegation package.
 *
 * Usage:
 *   $env:API_BASE='http://localhost:3017'
 *   $env:TEST_ACCOUNT='admin'
 *   $env:TEST_PASSWORD='password123'
 *   $env:WORKING_PATH='docs/tasks/active/refactor-260728-03-agent-delegation-architecture'
 *   node tests/test-api-agent-delegation-workdir-e2e.mjs
 */

import assert from 'node:assert/strict';

const API_BASE = process.env.API_BASE || 'http://localhost:3017';
const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const PARENT_EXPERT_ID = process.env.PARENT_EXPERT_ID || '';
const CHILD_EXPERT_ID = process.env.CHILD_EXPERT_ID || '';
const WORKING_PATH = process.env.WORKING_PATH
  || 'docs/tasks/active/refactor-260728-03-agent-delegation-architecture';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 180000);
const MARKER = `WORKDIR_E2E_${Date.now()}`;

async function requestJson(path, { method = 'GET', token = null, body = null } = {}) {
  const response = await fetch(new URL(path, API_BASE), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function parseSse(buffer, onEvent) {
  let rest = buffer;
  for (;;) {
    const index = rest.indexOf('\n\n');
    if (index === -1) {
      return rest;
    }
    const raw = rest.slice(0, index);
    rest = rest.slice(index + 2);
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
}

async function login() {
  const response = await requestJson('/api/auth/login', {
    method: 'POST',
    body: { account: TEST_ACCOUNT, password: TEST_PASSWORD },
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
    throw new Error(`Need at least two accessible experts, got ${experts.length}`);
  }
  return {
    parent_expert_id: PARENT_EXPERT_ID || experts[0].id,
    child_expert_id: CHILD_EXPERT_ID || experts.find(expert => expert.id !== experts[0].id)?.id,
  };
}

async function openSse({ expert_id, token, events }) {
  const url = new URL('/api/chat/stream', API_BASE);
  url.searchParams.set('expert_id', expert_id);
  url.searchParams.set('token', token);

  const controller = new AbortController();
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for SSE connected')), 10000);
    fetch(url, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    }).then(async response => {
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer = parseSse(buffer + decoder.decode(chunk), event => {
          events.push(event);
          if (['connected', 'tool_call', 'tool_result', 'complete', 'error'].includes(event.event)) {
            console.log(`[sse] ${event.event} ${JSON.stringify({
              request_id: event.data?.request_id || null,
              tool_name: event.data?.result?.toolName || event.data?.tool_name || event.data?.name || null,
            })}`);
          }
          if (event.event === 'connected') {
            clearTimeout(timer);
            resolve();
          }
        });
      }
    }).catch(error => {
      if (error.name !== 'AbortError') {
        reject(error);
      }
    });
  });

  return {
    opened,
    close() {
      controller.abort();
    },
  };
}

async function waitForTerminal(events, request_id) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
    const terminal = events.find(event =>
      ['complete', 'error'].includes(event.event) &&
      event.data?.request_id === request_id
    );
    if (terminal) {
      return terminal;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for chat completion: ${request_id}`);
}

function getToolResult(events, toolName) {
  return events
    .filter(event => event.event === 'tool_result' && event.data?.result?.toolName === toolName)
    .at(-1)?.data?.result || null;
}

function assertToolSuccess(events, toolName) {
  const result = getToolResult(events, toolName);
  assert.ok(result, `missing tool_result for ${toolName}`);
  assert.equal(result.success, true, `${toolName} failed: ${result.error || JSON.stringify(result.data)}`);
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function eventSummary(events) {
  return events.map(event => ({
    event: event.event,
    request_id: event.data?.request_id || null,
    tool_name: event.data?.result?.toolName || event.data?.tool_name || event.data?.name || null,
    content_preview: typeof event.data?.content === 'string'
      ? event.data.content.slice(0, 100)
      : null,
  }));
}

async function main() {
  console.log(`[agent-workdir-e2e] API_BASE=${API_BASE}`);
  console.log(`[agent-workdir-e2e] working_path=${WORKING_PATH}`);

  const token = await login();
  const experts = await getAccessibleExperts(token);
  const { parent_expert_id, child_expert_id } = selectExperts(experts);
  console.log(`[agent-workdir-e2e] parent=${parent_expert_id}`);
  console.log(`[agent-workdir-e2e] child=${child_expert_id}`);
  console.log(`[agent-workdir-e2e] marker=${MARKER}`);

  const events = [];
  const sse = await openSse({ expert_id: parent_expert_id, token, events });
  try {
    await sse.opened;

    const prompt = [
      `This is a workspace propagation E2E test. Marker: ${MARKER}.`,
      `Call agent_delegate_start and delegate to child expert ${child_expert_id}.`,
      'Child task:',
      `Return exactly "${MARKER} CHILD_OK".`,
      'Then inspect your own delegation task package.',
      'If workspace.current_workdir exists there, append exactly this line:',
      'WORKDIR_CONTEXT: <workspace.current_workdir value>',
      'Do not infer the workdir from this parent prompt; use only your child delegation package.',
      'After the child finishes, call agent_delegate_status and agent_delegate_result.',
      `Final answer must contain "SUB_AGENT_RESULT: ${MARKER} CHILD_OK".`,
    ].join('\n');

    const sent = await requestJson('/api/chat', {
      method: 'POST',
      token,
      body: {
        expert_id: parent_expert_id,
        content: prompt,
        working_path: WORKING_PATH,
      },
    });
    assert.equal(sent.status, 200, `chat HTTP ${sent.status}: ${JSON.stringify(sent.data)}`);
    assert.equal(sent.data?.code, 200, `chat API failed: ${JSON.stringify(sent.data)}`);
    const request_id = sent.data?.data?.request_id;
    assert.equal(typeof request_id, 'string', 'chat did not return request_id');
    console.log(`[agent-workdir-e2e] request_id=${request_id}`);

    const terminal = await waitForTerminal(events, request_id);
    assert.notEqual(terminal.event, 'error', `chat SSE error: ${JSON.stringify(terminal.data)}`);

    const relevant = events.filter(event => event.data?.request_id === request_id);
    assertToolSuccess(relevant, 'agent_delegate_start');
    assertToolSuccess(relevant, 'agent_delegate_status');
    const result = assertToolSuccess(relevant, 'agent_delegate_result');
    const childText = JSON.stringify(result.data?.result ?? result.data).replace(/\\/g, '/');

    assert.match(childText, new RegExp(escapeRegExp(MARKER)), 'child result did not include marker');
    assert.match(childText, /CHILD_OK/, 'child result did not include child success marker');
    assert.match(childText, /WORKDIR_CONTEXT:/, 'child result did not include workdir context line');
    assert.match(childText, new RegExp(escapeRegExp(WORKING_PATH)), 'child result did not include expected working_path');

    console.log('[agent-workdir-e2e] passed');
    console.log(JSON.stringify({
      request_id,
      child_run_id: getToolResult(relevant, 'agent_delegate_start')?.data?.child_run_id || null,
      working_path: WORKING_PATH,
      child_result_preview: childText.slice(0, 1000),
      events: eventSummary(relevant),
    }, null, 2));
  } finally {
    sse.close();
  }
}

main().catch(error => {
  console.error('[agent-workdir-e2e] failed:', error.message);
  process.exit(1);
});
