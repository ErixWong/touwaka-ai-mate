/**
 * loadByDedupKey 候选集上界（issue #1166）
 *
 * 背景：issue #1166 之前专家级 max_tool_rounds 无服务端校验，会话轮数可以远超 1–50
 * 约定上限；而快路径探针 loadByDedupKey 取候选时不设 LIMIT，roundKey 支路谓词落在
 * record_json 上又没索引 → 候选集与随后的子行 IN(...) 随会话长度线性膨胀。
 * 本次给候选加了"最近 N 条"上界（默认见 DEFAULT_DEDUP_CANDIDATE_LIMIT），
 * **判据本身不许改**。
 *
 * 本文件的判别点：
 *   1. 正常情况下真命中必须仍然命中——且真命中**不是最新那条候选**（最新那条是
 *      dedupKey 已定义、按上游 `??` 判据必须 miss 的伪候选）。把上界改成 `LIMIT 1`
 *      这里必须 fail（工单验收里的变异 ③）。
 *   2. 多条候选同时能被判据命中时，返回的必须是 load() 顺序里最早的那条
 *      —— 倒序取回后没翻正就会挂（窗口语义不许改判据，也不许改命中优先级）。
 *   3. 超出窗口的语义：真命中落在最近 N 条之外 → 返回与今天完全一致的"未命中"
 *      结果 `null`（不抛错、不放宽判据），同一份数据把窗口放宽回去又必须命中。
 *   4. 默认窗口远高于 max_tool_rounds 的 1–50 上限；环境变量覆盖解析有兜底。
 *   5. 判别面自证：候选 SQL 里真的带了 LIMIT，且候选数确实 > 1（否则前 3 条是空跑）。
 *
 * 真实 MariaDB，凭据 ~/.config/mcp/creds/touwaka-test-db.json（缺失则 skip）；
 * 只清理本文件自己写入的 runId 行。
 */

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import logger from '../../lib/logger.js';
for (const method of ['info', 'warn', 'error', 'debug']) {
  if (typeof logger[method] === 'function') logger[method] = () => {};
}

import { openTestDatabase, DEFAULT_CREDS_PATH } from '../helpers/test-db-guard.mjs';
import {
  createTouwakaTranscriptStore,
  DEFAULT_DEDUP_CANDIDATE_LIMIT,
  DEDUP_CANDIDATE_LIMIT_ENV,
  resolveDedupCandidateLimit,
} from '../../lib/llm-kit-adapters/transcript-store.js';

// issue #1167：目标库必须是测试库（openTestDatabase 内部在建连之前硬断言）。
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
let db = null;
let requestContext = null;
let ns = null;

if (dbCtx) {
  db = dbCtx.db;
  const [user] = await db.sequelize.query('SELECT id FROM users LIMIT 1');
  const [expert] = await db.sequelize.query('SELECT id FROM experts LIMIT 1');
  ns = randomUUID().slice(0, 8);
  requestContext = {
    topic_id: null,
    user_id: user?.[0]?.id ?? 'u_dedupcap',
    expert_id: expert?.[0]?.id ?? null,
  };
}

function runId(label) {
  return `run-${ns}-cap-${label}`;
}

async function cleanup() {
  if (!db) return;
  const [rounds] = await db.sequelize.query(
    'SELECT id FROM agent_rounds WHERE request_id LIKE :pattern',
    { replacements: { pattern: `run-${ns}-cap-%` } },
  );
  const roundIds = rounds.map((row) => row.id);
  if (roundIds.length > 0) {
    await db.sequelize.query('DELETE FROM messages WHERE round_id IN (:roundIds)', { replacements: { roundIds } });
    await db.sequelize.query('DELETE FROM chat_tool_calls WHERE round_id IN (:roundIds)', { replacements: { roundIds } });
  }
  // #1156 Stage B：canonical 与展示面同事务写入，清理也要一起清
  await db.sequelize.query('DELETE FROM agent_transcript_rounds WHERE request_id LIKE :pattern', { replacements: { pattern: `run-${ns}-cap-%` } });
  await db.sequelize.query('DELETE FROM agent_rounds WHERE request_id LIKE :pattern', { replacements: { pattern: `run-${ns}-cap-%` } });
}

