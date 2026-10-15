/**
 * Erix Notes Store Adapter - erix 5 方法 NotesStore 端口（MariaDB 实现，同 key 并发 LWW）
 *
 * 职责（issue #1132 决策 3 修订）：
 * - 完整实现 erix assertNotesStore 要求的方法（0.12.0 起 write/read/list/complete/
 *   revoke/purge），满足装配校验；janitor 为 0.10 兼容保留；
 * - 以请求 scopeRef 访问绑定稳定作用域（user_id + expert_id 派生），校验 scope === 'run' 与 isNoteRecord；
 * - 统一注入 expires_at（覆盖 erix 默认保留的旧 expires_at，防止双源漂移）；
 * - note_forget（0.12.0 起经 store.revoke 写墓碑）：revoke → 物理删除（决策 2）；
 *   0.18.0 官方契约的并发护栏原样保留：missing 哨兵答 { status:'missing', revoked:0 }，
 *   expectedState / expectedUpdatedAt 不匹配答 { status:'unchanged', revoked:0 }（不覆盖）；
 * - complete：把本 scope 的 active 记录置为 done 并返回 completed 计数（#1185 ①）；
 * - purge：跨 scope 全量清扫真清（按宿主 TTL 权威 expires_at 删过期行），
 *   非法 before 抛 TypeError（#1185 ②；宿主可自研调度/TTL，但方法必须真清）；
 * - list limit：按上游 normalizeListRequest 语义只接受正 safe integer（拒绝 0 与
 *   非 safe integer），>200 钳到 200（#1185 ③）；
 * - list filters（#1210）：语义单一来源在 notes-policy（normalizeListFilters /
 *   matchesListFilters，与上游 src/store/notes-port.js 同口径，那两个 helper 未从包根
 *   导出故宿主自己实现）；非法值在**读任何数据之前**抛 TypeError（message 含
 *   filters.state / filters.source / filters.tag / filters.minRelevance），合法值**真生效**
 *   （先过滤后截 limit）；sort 仍未实现（上游只承诺 relevance/pinned_updated 两种稳定排序）；
 * - 元数据投影（裁决 6A）：read/list 出口剥离宿主私有元数据 record_version/expires_at，
 *   note_record 的两列仍在 schema 里，只是不外泄到公共记录形状（#1185 ④）；
 * - 不暴露 take/touch —— 宿主侧走 PsycheNotesFacade，两者互不实现对方接口（禁止两栖）。
 *
 * 并发（唯一一层，issue #1203 裁决）：只有 (scope_ref, note_key) 上的唯一键
 * uk_scope_ref_key。erix note_take 本来就不带版本号，端口也不再从待写 record 的
 * superseded/current 反推「你是否基于存储当前记录」——端口只验形状（isNoteRecord）；
 * 存储层也不再拿 record_version 做乐观锁。同 key 并发写是**后写覆盖（LWW）**：
 * 没有版本/基准冲突这回事，最终可读的是最后落库那一次的完整记录。谱系校验已在
 * 上一个 commit 删除，版本号校验已于 #1203 删除——端口与存储层都不再做版本/谱系判断。
 * 仅剩的显式报错是并发创建竞态撞唯一键（一个 key 一行的硬约束），
 * code: notes_unique_key_conflict，不静默丢弃写入。
 */

import { isNoteRecord } from 'erix-agent';
import {
  NOTES_TTL_SECONDS,
  assertNoteRecord,
  canonicalizeNotesScopeRef,
  matchesListFilters,
  normalizeListFilters,
  withUniformExpiresAt,
} from './notes-policy.js';

/**
 * 宿主私有元数据列（note_record.record_version / note_record.expires_at）：
 * 写入指纹（record_version，#1203 起只写不判）与 TTL 权威都存在记录 JSON 里，
 * 但不得出现在端口出口的公共记录形状上
 * （issue #1185 ④ / erix#183 裁决 6A：契约的往返 deepEqual 是 JSON 值严格相等）。
 * 只投影字段，不动 DDL。
 */
const HOST_METADATA_FIELDS = ['record_version', 'expires_at'];

function projectRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const projected = { ...record };
  for (const field of HOST_METADATA_FIELDS) delete projected[field];
  return projected;
}

/** 上游 src/store/notes.js normalizeListRequest 的同口径上限。 */
const LIST_LIMIT_MAX = 200;

/**
 * list limit 校验（上游语义，在读取任何数据之前抛）：给了就必须是正 safe
 * integer；未给返回 undefined（= 全量）。返回钳制后的 limit。
 */
function normalizeLimit(limit) {
  if (limit === undefined) return undefined;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError('NotesStore limit must be a positive safe integer');
  }
  return Math.min(limit, LIST_LIMIT_MAX);
}

