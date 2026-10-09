#!/usr/bin/env node
/**
 * 消息读接口 HTTP 层回归（真机 e2e，需要服务在线）
 *
 * 用法：
 *   API_BASE=http://localhost:3000 TEST_ACCOUNT=xxx TEST_PASSWORD=xxx \
 *     node tests/test-api-message-read-e2e.mjs
 *
 * 被删的三条旧接口（#1188）默认**跳过**断言：沙箱里跑的是新代码，但正在运行的服务
 * 往往还是旧代码。部署新代码后加 EXPECT_DELETED=1 再跑一次，即可断言它们已 404：
 *   EXPECT_DELETED=1 API_BASE=... TEST_ACCOUNT=... TEST_PASSWORD=... node tests/test-api-message-read-e2e.mjs
 *
 * 登录取 token 的字段是 data.access_token（不是 data.token）。
 */

import assert from 'node:assert/strict';

const API_BASE = (process.env.API_BASE || 'http://localhost:3000').replace(/\/$/, '');
const ACCOUNT = process.env.TEST_ACCOUNT || '';
const PASSWORD = process.env.TEST_PASSWORD || '';
const EXPECT_DELETED = process.env.EXPECT_DELETED === '1';

let passed = 0;
let failed = 0;
let skipped = 0;

function record(ok, title, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`✅ ${title}`);
  } else {
    failed += 1;
    console.log(`❌ ${title}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(title, why) {
  skipped += 1;
  console.log(`⏭️  ${title} — ${why}`);
}

async function request(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

/** 活着的读接口：200 + code===200 + data.items 是数组 */
async function checkLiveList(token, title, path) {
  const res = await request('GET', path, { token });
  const okStatus = res.status === 200;
  const okCode = res.json?.code === 200;
  const okItems = Array.isArray(res.json?.data?.items);
  record(
    okStatus && okCode && okItems,
    title,
    `status=${res.status} code=${res.json?.code} items=${Array.isArray(res.json?.data?.items) ? 'array' : String(typeof res.json?.data?.items)}`,
  );
  return res.json?.data?.items || [];
}

async function checkDeleted(title, path, opts = {}) {
  if (!EXPECT_DELETED) {
    skip(title, '待部署后开启（EXPECT_DELETED=1）');
    return;
  }
  const res = await request('GET', path, opts);
  record(res.status === 404, `${title}（已删，应 404）`, `status=${res.status}`);
}

async function main() {
  assert.ok(ACCOUNT && PASSWORD, '必须设置 TEST_ACCOUNT / TEST_PASSWORD');
  console.log(`# 消息读接口 e2e — API_BASE=${API_BASE} EXPECT_DELETED=${EXPECT_DELETED ? '1' : '0(跳过已删断言)'}`);

  // 1) 登录
  const login = await request('POST', '/api/auth/login', { body: { account: ACCOUNT, password: PASSWORD } });
  const token = login.json?.data?.access_token;
  assert.ok(token, `登录失败：status=${login.status} body=${login.text.slice(0, 300)}`);
  console.log(`✅ 登录成功（access_token 长度 ${String(token).length}）`);

  // 2) 取一个 expert（读接口都按 expert 维度）
  const experts = await request('GET', '/api/experts', { token });
  const expertId = experts.json?.data?.items?.[0]?.id ?? experts.json?.data?.[0]?.id;
  assert.ok(expertId, `拿不到 expert_id：status=${experts.status} body=${experts.text.slice(0, 300)}`);
  console.log(`   expert_id = ${expertId}`);

  // 3) 活着的三条读接口
  const items = await checkLiveList(token, `GET /api/messages/expert/:expertId`, `/api/messages/expert/${expertId}?page=1&size=5`);
  await checkLiveList(token, `GET /api/messages/expert/:expertId/since`, `/api/messages/expert/${expertId}/since?limit=5`);

  const messageId = items[0]?.id;
  if (messageId) {
    await checkLiveList(
      token,
      'GET /api/messages/expert/:expertId/with-before/:messageId',
      `/api/messages/expert/${expertId}/with-before/${messageId}?limit=5`,
    );
  } else {
    skip('GET .../with-before/:messageId', '该 expert 没有消息，拿不到 messageId');
  }

  // 4) POST /api/messages/query（必须带 filter.expert_id，否则 400）
  const query = await request('POST', '/api/messages/query', {
    token,
    body: {
      filter: { expert_id: expertId },
      sort: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
      pagination: { page: 1, size: 5, window: 'latest' },
    },
  });
  record(
    query.status === 200 && query.json?.code === 200,
    'POST /api/messages/query（filter.expert_id）',
    `status=${query.status} code=${query.json?.code}`,
  );

  // 5) 已删的三条接口（默认跳过）
  await checkDeleted('GET /api/messages?topic_id=…', `/api/messages?topic_id=${messageId || 'no-such-topic'}`, { token });
  await checkDeleted('GET /api/messages/:id', `/api/messages/${messageId || 'no-such-message'}`, { token });
  await checkDeleted('GET /api/topics/:topicId/messages', `/api/topics/${messageId || 'no-such-topic'}/messages`, { token });
  if (!EXPECT_DELETED) {
    console.log('   ↑ 三条已删接口的 404 断言需部署新代码后加 EXPECT_DELETED=1 开启');
  }

  console.log(`\n# 结果：✅ ${passed} / ❌ ${failed} / ⏭️ ${skipped}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('❌ e2e 中断：', error?.stack || error);
  process.exitCode = 1;
});
