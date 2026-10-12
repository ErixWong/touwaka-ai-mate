import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { notesStoreCasContract, notesStoreContract } from "erix-agent/contract-tests";
import { createFakeDb } from "../../server/tests/helpers/fake-db.js";
import {
  canonicalizeNotesScopeRef,
  DbNoteRecordStore,
  ErixNotesStoreAdapter,
} from "../../lib/notes/index.js";
import { migrateNotesScopeRefs } from "../../lib/notes/notes-scope-ref-migration.js";

function hashScopeRef(value) {
  return `run-h-${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24)}`;
}

function sampleRecord(key, scopeRef) {
  const ts = new Date().toISOString();
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
  };
}

function migrationDb(seedRows) {
  const rows = new Map();
  const keyOf = (scopeRef, noteKey) => `${scopeRef}|${noteKey}`;
  for (const row of seedRows) rows.set(keyOf(row.scope_ref, row.note_key), structuredClone(row));

  let snapshot = null;
  const stats = { updateAttempts: 0, commits: 0, rollbacks: 0, transactions: 0 };
  const conn = {
    rows,
    stats,
    async beginTransaction() {
      stats.transactions += 1;
      snapshot = new Map([...rows].map(([key, row]) => [key, structuredClone(row)]));
    },
    async commit() {
      stats.commits += 1;
      snapshot = null;
    },
    async rollback() {
      stats.rollbacks += 1;
      rows.clear();
      for (const [key, row] of snapshot || []) rows.set(key, row);
      snapshot = null;
    },
    async execute(sql, params = []) {
      const text = String(sql);
      if (/^SELECT id, scope_ref, note_key\s+FROM note_record/i.test(text.trim())) {
        return [[...rows.values()].map((row) => ({
          id: row.id,
          scope_ref: row.scope_ref,
          note_key: row.note_key,
        })), []];
      }
      if (/^SELECT id\s+FROM note_record\s+WHERE scope_ref = \? AND note_key = \?/i.test(text.trim())) {
        const row = rows.get(keyOf(params[0], params[1]));
        return [row ? [{ id: row.id }] : [], []];
      }
      if (/^UPDATE note_record/i.test(text.trim())) {
        stats.updateAttempts += 1;
        assert.match(text, /JSON_SET\(record, '\$\.scopeRef', \?\)/);
        const [newRef, recordScopeRef, oldRef, noteKey, id] = params;
        const oldKey = keyOf(oldRef, noteKey);
        const row = rows.get(oldKey);
        if (!row || String(row.id) !== String(id)) return [{ affectedRows: 0 }, []];
        const targetKey = keyOf(newRef, noteKey);
        if (targetKey !== oldKey && rows.has(targetKey)) {
          const error = new Error("Duplicate entry for key 'uk_scope_ref_key'");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }
        const record = JSON.parse(row.record);
        record.scopeRef = recordScopeRef;
        rows.delete(oldKey);
        rows.set(targetKey, { ...row, scope_ref: newRef, record: JSON.stringify(record) });
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unsupported migration SQL: ${text}`);
    },
  };
  return conn;
}

test("canonicalizes safe, unsafe, already-hashed, dot, and run-h-prefixed scopeRefs", () => {
  assert.equal(canonicalizeNotesScopeRef("notes-v1:0123456789abcdef01234567"),
    hashScopeRef("notes-v1:0123456789abcdef01234567"));
  assert.equal(canonicalizeNotesScopeRef("user_1-expert.2"), "user_1-expert.2");
  assert.equal(canonicalizeNotesScopeRef("scope:unsafe/value"), hashScopeRef("scope:unsafe/value"));
  assert.equal(canonicalizeNotesScopeRef("."), hashScopeRef("."));
  assert.equal(canonicalizeNotesScopeRef(".."), hashScopeRef(".."));
  assert.equal(canonicalizeNotesScopeRef("run-h-legacy"), hashScopeRef("run-h-legacy"));
  assert.equal(canonicalizeNotesScopeRef(`run-h-${"a".repeat(24)}`), `run-h-${"a".repeat(24)}`);
  assert.throws(() => canonicalizeNotesScopeRef(null), TypeError);
});

test("rejects request or record scope mismatches before writing; purge remains global", async () => {
  const db = createFakeDb();
  const store = new DbNoteRecordStore({ db });
  const scopeRef = "notes-v1:0123456789abcdef01234567";
  const otherScopeRef = "notes-v1:fedcba9876543210fedcba98";
  const adapter = new ErixNotesStoreAdapter({ store, scopeRef });
  const mismatchedRequest = { scope: "run", scopeRef: otherScopeRef, key: "note-1" };

  await assert.rejects(
    adapter.write({ ...mismatchedRequest, record: sampleRecord("note-1", otherScopeRef) }),
    TypeError,
  );
  for (const operation of [
    adapter.read(mismatchedRequest),
    adapter.list(mismatchedRequest),
    adapter.revoke(mismatchedRequest),
    adapter.complete({ scope: "run", scopeRef: otherScopeRef }),
  ]) {
    await assert.rejects(operation, TypeError);
  }
  await assert.rejects(
    adapter.write({
      scope: "run",
      scopeRef,
      key: "note-2",
      record: sampleRecord("note-2", otherScopeRef),
    }),
    TypeError,
  );
  assert.equal(db.rows.size, 0);
  assert.deepEqual(await adapter.purge({ scopeRef: otherScopeRef }), {
    status: "found",
    scanned: 0,
    purged: 0,
  });
});

test("migration canonicalizes rows once and saves a rollback mapping", async (t) => {
  const oldRef = "notes-v1:0123456789abcdef01234567";
  const newRef = hashScopeRef(oldRef);
  const noteKey = "note-1";
  const id = "row-1";
  const conn = migrationDb([{
    id,
    scope_ref: oldRef,
    note_key: noteKey,
    record: JSON.stringify({ key: noteKey, scopeRef: oldRef }),
  }]);
  const logsDir = await mkdtemp(join(tmpdir(), "notes-scope-ref-"));
  t.after(() => rm(logsDir, { recursive: true, force: true }));
  const logMessages = [];
  const options = {
    logsDir,
    now: () => new Date("2026-10-09T00:00:00.000Z"),
    logInfo: (message) => logMessages.push(message),
  };

  const first = await migrateNotesScopeRefs(conn, options);
  assert.equal(first.changed, 1);
  assert.deepEqual(first.mappings, [{
    old_ref: oldRef,
    new_ref: newRef,
    note_key: noteKey,
    id,
  }]);
  const migratedRow = conn.rows.get(`${newRef}|${noteKey}`);
  assert.equal(migratedRow.scope_ref, newRef);
  assert.equal(JSON.parse(migratedRow.record).scopeRef, newRef);
  assert.deepEqual(JSON.parse(await readFile(first.rollbackFile, "utf8")), first.mappings);
  assert.ok(logMessages.some((message) => message.includes(JSON.stringify(first.mappings[0]))));

  const second = await migrateNotesScopeRefs(conn, options);
  assert.equal(second.changed, 0);
  assert.deepEqual(second.mappings, []);
  assert.equal(conn.stats.updateAttempts, 1);
});

test("migration preview computes mappings without opening a transaction or writing", async () => {
  const oldRef = "notes-v1:fedcba9876543210fedcba98";
  const conn = migrationDb([{
    id: "preview-row",
    scope_ref: oldRef,
    note_key: "preview-key",
    record: JSON.stringify({ scopeRef: oldRef }),
  }]);
  const logsDir = join(tmpdir(), `notes-scope-ref-preview-${randomUUID()}`);
  const preview = await migrateNotesScopeRefs(conn, {
    dryRun: true,
    logsDir,
    logInfo: () => {},
  });

  assert.equal(preview.dryRun, true);
  assert.equal(preview.changed, 0);
  assert.equal(preview.mappings[0].new_ref, hashScopeRef(oldRef));
  assert.equal(conn.stats.transactions, 0);
  assert.equal(conn.stats.updateAttempts, 0);
  assert.equal(conn.rows.has(`${oldRef}|preview-key`), true);
});

test("migration detects target unique-key conflicts before any update", async () => {
  const oldRef = "notes-v1:aaaaaaaaaaaaaaaaaaaaaaaa";
  const newRef = hashScopeRef(oldRef);
  const noteKey = "collision";
  const conn = migrationDb([
    {
      id: "legacy-row",
      scope_ref: oldRef,
      note_key: noteKey,
      record: JSON.stringify({ scopeRef: oldRef }),
    },
    {
      id: "occupied-row",
      scope_ref: newRef,
      note_key: noteKey,
      record: JSON.stringify({ scopeRef: newRef }),
    },
  ]);

  await assert.rejects(
    migrateNotesScopeRefs(conn, { logInfo: () => {} }),
    /unique-key conflicts/,
  );
  assert.equal(conn.stats.updateAttempts, 0);
  assert.equal(conn.stats.rollbacks, 1);
  assert.equal(conn.rows.has(`${oldRef}|${noteKey}`), true);
});

// ---------------------------------------------------------------------------
// 官方契约套件接入（erix-agent 0.18.0，issue #183）
//
// 标准用法（node_modules/erix-agent/docs/host-consumer-contract_cn.md
// 「契约测试套件 → 标准用法」）：`xxxContract(label, factory)` 只注册断言，
// 因此直接注册进宿主自己的 node --test 树；factory 每次调用必须交出一个干净的
// 实现（每个断言组都当成全新命名空间）。
//
// 本项目的端口是「实例级固定 scope」形态（上游文档判定与官方 assembler 同形、
// 不是偏航），官方给的适配点就在 factory：交给套件一个能把请求里的 scopeRef
// 解析到该 scope 对应实例（按需创建）的 factory，而不是丢掉 scopeRef。
// 上游套件同时点名原始逻辑 ref 与其 canonical `run-h-...` 形态，二者必须落到
// 同一个实例——本项目 DB 里存的正是 canonical scope_ref，故按 canonical 建实例。
//
// 上面的自写断言全部保留（它们钉的是宿主自有语义：物理删除、logical scopeRef
// 回显、scope_ref 迁移、TTL 单一来源），官方套件是漂移哨兵，两者互不替代。
// ---------------------------------------------------------------------------
function createContractNotesStore() {
  const db = createFakeDb();
  const store = new DbNoteRecordStore({ db });
  const adapters = new Map();
  const instanceFor = (scopeRef) => {
    const canonical = typeof scopeRef === "string"
      ? canonicalizeNotesScopeRef(scopeRef)
      : scopeRef;
    if (!adapters.has(canonical)) {
      adapters.set(canonical, new ErixNotesStoreAdapter({ store, scopeRef: canonical }));
    }
    return adapters.get(canonical);
  };
  const dispatch = (method) => async (request = {}) => {
    const requested = request?.scopeRef;
    // 套件会拿同一个逻辑 ref 的两种写法（原始 ref 与它的 canonical 形态）点名同一个
    // scope，而本项目 DB 里存的正是 canonical scope_ref：按 canonical 解析实例，
    // 并把 canonical ref 交给该实例（端口自己再卡一道 request.scopeRef 相等）。
    const scopeRef = typeof requested === "string" ? canonicalizeNotesScopeRef(requested) : requested;
    return instanceFor(scopeRef)[method]({ ...request, scopeRef });
  };
  // purge 是唯一扫遍全部 scope 的方法（上游忽略 scopeRef）：固定用一个实例，
  // 让端口实现自己去证明「不看 scopeRef」。
  const globalAdapter = new ErixNotesStoreAdapter({ store, scopeRef: "contract-global-purge" });
  return {
    write: dispatch("write"),
    read: dispatch("read"),
    list: dispatch("list"),
    complete: dispatch("complete"),
    revoke: dispatch("revoke"),
    purge: (request = {}) => globalAdapter.purge(request),
  };
}

notesStoreContract("touwaka-db-notes-store", createContractNotesStore);
notesStoreCasContract("touwaka-db-notes-store", createContractNotesStore);

test("list returns all by default and clamps an oversized limit to 200", async () => {
  const db = createFakeDb();
  const store = new DbNoteRecordStore({ db });
  const scopeRef = "notes-v1:0123456789abcdef01234567";
  const adapter = new ErixNotesStoreAdapter({ store, scopeRef });

  for (let index = 0; index < 205; index += 1) {
    const key = `note-${index}`;
    await store.write(scopeRef, key, sampleRecord(key, scopeRef));
  }

  const storedRef = hashScopeRef(scopeRef);
  const firstRow = db.rows.get(`${storedRef}|note-0`);
  assert.equal(firstRow.scope_ref, storedRef);
  assert.equal(JSON.parse(firstRow.record).scopeRef, storedRef);
  assert.equal((await store.read(scopeRef, "note-0")).scopeRef, scopeRef);
  assert.equal((await adapter.list({ scope: "run", scopeRef })).length, 205);
  assert.equal((await adapter.list({ scope: "run", scopeRef, limit: 5000 })).length, 200);
});

// ---------------------------------------------------------------------------
// #1185 四项的宿主侧断言：官方套件覆盖不到的那半边在这里钉住
//   ② purge 的「真清」与跨 scope：上游 purge 是 scope 时钟口径，套件里全部记录都在
//      保留期内（只断言 purged:0 与 before 校验），证明不了「过期行必须真删」；
//   ① complete 的 scope 隔离与 done 不重复计数；
//   ③ limit 先校后用（非法值不得触达存储层）；
//   ④ 投影只在端口出口，note_record 的 record_version/expires_at 两列必须原样保留。
// ---------------------------------------------------------------------------
const CONTRACT_TTL_SECONDS = 60;
const CONTRACT_START_MS = Date.parse("2026-10-09T00:00:00.000Z");

function makeTtlHarness() {
  let now = CONTRACT_START_MS;
  const db = createFakeDb();
  const store = new DbNoteRecordStore({ db, clock: () => now, ttlSeconds: CONTRACT_TTL_SECONDS });
  const adapterFor = (scopeRef) => new ErixNotesStoreAdapter({
    store, scopeRef, clock: () => now, ttlSeconds: CONTRACT_TTL_SECONDS,
  });
  return {
    db,
    store,
    adapterFor,
    advance: (ms) => { now += ms; },
  };
}

test("#1185 ② purge really deletes expired rows in every scope (a no-op purge fails here)", async () => {
  const { db, adapterFor, advance } = makeTtlHarness();
  const left = adapterFor("notes-v1:0123456789abcdef01234567");
  const right = adapterFor("notes-v1:fedcba9876543210fedcba98");
  await left.write({ scope: "run", scopeRef: left.scopeRef, key: "k1", record: sampleRecord("k1", left.scopeRef) });
  await right.write({ scope: "run", scopeRef: right.scopeRef, key: "k2", record: sampleRecord("k2", right.scopeRef) });
  assert.equal(db.rows.size, 2);

  advance(CONTRACT_TTL_SECONDS * 1000 + 1);
  // 不带 scopeRef，且由 scope A 的实例发起：必须扫到并删掉 scope B 的行
  assert.deepEqual(await left.purge(), { status: "found", scanned: 2, purged: 2 });
  assert.equal(db.rows.size, 0);
  assert.equal(await right.read({ scope: "run", scopeRef: right.scopeRef, key: "k2" }), undefined);
  // 幂等：再清一次没有可删的了
  assert.deepEqual(await left.purge(), { status: "found", scanned: 0, purged: 0 });
});

test("#1185 ② purge before only narrows the sweep window and rejects unparseable before", async () => {
  const { db, adapterFor, advance } = makeTtlHarness();
  const adapter = adapterFor("notes-v1:0123456789abcdef01234567");
  await adapter.write({ scope: "run", scopeRef: adapter.scopeRef, key: "k1", record: sampleRecord("k1", adapter.scopeRef) });
  advance(CONTRACT_TTL_SECONDS * 1000 + 1);

  // before 早于 deadline → 窗口被缩小，一条不删
  assert.deepEqual(
    await adapter.purge({ scope: "run", scopeRef: "notes-v1:fedcba9876543210fedcba98", before: new Date(CONTRACT_START_MS + 1000).toISOString() }),
    { status: "found", scanned: 1, purged: 0 },
    "purge 忽略 scopeRef，但 before 必须缩小窗口",
  );
  assert.equal(db.rows.size, 1);

  // before 晚于 deadline → cutoff 落到 now，照删
  assert.deepEqual(
    await adapter.purge({ before: new Date(CONTRACT_START_MS + 3600 * 1000).toISOString() }),
    { status: "found", scanned: 1, purged: 1 },
  );

  await assert.rejects(
    adapter.purge({ before: "not-a-date" }),
    (error) => error instanceof TypeError && /parseable date/u.test(error.message),
  );
  await assert.rejects(adapter.purge({ scope: "session" }), TypeError);
});

test("#1185 ① complete flips active records to done, counts them, and stays in scope", async () => {
  const { adapterFor } = makeTtlHarness();
  const scopeA = adapterFor("notes-v1:0123456789abcdef01234567");
  const scopeB = adapterFor("notes-v1:fedcba9876543210fedcba98");
  for (const key of ["k1", "k2"]) {
    await scopeA.write({ scope: "run", scopeRef: scopeA.scopeRef, key, record: sampleRecord(key, scopeA.scopeRef) });
  }
  await scopeB.write({ scope: "run", scopeRef: scopeB.scopeRef, key: "k3", record: sampleRecord("k3", scopeB.scopeRef) });

  assert.deepEqual(await scopeA.complete({ scope: "run", scopeRef: scopeA.scopeRef }), { status: "found", completed: 2 });
  assert.equal((await scopeA.read({ scope: "run", scopeRef: scopeA.scopeRef, key: "k1" })).state, "done");
  assert.equal((await scopeA.read({ scope: "run", scopeRef: scopeA.scopeRef, key: "k2" })).state, "done");
  // done 不重复计数，且记录仍可完整读出
  assert.deepEqual(await scopeA.complete({ scope: "run", scopeRef: scopeA.scopeRef }), { status: "found", completed: 0 });
  assert.deepEqual((await scopeA.list({ scope: "run", scopeRef: scopeA.scopeRef })).map((record) => record.state), ["done", "done"]);
  // 他 scope 不受影响
  assert.equal((await scopeB.read({ scope: "run", scopeRef: scopeB.scopeRef, key: "k3" })).state, "active");
});

test("#1185 ③ list validates limit before touching the store and keeps the 200 clamp", async () => {
  const listCalls = [];
  const store = {
    read: async () => undefined,
    write: async () => {},
    list: async (scopeRef) => { listCalls.push(scopeRef); return []; },
  };
  const adapter = new ErixNotesStoreAdapter({ store, scopeRef: "notes-v1:0123456789abcdef01234567" });

  for (const limit of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "5"]) {
    await assert.rejects(
      adapter.list({ scope: "run", scopeRef: adapter.scopeRef, limit }),
      (error) => error instanceof TypeError && /positive safe integer/u.test(error.message),
      `limit=${String(limit)} 必须抛 TypeError`,
    );
  }
  assert.deepEqual(listCalls, [], "非法 limit 必须在读取任何数据之前抛");
  assert.deepEqual(await adapter.list({ scope: "run", scopeRef: adapter.scopeRef, limit: 1 }), []);
  assert.deepEqual(listCalls, [adapter.scopeRef], "合法 limit 才允许触达存储层");
});

test("#1185 ④ read/list project host metadata away while note_record keeps both columns", async () => {
  const { db, store, adapterFor } = makeTtlHarness();
  const scopeRef = "notes-v1:0123456789abcdef01234567";
  const adapter = adapterFor(scopeRef);
  await adapter.write({ scope: "run", scopeRef, key: "k1", record: sampleRecord("k1", scopeRef) });

  const row = db.rows.get(`${canonicalizeNotesScopeRef(scopeRef)}|k1`);
  const rowRecord = JSON.parse(row.record);
  assert.ok(rowRecord.record_version, "record_version 必须仍写进记录 JSON（列不变、DDL 不动）");
  assert.ok(rowRecord.expires_at, "expires_at 必须仍写进记录 JSON（列不变、DDL 不动）");
  assert.ok(Number.isFinite(row.expires_at) && row.expires_at > 0, "note_record.expires_at 列必须仍在");
  assert.ok(row.record_version, "note_record.record_version 列必须仍在");

  for (const record of [await adapter.read({ scope: "run", scopeRef, key: "k1" }), (await adapter.list({ scope: "run", scopeRef }))[0]]) {
    assert.equal("record_version" in record, false, "端口出口不得外泄 record_version");
    assert.equal("expires_at" in record, false, "端口出口不得外泄 expires_at");
    assert.equal(record.key, "k1");
  }
  // 存储层自己仍看得到元数据（CAS 与 TTL 依赖它）
  assert.ok((await store.read(scopeRef, "k1")).record_version);
});