/**
 * purge 的请求校验（对齐上游 assertRequest(request, { scopeRefRequired:false })）：
 * purge 是唯一扫遍全部 scope 的方法，scopeRef 传了也只是被忽略，
 * 因此不得拿绑定 scope 去卡它。
 */
function assertPurgeRequest(request) {
  if (request === undefined || request === null) return {};
  if (typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('NotesStore request must be an object');
  }
  if (request.scope !== undefined && request.scope !== 'run') {
    throw new TypeError('NotesStore supports only run scope');
  }
  if (request.scopeRef !== undefined
    && (typeof request.scopeRef !== 'string' || request.scopeRef.trim() === '')) {
    throw new TypeError('NotesStore scopeRef must be a non-empty string');
  }
  return request;
}

/**
 * before 解析（上游同口径：不可解析一律 TypeError，不静默当「无 before」）。
 * before 只能缩小清扫窗口，绝不放大。
 */
function parseBeforeMs(before) {
  if (before === undefined) return undefined;
  const parsed = Date.parse(before);
  if (!Number.isFinite(parsed)) {
    throw new TypeError('NotesStore purge before must be a parseable date string');
  }
  return parsed;
}

/**
 * 把待写记录的 scopeRef 归一到端口绑定的 scopeRef（上游文件适配器同口径：
 * 目录与持久化的 record.scopeRef 用同一个规范值）。
 * 只接受「与绑定 scope 同一规范身份」的两种写法（逻辑 ref 与其 canonical
 * `run-h-...` 形态）；外来 scope 的记录一律原样交给 isNoteRecord 拒掉。
 */
function normalizeRecordScope(record, scopeRef) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  if (record.scopeRef === scopeRef || typeof record.scopeRef !== 'string') return record;
  try {
    if (canonicalizeNotesScopeRef(record.scopeRef) === canonicalizeNotesScopeRef(scopeRef)) {
      return { ...record, scopeRef };
    }
  } catch {
    return record;
  }
  return record;
}

function assertScopeRequest(request, expectedScopeRef, { keyRequired = false } = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('NotesStore request must be an object');
  }
  if (typeof request.scopeRef !== 'string'
    || request.scopeRef.trim() === ''
    || request.scopeRef !== expectedScopeRef) {
    throw new TypeError('NotesStore scopeRef must match the adapter scopeRef');
  }
  if (request.scope !== undefined && request.scope !== 'run') {
    throw new TypeError('NotesStore supports only run scope');
  }
  if (keyRequired && (typeof request.key !== 'string' || request.key.length === 0)) {
    throw new TypeError('NotesStore key must be a non-empty string');
  }
  return request.scopeRef;
}

export class ErixNotesStoreAdapter {
  /**
   * @param {object} options
   * @param {object} options.store - DbNoteRecordStore（或其 duck-type 等价物，测试注入）
   * @param {string} options.scopeRef - 绑定 scopeRef（buildNotesScopeRef 派生）
   * @param {() => number} [options.clock] - 时钟（ms）
   * @param {number} [options.ttlSeconds] - TTL（秒），默认 NOTES_TTL_SECONDS
   */
  constructor({
    store,
    scopeRef,
    clock = () => Date.now(),
    ttlSeconds = NOTES_TTL_SECONDS,
  }) {
    if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') {
      throw new TypeError('ErixNotesStoreAdapter requires a note record store');
    }
    if (typeof scopeRef !== 'string' || scopeRef.trim() === '') {
      throw new TypeError('ErixNotesStoreAdapter requires a bound scopeRef');
    }
    this.store = store;
    this.scopeRef = scopeRef;
    this.clock = clock;
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * erix 端口：写入。revoked 记录转为物理删除。
   */
  async write(request) {
    const scopeRef = assertScopeRequest(request, this.scopeRef, { keyRequired: true });
    const { key } = request;

    const incoming = normalizeRecordScope(request.record, scopeRef);
    if (!isNoteRecord(incoming, { key, scopeRef })) {
      throw new TypeError('NotesStore write requires a valid NoteRecord');
    }
    const record = withUniformExpiresAt(incoming, this.ttlSeconds, this.clock());

    if (record.state === 'revoked') {
      await this._physicalDelete(scopeRef, key);
      return;
    }
    await this._upsert(scopeRef, key, record);
  }

  /**
   * 后写覆盖（LWW，#1203）：不先读基准、不传版本号，该覆盖还是该插入由存储层判断；
   * 并发创建竞态由存储层唯一键接住。
   */
  async _upsert(scopeRef, key, record) {
    await this.store.write(scopeRef, key, record, { ttlSeconds: this.ttlSeconds });
  }

  async _physicalDelete(scopeRef, key) {
    await this.store.delete(scopeRef, key);
  }

