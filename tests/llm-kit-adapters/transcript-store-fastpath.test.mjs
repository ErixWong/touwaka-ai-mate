/**
 * touwaka TranscriptStore × erix-agent 0.17.0 成对可选快路径探针（issue #1150，上游 #157）
 *
 * 覆盖 issue #1150 验收标准 5 的全部判别点，外加一次真实引擎调用（`appendUserTurn`
 * 是 erix-agent 导出的引擎侧写前入口，快路径逻辑全在它内部）：
 *
 *   1. 差异对等：探针返回的 record 与 `load()` 对应轮的输出**整条对象** deepStrictEqual
 *      （键集合也单独比对，防“字段值碰巧对得上、多/少字段却看不见”）
 *   2. 命中路径根本不调 `load`（计数桩 + load 抛错桩双重取证）
 *   3. 成对语义：只实现一条探针 == 都没实现（引擎回退全量 load，load 调用次数 > 0）
 *   4. 探针返回类型违约 → 引擎抛 TypeError（不静默降级）
 *   5. `loadByDedupKey` 返回残缺 record / `loadMaxRound` 与 `load()` 不一致时，
 *      本文件的断言必须 fail（每条正向断言都配一个**故意改坏**的负控，见最后两节）
 *
 * 真实 MariaDB，凭据 ~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 * 本文件只清理自己写入的 runId 行。
 */

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

import Database from "../../lib/db.js";
import { createTouwakaTranscriptStore } from "../../lib/llm-kit-adapters/transcript-store.js";
// appendUserTurn 是引擎侧入口（node_modules/erix-agent/src/store/append-user-turn.js）：
// dedupKey 派生、快/慢路径选择、类型违约抛错全在引擎代码里，本文件不重写这些规则。
import { appendUserTurn } from "erix-agent";

const CREDS_PATH = join(homedir(), ".config/mcp/creds/touwaka-test-db.json");

function loadCreds() {
  try {
    return JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  } catch {
    return null;
  }
}

const creds = loadCreds();
let db = null;
let requestContext = null;
let ns = null;

if (creds) {
  db = new Database({
    database: creds.database,
    user: creds.user,
    password: creds.password,
    host: creds.host,
    port: creds.port,
  });
  await db.connect();
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  const [expert] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  ns = randomUUID().slice(0, 8);
  requestContext = { topic_id: null, user_id: user?.[0]?.id ?? "u_fastpath", expert_id: expert?.[0]?.id ?? null };
}

function runId(label) {
  return `run-${ns}-fp-${label}`;
}

async function cleanup() {
  if (!db) return;
  const [rounds] = await db.sequelize.query(
    "SELECT id FROM agent_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern: `run-${ns}-fp-%` } },
  );
  const roundIds = rounds.map((row) => row.id);
  if (roundIds.length > 0) {
    await db.sequelize.query("DELETE FROM messages WHERE round_id IN (:roundIds)", { replacements: { roundIds } });
    await db.sequelize.query("DELETE FROM chat_tool_calls WHERE round_id IN (:roundIds)", { replacements: { roundIds } });
  }
  await db.sequelize.query("DELETE FROM agent_rounds WHERE request_id LIKE :pattern", { replacements: { pattern: `run-${ns}-fp-%` } });
}

after(async () => {
  if (!db) return;
  await cleanup();
  if (typeof db.close === "function") await db.close();
  else if (db.sequelize) await db.sequelize.close();
});

// ── 契约语义的本地可复用断言（正向 + 负控共用）──

/** 全量路径的最大轮派生：逐字照抄 erix appendUserTurn 慢路径的算法。 */
function maxRoundFromLoad(loaded) {
  return Math.max(0, ...loaded.map((record) => (
    Number.isSafeInteger(record?.round) ? record.round : 0
  )));
}

/** loadMaxRound 必须与 load() 派生值等价（引擎快/慢路径据此必须同结论）。 */
async function assertMaxRoundMatchesLoad(store, key) {
  const loaded = await store.load(key);
  const probed = await store.loadMaxRound(key);
  if (!(probed === null || probed === undefined)) {
    assert.ok(typeof probed === "number" && Number.isSafeInteger(probed),
      `loadMaxRound 必须返回安全整数或 null/undefined，实际 ${typeof probed} ${probed}`);
  }
  assert.equal(probed === null || probed === undefined ? 0 : Math.max(0, probed),
    maxRoundFromLoad(loaded),
    `loadMaxRound(${key})=${probed} 与 load() 派生的 max round 不一致`);
}

