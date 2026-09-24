/**
 * DB Note Record Store - erix NoteRecord 的 MariaDB 存储（CAS + expires_at）
 *
 * 设计要点（issue #1132 决策 3 修订，DDL 已获批准，入 scripts/upgrade-database.js）：
 * - 表：note_record（见 docs/design/data-model.md），scope_ref + note_key 唯一键
 * - value：完整 NoteRecord JSON（LONGTEXT）+ record_version（CAS 版本，touwaka 扩展字段）
 * - CAS：INSERT（创建）或 UPDATE ... WHERE scope_ref=? AND note_key=? AND record_version=?
 *   （影响行数=0 → NotesStoreError(code: notes_cas_conflict)，不静默 LWW）
 * - expires_at（BIGINT ms）为 TTL 唯一权威，取自 record.expires_at（adapter/facade 已统一注入）；
 *   read/list 不续期（不 touch、不滑动）；read 命中过期行时惰性 DELETE；
 *   list 全量取 scope_ref 后按过期过滤并惰性删除（scope 内笔记量小，可接受）
 * - 行 id：nr_ 前缀 + Utils.newID()；record_version：Utils.newID() 随机串（VARCHAR(32)）
 * - 时间字段 created_at/updated_at 为应用侧写入的毫秒时间戳
 *
 * 数据库访问遵循项目惯例（lib/db.js）：SELECT 用 query/getOne，UPDATE/DELETE 用 execute，
 * INSERT 用 insert；db 实例可注入（测试用内存 fake，见 server/tests/helpers/fake-db.js）。
 */

import { NotesStoreError } from 'erix-agent';
import Utils from '../utils.js';
import { NOTES_TTL_SECONDS } from './notes-policy.js';

export const NOTES_CAS_CONFLICT = 'notes_cas_conflict';

const TABLE = 'note_record';

function casError(message) {
  return new NotesStoreError(message || 'notes CAS conflict', NOTES_CAS_CONFLICT);
}

function isCasConflict(error) {
  return error instanceof NotesStoreError && error.code === NOTES_CAS_CONFLICT;
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
    const row = await this.db.getOne(
      `SELECT id, record, expires_at FROM ${TABLE} WHERE scope_ref = ? AND note_key = ?`,
      [scopeRef, key],
    );
    if (!row) return undefined;
    if (this._isExpired(row, nowMs)) {
      await this.db.execute(
        `DELETE FROM ${TABLE} WHERE scope_ref = ? AND note_key = ?`,
        [scopeRef, key],
      );
      return undefined;
    }
    return parseRecord(row.record);
  }

  /**
   * CAS 写入。
   *
   * @param {string} scopeRef
   * @param {string} key
   * @param {object} record - NoteRecord（record_version / expires_at 由本方法管理）
   * @param {object} [options]
   * @param {string|number|null} [options.expectedVersion] - null/undefined 要求创建（不存在，
   *   或仅存在过期残留行时原位替换）；其他值要求与当前 record_version 一致（更新）
   * @param {number} [options.ttlSeconds] - 覆盖默认 TTL
   * @returns {Promise<object>} 实际写入的记录（含新 record_version）
   */
  async write(scopeRef, key, record, { expectedVersion = null, ttlSeconds } = {}) {
    const nowMs = this.clock();
    const expiresMs = this._expiresMs(record, ttlSeconds, nowMs);
    const nextVersion = Utils.newID(20);
    const stored = {
      ...record,
      record_version: nextVersion,
      expires_at: new Date(expiresMs).toISOString(),
    };
    const scope = typeof record?.scope === 'string' && record.scope ? record.scope : 'run';
    const create = expectedVersion === null || expectedVersion === undefined;

    if (create) {
      try {
        await this.db.insert(
          `INSERT INTO ${TABLE}
             (id, scope, scope_ref, note_key, record, record_version, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `nr_${Utils.newID(20)}`,
            scope,
            scopeRef,
            key,
            JSON.stringify(stored),
            nextVersion,
            expiresMs,
            nowMs,
            nowMs,
          ],
        );
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        // 唯一键冲突：仅当残留的是过期行时原位替换（对齐 Redis PXAT 物理过期语义）；
        // 活记录冲突 → notes_cas_conflict，不静默覆盖
        const { affectedRows } = await this.db.execute(
          `UPDATE ${TABLE}
             SET record = ?, record_version = ?, expires_at = ?, updated_at = ?
           WHERE scope_ref = ? AND note_key = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
          [JSON.stringify(stored), nextVersion, expiresMs, nowMs, scopeRef, key, nowMs],
        );
        if (!affectedRows) throw casError('notes_cas_conflict: record already exists');
      }
      return stored;
    }

    const { affectedRows } = await this.db.execute(
      `UPDATE ${TABLE}
         SET record = ?, record_version = ?, expires_at = ?, updated_at = ?
       WHERE scope_ref = ? AND note_key = ? AND record_version = ?
         AND (expires_at IS NULL OR expires_at > ?)`,
      [JSON.stringify(stored), nextVersion, expiresMs, nowMs, scopeRef, key, String(expectedVersion), nowMs],
    );
    if (!affectedRows) {
      throw casError('notes_cas_conflict: record missing or record_version mismatch');
    }
    return stored;
  }

  /**
   * 列出 scope 内全部未过期记录（不续期）；惰性删除过期残留行。
   *
   * @param {string} scopeRef
   * @returns {Promise<object[]>} NoteRecord 数组
   */
  async list(scopeRef) {
    const nowMs = this.clock();
    const rows = await this.db.query(
      `SELECT id, record, expires_at FROM ${TABLE} WHERE scope_ref = ?`,
      [scopeRef],
    );
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const records = [];
    const expiredIds = [];
    for (const row of rows) {
      if (this._isExpired(row, nowMs)) {
        expiredIds.push(row.id);
        continue;
      }
      records.push(parseRecord(row.record));
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
   * 删除记录。传入 expectedVersion 时做版本校验（CAS 删除，forget 之外的路径）；
   * note_forget 物理删除主路径不带版本。
   *
   * @param {string} scopeRef
   * @param {string} key
   * @param {object} [options]
   * @param {string|number} [options.expectedVersion] - 传入时做版本校验（CAS 删除）
   * @returns {Promise<boolean>} 是否实际删除了记录
   */
  async delete(scopeRef, key, { expectedVersion } = {}) {
    const params = [scopeRef, key];
    let sql = `DELETE FROM ${TABLE} WHERE scope_ref = ? AND note_key = ?`;
    const withVersion = expectedVersion !== undefined && expectedVersion !== null;
    if (withVersion) {
      sql += ' AND record_version = ?';
      params.push(String(expectedVersion));
    }
    const { affectedRows } = await this.db.execute(sql, params);
    if (withVersion && !affectedRows) {
      throw casError('notes_cas_conflict: record missing or record_version mismatch');
    }
    return affectedRows > 0;
  }
}

export function isNotesCasConflict(error) {
  return isCasConflict(error);
}

export default DbNoteRecordStore;
