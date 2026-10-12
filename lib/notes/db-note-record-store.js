/**
 * DB Note Record Store - erix NoteRecord 的 MariaDB 存储（唯一键 + LWW + expires_at）
 *
 * 设计要点（issue #1132 决策 3 修订，DDL 已获批准，入 scripts/upgrade-database.js；
 * 并发校验已于 issue #1203 废除，同 key 并发改为后写覆盖 LWW）：
 * - 表：note_record（见 docs/design/data-model.md），scope_ref + note_key 唯一键
 * - DB 中保存 canonical scopeRef；读结果恢复调用方传入的逻辑 scopeRef
 * - value：完整 NoteRecord JSON（LONGTEXT）+ record_version（touwaka 扩展字段：每次写入
 *   生成新随机串照常入库，但**不再作并发判据**，读回只供调用方对账）
 * - 并发（LWW，#1203）：UPDATE ... WHERE scope_ref=? AND note_key=?（无版本条件）后写覆盖；
 *   没有活行（不存在 / 只剩过期残留 / 刚被并发删除）落回 INSERT 创建路径
 * - 唯一键 uk_scope_ref_key 仍是硬约束（一个 key 一行，不是乐观锁）：创建竞态撞
 *   ER_DUP_ENTRY 且残留的是活行 → NotesStoreError(code: notes_unique_key_conflict)
 * - expires_at（BIGINT ms）为 TTL 唯一权威，取自 record.expires_at（adapter/facade 已统一注入）；
 *   read/list 不续期（不 touch、不滑动）；read 命中过期行时惰性 DELETE；
 *   list 全量取 scope_ref 后按过期过滤并惰性删除（scope 内笔记量小，可接受）
 * - 行 id：nr_ 前缀 + Utils.newID()；record_version：Utils.newID() 随机串（VARCHAR(32)，只写不判）
 * - 时间字段 created_at/updated_at 为应用侧写入的毫秒时间戳
 *
 * 数据库访问遵循项目惯例（lib/db.js）：SELECT 用 query/getOne，UPDATE/DELETE 用 execute，
 * INSERT 用 insert；db 实例可注入（测试用内存 fake，见 server/tests/helpers/fake-db.js）。
 */

import { NotesStoreError } from 'erix-agent';
import Utils from '../utils.js';
import {
  NOTES_TTL_SECONDS,
  canonicalizeNotesScopeRef,
} from './notes-policy.js';

export const NOTES_UNIQUE_KEY_CONFLICT = 'notes_unique_key_conflict';

const TABLE = 'note_record';

/**
 * 唯一键冲突（uk_scope_ref_key：一个 key 一行的数据模型硬约束）。
 * 这不是乐观锁——文案与 code 都不出现「版本 / CAS」字样（issue #1203）。
 */
function uniqueKeyConflictError(message) {
  return new NotesStoreError(message || 'notes unique key conflict', NOTES_UNIQUE_KEY_CONFLICT);
}

function isDuplicateKeyError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.name === 'SequelizeUniqueConstraintError') return true;
  const code = error.code || error.original?.code || error.parent?.code;
  return code === 'ER_DUP_ENTRY';
}

function parseRecord(json) {
  try {
    return JSON.parse(json);
  } catch {
    throw new NotesStoreError('笔记记录 JSON 解析失败', 'invalid_record');
  }
}

function withRequestScopeRef(record, scopeRef) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  return { ...record, scopeRef };
}

export class DbNoteRecordStore {
  /**
   * @param {object} options
   * @param {object} options.db - lib/db.js Database 实例（或 duck-type 等价物：
   *   query()/getOne()/insert()/execute() 齐备，测试可注入内存 fake）
   * @param {() => number} [options.clock] - 时钟（ms），默认 Date.now
   * @param {number} [options.ttlSeconds] - 默认 TTL（秒），默认 NOTES_TTL_SECONDS
   */
  constructor({ db, clock = () => Date.now(), ttlSeconds = NOTES_TTL_SECONDS }) {
    if (!db
      || typeof db.query !== 'function'
      || typeof db.getOne !== 'function'
      || typeof db.insert !== 'function'
      || typeof db.execute !== 'function') {
      throw new TypeError('DbNoteRecordStore requires a db with query()/getOne()/insert()/execute()');
    }
    this.db = db;
    this.clock = clock;
    this.ttlSeconds = Number.isSafeInteger(ttlSeconds) && ttlSeconds > 0
      ? ttlSeconds
      : NOTES_TTL_SECONDS;
  }

