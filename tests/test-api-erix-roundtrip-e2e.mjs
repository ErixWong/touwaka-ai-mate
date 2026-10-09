/**
 * erix 消息面真机 e2e（#1156 Stage 1：S1–S4 + 检查器自证 --self-test）
 *
 * 对应方案：docs/tasks/active/task-20261008-erix-integration/e2e-plan.md 的 Layer 1 前四条 + Layer 4。
 * 约定沿用 tests/test-api-agent-delegation-chat-e2e.mjs：env 驱动 API_BASE/TEST_ACCOUNT/TEST_PASSWORD、
 * MARKER 打标、node:assert/strict、自带 requestJson()。
 *
 * 用法：
 *   API_BASE=http://127.0.0.1:3017 TEST_ACCOUNT=admin TEST_PASSWORD=password123 \
 *   DB_HOST=127.0.0.1 DB_NAME=touwaka_mate DB_USER=touwaka DB_PASSWORD=*** \
 *     node tests/test-api-erix-roundtrip-e2e.mjs                # 采集 + 断言（真机）
 *   node tests/test-api-erix-roundtrip-e2e.mjs --self-test      # 篡改期望，检查器必须变红
 *   node tests/test-api-erix-roundtrip-e2e.mjs --cleanup        # 只删本次 MARKER 的数据
 *
 * 结构（为了让 --self-test 有牙而不用重跑真机）：
 *   collect()  → 真机跑 S1–S4，把**SQL/API 回读到的原始事实**写进 facts JSON
 *   verify()   → 纯函数 facts × EXPECT（字面期望），产出逐条 check 结果
 *   --self-test → 逐条篡改 EXPECT，喂同一份 facts，**必须变红**；没红的就是假断言
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- 配置（env 驱动）

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3017';
const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
/** 便宜模型（deepseek-flash）+ 会调工具的专家；先 GET /api/chat/experts 证真，再 env 覆盖 */
const EXPERT_ID = process.env.EXPERT_ID || 'mn42wffgyjo4pukj897t';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120000);
const RUN_STAMP = process.env.E2E_RUN_STAMP || String(Date.now());
const MARKER_RUN = `E2E1156_${RUN_STAMP}`;
const FACTS_PATH = process.env.E2E_FACTS_PATH
  || path.resolve(process.cwd(), 'temp', `e2e-stage1-facts-${RUN_STAMP}.json`);

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  name: process.env.DB_NAME || 'touwaka_mate',
  user: process.env.DB_USER || 'touwaka',
  password: process.env.DB_PASSWORD || 'touwaka_secret',
};

const CANONICAL_TABLE = 'agent_transcript_rounds';

/**
 * **期望表（字面量，与 facts 无关）**：--self-test 只篡改这里，facts 保持真机回读值。
 * 任何一条被改坏后 verify 必须变红，否则对应 check 是假断言。
 */
function defaultExpectations() {
  return {
    s1: {
      userRows: 1,               // 无工具单轮：恰好 1 条 user 行（带 MARKER 的那句）
      assistantRowsMin: 1,       // 至少 1 条 assistant 行
      toolRoleRows: 0,           // erix 路径停写 role='tool' 行（agent-loop.js:1023 D2-i）
      canonicalRowsExact: 2,     // 1 行 seed（round 0）+ 1 行引擎轮（round 1）
      canonicalSeedRows: 1,
      canonicalRoundNos: [0, 1],
      // #1147 更正后的预期（Eric 2026-10-09 拍定）：messages[].meta 只在**引擎合成轮**
      // （meta.source = "judge-control"，上游 host-consumer-contract_cn.md:706）才有值，
      // **普通对话轮 meta_json 为 NULL 是正确行为**（不是"未落库"）。
      // 所以：①列必须存在；②落值严格按 record.messages[].meta 有无（parity）；
      // ③普通轮 **显式预期 NULL**（metaJsonNonNullMax=0，不是"无所谓"）。
      // meta_json 的**活数据首证要 judge-control 流程，不属 Stage 1 范围**。
      metaColumnMustExist: true,
      metaJsonParity: true,      // 非空行数 == canonical 里带 meta 的消息数
      metaJsonNonNullMax: 0,     // 普通对话轮：显式预期 NULL
      publicForbiddenKeys: ['meta_json'],   // #1147 公开面：响应里不得出现该字段
    },
    s2: {
      toolCallRowsMin: 1,
      durationMsGt: 0,           // #1151 活数据首证：每一行都要 > 0
      canonicalRowsMin: 3,       // seed + 工具轮 + 收尾轮
      canonicalRoundsWithToolBlockMin: 1,   // record_json 内含 tool_use/tool_result 子块
      toolUseProjectedExact: true,          // 每个 tool_use 块都有同名 chat_tool_calls 行
      toolResultHasResultJson: true,        // 每个 tool_result 块都落 result_json
      expectToolNames: ['note_take'],       // 本轮只允许出现这个本地工具（不出网）
      viewRequireMinRows: 1,                // 公开视图里必须能看到本轮的消息行
      canonicalTextMessagesMin: 1,          // 等价比对口径不能是空集
    },
    s3: {
      rowsAtReusedRound: 2,      // 头号风险：INSERT IGNORE 若吞了用户行 → 只有 1 行
      distinctDedupKeys: 2,
      engineKeyNamespaces: 1,    // 其中 1 行是 :engine:round:N
      inputKeyNamespaces: 1,     // 其中 1 行是 :input:<messageId>
      secondCallWritten: false,  // 同 messageId 重放必须幂等
      secondCallRows: 2,
    },
    s4: {
      rounds: 3,
      sameTopicExact: 1,         // 3 轮必须同一个 topic
      roundStart: 0,             // 每个 request_id 内从 0 开始连续递增
      duplicateRoundTolerance: 0,
      orphanToolRowsExact: 0,    // #1168：单事务之后孤儿 tool 行必须为 0
      resumeRequestIdPrefix: 'req_',
      resumeOriginalStatus: 'stopped',
      resumeCanonicalRowsMin: 2, // resume 那一跑确实又写了 seed + 引擎轮
    },
  };
}

// ---------------------------------------------------------------- 通用工具

function log(...args) {
  console.log('[erix-roundtrip-e2e]', ...args);
}

function hash12(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 12);
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
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
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

/**
 * 打开 SSE 并把**全部**事件收进 events（含收尾事件）。
 * 与既有 e2e 脚本同一套写法，只是额外记 fullRead（是否读到终态事件）。
 */
