/**
 * issue #1210：erix 0.19.0 端口契约补口的**宿主自证单测**（不靠上游套件独证）
 *
 * 覆盖三件事：
 *   ① normalizeListFilters 的非法值抛错矩阵（每个键都要在 message 里点名 `filters.<键>`，
 *      上游套件只按 /filters\.state/ 与 /filters\.source/ 各量一条，这里补齐 tag /
 *      minRelevance / filters 本体，以及「合法值归一成什么」的正向矩阵）；
 *   ② 合法 filters **真生效**（state 集合 / tag / source=current.provenance.source /
 *      minRelevance，含 source 缺失归 agent、relevance 缺失按 0.5 两条上游同口径的边角），
 *      且过滤发生在 limit 截断**之前**；非法 filters 在触达存储层之前就抛；
 *   ③ purge 的 scanned 口径：端口 = 扫描的 scope 数，宿主 DbNoteRecordStore.purge = 行次，
 *      两者并存互不覆盖（宿主默认返回形状一字不改，只有 withScopeCount 才多一个 scope_count）。
 *
 * 全部离线（注入内存 fake db / duck-type store），不需要 MariaDB。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDb } from "../../server/tests/helpers/fake-db.js";
import {
  DbNoteRecordStore,
  ErixNotesStoreAdapter,
} from "../../lib/notes/index.js";
import {
  matchesListFilters,
  normalizeListFilters,
} from "../../lib/notes/notes-policy.js";

const SCOPE = "notes-v1:0123456789abcdef01234567";
const START_MS = Date.parse("2026-10-15T00:00:00.000Z");
const TTL_SECONDS = 60;

function sampleRecord(key, scopeRef, overrides = {}) {
  const ts = new Date(START_MS).toISOString();
  return {
    key,
    scope: "run",
    scopeRef,
    current: {
      content: key,
      provenance: { source: "agent", verified: true, ts },
      ts,
    },
    superseded: [],
    folded: 0,
    pinned: false,
    tags: [],
    relevance: 0.5,
    state: "active",
    created_at: ts,
    updated_at: ts,
    ...overrides,
  };
}

function makeHarness() {
  let now = START_MS;
  const db = createFakeDb();
  const store = new DbNoteRecordStore({ db, clock: () => now, ttlSeconds: TTL_SECONDS });
  const adapterFor = (scopeRef) => new ErixNotesStoreAdapter({
    store, scopeRef, clock: () => now, ttlSeconds: TTL_SECONDS,
  });
  return { db, store, adapterFor, advance: (ms) => { now += ms; }, now: () => now };
}

/** 只记录调用次数的 duck-type store（验证非法 filters 不得触达存储层）。 */
function countingStore() {
  const calls = { list: [], purge: [] };
  return {
    calls,
    read: async () => undefined,
    write: async () => {},
    delete: async () => false,
    list: async (scopeRef) => { calls.list.push(scopeRef); return []; },
    purge: async (request) => { calls.purge.push(request); return { scanned: 0, purged: 0 }; },
  };
}

// ---------------------------------------------------------------------------
// ① filters 归一化：非法值抛错矩阵 + 合法值归一形状
// ---------------------------------------------------------------------------

test("normalizeListFilters 对每个键的非法值都抛 TypeError 且 message 点名 filters.<键>", () => {
  const matrix = [
    // [filters, 必须出现在 message 里的键名]
    [{ state: [] }, "filters.state"],
    [{ state: "bogus" }, "filters.state"],
    [{ state: ["active", "bogus"] }, "filters.state"],
    [{ state: 42 }, "filters.state"],
    [{ state: null }, "filters.state"],
    [{ tag: 42 }, "filters.tag"],
    [{ tag: ["k"] }, "filters.tag"],
    [{ tag: null }, "filters.tag"],
    [{ source: "bogus" }, "filters.source"],
    [{ source: "" }, "filters.source"],
    [{ source: null }, "filters.source"],
    [{ minRelevance: -0.1 }, "filters.minRelevance"],
    [{ minRelevance: 1.5 }, "filters.minRelevance"],
    [{ minRelevance: "0.5" }, "filters.minRelevance"],
    [{ minRelevance: Number.NaN }, "filters.minRelevance"],
    [{ minRelevance: Number.POSITIVE_INFINITY }, "filters.minRelevance"],
    [{ minRelevance: null }, "filters.minRelevance"],
  ];
  for (const [filters, key] of matrix) {
    assert.throws(
      () => normalizeListFilters(filters),
      (error) => error instanceof TypeError && error.message.includes(key),
      `filters=${JSON.stringify(filters)} 必须抛含 ${key} 的 TypeError`,
    );
  }
});