after(async () => {
  if (!db) return;
  await cleanup();
  if (typeof db.close === 'function') await db.close();
  else if (db.sequelize) await db.sequelize.close();
});

/** 用 env 覆盖窗口（用例内局部生效，退出即还原） */
async function withCandidateLimit(value, callback) {
  const previous = process.env[DEDUP_CANDIDATE_LIMIT_ENV];
  if (value === undefined) delete process.env[DEDUP_CANDIDATE_LIMIT_ENV];
  else process.env[DEDUP_CANDIDATE_LIMIT_ENV] = String(value);
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env[DEDUP_CANDIDATE_LIMIT_ENV];
    else process.env[DEDUP_CANDIDATE_LIMIT_ENV] = previous;
  }
}

/** 按 SQL OR 谓词数一遍候选行数——用来自证"窗口/ LIMIT 1"的判别面真的存在 */
async function countCandidates(id, probeKey) {
  const [rows] = await db.sequelize.query(`
    SELECT COUNT(*) AS candidate_rows
    FROM agent_rounds
    WHERE request_id = :runId
      AND (dedup_key = :dedupKey
           OR JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.roundKey')) = :dedupKey)
  `, { replacements: { runId: id, dedupKey: probeKey } });
  return Number(rows[0]?.candidate_rows ?? 0);
}

/**
 * 种一个"真命中不是最新候选"的会话：
 *   round 1 —— dedupKey = TRUE_KEY（真命中，按上游判据命中）
 *   round 2..extraRounds+1 —— dedupKey 各自唯一、但 record_json.roundKey == TRUE_KEY
 *     → 它们进入 SQL 候选集，却必须被 JS 判据 miss（dedupKey 已定义且不等）
 */
async function seedSessionWithTrailingDecoys(store, id, { decoys = 4 } = {}) {
  const trueKey = `${id}:input:m-true`;
  await store.appendRound(id, {
    round: 1,
    dedupKey: trueKey,
    roundKey: `${id}:round:1`,
    ts: '2026-10-01T00:01:00.000Z',
    messages: [{ role: 'user', content: [{ type: 'text', text: '真命中的预写用户轮' }] }],
  });
  for (let index = 0; index < decoys; index += 1) {
    const round = index + 2;
    await store.appendRound(id, {
      round,
      dedupKey: `${id}:engine:round:${round}`,
      // 故意与 round 1 的 dedupKey 同名：SQL OR 的 roundKey 支路会把它捞进候选集
      roundKey: trueKey,
      ts: `2026-10-01T00:0${index + 2}:00.000Z`,
      messages: [{ role: 'assistant', content: [{ type: 'text', text: `引擎第 ${round} 轮` }] }],
    });
  }
  return trueKey;
}

