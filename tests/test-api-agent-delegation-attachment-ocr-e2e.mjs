/**
 * API smoke test for root expert -> child expert first-turn image attachment.
 *
 * Talks to a running API server with real experts. The parent expert is asked
 * to call agent_delegate_start with input.attachments pointing at a real image
 * inside the task workspace. The child expert must receive the image in its
 * first multimodal LLM request.
 *
 * Usage:
 *   $env:API_BASE='http://localhost:3017'
 *   $env:TEST_ACCOUNT='admin'
 *   $env:TEST_PASSWORD='password123'
 *   $env:TASK_DB_ID='mpf5gv0ahi63ii91tkcu'
 *   $env:IMAGE_PATH='D:/projects/node/touwaka-mate-v2-p0/data/work/mn3l9nz0g3axvxwc12fp/dsmzvl1nk9/input/iran_1.jpg'
 *   $env:PARENT_EXPERT_ID='mn6vy4q6cvposu6xn0tt'
 *   $env:CHILD_EXPERT_ID='mn42wffgyjo4pukj897t'
 *   node tests/test-api-agent-delegation-attachment-ocr-e2e.mjs
 */

import assert from 'node:assert/strict';

const API_BASE = process.env.API_BASE || 'http://localhost:3017';
const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const TASK_DB_ID = process.env.TASK_DB_ID || 'mpf5gv0ahi63ii91tkcu';
const IMAGE_PATH = process.env.IMAGE_PATH
  || 'D:/projects/node/touwaka-mate-v2-p0/data/work/mn3l9nz0g3axvxwc12fp/dsmzvl1nk9/input/iran_1.jpg';