test("normalizeListFilters 对 filters 本体只接受对象：数组/标量抛 TypeError", () => {
  for (const filters of [[], "active", 42, true, () => {}]) {
    assert.throws(
      () => normalizeListFilters(filters),
      (error) => error instanceof TypeError && /filters\b/u.test(error.message),
      `filters=${String(filters)} 必须抛 TypeError`,
    );
  }
  // 未给 / null = 不过滤（上游同口径：null 与 undefined 都是空 filters，不是错误）
  assert.deepEqual(normalizeListFilters(undefined), {});
  assert.deepEqual(normalizeListFilters(null), {});
  assert.deepEqual(normalizeListFilters({}), {});
});

test("normalizeListFilters 的合法值归一形状（state 标量→集合、去重、未知键忽略、边界值收下）", () => {
  const single = normalizeListFilters({ state: "done" });
  assert.ok(single.state instanceof Set);
  assert.deepEqual([...single.state], ["done"]);

  const multi = normalizeListFilters({ state: ["active", "active", "revoked"] });
  assert.deepEqual([...multi.state].sort(), ["active", "revoked"]);

  assert.deepEqual(
    normalizeListFilters({ tag: "k", source: "auto", minRelevance: 0 }),
    { tag: "k", source: "auto", minRelevance: 0 },
  );
  assert.equal(normalizeListFilters({ minRelevance: 1 }).minRelevance, 1);
  assert.equal(normalizeListFilters({ source: "agent" }).source, "agent");
  // 上游同样忽略未知键（不报错、不生效）
  assert.deepEqual(normalizeListFilters({ bogus: true }), {});
});

// ---------------------------------------------------------------------------
// ② matchesListFilters 语义（含上游那两条边角：source 缺失归 agent、relevance 缺失按 0.5）
// ---------------------------------------------------------------------------

test("matchesListFilters 只认字面量 auto，其余 provenance.source 一律归 agent", () => {
  const auto = sampleRecord("a", SCOPE, {
    current: { content: "a", provenance: { source: "auto" }, ts: "2026-10-15T00:00:00.000Z" },
  });
  const weird = sampleRecord("w", SCOPE, {
    current: { content: "w", provenance: { source: "human" }, ts: "2026-10-15T00:00:00.000Z" },
  });
  const bare = { ...sampleRecord("b", SCOPE) };
  delete bare.current.provenance;

  assert.equal(matchesListFilters(auto, normalizeListFilters({ source: "auto" })), true);
  assert.equal(matchesListFilters(auto, normalizeListFilters({ source: "agent" })), false);
  for (const record of [weird, bare]) {
    assert.equal(matchesListFilters(record, normalizeListFilters({ source: "agent" })), true);
    assert.equal(matchesListFilters(record, normalizeListFilters({ source: "auto" })), false);
  }
});

test("matchesListFilters 的 state/tag/minRelevance 判定与缺失 relevance 兜底 0.5", () => {
  const done = sampleRecord("d", SCOPE, { state: "done" });
  const tagged = sampleRecord("t", SCOPE, { tags: ["alpha", "beta"] });
  const low = sampleRecord("l", SCOPE, { relevance: 0.2 });
  const noRelevance = { ...sampleRecord("n", SCOPE) };
  delete noRelevance.relevance;

  assert.equal(matchesListFilters(done, normalizeListFilters({ state: ["active", "done"] })), true);
  assert.equal(matchesListFilters(done, normalizeListFilters({ state: "active" })), false);
  assert.equal(matchesListFilters(tagged, normalizeListFilters({ tag: "beta" })), true);
  assert.equal(matchesListFilters(tagged, normalizeListFilters({ tag: "gamma" })), false);
  assert.equal(matchesListFilters(tagged, normalizeListFilters({ tag: "" })), false);

  assert.equal(matchesListFilters(low, normalizeListFilters({ minRelevance: 0.3 })), false);
  assert.equal(matchesListFilters(low, normalizeListFilters({ minRelevance: 0.2 })), true);
  // relevance 缺失/非有限数字 → 按 0.5 参与比较（上游同口径）
  assert.equal(matchesListFilters(noRelevance, normalizeListFilters({ minRelevance: 0.5 })), true);
  assert.equal(matchesListFilters(noRelevance, normalizeListFilters({ minRelevance: 0.6 })), false);
  // 空 filters = 全通过
  assert.equal(matchesListFilters(low, {}), true);
  assert.equal(matchesListFilters(low, undefined), true);
});

