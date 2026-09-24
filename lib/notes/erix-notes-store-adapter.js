/**
 * Erix Notes Store Adapter - erix 5 方法 NotesStore 端口（MariaDB CAS 实现）
 *
 * 职责（issue #1132 决策 3 修订）：
 * - 完整实现 erix assertNotesStore 要求的 5 方法（write/read/list/complete/janitor），
 *   满足装配校验；
 * - 绑定稳定 scopeRef（user_id + expert_id 派生），校验 scope === 'run' 与 isNoteRecord；
 * - 统一注入 expires_at（覆盖 erix 默认保留的旧 expires_at，防止双源漂移）；
 * - note_forget 写的 state:"revoked" 墓碑 → 转换为 CAS 物理删除（决策 2）；
 * - complete/janitor 防御性 no-op：满足装配校验但不产生任何记录变更（不接 lifecycle）；
 * - 不暴露 take/touch —— 宿主侧走 PsycheNotesFacade，两者互不实现对方接口（禁止两栖）。
 *
 * 并发：erix note_take 不带版本号，适配层从待写 record 的 superseded 取 predecessor
 * 与存储当前 current 比对（record.current 兜底 metadata-only 更新），
 * 存储当前 record_version 作 CAS 版本；基准不匹配与版本冲突均显式抛
 * NotesStoreError（code: notes_cas_conflict），不静默 LWW、不重试
 * （同一 record 重试对基准不匹配冲突无效，评审修正项）。
 */

import { NotesStoreError, isNoteRecord } from 'erix-agent';
import {
  NOTES_TTL_SECONDS,
  assertNoteRecord,
  withUniformExpiresAt,
} from './notes-policy.js';
import { isNotesCasConflict } from './db-note-record-store.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function stripInvalidFlag(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const { invalid: _discarded, ...rest } = entry;
  return rest;
}

function assertScopeRequest(request, { keyRequired = false } = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('NotesStore request must be an object');
  }
  if (request.scope !== undefined && request.scope !== 'run') {
    throw new TypeError('NotesStore supports only run scope');
  }
  if (keyRequired && (typeof request.key !== 'string' || request.key.length === 0)) {
    throw new TypeError('NotesStore key must be a non-empty string');
  }
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
    assertScopeRequest(request, { keyRequired: true });
    const { key } = request;

    const incoming = request.record
      && typeof request.record === 'object'
      && !Array.isArray(request.record)
      ? { ...request.record, scopeRef: this.scopeRef }
      : request.record;
    if (!isNoteRecord(incoming, { key, scopeRef: this.scopeRef })) {
      throw new TypeError('NotesStore write requires a valid NoteRecord');
    }
    const record = withUniformExpiresAt(incoming, this.ttlSeconds, this.clock());

    if (record.state === 'revoked') {
      await this._physicalDelete(key);
      return;
    }
    await this._casWrite(key, record);
  }

  async _casWrite(key, record) {
    const stored = await this.store.read(this.scopeRef, key);

    if (!stored) {
      // 创建路径：read 未命中 → superseded 必须为空
      if (Array.isArray(record.superseded) && record.superseded.length > 0) {
        throw new NotesStoreError(
          'notes_cas_conflict: predecessor missing (record expired or raced)',
          'notes_cas_conflict',
        );
      }
      await this.store.write(this.scopeRef, key, record, { expectedVersion: null, ttlSeconds: this.ttlSeconds });
      return;
    }

    // 更新路径：待写 record 必须基于存储当前状态构造。
    // 依据候选：superseded 末尾 predecessor（note_take 正常更新）或
    // record.current 本身（note_forget 等 metadata-only 更新，current 未变）。
    const candidates = [
      ...(record.superseded.length > 0
        ? [stripInvalidFlag(record.superseded[record.superseded.length - 1])]
        : []),
      stripInvalidFlag(record.current),
    ];
    const matches = candidates.some((candidate) => canonical(candidate) === canonical(stored.current));
    if (!matches) {
      throw new NotesStoreError(
        'notes_cas_conflict: write is not based on the current record',
        'notes_cas_conflict',
      );
    }
    await this.store.write(this.scopeRef, key, record, {
      expectedVersion: stored.record_version ?? null,
      ttlSeconds: this.ttlSeconds,
    });
  }

  async _physicalDelete(key) {
    const stored = await this.store.read(this.scopeRef, key);
    if (stored) {
      await this.store.delete(this.scopeRef, key, {
        expectedVersion: stored.record_version ?? undefined,
      });
    }
  }

  /**
   * erix 端口：读取（不 touch、不续期）。
   */
  async read(request) {
    assertScopeRequest(request, { keyRequired: true });
    const { key } = request;

    const record = await this.store.read(this.scopeRef, key);
    if (record) {
      return assertNoteRecord(record, { key, scopeRef: this.scopeRef });
    }
    return undefined;
  }

  /**
   * erix 端口：列出（不续期）。
   */
  async list(request) {
    assertScopeRequest(request);
    const records = await this.store.list(this.scopeRef);
    return records.map((record) => assertNoteRecord(record, { scopeRef: this.scopeRef }));
  }

  /**
   * 防御性 no-op：不接 completeRun lifecycle，不产生任何记录变更。
   */
  async complete() {
    return { status: 'found', completed: 0 };
  }

  /**
   * 防御性 no-op：不接 janitor lifecycle，不产生任何记录变更。
   */
  async janitor() {
    return { status: 'found', changed: 0, revoked: 0 };
  }
}

export default ErixNotesStoreAdapter;
