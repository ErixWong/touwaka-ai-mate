/**
 * Fake Database（测试专用）- DbNoteRecordStore 的内存 db 模拟。
 *
 * 实现 lib/db.js Database 的 duck-type 子集：query()/getOne()/insert()/execute()。
 * 行为对齐 MariaDB 语义：
 * - insert 命中 (scope_ref, note_key) 唯一键时抛 ER_DUP_ENTRY
 * - execute 返回 { affectedRows }（UPDATE / DELETE 均按匹配行数计）
 * - SELECT 不关心列裁剪，返回完整行对象
 *
 * 注意：本 fake 按 DbNoteRecordStore 发出的 SQL 形态与参数位置解析，
 * 与该 store 的实现绑定（SQL 结构变更时需同步更新本文件）。
 */

export function createFakeDb() {
  /** @type {Map<string, object>} `${scope_ref}|${note_key}` -> row */
  const rows = new Map();

  const keyOf = (scopeRef, noteKey) => `${scopeRef}|${noteKey}`;

  function snapshot(row) {
    return { ...row };
  }

  const fake = {
    rows,

    async getOne(sql, params = []) {
      const result = await fake.query(sql, params);
      return result[0] || null;
    },

    async query(sql, params = []) {
      const text = String(sql);
      if (!/SELECT/i.test(text) || !/FROM\s+note_record/i.test(text)) {
        throw new Error(`fake-db: unsupported query: ${text}`);
      }
      if (/AND\s+note_key\s*=\s*\?/i.test(text)) {
        const row = rows.get(keyOf(params[0], params[1]));
        return row ? [snapshot(row)] : [];
      }
      // scope_ref 全量列表
      return [...rows.values()]
        .filter(row => row.scope_ref === params[0])
        .map(snapshot);
    },

    async insert(sql, params = []) {
      const text = String(sql);
      if (!/INSERT\s+INTO\s+note_record/i.test(text)) {
        throw new Error(`fake-db: unsupported insert: ${text}`);
      }
      const [id, scope, scopeRef, noteKey, record, recordVersion, expiresAt, createdAt, updatedAt] = params;
      const key = keyOf(scopeRef, noteKey);
      if (rows.has(key)) {
        const error = new Error(`Duplicate entry for key 'uk_scope_ref_key'`);
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      rows.set(key, {
        id,
        scope,
        scope_ref: scopeRef,
        note_key: noteKey,
        record,
        record_version: recordVersion,
        expires_at: expiresAt,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { insertId: id, affectedRows: 1 };
    },

    async execute(sql, params = []) {
      const text = String(sql);
      if (/^UPDATE/i.test(text)) {
        return executeUpdate(text, params);
      }
      if (/^DELETE/i.test(text)) {
        return executeDelete(text, params);
      }
      throw new Error(`fake-db: unsupported execute: ${text}`);
    },
  };

  function executeUpdate(text, params) {
    if (/AND\s+record_version\s*=\s*\?/i.test(text)) {
      // CAS 更新：SET record=?, record_version=?, expires_at=?, updated_at=?
      //           WHERE scope_ref=? AND note_key=? AND record_version=? AND (过期守卫)
      const [record, recordVersion, expiresAt, updatedAt, scopeRef, noteKey, expectedVersion, nowMs] = params;
      const row = rows.get(keyOf(scopeRef, noteKey));
      if (!row) return { affectedRows: 0, changedRows: 0 };
      const live = row.expires_at === null || row.expires_at === undefined || row.expires_at > nowMs;
      if (!live || String(row.record_version) !== String(expectedVersion)) {
        return { affectedRows: 0, changedRows: 0 };
      }
      rows.set(keyOf(scopeRef, noteKey), {
        ...row, record, record_version: recordVersion, expires_at: expiresAt, updated_at: updatedAt,
      });
      return { affectedRows: 1, changedRows: 1 };
    }
    // 过期残留原位替换（创建路径唯一键冲突后）：
    // WHERE scope_ref=? AND note_key=? AND expires_at IS NOT NULL AND expires_at <= ?
    const [record, recordVersion, expiresAt, updatedAt, scopeRef, noteKey, nowMs] = params;
    const row = rows.get(keyOf(scopeRef, noteKey));
    if (!row) return { affectedRows: 0, changedRows: 0 };
    const expired = Number.isFinite(row.expires_at) && row.expires_at <= nowMs;
    if (!expired) return { affectedRows: 0, changedRows: 0 };
    rows.set(keyOf(scopeRef, noteKey), {
      ...row, record, record_version: recordVersion, expires_at: expiresAt, updated_at: updatedAt,
    });
    return { affectedRows: 1, changedRows: 1 };
  }

  function executeDelete(text, params) {
    if (/AND\s+record_version\s*=\s*\?/i.test(text)) {
      // CAS 删除：WHERE scope_ref=? AND note_key=? AND record_version=?
      const [scopeRef, noteKey, expectedVersion] = params;
      const row = rows.get(keyOf(scopeRef, noteKey));
      if (!row || String(row.record_version) !== String(expectedVersion)) {
        return { affectedRows: 0, changedRows: 0 };
      }
      rows.delete(keyOf(scopeRef, noteKey));
      return { affectedRows: 1, changedRows: 1 };
    }
    if (/WHERE\s+id\s+IN/i.test(text)) {
      // 惰性清理（list）：WHERE id IN (...)
      const ids = new Set(params.map(String));
      let affected = 0;
      for (const [key, row] of rows) {
        if (ids.has(String(row.id))) {
          rows.delete(key);
          affected += 1;
        }
      }
      return { affectedRows: affected, changedRows: affected };
    }
    // 按 key 删除（read 惰性过期 / forget 主路径）：WHERE scope_ref=? AND note_key=?
    const [scopeRef, noteKey] = params;
    const existed = rows.delete(keyOf(scopeRef, noteKey));
    return { affectedRows: existed ? 1 : 0, changedRows: existed ? 1 : 0 };
  }

  return fake;
}

export default createFakeDb;
