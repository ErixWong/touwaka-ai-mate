import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalizeNotesScopeRef } from './notes-policy.js';

const SELECT_SCOPE_REFS = `
  SELECT id, scope_ref, note_key
  FROM note_record
`;

export function planNotesScopeRefMigration(rows) {
  if (!Array.isArray(rows)) {
    throw new TypeError('Notes scopeRef migration rows must be an array');
  }

  return rows.flatMap((row) => {
    if (typeof row?.scope_ref !== 'string') {
      throw new TypeError('note_record.scope_ref must be a string');
    }
    const new_ref = canonicalizeNotesScopeRef(row.scope_ref);
    if (new_ref === row.scope_ref) return [];
    return [{
      old_ref: row.scope_ref,
      new_ref,
      note_key: row.note_key,
      id: row.id,
    }];
  });
}

export async function hasCanonicalNotesScopeRefs(conn) {
  const [rows] = await conn.execute(SELECT_SCOPE_REFS);
  return planNotesScopeRefMigration(rows).length === 0;
}

export async function migrateNotesScopeRefs(conn, {
  dryRun = false,
  logsDir = path.resolve('logs'),
  now = () => new Date(),
  logInfo = (message) => console.info(`[INFO] ${message}`),
} = {}) {
  const transactional = !dryRun;
  if (transactional
    && (typeof conn?.beginTransaction !== 'function'
      || typeof conn?.commit !== 'function'
      || typeof conn?.rollback !== 'function')) {
    throw new TypeError('Notes scopeRef migration requires transaction support');
  }

  if (transactional) await conn.beginTransaction();
  try {
    const [rows] = await conn.execute(`${SELECT_SCOPE_REFS.trim()}${transactional ? ' FOR UPDATE' : ''}`);
    const mappings = planNotesScopeRefMigration(rows);
    const conflicts = [];
    const plannedOwners = new Map();

    for (const mapping of mappings) {
      const targetKey = JSON.stringify([mapping.new_ref, mapping.note_key]);
      const plannedOwner = plannedOwners.get(targetKey);
      if (plannedOwner !== undefined && String(plannedOwner) !== String(mapping.id)) {
        conflicts.push({ ...mapping, occupied_by: plannedOwner });
      } else {
        plannedOwners.set(targetKey, mapping.id);
      }

      const [owners] = await conn.execute(
        `SELECT id
         FROM note_record
         WHERE scope_ref = ? AND note_key = ?`,
        [mapping.new_ref, mapping.note_key],
      );
      for (const owner of owners) {
        if (String(owner.id) !== String(mapping.id)) {
          conflicts.push({ ...mapping, occupied_by: owner.id });
        }
      }
    }

    if (conflicts.length > 0) {
      throw new Error(`Notes scopeRef migration unique-key conflicts: ${JSON.stringify(conflicts)}`);
    }

    for (const mapping of mappings) {
      logInfo(`notes scopeRef migration ${dryRun ? 'preview' : 'mapping'} ${JSON.stringify(mapping)}`);
    }

    if (dryRun) {
      return { mappings, changed: 0, dryRun: true };
    }

    if (mappings.length === 0) {
      await conn.commit();
      return { mappings, changed: 0, dryRun: false };
    }

    const rollbackFile = path.join(
      logsDir,
      `notes-scope-ref-rollback-${now().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(rollbackFile, `${JSON.stringify(mappings, null, 2)}\n`, { flag: 'wx' });

    for (const mapping of mappings) {
      const [result] = await conn.execute(
        `UPDATE note_record
         SET scope_ref = ?, record = JSON_SET(record, '$.scopeRef', ?)
         WHERE scope_ref = ? AND note_key = ? AND id = ?`,
        [mapping.new_ref, mapping.new_ref, mapping.old_ref, mapping.note_key, mapping.id],
      );
      if (result.affectedRows !== 1) {
        throw new Error(`Notes scopeRef migration expected one row for id ${mapping.id}`);
      }
    }

    await conn.commit();
    logInfo(`notes scopeRef migration rollback mapping saved to ${rollbackFile}`);
    return { mappings, changed: mappings.length, dryRun: false, rollbackFile };
  } catch (error) {
    if (transactional) await conn.rollback();
    throw error;
  }
}