function openSse({ expert_id, token, events }) {
  const url = new URL('/api/chat/stream', API_BASE);
  url.searchParams.set('expert_id', expert_id);
  url.searchParams.set('token', token);
  const transport = url.protocol === 'https:' ? https : http;
  const req = transport.get(url, { headers: { Accept: 'text/event-stream' } });

  let connected = false;
  let buffer = '';
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

  return { connected: connectedPromise, close() { req.destroy(); } };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------- 登录（最多 2 次，防锁号）

async function login() {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await requestJson('/api/auth/login', {
      method: 'POST',
      body: { account: TEST_ACCOUNT, password: TEST_PASSWORD },
    });
    const token = response.data?.data?.accessToken || response.data?.data?.access_token;
    if (response.status === 200 && typeof token === 'string') return token;
    lastError = `login HTTP ${response.status}: ${JSON.stringify(response.data)}`;
    log(`登录第 ${attempt} 次失败：${lastError}`);
  }
  throw new Error(`登录连续失败 2 次，停止（防锁号）：${lastError}`);
}

async function pickExpert(token) {
  const response = await requestJson('/api/chat/experts', { token });
  assert.equal(response.status, 200, `experts HTTP ${response.status}`);
  const experts = Array.isArray(response.data?.data) ? response.data.data : [];
  assert.ok(experts.length > 0, 'GET /api/chat/experts 返回空列表');
  log('可用专家：', experts.map(e => `${e.id}/${e.name}`).join(', '));
  const picked = experts.find(e => e.id === EXPERT_ID);
  assert.ok(picked, `专家 ${EXPERT_ID} 不在可访问列表里（用 EXPERT_ID 覆盖）`);
  return picked;
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

/** 该 request_id 集合里的孤儿 tool 行（round_id 在 agent_rounds 里找不到宿主轮）。 */
async function orphanToolRows(requestIds) {
  if (requestIds.length === 0) return 0;
  const rows = await sql(`
    SELECT COUNT(*) AS c FROM chat_tool_calls ctc
    LEFT JOIN agent_rounds ar ON ctc.round_id = ar.id
    WHERE ctc.request_id IN (${requestIds.map(() => ':v').join(',')}) AND ar.id IS NULL
  `, { v: requestIds });
  return Number(rows[0]?.c ?? 0);
}

/** meta_json 列存在性（schema 事实，不是跑轮事实）：采集与 self-test 都现查一次。 */
async function attachColumnFact(facts) {
  const rows = await sql(`
    SELECT COUNT(*) AS c FROM information_schema.columns
     WHERE table_schema = :schema AND table_name = 'messages' AND column_name = 'meta_json'
  `, { schema: DB.name });
  facts.db_meta_json_column_present = Number(rows[0]?.c ?? 0) === 1;
  return facts;
}

async function readMessages(requestId) {
  const rows = await sql(`
    SELECT id, role, content, round_id, sequence_no, meta_json,
           CHAR_LENGTH(COALESCE(content,'')) AS content_len
      FROM messages WHERE request_id = :requestId ORDER BY created_at ASC, id ASC
  `, { requestId });
  return {
    total: rows.length,
    by_role: rows.reduce((acc, row) => ({ ...acc, [row.role]: (acc[row.role] || 0) + 1 }), {}),
    meta_non_null: rows.filter(row => row.meta_json !== null && row.meta_json !== '').length,
    rows_with_meta: rows.filter(row => row.meta_json !== null && row.meta_json !== '').length,
    tool_role_rows: rows.filter(row => row.role === 'tool').length,
    rows: rows.map(row => ({
      role: row.role,
      round_id_null: row.round_id === null,
      sequence_no: row.sequence_no,
      content_len: Number(row.content_len ?? 0),
      content_hash: hash12(row.content),
      meta_json_null: row.meta_json === null || row.meta_json === '',
    })),
  };
}

async function readCanonical(requestId) {
  const rows = await sql(`
    SELECT id, round_no, dedup_key, record_json, created_at
      FROM ${CANONICAL_TABLE} WHERE request_id = :requestId
     ORDER BY round_no ASC, created_at ASC, id ASC
  `, { requestId });
  return summarizeCanonical(rows);
}

/** 把 canonical 行拆成"可断言形状"：轮号序列 + 每轮的块类型 + meta 情况。 */
function summarizeCanonical(rows) {
  const per_round = rows.map(row => {
    let record = null;
    try { record = JSON.parse(row.record_json); } catch { record = null; }
    const messages = Array.isArray(record?.messages) ? record.messages : [];
    const blocks = [];
    const textMessages = [];
    let messagesWithMeta = 0;
    for (const message of messages) {
      const content = Array.isArray(message?.content)
        ? message.content
        : (typeof message?.content === 'string' ? [{ type: 'text', text: message.content }] : []);
      for (const block of content) {
        if (block && typeof block === 'object' && typeof block.type === 'string') blocks.push(block.type);
      }
      if (message?.meta !== undefined && message?.meta !== null) messagesWithMeta += 1;
      const text = content
        .filter(block => block?.type === 'text')
        .map(block => String(block.text ?? ''))
        .join('');
      if (text) textMessages.push({ role: message?.role ?? null, content_hash: hash12(text), content_len: text.length });
    }
    return {
      round_no: Number(row.round_no),
      dedup_key: String(row.dedup_key),
      is_seed: String(row.dedup_key).endsWith(':seed'),
      has_tool_block: blocks.includes('tool_use') || blocks.includes('tool_result'),
      block_types: blocks,
      tool_use: content2uses(record),
      tool_results: content2results(record),
      text_messages: textMessages,
      messages_with_meta: messagesWithMeta,
      record_len: String(row.record_json ?? '').length,
    };
  });
  // 种子轮（round 0）的 messages 是**完整初始上下文**（系统提示 + 历史），写入侧
  // 本来就整轮跳过拆行（transcript-store.js "round 0 种子轮整轮跳过拆行"），
  // 所以等价比对只取非种子轮；种子轮另存一份供报告用。
  const nonSeed = per_round.filter(row => !row.is_seed);
  const seed = per_round.filter(row => row.is_seed);
  return {
    total: rows.length,
    round_nos: per_round.map(row => row.round_no),
    dedup_keys: per_round.map(row => row.dedup_key),
    seed_rows: per_round.filter(row => row.is_seed).length,
    rounds_with_tool_block: per_round.filter(row => row.has_tool_block).length,
    messages_with_meta: per_round.reduce((sum, row) => sum + row.messages_with_meta, 0),
    tool_use_blocks: per_round.flatMap(row => row.tool_use.map(u => ({ ...u, round_no: row.round_no }))),
    tool_result_blocks: per_round.flatMap(row => row.tool_results.map(u => ({ ...u, round_no: row.round_no }))),
    text_messages: nonSeed.flatMap(row => row.text_messages),
    seed_text_messages: seed.flatMap(row => row.text_messages),
    per_round,
  };
}

function content2uses(record) {
  const out = [];
  for (const message of (Array.isArray(record?.messages) ? record.messages : [])) {
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const block of content) {
      if (block?.type === 'tool_use') out.push({ tool_use_id: String(block.id ?? ''), name: String(block.name ?? '') });
    }
  }
  return out;
}

