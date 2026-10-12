/**
 * Notes 基础设施单测：DB Store / Adapter / Facade / Policy
 * 覆盖 issue #1132 决策 3 修订：TTL 不续期、过期过滤与惰性删除、
 * forget 后无 record、scope 稳定性、门面不两栖、revoked→物理删除、
 * complete/janitor no-op、expires_at 对齐；
 * 以及 issue #1203：同 key 并发 = 后写覆盖（LWW），无版本冲突；唯一键仍是硬约束。
 */

import { expect } from 'chai';
import { NotesStoreError } from 'erix-agent';
import {
  DbNoteRecordStore,
  ErixNotesStoreAdapter,
  PsycheNotesFacade,
  NOTES_TTL_SECONDS,
  buildNotesScopeRef,
  canonicalizeNotesScopeRef,
} from '../../lib/notes/index.js';
import { createFakeDb } from './helpers/fake-db.js';

function makeStore({ clock } = {}) {
  const db = createFakeDb();
  const store = new DbNoteRecordStore({ db, clock: clock || (() => Date.now()) });
  return { db, store };
}

function rowOf(db, scopeRef, key) {
  return db.rows.get(`${canonicalizeNotesScopeRef(scopeRef)}|${key}`) || null;
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

    const stored = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }));
    expect(stored.record_version).to.be.a('string').with.length(20);
    const row = rowOf(db, scopeRef, 'k1');
    expect(row.id).to.match(/^nr_[0-9a-zA-Z]{20}$/);
    expect(row.record_version).to.equal(stored.record_version);
    expect(row.expires_at).to.equal(Date.parse(stored.expires_at));

    const read = await store.read(scopeRef, 'k1');
    expect(read.current.content).to.equal('hello');
    expect(read.record_version).to.equal(stored.record_version);

    await store.write(scopeRef, 'k2', sampleRecord({ key: 'k2', scopeRef }));
    expect((await store.list(scopeRef)).map(r => r.key).sort()).to.deep.equal(['k1', 'k2']);

    expect(await store.delete(scopeRef, 'k1')).to.equal(true);
    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
    expect(rowOf(db, scopeRef, 'k1')).to.equal(null);
    // 幂等删除
    expect(await store.delete(scopeRef, 'k1')).to.equal(false);
  });

  it('same-key writes are last-write-wins: no conflict, later content is final', async () => {
    let now = Date.now();
    const { db, store } = makeStore({ clock: () => now });
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    const first = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'first' }));
    const firstUpdatedAt = rowOf(db, scopeRef, 'k1').updated_at;

    // #1203：没有「期望版本」这个概念——同 key 再写一次不抛错、不需要基准
    now += 1000; // 时钟前移，便于断言 updated_at 前移
    const second = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'second' }));
    expect(second.current.content).to.equal('second');

    // 第二次的内容就是最终内容
    const stored = await store.read(scopeRef, 'k1');
    expect(stored.current.content).to.equal('second');
    expect(stored.record_version).to.equal(second.record_version);

    // updated_at 前移；record_version 列继续写（新串）但不再参与判断
    const row = rowOf(db, scopeRef, 'k1');
    expect(row.updated_at).to.equal(now);
    expect(row.updated_at).to.be.greaterThan(firstUpdatedAt);
    expect(row.record_version).to.be.a('string').with.length(20);
    expect(row.record_version).to.not.equal(first.record_version);
    expect(JSON.parse(row.record).current.content).to.equal('second');

    // 唯一键 uk_scope_ref_key 仍是硬约束：一个 key 只有一行
    expect(db.rows.size).to.equal(1);
  });

  it('create race still hits uk_scope_ref_key and reports it without any version wording', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const storedRef = canonicalizeNotesScopeRef(scopeRef);
    const realExecute = db.execute.bind(db);
    let rivalInjected = false;

    // 并发创建竞态：我们的 UPDATE 扑空之后、INSERT 之前，对手把同一 key 落了库
    db.execute = async (sql, params) => {
      if (!rivalInjected && /^UPDATE/i.test(String(sql))) {
        rivalInjected = true;
        db.rows.set(`${storedRef}|k1`, {
          id: 'nr_rival',
          scope: 'run',
          scope_ref: storedRef,
          note_key: 'k1',
          record: JSON.stringify(sampleRecord({ key: 'k1', scopeRef, content: 'rival' })),
          record_version: 'rival0000000000000000',
          expires_at: Date.now() + 60000,
          created_at: Date.now(),
          updated_at: Date.now(),
        });
        return { affectedRows: 0, changedRows: 0 };
      }
      return realExecute(sql, params);
    };

    let conflict;
    try {
      await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'mine' }));
    } catch (error) {
      conflict = error;
    }

    // 唯一键是「一个 key 一行」的硬约束，仍显式报错；但它不是乐观锁：code 与文案都不提版本
    expect(conflict).to.be.instanceOf(NotesStoreError);
    expect(conflict.code).to.equal('notes_unique_key_conflict');
    expect(conflict.message).to.not.match(/record_version|version|版本|CAS/i);
    expect(db.rows.size).to.equal(1);
    expect((await store.read(scopeRef, 'k1')).current.content).to.equal('rival');
  });

  it('read does not renew TTL (no touch, expires_at unchanged)', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }));

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

    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }));
    now += (NOTES_TTL_SECONDS + 1) * 1000; // 快进过期

    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
    expect(rowOf(db, scopeRef, 'k1')).to.equal(null); // read 命中过期行时惰性 DELETE

    // list 同样过滤并惰性删除过期行
    await store.write(scopeRef, 'k2', sampleRecord({ key: 'k2', scopeRef }));
    const lateExpiry = new Date(now + NOTES_TTL_SECONDS * 1000).toISOString();
    await store.write(scopeRef, 'k3', sampleRecord({ key: 'k3', scopeRef, expires_at: lateExpiry }));
    now += 2 * (NOTES_TTL_SECONDS + 1) * 1000;

    expect(await store.list(scopeRef)).to.deep.equal([]);
    expect(rowOf(db, scopeRef, 'k2')).to.equal(null);
    expect(rowOf(db, scopeRef, 'k3')).to.equal(null);
  });

  it('create replaces an expired leftover row in place (unique key not blocked)', async () => {
    let now = Date.now();
    const { db, store } = makeStore({ clock: () => now });
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }));
    now += (NOTES_TTL_SECONDS + 1) * 1000;

    // 过期行未被惰性删除（无 read/list 触发）时，create 仍可成功
    const recreated = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'reborn' }));
    const row = rowOf(db, scopeRef, 'k1');
    expect(row.record_version).to.equal(recreated.record_version);
    expect((await store.read(scopeRef, 'k1')).current.content).to.equal('reborn');
    expect(db.rows.size).to.equal(1); // 原位替换，无重复行
  });

  it('deletes by key with no version concept; a missed delete is just false', async () => {
    const { store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const stored = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }));

    // #1203：删除不带版本号，「版本对不上」这个概念已不存在——第一次就直删成功
    expect(await store.delete(scopeRef, 'k1')).to.equal(true);
    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);

    // 再删一次：没删到只是 false，不包装成冲突错误
    expect(await store.delete(scopeRef, 'k1')).to.equal(false);

    // 旧 record_version 不再参与任何判断：写回同一 key 照常成功
    const rewritten = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'again' }));
    expect(rewritten.record_version).to.not.equal(stored.record_version);
    expect((await store.read(scopeRef, 'k1')).current.content).to.equal('again');
  });

  it('persists expires_at taken from record.expires_at (adapter-injected)', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const expiresIso = new Date(Date.now() + 3600 * 1000).toISOString();
    const stored = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, expires_at: expiresIso }));
    expect(rowOf(db, scopeRef, 'k1').expires_at).to.equal(Date.parse(expiresIso));
    expect(stored.expires_at).to.equal(expiresIso);
  });
});

