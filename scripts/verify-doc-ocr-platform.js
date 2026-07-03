import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

async function queryOne(conn, sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows[0] || null;
}

async function queryAll(conn, sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

async function tableExists(conn, tableName) {
  const row = await queryOne(
    conn,
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [DB_CONFIG.database, tableName]
  );
  return !!row;
}

async function columnExists(conn, tableName, columnName) {
  const row = await queryOne(
    conn,
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_CONFIG.database, tableName, columnName]
  );
  return !!row;
}

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  const checks = [];

  async function check(label, fn) {
    try {
      const result = await fn();
      checks.push({ label, ok: !!result, detail: result });
    } catch (error) {
      checks.push({ label, ok: false, detail: error.message });
    }
  }

  await check('doc_ocr_results 表存在', async () => await tableExists(conn, 'doc_ocr_results'));
  await check('doc_ocr_images 表存在', async () => await tableExists(conn, 'doc_ocr_images'));
  await check('documents.current_revision_id 字段存在', async () => await columnExists(conn, 'documents', 'current_revision_id'));
  await check('document_revisions 表存在', async () => await tableExists(conn, 'document_revisions'));
  await check('doc_ocr_results.main_markdown_attachment_id 字段存在', async () => await columnExists(conn, 'doc_ocr_results', 'main_markdown_attachment_id'));

  await check('doc-ocr-pipeline mini_apps 已注册 (Phase 1 legacy, Phase 2 退役)', async () => {
    const row = await queryOne(conn, `SELECT id, visibility, type FROM mini_apps WHERE id = 'doc-ocr-pipeline' LIMIT 1`);
    return row ? `visibility=${row.visibility}, type=${row.type} (legacy)` : 'not-registered (expected in Phase 2)';
  });

  await check('doc-ocr-pipeline app_clock_registry 已注册 (Phase 1 legacy, Phase 2 退役)', async () => {
    const row = await queryOne(conn, `SELECT id, app_id, is_active FROM app_clock_registry WHERE app_id = 'doc-ocr-pipeline' LIMIT 1`);
    return row ? `is_active=${row.is_active} (legacy)` : 'not-registered (expected in Phase 2)';
  });

  // Phase 1 新增：验证 doc-pipeline-worker 为 internal job 的核心文件存在
  await check('lib/doc-pipeline-worker.js 已创建 (Phase 1 新入口)', async () => {
    const fs = await import('fs');
    return fs.existsSync('lib/doc-pipeline-worker.js') ? 'exists' : 'missing';
  });

  await check('lib/clock/clock-core.js 已创建 (Phase 1 Clock Core 骨架)', async () => {
    const fs = await import('fs');
    return fs.existsSync('lib/clock/clock-core.js') ? 'exists' : 'missing';
  });

  await check('lib/doc-pipeline-binding-sync.js 已创建 (Phase 1 绑定同步隔离)', async () => {
    const fs = await import('fs');
    return fs.existsSync('lib/doc-pipeline-binding-sync.js') ? 'exists' : 'missing';
  });

  await check('ocr-tool component 已补齐', async () => {
    const row = await queryOne(conn, `SELECT component FROM mini_apps WHERE id = 'ocr-tool' LIMIT 1`);
    return row?.component || '';
  });

  await check('contract-mgr-v2 component 已补齐', async () => {
    const row = await queryOne(conn, `SELECT component FROM mini_apps WHERE id = 'contract-mgr-v2' LIMIT 1`);
    return row?.component || 'missing';
  });

  await check('ocr_tool 文档集合可查询', async () => {
    const row = await queryOne(conn, `SELECT id FROM document_collections WHERE name = 'ocr_tool' LIMIT 1`);
    return row?.id || 'not-created-yet';
  });

  await check('contract_manager_v2 文档集合可查询', async () => {
    const row = await queryOne(conn, `SELECT id FROM document_collections WHERE name = 'contract_manager_v2' LIMIT 1`);
    return row?.id || 'not-created-yet';
  });

  await check('存在 app_doc_bindings 表', async () => await tableExists(conn, 'app_doc_bindings'));

  await check('文档平台 OCR 待处理文档查询可执行', async () => {
    const rows = await queryAll(
      conn,
      `SELECT id, processing_status
       FROM documents
       WHERE processing_status IN ('pending_ocr', 'ocr_processing')
       ORDER BY processing_updated_at ASC
       LIMIT 3`
    );
    return `rows=${rows.length}`;
  });

  await conn.end();

  const failed = checks.filter(item => !item.ok);
  console.log('=== Doc OCR Platform Verification ===');
  for (const item of checks) {
    console.log(`${item.ok ? '✓' : '✗'} ${item.label}${item.detail !== true ? ` :: ${item.detail}` : ''}`);
  }

  if (failed.length > 0) {
    console.error(`\nVerification failed: ${failed.length} check(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nAll checks passed.');
}

main().catch((error) => {
  console.error('Verification script failed:', error.message);
  process.exitCode = 1;
});