// ---------------------------------------------------------------------------
// ② 端到端：adapter.list 的 filters 真生效（DB store + 内存 fake db）
// ---------------------------------------------------------------------------

async function seedFilterCorpus(adapter) {
  const put = (key, overrides) => adapter.write({
    scope: "run", scopeRef: adapter.scopeRef, key,
    record: sampleRecord(key, adapter.scopeRef, overrides),
  });
  const autoTs = new Date(START_MS).toISOString();
  await put("active-high", { relevance: 0.9, tags: ["alpha"] });
  await put("active-low", { relevance: 0.1, tags: ["beta"] });
  await put("auto-record", {
    relevance: 0.6,
    current: { content: "auto", provenance: { source: "auto" }, ts: autoTs },
  });
  await put("done-record", { state: "done", relevance: 0.7, tags: ["alpha"] });
  await put("no-relevance", (() => {
    const record = sampleRecord("no-relevance", adapter.scopeRef, { tags: ["beta"] });
    delete record.relevance;
    return record;
  })());
  // revoked 经端口 write 会被 touwaka 决策 2 转成物理删除（测不到 state 过滤），
  // 这里直接从存储层落一条 revoked 行，端口 list 的 state 过滤才有东西可过。
  await adapter.store.write(adapter.scopeRef, "revoked-record", sampleRecord("revoked-record", adapter.scopeRef, {
    state: "revoked",
    relevance: 1,
  }));
}

const keysOf = (records) => records.map((record) => record.key).sort();

test("adapter.list 的合法 filters 真生效：state 集合 / tag / source / minRelevance 与组合", async () => {
  const { adapterFor } = makeHarness();
  const adapter = adapterFor(SCOPE);
  await seedFilterCorpus(adapter);
  // 不带 filters 时全量在场（含 revoked —— 存储层不做 state 过滤，过滤是端口 filters 的职责）
  assert.deepEqual(
    keysOf(await adapter.list({ scope: "run", scopeRef: SCOPE })),
    ["active-high", "active-low", "auto-record", "done-record", "no-relevance", "revoked-record"],
  );

  assert.deepEqual(
    keysOf(await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { state: "active" } })),
    ["active-high", "active-low", "auto-record", "no-relevance"],
  );
  assert.deepEqual(
    keysOf(await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { state: ["done", "revoked"] } })),
    ["done-record", "revoked-record"],
  );
  assert.deepEqual(
    keysOf(await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { tag: "alpha" } })),
    ["active-high", "done-record"],
  );
  assert.deepEqual(
    keysOf(await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { source: "auto" } })),
    ["auto-record"],
  );
  assert.deepEqual(
    keysOf(await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { source: "agent" } })),
    ["active-high", "active-low", "done-record", "no-relevance", "revoked-record"],
  );
  // minRelevance 0.5：relevance 缺失的 no-relevance 按 0.5 兜底，因此必须留下
  assert.deepEqual(
    keysOf(await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { minRelevance: 0.5 } })),
    ["active-high", "auto-record", "done-record", "no-relevance", "revoked-record"],
  );
  // 组合条件取交集
  assert.deepEqual(
    keysOf(await adapter.list({
      scope: "run",
      scopeRef: SCOPE,
      filters: { state: "active", tag: "beta", minRelevance: 0.4 },
    })),
    ["no-relevance"],
  );
  // 合法但无命中 → 空数组（不是全量，也不是抛错）
  assert.deepEqual(
    await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { tag: "gamma" } }),
    [],
  );
});