function content2results(record) {
  const out = [];
  for (const message of (Array.isArray(record?.messages) ? record.messages : [])) {
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const block of content) {
      if (block?.type === 'tool_result') out.push({ tool_use_id: String(block.tool_use_id ?? '') });
    }
  }
  return out;
}

async function readToolCalls(requestId) {
  const rows = await sql(`
    SELECT tool_use_id, name, round_id, duration_ms, is_error,
           (result_json IS NOT NULL) AS has_result
      FROM chat_tool_calls WHERE request_id = :requestId ORDER BY created_at ASC
  `, { requestId });
  return {
    total: rows.length,
    rows: rows.map(row => ({
      tool_use_id: String(row.tool_use_id),
      name: String(row.name ?? ''),
      round_id: row.round_id,
      duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
      is_error: Number(row.is_error ?? 0) === 1,
      has_result: Number(row.has_result ?? 0) === 1,
    })),
  };
}

// ---------------------------------------------------------------- 真机跑一轮

/** 只发消息、不等结果（给 stop/resume 那种"中途干预"的场景用）。 */
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

/** 把 SSE 读到本 request 的终态事件（complete/error/stopped）才返回。 */
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
  const mine = events.filter(event => event.data?.request_id === request_id);
  const facts = {
    request_id,
    label,
    terminal_event: terminal.event,
    terminal_data: terminal.data ?? null,
    sse_events_total: events.length,
    sse_events_for_request: mine.length,
    sse_event_names: [...new Set(mine.map(event => event.event))],
    delta_chars: mine
      .filter(event => event.event === 'delta' && typeof event.data?.content === 'string')
      .reduce((sum, event) => sum + event.data.content.length, 0),
  };
  assert.ok(allow.includes(terminal.event),
    `${label} 终态事件=${terminal.event}（允许：${allow.join('/')}）：${JSON.stringify(terminal.data)}`);
  return facts;
}

/** 发一轮消息并**把 SSE 读完**（读到本 request 的终态事件才返回）。 */
async function chatRound({ token, expert_id, content, events, label }) {
  const request_id = await sendRound({ token, expert_id, content, label });
  return waitForTerminal({ events, request_id, label });
}

// ---------------------------------------------------------------- 采集（S1–S4）

async function collect(token, expert) {
  const facts = {
    marker_run: MARKER_RUN,
    api_base: API_BASE,
    db_name: DB.name,
    expert_id: expert.id,
    expert_name: expert.name,
    request_ids: {},
    s1: null, s2: null, s3: null, s4: null,
  };
  const events = [];
  const sse = openSse({ expert_id: expert.id, token, events });
  await sse.connected;

  try {
    // ---------------- S1：单轮无工具
    const s1Marker = `${MARKER_RUN}_S1`;
    const s1 = await chatRound({
      token, expert_id: expert.id, events, label: 'S1',
      content: `${s1Marker} 请不要调用任何工具，只用一句话回答："S1 OK"。`,
    });
    const s1Row = (await sql('SELECT * FROM chat_requests WHERE request_id = :id', { id: s1.request_id }))[0];
    facts.request_ids.S1 = s1.request_id;
    facts.s1 = {
      ...s1,
      topic_id: s1Row?.topic_id ?? null,
      request_status: s1Row?.status ?? null,
      messages: await readMessages(s1.request_id),
      canonical: await readCanonical(s1.request_id),
      tool_calls: await readToolCalls(s1.request_id),
      orphan_tool_rows: await orphanToolRows([s1.request_id]),
      api: await readPublicApi(token, s1.request_id, { expert_id: expert.id, topic_id: s1Row?.topic_id }),
    };
    log('S1 完成', JSON.stringify({
      messages: facts.s1.messages.total, canonical: facts.s1.canonical.total,
      meta_non_null: facts.s1.messages.meta_non_null,
    }));

    // ---------------- S2：单轮有工具（本地 note_take，不出网）
    const s2Marker = `${MARKER_RUN}_S2`;
    const s2 = await chatRound({
      token, expert_id: expert.id, events, label: 'S2',
      content: [
        `${s2Marker} 这是一次自动化测试。`,
        '请**必须调用一次工具 note_take**，key 用 "e2e1156"，value 写 "S2 OK"。',
        '调用完成后用一句话回答："S2 OK"。不要调用其它工具。',
      ].join('\n'),
    });
    const s2Row = (await sql('SELECT * FROM chat_requests WHERE request_id = :id', { id: s2.request_id }))[0];
    facts.request_ids.S2 = s2.request_id;
    facts.s2 = {
      ...s2,
      topic_id: s2Row?.topic_id ?? null,
      request_status: s2Row?.status ?? null,
      messages: await readMessages(s2.request_id),
      canonical: await readCanonical(s2.request_id),
      tool_calls: await readToolCalls(s2.request_id),
      orphan_tool_rows: await orphanToolRows([s2.request_id]),
      api: await readPublicApi(token, s2.request_id, { expert_id: expert.id, topic_id: s2Row?.topic_id }),
    };
    log('S2 完成', JSON.stringify({
      tool_rows: facts.s2.tool_calls.total,
      durations: facts.s2.tool_calls.rows.map(row => row.duration_ms),
      canonical: facts.s2.canonical.total,
    }));

    // ---------------- S3：同轮双行（appendUserTurn 直连真库；见报告"发现"）
    // 注：touwaka 的 HTTP 链路里没有任何地方调用 appendUserTurn（只有 erix 自带
    // bin/cli.js / bin/repl.js 调），所以这一条只能在**真 store + 真 DDL + 真引擎函数**
    // 上证：拿 S2 已经跑完的 request_id 作为 transcript key 追加一条用户轮。
    facts.s3 = await collectS3(facts.s2.request_id, s2Row, `${MARKER_RUN}_S3`);

    // ---------------- S4：同会话 3 轮 + stop + retry(resume)
    facts.s4 = await collectS4({ token, expert, sse, events });
    facts.s4.round_request_ids.forEach((id, index) => { facts.request_ids[`S4R${index + 1}`] = id; });
    facts.request_ids.S4STOP = facts.s4.stop_request_id;
    facts.request_ids.S4RESUME = facts.s4.resume_request_id;

    facts.all_request_ids = [...new Set([
      ...Object.values(facts.request_ids).filter(Boolean),
      ...(facts.s4?.all_request_ids || []),
    ])];
    facts.orphan_tool_rows_all = await orphanToolRows(facts.all_request_ids);
  } finally {
    sse.close();
  }

  fs.mkdirSync(path.dirname(FACTS_PATH), { recursive: true });
  await attachColumnFact(facts);
  fs.writeFileSync(FACTS_PATH, JSON.stringify(facts, null, 2));
  log(`facts 已落盘：${FACTS_PATH}`);
  return facts;
}

