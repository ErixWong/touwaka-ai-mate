#!/usr/bin/env node
/**
 * erix 消息面真机 e2e（#1156 Stage 2：S5 工具轮数夹取 + S6 notes scope_ref）
 *
 * 对应方案：docs/tasks/active/task-20261008-erix-integration/e2e-plan.md 的 Layer 1 S5/S6 + Layer 4。
 * 约定照抄 tests/test-api-erix-roundtrip-e2e.mjs（env 驱动 API_BASE/TEST_ACCOUNT/TEST_PASSWORD、
 * MARKER 打标、node:assert/strict、自带 requestJson()/openSse()、collect/verify/self-test/cleanup 四段）。
 *
 * 用法：
 *   API_BASE=http://127.0.0.1:3017 TEST_ACCOUNT=admin TEST_PASSWORD=password123 \
 *   DB_HOST=127.0.0.1 DB_NAME=touwaka_mate DB_USER=touwaka DB_PASSWORD=touwaka_secret \
 *     node tests/test-api-erix-roundcaps-notes-e2e.mjs              # 采集 + 断言（真机，S5+S6）
 *   node tests/test-api-erix-roundcaps-notes-e2e.mjs --only=s5      # 只跑 S5
 *   node tests/test-api-erix-roundcaps-notes-e2e.mjs --only=s6      # 只跑 S6
 *   node tests/test-api-erix-roundcaps-notes-e2e.mjs --self-test    # 篡改期望，检查器必须变红
 *   node tests/test-api-erix-roundcaps-notes-e2e.mjs --cleanup      # 只删本次 MARKER 的数据
 *
 * 结构：collect() 采真机事实 → facts JSON；verify() 纯函数 facts × EXPECT；
 * --self-test 只篡改 EXPECT（facts 不变），没变红的期望就是假断言。
 *
 * 实测事实（写断言前跑出来的，不是假设）：
 *   PUT /api/experts/:id {max_tool_rounds:60} → HTTP 400 + body.code=400
 *   message="max_tool_rounds 必须是 1-50 之间的整数，留空（null）表示使用系统默认"，**库里值不变**
 *   （即写入侧是**硬校验拒绝**，不是夹到 50——见 server/controllers/expert.controller.js:300）。
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------- 配置（env 驱动）

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3017';
const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
/** S5 用「机器之心」（库里现值 49，有显式值才好核对改前/改后）；S6 用「小美」（Stage 1 已证会写 note） */
const EXPERT_S5_ID = process.env.EXPERT_S5_ID || 'mn6vy4q6cvposu6xn0tt';
const EXPERT_S6_ID = process.env.EXPERT_S6_ID || 'mn42wffgyjo4pukj897t';
/** S5b 直写库的越界脏值（与 API 越界值同一个，便于两条路径对照） */
const DIRTY_MAX_TOOL_ROUNDS = Number(process.env.DIRTY_MAX_TOOL_ROUNDS || 60);
/** S5b 期望夹取到的上界（lib/agent/max-tool-rounds.js 的 MAX_TOOL_ROUNDS_MAX） */
const CLAMPED_MAX = 50;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 180000);
const RUN_STAMP = process.env.E2E_RUN_STAMP || String(Date.now());
const MARKER_RUN = `E1156S56_${RUN_STAMP}`;
const FACTS_PATH = process.env.E2E_FACTS_PATH
  || path.resolve(process.cwd(), 'temp', `e2e-s56-facts-${RUN_STAMP}.json`);
/** 主仓 temp 目录：request_id 清单落这里（方案「数据、成本与风险纪律」第 4 条） */
const REQUEST_IDS_PATH = process.env.E2E_REQUEST_IDS_PATH
  || path.resolve('/home/eric/projects/touwaka/temp', 'e2e-s56-requestids.txt');
const LOG_CONTAINER = process.env.LOG_CONTAINER || 'touwaka-mate';

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  name: process.env.DB_NAME || 'touwaka_mate',
  user: process.env.DB_USER || 'touwaka',
  password: process.env.DB_PASSWORD || 'touwaka_secret',
};

/** 清理范围：只按本次 request_id / topic_id / note_key 前缀删，绝不碰别人数据 */
const CLEAN_TABLES = [
  ['agent_transcript_rounds', 'request_id'],
  ['agent_rounds', 'request_id'],
  ['chat_tool_calls', 'request_id'],
  ['messages', 'request_id'],
  ['chat_requests', 'request_id'],
];

/**
 * 期望表（**字面量**，与 facts 无关）。--self-test 只篡改这里。
 * 数值来源全部标了出处，不是从 facts 抄回来的。
 */
function defaultExpectations() {
  return {
    s5a: {
      // 实测：写入侧硬校验拒绝（不是夹取）——server/controllers/expert.controller.js:300 ctx.error(...,400)
      reject_http_status: 400,
      reject_code: 400,
      reject_code_not_200: true,
      // 拒绝文案必须自证区间（前端 :min/:max、models 列注释同区间）
      reject_message_includes: '必须是 1-50 之间的整数',
      reject_body_data_null: true,
      // 拒绝必须真的没落库
      reject_db_value_unchanged: true,
      restore_http_status: 200,
      restore_code: 200,
      restore_db_value_equals_original: true,
    },
    s5b: {
      // 库里改前值必须是这个（防"专家被谁改过还不知道"）；换专家请同步改这条
      db_value_before: 49,
      dirty_value: 60,
      update_affected_rows: 1,
      db_value_after_dirty_write: 60,
      terminal_event: 'complete',
      request_id_prefix: 'req_',
      // 告警原文来自 lib/agent/max-tool-rounds.js:137（clampMaxToolRounds 的 logger.warn）
      clamp_log_needles: [
        '[MaxToolRounds]',
        'max_tool_rounds 已夹取：60 -> 50',
        '允许范围 1-50',
        '来源：专家配置 expert.max_tool_rounds',
      ],
      clamp_log_lines_min: 1,
      // 告警必须带上本次 request_id（证明是我们这一跑触发的）
      clamp_log_must_include_request_id: true,
      max_round_no_lte: 50,
      max_round_no_gte: 0,
      restore_affected_rows: 1,
      db_value_after_restore: 49,
      restore_api_value_equals_original: true,
    },
    s6: {
      // 对话路径：note_record 落 1 行，scope_ref 必须是「归一化值」而非"非空"
      note_rows_exact: 1,
      note_rows_by_marker_exact: 1,
      scope_ref_shape: '^run-h-[0-9a-f]{24}$',
      canonical_equals_repo_function: true,
      record_json_contains_marker: true,
      tool_call_rows_min: 1,
      tool_error_rows_exact: 0,
      // store 路径：非法 scopeRef 被拒（抛 TypeError，不是 500），且库里无残留
      illegal_throws: true,
      illegal_error_name: 'TypeError',
      illegal_error_message: 'canonicalizeNotesScopeRef requires a string',
      illegal_residual_rows_exact: 0,
      adapter_mismatch_throws: true,
      adapter_mismatch_error_name: 'TypeError',
      adapter_mismatch_is_http500: false,
      // 合法写入 1：含冒号的 scopeRef → 归一化成 run-h-<sha256 前 24>
      legal_hashed_scope_ref_prefix: 'run-h-',
      // 'run-h-' (6) + 24 位 sha256 前缀 = 30
      legal_hashed_scope_ref_len: 30,
      // 合法写入 2：SAFE_ID_PATTERN 直通（canonical === 原值）
      legal_passthrough_scope_ref_equals_input: true,
      legal_rows_exact: 2,
    },
  };
}