  _ttlMs(ttlSeconds) {
    const ttl = Number.isSafeInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : this.ttlSeconds;
    return ttl * 1000;
  }

  _expiresMs(record, ttlSeconds, nowMs) {
    // adapter / facade 已统一注入 expires_at（ISO），直接取自 record；
    // 兜底：record 未带 expires_at 时按 TTL 现算（不静默写 NULL）
    const fromRecord = Date.parse(record?.expires_at ?? '');
    if (Number.isFinite(fromRecord)) return fromRecord;
    return nowMs + this._ttlMs(ttlSeconds);
  }

  _isExpired(row, nowMs) {
    return Number.isFinite(row?.expires_at) && row.expires_at <= nowMs;
  }

  /**
   * 读取记录（不 touch、不滑动续期）。expires_at 已过期的行视为 missing 并惰性 DELETE。
   *
   * @param {string} scopeRef
   * @param {string} key
   * @returns {Promise<object|undefined>} NoteRecord（含 record_version）
   */
  async read(scopeRef, key) {
    const nowMs = this.clock();
    const storageScopeRef = canonicalizeNotesScopeRef(scopeRef);
    const row = await this.db.getOne(
      `SELECT id, record, expires_at FROM ${TABLE} WHERE scope_ref = ? AND note_key = ?`,
      [storageScopeRef, key],
    );
    if (!row) return undefined;
    if (this._isExpired(row, nowMs)) {
      await this.db.execute(
        `DELETE FROM ${TABLE} WHERE scope_ref = ? AND note_key = ?`,
        [storageScopeRef, key],
      );
      return undefined;
    }
    return withRequestScopeRef(parseRecord(row.record), scopeRef);
  }

  /**
   * 写入（后写覆盖 LWW，issue #1203：没有期望版本，也不做版本校验）。
   *
   * 路径：先按 (scope_ref, note_key) UPDATE 活行（无版本条件，后写覆盖）；影响行数 0
   * 说明没有活行（从未存在 / 只剩过期残留 / 刚被并发删除），落回创建路径 INSERT；
   * INSERT 撞 uk_scope_ref_key 时：残留是过期行 → 原位替换，是活行 → 唯一键冲突。
   *
   * @param {string} scopeRef
   * @param {string} key
   * @param {object} record - NoteRecord（record_version / expires_at 由本方法管理）
   * @param {object} [options]
   * @param {number} [options.ttlSeconds] - 覆盖默认 TTL
   * @returns {Promise<object>} 实际写入的记录（含新 record_version）
   */
  async write(scopeRef, key, record, { ttlSeconds } = {}) {
    const nowMs = this.clock();
    const storageScopeRef = canonicalizeNotesScopeRef(scopeRef);
    const expiresMs = this._expiresMs(record, ttlSeconds, nowMs);
    const nextVersion = Utils.newID(20);
    const stored = {
      ...record,
      scopeRef: storageScopeRef,
      record_version: nextVersion,
      expires_at: new Date(expiresMs).toISOString(),
    };
    const payload = JSON.stringify(stored);
    const scope = typeof record?.scope === 'string' && record.scope ? record.scope : 'run';

    // 更新路径（LWW，#1203）：活行一律后写覆盖，SQL 不再带 record_version 条件
    const { affectedRows } = await this.db.execute(
      `UPDATE ${TABLE}
         SET record = ?, record_version = ?, expires_at = ?, updated_at = ?
       WHERE scope_ref = ? AND note_key = ?
         AND (expires_at IS NULL OR expires_at > ?)`,
      [payload, nextVersion, expiresMs, nowMs, storageScopeRef, key, nowMs],
    );
    if (affectedRows) return withRequestScopeRef(stored, scopeRef);

    // 影响行数 0 = 没有活行（从未存在 / 只剩过期残留 / 刚被并发删除）：按原语义落回
    // 创建路径，不把「没更到」包装成冲突错误（issue #1203）
    try {
      await this.db.insert(
        `INSERT INTO ${TABLE}
           (id, scope, scope_ref, note_key, record, record_version, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `nr_${Utils.newID(20)}`,
          scope,
          storageScopeRef,
          key,
          payload,
          nextVersion,
          expiresMs,
          nowMs,
          nowMs,
        ],
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // 唯一键冲突：残留的是过期行 → 原位替换（对齐 Redis PXAT 物理过期语义）；
      // 残留的是活行 → 并发创建竞态，显式抛唯一键冲突（一个 key 一行仍是硬约束）
      const { affectedRows: replaced } = await this.db.execute(
        `UPDATE ${TABLE}
           SET record = ?, record_version = ?, expires_at = ?, updated_at = ?
         WHERE scope_ref = ? AND note_key = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
        [payload, nextVersion, expiresMs, nowMs, storageScopeRef, key, nowMs],
      );
      if (!replaced) throw uniqueKeyConflictError('notes_unique_key_conflict: record already exists');
    }
    return withRequestScopeRef(stored, scopeRef);
  }