/**
 * 公开面回读：GET /api/chat/requests/:id + POST /api/messages/query（消息面主入口，
 * 走 message.controller.getMessageListAttributes + mergeToolCallRows + formatMessage）。
 * 另存一份 GET /api/topics/:topicId/messages 的状态码（现网该入口回 500，见报告"发现"）。
 */
async function readPublicApi(token, requestId, { expert_id, topic_id }) {
  const status = await requestJson(`/api/chat/requests/${requestId}`, { token });
  const query = await requestJson('/api/messages/query', {
    method: 'POST',
    token,
    body: {
      filter: { expert_id },
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { page: 1, size: 100, window: 'latest' },
    },
  });
  const payload = query.data?.data ?? {};
  const rows = Array.isArray(payload.items) ? payload.items
    : (Array.isArray(payload.rows) ? payload.rows
      : (Array.isArray(payload.list) ? payload.list
        : (Array.isArray(payload.data) ? payload.data : [])));
  const legacyTopic = topic_id
    ? await requestJson(`/api/topics/${topic_id}/messages?page=1&size=20`, { token })
    : { status: 0, text: '' };
  return {
    request_status_http: status.status,
    request_status_body: status.text,
    messages_query_http: query.status,
    messages_query_body: query.text.slice(0, 400000),
    messages_query_rows: rows.map(row => ({
      request_id: row.request_id ?? null,
      role: row.role,
      content_hash: hash12(row.content),
      content_len: String(row.content ?? '').length,
    })),
    // 旁证：旧 topic 入口在这份部署上是不是真的可用（不参与断言）
    legacy_topic_messages_http: legacyTopic.status,
    legacy_topic_messages_body: legacyTopic.text.slice(0, 500),
  };
}

async function collectS3(requestId, requestRow, marker) {
  const { createErixStore } = await import('../lib/llm-kit-adapters/loop-bridge.js');
  const { appendUserTurn } = await import('erix-agent');
  const sequelize = await db();
  const store = createErixStore({
    db: { sequelize },
    requestContext: {
      request_id: requestId,
      topic_id: requestRow?.topic_id ?? null,
      user_id: requestRow?.user_id ?? null,
      expert_id: requestRow?.expert_id ?? null,
    },
  });

  const before = await readCanonical(requestId);
  const reusedRound = Math.max(...before.round_nos);
  const beforeAtRound = before.per_round.filter(row => row.round_no === reusedRound).length;

  const messageId = `${marker}-input-1`;
  const first = await appendUserTurn(store, {
    key: requestId,
    text: `${marker} 追加的用户轮（e2e S3）`,
    messageId,
  });
  const after = await readCanonical(requestId);
  const afterAtRound = after.per_round.filter(row => row.round_no === reusedRound);
  const second = await appendUserTurn(store, {
    key: requestId,
    text: `${marker} 追加的用户轮（e2e S3）`,
    messageId,
  });
  const after2 = await readCanonical(requestId);

  const out = {
    request_id: requestId,
    reused_round: reusedRound,
    before_rows_at_round: beforeAtRound,
    first_written: first.written,
    first_round: first.round,
    first_dedup_key: first.dedupKey,
    rows_at_round: afterAtRound.length,
    dedup_keys_at_round: afterAtRound.map(row => row.dedup_key),
    engine_keys_at_round: afterAtRound.filter(row => row.dedup_key.includes(':engine:round:')).length,
    input_keys_at_round: afterAtRound.filter(row => row.dedup_key.includes(':input:')).length,
    second_written: second.written,
    rows_at_round_after_second: after2.per_round.filter(row => row.round_no === reusedRound).length,
    canonical_total_after: after.total,
  };
  log('S3 完成', JSON.stringify(out));
  return out;
}

async function collectS4({ token, expert, sse, events }) {
  const roundIds = [];
  const topics = [];
  for (let index = 1; index <= 3; index += 1) {
    const marker = `${MARKER_RUN}_S4R${index}`;
    const round = await chatRound({
      token, expert_id: expert.id, events, label: `S4R${index}`,
      content: `${marker} 请只回答两个字的确认，不要调用工具。`,
    });
    const row = (await sql('SELECT topic_id, status FROM chat_requests WHERE request_id = :id', { id: round.request_id }))[0];
    roundIds.push(round.request_id);
    topics.push(row?.topic_id ?? null);
    log(`S4R${index} 完成 topic=${row?.topic_id} status=${row?.status}`);
  }

  // 第四轮：**先发不等**，一拿到 request_id 就立刻 stop（避开"先跑完再 stop"的竞速），
  // 造出 stopped 态 → 再走 retry（resume 入口）。
  const stopMarker = `${MARKER_RUN}_S4STOP`;
  const stopRequestId = await sendRound({
    token, expert_id: expert.id, label: 'S4STOP',
    content: [
      `${stopMarker} 请先调用一次工具 note_take（key="e2e1156-stop"，value="stop"），`,
      '然后写一篇不少于 800 字的、关于测试标记的说明文。',
    ].join('\n'),
  });
  let stopResult = null;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    stopResult = await requestJson('/api/chat/stop', {
      method: 'POST', token, body: { request_id: stopRequestId },
    });
    if (stopResult.status === 200 && stopResult.data?.code === 200) break;
    await sleep(250);
  }
  const stopRound = await waitForTerminal({
    events, request_id: stopRequestId, label: 'S4STOP', allow: ['stopped', 'complete', 'error'],
  });

  const stoppedRow = (await sql('SELECT status FROM chat_requests WHERE request_id = :id', { id: stopRequestId }))[0];
  const retry = await requestJson(`/api/chat/requests/${stopRequestId}/retry`, {
    method: 'POST', token,
  });
  const resumeRequestId = retry.data?.data?.request_id ?? null;
  if (typeof resumeRequestId === 'string' && resumeRequestId !== stopRequestId) {
    await waitForTerminal({
      events, request_id: resumeRequestId, label: 'S4RESUME', allow: ['complete', 'error', 'stopped'],
    });
  }
  await sleep(1500); // 等落库收尾（appendRound 与请求状态更新不同事务）

  const allIds = [...roundIds, stopRequestId, resumeRequestId].filter(Boolean);
  const perRequest = [];
  for (const requestId of allIds) {
    const canonical = await readCanonical(requestId);
    const messages = await readMessages(requestId);
    const toolCalls = await readToolCalls(requestId);
    const sorted = [...canonical.round_nos].sort((a, b) => a - b);
    perRequest.push({
      request_id: requestId,
      round_nos: canonical.round_nos,
      sorted_round_nos: sorted,
      duplicates: sorted.length - new Set(sorted).size,
      canonical_total: canonical.total,
      messages_total: messages.total,
      tool_rows: toolCalls.total,
      orphan_tool_rows: await orphanToolRows([requestId]),
    });
  }

  const out = {
    round_request_ids: roundIds,
    topics,
    all_request_ids: allIds,
    stop_request_id: stopRequestId,
    stop_http: stopResult?.status ?? null,
    stop_body: stopResult?.text ?? null,
    stop_terminal_event: stopRound.terminal_event,
    stopped_status: stoppedRow?.status ?? null,
    retry_http: retry.status,
    retry_body: retry.text,
    resume_request_id: resumeRequestId,
    per_request: perRequest,
    orphan_tool_rows_total: await orphanToolRows(allIds),
  };
  log('S4 完成', JSON.stringify({
    per_request: perRequest.map(row => ({
      id: row.request_id, rounds: row.round_nos, dups: row.duplicates, orphan: row.orphan_tool_rows,
    })),
    stopped_status: out.stopped_status,
    resume: out.resume_request_id,
  }));
  return out;
}

