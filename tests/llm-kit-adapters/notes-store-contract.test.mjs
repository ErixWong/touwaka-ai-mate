import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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

test("list returns all by default and clamps an oversized limit to 200", async () => {
  const db = createFakeDb();
  const store = new DbNoteRecordStore({ db });
  const scopeRef = "notes-v1:0123456789abcdef01234567";
  const adapter = new ErixNotesStoreAdapter({ store, scopeRef });

  for (let index = 0; index < 205; index += 1) {
    const key = `note-${index}`;
    await store.write(scopeRef, key, sampleRecord(key, scopeRef), { expectedVersion: null });
  }

  const storedRef = hashScopeRef(scopeRef);
  const firstRow = db.rows.get(`${storedRef}|note-0`);
  assert.equal(firstRow.scope_ref, storedRef);
  assert.equal(JSON.parse(firstRow.record).scopeRef, storedRef);
  assert.equal((await store.read(scopeRef, "note-0")).scopeRef, scopeRef);
  assert.equal((await adapter.list({ scope: "run", scopeRef })).length, 205);
  assert.equal((await adapter.list({ scope: "run", scopeRef, limit: 5000 })).length, 200);
});
