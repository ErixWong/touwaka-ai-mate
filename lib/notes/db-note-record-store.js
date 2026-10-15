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
 * - 清理侧一律复核过期条件（issue #1205）：三处清理 DELETE 都带与 _isExpired 等价的
 *   谓词（expires_at IS NOT NULL AND expires_at <= ?）并沿用同一次调用的 nowMs，
 *   避开「SELECT 看到过期 → 并发 write() 原位写活 → 无条件 DELETE 误删活行」的竞态
 * - purge 分批（#1205）：不再整表 SELECT 进内存，按主键 id keyset 分页拉候选 + 按批 DELETE，
 *   批大小可注入（构造 purgeBatchSize / purge({ batchSize })，默认 500）；
 *   本方法的 scanned 是**行次**（宿主自有口径，测试按行次钉着）；erix 端口要的是 scope 数，
 *   换算在 adapter 层，宿主只在 purge({ withScopeCount: true }) 时附加回报 scope_count（#1210）
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
 * purge 单批行数默认值（issue #1205）。
 *
 * 理由：note_record.record 是 LONGTEXT，清扫只在存储层看 expires_at 列（不解析 JSON），
 * 500 行候选 ≈ 500 个 VARCHAR(32) id（≈ 16KB IN 列表），单次 DELETE 的行锁数量与语句
 * 体积都在安全区；同时 500 行一批已经把「整表进内存」的峰值内存压成常数，对典型
 * scope 体量（十到百行）一次就能扫完，不会多出额外的往返。
 */
const PURGE_BATCH_SIZE = 500;

/** 批大小上限：再大就只是把 IN 列表和行锁变肥，没有吞吐收益（#1205）。 */
const PURGE_BATCH_SIZE_MAX = 5000;