const PARENT_EXPERT_ID = process.env.PARENT_EXPERT_ID || 'mn6vy4q6cvposu6xn0tt';
const CHILD_EXPERT_ID = process.env.CHILD_EXPERT_ID || 'mn42wffgyjo4pukj897t';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 240000);
const MARKER = `ATTACHMENT_OCR_E2E_${Date.now()}`;

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
    if (index === -1) return rest;

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
        // Keep raw payload.
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
              error: event.data?.message || event.data?.error || null,
            })}`);
          }
          if (event.event === 'connected') {
            clearTimeout(timer);
            resolve();
          }
        });
      }
    }).catch(error => {
      if (error.name !== 'AbortError') reject(error);
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
    if (terminal) return terminal;
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

async function sendChatAndWait({ token, events, content, task_db_id = null }) {
  const sent = await requestJson('/api/chat', {
    method: 'POST',
    token,
    body: {
      expert_id: PARENT_EXPERT_ID,
      content,
      ...(task_db_id ? { task_db_id } : {}),
    },
  });
  assert.equal(sent.status, 200, `chat HTTP ${sent.status}: ${JSON.stringify(sent.data)}`);
  assert.equal(sent.data?.code, 200, `chat API failed: ${JSON.stringify(sent.data)}`);
  const request_id = sent.data?.data?.request_id;
  assert.equal(typeof request_id, 'string', 'chat did not return request_id');
  console.log(`[agent-attachment-ocr-e2e] request_id=${request_id}`);

  const terminal = await waitForTerminal(events, request_id);
  assert.notEqual(terminal.event, 'error', `chat SSE error: ${JSON.stringify(terminal.data)}`);

  return {
    request_id,
    relevant: events.filter(event => event.data?.request_id === request_id),
    terminal,
  };
}

async function pollChildResult({ token, events, child_run_id }) {
  const startedAt = Date.now();
  let lastRelevant = [];

  while (Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const { relevant } = await sendChatAndWait({
      token,
      events,
      content: [
        `Call agent_delegate_status for child run ${child_run_id}.`,
        `If it is completed, call agent_delegate_result for child run ${child_run_id}.`,
        'Return the exact child status and result.',
      ].join('\n'),
    });
    lastRelevant = relevant;

    const result = getToolResult(relevant, 'agent_delegate_result');
    if (result?.success === true) {
      return { result, relevant };
    }

    const status = getToolResult(relevant, 'agent_delegate_status');
    if (status?.success === true && ['failed', 'cancelled'].includes(status.data?.status)) {
      throw new Error(`child run terminal failure: ${JSON.stringify(status.data)}`);
    }
  }

  throw new Error(`Timed out waiting for child run result: ${child_run_id}; last=${JSON.stringify(lastRelevant)}`);
}

function summarizeEvents(events) {
  return events.map(event => ({
    event: event.event,
    request_id: event.data?.request_id || null,
    tool_name: event.data?.result?.toolName || event.data?.tool_name || event.data?.name || null,
    content_preview: typeof event.data?.content === 'string'
      ? event.data.content.slice(0, 120)
      : null,
  }));
}

async function main() {
  console.log(`[agent-attachment-ocr-e2e] API_BASE=${API_BASE}`);
  console.log(`[agent-attachment-ocr-e2e] parent=${PARENT_EXPERT_ID}`);
  console.log(`[agent-attachment-ocr-e2e] child=${CHILD_EXPERT_ID}`);
  console.log(`[agent-attachment-ocr-e2e] task_db_id=${TASK_DB_ID}`);
  console.log(`[agent-attachment-ocr-e2e] image=${IMAGE_PATH}`);
  console.log(`[agent-attachment-ocr-e2e] marker=${MARKER}`);

  const token = await login();
  const events = [];
  const sse = await openSse({ expert_id: PARENT_EXPERT_ID, token, events });
  try {
    await sse.opened;

    const prompt = [
      `This is a real child Agent image attachment OCR test. Marker: ${MARKER}.`,
      `You must call agent_delegate_start exactly once and delegate to child expert ${CHILD_EXPERT_ID}.`,
      'Use this exact tool call payload shape:',
      JSON.stringify({
        source_type: 'expert',
        agent_id: CHILD_EXPERT_ID,
        task: 'Inspect the attached image. Briefly describe what visible text or scene you can recognize. Include the marker in your answer.',
        input: {
          instruction: `Inspect this image and include marker ${MARKER}.`,
          attachments: [
            {
              type: 'image',
              source: 'workspace_path',
              path: IMAGE_PATH,
              purpose: 'ocr',
            },
          ],
        },
        expected_output: `A short image/OCR description containing ${MARKER}.`,
      }, null, 2),
      'Do not use fs.read_file for this test. The child runtime should receive the image as a first-turn attachment.',
      'After the child finishes, call agent_delegate_status and agent_delegate_result.',
      `Final answer must include exactly this prefix: SUB_AGENT_IMAGE_RESULT: ${MARKER}`,
    ].join('\n');

    const initial = await sendChatAndWait({
      token,
      events,
      content: prompt,
      task_db_id: TASK_DB_ID,
    });

    const { request_id, relevant } = initial;
    assertToolSuccess(relevant, 'agent_delegate_start');
    assertToolSuccess(relevant, 'agent_delegate_status');
    const child_run_id = getToolResult(relevant, 'agent_delegate_start')?.data?.child_run_id;
    assert.equal(typeof child_run_id, 'string', 'agent_delegate_start did not return child_run_id');

    let result = getToolResult(relevant, 'agent_delegate_result');
    let resultEvents = relevant;
    if (!result?.success) {
      console.log(`[agent-attachment-ocr-e2e] child still pending; polling ${child_run_id}`);
      const polled = await pollChildResult({ token, events, child_run_id });
      result = polled.result;
      resultEvents = polled.relevant;
    }
    assert.equal(result.success, true, `agent_delegate_result failed: ${result.error || JSON.stringify(result.data)}`);

    const childResultText = JSON.stringify(result.data?.result ?? result.data);
    assert.match(childResultText, new RegExp(MARKER), 'child result did not include marker');

    console.log('[agent-attachment-ocr-e2e] passed');
    console.log(JSON.stringify({
      request_id,
      child_run_id,
      child_result_preview: childResultText.slice(0, 1600),
      events: summarizeEvents(resultEvents),
    }, null, 2));
  } finally {
    sse.close();
  }
}

main().catch(error => {
  console.error('[agent-attachment-ocr-e2e] failed:', error.message);
  process.exit(1);
});
