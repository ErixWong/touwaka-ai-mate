/**
 * Notes 基础设施单测：DB Store / Adapter / Facade / Policy
 * 覆盖 issue #1132 决策 3 修订：CAS 冲突、TTL 不续期、过期过滤与惰性删除、
 * forget 后无 record、scope 稳定性、门面不两栖、revoked→物理删除、
 * complete/janitor no-op、expires_at 对齐。
 */

import { expect } from 'chai';
import { NotesStoreError } from 'erix-agent';
import {
  DbNoteRecordStore,
  ErixNotesStoreAdapter,
  PsycheNotesFacade,
  NOTES_TTL_SECONDS,
  buildNotesScopeRef,
} from '../../lib/notes/index.js';
import { createFakeDb } from './helpers/fake-db.js';

function makeStore({ clock } = {}) {
  const db = createFakeDb();
  const store = new DbNoteRecordStore({ db, clock: clock || (() => Date.now()) });
  return { db, store };
}

function rowOf(db, scopeRef, key) {
  return db.rows.get(`${scopeRef}|${key}`) || null;
}

function sampleRecord({ key, scopeRef, content = 'hello', state = 'active', expires_at }) {
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
    state,
    created_at: ts,
    updated_at: ts,
    ...(expires_at ? { expires_at } : {}),
  };
}

describe('notes policy', () => {
  it('derives a stable scopeRef from user_id + expert_id only', () => {
    const a = buildNotesScopeRef('user_1', 'expert_1');
    expect(a).to.equal(buildNotesScopeRef('user_1', 'expert_1'));
    expect(a).to.match(/^notes-v1:[0-9a-f]{24}$/);
    expect(buildNotesScopeRef('user_2', 'expert_1')).not.to.equal(a);
    expect(buildNotesScopeRef('user_1', 'expert_2')).not.to.equal(a);
    // 稳定派生：不含任何请求级标识的形态，纯哈希
    expect(a.includes('user_1')).to.equal(false);
  });

  it('rejects empty user_id/expert_id', () => {
    expect(() => buildNotesScopeRef('', 'expert_1')).to.throw(TypeError);
    expect(() => buildNotesScopeRef('user_1', '')).to.throw(TypeError);
  });
});