// ---------------------------------------------------------------- 断言层（纯函数）

function deepCollectKeys(value, acc = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) deepCollectKeys(item, acc);
    return acc;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      acc.add(key);
      deepCollectKeys(child, acc);
    }
  }
  return acc;
}

/** facts × EXPECT → 逐条 check 结果。check 失败**不抛错**，全部收集后统一报告。 */
function verify(facts, exp = defaultExpectations()) {
  const results = [];
  const check = (id, fn) => {
    try {
      fn();
      results.push({ id, ok: true, detail: '' });
    } catch (error) {
      results.push({ id, ok: false, detail: error.message });
    }
  };
  const s1 = facts.s1;
  const s2 = facts.s2;
  const s3 = facts.s3;
  const s4 = facts.s4;

  // ---- S1
  check('s1.sse-fully-read', () => {
    assert.equal(s1.terminal_event, 'complete', `S1 终态事件=${s1.terminal_event}`);
    assert.ok(s1.sse_event_names.includes('start'), `SSE 事件名里没有 start：${JSON.stringify(s1.sse_event_names)}`);
    assert.ok(s1.sse_event_names.includes('complete'), `SSE 没读到 complete：${JSON.stringify(s1.sse_event_names)}`);
    assert.ok(s1.sse_events_for_request >= 3, `本请求 SSE 事件数=${s1.sse_events_for_request}`);
  });
  check('s1.request-visible-via-api', () => {
    assert.equal(s1.api.request_status_http, 200, `GET /api/chat/requests 返回 ${s1.api.request_status_http}`);
    const body = JSON.parse(s1.api.request_status_body);
    assert.equal(body?.data?.request_id, s1.request_id, 'GET /api/chat/requests/:id 取回的不是这一轮');
    assert.equal(body?.data?.status, 'completed', `请求状态=${body?.data?.status}，期望 completed`);
  });
  check('s1.messages-user-rows', () => {
    assert.equal(s1.messages.by_role.user ?? 0, exp.s1.userRows,
      `user 行数=${s1.messages.by_role.user ?? 0}，期望 ${exp.s1.userRows}（全量=${JSON.stringify(s1.messages.by_role)}）`);
  });
  check('s1.messages-assistant-min', () => {
    assert.ok((s1.messages.by_role.assistant ?? 0) >= exp.s1.assistantRowsMin,
      `assistant 行数=${s1.messages.by_role.assistant ?? 0} < ${exp.s1.assistantRowsMin}`);
  });
  check('s1.messages-no-tool-rows', () => {
    assert.equal(s1.messages.tool_role_rows, exp.s1.toolRoleRows,
      `role='tool' 行数=${s1.messages.tool_role_rows}，期望 ${exp.s1.toolRoleRows}`);
  });
  check('s1.canonical-row-count', () => {
    assert.equal(s1.canonical.total, exp.s1.canonicalRowsExact,
      `canonical 行数=${s1.canonical.total}，期望 ${exp.s1.canonicalRowsExact}（轮号=${JSON.stringify(s1.canonical.round_nos)}）`);
  });
  check('s1.canonical-seed-rows', () => {
    assert.equal(s1.canonical.seed_rows, exp.s1.canonicalSeedRows,
      `seed 行数=${s1.canonical.seed_rows}，期望 ${exp.s1.canonicalSeedRows}`);
  });
  check('s1.canonical-round-sequence', () => {
    assert.deepEqual(s1.canonical.round_nos, exp.s1.canonicalRoundNos,
      `轮号序列=${JSON.stringify(s1.canonical.round_nos)}，期望 ${JSON.stringify(exp.s1.canonicalRoundNos)}`);
  });
  check('s1.meta-json', () => {
    if (exp.s1.metaColumnMustExist) {
      assert.equal(facts.db_meta_json_column_present, true,
        `information_schema 里查不到 messages.meta_json 列（收到 ${JSON.stringify(facts.db_meta_json_column_present)}）`);
    }
    if (exp.s1.metaJsonParity) {
      // 落值严格按 record.messages[].meta 有无（#1147 投影保真）
      assert.equal(s1.messages.rows_with_meta, s1.canonical.messages_with_meta,
        `messages.meta_json 非空行=${s1.messages.rows_with_meta}，canonical 带 meta 消息=${s1.canonical.messages_with_meta}（#1147 投影保真）`);
    } else {
      // self-test 专用位：故意把期望翻成"两边必须不等"，真数据 0 == 0 → 必须变红
      assert.notEqual(s1.messages.rows_with_meta, s1.canonical.messages_with_meta,
        'parity 开关被篡改（真数据两边相等，却要求不等）');
    }
    // 普通对话轮：meta_json 为 NULL 是**预期**（写成硬数字，不是"无所谓"）
    assert.ok(s1.messages.rows_with_meta <= exp.s1.metaJsonNonNullMax,
      `普通对话轮 meta_json 非空行=${s1.messages.rows_with_meta}，预期上限 ${exp.s1.metaJsonNonNullMax}（NULL 才是预期）`);
  });
  check('s1.public-surface-no-meta-json', () => {
    for (const body of [s1.api.request_status_body, s1.api.messages_query_body]) {
      const keys = deepCollectKeys(JSON.parse(body));
      for (const forbidden of exp.s1.publicForbiddenKeys) {
        assert.ok(!keys.has(forbidden), `公开响应体里出现了禁止字段 "${forbidden}"`);
      }
    }
  });

  // ---- S2
  check('s2.tool-call-rows', () => {
    assert.ok(s2.tool_calls.total >= exp.s2.toolCallRowsMin,
      `chat_tool_calls 行数=${s2.tool_calls.total} < ${exp.s2.toolCallRowsMin}`);
  });
  check('s2.duration-ms-positive', () => {
    for (const row of s2.tool_calls.rows) {
      assert.ok(row.duration_ms !== null && row.duration_ms > exp.s2.durationMsGt,
        `工具行 ${row.name} duration_ms=${row.duration_ms}，期望 > ${exp.s2.durationMsGt}`);
    }
  });
  check('s2.canonical-row-count', () => {
    assert.ok(s2.canonical.total >= exp.s2.canonicalRowsMin,
      `canonical 行数=${s2.canonical.total} < ${exp.s2.canonicalRowsMin}`);
  });
  check('s2.canonical-tool-subblock', () => {
    assert.ok(s2.canonical.rounds_with_tool_block >= exp.s2.canonicalRoundsWithToolBlockMin,
      `含 tool 子块的 canonical 轮数=${s2.canonical.rounds_with_tool_block} < ${exp.s2.canonicalRoundsWithToolBlockMin}`);
  });
  check('s2.tool-use-projected', () => {
    const byId = new Map(s2.tool_calls.rows.map(row => [row.tool_use_id, row]));
    for (const block of s2.canonical.tool_use_blocks) {
      const row = byId.get(block.tool_use_id);
      assert.ok(row, `canonical tool_use ${block.tool_use_id}(${block.name}) 在 chat_tool_calls 里没有对应行`);
      if (exp.s2.toolUseProjectedExact) {
        assert.equal(row.name, block.name, `tool_use ${block.tool_use_id} name 不一致：${row.name} vs ${block.name}`);
      }
    }
    if (exp.s2.toolResultHasResultJson) {
      for (const block of s2.canonical.tool_result_blocks) {
        const row = byId.get(block.tool_use_id);
        assert.ok(row && row.has_result, `tool_result ${block.tool_use_id} 没有非空 result_json`);
      }
    }
  });
  check('s2.view-equals-canonical', () => {
    const viewRows = s2.api.messages_query_rows.filter(row => row.request_id === s2.request_id);
    assert.ok(viewRows.length >= exp.s2.viewRequireMinRows,
      `公开视图（POST /api/messages/query）里本轮的消息行数=${viewRows.length} < ${exp.s2.viewRequireMinRows}`);
    for (const row of s2.tool_calls.rows) {
      assert.ok(exp.s2.expectToolNames.includes(row.name),
        `出现了期望之外的工具名 ${row.name}，期望集合=${JSON.stringify(exp.s2.expectToolNames)}`);
    }
    const viewHashes = new Set(viewRows.map(row => row.content_hash));
    const dbHashes = new Set(s2.messages.rows.map(row => row.content_hash));
    // 非种子轮的每条文本消息：canonical → messages 投影 → 公开视图，三处内容逐字一致
    for (const message of s2.canonical.text_messages) {
      assert.ok(dbHashes.has(message.content_hash),
        `canonical 文本消息（role=${message.role} len=${message.content_len} hash=${message.content_hash}）在 messages 表里没同内容行`);
      assert.ok(viewHashes.has(message.content_hash),
        `canonical 文本消息（role=${message.role} len=${message.content_len} hash=${message.content_hash}）在公开视图里找不到`);
    }
    assert.ok(s2.canonical.text_messages.length >= exp.s2.canonicalTextMessagesMin,
      `非种子轮文本消息数=${s2.canonical.text_messages.length} < ${exp.s2.canonicalTextMessagesMin}（等价比对口径不能是空集）`);
  });
  check('s2.no-orphan-tool-rows', () => {
    assert.equal(s2.orphan_tool_rows, 0, `S2 孤儿 tool 行=${s2.orphan_tool_rows}`);
  });

  // ---- S3
  check('s3.two-rows-same-round', () => {
    assert.equal(s3.rows_at_round, exp.s3.rowsAtReusedRound,
      `round_no=${s3.reused_round} 上 canonical 行数=${s3.rows_at_round}，期望 ${exp.s3.rowsAtReusedRound}` +
      `（=1 说明 INSERT IGNORE 把 appendUserTurn 的用户行吞了）dedup_key=${JSON.stringify(s3.dedup_keys_at_round)}`);
  });
  check('s3.distinct-dedup-keys', () => {
    assert.equal(new Set(s3.dedup_keys_at_round).size, exp.s3.distinctDedupKeys,
      `round_no=${s3.reused_round} 上不同 dedup_key 数=${new Set(s3.dedup_keys_at_round).size}，期望 ${exp.s3.distinctDedupKeys}`);
  });
  check('s3.key-namespaces', () => {
    assert.equal(s3.engine_keys_at_round, exp.s3.engineKeyNamespaces,
      `引擎命名空间行数=${s3.engine_keys_at_round}，期望 ${exp.s3.engineKeyNamespaces}`);
    assert.equal(s3.input_keys_at_round, exp.s3.inputKeyNamespaces,
      `:input: 命名空间行数=${s3.input_keys_at_round}，期望 ${exp.s3.inputKeyNamespaces}`);
  });
  check('s3.idempotent-replay', () => {
    assert.equal(s3.first_written, true, `首次 appendUserTurn written=${s3.first_written}，期望 true`);
    assert.equal(s3.second_written, exp.s3.secondCallWritten,
      `同 messageId 重放 written=${s3.second_written}，期望 ${exp.s3.secondCallWritten}`);
    assert.equal(s3.rows_at_round_after_second, exp.s3.secondCallRows,
      `重放后同轮行数=${s3.rows_at_round_after_second}，期望 ${exp.s3.secondCallRows}`);
  });

  // ---- S4
  check('s4.same-topic', () => {
    assert.ok(s4.topics.length >= exp.s4.rounds, `采到的轮数=${s4.topics.length} < ${exp.s4.rounds}`);
    assert.ok(s4.topics.every(Boolean), `有轮次没拿到 topic_id：${JSON.stringify(s4.topics)}`);
    assert.equal(new Set(s4.topics).size, exp.s4.sameTopicExact,
      `topic 个数=${new Set(s4.topics).size}，期望 ${exp.s4.sameTopicExact}（${JSON.stringify(s4.topics)}）`);
  });
  check('s4.round-nos-monotonic', () => {
    for (const row of s4.per_request) {
      const sorted = [...row.sorted_round_nos];
      assert.equal(sorted.length - new Set(sorted).size, exp.s4.duplicateRoundTolerance,
        `${row.request_id} 轮号重复数=${sorted.length - new Set(sorted).size}，期望 ${exp.s4.duplicateRoundTolerance}` +
        `（轮号=${JSON.stringify(row.sorted_round_nos)}）`);
      for (let index = 0; index < sorted.length; index += 1) {
        assert.equal(sorted[index], exp.s4.roundStart + index,
          `${row.request_id} 轮号不连续：${JSON.stringify(sorted)}（第 ${index} 位应为 ${exp.s4.roundStart + index}）`);
      }
    }
  });
  check('s4.orphan-tool-rows-zero', () => {
    assert.equal(s4.orphan_tool_rows_total, exp.s4.orphanToolRowsExact,
      `本会话孤儿 tool 行=${s4.orphan_tool_rows_total}，期望 ${exp.s4.orphanToolRowsExact}`);
  });
  check('s4.stop-produced-stopped', () => {
    assert.equal(s4.stopped_status, exp.s4.resumeOriginalStatus,
      `stop 后状态=${s4.stopped_status}，期望 ${exp.s4.resumeOriginalStatus}`);
  });
  check('s4.resume-created-new-request', () => {
    assert.equal(s4.retry_http, 200, `retry HTTP ${s4.retry_http}：${s4.retry_body}`);
    assert.equal(typeof s4.resume_request_id, 'string', `retry 没返回新 request_id：${s4.retry_body}`);
    assert.notEqual(s4.resume_request_id, s4.stop_request_id, 'resume 复用了原 request_id');
    assert.ok(s4.resume_request_id.startsWith(exp.s4.resumeRequestIdPrefix),
      `resume request_id 前缀=${s4.resume_request_id}，期望以 ${exp.s4.resumeRequestIdPrefix} 开头`);
  });
  check('s4.resume-canonical-written', () => {
    const resumeRow = s4.per_request.find(row => row.request_id === s4.resume_request_id);
    assert.ok(resumeRow, `per_request 里没有 resume 行 ${s4.resume_request_id}`);
    assert.ok(resumeRow.canonical_total >= exp.s4.resumeCanonicalRowsMin,
      `resume 那一跑 canonical 行数=${resumeRow.canonical_total} < ${exp.s4.resumeCanonicalRowsMin}`);
  });

  return results;
}