  /**
   * 列出 scope 内全部未过期记录（不续期）；惰性删除过期残留行。
   *
   * @param {string} scopeRef
   * @returns {Promise<object[]>} NoteRecord 数组
   */
  async list(scopeRef) {
    const nowMs = this.clock();
    const storageScopeRef = canonicalizeNotesScopeRef(scopeRef);
    const rows = await this.db.query(
      `SELECT id, record, expires_at FROM ${TABLE} WHERE scope_ref = ?`,
      [storageScopeRef],
    );
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const records = [];
    const expiredIds = [];
    for (const row of rows) {
      if (this._isExpired(row, nowMs)) {
        expiredIds.push(row.id);
        continue;
      }
      records.push(withRequestScopeRef(parseRecord(row.record), scopeRef));
    }

    if (expiredIds.length > 0) {
      const placeholders = expiredIds.map(() => '?').join(', ');
      await this.db.execute(
        `DELETE FROM ${TABLE} WHERE id IN (${placeholders})`,
        expiredIds,
      );
    }
    return records;
  }

  /**
   * 跨 scope 全量清扫（erix NotesStore purge 端口的存储层实现，#1185 ②）。
   *
   * 不拿 scope_ref 卡：一次调用扫遍全表（purge 是唯一扫遍全部 scope 的方法）。
   * 删行口径：本 store 的 TTL 权威是 expires_at（BIGINT ms），deadline 已到
   * （expires_at <= cutoff）的行物理删除；expires_at IS NULL 的行无保留期约定，
   * 不参与清扫。cutoff = min(beforeMs, now)——before 只能缩小窗口，绝不放大。
   * 上游契约的 purge 不读记录内容（只看时钟），本实现只看 expires_at 列，
   * 同样不解析 record JSON。
   *
   * @param {object} [options]
   * @param {number} [options.beforeMs] - 已解析的 before（ms）；adapter 已拦住不可解析值
   * @returns {Promise<{scanned: number, purged: number}>} 扫到多少行 / 实际删了多少行
   */
  async purge({ beforeMs } = {}) {
    const nowMs = this.clock();
    const cutoff = Math.min(Number.isFinite(beforeMs) ? beforeMs : Number.POSITIVE_INFINITY, nowMs);
    const rows = await this.db.query(
      `SELECT id, scope_ref, note_key, expires_at FROM ${TABLE}`,
      [],
    );
    const scanned = Array.isArray(rows) ? rows.length : 0;
    const expiredIds = (Array.isArray(rows) ? rows : [])
      .filter((row) => Number.isFinite(row?.expires_at) && row.expires_at <= cutoff)
      .map((row) => row.id);
    if (expiredIds.length === 0) return { scanned, purged: 0 };

    const placeholders = expiredIds.map(() => '?').join(', ');
    const { affectedRows } = await this.db.execute(
      `DELETE FROM ${TABLE} WHERE id IN (${placeholders})`,
      expiredIds,
    );
    return { scanned, purged: affectedRows };
  }

  /**
   * 删除记录：按 (scope_ref, note_key) 直删，无版本条件（issue #1203）。
   * 没删到（记录不存在 / 已被惰性裁掉）返回 false，不包装成冲突错误。
   *
   * @param {string} scopeRef
   * @param {string} key
   * @returns {Promise<boolean>} 是否实际删除了记录
   */
  async delete(scopeRef, key) {
    const { affectedRows } = await this.db.execute(
      `DELETE FROM ${TABLE} WHERE scope_ref = ? AND note_key = ?`,
      [canonicalizeNotesScopeRef(scopeRef), key],
    );
    return affectedRows > 0;
  }
}

export default DbNoteRecordStore;