test("adapter.list 的 filters 先过滤再截 limit，且出口仍是剥了宿主元数据的公共形状", async () => {
  const { adapterFor } = makeHarness();
  const adapter = adapterFor(SCOPE);
  await seedFilterCorpus(adapter);

  const limited = await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { state: "active" }, limit: 2 });
  assert.equal(limited.length, 2);
  // limit 截的是过滤后的集合：截出来必须全是 active
  for (const record of limited) assert.equal(record.state, "active");

  // limit 大于命中数时不补齐（曾经「filters 被丢弃」时这里会返回 6 条）
  const overLimited = await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { source: "auto" }, limit: 5 });
  assert.deepEqual(keysOf(overLimited), ["auto-record"]);

  for (const record of await adapter.list({ scope: "run", scopeRef: SCOPE, filters: { tag: "alpha" } })) {
    assert.equal("record_version" in record, false);
    assert.equal("expires_at" in record, false);
  }
});

test("adapter.list 在读到任何数据之前就拒掉非法 filters（与 limit 同口径）", async () => {
  const store = countingStore();
  const adapter = new ErixNotesStoreAdapter({ store, scopeRef: SCOPE });

  for (const filters of [{ state: [] }, { source: "bogus" }, { tag: 42 }, { minRelevance: 2 }, "nope"]) {
    await assert.rejects(
      adapter.list({ scope: "run", scopeRef: SCOPE, filters }),
      TypeError,
      `filters=${String(JSON.stringify(filters))} 必须抛 TypeError`,
    );
  }
  assert.deepEqual(store.calls.list, [], "非法 filters 必须在 store.list 之前抛，一次都不许读存储层");

  // 合法 filters 才允许触达存储层，且 limit 与 filters 的先后次序不变（都先校完再读）
  await assert.rejects(adapter.list({ scope: "run", scopeRef: SCOPE, limit: 0, filters: { source: "bogus" } }), TypeError);
  assert.deepEqual(store.calls.list, []);
  await adapter.list({ scope: "run", scopeRef: SCOPE, limit: 1, filters: { state: "active" } });
  assert.deepEqual(store.calls.list, [SCOPE]);
});

// ---------------------------------------------------------------------------
// ③ purge：端口 scanned = 扫描的 scope 数，宿主 scanned = 行次，两条口径并存
// ---------------------------------------------------------------------------