// ---------------------------------------------------------------- --self-test（检查器的牙齿）

const TAMPERS = [
  { id: 'T01', target: 's1.userRows', to: 0, desc: 'S1 user 行数期望 1→0' },
  { id: 'T02', target: 's1.assistantRowsMin', to: 99, desc: 'S1 assistant 行数下限 1→99' },
  { id: 'T03', target: 's1.toolRoleRows', to: 1, desc: 'S1 期望出现 1 条 role=tool 行（实际 0）' },
  { id: 'T04', target: 's1.canonicalRowsExact', to: 1, desc: 'S1 canonical 期望行数 2→1（方案给的篡改例）' },
  { id: 'T05', target: 's1.canonicalSeedRows', to: 0, desc: 'S1 seed 行期望 1→0' },
  { id: 'T06', target: 's1.canonicalRoundNos', to: [0, 2], desc: 'S1 轮号序列改成 [0,2]' },
  { id: 'T07', target: 's1.metaJsonNonNullMax', to: -1, desc: 'S1 把"普通轮 meta_json 预期 NULL"推到不可能（0→-1）' },
  { id: 'T29', target: 's1.metaJsonParity', to: false, desc: 'S1 把 parity 翻成"两边必须不等"（真数据 0==0 → 必须变红）' },
  { id: 'T08', target: 's1.publicForbiddenKeys', to: ['meta_json', 'content'], desc: 'S1 公开面禁字段加上确实存在的 content' },
  { id: 'T09', target: 's2.toolCallRowsMin', to: 999, desc: 'S2 工具行下限 1→999' },
  { id: 'T10', target: 's2.durationMsGt', to: 100000, desc: 'S2 duration_ms 阈值 0→100000（方案给的篡改例）' },
  { id: 'T11', target: 's2.canonicalRowsMin', to: 999, desc: 'S2 canonical 行数下限 3→999' },
  { id: 'T12', target: 's2.canonicalRoundsWithToolBlockMin', to: 99, desc: 'S2 含 tool 子块的轮数下限 1→99' },
  { id: 'T13', target: 's2.expectToolNames', to: ['fs__list_files'], desc: 'S2 期望工具名换成实际没出现的 fs__list_files' },
  { id: 'T14', target: 's2.viewRequireMinRows', to: 99, desc: 'S2 公开视图行数下限 1→99' },
  { id: 'T28', target: 's2.canonicalTextMessagesMin', to: 99, desc: 'S2 非种子轮文本消息下限 1→99（防"空集也算等价"）' },
  { id: 'T15', target: 's3.rowsAtReusedRound', to: 1, desc: 'S3 同轮期望 2 行→1 行（头号风险的篡改例）' },
  { id: 'T16', target: 's3.distinctDedupKeys', to: 1, desc: 'S3 期望 dedup_key 只有 1 个' },
  { id: 'T17', target: 's3.inputKeyNamespaces', to: 0, desc: 'S3 期望 :input: 命名空间行数 1→0' },
  { id: 'T18', target: 's3.secondCallWritten', to: true, desc: 'S3 期望重放 written=true（实际幂等 false）' },
  { id: 'T19', target: 's3.secondCallRows', to: 3, desc: 'S3 期望重放后同轮 3 行' },
  { id: 'T20', target: 's4.duplicateRoundTolerance', to: 3, desc: 'S4 允许重复轮号 0→3（方案给的篡改例）' },
  { id: 'T21', target: 's4.roundStart', to: 1, desc: 'S4 轮号起始 0→1（要求从 1 开始连续）' },
  { id: 'T22', target: 's4.orphanToolRowsExact', to: 9, desc: 'S4 孤儿 tool 行期望 0→9' },
  { id: 'T23', target: 's4.resumeOriginalStatus', to: 'completed', desc: 'S4 stop 后状态期望改成 completed' },
  { id: 'T24', target: 's4.resumeRequestIdPrefix', to: 'zzz_', desc: 'S4 resume request_id 前缀换成 zzz_' },
  { id: 'T27', target: 's4.sameTopicExact', to: 2, desc: 'S4 期望 topic 个数 1→2（证明同会话断言有牙）' },
  { id: 'T25', target: 's4.resumeCanonicalRowsMin', to: 999, desc: 'S4 resume canonical 行数下限 2→999' },
  { id: 'T26', target: 's4.rounds', to: 99, desc: 'S4 期望轮数 3→99' },
];

