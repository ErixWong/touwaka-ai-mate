import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

import Database from '../lib/db.js';
import Utils from '../lib/utils.js';
import { run as docPipelineWorkerRun } from '../lib/doc-pipeline-worker.js';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const ATTACHMENT_BASE_PATH = path.resolve(process.env.ATTACHMENT_BASE_PATH || './data/attachments');
const TEST_TAG = 'verify-contract-v2-bridge';

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function ensureRequiredTables(db) {
  const required = [
    'documents',
    'document_revisions',
    'attachments',
    'app_doc_bindings',
    'mini_app_rows',
    'doc_ocr_results',
  ];

  const rows = await db.query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN (${required.map(() => '?').join(', ')})
  `, required);

  const existing = new Set(rows.map(item => item.TABLE_NAME));
  const missing = required.filter(name => !existing.has(name));
  return { missing, ok: missing.length === 0 };
}

async function hasContractV2ContentTable(db) {
  const row = await db.getOne(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'app_contract_mgr_v2_content'
  `);
  return !!row?.TABLE_NAME;
}

async function ensureTempContractV2ContentTable(db) {
  const existed = await hasContractV2ContentTable(db);
  if (existed) {
    return { created: false };
  }

  await db.execute(`
    CREATE TABLE app_contract_mgr_v2_content (
      row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
      process_step VARCHAR(32) NULL COMMENT '处理步骤',
      file_id VARCHAR(32) NULL COMMENT '文件ID',
      document_id VARCHAR(32) NULL COMMENT 'Doc平台文档ID',
      ocr_task_id VARCHAR(128) NULL COMMENT 'OCR任务ID',
      ocr_text LONGTEXT NULL COMMENT 'OCR 原文',
      ocr_service VARCHAR(64) NULL COMMENT 'OCR 服务名称',
      ocr_at DATETIME NULL COMMENT 'OCR 时间',
      filtered_text LONGTEXT NULL COMMENT '过滤后文本',
      filter_at DATETIME NULL COMMENT '过滤时间',
      sections JSON NULL COMMENT '章节结构',
      extract_prompt TEXT NULL COMMENT '提取提示词',
      extract_json LONGTEXT NULL COMMENT '提取JSON',
      extract_model VARCHAR(64) NULL COMMENT '提取模型',
      extract_temperature DECIMAL(3,2) NULL COMMENT '提取温度',
      extract_at DATETIME NULL COMMENT '提取时间',
      classification_json JSON NULL COMMENT '分类结果',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='verify 临时 contract-v2 内容表'
  `);

  return { created: true };
}