/**
 * 探针一致性：会话里**每一轮**都要能被自己的 dedupKey（有 roundKey 时还要能被
 * roundKey）取回，且整条对象与 load() 的那条 deepStrictEqual。
 * 探针返回残缺 record（少 messages / 少 response / 少未知字段）时这里必挂。
 */
async function assertProbesMatchLoad(store, key) {
  const loaded = await store.load(key);
  assert.ok(loaded.length > 0, "会话里至少要有一轮，否则本断言没有判别力");
  for (const record of loaded) {
    // 探针键按契约谓词本身取：(record.dedupKey ?? record.roundKey)
    const probeKey = record.dedupKey ?? record.roundKey;
    assert.ok(typeof probeKey === "string" && probeKey !== "",
      `该轮既无 dedupKey 也无 roundKey，谓词命中不了：${JSON.stringify(record).slice(0, 120)}`);
    const byDedupKey = await store.loadByDedupKey(key, probeKey);
    assert.deepStrictEqual(byDedupKey, record,
      `loadByDedupKey(${probeKey}) 与 load() 对应轮不是同一份记录`);
    assert.deepStrictEqual(Object.keys(byDedupKey ?? {}).sort(), Object.keys(record).sort(),
      `loadByDedupKey(${probeKey}) 字段集合与 load() 不一致`);
    if (typeof record.roundKey === "string" && record.roundKey !== probeKey) {
      assert.deepStrictEqual(await store.loadByDedupKey(key, record.roundKey), record,
        `roundKey 兜底谓词取不回同一份记录：${record.roundKey}`);
    }
  }
  return loaded;
}

/** 计数包装：记录 load / 两条探针的调用次数，用于证明快路径没碰 load。 */
function withCallCounts(store) {
  const counts = { load: 0, loadByDedupKey: 0, loadMaxRound: 0 };
  const wrapped = {
    appendRound: (key, record) => store.appendRound(key, record),
    load: async (key) => { counts.load += 1; return store.load(key); },
  };
  // 探针“存在与否”必须原样保留：成对语义的用例依赖包装后的方法面与内部 store 一致
  if (typeof store.loadByDedupKey === "function") {
    wrapped.loadByDedupKey = async (key, dedupKey) => {
      counts.loadByDedupKey += 1; return store.loadByDedupKey(key, dedupKey);
    };
  }
  if (typeof store.loadMaxRound === "function") {
    wrapped.loadMaxRound = async (key) => {
      counts.loadMaxRound += 1; return store.loadMaxRound(key);
    };
  }
  return { counts, store: wrapped };
}

/** 只保留指定探针方法（模拟“只实现一条”），其余能力原样透传。 */
function withProbes(store, { withDedup, withMax }) {
  const wrapped = {
    appendRound: (key, record) => store.appendRound(key, record),
    load: async (key) => store.load(key),
  };
  if (withDedup) wrapped.loadByDedupKey = (key, dedupKey) => store.loadByDedupKey(key, dedupKey);
  if (withMax) wrapped.loadMaxRound = (key) => store.loadMaxRound(key);
  return wrapped;
}