function setPath(obj, dottedPath, value) {
  const parts = dottedPath.split('.');
  let cursor = obj;
  for (const part of parts.slice(0, -1)) cursor = cursor[part];
  cursor[parts.at(-1)] = value;
}

function getPath(obj, dottedPath) {
  return dottedPath.split('.').reduce((cursor, part) => cursor?.[part], obj);
}

function selfTest(facts) {
  const baseline = verify(facts, defaultExpectations());
  const baselineFailing = baseline.filter(row => !row.ok);
  const rows = [];

  for (const tamper of TAMPERS) {
    const before = getPath(defaultExpectations(), tamper.target);
    if (before === tamper.to) {
      rows.push({ ...tamper, detected: false, note: '篡改值与期望值相同（无效篡改）', newly_failing: [] });
      continue;
    }
    const mutated = defaultExpectations();
    setPath(mutated, tamper.target, tamper.to);
    const after = verify(facts, mutated);
    const baselineIds = new Set(baseline.map(row => row.id));
    const newlyFailing = after.filter(row => !row.ok && !baselineIds.has(row.id)).map(row => row.id);
    const stillFailing = after.filter(row => !row.ok).map(row => row.id);
    const detected = after.filter(row => !row.ok).length > baselineFailing.length;
    rows.push({
      ...tamper,
      detected,
      newly_failing: newlyFailing.length ? newlyFailing : stillFailing,
      note: detected ? '' : '未检出 → 假断言',
    });
  }

  return { baseline, baselineFailing, rows };
}