async function pickUserId(db) {
  const user = await db.getOne('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
  if (!user?.id) throw new Error('No user found in users table');
  return user.id;
}

async function pickCollectionId(db) {
  const row = await db.getOne('SELECT id FROM document_collections ORDER BY created_at ASC LIMIT 1');
  if (!row?.id) throw new Error('No document collection found in document_collections table');
  return row.id;
}

async function ensureMiniAppRecord(db, userId) {
  const existing = await db.getOne(`SELECT id, name FROM mini_apps WHERE id = 'contract-mgr-v2' LIMIT 1`);
  if (existing?.id) return { created: false, id: existing.id };

  await db.execute(
    `INSERT INTO mini_apps
      (id, name, description, icon, type, component, fields, views, config, visibility, owner_id, creator_id, sort_order, is_active, revision, created_at, updated_at)
     VALUES
      ('contract-mgr-v2', '销售合同管理 v2 [verify]', 'verify only', '📋', 'document', 'ContractV2View', '[]', '{}', '{}', 'owner', ?, ?, 0, 1, 1, NOW(), NOW())`,
    [userId, userId]
  );

  return { created: true, id: 'contract-mgr-v2' };
}

async function createFakeAttachment(db, userId, fileName, content) {
  const Attachment = db.getModel('attachment');
  const id = Utils.newID(20);
  const relativePath = path.join('verify', `${id}.md`).replace(/\\/g, '/');
  const fullPath = path.join(ATTACHMENT_BASE_PATH, relativePath);
  await ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf8');

  return await Attachment.create({
    id,
    source_tag: TEST_TAG,
    source_id: id,
    file_name: fileName,
    ext_name: 'md',
    mime_type: 'text/markdown',
    file_size: Buffer.byteLength(content, 'utf8'),
    file_path: relativePath,
    created_by: userId,
  });
}

async function seedBridgeScenario(db, userId, collectionId) {
  const ids = {
    rowId: Utils.newID(20),
    documentId: Utils.newID(20),
    revisionId: Utils.newID(20),
    bindingId: Utils.newID(20),
    ocrResultId: Utils.newID(32),
  };

  const markdownAttachment = await createFakeAttachment(db, userId, 'verify-contract-v2-output.md', '# OCR Result\nThis is a fake contract OCR markdown.');

  await db.execute(
    `INSERT INTO mini_app_rows (id, app_id, user_id, data, title, version, revision, created_at, updated_at, status)
     VALUES (?, 'contract-mgr-v2', ?, '{}', ?, 1, 1, NOW(), NOW(), 'ocr_processing')`,
    [ids.rowId, userId, `${TEST_TAG}-${ids.rowId}`]
  );

  await db.execute(
    `INSERT INTO documents (id, collection_id, current_revision_id, doc_type, source_system, source_ref_id, title, processing_status, processing_updated_at, created_at, updated_at)
     VALUES (?, ?, NULL, 'contract', 'contract-mgr-v2', ?, ?, 'ocr_processing', NOW(), NOW(), NOW())`,
    [ids.documentId, collectionId, ids.rowId, `${TEST_TAG}-${ids.rowId}`]
  );

  await db.execute(
    `INSERT INTO document_revisions (id, document_id, revision_no, revision_label, revision_status, is_current, created_by, change_summary, created_at, updated_at)
     VALUES (?, ?, 1, 'v1', 'draft', 1, ?, 'verify bridge scenario', NOW(), NOW())`,
    [ids.revisionId, ids.documentId, userId]
  );

  await db.execute(
    `UPDATE documents SET current_revision_id = ? WHERE id = ?`,
    [ids.revisionId, ids.documentId]
  );

  await db.execute(
    `INSERT INTO app_doc_bindings (id, app_id, row_id, document_id, binding_status, created_at, updated_at)
     VALUES (?, 'contract-mgr-v2', ?, ?, 'active', NOW(), NOW())`,
    [ids.bindingId, ids.rowId, ids.documentId]
  );

  await db.execute(
    `INSERT INTO app_contract_mgr_v2_content (row_id, process_step, file_id, document_id, created_at, updated_at)
     VALUES (?, 'ocr_submitted', ?, ?, NOW(), NOW())`,
    [ids.rowId, markdownAttachment.id, ids.documentId]
  );

  await db.execute(
    `INSERT INTO doc_ocr_results
      (id, document_id, revision_id, provider, task_id, status, progress, main_markdown_attachment_id, image_count, line_count, started_at, completed_at, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'erix-mineru', ?, 'completed', 100, ?, 0, 2, NOW(), NOW(), '{}', NOW(), NOW())`,
    [ids.ocrResultId, ids.documentId, ids.revisionId, `${TEST_TAG}-task`, markdownAttachment.id]
  );

  return { ids, markdownAttachment };
}

function createServices(db) {
  return {
    async query(sql, replacements = []) {
      const normalized = (sql || '').trim().toUpperCase();
      if (normalized.startsWith('SELECT')) {
        return await db.query(sql, replacements);
      }
      return await db.execute(sql, replacements);
    },
    async execute(sql, replacements = []) {
      return await db.execute(sql, replacements);
    },
    documentOcr: {
      async submit() {
        throw new Error('submit should not be called in completed-sync verify scenario');
      },
      async syncTaskStatus(documentId) {
        const ocrResult = await db.getOne(
          `SELECT id, provider, task_id, status, progress, main_markdown_attachment_id
           FROM doc_ocr_results
           WHERE document_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [documentId]
        );
        return {
          completed: true,
          statusResult: { status: 'completed', progress: 100 },
          ocrResult,
        };
      },
    },
  };
}

async function loadResult(db, rowId) {
  const row = await db.getOne('SELECT id, app_id, status, data FROM mini_app_rows WHERE id = ? LIMIT 1', [rowId]);
  const content = await db.getOne(
    'SELECT row_id, process_step, ocr_text, ocr_service, ocr_at, document_id FROM app_contract_mgr_v2_content WHERE row_id = ? LIMIT 1',
    [rowId]
  );
  const document = await db.getOne('SELECT id, processing_status FROM documents WHERE source_ref_id = ? LIMIT 1', [rowId]);
  return { row, content, document };
}

async function cleanup(db, ids, createdMiniApp, createdTempContentTable) {
  await db.execute('DELETE FROM doc_ocr_results WHERE id = ?', [ids.ocrResultId]);
  await db.execute('DELETE FROM app_contract_mgr_v2_content WHERE row_id = ?', [ids.rowId]);
  await db.execute('DELETE FROM app_doc_bindings WHERE id = ?', [ids.bindingId]);
  await db.execute('UPDATE documents SET current_revision_id = NULL WHERE id = ?', [ids.documentId]);
  await db.execute('DELETE FROM document_revisions WHERE id = ?', [ids.revisionId]);
  await db.execute('DELETE FROM documents WHERE id = ?', [ids.documentId]);
  await db.execute('DELETE FROM mini_app_rows WHERE id = ?', [ids.rowId]);
  await db.execute(`DELETE FROM attachments WHERE source_tag = ? AND source_id IN (?, ?)`, [TEST_TAG, ids.rowId, ids.rowId]);
  if (createdMiniApp) {
    await db.execute(`DELETE FROM mini_apps WHERE id = 'contract-mgr-v2'`);
  }
  if (createdTempContentTable) {
    await db.execute('DROP TABLE IF EXISTS app_contract_mgr_v2_content');
  }
}

async function main() {
  const db = new Database(DB_CONFIG);
  await db.connect();

  let seeded = null;
  let createdMiniApp = false;
  let createdTempContentTable = false;

  try {
    const tableCheck = await ensureRequiredTables(db);
    if (!tableCheck.ok) {
      console.log(JSON.stringify({
        skipped: true,
        reason: 'missing_required_tables',
        missingTables: tableCheck.missing,
      }, null, 2));
      return;
    }

    const userId = await pickUserId(db);
    const collectionId = await pickCollectionId(db);
  const tempTableState = await ensureTempContractV2ContentTable(db);
  createdTempContentTable = tempTableState.created;
    const miniAppState = await ensureMiniAppRecord(db, userId);
    createdMiniApp = miniAppState.created;

    seeded = await seedBridgeScenario(db, userId, collectionId);

    const services = createServices(db);
    const result = await docPipelineWorkerRun({ services });

    const verification = await loadResult(db, seeded.ids.rowId);

    console.log(JSON.stringify({
      success: true,
      entrypoint: 'docPipelineWorkerRun',
      pipelineResult: result,
      verification,
      tempContentTableCreated: createdTempContentTable,
    }, null, 2));
  } finally {
    if (seeded?.ids) {
      await cleanup(db, seeded.ids, createdMiniApp, createdTempContentTable).catch(() => {});
    }
    await db.close();
  }
}

main().catch((error) => {
  console.error('verify-contract-v2-platform-bridge failed:', error.message);
  process.exitCode = 1;
});