test("adapter.purge 报 scope 数（多行同 scope 只算一个），宿主 purge 仍报行次", async () => {
  const { db, store, adapterFor, advance } = makeHarness();
  const left = adapterFor("notes-v1:0123456789abcdef01234567");
  const right = adapterFor("notes-v1:fedcba9876543210fedcba98");
  for (const key of ["a1", "a2", "a3"]) {
    await left.write({ scope: "run", scopeRef: left.scopeRef, key, record: sampleRecord(key, left.scopeRef) });
  }
  await right.write({ scope: "run", scopeRef: right.scopeRef, key: "b1", record: sampleRecord("b1", right.scopeRef) });
  assert.equal(db.rows.size, 4);

  // 保留期内：一行不删，但两个 scope 都扫过
  assert.deepEqual(await left.purge({ scope: "run" }), { status: "found", scanned: 2, purged: 0 });
  assert.equal(db.rows.size, 4);

  // before 只能缩小窗口：10 年前的 before 让一切豁免
  const tenYearsAgo = new Date(START_MS - 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
  assert.deepEqual(await left.purge({ before: tenYearsAgo }), { status: "found", scanned: 2, purged: 0 });
  assert.deepEqual(keysOf(await left.list({ scope: "run", scopeRef: left.scopeRef })), ["a1", "a2", "a3"]);
  assert.deepEqual(keysOf(await right.list({ scope: "run", scopeRef: right.scopeRef })), ["b1"]);

  // TTL 到点：4 行全清，但端口只报 2 个 scope
  advance(TTL_SECONDS * 1000 + 1);
  assert.deepEqual(await left.purge(), { status: "found", scanned: 2, purged: 4 });
  assert.equal(db.rows.size, 0);
  // 幂等：没有候选行 = 一个 scope 也没扫到
  assert.deepEqual(await left.purge(), { status: "found", scanned: 0, purged: 0 });
});

test("adapter.purge 的 before 只能缩小窗口：行已到期但 before 更早时一行不删", async () => {
  // 上游用例拿「全部新鲜行」测这条，对我们的 TTL 口径是**空过**（没东西可删时 min/max 看不出来）；
  // 这里补一个「行已过期 + before 落在 deadline 之前」的场景，把 min(before, now) 钉死。
  const { db, adapterFor, advance } = makeHarness();
  const adapter = adapterFor(SCOPE);
  await adapter.write({ scope: "run", scopeRef: SCOPE, key: "k1", record: sampleRecord("k1", SCOPE) });
  advance(TTL_SECONDS * 1000 + 1);

  // before 早于 deadline → 窗口被缩小 → 一行不删（把 cutoff 改成 max 就会在这里变红）
  assert.deepEqual(
    await adapter.purge({ before: new Date(START_MS + 1000).toISOString() }),
    { status: "found", scanned: 1, purged: 0 },
  );
  assert.equal(db.rows.size, 1);

  // before 晚于 deadline → cutoff 落到 now → 照删
  assert.deepEqual(
    await adapter.purge({ before: new Date(START_MS + 3600 * 1000).toISOString() }),
    { status: "found", scanned: 1, purged: 1 },
  );
  assert.equal(db.rows.size, 0);
});

test("DbNoteRecordStore.purge 的公共形状不变：默认不带 scope_count，withScopeCount 才附加且不改 scanned 行次", async () => {
  const { store, adapterFor, advance } = makeHarness();
  const left = adapterFor("notes-v1:0123456789abcdef01234567");
  const right = adapterFor("notes-v1:fedcba9876543210fedcba98");
  for (const key of ["a1", "a2"]) {
    await left.write({ scope: "run", scopeRef: left.scopeRef, key, record: sampleRecord(key, left.scopeRef) });
  }
  await right.write({ scope: "run", scopeRef: right.scopeRef, key: "b1", record: sampleRecord("b1", right.scopeRef) });
  advance(TTL_SECONDS * 1000 + 1);

  // 宿主默认返回：仍是 #1205 钉着的 {scanned: 行次, purged: 行次}，多一个键都会打红 notes-infra 的 deep.equal
  assert.deepEqual(await store.purge(), { scanned: 3, purged: 3 });
  assert.deepEqual(Object.keys(await store.purge({ batchSize: 2 })).sort(), ["purged", "scanned"]);

  // 要了才附加 scope_count：3 行 / 2 scope，两个口径同时在场
  const reported = await store.purge({ withScopeCount: true });
  assert.deepEqual(reported, { scanned: 0, purged: 0, scope_count: 0 });
});

test("DbNoteRecordStore.purge 的 scope_count 只统计进入候选的 scope（expires_at IS NULL 不参与）", async () => {
  const { db, store, adapterFor, advance } = makeHarness();
  const scoped = adapterFor(SCOPE);
  await scoped.write({ scope: "run", scopeRef: SCOPE, key: "ttl", record: sampleRecord("ttl", SCOPE) });
  // 另建一个只有「永不过期」行的 scope：把 expires_at 拨成 NULL（模拟宿主里不带 TTL 的历史行）
  const foreverScope = "forever-scope";
  await store.write(foreverScope, "forever", sampleRecord("forever", foreverScope));
  const row = db.rows.get(`${foreverScope}|forever`);
  assert.ok(row);
  row.expires_at = null;
  advance(TTL_SECONDS * 1000 + 1);

  const reported = await store.purge({ withScopeCount: true });
  assert.deepEqual(reported, { scanned: 1, purged: 1, scope_count: 1 });
  assert.equal(db.rows.get(`${foreverScope}|forever`) === undefined, false, "expires_at IS NULL 的行不得被清扫");
});

test("adapter.purge 对不实现 scope 回报的 duck-type store 退回行次（不编一个 0）", async () => {
  const store = countingStore();
  store.purge = async (request) => {
    store.calls.purge.push(request);
    return { scanned: 7, purged: 5 }; // 旧 duck-type：没有 scope_count
  };
  const adapter = new ErixNotesStoreAdapter({ store, scopeRef: SCOPE });
  assert.deepEqual(await adapter.purge(), { status: "found", scanned: 7, purged: 5 });
  // adapter 明确要了 scope 回报，并继续把 before 的解析结果透传给宿主
  assert.deepEqual(store.calls.purge, [{ beforeMs: undefined, withScopeCount: true }]);

  const withBefore = new Date(START_MS + 1000).toISOString();
  await adapter.purge({ before: withBefore });
  assert.equal(store.calls.purge[1].beforeMs, Date.parse(withBefore));
  assert.equal(store.calls.purge[1].withScopeCount, true);

  // 非法 before 仍在一开始就抛，且绝不触达存储层
  await assert.rejects(adapter.purge({ before: "not-a-date" }), TypeError);
  assert.equal(store.calls.purge.length, 2);
});