/** 批大小归一：非法值（非正整数 / 非 safe integer）回到默认，上限钳到 PURGE_BATCH_SIZE_MAX。 */
function normalizeBatchSize(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) return PURGE_BATCH_SIZE;
  return Math.min(n, PURGE_BATCH_SIZE_MAX);
}

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
   * @param {number} [options.purgeBatchSize] - purge 单批行数（#1205），默认 PURGE_BATCH_SIZE=500，
   *   非法值回退默认；测试可注入小批以验证分批循环
   */
  constructor({
    db,
    clock = () => Date.now(),
    ttlSeconds = NOTES_TTL_SECONDS,
    purgeBatchSize = PURGE_BATCH_SIZE,
  }) {
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
    this.purgeBatchSize = normalizeBatchSize(purgeBatchSize);
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
      // 惰性清理必须复核过期条件（issue #1205）：SELECT 与 DELETE 之间，另一个 writer 完全
      // 可能把这条过期残留行原位写活（write() 撞唯一键后的原位替换路径），按 key 直删会
      // 静默删掉刚被写活的记录。谓词与 _isExpired 严格等价：expires_at IS NOT NULL 保住
      // 「NULL = 永不过期」，边界沿用 <=；时间沿用本次调用的 nowMs，不重新取时钟。
      await this.db.execute(
        `DELETE FROM ${TABLE}
          WHERE scope_ref = ? AND note_key = ?
            AND expires_at IS NOT NULL AND expires_at <= ?`,
        [storageScopeRef, key, nowMs],
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
      // id 是 SELECT 快照，快照与删除之间行可能被并发 write() 原位写活（#1205）：
      // 按快照 id 删之前用同一 nowMs 复核过期条件，谓词与 _isExpired 等价。
      const placeholders = expiredIds.map(() => '?').join(', ');
      await this.db.execute(
        `DELETE FROM ${TABLE}
          WHERE id IN (${placeholders})
            AND expires_at IS NOT NULL AND expires_at <= ?`,
        [...expiredIds, nowMs],
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
   * 分批（issue #1205）：不再 `SELECT ... FROM note_record` 整表拉进内存，而是按主键 id
   * keyset 分页拉候选（LIMIT 批大小）+ 每批一次 DELETE；cutoff 在整次调用里只用一次
   * clock() 的结果，每批 DELETE 都重新复核过期谓词（快照与删除之间被并发改活的行删不掉）。
   *
   * scope 口径回报（issue #1210）：erix NotesStore 端口的 purge 把 `scanned` 定成
   * 「扫描的 scope 数」，而本 store 的 `scanned` 自 #1205 起就是**行次**（宿主自有公共 API，
   * 既有测试按行次钉着）。两者不同口径不能互相替代，因此这里开一个**只读附加回报**：
   * 传 `withScopeCount: true` 时，在同一次清扫里顺手统计扫到的 distinct `scope_ref` 个数，
   * 以 snake_case 字段 `scope_count` 一并返回；不传时返回形状逐字不变（`{scanned, purged}`）。
   * 口径换算（取 scope_count 还是取 scanned）归调用方（端口层）决定，本方法不预测消费者。
   *
   * @param {object} [options]
   * @param {number} [options.beforeMs] - 已解析的 before（ms）；adapter 已拦住不可解析值
   * @param {number} [options.batchSize] - 本次调用的批大小（默认构造注入的 purgeBatchSize）
   * @param {boolean} [options.withScopeCount] - 为 true 时额外回报 `scope_count`
   *   （本次清扫扫到的 distinct scope_ref 个数，与 `scanned` 的行次口径并存；
   *   只统计进入候选的行，`expires_at IS NULL` 的行不进入候选也不计 scope）
   * @returns {Promise<{scanned: number, purged: number, scope_count?: number}>} 扫到多少行 / 实际删了多少行
   *   （scanned = 扫过的带 TTL 候选行次，跨批累加；expires_at IS NULL 的行不进入候选，
   *   旧实现会把它们算进 scanned 但也从不删，两者在「删了多少」上语义一致）
   */
  async purge({ beforeMs, batchSize, withScopeCount = false } = {}) {
    const nowMs = this.clock();
    const cutoff = Math.min(Number.isFinite(beforeMs) ? beforeMs : Number.POSITIVE_INFINITY, nowMs);
    const size = normalizeBatchSize(batchSize === undefined ? this.purgeBatchSize : batchSize);

    let scanned = 0;
    let purged = 0;
    // scope 回报只在被要求时才开（不要求就不多占一个 Set 的内存，#1205 的内存形状不变）
    const scopeRefs = withScopeCount ? new Set() : null;
    // id 全部是 `nr_` 前缀的非空串（DDL PRIMARY KEY (id) VARCHAR(32)），'' 比任何 id 都小
    let cursor = '';
    for (;;) {
      // 候选拉取：只捞带 TTL 的行（NULL = 永不过期，根本不进候选），按主键 keyset 向后翻页。
      // 游标只靠「本批最大 id」推进，与本批删没删、删多少行无关 ⇒ 候选集单调变小。
      // scope_ref 只在要回报 scope_count 时才多选一列（不要求时 SQL 与 #1205 逐字相同）。
      const columns = scopeRefs ? 'id, scope_ref, expires_at' : 'id, expires_at';
      const rows = await this.db.query(
        `SELECT ${columns} FROM ${TABLE}
          WHERE expires_at IS NOT NULL AND id > ?
          ORDER BY id ASC
          LIMIT ?`,
        [cursor, size],
      );
      const batch = Array.isArray(rows) ? rows : [];
      if (batch.length === 0) break; // 出口一：无候选（首次就是空表 / 已扫到尾）
      scanned += batch.length;
      if (scopeRefs) {
        for (const row of batch) scopeRefs.add(String(row?.scope_ref ?? ''));
      }

      const expiredIds = batch
        .filter((row) => Number.isFinite(row?.expires_at) && row.expires_at <= cutoff)
        .map((row) => row.id);
      if (expiredIds.length > 0) {
        // id 来自本批快照：删除时复核过期条件（与 _isExpired 等价：NULL 不删、边界 <=），
        // 绑整次 purge 共用的 cutoff，不重新取时钟；并发改活的行本批就删不动。
        const placeholders = expiredIds.map(() => '?').join(', ');
        const { affectedRows } = await this.db.execute(
          `DELETE FROM ${TABLE}
            WHERE id IN (${placeholders})
              AND expires_at IS NOT NULL AND expires_at <= ?`,
          [...expiredIds, cutoff],
        );
        purged += affectedRows || 0;
      }

      const nextCursor = String(batch[batch.length - 1].id);
      if (batch.length < size) break; // 出口二：尾批（库里已无更多候选）
      if (!(nextCursor > cursor)) break; // 出口三：游标未推进（防异常 db 导致死循环）
      cursor = nextCursor;
    }

    return scopeRefs ? { scanned, purged, scope_count: scopeRefs.size } : { scanned, purged };
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
    // 这是调用方的显式删除（note_forget / facade 主路径），不是「发现过期才清理」的清理
    // 路径，因此故意不带过期谓词（#1205：清理侧才需要复核 expires_at，这里必须能删掉活行）。
    const { affectedRows } = await this.db.execute(
      `DELETE FROM ${TABLE} WHERE scope_ref = ? AND note_key = ?`,
      [canonicalizeNotesScopeRef(scopeRef), key],
    );
    return affectedRows > 0;
  }
}

export default DbNoteRecordStore;