  /**
   * erix 端口：读取（不 touch、不续期）。出口剥离宿主私有元数据（#1185 ④）。
   */
  async read(request) {
    const scopeRef = assertScopeRequest(request, this.scopeRef, { keyRequired: true });
    const { key } = request;

    const record = await this.store.read(scopeRef, key);
    if (record) {
      return projectRecord(assertNoteRecord(record, { key, scopeRef }));
    }
    return undefined;
  }

  /**
   * erix 端口：列出（不续期）。limit 与 filters 都在**读任何数据之前**校完（#1185 ③ 同口径），
   * 出口剥离宿主私有元数据（#1185 ④）。
   *
   * filters（#1210）：上游 list 的口径是「先过滤 → 再排序 → 最后 limit 截断」，
   * 因此必须在 slice 之前生效；只校不滤等于把不匹配的记录交给调用方。
   */
  async list(request) {
    assertScopeRequest(request, this.scopeRef);
    // 上游 normalizeListRequest：读任何数据之前就拒绝非法 limit / filters
    const limit = normalizeLimit(request.limit);
    const filters = normalizeListFilters(request.filters);
    const records = await this.store.list(this.scopeRef);
    const matched = records
      .map((record) => projectRecord(assertNoteRecord(record, { scopeRef: this.scopeRef })))
      .filter((record) => matchesListFilters(record, filters));
    return limit === undefined ? matched : matched.slice(0, limit);
  }

  /**
   * erix 端口（0.12.0）：撤销 = 写墓碑 → touwaka 决策 2 转为物理删除。
   * 单一撤销语义来源：note_forget 不再读后自写，统一经此方法。
   */
  async revoke(request) {
    const scopeRef = assertScopeRequest(request, this.scopeRef, { keyRequired: true });
    const { key } = request;

    const stored = await this.store.read(scopeRef, key);
    if (!stored) {
      // missing 哨兵：契约要求带 revoked: 0（物理删除宿主重复 revoke 也走这条）
      return { status: 'missing', revoked: 0 };
    }
    if (stored.state === 'revoked') {
      return { status: 'unchanged', revoked: 0 };
    }
    // expectedState / expectedUpdatedAt 并发护栏：被他人改写过的记录一律 unchanged，
    // 不得覆盖上游没见过的记录（erix#183 裁决 3B 只放宽存储形态，护栏不放宽）。
    if (request.expectedState !== undefined && stored.state !== request.expectedState) {
      return { status: 'unchanged', revoked: 0 };
    }
    if (request.expectedUpdatedAt !== undefined && stored.updated_at !== request.expectedUpdatedAt) {
      return { status: 'unchanged', revoked: 0 };
    }
    await this._physicalDelete(scopeRef, key);
    return { status: 'found', revoked: 1 };
  }

  /**
   * erix 端口（#1185 ①）：本 scope 的 active 记录全部置 done，返回 completed 计数。
   * 全量扫描走 store.list（不走公共 list，避免 limit 钳制截断），逐条后写覆盖；
   * 只改 state + 推 updated_at，不动宿主 TTL 的 expires_at（上游 complete 同口径）。
   */
  async complete(request) {
    const scopeRef = assertScopeRequest(request, this.scopeRef);
    const records = await this.store.list(scopeRef);
    const nowMs = this.clock();
    let completed = 0;
    for (const stored of records) {
      if (!stored || stored.state !== 'active') continue;
      await this.store.write(scopeRef, stored.key, {
        ...stored,
        state: 'done',
        updated_at: new Date(nowMs).toISOString(),
      }, {
        ttlSeconds: this.ttlSeconds,
      });
      completed += 1;
    }
    return { status: 'found', completed };
  }

  /**
   * erix 端口（#1185 ②）：跨 scope 全量清扫。上游契约把它当硬义务：
   * purge 是唯一扫遍全部 scope 的方法（传了 scopeRef 也忽略），必须真删；
   * before 不可解析一律 TypeError。宿主 TTL 权威是 note_record.expires_at，
   * 清扫口径：删除 deadline 已到（expires_at <= min(before, now)）的行，
   * before 只能缩小窗口。调度仍归宿主（本方法不自己定时跑）。
   */
  async purge(request = {}) {
    const purgeRequest = assertPurgeRequest(request);
    const beforeMs = parseBeforeMs(purgeRequest.before);
    const { scanned, purged } = await this.store.purge({ beforeMs });
    return { status: 'found', scanned, purged };
  }

  /**
   * 防御性 no-op：erix 0.10 兼容保留（0.12.0 已用 purge 取代 janitor）。
   */
  async janitor() {
    return { status: 'found', changed: 0, revoked: 0 };
  }
}

export default ErixNotesStoreAdapter;
