/**
 * P0-3: 引用清洗 agent 驱动脚本
 *
 * 以根模式驱动"标准引用清洗专家"完成一次端到端引用清洗。
 * 捕获完整 SSE 事件流、工具调用轨迹，落盘到 runs/ 目录。
 *
 * Usage:
 *   $env:API_BASE='http://localhost:3017'
 *   $env:EXPERT_ID='<expert_id>'
 *   $env:DOCUMENT_ID='mscmltrt3ejy03obd9f5'
 *   node scripts/run-anchor-cleaning.mjs
 *
 * 环境变量：
 *   API_BASE          — 服务地址（默认 http://localhost:3017）
 *   TEST_ACCOUNT      — 登录账号（默认 admin）
 *   TEST_PASSWORD     — 登录密码（默认 password123）
 *   EXPERT_ID         — 清洗专家 ID（必填）
 *   DOCUMENT_ID       — 待清洗文档 ID（必填）
 *   STANDARD_CODE     — 标准编号（纳管用，默认 auto-extract）
 *   STANDARD_NAME     — 标准名称（纳管用，默认 auto-extract）
 *   STANDARD_TYPE     — 标准类型（默认 national）
 *   SKIP_ONBOARD      — 跳过纳管步骤（默认 false，设 1 跳过）
 *   REQUEST_TIMEOUT_MS — 清洗超时（默认 600000，10 分钟）
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.API_BASE || 'http://localhost:3017';
const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const EXPERT_ID = process.env.EXPERT_ID || '';
const DOCUMENT_ID = process.env.DOCUMENT_ID || '';
const STANDARD_CODE = process.env.STANDARD_CODE || '';
const STANDARD_NAME = process.env.STANDARD_NAME || '';
const STANDARD_TYPE = process.env.STANDARD_TYPE || 'national';
const SKIP_ONBOARD = process.env.SKIP_ONBOARD === '1';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 600000);

if (!EXPERT_ID) {
  console.error('❌ EXPERT_ID is required');
  process.exit(1);
}
if (!DOCUMENT_ID) {
  console.error('❌ DOCUMENT_ID is required');
  process.exit(1);
}

// ---- 输出目录 ----
const RUNS_DIR = path.join(__dirname, '..', 'docs', 'tasks', 'active', 'task-20260803-anchor-agent-e2e-verify', 'runs');
const RUN_ID = `run-${Date.now()}`;
const RUN_DIR = path.join(RUNS_DIR, RUN_ID);
fs.mkdirSync(RUN_DIR, { recursive: true });

// ---- HTTP helpers ----

function requestJson(path, { method = 'GET', token = null, body = null, timeout_ms = 30000 } = {}) {
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
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
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
      try { event.data = JSON.parse(event.data); } catch { /* raw text */ }
    }
    onEvent(event);
  }
  return remaining;
}

function openSse({ expert_id, token, onEvent, onError, onClose }) {
  const url = new URL('/api/chat/stream', API_BASE);
  url.searchParams.set('expert_id', expert_id);
  url.searchParams.set('token', token);
  const transport = url.protocol === 'https:' ? https : http;

  const req = transport.get(url, { headers: { Accept: 'text/event-stream' } });

  let buffer = '';
  let connected = false;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!connected) reject(new Error('Timed out waiting for SSE connected event'));
    }, 10000);

    req.on('response', res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer = parseSseChunk(buffer + chunk, event => {
          onEvent(event);
          if (!connected && event.event === 'connected') {
            connected = true;
            clearTimeout(timer);
            resolve({ close: () => req.destroy() });
          }
        });
      });
      res.on('error', err => {
        clearTimeout(timer);
        if (onError) onError(err);
        reject(err);
      });
      res.on('end', () => {
        clearTimeout(timer);
        if (onClose) onClose();
      });
    });
    req.on('error', err => {
      clearTimeout(timer);
      if (onError) onError(err);
      reject(err);
    });
  });
}

// ---- Main ----