// ---------------------------------------------------------------- --cleanup（只删本次 MARKER）

const CLEAN_TABLES = [
  ['chat_tool_calls', 'request_id'],
  ['messages', 'request_id'],
  [CANONICAL_TABLE, 'request_id'],
  ['agent_rounds', 'request_id'],
  ['note_record', 'scope_ref'],
  ['chat_requests', 'request_id'],
];

async function cleanup(markerRun, requestIds) {
  const ids = [...new Set(requestIds.filter(Boolean))];
  assert.ok(ids.length > 0, 'cleanup 需要非空 request_id 列表（别拿整个库开刀）');
  log(`cleanup marker=${markerRun}，${ids.length} 个 request_id`, ids.join(', '));

  const countBy = async (table, column) => (await sql(
    `SELECT COUNT(*) c FROM ${table} WHERE ${column} IN (${ids.map(() => ':v').join(',')})`, { v: ids },
  ))[0].c;

  const before = {};
  for (const [table, column] of CLEAN_TABLES) before[table] = Number(await countBy(table, column));
  log('删前回读：', JSON.stringify(before));

  // chat_requests 里 retry 产生的 original_request_id 也一并清（内容含 MARKER，仍属本次数据）
  const derived = await sql(
    `SELECT request_id FROM chat_requests WHERE original_request_id IN (${ids.map(() => ':v').join(',')})`,
    { v: ids },
  );
  const extra = derived.map(row => row.request_id).filter(id => !ids.includes(id));
  if (extra.length > 0) log('额外发现的 retry 派生 request_id：', extra.join(', '));
  const allIds = [...ids, ...extra];

  const sequelize = await db();
  for (const [table, column] of CLEAN_TABLES) {
    await sequelize.query(
      `DELETE FROM ${table} WHERE ${column} IN (${allIds.map(() => ':v').join(',')})`,
      { replacements: { v: allIds } },
    );
  }

  const after = {};
  for (const [table, column] of CLEAN_TABLES) after[table] = Number(await countBy(table, column));
  log('删后回读：', JSON.stringify(after));
  for (const [table] of CLEAN_TABLES) {
    assert.equal(after[table], 0, `${table} 清理后仍有 ${after[table]} 行（MARKER 数据没删干净）`);
  }
  // MARKER 兜底：消息内容里还能搜到 MARKER 的行必须是 0
  const leftover = await sql(
    `SELECT (SELECT COUNT(*) FROM chat_requests WHERE content LIKE :like) AS reqs,
            (SELECT COUNT(*) FROM messages WHERE content LIKE :like) AS msgs`,
    { like: `%${markerRun}%` },
  );
  log('MARKER 兜底回读：', JSON.stringify(leftover[0]));
  assert.equal(Number(leftover[0].reqs), 0, '还有含 MARKER 的 chat_requests 行');
  assert.equal(Number(leftover[0].msgs), 0, '还有含 MARKER 的 messages 行');

  return { before, after, all_ids: allIds };
}

// ---------------------------------------------------------------- 入口

function parseArgs(argv) {
  const options = { mode: 'run', factsPath: FACTS_PATH, cleanupFrom: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--self-test') options.mode = 'self-test';
    else if (arg === '--cleanup') options.mode = 'cleanup';
    else if (arg === '--facts') options.factsPath = argv[++index];
    else if (arg === '--cleanup-from') options.cleanupFrom = argv[++index];
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function readFacts(filePath) {
  assert.ok(fs.existsSync(filePath), `找不到 facts 文件：${filePath}（先跑默认模式采集）`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function printResults(results) {
  for (const row of results) {
    log(row.ok ? `  ✅ ${row.id}` : `  ❌ ${row.id} — ${row.detail}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === 'cleanup') {
    const factsPath = options.cleanupFrom || options.factsPath;
    const facts = readFacts(factsPath);
    const summary = await cleanup(facts.marker_run, [
      ...Object.values(facts.request_ids || {}).filter(Boolean),
      ...(facts.all_request_ids || []),
      ...(facts.s4?.round_request_ids || []),
      facts.s4?.stop_request_id, facts.s4?.resume_request_id,
    ]);
    console.log(JSON.stringify(summary, null, 2));
    await (await db()).close();
    return;
  }

  if (options.mode === 'self-test') {
    const facts = readFacts(options.factsPath);
    await attachColumnFact(facts);   // schema 事实现查（不依赖旧 facts 文件里有没有）
    const { baseline, baselineFailing, rows } = selfTest(facts);
    console.log('== 基线（未篡改）==');
    printResults(baseline);
    console.log(`基线失败条数：${baselineFailing.length}/${baseline.length}`);
    console.log('\n== 篡改自证 ==');
    for (const row of rows) {
      console.log(`${row.detected ? '检出' : '未检出'}\t${row.id}\t${row.target}→${JSON.stringify(row.to)}` +
        `\t${row.desc}\t${row.detected ? `变红检查：${row.newly_failing.join(',') || '-'}` : row.note}`);
    }
    const missed = rows.filter(row => !row.detected);
    console.log(`\n检出 ${rows.length - missed.length}/${rows.length}；未检出：${missed.map(row => row.id).join(',') || '（无）'}`);
    assert.equal(missed.length, 0, `假断言：${missed.map(row => `${row.id}(${row.target})`).join(', ')}`);
    return;
  }

  const token = await login();
  const expert = await pickExpert(token);
  const facts = await collect(token, expert);
  const results = verify(await attachColumnFact(facts), defaultExpectations());
  console.log('== S1–S4 断言 ==');
  printResults(results);
  const failing = results.filter(row => !row.ok);
  console.log(`\n失败 ${failing.length}/${results.length}`);
  console.log('request_ids:', JSON.stringify(facts.request_ids, null, 2));
  console.log('全部 request_ids:', (facts.all_request_ids || []).join('\n'));
  assert.equal(failing.length, 0, `${failing.length} 条断言失败：${failing.map(row => row.id).join(', ')}`);
  log('全部通过 ✅');
  await (await db()).close();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error('[erix-roundtrip-e2e] 失败：', error?.message ?? error);
    if (process.env.E2E_VERBOSE === '1' && error?.stack) console.error(error.stack);
    process.exitCode = 1;
    if (sequelizeInstance) sequelizeInstance.close().finally(() => process.exit(1));
    else process.exit(1);
  });
}

export { verify, defaultExpectations, TAMPERS, selfTest };