describe('DbNoteRecordStore', () => {
  it('writes, reads, lists and deletes records', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    const stored = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: null });
    expect(stored.record_version).to.be.a('string').with.length(20);
    const row = rowOf(db, scopeRef, 'k1');
    expect(row.id).to.match(/^nr_[0-9a-zA-Z]{20}$/);
    expect(row.record_version).to.equal(stored.record_version);
    expect(row.expires_at).to.equal(Date.parse(stored.expires_at));

    const read = await store.read(scopeRef, 'k1');
    expect(read.current.content).to.equal('hello');
    expect(read.record_version).to.equal(stored.record_version);

    await store.write(scopeRef, 'k2', sampleRecord({ key: 'k2', scopeRef }), { expectedVersion: null });
    expect((await store.list(scopeRef)).map(r => r.key).sort()).to.deep.equal(['k1', 'k2']);

    expect(await store.delete(scopeRef, 'k1')).to.equal(true);
    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
    expect(rowOf(db, scopeRef, 'k1')).to.equal(null);
    // 幂等删除
    expect(await store.delete(scopeRef, 'k1')).to.equal(false);
  });

  it('rejects create when record exists and update on version mismatch (CAS conflict)', async () => {
    const { store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const first = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: null });

    let conflict;
    try {
      await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: null });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).to.be.instanceOf(NotesStoreError);
    expect(conflict.code).to.equal('notes_cas_conflict');

    let conflict2;
    try {
      await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: 'not_the_version' });
    } catch (error) {
      conflict2 = error;
    }
    expect(conflict2?.code).to.equal('notes_cas_conflict');

    // 正确版本可更新
    const updated = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: first.record_version });
    expect(updated.record_version).to.be.a('string').not.equal(first.record_version);
    expect((await store.read(scopeRef, 'k1')).record_version).to.equal(updated.record_version);
  });

  it('read does not renew TTL (no touch, expires_at unchanged)', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: null });

    const before = rowOf(db, scopeRef, 'k1').expires_at;
    await new Promise(resolve => setTimeout(resolve, 5));
    await store.read(scopeRef, 'k1');
    const after = rowOf(db, scopeRef, 'k1').expires_at;

    expect(after).to.equal(before); // 不滑动续期
  });

  it('treats expired records as missing and prunes them (lazy delete)', async () => {
    let now = Date.now();
    const { db, store } = makeStore({ clock: () => now });
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: null });
    now += (NOTES_TTL_SECONDS + 1) * 1000; // 快进过期

    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
    expect(rowOf(db, scopeRef, 'k1')).to.equal(null); // read 命中过期行时惰性 DELETE

    // list 同样过滤并惰性删除过期行
    await store.write(scopeRef, 'k2', sampleRecord({ key: 'k2', scopeRef }), { expectedVersion: null });
    const lateExpiry = new Date(now + NOTES_TTL_SECONDS * 1000).toISOString();
    await store.write(scopeRef, 'k3', sampleRecord({ key: 'k3', scopeRef, expires_at: lateExpiry }), { expectedVersion: null });
    now += 2 * (NOTES_TTL_SECONDS + 1) * 1000;

    expect(await store.list(scopeRef)).to.deep.equal([]);
    expect(rowOf(db, scopeRef, 'k2')).to.equal(null);
    expect(rowOf(db, scopeRef, 'k3')).to.equal(null);
  });

  it('create replaces an expired leftover row in place (unique key not blocked)', async () => {
    let now = Date.now();
    const { db, store } = makeStore({ clock: () => now });
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: null });
    now += (NOTES_TTL_SECONDS + 1) * 1000;

    // 过期行未被惰性删除（无 read/list 触发）时，create 仍可成功
    const recreated = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'reborn' }), { expectedVersion: null });
    const row = rowOf(db, scopeRef, 'k1');
    expect(row.record_version).to.equal(recreated.record_version);
    expect((await store.read(scopeRef, 'k1')).current.content).to.equal('reborn');
    expect(db.rows.size).to.equal(1); // 原位替换，无重复行
  });

  it('delete honors the expected version (CAS delete)', async () => {
    const { store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const stored = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: null });

    let conflict;
    try {
      await store.delete(scopeRef, 'k1', { expectedVersion: `${stored.record_version}x` });
    } catch (error) {
      conflict = error;
    }
    expect(conflict?.code).to.equal('notes_cas_conflict');
    expect(await store.read(scopeRef, 'k1')).to.not.equal(undefined);

    expect(await store.delete(scopeRef, 'k1', { expectedVersion: stored.record_version })).to.equal(true);
    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
  });

  it('persists expires_at taken from record.expires_at (adapter-injected)', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const expiresIso = new Date(Date.now() + 3600 * 1000).toISOString();
    const stored = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, expires_at: expiresIso }), { expectedVersion: null });
    expect(rowOf(db, scopeRef, 'k1').expires_at).to.equal(Date.parse(expiresIso));
    expect(stored.expires_at).to.equal(expiresIso);
  });
});