if (!creds) {
  test('loadByDedupKey 候选上界（真实 MariaDB）', { skip: `缺少凭据 ${CREDS_PATH}` }, () => {});
} else {
  beforeEach(cleanup);

  test('真命中必须仍然命中：最新候选是伪候选时也不许 miss（LIMIT 1 会挂）', async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId('true-hit');
    const trueKey = await seedSessionWithTrailingDecoys(store, id, { decoys: 4 });

    // 判别面自证：SQL 候选集里确实有多条，且最新那条按判据必须 miss
    const candidateRows = await countCandidates(id, trueKey);
    assert.ok(candidateRows >= 5,
      `候选集必须有多条（否则本用例对 LIMIT 1 没有判别力），实际 ${candidateRows} 条`);

    const loaded = await store.load(id);
    const expected = loaded.find((record) => (record.dedupKey ?? record.roundKey) === trueKey);
    assert.ok(expected, '全量路径必须能命中，否则快路径的"命中"无从谈起');
    assert.equal(expected.round, 1, '真命中必须是 round 1（最新候选是伪候选）');
    const newestCandidate = loaded.at(-1);
    assert.notEqual(newestCandidate.dedupKey, trueKey,
      '最新候选不能就是真命中，否则 LIMIT 1 也能过，本用例失去判别力');

    const probed = await store.loadByDedupKey(id, trueKey);
    assert.deepStrictEqual(probed, expected, 'loadByDedupKey 必须返回与 load() 同一条记录');
    assert.deepStrictEqual(Object.keys(probed ?? {}).sort(), Object.keys(expected).sort(),
      '探针返回的字段集合必须与 load() 一致（不许残缺）');

    // 伪候选本身也不能被判据接受（判据不许被放宽）：拿它的 roundKey 去探，
    // 拿回来的必须是真命中那条，而不是它自己。
    for (const record of loaded) {
      if (record.dedupKey === trueKey) continue;
      if (record.roundKey !== trueKey) continue;
      const probedDecoy = await store.loadByDedupKey(id, record.roundKey);
      assert.deepStrictEqual(probedDecoy, expected,
        `伪候选（round=${record.round}）的 roundKey 与真命中同名，探针必须返回真命中那条`);
      assert.notEqual(probedDecoy.round, record.round,
        `dedupKey 已定义且不等时，不能仅因 roundKey=${record.roundKey} 就命中伪候选`);
    }
  });

  test('多条候选都能命中时，必须返回 load() 顺序里最早的那条（倒序取回要翻正）', async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId('first-match');
    const sharedRoundKey = `${id}:input:m-shared`;
    // 两条都没有写入 dedupKey（宿主补的列值不会被回填）→ 判据回落到 roundKey，两条都能命中
    for (const round of [3, 4]) {
      await store.appendRound(id, {
        round,
        roundKey: sharedRoundKey,
        ts: `2026-10-01T00:0${round}:00.000Z`,
        messages: [{ role: 'assistant', content: [{ type: 'text', text: `第 ${round} 轮` }] }],
      });
    }

    const loaded = await store.load(id);
    const matches = loaded.filter((record) => (record.dedupKey ?? record.roundKey) === sharedRoundKey);
    assert.equal(matches.length, 2, '本用例需要两条都能被判据命中');
    assert.equal(matches[0].round, 3);

    assert.deepStrictEqual(await store.loadByDedupKey(id, sharedRoundKey), matches[0],
      '必须与全量路径一致：取 load() 顺序里的第一条，而不是最新一条');
  });

  test('超出窗口：真命中按"未命中"语义返回 null，放宽窗口回去又必须命中', async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId('window-overflow');
    const trueKey = await seedSessionWithTrailingDecoys(store, id, { decoys: 4 });
    const loaded = await store.load(id);
    const expected = loaded.find((record) => (record.dedupKey ?? record.roundKey) === trueKey);
    assert.equal(expected.round, 1);

    // 窗口收到 1：最近 1 条候选是伪候选 → 真命中落在窗口外 → 必须"未命中"
    await withCandidateLimit(1, async () => {
      assert.equal(resolveDedupCandidateLimit(), 1);
      assert.equal(await store.loadByDedupKey(id, trueKey), null,
        '窗口外的真命中必须返回与今天一致的未命中结果 null（不抛错、不放宽判据）');
    });

    // 同一份数据、默认窗口 → 必须命中，证明上一条的 miss 是窗口造成的，而不是判据被改坏
    assert.deepStrictEqual(await store.loadByDedupKey(id, trueKey), expected);

    // 窗口刚好覆盖到真命中所在的候选位次时也必须命中：候选共 5 条（round 1..5），
    // 取最近 5 条正好把 round 1 纳进来
    await withCandidateLimit(5, async () => {
      assert.deepStrictEqual(await store.loadByDedupKey(id, trueKey), expected,
        '窗口刚好覆盖到真命中时必须命中（上界只限取多少候选，不改判据）');
    });
    await withCandidateLimit(4, async () => {
      assert.equal(await store.loadByDedupKey(id, trueKey), null,
        '窗口差一条就按未命中处理（语义边界，勿改判据去"救"它）');
    });
  });

  test('候选 SQL 确实带上界，且默认值远高于 1–50 约定上限、env 解析有兜底', async () => {
    assert.ok(Number.isSafeInteger(DEFAULT_DEDUP_CANDIDATE_LIMIT) && DEFAULT_DEDUP_CANDIDATE_LIMIT > 50,
      `默认候选窗口必须远高于 max_tool_rounds 的 50 上限，实际 ${DEFAULT_DEDUP_CANDIDATE_LIMIT}`);
    assert.equal(resolveDedupCandidateLimit(), DEFAULT_DEDUP_CANDIDATE_LIMIT, '默认走常量');

    await withCandidateLimit(0, async () => {
      assert.equal(resolveDedupCandidateLimit(), DEFAULT_DEDUP_CANDIDATE_LIMIT, '0 不是合法窗口');
    });
    await withCandidateLimit('-3', async () => {
      assert.equal(resolveDedupCandidateLimit(), DEFAULT_DEDUP_CANDIDATE_LIMIT, '负数不是合法窗口');
    });
    await withCandidateLimit('abc', async () => {
      assert.equal(resolveDedupCandidateLimit(), DEFAULT_DEDUP_CANDIDATE_LIMIT, '非数字退回默认');
    });
    await withCandidateLimit('', async () => {
      assert.equal(resolveDedupCandidateLimit(), DEFAULT_DEDUP_CANDIDATE_LIMIT, '空串等于没设');
    });
    await withCandidateLimit(7, async () => {
      assert.equal(resolveDedupCandidateLimit(), 7, '合法整数必须生效');
    });

    // 真到 SQL 上去看：候选查询必须带 ORDER BY round_no DESC + LIMIT
    const sqls = [];
    const replacements = [];
    const spyingDb = {
      sequelize: {
        query: (sql, options) => {
          sqls.push(String(sql));
          replacements.push(options?.replacements);
          return db.sequelize.query(sql, options);
        },
        // #1156 Stage B：appendRound 现在走单事务，替身必须把 transaction 也转发到真
        // sequelize（替身要建模完整接口），否则写路直接 TypeError。
        transaction: (handler) => db.sequelize.transaction((tx) => handler(tx)),
      },
    };
    const store = createTouwakaTranscriptStore({ db: spyingDb, requestContext });
    const id = runId('sql-shape');
    const trueKey = await seedSessionWithTrailingDecoys(store, id, { decoys: 4 });
    sqls.length = 0;
    replacements.length = 0;
    assert.ok(await store.loadByDedupKey(id, trueKey), '探针必须命中');

    const candidateSql = sqls.find((sql) => /FROM agent_rounds/.test(sql) && /dedup_key = :dedupKey/.test(sql));
    assert.ok(candidateSql, '没找到取候选的 agent_rounds 查询');
    assert.match(candidateSql, /ORDER BY round_no DESC, id DESC/, '候选必须按最近优先取');
    assert.match(candidateSql, /LIMIT :candidateLimit/, '候选查询必须带上界');
    const used = replacements[sqls.indexOf(candidateSql)];
    assert.equal(used.candidateLimit, DEFAULT_DEDUP_CANDIDATE_LIMIT,
      '候选上界必须作为参数进 SQL（不许拼字符串）');

    await withCandidateLimit(3, async () => {
      replacements.length = 0;
      await store.loadByDedupKey(id, trueKey);
      const usedOverride = replacements.find((item) => item && 'candidateLimit' in item);
      assert.equal(usedOverride.candidateLimit, 3, '环境变量覆盖必须真的进 SQL');
    });
  });

  test('小会话（候选远少于窗口）行为与全量路径逐条一致，上界不误伤', async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId('small-session');
    await store.appendRound(id, {
      round: 0,
      roundKey: `${id}:round:0`,
      dedupKey: `${id}:engine:round:0:seed`,
      ts: '2026-10-01T00:00:00.000Z',
      messages: [{ role: 'user', content: [{ type: 'text', text: '初始上下文' }] }],
      summary: 'seed',
    });
    await seedSessionWithTrailingDecoys(store, id, { decoys: 2 });

    const loaded = await store.load(id);
    assert.ok(loaded.length >= 4);
    for (const record of loaded) {
      const probeKey = record.dedupKey ?? record.roundKey;
      assert.deepStrictEqual(await store.loadByDedupKey(id, probeKey), record,
        `第 ${record.round} 轮必须仍能被取回（逐字段一致）`);
    }
  });
}