describe('ErixNotesStoreAdapter', () => {
  it('implements exactly the erix 0.12.0 port and nothing amphibious', async () => {
    const { store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });

    // erix 0.12.0 assertNotesStore 要求 write/read/list/complete/revoke/purge；
    // janitor 为 0.10 兼容保留（0.12.0 已用 purge 取代）
    for (const method of ['write', 'read', 'list', 'complete', 'revoke', 'purge', 'janitor']) {
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

    const existing = await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }));
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

  it('revoke physically deletes via CAS (note_forget single revoke path, erix 0.12.0)', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });

    expect((await adapter.revoke({ scope: 'run', scopeRef, key: 'missing' })).status).to.equal('missing');

    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }));
    expect((await adapter.revoke({ scope: 'run', scopeRef, key: 'k1' }))).to.deep.equal({ status: 'found', revoked: 1 });
    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
    expect(rowOf(db, scopeRef, 'k1')).to.equal(null);
  });

  it('flips active records to done on complete (#1185 ①) and keeps janitor a no-op', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });
    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef }));

    // erix 契约硬义务（#1185 ①）：complete 把本 scope 的 active 记录置 done 并计数
    expect(await adapter.complete({ scope: 'run', scopeRef })).to.deep.equal({ status: 'found', completed: 1 });
    expect((await store.read(scopeRef, 'k1')).state).to.equal('done');
    // done 不重复计数
    expect(await adapter.complete({ scope: 'run', scopeRef })).to.deep.equal({ status: 'found', completed: 0 });
    // janitor 仍是 0.10 兼容 no-op（0.12.0 起清理走 purge），不得改记录
    expect(await adapter.janitor({ scope: 'run', scopeRef })).to.deep.equal({ status: 'found', changed: 0, revoked: 0 });
    expect((await store.read(scopeRef, 'k1')).state).to.equal('done');
    // 宿主元数据列不受影响（#1185 ④ 是端口出口投影，不是删列）
    expect(rowOf(db, scopeRef, 'k1').record_version).to.be.a('string');
    expect(rowOf(db, scopeRef, 'k1').expires_at).to.be.a('number');
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

  it('port no longer judges lineage; same-key writers resolve by LWW with no conflict (②)', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });
    const ts = new Date().toISOString();

    // 首次创建（无 predecessor）
    await adapter.write({ scope: 'run', scopeRef, key: 'k1', record: sampleRecord({ key: 'k1', scopeRef }) });

    // ① 已删（上一个 commit）：端口不再从 superseded/current 反推「是否基于存储当前记录」，
    // 谱系对不上的写入照常交给存储层落库。
    await adapter.write({
      scope: 'run', scopeRef, key: 'k1',
      record: {
        ...sampleRecord({ key: 'k1', scopeRef }),
        current: { content: 'not-based-on-current', provenance: { source: 'agent', verified: true, ts }, ts },
        superseded: [{ content: 'other', invalid: true }],
      },
    });
    expect((await store.read(scopeRef, 'k1')).current.content).to.equal('not-based-on-current');

    // ② #1203：同 key 并发不再有版本号可对——对手先落一条完整记录，我们后写照样成功
    let rivalWritten = false;
    const racingStore = {
      read: (ref, key) => store.read(ref, key),
      write: async (ref, key, record, options) => {
        if (!rivalWritten) {
          rivalWritten = true;
          // 旧版本语义下这就是「期间有人推进过 record_version」；现在它只是一次普通覆盖
          const current = await store.read(ref, key);
          await store.write(ref, key, {
            ...current,
            current: { content: 'rival', provenance: { source: 'agent', verified: true, ts }, ts },
            relevance: 0.9,
          });
        }
        return store.write(ref, key, record, options);
      },
      delete: (ref, key, options) => store.delete(ref, key, options),
      list: (ref) => store.list(ref),
    };
    const racingAdapter = new ErixNotesStoreAdapter({ store: racingStore, scopeRef });

    let conflict;
    try {
      await racingAdapter.write({
        scope: 'run', scopeRef, key: 'k1',
        record: {
          ...sampleRecord({ key: 'k1', scopeRef }),
          current: { content: 'later-writer', provenance: { source: 'agent', verified: true, ts }, ts },
        },
      });
    } catch (error) {
      conflict = error;
    }
    // 不存在冲突概念：写入照常成功，不抛 NotesStoreError
    expect(conflict).to.equal(undefined);

    // 后写覆盖：最终可读的是最后落库那一方的完整记录（不是混合/半截记录）
    const final = await store.read(scopeRef, 'k1');
    expect(final.current.content).to.equal('later-writer');
    expect(final.relevance).to.equal(0.5);

    // 端口层的并发双写（对齐官方契约的并发那条）：两方都不被拦下，最终是其中一方的完整形状
    const settled = await Promise.allSettled(['left', 'right'].map((content) => adapter.write({
      scope: 'run', scopeRef, key: 'k1',
      record: {
        ...sampleRecord({ key: 'k1', scopeRef }),
        current: { content, provenance: { source: 'agent', verified: true, ts }, ts },
      },
    })));
    expect(settled.map((entry) => entry.status)).to.deep.equal(['fulfilled', 'fulfilled']);
    const concurrent = await store.read(scopeRef, 'k1');
    expect(['left', 'right']).to.include(concurrent.current.content);
    expect(concurrent.current.provenance.verified).to.equal(true);
    expect(db.rows.size).to.equal(1);
  });

  it('rejects foreign request scopeRef without writing', async () => {
    const { db, store } = makeStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const otherScope = buildNotesScopeRef('user_2', 'expert_1');
    const adapter = new ErixNotesStoreAdapter({ store, scopeRef });

    let error;
    try {
      await adapter.write({
        scope: 'run', scopeRef: otherScope, key: 'k1',
        record: sampleRecord({ key: 'k1', scopeRef: otherScope }),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).to.be.instanceOf(TypeError);
    expect(db.rows.size).to.equal(0);
    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
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

// ---------------------------------------------------------------------------
// issue #1205：过期清理（惰性删除 / purge）必须复核过期条件
//   旧实现「先查过期、后按 key / 按快照 id 直删」，中间另一个 writer 可以用 write()
//   的「撞唯一键 → 原位替换过期残留」路径把同一行写成活行，随后无条件的 DELETE 会
//   静默删掉刚被写活的记录。修复：DELETE 带上与 _isExpired 等价的谓词
//   （expires_at IS NOT NULL AND expires_at <= ?），并沿用同一次调用的 nowMs。
// ---------------------------------------------------------------------------
describe('DbNoteRecordStore expired-row cleanup (#1205)', () => {
  const START_MS = Date.parse('2026-11-05T00:00:00.000Z');

  function makeClockStore(purgeBatchSize) {
    const state = { now: START_MS };
    const db = createFakeDb();
    const opts = { db, clock: () => state.now };
    if (purgeBatchSize !== undefined) opts.purgeBatchSize = purgeBatchSize;
    const store = new DbNoteRecordStore(opts);
    return { db, store, state };
  }

  /**
   * 在下一次 DELETE 真正落地之前插一段代码——模拟「SELECT 已判定过期，DELETE 还没执行」
   * 的交错窗口（fake-db 是同步落库的内存实现，只能靠这种钩子造出交错）。
   * 钩子里的 write() 只发 UPDATE / INSERT，不会被再次拦截。
   */
  function beforeNextDelete(db, hook) {
    const original = db.execute.bind(db);
    let armed = true;
    const seen = { sql: '' };
    db.execute = async (sql, params) => {
      if (armed && /^\s*DELETE/i.test(String(sql))) {
        armed = false;
        seen.sql = String(sql);
        await hook(String(sql));
      }
      return original(sql, params);
    };
    return { calls: seen, restore: () => { db.execute = original; } };
  }

  it('read lazy delete re-checks expiry: a row revived mid-flight is not deleted', async () => {
    const { db, store, state } = makeClockStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'old' }));
    state.now += (NOTES_TTL_SECONDS + 1) * 1000; // k1 过期：read 判定过期，准备按 key DELETE

    const rival = new DbNoteRecordStore({ db, clock: () => state.now });
    const gate = beforeNextDelete(db, async () => {
      // 交错点：read 已看过过期快照，DELETE 尚未执行；并发 writer 原位把这行写成活行
      await rival.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'resurrected' }));
    });

    // 本次调用仍按它看到的快照回答 missing（不回头补读）
    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
    gate.restore();

    // 但复活后的活行必须还在：惰性 DELETE 已复核 expires_at，删不动写活的行
    const row = rowOf(db, scopeRef, 'k1');
    expect(row, 'revived row must survive the lazy delete').to.not.equal(null);
    expect(JSON.parse(row.record).current.content).to.equal('resurrected');
    expect(gate.calls.sql).to.match(/expires_at\s+IS\s+NOT\s+NULL\s+AND\s+expires_at\s*<=\s*\?/i);
    const reread = await store.read(scopeRef, 'k1');
    expect(reread.current.content).to.equal('resurrected');
  });

  it('list lazy delete re-checks expiry: a row revived after the id snapshot is not deleted', async () => {
    const { db, store, state } = makeClockStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    await store.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'old' }));
    await store.write(scopeRef, 'k2', sampleRecord({ key: 'k2', scopeRef, content: 'alive' }));
    state.now += (NOTES_TTL_SECONDS + 1) * 1000;
    // k2 重新写活（LWW），k1 保持过期残留：list 的快照只会把 k1 的 id 记进 expiredIds
    await store.write(scopeRef, 'k2', sampleRecord({ key: 'k2', scopeRef, content: 'alive-2' }));

    const rival = new DbNoteRecordStore({ db, clock: () => state.now });
    const gate = beforeNextDelete(db, async () => {
      await rival.write(scopeRef, 'k1', sampleRecord({ key: 'k1', scopeRef, content: 'resurrected' }));
    });

    const listed = await store.list(scopeRef);
    gate.restore();

    expect(listed.map(r => r.key)).to.deep.equal(['k2']);
    const revived = rowOf(db, scopeRef, 'k1');
    expect(revived, 'revived row must survive the id-snapshot delete').to.not.equal(null);
    expect(JSON.parse(revived.record).current.content).to.equal('resurrected');
    expect(gate.calls.sql).to.match(/expires_at\s+IS\s+NOT\s+NULL\s+AND\s+expires_at\s*<=\s*\?/i);
    expect((await store.read(scopeRef, 'k1')).current.content).to.equal('resurrected');
    expect((await store.read(scopeRef, 'k2')).current.content).to.equal('alive-2');
  });

  it('never expires rows (expires_at IS NULL) survive read / list / purge', async () => {
    const { db, store, state } = makeClockStore();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    const canonical = canonicalizeNotesScopeRef(scopeRef);
    const forever = sampleRecord({ key: 'forever', scopeRef, content: 'keep-me' });
    // 手工插一条 expires_at IS NULL 的行：本 store 的口径是 NULL = 永不过期
    await db.insert(
      `INSERT INTO note_record
         (id, scope, scope_ref, note_key, record, record_version, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['nr_forever000000000000', 'run', canonical, 'forever', JSON.stringify(forever),
        'vvforever00000000000', null, state.now, state.now],
    );
    await store.write(scopeRef, 'doomed', sampleRecord({ key: 'doomed', scopeRef, content: 'gone' }));
    state.now += (NOTES_TTL_SECONDS + 1) * 1000; // doomed 过期，forever 依旧永不过期

    // read：永不过期行照常可读，且不被清理
    const read = await store.read(scopeRef, 'forever');
    expect(read.current.content).to.equal('keep-me');
    expect(rowOf(db, scopeRef, 'forever')).to.not.equal(null);

    // list：永不过期行在结果里，且不被顺手删掉
    expect(await store.read(scopeRef, 'doomed')).to.equal(undefined);
    const listed = await store.list(scopeRef);
    expect(listed.map(r => r.key)).to.deep.equal(['forever']);
    expect(rowOf(db, scopeRef, 'forever')).to.not.equal(null);

    // purge：NULL 无保留期约定，不参与清扫
    await store.write(scopeRef, 'later', sampleRecord({ key: 'later', scopeRef }));
    state.now += (NOTES_TTL_SECONDS + 1) * 1000;
    const purged = await store.purge();
    expect(purged.purged).to.be.greaterThan(0);
    expect(rowOf(db, scopeRef, 'forever'), 'expires_at IS NULL must never be purged').to.not.equal(null);
    expect((await store.read(scopeRef, 'forever')).current.content).to.equal('keep-me');
  });

  /** 数一下分批循环到底跑了几轮（SELECT = 候选拉取，DELETE = 该批有可删行）*/
  function countSweepStatements(db) {
    const counts = { selects: 0, deletes: 0, selectSql: [], deleteSql: [], cursors: [] };
    const originalQuery = db.query.bind(db);
    const originalExecute = db.execute.bind(db);
    db.query = async (sql, params) => {
      const text = String(sql);
      if (/^\s*SELECT/i.test(text) && /\bid\s*>\s*\?/i.test(text)) {
        counts.selects += 1;
        counts.selectSql.push(text);
        counts.cursors.push(String(params?.[0] ?? ''));
      }
      return originalQuery(sql, params);
    };
    db.execute = async (sql, params) => {
      const text = String(sql);
      if (/^\s*DELETE/i.test(text)) {
        counts.deletes += 1;
        counts.deleteSql.push(text);
      }
      return originalExecute(sql, params);
    };
    return counts;
  }

  it('purge sweeps in injected small batches until nothing is expired (live rows untouched)', async () => {
    const { db, store, state } = makeClockStore(2); // 批大小注入：每轮只处理 2 行
    expect(store.purgeBatchSize).to.equal(2);
    const scopeA = buildNotesScopeRef('user_1', 'expert_1');
    const scopeB = buildNotesScopeRef('user_1', 'expert_2');
    const dead = [
      [scopeA, 'dead-1'], [scopeB, 'dead-2'], [scopeA, 'dead-3'],
      [scopeB, 'dead-4'], [scopeA, 'dead-5'],
    ];
    for (const [scopeRef, key] of dead) {
      await store.write(scopeRef, key, sampleRecord({ key, scopeRef }));
    }
    state.now += (NOTES_TTL_SECONDS + 1) * 1000; // 5 行全过期
    await store.write(scopeA, 'live-1', sampleRecord({ key: 'live-1', scopeRef: scopeA }));
    await store.write(scopeB, 'live-2', sampleRecord({ key: 'live-2', scopeRef: scopeB }));
    expect(db.rows.size).to.equal(7);

    const counts = countSweepStatements(db);
    const result = await store.purge();
    // 7 行带 TTL 候选全扫过，过期 5 行全清，活行一行不少
    expect(result).to.deep.equal({ scanned: 7, purged: 5 });
    // 确实发生了多轮：ceil(7 / 2) = 4 轮候选 SELECT，至少 3 轮 DELETE（7 行里只有 2 行是活的）
    expect(counts.selects).to.equal(4);
    expect(counts.deletes).to.be.at.least(3);
    expect(counts.deletes).to.be.at.most(4);
    for (const sql of counts.selectSql) {
      expect(sql).to.match(/expires_at\s+IS\s+NOT\s+NULL\s+AND\s+id\s*>\s*\?/i);
      expect(sql).to.match(/ORDER BY id/i);
      expect(sql).to.match(/LIMIT\s+\?/i);
      expect(sql).to.not.match(/^\s*SELECT[^]*FROM note_record\s*$/i); // 不再整表 SELECT
    }
    for (const sql of counts.deleteSql) {
      expect(sql).to.match(/id\s+IN\s*\(/i);
      expect(sql).to.match(/expires_at\s+IS\s+NOT\s+NULL\s+AND\s+expires_at\s*<=\s*\?/i);
    }
    // keyset 游标严格递增（循环单调向后，不原地打转）
    for (let i = 1; i < counts.cursors.length; i += 1) {
      expect(counts.cursors[i] > counts.cursors[i - 1]).to.equal(true);
    }
    for (const [scopeRef, key] of dead) {
      expect(rowOf(db, scopeRef, key), `${key} should be purged`).to.equal(null);
    }
    expect(rowOf(db, scopeA, 'live-1')).to.not.equal(null);
    expect(rowOf(db, scopeB, 'live-2')).to.not.equal(null);

    // 幂等：再清一次只剩活行，一轮候选 + 一轮空批就退，不误删活行
    const again = countSweepStatements(db);
    expect(await store.purge()).to.deep.equal({ scanned: 2, purged: 0 });
    expect(again.selects).to.equal(2);
    expect(again.deletes).to.equal(0);
    expect(db.rows.size).to.equal(2);
  });

  it('purge({ batchSize }) overrides the constructor size and the loop always terminates', async () => {
    const { db, store, state } = makeClockStore();
    expect(store.purgeBatchSize).to.equal(500); // 默认批大小
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    for (let i = 1; i <= 6; i += 1) {
      await store.write(scopeRef, `d${i}`, sampleRecord({ key: `d${i}`, scopeRef }));
    }
    state.now += (NOTES_TTL_SECONDS + 1) * 1000;

    const counts = countSweepStatements(db);
    expect(await store.purge({ batchSize: 3 })).to.deep.equal({ scanned: 6, purged: 6 });
    expect(counts.selects).to.equal(3); // 3 + 3 + 空批退场
    expect(counts.deletes).to.equal(2);
    expect(db.rows.size).to.equal(0);

    // 空表：一轮空候选立刻退，不会多轮空转；非法批大小回退默认值
    const empty = countSweepStatements(db);
    expect(await store.purge({ batchSize: 0 })).to.deep.equal({ scanned: 0, purged: 0 });
    expect(empty.selects).to.equal(1);
    expect(empty.deletes).to.equal(0);

    // 默认 500：典型小表一轮扫完，不会多出额外的往返
    const small = makeClockStore();
    for (let i = 1; i <= 3; i += 1) {
      await small.store.write(scopeRef, `s${i}`, sampleRecord({ key: `s${i}`, scopeRef: scopeRef }));
    }
    small.state.now += (NOTES_TTL_SECONDS + 1) * 1000;
    const smallCounts = countSweepStatements(small.db);
    expect(await small.store.purge()).to.deep.equal({ scanned: 3, purged: 3 });
    expect(smallCounts.selects).to.equal(1);
    expect(smallCounts.deletes).to.equal(1);
  });
});