// 一个覆盖面足够宽的会话：种子轮 + 工具轮（含 messages[].meta / response）
// + 折叠轮 + appendUserTurn 预写的同轮行（dedupKey≠roundKey 命名的 roundKey 行）。
async function seedBroadSession(store, id) {
  await store.appendRound(id, {
    round: 0,
    roundKey: `${id}:round:0`,
    dedupKey: `${id}:engine:round:0:seed`,
    ts: "2026-10-01T00:00:00.000Z",
    messages: [
      { role: "system", content: [{ type: "text", text: "系统技能提示" }] },
      { role: "user", content: [{ type: "text", text: "5 天前的问题" }] },
    ],
    summary: "seed",
  });
  await store.appendRound(id, {
    round: 1,
    roundKey: `${id}:round:1`,
    dedupKey: `${id}:engine:round:1`,
    ts: "2026-10-01T00:01:00.000Z",
    meta: { hostMetadata: { retained: true }, deep: { list: [1, 2, 3] } },
    messages: [
      { role: "user", content: [{ type: "text", text: "看一下目录" }], meta: { source: "judge-control" } },
      {
        role: "assistant",
        content: [
          { type: "text", text: "我来列一下" },
          { type: "reasoning", text: "需要 exec" },
          { type: "tool_use", id: `tu-${ns}-1`, name: "bash", input: { cmd: "ls" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `tu-${ns}-1`, content: "README.md" }] },
    ],
    response: {
      content: [{ type: "tool_use", id: `tu-${ns}-1`, name: "bash", input: { cmd: "ls" } }],
      stopReason: "tool_use",
      usage: { prompt_tokens: 21, completion_tokens: 6 },
    },
    textPreview: "我来列一下",
  });
  await store.appendRound(id, {
    round: 1,
    dedupKey: `${id}:input:m-pre`,
    roundKey: `${id}:input:m-pre`,
    ts: "2026-10-01T00:01:30.000Z",
    messages: [{ role: "user", content: [{ type: "text", text: "预写的用户轮" }] }],
  });
  await store.appendRound(id, {
    round: 2,
    roundKey: `${id}:round:2`,
    dedupKey: `${id}:engine:round:2`,
    ts: "2026-10-01T00:02:00.000Z",
    folded: true,
    foldedRoundRange: { from: 0, to: 1 },
    foldedPayload: [{ role: "user", content: [{ type: "text", text: "early" }] }],
    messages: [{ role: "assistant", content: [{ type: "text", text: "折叠后的摘要轮" }] }],
  });
}

if (!creds) {
  test("touwaka TranscriptStore 快路径探针（真实 MariaDB）", {
    skip: `缺少凭据 ${CREDS_PATH}`,
  }, () => {});
} else {
  beforeEach(cleanup);

  // ── 能力档位（issue #1150：从“两条探针都不实现”变成“两条都实现”）──

  test("store 方法面 = 必需面 + 成对快路径探针；其余可选 capability 仍不实现", () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    assert.deepEqual(Object.keys(store).sort(),
      ["appendRound", "load", "loadByDedupKey", "loadMaxRound"]);
    for (const optional of [
      "saveRunState", "loadRunState", "markRunState",
      "saveRunSnapshot", "loadLatestRunSnapshot",
      "saveCheckpoint", "appendCheckpoint", "loadLatestCheckpoint",
    ]) {
      assert.equal(store[optional], undefined, `不应实现可选方法 ${optional}`);
    }
  });

  // ── 验收标准 5-1：差异对等 ──

  test("差异对等：探针返回的 record 与 load() 对应轮逐字段一致（含键集合）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("diff-equal");
    await seedBroadSession(store, id);

    const loaded = await assertProbesMatchLoad(store, id);
    // 判别面自证：会话里必须真的含种子轮 / 工具轮 / 折叠轮 / dedupKey≠roundKey 的行，
    // 否则上面的 deepStrictEqual 会退化成只比对最简单的那种记录。
    assert.deepEqual(loaded.map((record) => record.round), [0, 1, 1, 2]);
    assert.ok(loaded.some((record) => record.round === 0 && record.summary === "seed"),
      "种子轮（messages 只存在于 record_json）未被覆盖");
    assert.ok(loaded.some((record) => record.response?.stopReason === "tool_use"),
      "工具轮（response + tool_use/tool_result 拆行）未被覆盖");
    assert.ok(loaded.some((record) => record.folded === true), "折叠轮未被覆盖");
    assert.ok(loaded.some((record) => record.messages?.some((message) => message.meta)),
      "messages[].meta 保真未被覆盖");
  });

  test("探针谓词按 key 收窄，未命中返回 null（不抛错、不跨会话误命中）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const a = runId("scope-a");
    const b = runId("scope-b");
    await seedBroadSession(store, a);
    // 同 dedupKey/roundKey 形状的字段名，另一会话；用 a 的 key 查不到 b 的行
    await store.appendRound(b, {
      round: 7,
      dedupKey: "shared:input:m-pre",
      roundKey: "shared:input:m-pre",
      ts: "2026-10-01T00:07:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "另一会话" }] }],
    });

    assert.equal(await store.loadByDedupKey(a, "shared:input:m-pre"), null,
      "探针必须按 key（request_id）收窄，与 load(key) 的可见范围一致");
    assert.equal(await store.loadByDedupKey(a, `${a}:input:no-such-message`), null);
    assert.equal(await store.loadByDedupKey(b, "shared:input:m-pre").then((r) => r.round), 7);
    // roundKey 兜底支路也不许越界：a 会话里没有 b 的那个 roundKey
    assert.equal(await store.loadByDedupKey(a, "shared:input:m-pre"), null);
  });

  // ── loadMaxRound 与 load() 等价（含历史脏 round_no）──

  test("loadMaxRound ≡ load() 派生的 max round；空会话返回 null", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("max-round");
    assert.equal(await store.loadMaxRound(id), null, "空会话必须返回 null（引擎据此派生 round 0）");

    await seedBroadSession(store, id);
    await assertMaxRoundMatchesLoad(store, id);
    assert.equal(await store.loadMaxRound(id), 2);

    // 历史脏行：直接 SQL 写一行比引擎更大的 round_no（探针必须跟着 load() 一起变）
    await db.sequelize.query(`
      INSERT INTO agent_rounds
        (id, request_id, round_no, dedup_key, stop_reason, \`usage\`, latency_ms,
         folded, folded_range, record_json, ts, created_at)
      VALUES (:id, :runId, 99, :dedupKey, NULL, NULL, NULL, b'0', NULL, NULL, :ts, :now)
    `, {
      replacements: {
        id: `round_dirty_${ns}`, runId: id, dedupKey: `${id}:engine:round:99`,
        ts: "2026-10-01T00:99:00.000Z", now: new Date(),
      },
    });
    await assertMaxRoundMatchesLoad(store, id);
    assert.equal(await store.loadMaxRound(id), 99, "脏 round_no 必须与 load() 同结论");

    // 负数 round（另一会话）：load() 侧 Math.max(0, -5) = 0，探针返回 -5 或 0 都等价
    const negative = runId("max-round-negative");
    await db.sequelize.query(`
      INSERT INTO agent_rounds
        (id, request_id, round_no, dedup_key, stop_reason, \`usage\`, latency_ms,
         folded, folded_range, record_json, ts, created_at)
      VALUES (:id, :runId, -5, :dedupKey, NULL, NULL, NULL, b'0', NULL, NULL, :ts, :now)
    `, {
      replacements: {
        id: `round_neg_${ns}`, runId: negative, dedupKey: `${negative}:engine:round:-5`,
        ts: "2026-10-01T00:00:00.000Z", now: new Date(),
      },
    });
    await assertMaxRoundMatchesLoad(store, negative);
  });

  // ── 验收标准 5-2 与 6：真实引擎调用，命中路径零 load ──

  test("真实引擎调用 appendUserTurn：快路径全程零 load（计数桩 + 抛错桩双重取证）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("engine-fastpath");
    await seedBroadSession(store, id);

    const { store: counted, counts } = withCallCounts(store);
    const first = await appendUserTurn(counted, {
      key: id, text: "第一轮用户输入", messageId: "m-real-engine-1",
    });
    assert.equal(first.written, true, "首次必须真的写入");
    assert.equal(first.round, 2, "round 复用现有最大轮（2），与全量路径同结论");
    assert.equal(counts.load, 0, "快路径不得调用 store.load");
    assert.equal(counts.loadByDedupKey, 1, "未命中路径：loadByDedupKey 恰好一次");
    assert.equal(counts.loadMaxRound, 1, "未命中路径：loadMaxRound 恰好一次");

    const countsAfterFirst = { ...counts };
    const second = await appendUserTurn(counted, {
      key: id, text: "第一轮用户输入", messageId: "m-real-engine-1",
    });
    assert.equal(second.written, false, "同 messageId 重跑必须幂等，不再写");
    assert.equal(second.dedupKey, first.dedupKey);
    assert.equal(counts.load - countsAfterFirst.load, 0, "命中路径也不得调用 store.load");
    assert.equal(counts.loadByDedupKey - countsAfterFirst.loadByDedupKey, 1);
    // 命中即返回：连 loadMaxRound 都不该调（上游明文：两个探针与 load 都不再调用）
    assert.equal(counts.loadMaxRound - countsAfterFirst.loadMaxRound, 0,
      "命中路径不应再调用 loadMaxRound");

    // 命中返回的 record 与库里那一轮逐字段一致（不是引擎临时拼的近似对象）
    const fromLoad = (await store.load(id)).find((record) => record.dedupKey === first.dedupKey);
    assert.ok(fromLoad, "预写的用户轮必须真的落库");
    assert.deepStrictEqual(second.record, fromLoad);

    // 抛错桩：load 一旦被调用直接抛，命中路径必须不受影响
    const explosive = {
      appendRound: (key, record) => store.appendRound(key, record),
      load: async () => { throw new Error("load 不该被调用（快路径）"); },
      loadByDedupKey: (key, dedupKey) => store.loadByDedupKey(key, dedupKey),
      loadMaxRound: (key) => store.loadMaxRound(key),
    };
    const third = await appendUserTurn(explosive, {
      key: id, text: "第一轮用户输入", messageId: "m-real-engine-1",
    });
    assert.equal(third.written, false, "load 抛错仍能正确命中 → 证明命中路径确实没碰 load");
    assert.deepStrictEqual(third.record, fromLoad);

    // 落库形态：同 dedupKey 只有一行，且不因探针产生孤儿拆行
    const [rows] = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM agent_rounds WHERE request_id = :id AND dedup_key = :dedupKey",
      { replacements: { id, dedupKey: first.dedupKey } },
    );
    assert.equal(rows[0].n, 1);
  });

  // ── 验收标准 5-3：成对语义（只实现一条 == 都没实现）──

  test("成对语义：只实现一条探针时引擎回退全量 load，三种实现的结论仍一致", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("paired-semantics");
    await seedBroadSession(store, id);

    const cases = [
      { label: "两条都不实现", probes: { withDedup: false, withMax: false }, expectFast: false },
      { label: "只实现 loadByDedupKey", probes: { withDedup: true, withMax: false }, expectFast: false },
      { label: "只实现 loadMaxRound", probes: { withDedup: false, withMax: true }, expectFast: false },
      { label: "两条都实现", probes: { withDedup: true, withMax: true }, expectFast: true },
    ];
    const outcomes = [];
    for (const [index, testCase] of cases.entries()) {
      const { store: wrapped, counts } = withCallCounts(withProbes(store, testCase.probes));
      // 每个用例用不同 messageId：都走“未命中 → 派生 round → 写入”这条完整路径
      const result = await appendUserTurn(wrapped, {
        key: id, text: `探针档位 ${index}`, messageId: `m-paired-${index}`,
      });
      outcomes.push({ label: testCase.label, result, counts: { ...counts } });
      if (testCase.expectFast) {
        assert.equal(counts.load, 0, `${testCase.label}：快路径不该调用 load`);
      } else {
        assert.ok(counts.load >= 1,
          `${testCase.label}：必须回退全量 load（成对语义被破坏——只实现一条也被当成实现了）`);
        assert.equal(counts.loadByDedupKey, 0, `${testCase.label}：不该调用未实现的探针`);
        assert.equal(counts.loadMaxRound, 0, `${testCase.label}：不该调用未实现的探针`);
      }
    }

    // 快/慢路径同结论：round 派生与 written 语义不因档位变化
    const [reference] = outcomes;
    for (const outcome of outcomes) {
      assert.equal(outcome.result.round, reference.result.round,
        `${outcome.label}：round 与全量路径不一致`);
      assert.equal(outcome.result.written, reference.result.written,
        `${outcome.label}：written 与全量路径不一致`);
    }
    // 四种档位写入的都是同一 max round（2）
    assert.equal(reference.result.round, 2);
  });

  // ── 验收标准 5-4：类型违约抛 TypeError（不静默降级）──

  test("探针返回类型违约时引擎抛 TypeError（store bug 不许静默降级）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("type-violation");
    await seedBroadSession(store, id);
    const dedupKey = `${id}:input:m-type`;
    await store.appendRound(id, {
      round: 3, dedupKey, roundKey: dedupKey, ts: "2026-10-01T00:03:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "已存在的预写轮" }] }],
    });

    const base = (overrides) => ({
      appendRound: (key, record) => store.appendRound(key, record),
      load: (key) => store.load(key),
      loadByDedupKey: (key, dedupKey2) => store.loadByDedupKey(key, dedupKey2),
      loadMaxRound: (key) => store.loadMaxRound(key),
      ...overrides,
    });

    // loadByDedupKey 命中但返回非对象（字符串）→ TypeError
    await assert.rejects(
      appendUserTurn(base({ loadByDedupKey: async () => "not-a-record" }),
        { key: id, text: "x", messageId: "m-type" }),
      (error) => error instanceof TypeError && /loadByDedupKey/.test(error.message),
    );

    // loadMaxRound 返回字符串 / 小数 / NaN → TypeError（未命中路径才会调它）
    for (const bad of ["3", 1.5, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      await assert.rejects(
        appendUserTurn(base({
          loadByDedupKey: async () => null,
          loadMaxRound: async () => bad,
        }), { key: id, text: "x", messageId: `m-type-${String(bad)}` }),
        (error) => error instanceof TypeError && /loadMaxRound/.test(error.message),
        `loadMaxRound 返回 ${String(bad)} 必须抛 TypeError`,
      );
    }

    // 我们自己的 store 不会给出违约类型：真实值只有 safe integer | null
    assert.equal(await store.loadMaxRound(id), 3);
    assert.equal(await store.loadMaxRound(runId("type-none")), null);
  });

  // ── 验收标准 5-5：残缺 record 判别（故意改坏 → 断言必须 fail）──

  test("负控：残缺 record / 探针不一致 / 档位改坏时，本文件的断言必须 fail", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("negative-controls");
    await seedBroadSession(store, id);

    // 正向基线（先证明断言在当前实现上是通过的，否则下面的 rejects 没有意义）
    await assertProbesMatchLoad(store, id);
    await assertMaxRoundMatchesLoad(store, id);

    // (a) loadByDedupKey 返回残缺 record：去掉 messages → 必挂
    const strippedMessages = {
      ...store,
      loadByDedupKey: async (key, dedupKey) => {
        const record = await store.loadByDedupKey(key, dedupKey);
        if (!record) return null;
        const { messages, ...rest } = record;
        return rest;
      },
    };
    await assert.rejects(assertProbesMatchLoad(strippedMessages, id),
      (error) => error instanceof assert.AssertionError,
      "残缺 record（缺 messages）必须被差异对等断言抓到");

    // (b) 返回“看起来对但少了未知字段”：删掉引擎不认识的宿主字段 → 也要挂
    const strippedUnknown = {
      ...store,
      loadByDedupKey: async (key, dedupKey) => {
        const record = await store.loadByDedupKey(key, dedupKey);
        if (!record) return null;
        const { textPreview, summary, ...rest } = record;
        return rest;
      },
    };
    await assert.rejects(assertProbesMatchLoad(strippedUnknown, id),
      assert.AssertionError, "丢掉未知字段（textPreview/summary）必须被抓到");

    // (c) messages[].meta 丢失（#1147 的保真点）→ 也要挂
    const strippedMessageMeta = {
      ...store,
      loadByDedupKey: async (key, dedupKey) => {
        const record = await store.loadByDedupKey(key, dedupKey);
        if (!record) return null;
        return {
          ...record,
          messages: (record.messages ?? []).map(({ meta, ...message }) => message),
        };
      },
    };
    await assert.rejects(assertProbesMatchLoad(strippedMessageMeta, id),
      assert.AssertionError, "messages[].meta 丢失必须被抓到");

    // (d) 只保留 dedup_key 主谓词（丢掉 record_json.roundKey 兜底支路）→ 必挂。
    // seedBroadSession 里引擎轮的 roundKey(`<id>:round:N`) 与 dedupKey(`<id>:engine:round:N`)
    // 刻意不同名，故只按 dedup_key 匹配的实现取不到 roundKey 那一支。
    const dedupKeyOnlyPredicate = {
      ...store,
      loadByDedupKey: async (key, dedupKey) => {
        const loaded = await store.load(key);
        return loaded.find((record) => record.dedupKey === dedupKey) ?? null;
      },
    };
    await assert.rejects(assertProbesMatchLoad(dedupKeyOnlyPredicate, id),
      assert.AssertionError, "丢掉 roundKey 兜底谓词必须被差异对等断言抓到");

    // (e) loadMaxRound 与 load() 不一致（例如漏掉脏行 / off-by-one）→ 必挂
    for (const [label, broken] of [
      ["off-by-one", async (key) => Math.max(0, (await store.loadMaxRound(key)) ?? 0) - 1],
      ["返回字符串", async () => "2"],
      ["返回行数", async (key) => (await store.load(key)).length],
    ]) {
      await assert.rejects(assertMaxRoundMatchesLoad({ ...store, loadMaxRound: broken }, id),
        (error) => error instanceof assert.AssertionError,
        `loadMaxRound 改成${label}后必须被断言抓到`);
    }

    // (f) 成对语义被改坏（只实现一条也走快路径）→ 回退断言必挂
    const halfFast = {
      appendRound: (key, record) => store.appendRound(key, record),
      load: async (key) => store.load(key),
      loadByDedupKey: (key, dedupKey) => store.loadByDedupKey(key, dedupKey),
      // 故意没有 loadMaxRound，但 appendUserTurn 的实现要求成对，故仍会回退；
      // 这里断言的是“引擎确实回退了”，即 load 被调用。
    };
    const halfCounts = { load: 0 };
    halfFast.load = async (key) => { halfCounts.load += 1; return store.load(key); };
    await appendUserTurn(halfFast, { key: id, text: "半条探针", messageId: `m-half-${Date.now()}` });
    assert.ok(halfCounts.load >= 1, "只实现一条探针时必须回退全量 load");
  });

  // ── 支撑快路径的两条 store 侧保真改动（官方契约套件依赖它们）──

  test("appendRound 容忍缺 ts 的 record，且 load()/探针不发明写入方没给的字段", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("no-invented-fields");
    // 官方契约套件的 fixture 形状：没有 ts / dedupKey / folded
    const bare = { round: 4, roundKey: `${id}:round:4`, messages: [{ role: "user", content: [{ type: "text", text: "bare" }] }] };
    await store.appendRound(id, bare);

    const [loaded] = await store.load(id);
    assert.deepStrictEqual(loaded, bare, "load() 不得凭空补出 ts / dedupKey / folded");
    await assertProbesMatchLoad(store, id);

    // 列侧仍然补齐（dedup_key / ts 是 NOT NULL），只是不回填到 record
    const [rows] = await db.sequelize.query(
      "SELECT dedup_key, ts, folded, record_json FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(rows[0].dedup_key, `${id}:round:4`);
    assert.ok(rows[0].ts && !Number.isNaN(new Date(rows[0].ts).getTime()), "ts 列必须仍写入有效值");
    assert.equal(JSON.parse(rows[0].record_json).__hostSynthesizedColumns.includes("ts"), true);

    // 历史行（无该内部标记）行为不变：仍然回填 folded=false / dedupKey / ts
    const legacy = runId("legacy-no-marker");
    await db.sequelize.query(`
      INSERT INTO agent_rounds
        (id, request_id, round_no, dedup_key, stop_reason, \`usage\`, latency_ms,
         folded, folded_range, record_json, ts, created_at)
      VALUES (:id, :runId, 1, :dedupKey, NULL, NULL, NULL, b'0', NULL, :recordJson, :ts, :now)
    `, {
      replacements: {
        id: `round_legacy_${ns}`, runId: legacy, dedupKey: `${legacy}:round:1`,
        recordJson: JSON.stringify({ textPreview: "legacy" }),
        ts: "2026-09-01T00:00:00.000Z", now: new Date(),
      },
    });
    const [legacyLoaded] = await store.load(legacy);
    assert.equal(legacyLoaded.folded, false, "历行行的回填行为保持不变");
    assert.equal(legacyLoaded.dedupKey, `${legacy}:round:1`);
    assert.equal(legacyLoaded.textPreview, "legacy");
    assert.equal(legacyLoaded.__hostSynthesizedColumns, undefined, "内部标记键不得外泄到 load() 输出");
  });
}
