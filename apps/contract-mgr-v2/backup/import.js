export async function importBackup(context, payload, options = {}) {
  const { appId, services } = context;
  const { execute, getModel } = services;
  const { tables, dryRun = false } = payload;

  if (!tables || !Array.isArray(tables)) {
    throw new Error('payload.tables must be an array');
  }

  const stats = { imported: 0, skipped: 0, errors: 0, details: [] };

  const tableOrder = [
    'contract_v2_org_nodes',
    'contract_v2_main_records',
    'contract_v2_versions',
    'app_contract_mgr_v2_rows',
    'app_contract_mgr_v2_content',
  ];

  for (const tableName of tableOrder) {
    const table = tables.find(t => t.name === tableName);
    if (!table || !table.rows || table.rows.length === 0) {
      stats.skipped += 1;
      stats.details.push({ table: tableName, status: 'skipped', reason: 'no rows' });
      continue;
    }

    if (dryRun) {
      stats.details.push({ table: tableName, status: 'dry_run', rows: table.rows.length });
      continue;
    }

    try {
      for (const row of table.rows) {
        const columns = Object.keys(row).filter(k => k !== 'created_at' && k !== 'updated_at');
        const placeholders = columns.map(() => '?').join(', ');
        const columnNames = columns.map(c => `\`${c}\``).join(', ');
        const values = columns.map(c => row[c] ?? null);

        if (tableName === 'app_contract_mgr_v2_content') {
          await execute(
            `INSERT INTO \`${tableName}\` (${columnNames}, created_at, updated_at)
             VALUES (${placeholders}, NOW(), NOW())
             ON DUPLICATE KEY UPDATE updated_at = NOW()`,
            values
          );
        } else {
          await execute(
            `INSERT IGNORE INTO \`${tableName}\` (${columnNames}, created_at, updated_at)
             VALUES (${placeholders}, NOW(), NOW())`,
            values
          );
        }
      }
      stats.imported += 1;
      stats.details.push({ table: tableName, status: 'imported', rows: table.rows.length });
    } catch (err) {
      stats.errors += 1;
      stats.details.push({ table: tableName, status: 'error', error: err.message });
    }
  }

  return {
    success: stats.errors === 0,
    stats,
  };
}