async function login() {
  const response = await requestJson('/api/auth/login', {
    method: 'POST',
    body: { account: TEST_ACCOUNT, password: TEST_PASSWORD },
  });
  if (response.status !== 200 || response.data?.code !== 200) {
    throw new Error(`Login failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.data.accessToken || response.data.data.access_token;
}

async function getDocumentInfo(token, documentId) {
  const response = await requestJson(`/api/docs/documents/${documentId}`, { token });
  if (response.status !== 200 || response.data?.code !== 200) {
    throw new Error(`Get document failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.data;
}

async function onboardStandard(token, documentId, standardType, standardCode, standardName) {
  const response = await requestJson('/api/apps/standard-mgr/standards', {
    method: 'POST',
    token,
    body: {
      document_id: documentId,
      standard_type: standardType,
      standard_code: standardCode,
      standard_name: standardName,
    },
  });

  if (response.status === 200 && response.data?.code === 200) {
    return response.data.data;
  }

  // 409 = already onboarded, that's OK
  if (response.status === 200 && response.data?.code === 409) {
    console.log('  ⚠️ 标准已纳管，跳过');
    return null;
  }

  // Check if the error message indicates already onboarded
  const msg = response.data?.message || '';
  if (msg.includes('already onboarded') || msg.includes('Already onboarded')) {
    console.log('  ⚠️ 标准已纳管，跳过');
    return null;
  }

  throw new Error(`Onboard failed: ${JSON.stringify(response.data)}`);
}

async function main() {
  console.log('=== P0-3: 引用清洗驱动脚本 ===\n');
  const runLog = { runId: RUN_ID, startedAt: new Date().toISOString(), steps: [], events: [], toolCalls: [], errors: [] };

  let token;
  try {
    // ---- Step 1: Login ----
    console.log('[1/5] 登录...');
    token = await login();
    console.log('  ✅ 登录成功\n');
    runLog.steps.push({ step: 'login', status: 'ok' });

    // ---- Step 2: Get document info ----
    console.log('[2/5] 获取文档信息...');
    const doc = await getDocumentInfo(token, DOCUMENT_ID);
    console.log(`  title: ${doc.title}`);
    console.log(`  processing_status: ${doc.processing_status}`);
    console.log(`  current_revision_id: ${doc.current_revision_id}`);
    if (doc.processing_status !== 'ready') {
      console.error(`  ❌ 文档状态不是 ready（当前: ${doc.processing_status}），无法清洗`);
      process.exit(1);
    }
    runLog.steps.push({ step: 'get_document', status: 'ok', document: { id: doc.id, title: doc.title, status: doc.processing_status, revision_id: doc.current_revision_id } });

    // ---- Step 3: Onboard standard ----
    let standardId = null;
    if (!SKIP_ONBOARD) {
      console.log('[3/5] 纳管标准...');
      const code = STANDARD_CODE || doc.title?.match(/^[\w/\s-]+/)?.[0]?.trim() || doc.title;
      const name = STANDARD_NAME || doc.title;
      try {
        const std = await onboardStandard(token, DOCUMENT_ID, STANDARD_TYPE, code, name);
        if (std) {
          standardId = std.id;
          console.log(`  ✅ 纳管成功: standard_id=${standardId}\n`);
        }
      } catch (err) {
        console.log(`  ⚠️ 纳管失败: ${err.message}（将继续尝试）\n`);
        runLog.errors.push({ step: 'onboard', error: err.message });
      }
      runLog.steps.push({ step: 'onboard', status: standardId ? 'ok' : 'skipped', standard_id: standardId });
    } else {
      console.log('[3/5] 跳过纳管（SKIP_ONBOARD=1）\n');
      runLog.steps.push({ step: 'onboard', status: 'skipped' });
    }

    // ---- Step 4: Run cleaning via SSE ----
    console.log('[4/5] 启动清洗对话...');
    const revisionId = doc.current_revision_id;

    const chatMessage = `请对以下标准文档执行完整的引用清洗。

文档 ID: ${DOCUMENT_ID}
版本 ID: ${revisionId}${standardId ? `\n标准 ID: ${standardId}` : ''}

请按以下流程执行：
1. 调用 list_revision_sections 获取章节结构
2. 逐节通读内容，识别引用
3. 对每个引用定位目标文档/章节
4. 调用 write_anchor_result 写入结果

请开始。`;

    let chatRequestId = null;
    let completeEvent = null;
    let errorEvent = null;

    const { close } = await openSse({
      expert_id: EXPERT_ID,
      token,
      onEvent: (event) => {
        runLog.events.push({ time: new Date().toISOString(), ...event });

        // Track tool calls
        if (event.event === 'tool_call_start' || event.event === 'tool_call') {
          const toolName = event.data?.tool_name || event.data?.name || 'unknown';
          const toolArgs = event.data?.arguments || event.data?.tool_args || null;
          runLog.toolCalls.push({
            time: new Date().toISOString(),
            event: event.event,
            tool_name: toolName,
            arguments: toolArgs,
            request_id: event.data?.request_id,
          });
          console.log(`  🔧 ${toolName}`);
        }

        if (event.event === 'tool_result' || event.event === 'tool_call_result') {
          const last = runLog.toolCalls[runLog.toolCalls.length - 1];
          if (last) {
            last.result = event.data?.result || event.data?.content || null;
          }
        }

        // Track chat request ID
        if (event.data?.request_id && !chatRequestId) {
          chatRequestId = event.data.request_id;
        }

        // Track terminal events
        if (event.event === 'complete') {
          completeEvent = event;
        }
        if (event.event === 'error') {
          errorEvent = event;
        }
      },
      onError: (err) => {
        runLog.errors.push({ type: 'sse_error', error: err.message });
      },
    });

    // ---- Send the chat message (POST /api/chat) ----
    console.log('  发送清洗指令...');
    const postResp = await requestJson('/api/chat', {
      method: 'POST',
      token,
      body: {
        expert_id: EXPERT_ID,
        content: chatMessage,
      },
    });
    if (postResp.status !== 200 || postResp.data?.code !== 200) {
      console.error(`  ❌ 发送消息失败: ${JSON.stringify(postResp.data)}`);
      close();
      process.exit(1);
    }
    console.log('  ✅ 消息已发送，等待清洗完成...');

    // Wait for completion
    console.log('  等待清洗完成...');
    const startedAt = Date.now();
    let completed = false;

    while (Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
      if (completeEvent || errorEvent) {
        completed = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    close();

    if (!completed) {
      console.log('  ⚠️ 清洗超时\n');
      runLog.errors.push({ type: 'timeout', timeout_ms: REQUEST_TIMEOUT_MS });
    } else if (errorEvent) {
      console.log(`  ❌ 清洗出错: ${JSON.stringify(errorEvent.data)}\n`);
      runLog.errors.push({ type: 'chat_error', event: errorEvent });
    } else {
      console.log('  ✅ 清洗完成\n');
    }
    runLog.steps.push({
      step: 'cleaning',
      status: completed && !errorEvent ? 'ok' : (errorEvent ? 'error' : 'timeout'),
      tool_calls: runLog.toolCalls.length,
      chat_request_id: chatRequestId,
    });

    // ---- Step 5: Save results ----
    console.log('[5/5] 保存运行记录...');
    runLog.finishedAt = new Date().toISOString();
    runLog.completed = completed && !errorEvent;

    const trajectoryFile = path.join(RUN_DIR, 'trajectory.json');
    fs.writeFileSync(trajectoryFile, JSON.stringify(runLog, null, 2));

    // Summary
    const summary = {
      run_id: RUN_ID,
      document_id: DOCUMENT_ID,
      expert_id: EXPERT_ID,
      standard_id: standardId,
      started_at: runLog.startedAt,
      finished_at: runLog.finishedAt,
      completed: runLog.completed,
      tool_calls: runLog.toolCalls.length,
      errors: runLog.errors.length,
    };
    const summaryFile = path.join(RUN_DIR, 'summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

    console.log(`  📁 轨迹文件: ${trajectoryFile}\n`);
    console.log('=== 运行摘要 ===');
    console.log(`完成: ${summary.completed}`);
    console.log(`工具调用: ${summary.tool_calls} 次`);
    console.log(`错误: ${summary.errors} 次`);
    if (runLog.toolCalls.length > 0) {
      console.log('\n工具调用序列:');
      runLog.toolCalls.forEach((tc, i) => {
        console.log(`  ${i + 1}. ${tc.event} ${tc.tool_name}`);
      });
    }
  } catch (err) {
    console.error(`❌ 失败: ${err.message}`);
    runLog.errors.push({ type: 'fatal', error: err.message, stack: err.stack });
    runLog.finishedAt = new Date().toISOString();
    const trajectoryFile = path.join(RUN_DIR, 'trajectory.json');
    fs.writeFileSync(trajectoryFile, JSON.stringify(runLog, null, 2));
    process.exit(1);
  }
}

main();