// ---------------------------------------------------------------- 通用工具

function log(...args) {
  console.log('[erix-s56-e2e]', ...args);
}

function sha256hex24(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 24);
}

function requestJson(pathName, { method = 'GET', token = null, body = null, timeout_ms = 30000 } = {}) {
  const url = new URL(pathName, API_BASE);
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
        resolve({ status: res.statusCode, data, text });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${method} ${url}`)));
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
      if (line.startsWith('event:')) event.event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) event.data += line.slice('data:'.length).trim();
    }
    if (event.data) {
      try { event.data = JSON.parse(event.data); } catch { /* 原样保留 */ }
    }
    onEvent(event);
  }
  return remaining;
}

function openSse({ expert_id, token }) {
  const url = new URL('/api/chat/stream', API_BASE);
  url.searchParams.set('expert_id', expert_id);
  url.searchParams.set('token', token);
  const transport = url.protocol === 'https:' ? https : http;
  const req = transport.get(url, { headers: { Accept: 'text/event-stream' } });
  let connected = false;
  let buffer = '';
  const events = [];
  const connectedPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for SSE connected event')), 10000);
    req.on('response', res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer = parseSseChunk(buffer + chunk, event => {
          events.push(event);
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
  return { events, connected: connectedPromise, close() { req.destroy(); } };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function login() {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await requestJson('/api/auth/login', {
      method: 'POST',
      body: { account: TEST_ACCOUNT, password: TEST_PASSWORD },
    });
    const token = res.data?.data?.access_token;
    if (res.status === 200 && token) {
      log(`登录成功（第 ${attempt} 次），token 长度 ${String(token).length}`);
      return token;
    }
    lastError = new Error(`登录失败 status=${res.status} body=${res.text.slice(0, 200)}`);
    log(lastError.message);
  }
  throw lastError ?? new Error('登录失败');
}

// ---------------------------------------------------------------- SQL 回读层

let sequelizeInstance = null;

async function db() {
  if (!sequelizeInstance) {
    const { Sequelize } = await import('sequelize');
    sequelizeInstance = new Sequelize(DB.name, DB.user, DB.password, {
      host: DB.host, port: DB.port, dialect: 'mysql', logging: false,
    });
    await sequelizeInstance.authenticate();
  }
  return sequelizeInstance;
}

async function sql(query, replacements = {}) {
  const [rows] = await (await db()).query(query, { replacements });
  return rows;
}

/** 写 SQL（S5b 允许临时改 experts 值）；返回 affectedRows */
async function execSql(query, replacements = {}) {
  const [results, meta] = await (await db()).query(query, { replacements });
  const candidates = [results, meta].filter(item => item && typeof item === 'object');
  for (const item of candidates) {
    const affected = Array.isArray(item) ? null : item.affectedRows;
    if (typeof affected === 'number') return affected;
  }
  throw new Error(`拿不到 affectedRows：${query}`);
}

async function readMaxToolRounds(expertId) {
  const rows = await sql('SELECT max_tool_rounds FROM experts WHERE id = :id', { id: expertId });
  if (rows.length !== 1) throw new Error(`experts 里没有唯一行 id=${expertId}`);
  return rows[0].max_tool_rounds;
}

// ---------------------------------------------------------------- 服务日志层（docker logs）

async function readContainerLogs({ since_ms, until_ms }) {
  const since = new Date(since_ms - 3000).toISOString();
  const until = new Date(until_ms + 3000).toISOString();
  // ⚠️ logger 的 [WARN] 走 console.warn → 容器 stderr；`docker logs` 保留流分离，
  // 只收 stdout 会得到 0 条告警（假阴性）。必须用 shell 合并 2>&1。
  const { stdout } = await execFileAsync(
    'sh', ['-c', `docker logs --since '${since}' --until '${until}' '${LOG_CONTAINER}' 2>&1`],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  return stdout;
}

// ---------------------------------------------------------------- 发一轮对话

async function sendRound({ token, expert_id, content, label }) {
  const sent = await requestJson('/api/chat', {
    method: 'POST', token, body: { expert_id, content },
  });
  assert.equal(sent.status, 200, `${label} POST /api/chat HTTP ${sent.status}: ${sent.text}`);
  assert.equal(sent.data?.code, 200, `${label} chat API failed: ${sent.text}`);
  const request_id = sent.data?.data?.request_id;
  assert.equal(typeof request_id, 'string', `${label} 没拿到 request_id`);
  log(`${label} request_id=${request_id}`);
  return request_id;
}

async function waitForTerminal({ events, request_id, label, allow = ['complete'] }) {
  const startedAt = Date.now();
  let terminal = null;
  while (Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
    terminal = events.find(event =>
      ['complete', 'error', 'stopped'].includes(event.event) && event.data?.request_id === request_id);
    if (terminal) break;
    await sleep(250);
  }
  assert.ok(terminal, `${label} SSE 未读到终态事件（超时 ${REQUEST_TIMEOUT_MS}ms）`);
  assert.ok(allow.includes(terminal.event),
    `${label} 终态事件=${terminal.event}（允许 ${allow.join('/')}）：${JSON.stringify(terminal.data)}`);
  return { terminal_event: terminal.event, terminal_data: terminal.data ?? null };
}

async function runChatRound({ token, expert_id, content, label }) {
  const sse = openSse({ expert_id, token });
  try {
    await sse.connected;
    const started_ms = Date.now();
    const request_id = await sendRound({ token, expert_id, content, label });
    const run = await waitForTerminal({ events: sse.events, request_id, label });
    const finished_ms = Date.now();
    return { request_id, started_ms, finished_ms, ...run };
  } finally {
    sse.close();
  }
}

// ---------------------------------------------------------------- S5a：保存路径的校验

async function collectS5a(token) {
  const original = await readMaxToolRounds(EXPERT_S5_ID);
  const out = { expert_id: EXPERT_S5_ID, db_value_original: original };

  const bad = await requestJson(`/api/experts/${EXPERT_S5_ID}`, {
    method: 'PUT', token, body: { max_tool_rounds: DIRTY_MAX_TOOL_ROUNDS },
  });
  out.reject_http_status = bad.status;
  out.reject_code = bad.data?.code ?? null;
  out.reject_message = typeof bad.data?.message === 'string' ? bad.data.message : String(bad.text ?? '');
  out.reject_body_data_null = bad.data ? bad.data.data === null : false;
  out.reject_db_value_after = await readMaxToolRounds(EXPERT_S5_ID);
  out.reject_db_value_unchanged = String(out.reject_db_value_after) === String(original);

  // 越界被拒后必须还能正常设回原值（顺带证明这条 PUT 通路本身是通的）
  const restore = await requestJson(`/api/experts/${EXPERT_S5_ID}`, {
    method: 'PUT', token, body: { max_tool_rounds: original },
  });
  out.restore_http_status = restore.status;
  out.restore_code = restore.data?.code ?? null;
  out.restore_db_value_after = await readMaxToolRounds(EXPERT_S5_ID);
  out.restore_db_value_equals_original = String(out.restore_db_value_after) === String(original);

  log('S5a 完成', JSON.stringify(out));
  return out;
}

// ---------------------------------------------------------------- S5b：运行时夹取

async function collectS5b(token) {
  const before = await readMaxToolRounds(EXPERT_S5_ID);

  // 绕过 API 直接写库，模拟历史脏数据（#1166 修之前的落库形态）
  const affected = await execSql(
    'UPDATE experts SET max_tool_rounds = :dirty WHERE id = :id',
    { dirty: DIRTY_MAX_TOOL_ROUNDS, id: EXPERT_S5_ID },
  );
  const afterDirty = await readMaxToolRounds(EXPERT_S5_ID);

  // 服务侧缓存 5 分钟（lib/config-loader.js），且 ExpertChatService 只在 initialize() 读一次
  // → 必须走公开 API 刷缓存，否则跑的是旧配置，断言会假绿
  const refreshed = await requestJson(`/api/experts/${EXPERT_S5_ID}/refresh`, { method: 'POST', token });
  assert.equal(refreshed.status, 200, `刷缓存失败：${refreshed.status} ${refreshed.text}`);

  const run = await runChatRound({
    token,
    expert_id: EXPERT_S5_ID,
    content: `${MARKER_RUN}-s5b 这是一次自动化测试，只回一句话"OK"，不要调用任何工具。`,
    label: 'S5b',
  });

  const logText = await readContainerLogs({ since_ms: run.started_ms, until_ms: Date.now() + 2000 });
  const clampLines = logText.split('\n')
    .filter(line => line.includes('max_tool_rounds 已夹取'));

  // 红线：改了就改回
  const restoreAffected = await execSql(
    'UPDATE experts SET max_tool_rounds = :before WHERE id = :id',
    { before: before, id: EXPERT_S5_ID },
  );
  await requestJson(`/api/experts/${EXPERT_S5_ID}/refresh`, { method: 'POST', token });
  const afterRestore = await readMaxToolRounds(EXPERT_S5_ID);
  const apiRead = await requestJson(`/api/experts/${EXPERT_S5_ID}`, { token });

  const roundRows = await sql(
    'SELECT MAX(round_no) AS max_round, COUNT(*) AS rows_total FROM agent_rounds WHERE request_id = :id',
    { id: run.request_id },
  );
  const canonicalRows = await sql(
    'SELECT MAX(round_no) AS max_round, COUNT(*) AS rows_total FROM agent_transcript_rounds WHERE request_id = :id',
    { id: run.request_id },
  );
  const reqRow = (await sql('SELECT topic_id, status FROM chat_requests WHERE request_id = :id',
    { id: run.request_id }))[0] || {};

  const out = {
    expert_id: EXPERT_S5_ID,
    db_value_before: before,
    update_affected_rows: affected,
    db_value_after_dirty_write: afterDirty,
    request_id: run.request_id,
    terminal_event: run.terminal_event,
    request_status: reqRow.status ?? null,
    topic_id: reqRow.topic_id ?? null,
    clamp_log_line_count: clampLines.length,
    clamp_log_lines: clampLines.slice(0, 5),
    clamp_log_contains_request_id: clampLines.some(line => line.includes(run.request_id)),
    max_round_no: roundRows[0]?.max_round === null ? null : Number(roundRows[0].max_round),
    agent_round_rows: Number(roundRows[0]?.rows_total ?? 0),
    canonical_max_round_no: canonicalRows[0]?.max_round === null
      ? null : Number(canonicalRows[0].max_round),
    canonical_rows: Number(canonicalRows[0]?.rows_total ?? 0),
    restore_affected_rows: restoreAffected,
    db_value_after_restore: afterRestore,
    restore_matches_before: String(afterRestore) === String(before),
    api_readback_value: apiRead.data?.data?.max_tool_rounds
      ?? apiRead.data?.data?.expert?.max_tool_rounds ?? null,
  };
  log('S5b 完成', JSON.stringify({
    db_value_before: out.db_value_before,
    update_affected_rows: out.update_affected_rows,
    db_value_after_dirty_write: out.db_value_after_dirty_write,
    clamp_log_line_count: out.clamp_log_line_count,
    clamp_log_contains_request_id: out.clamp_log_contains_request_id,
    max_round_no: out.max_round_no,
    db_value_after_restore: out.db_value_after_restore,
  }));
  log('S5b 告警原文样本：', JSON.stringify(out.clamp_log_lines.slice(0, 2)));
  return out;
}

// ---------------------------------------------------------------- S6：notes scope_ref

/** 归一化期望值的**独立**算法（出处：lib/notes/notes-policy.js:20-47 的字面量规则，此处自己算一遍） */
function expectedCanonicalScopeRef(user_id, expert_id) {
  const logical = `notes-v1:${sha256hex24(`${user_id}\u0000${expert_id}`)}`;
  const hashedRun = /^run-h-[0-9a-f]{24}$/;
  const safeId = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
  const passThrough = safeId.test(logical) && logical !== '.' && logical !== '..' && !logical.startsWith('run-h-');
  return {
    logical,
    canonical: (hashedRun.test(logical) || passThrough) ? logical : `run-h-${sha256hex24(logical)}`,
  };
}

function sampleNoteRecord({ key, scopeRef, content }) {
  const ts = new Date().toISOString();
  return {
    key,
    scope: 'run',
    scopeRef,
    current: { content, provenance: { source: 'agent', verified: true, ts }, ts },
    superseded: [],
    folded: 0,
    pinned: false,
    tags: [],
    relevance: 0.5,
    state: 'active',
    created_at: ts,
    updated_at: ts,
  };
}

async function collectS6(token) {
  const me = await requestJson('/api/auth/me', { token });
  assert.equal(me.status, 200, `GET /api/auth/me 失败：${me.status}`);
  const user_id = me.data?.data?.id ?? me.data?.data?.user?.id ?? null;
  assert.equal(typeof user_id, 'string', `拿不到 user_id：${me.text.slice(0, 200)}`);

  const noteKey = `${MARKER_RUN}-s6`;
  const out = { user_id, expert_id: EXPERT_S6_ID, note_key: noteKey };

  // --- 路径 A：真机对话（会真的写 note 的专家 + 显式要求调用 note_take）
  const run = await runChatRound({
    token,
    expert_id: EXPERT_S6_ID,
    content: [
      `${MARKER_RUN}-s6 这是一次自动化测试。`,
      `请**必须调用一次工具 note_take**，key 用 "${noteKey}"，content 写 "${MARKER_RUN} S6 OK"。`,
      '不要调用其它工具，调用完成后用一句话回答："S6 OK"。',
    ].join('\n'),
    label: 'S6',
  });
  out.request_id = run.request_id;
  out.terminal_event = run.terminal_event;

  const toolRows = await sql(
    "SELECT name, is_error, duration_ms FROM chat_tool_calls WHERE request_id = :id ORDER BY created_at ASC",
    { id: run.request_id },
  );
  out.tool_call_rows = toolRows.length;
  out.tool_names = [...new Set(toolRows.map(row => String(row.name ?? '')))];
  out.tool_error_rows = toolRows.filter(row => Number(row.is_error ?? 0) === 1).length;

  const rowsByKey = await sql(
    'SELECT id, scope, scope_ref, note_key, record, expires_at FROM note_record WHERE note_key = :key',
    { key: noteKey },
  );
  out.note_rows = rowsByKey.length;
  out.note_scope_refs = [...new Set(rowsByKey.map(row => String(row.scope_ref)))];
  out.record_json_contains_marker = rowsByKey.length > 0
    && rowsByKey.every(row => String(row.record).includes(MARKER_RUN));
  const rowsByMarker = await sql(
    'SELECT note_key, scope_ref FROM note_record WHERE record LIKE :like',
    { like: `%${MARKER_RUN}%` },
  );
  out.note_rows_by_marker = rowsByMarker.length;
  out.note_rows_by_marker_keys = [...new Set(rowsByMarker.map(row => String(row.note_key)))];

  const expected = expectedCanonicalScopeRef(user_id, EXPERT_S6_ID);
  out.expected_logical_scope_ref = expected.logical;
  out.expected_scope_ref = expected.canonical;

  // 与仓内（= 容器内同一份代码）导出的实现交叉核对，排除"我自己算错了期望"
  const policy = await import(pathToFileURL(path.resolve('lib/notes/notes-policy.js')).href);
  out.repo_canonical_scope_ref = policy.canonicalizeNotesScopeRef(policy.buildNotesScopeRef(user_id, EXPERT_S6_ID));
  out.canonical_equals_repo_function = out.repo_canonical_scope_ref === expected.canonical;

  // --- 路径 B：store 直连（能触达校验的那条路；对话里 scopeRef 由服务端注入，永远合法）
  const { default: Database } = await import(pathToFileURL(path.resolve('lib/db.js')).href);
  const { DbNoteRecordStore, ErixNotesStoreAdapter } = await import(
    pathToFileURL(path.resolve('lib/notes/index.js')).href);
  const rawDb = new Database({
    host: DB.host, port: DB.port, database: DB.name, user: DB.user, password: DB.password,
    connectionLimit: 2,
  });
  await rawDb.connect();
  try {
    const store = new DbNoteRecordStore({ db: rawDb });

    // B1 合法但**需要归一化**（含冒号 → run-h-<sha24>）
    const hashedScopeInput = `notes-v1:${MARKER_RUN}`;
    const hashedKey = `${MARKER_RUN}-scopeA`;
    await store.write(hashedScopeInput, hashedKey,
      sampleNoteRecord({ key: hashedKey, scopeRef: hashedScopeInput, content: `${MARKER_RUN} legal hashed` }),
      { expectedVersion: null });
    const hashedRows = await sql(
      'SELECT scope_ref FROM note_record WHERE note_key = :key', { key: hashedKey });
    out.legal_hashed_scope_input = hashedScopeInput;
    out.legal_hashed_scope_expected = `run-h-${sha256hex24(hashedScopeInput)}`;
    out.legal_hashed_scope_actual = hashedRows[0]?.scope_ref ?? null;

    // B2 合法且**直通**（SAFE_ID_PATTERN 命中 → canonical === 原值）
    const safeScopeInput = `${MARKER_RUN}-scopeB`;
    const safeKey = `${MARKER_RUN}-scopeB`;
    await store.write(safeScopeInput, safeKey,
      sampleNoteRecord({ key: safeKey, scopeRef: safeScopeInput, content: `${MARKER_RUN} legal safe` }),
      { expectedVersion: null });
    const safeRows = await sql(
      'SELECT scope_ref FROM note_record WHERE note_key = :key', { key: safeKey });
    out.legal_passthrough_scope_input = safeScopeInput;
    out.legal_passthrough_scope_actual = safeRows[0]?.scope_ref ?? null;

    // B3 非法 scopeRef（非字符串）→ 必须抛 TypeError，且库里不留行
    const illegalKey = `${MARKER_RUN}-illegal`;
    let illegalError = null;
    try {
      await store.write(60, illegalKey,
        sampleNoteRecord({ key: illegalKey, scopeRef: 'x', content: `${MARKER_RUN} illegal` }),
        { expectedVersion: null });
    } catch (error) {
      illegalError = error;
    }
    out.illegal_thrown = illegalError !== null;
    out.illegal_error_name = illegalError?.constructor?.name ?? null;
    out.illegal_error_message = illegalError ? String(illegalError.message) : null;
    const residual = await sql('SELECT COUNT(*) AS c FROM note_record WHERE note_key = :key',
      { key: illegalKey });
    out.illegal_residual_rows = Number(residual[0]?.c ?? 0);

    // B4 adapter：请求 scopeRef 与绑定 scopeRef 不一致 → TypeError（**不是 500**，方案 S6 的判据）
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef: safeScopeInput });
    let adapterError = null;
    let adapterHttp500 = false;
    try {
      const result = await adapter.write({
        scopeRef: `${MARKER_RUN}-not-bound`,
        scope: 'run',
        key: `${MARKER_RUN}-adapter`,
        record: sampleNoteRecord({ key: `${MARKER_RUN}-adapter`, scopeRef: safeScopeInput, content: 'x' }),
      });
      // erix 的 store 端口是"成功返回结果"，没有抛错就是没拒
      adapterHttp500 = result?.status === 500;
    } catch (error) {
      adapterError = error;
    }
    out.adapter_mismatch_thrown = adapterError !== null;
    out.adapter_mismatch_error_name = adapterError?.constructor?.name ?? null;
    out.adapter_mismatch_error_message = adapterError ? String(adapterError.message) : null;
    out.adapter_mismatch_is_http500 = adapterHttp500;

    const legalRows = await sql(
      'SELECT note_key, scope_ref FROM note_record WHERE note_key IN (:keys)',
      { keys: [hashedKey, safeKey] });
    out.legal_rows = legalRows.length;
  } finally {
    if (typeof rawDb.close === 'function') await rawDb.close();
  }

  log('S6 完成', JSON.stringify({
    tool_call_rows: out.tool_call_rows,
    tool_names: out.tool_names,
    note_rows: out.note_rows,
    expected_scope_ref: out.expected_scope_ref,
    note_scope_refs: out.note_scope_refs,
    legal_hashed_scope_expected: out.legal_hashed_scope_expected,
    legal_hashed_scope_actual: out.legal_hashed_scope_actual,
    legal_passthrough_scope_actual: out.legal_passthrough_scope_actual,
    illegal_error_name: out.illegal_error_name,
    illegal_residual_rows: out.illegal_residual_rows,
    adapter_mismatch_error_name: out.adapter_mismatch_error_name,
    adapter_mismatch_error_message: out.adapter_mismatch_error_message,
  }));
  return out;
}

// ---------------------------------------------------------------- collect

async function collect(token, only) {
  const facts = {
    marker_run: MARKER_RUN,
    run_stamp: RUN_STAMP,
    api_base: API_BASE,
    db_name: DB.name,
    collected_at: new Date().toISOString(),
    request_ids: {},
  };
  if (only !== 's6') {
    facts.s5a = await collectS5a(token);
    facts.s5b = await collectS5b(token);
    facts.request_ids.S5B = facts.s5b.request_id;
  }
  if (only !== 's5') {
    facts.s6 = await collectS6(token);
    facts.request_ids.S6 = facts.s6.request_id;
  }
  const topics = await sql(
    'SELECT request_id, topic_id FROM chat_requests WHERE request_id IN (:ids)',
    { ids: Object.values(facts.request_ids) });
  facts.topic_ids = [...new Set(topics.map(row => row.topic_id).filter(Boolean))];
  fs.mkdirSync(path.dirname(FACTS_PATH), { recursive: true });
  fs.writeFileSync(FACTS_PATH, JSON.stringify(facts, null, 2), 'utf8');
  fs.mkdirSync(path.dirname(REQUEST_IDS_PATH), { recursive: true });
  fs.writeFileSync(REQUEST_IDS_PATH,
    [`${MARKER_RUN}`, ...Object.entries(facts.request_ids).map(([k, v]) => `${k}\t${v}`)].join('\n') + '\n',
    'utf8');
  log(`facts → ${FACTS_PATH}`);
  log(`request_id 清单 → ${REQUEST_IDS_PATH}`);
  return facts;
}

// ---------------------------------------------------------------- verify（纯函数）

function verify(facts, exp = defaultExpectations()) {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  const sectionEnabled = name => (name === 's5a' || name === 's5b' ? Boolean(facts.s5a || facts.s5b) : Boolean(facts.s6));

  if (facts.s5a) {
    const a = facts.s5a; const e = exp.s5a;
    check('S5a 越界 PUT 的 HTTP 状态', a.reject_http_status === e.reject_http_status,
      `实际 ${a.reject_http_status}，期望 ${e.reject_http_status}`);
    check('S5a 越界 PUT 的 body.code', a.reject_code === e.reject_code,
      `实际 ${a.reject_code}，期望 ${e.reject_code}`);
    check('S5a 统一响应契约 code !== 200', (a.reject_code !== 200) === e.reject_code_not_200,
      `实际 code!==200=${a.reject_code !== 200}，期望 ${e.reject_code_not_200}`);
    check('S5a 拒绝文案自证 1-50 区间', a.reject_message.includes(e.reject_message_includes),
      `文案="${a.reject_message}" 不含 "${e.reject_message_includes}"`);
    check('S5a 拒绝时 data 必须为 null', a.reject_body_data_null === e.reject_body_data_null,
      `实际 data===null=${a.reject_body_data_null}`);
    check('S5a 越界被拒后库里没被写坏', a.reject_db_value_unchanged === e.reject_db_value_unchanged,
      `改前=${a.db_value_original} 越界写后=${a.reject_db_value_after}`);
    check('S5a 设回原值 HTTP 200', a.restore_http_status === e.restore_http_status,
      `实际 ${a.restore_http_status}`);
    check('S5a 设回原值 code 200', a.restore_code === e.restore_code, `实际 ${a.restore_code}`);
    check('S5a 恢复后库值确实回到原值', a.restore_db_value_equals_original === e.restore_db_value_equals_original,
      `原值=${a.db_value_original} 恢复后=${a.restore_db_value_after}`);
  }

  if (facts.s5b) {
    const b = facts.s5b; const e = exp.s5b;
    check('S5b 改前库里是期望值', b.db_value_before === e.db_value_before,
      `实际 ${b.db_value_before}，期望 ${e.db_value_before}`);
    check('S5b 脏值写入 affectedRows', b.update_affected_rows === e.update_affected_rows,
      `实际 ${b.update_affected_rows}，期望 ${e.update_affected_rows}`);
    check('S5b 脏值确实落库', b.db_value_after_dirty_write === e.db_value_after_dirty_write,
      `实际 ${b.db_value_after_dirty_write}，期望 ${e.db_value_after_dirty_write}`);
    check('S5b 对话正常收尾', b.terminal_event === e.terminal_event, `实际 ${b.terminal_event}`);
    check('S5b request_id 形状', String(b.request_id).startsWith(e.request_id_prefix),
      `request_id=${b.request_id} 不以 "${e.request_id_prefix}" 开头`);
    for (const needle of e.clamp_log_needles) {
      check(`S5b 夹取告警含 "${needle}"`,
        b.clamp_log_line_count >= e.clamp_log_lines_min
        && b.clamp_log_lines.every(line => line.includes(needle)),
        `日志夹取行 ${b.clamp_log_line_count} 条，样本=${JSON.stringify(b.clamp_log_lines.slice(0, 1))}`);
    }
    check('S5b 夹取告警条数下限', b.clamp_log_line_count >= e.clamp_log_lines_min,
      `实际 ${b.clamp_log_line_count}，下限 ${e.clamp_log_lines_min}`);
    check('S5b 告警带本次 request_id', b.clamp_log_contains_request_id === e.clamp_log_must_include_request_id,
      `实际 ${b.clamp_log_contains_request_id}`);
    check('S5b 告警值确实是夹到上界', b.clamp_log_lines.some(line => line.includes(`已夹取：${b.db_value_before === null ? '' : b.db_value_after_dirty_write} -> ${CLAMPED_MAX}`)),
      `样本=${JSON.stringify(b.clamp_log_lines.slice(0, 1))}`);
    check('S5b agent_rounds 最大轮号未越界', b.max_round_no !== null && b.max_round_no <= e.max_round_no_lte
      && b.max_round_no >= e.max_round_no_gte,
      `MAX(round_no)=${b.max_round_no}（允许 ${e.max_round_no_gte}..${e.max_round_no_lte}）`);
    check('S5b canonical 最大轮号未越界', b.canonical_max_round_no === null
      || (b.canonical_max_round_no <= e.max_round_no_lte && b.canonical_max_round_no >= e.max_round_no_gte),
      `canonical MAX(round_no)=${b.canonical_max_round_no}`);
    check('S5b 改回 affectedRows', b.restore_affected_rows === e.restore_affected_rows,
      `实际 ${b.restore_affected_rows}，期望 ${e.restore_affected_rows}`);
    check('S5b 改回后库值 = 期望原值', b.db_value_after_restore === e.db_value_after_restore,
      `实际 ${b.db_value_after_restore}，期望 ${e.db_value_after_restore}`);
    check('S5b API 回读与库里一致', String(b.api_readback_value) === String(b.db_value_after_restore),
      `API=${b.api_readback_value} 库=${b.db_value_after_restore}`);
  }

  if (facts.s6) {
    const s = facts.s6; const e = exp.s6;
    check('S6 对话确实调了工具', s.tool_call_rows >= e.tool_call_rows_min,
      `chat_tool_calls ${s.tool_call_rows} 行（下限 ${e.tool_call_rows_min}），名字=${s.tool_names.join(',')}`);
    check('S6 工具调用没有报错行', s.tool_error_rows === e.tool_error_rows_exact,
      `is_error=1 的行 ${s.tool_error_rows} 行`);
    check('S6 note_record 落库行数', s.note_rows === e.note_rows_exact,
      `note_key=${s.note_key} 命中 ${s.note_rows} 行（期望 ${e.note_rows_exact}）`);
    check('S6 按 MARKER 搜到的行数', s.note_rows_by_marker === e.note_rows_by_marker_exact,
      `实际 ${s.note_rows_by_marker}（期望 ${e.note_rows_by_marker_exact}），keys=${s.note_rows_by_marker_keys.join(',')}`);
    check('S6 scope_ref 形状是归一化 run-h-<24hex>',
      new RegExp(e.scope_ref_shape).test(String(s.note_scope_refs[0] ?? '')),
      `实际 scope_ref=${JSON.stringify(s.note_scope_refs)}`);
    check('S6 scope_ref **等于**归一化期望值', s.note_scope_refs.length === 1
      && s.note_scope_refs[0] === s.expected_scope_ref,
      `库=${JSON.stringify(s.note_scope_refs)} 期望=${s.expected_scope_ref}`);
    check('S6 期望值与仓内实现算的一致', s.canonical_equals_repo_function === e.canonical_equals_repo_function,
      `仓内=${s.repo_canonical_scope_ref} 自算=${s.expected_scope_ref}`);
    check('S6 record JSON 里含本次 MARKER', s.record_json_contains_marker === e.record_json_contains_marker,
      `实际 ${s.record_json_contains_marker}`);

    check('S6 非法 scopeRef 被拒（抛错）', s.illegal_thrown === e.illegal_throws,
      `实际抛错=${s.illegal_thrown}`);
    check('S6 非法 scopeRef 抛的是 TypeError', s.illegal_error_name === e.illegal_error_name,
      `实际 ${s.illegal_error_name}：${s.illegal_error_message}`);
    check('S6 TypeError 文案是归一化入口那条', String(s.illegal_error_message).includes(e.illegal_error_message),
      `实际文案="${s.illegal_error_message}"`);
    check('S6 非法写入库里无残留行', s.illegal_residual_rows === e.illegal_residual_rows_exact,
      `残留 ${s.illegal_residual_rows} 行`);
    check('S6 adapter scopeRef 不一致被拒', s.adapter_mismatch_thrown === e.adapter_mismatch_throws,
      `实际抛错=${s.adapter_mismatch_thrown}：${s.adapter_mismatch_error_message}`);
    check('S6 adapter 抛的是 TypeError', s.adapter_mismatch_error_name === e.adapter_mismatch_error_name,
      `实际 ${s.adapter_mismatch_error_name}`);
    check('S6 scopeRef 非法不产生 500', s.adapter_mismatch_is_http500 === e.adapter_mismatch_is_http500,
      `实际 http500=${s.adapter_mismatch_is_http500}`);

    check('S6 含冒号 scope 归一化成 run-h- 前缀',
      String(s.legal_hashed_scope_actual).startsWith(e.legal_hashed_scope_ref_prefix),
      `实际 ${s.legal_hashed_scope_actual}`);
    check('S6 归一化值长度 = run-h- + 24', String(s.legal_hashed_scope_actual).length === e.legal_hashed_scope_ref_len,
      `实际长度 ${String(s.legal_hashed_scope_actual).length}`);
    check('S6 含冒号 scope 等于自算 sha256 期望', s.legal_hashed_scope_actual === s.legal_hashed_scope_expected,
      `库=${s.legal_hashed_scope_actual} 期望=${s.legal_hashed_scope_expected}`);
    check('S6 SAFE scope 直通（canonical === 原值）',
      (s.legal_passthrough_scope_actual === s.legal_passthrough_scope_input) === e.legal_passthrough_scope_ref_equals_input,
      `输入=${s.legal_passthrough_scope_input} 库=${s.legal_passthrough_scope_actual}`);
    check('S6 合法写入落库行数', s.legal_rows === e.legal_rows_exact,
      `实际 ${s.legal_rows}，期望 ${e.legal_rows_exact}`);
  }

  void sectionEnabled;
  return { checks, failures: checks.filter(item => !item.ok) };
}

// ---------------------------------------------------------------- --self-test

const TAMPERS = [
  { id: 'A01', target: 's5a.reject_http_status', to: 200, desc: 'S5a 越界 HTTP 期望 400→200（真机 400 必须变红）' },
  { id: 'A02', target: 's5a.reject_code', to: 200, desc: 'S5a body.code 期望 400→200' },
  { id: 'A03', target: 's5a.reject_code_not_200', to: false, desc: 'S5a 把"code!==200"翻成必须等于 200' },
  { id: 'A04', target: 's5a.reject_message_includes', to: '必须是 1-100 之间', desc: 'S5a 拒绝文案区间改成 1-100' },
  { id: 'A05', target: 's5a.reject_body_data_null', to: false, desc: 'S5a 期望拒绝时 data 非 null' },
  { id: 'A06', target: 's5a.reject_db_value_unchanged', to: false, desc: 'S5a 期望"越界写被落库了"（实际没落）' },
  { id: 'A07', target: 's5a.restore_http_status', to: 500, desc: 'S5a 恢复 HTTP 200→500' },
  { id: 'A08', target: 's5a.restore_code', to: 400, desc: 'S5a 恢复 code 200→400' },
  { id: 'A09', target: 's5a.restore_db_value_equals_original', to: false, desc: 'S5a 把"恢复后等于原值"翻成不等' },
  { id: 'B01', target: 's5b.db_value_before', to: 42, desc: 'S5b 改前值期望 49→42' },
  { id: 'B02', target: 's5b.update_affected_rows', to: 2, desc: 'S5b 脏写 affectedRows 1→2' },
  { id: 'B03', target: 's5b.db_value_after_dirty_write', to: 49, desc: 'S5b 期望脏写后仍是 49' },
  { id: 'B04', target: 's5b.terminal_event', to: 'stopped', desc: 'S5b 终态事件期望改 stopped' },
  { id: 'B05', target: 's5b.request_id_prefix', to: 'zzz_', desc: 'S5b request_id 前缀改成 zzz_' },
  { id: 'B06', target: 's5b.clamp_log_needles', to: ['max_tool_rounds 已夹取：60 -> 49'],
    desc: 'S5b 告警 needle 改成夹到 49（真机是 50）' },
  { id: 'B07', target: 's5b.clamp_log_lines_min', to: 999, desc: 'S5b 告警条数下限 1→999' },
  { id: 'B08', target: 's5b.clamp_log_must_include_request_id', to: false,
    desc: 'S5b 把"告警必须带 request_id"翻成必须不带' },
  { id: 'B09', target: 's5b.max_round_no_lte', to: -1, desc: 'S5b 轮数上界 50→-1（任何轮数都越界）' },
  { id: 'B10', target: 's5b.max_round_no_gte', to: 999, desc: 'S5b 轮数下界 0→999' },
  { id: 'B11', target: 's5b.restore_affected_rows', to: 0, desc: 'S5b 改回 affectedRows 1→0' },
  { id: 'B12', target: 's5b.db_value_after_restore', to: 60, desc: 'S5b 期望改回后库值仍是 60（脏值没清）' },
  { id: 'C01', target: 's6.tool_call_rows_min', to: 999, desc: 'S6 工具行数下限 1→999' },
  { id: 'C02', target: 's6.tool_error_rows_exact', to: 1, desc: 'S6 期望出现 1 条工具报错行' },
  { id: 'C03', target: 's6.note_rows_exact', to: 0, desc: 'S6 note 行数期望 1→0' },
  { id: 'C04', target: 's6.note_rows_by_marker_exact', to: 7, desc: 'S6 MARKER 行数期望 1→7' },
  { id: 'C05', target: 's6.scope_ref_shape', to: '^notes-v1:[0-9a-f]{24}$',
    desc: 'S6 期望 scope_ref 形状是未归一化的 notes-v1:（实际 run-h-）' },
  { id: 'C06', target: 's6.canonical_equals_repo_function', to: false,
    desc: 'S6 把"自算期望 == 仓内实现"翻成必须不等' },
  { id: 'C07', target: 's6.record_json_contains_marker', to: false, desc: 'S6 把"record 含 MARKER"翻成不含' },
  { id: 'C08', target: 's6.illegal_throws', to: false, desc: 'S6 期望非法 scopeRef 不抛错' },
  { id: 'C09', target: 's6.illegal_error_name', to: 'RangeError', desc: 'S6 非法错类型 TypeError→RangeError' },
  { id: 'C10', target: 's6.illegal_error_message', to: 'requires a number', desc: 'S6 非法错文案换成没出现过的句子' },
  { id: 'C11', target: 's6.illegal_residual_rows_exact', to: 1, desc: 'S6 期望非法写入残留 1 行（实际 0）' },
  { id: 'C12', target: 's6.adapter_mismatch_throws', to: false, desc: 'S6 期望 adapter scope 不一致不抛错' },
  { id: 'C13', target: 's6.adapter_mismatch_error_name', to: 'NotesStoreError',
    desc: 'S6 adapter 错类型 TypeError→NotesStoreError' },
  { id: 'C14', target: 's6.adapter_mismatch_is_http500', to: true, desc: 'S6 期望非法 scope 触发了 500' },
  { id: 'C15', target: 's6.legal_hashed_scope_ref_prefix', to: 'notes-v1-', desc: 'S6 归一化前缀期望改成 notes-v1-' },
  { id: 'C16', target: 's6.legal_hashed_scope_ref_len', to: 29, desc: 'S6 归一化值长度期望 30→29' },
  { id: 'C17', target: 's6.legal_passthrough_scope_ref_equals_input', to: false,
    desc: 'S6 把"SAFE scope 直通"翻成必须被改写' },
  { id: 'C18', target: 's6.legal_rows_exact', to: 1, desc: 'S6 合法写入行数期望 2→1' },
];

function setPath(obj, dottedPath, value) {
  const parts = dottedPath.split('.');
  let cursor = obj;
  for (const part of parts.slice(0, -1)) cursor = cursor[part];
  cursor[parts.at(-1)] = value;
}

async function selfTest(facts) {
  const baseline = verify(facts);
  log('基线：', `${baseline.checks.length} 条检查，失败 ${baseline.failures.length} 条`);
  for (const failure of baseline.failures) log('  基线失败：', failure.name, failure.detail);
  assert.equal(baseline.failures.length, 0, '基线就没全绿，self-test 无意义');

  const detected = [];
  const missed = [];
  for (const tamper of TAMPERS) {
    const exp = defaultExpectations();
    if (!exp[s5OrS6(tamper.target)]) continue;
    setPath(exp, tamper.target, tamper.to);
    const result = verify(facts, exp);
    if (result.failures.length > 0) detected.push({ ...tamper, tripped: result.failures.map(f => f.name) });
    else missed.push(tamper);
  }
  log(`self-test：检出 ${detected.length} 条 / 未检出 ${missed.length} 条`);
  for (const item of missed) log('  ❌ 未检出（假断言）：', item.id, item.desc);
  return { detected, missed, baseline_checks: baseline.checks.length };
}

const s5OrS6 = dotted => dotted.split('.')[0];

// ---------------------------------------------------------------- --cleanup（只删本次 MARKER）

async function countBy(table, column, ids) {
  if (ids.length === 0) return 0;
  const rows = await sql(
    `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} IN (:ids)`, { ids });
  return Number(rows[0]?.c ?? 0);
}

async function cleanup(facts) {
  const ids = Object.values(facts.request_ids || {});
  assert.ok(ids.length > 0, 'cleanup 需要非空 request_id 列表（别拿整个库开刀）');
  const topicIds = facts.topic_ids || [];
  const noteKeys = [
    `${facts.marker_run}-s6`,
    `${facts.marker_run}-scopeA`,
    `${facts.marker_run}-scopeB`,
    `${facts.marker_run}-illegal`,
    `${facts.marker_run}-adapter`,
  ];

  const before = {};
  for (const [table, column] of CLEAN_TABLES) before[table] = await countBy(table, column, ids);
  const noteBefore = await sql(
    'SELECT COUNT(*) AS c FROM note_record WHERE note_key IN (:keys)', { keys: noteKeys });
  before.note_record = Number(noteBefore[0]?.c ?? 0);
  // topic 只在"除了我的 request 之外没有别的消息"时才删，避免误删共用的老会话
  const foreign = topicIds.length === 0 ? 0 : Number((await sql(
    `SELECT COUNT(*) AS c FROM messages WHERE topic_id IN (:topics) AND request_id NOT IN (:ids)`,
    { topics: topicIds, ids }))[0]?.c ?? 0);
  log('删前回读：', JSON.stringify({ ...before, topic_ids: topicIds, foreign_messages: foreign }));

  for (const [table, column] of CLEAN_TABLES) {
    if (ids.length > 0) await execSql(`DELETE FROM ${table} WHERE ${column} IN (:ids)`, { ids });
  }
  await execSql('DELETE FROM note_record WHERE note_key IN (:keys)', { keys: noteKeys });
  if (topicIds.length > 0 && foreign === 0) {
    await execSql('DELETE FROM topics WHERE id IN (:topics)', { topics: topicIds });
  }

  const after = {};
  for (const [table, column] of CLEAN_TABLES) after[table] = await countBy(table, column, ids);
  const noteAfter = await sql(
    'SELECT COUNT(*) AS c FROM note_record WHERE note_key IN (:keys)', { keys: noteKeys });
  after.note_record = Number(noteAfter[0]?.c ?? 0);
  log('删后回读：', JSON.stringify(after));
  for (const table of [...CLEAN_TABLES.map(item => item[0]), 'note_record']) {
    assert.equal(after[table], 0, `${table} 清理后仍有 ${after[table]} 行`);
  }
  const leftover = await sql(
    `SELECT (SELECT COUNT(*) FROM chat_requests WHERE content LIKE :like) AS reqs,
            (SELECT COUNT(*) FROM messages WHERE content LIKE :like) AS msgs,
            (SELECT COUNT(*) FROM note_record WHERE record LIKE :like) AS notes`,
    { like: `%${facts.marker_run}%` });
  log('MARKER 兜底回读：', JSON.stringify(leftover[0]));
  assert.equal(Number(leftover[0].reqs), 0, '还有含 MARKER 的 chat_requests 行');
  assert.equal(Number(leftover[0].msgs), 0, '还有含 MARKER 的 messages 行');
  assert.equal(Number(leftover[0].notes), 0, '还有含 MARKER 的 note_record 行');
  return { before, after };
}

// ---------------------------------------------------------------- 入口

function parseArgs(argv) {
  const options = { mode: 'run', factsPath: FACTS_PATH, cleanupFrom: null, only: 'all' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--self-test') options.mode = 'self-test';
    else if (arg === '--cleanup') options.mode = 'cleanup';
    else if (arg === '--facts') options.factsPath = argv[++index];
    else if (arg === '--cleanup-from') options.cleanupFrom = argv[++index];
    else if (arg.startsWith('--only=')) options.only = arg.slice('--only='.length);
    else throw new Error(`未知参数：${arg}`);
  }
  if (!['all', 's5', 's6'].includes(options.only)) throw new Error(`--only 只支持 all/s5/s6：${options.only}`);
  return options;
}

function loadFacts(factsPath) {
  assert.ok(fs.existsSync(factsPath), `找不到 facts 文件：${factsPath}（先跑一次不带参数）`);
  return JSON.parse(fs.readFileSync(factsPath, 'utf8'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  log(`模式=${options.mode} only=${options.only} MARKER=${MARKER_RUN} API=${API_BASE} DB=${DB.name}`);

  if (options.mode === 'cleanup') {
    const facts = loadFacts(options.cleanupFrom || options.factsPath);
    const summary = await cleanup(facts);
    log('cleanup 完成：', JSON.stringify(summary));
    return;
  }

  const token = await login();

  if (options.mode === 'self-test') {
    const facts = loadFacts(options.factsPath);
    const result = await selfTest(facts);
    console.log(`\n# self-test：基线 ${result.baseline_checks} 条检查全绿；篡改 ${result.detected.length + result.missed.length} 条 → 检出 ${result.detected.length} / 未检出 ${result.missed.length}`);
    if (result.missed.length > 0) process.exitCode = 1;
    return;
  }

  const facts = await collect(token, options.only);
  const result = verify(facts);
  for (const item of result.checks) {
    console.log(`${item.ok ? '✅' : '❌'} ${item.name}${item.ok ? '' : ` — ${item.detail}`}`);
  }
  console.log(`\n# S5/S6 结果：${result.checks.length - result.failures.length}/${result.checks.length} 通过，失败 ${result.failures.length}`);
  if (result.failures.length > 0) {
    // 红线：即使断言失败，S5b 也已经把 experts 值改回去了（collectS5b 内部无条件改回）
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error('❌ e2e 中断：', error?.stack || error);
    process.exitCode = 1;
  });
}

export { collect, verify, defaultExpectations, expectedCanonicalScopeRef, TAMPERS };