describe('ErixNotesStoreAdapter', () => {
  it('implements exactly the erix 5-method port and nothing amphibious', async () => {
    const { store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });

    for (const method of ['write', 'read', 'list', 'complete', 'janitor']) {
      expect(typeof adapter[method], method).to.equal('function');
    }
    expect(typeof adapter.take).to.equal('undefined');
    expect(typeof adapter.touch).to.equal('undefined');
    expect(typeof adapter.listWithDetails).to.equal('undefined');
    expect(typeof adapter.deleteMany).to.equal('undefined');
  });

  it('PsycheNotesFacade exposes only take (no amphibious erix port)', () => {
    const { store } = makeStore();
    const facade = new PsycheNotesFacade({ store });
    expect(typeof facade.take).to.equal('function');
    for (const method of ['write', 'read', 'list', 'complete', 'janitor', 'touch', 'deleteMany']) {
      expect(typeof facade[method], method).to.equal('undefined');
    }
  });

  it('converts revoked writes into physical deletes (no tombstone left)', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });

    const existing = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: null });
    const ts = new Date().toISOString();
    await adapter.write({
      scope: 'run', scopeRef, key: 'k1',
      record: { ...existing, state: 'revoked', revoked_at: ts, updated_at: ts },
    });

    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
    expect(rowOf(db, scopeRef, 'k1')).to.equal(null);
    // read 返回 missing（物理删除，无 revoked 墓碑可读）
    expect(await adapter.read({ scope: 'run', scopeRef, key: 'k1' })).to.equal(undefined);
  });

  it('is a defensive no-op for complete/janitor (no lifecycle side effects)', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });
    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }), { expectedVersion: null });
    const before = rowOf(db, scopeRef, 'k1').updated_at;

    expect(await adapter.complete({ scope: 'run', scopeRef })).to.deep.equal({ status: 'found', completed: 0 });
    expect(await adapter.janitor({ scope: 'run', scopeRef })).to.deep.equal({ status: 'found', changed: 0, revoked: 0 });

    const after = await store.read(scopeRef, 'k1');
    expect(after.state).to.equal('active'); // 未被 lifecycle 改动
    expect(rowOf(db, scopeRef, 'k1').updated_at).to.equal(before);
  });

  it('overrides stale expires_at on every write (single TTL source)', async () => {
    let now = Date.now();
    const store = new DbNoteRecordStore({ db: createFakeDb(), clock: () => now });
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef, clock: () => now });

    const stale = sampleRecord({ key: 'k1', scopeRef, expires_at: '2030-01-01T00:00:00.000Z' });
    await adapter.write({ scope: 'run', scopeRef, key: 'k1', record: stale });

    const stored = await store.read(scopeRef, 'k1');
    const expectedExpiry = now + NOTES_TTL_SECONDS * 1000;
    expect(Math.abs(Date.parse(stored.expires_at) - expectedExpiry)).to.be.lessThan(2000);
  });

  it('rejects writes that are not based on the current record (CAS guard, no retry)', async () => {
    const { store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });
    const ts = new Date().toISOString();

    // 首次创建（无 predecessor）
    await adapter.write({ scope: 'run', scopeRef, key: 'k1', record: sampleRecord({ key: 'k1', scopeRef }) });

    // 伪造的"更新"：superseded 与 current 都对不上存储现状
    let conflict;
    try {
      await adapter.write({
        scope: 'run', scopeRef, key: 'k1',
        record: {
          ...sampleRecord({ key: 'k1', scopeRef }),
          current: { content: 'forged', provenance: { source: 'agent', verified: true, ts }, ts },
          superseded: [{ content: 'other', invalid: true }],
        },
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict?.code).to.equal('notes_cas_conflict');
  });

  it('binds the scopeRef: foreign-scope records are coerced to the bound scope', async () => {
    const { store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const otherScope = buildNotesScopeRef('user_2', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });

    // 与 erix file store 语义一致：写入时强制绑定 scopeRef，不采纳记录自带值
    await adapter.write({
      scope: 'run', scopeRef: otherScope, key: 'k1',
      record: sampleRecord({ key: 'k1', scopeRef: otherScope }),
    });

    const stored = await store.read(scopeRef, 'k1');
    expect(stored.scopeRef).to.equal(scopeRef);
    expect(await store.read(otherScope, 'k1')).to.equal(undefined);
  });
});

describe('PsycheNotesFacade', () => {
  it('take saves and reports overwritten', async () => {
    const { store } = makeStore();
    const facade = new PsycheNotesFacade({ store });
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    expect(await facade.take('user_1', 'expert_1', 'wm_1', { content: 'a', type: 'working_memory', relevance: 0.9 }))
      .to.deep.equal({ overwritten: false });
    expect(await facade.take('user_1', 'expert_1', 'wm_1', { content: 'b' }))
      .to.deep.equal({ overwritten: true });

    const stored = await store.read(scopeRef, 'wm_1');
    expect(stored.current.content).to.equal('b');
    expect(stored.superseded).to.have.length(1);
    expect(stored.superseded[0].invalid).to.equal(true);
  });

  it('scopes notes by user_id + expert_id (parents and children isolated)', async () => {
    const { store } = makeStore();
    const facade = new PsycheNotesFacade({ store });

    await facade.take('user_1', 'expert_1', 'k1', { content: 'parent' });
    await facade.take('user_1', 'expert_2', 'k1', { content: 'child' });

    const parentScope = buildNotesScopeRef('user_1', 'expert_1');
    const childScope = buildNotesScopeRef('user_1', 'expert_2');
    expect((await store.read(parentScope, 'k1')).current.content).to.equal('parent');
    expect((await store.read(childScope, 'k1')).current.content).to.equal('child');
  });

  it('injects expires_at aligned with the store deadline on facade writes', async () => {
    const { db, store } = makeStore();
    const facade = new PsycheNotesFacade({ store });
    await facade.take('user_1', 'expert_1', 'k1', { content: 'a' }, 3600);
    const stored = await store.read(buildNotesScopeRef('user_1', 'expert_1'), 'k1');
    const ttlMs = Date.parse(stored.expires_at) - Date.now();
    expect(ttlMs).to.be.greaterThan(3500 * 1000).and.lessThanOrEqual(3600 * 1000);
    // expires_at 列与 record.expires_at 同源（毫秒对齐）
    expect(rowOf(db, buildNotesScopeRef('user_1', 'expert_1'), 'k1').expires_at)
      .to.equal(Date.parse(stored.expires_at));
  });
});
