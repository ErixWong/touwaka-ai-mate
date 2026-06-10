import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

import Database from '../lib/db.js';
import Utils from '../lib/utils.js';
import { execute as contractBatchUpload } from '../apps/contract-mgr-v2/controllers/batch-upload.js';
import { tick as contractMgrV2Tick } from '../apps/contract-mgr-v2/tick/index.js';
import AppMarketService from '../server/services/app-market.service.js';

dotenv.config();

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const ATTACHMENT_BASE_PATH = path.resolve(process.env.ATTACHMENT_BASE_PATH || './data/attachments');
const TEST_TAG = 'verify-contract-v2-installed';
const APP_ID = 'contract-mgr-v2';

const REQUIRED_CONTENT_COLUMNS = [
  {
    name: 'process_step',
    definition: "ADD COLUMN process_step VARCHAR(32) NULL COMMENT '处理步骤'",
  },
  {
    name: 'file_id',
    definition: "ADD COLUMN file_id VARCHAR(32) NULL COMMENT '文件ID'",
  },
  {
    name: 'document_id',
    definition: "ADD COLUMN document_id VARCHAR(32) NULL COMMENT 'Doc平台文档ID'",
  },
  {
    name: 'ocr_task_id',
    definition: "ADD COLUMN ocr_task_id VARCHAR(128) NULL COMMENT 'OCR任务ID'",
  },
  {
    name: 'filter_carried_over',
    definition: "ADD COLUMN filter_carried_over LONGTEXT NULL COMMENT '滑窗过滤暂存尾巴'",
  },
  {
    name: 'filter_chunk_index',
    definition: "ADD COLUMN filter_chunk_index INT DEFAULT 0 COMMENT '过滤滑窗块索引'",
  },
  {
    name: 'classification_json',
    definition: "ADD COLUMN classification_json JSON NULL COMMENT '分类结果'",
  },
];

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function createFakeAttachment(db, userId, fileName, content) {
  const Attachment = db.getModel('attachment');
  const id = Utils.newID(20);
  const relativePath = path.join('verify', `${id}.txt`).replace(/\\/g, '/');
  const fullPath = path.join(ATTACHMENT_BASE_PATH, relativePath);
  await ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf8');

  return await Attachment.create({
    id,
    source_tag: TEST_TAG,
    source_id: id,
    file_name: fileName,
    ext_name: 'txt',
    mime_type: 'text/plain',
    file_size: Buffer.byteLength(content, 'utf8'),
    file_path: relativePath,
    created_by: userId,
  });
}

async function pickUserId(db) {
  const user = await db.getOne('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
  if (!user?.id) throw new Error('No user found in users table');
  return user.id;
}

async function loadInstalledState(db) {
  const miniApp = await db.getOne(
    'SELECT id, name, is_active FROM mini_apps WHERE id = ? LIMIT 1',
    [APP_ID]
  );
  const clock = await db.getOne(
    'SELECT app_id, is_active FROM app_clock_registry WHERE app_id = ? LIMIT 1',
    [APP_ID]
  );
  const states = await db.query(
    'SELECT name, handler_id, success_next_state, failure_next_state FROM app_state WHERE app_id = ? ORDER BY sort_order ASC',
    [APP_ID]
  );
  const handlers = await db.query(
    'SELECT id, name, handler FROM app_row_handlers WHERE handler LIKE ? ORDER BY name ASC',
    [`apps/${APP_ID}/handlers/%`]
  );
  const contentTable = await db.getOne(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_contract_mgr_v2_content'
  `);
  const rowsTable = await db.getOne(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_contract_mgr_v2_rows'
  `);

  return {
    miniApp,
    clock,
    states,
    handlers,
    tables: {
      app_contract_mgr_v2_content: !!contentTable?.TABLE_NAME,
      app_contract_mgr_v2_rows: !!rowsTable?.TABLE_NAME,
    },
  };
}

async function ensureRequiredContentColumns(db) {
  const rows = await db.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'app_contract_mgr_v2_content'
  `);

  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  const addedColumns = [];

  for (const column of REQUIRED_CONTENT_COLUMNS) {
    if (existing.has(column.name)) continue;
    await db.execute(`ALTER TABLE app_contract_mgr_v2_content ${column.definition}`);
    addedColumns.push(column.name);
  }

  return { addedColumns };
}

async function seedInstalledScenario(db, userId) {
  const attachment = await createFakeAttachment(db, userId, 'verify-installed-contract-v2.txt', 'fake installed contract v2 attachment');
  const intakeResult = await contractBatchUpload({ db }, { userId, attachmentIds: [attachment.id] });
  const record = intakeResult.records?.[0];
  if (!record?.id) {
    throw new Error('batch_upload did not return a contract-mgr-v2 record');
  }

  const content = await db.getOne(
    'SELECT row_id, process_step, file_id, document_id FROM app_contract_mgr_v2_content WHERE row_id = ? LIMIT 1',
    [record.id]
  );
  const binding = content?.document_id
    ? await db.getOne(
        'SELECT id, app_id, row_id, document_id, binding_status FROM app_doc_bindings WHERE app_id = ? AND row_id = ? LIMIT 1',
        [APP_ID, record.id]
      )
    : null;
  const document = content?.document_id
    ? await db.getOne(
        'SELECT id, processing_status, source_system, source_ref_id FROM documents WHERE id = ? LIMIT 1',
        [content.document_id]
      )
    : null;
  const row = await db.getOne(
    'SELECT id, app_id, status, title FROM mini_app_rows WHERE id = ? LIMIT 1',
    [record.id]
  );

  return {
    attachmentId: attachment.id,
    rowId: record.id,
    documentId: content?.document_id || null,
    bindingId: binding?.id || null,
    intakeResult,
    initial: { row, content, binding, document },
  };
}

function createInstalledServices(db) {
  return {
    getModel(modelName) {
      return db.getModel(modelName);
    },
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
    async callMcp(server, tool, params) {
      if (tool === 'submit_conversion_task') {
        return { task_id: `${TEST_TAG}-task` };
      }
      if (tool === 'get_task') {
        return {
          status: 'completed',
          result: '# OCR Result\nThis is a fake installed contract OCR markdown.',
          task_id: params?.task_id || `${TEST_TAG}-task`,
        };
      }
      throw new Error(`Unexpected MCP call: ${server}/${tool}`);
    },
    llm: {
      async extractJson(prompt, _input, options = {}) {
        const fallback = options.defaultValue ?? null;
        if (typeof prompt === 'string' && prompt.includes('提取 task_id')) {
          return { task_id: `${TEST_TAG}-task` };
        }
        if (typeof prompt === 'string' && prompt.includes('判断OCR任务是否完成')) {
          return { status: 'completed', progress: 100, reason: 'verify script forced completed' };
        }
        if (fallback !== null) {
          return fallback;
        }
        return { processed_text: 'cleaned text', carried_over: '' };
      },
    },
  };
}

async function runInstalledFlow(db) {
  const miniApp = await db.getOne('SELECT id, name, config FROM mini_apps WHERE id = ? LIMIT 1', [APP_ID]);
  if (!miniApp) {
    throw new Error('contract-mgr-v2 is not installed in mini_apps');
  }

  const services = createInstalledServices(db);
  return await contractMgrV2Tick({
    app: miniApp,
    services,
    registry: null,
  });
}

async function loadVerification(db, rowId, documentId) {
  const row = await db.getOne('SELECT id, app_id, status, title, data FROM mini_app_rows WHERE id = ? LIMIT 1', [rowId]);
  const content = await db.getOne(
    'SELECT row_id, process_step, file_id, document_id, ocr_task_id, ocr_text, ocr_service, ocr_at FROM app_contract_mgr_v2_content WHERE row_id = ? LIMIT 1',
    [rowId]
  );
  const binding = await db.getOne(
    'SELECT id, app_id, row_id, document_id, binding_status FROM app_doc_bindings WHERE app_id = ? AND row_id = ? LIMIT 1',
    [APP_ID, rowId]
  );
  const document = documentId
    ? await db.getOne('SELECT id, processing_status, source_system, source_ref_id FROM documents WHERE id = ? LIMIT 1', [documentId])
    : null;
  return { row, content, binding, document };
}

async function cleanup(db, seeded) {
  if (!seeded) return;
  if (seeded.documentId) {
    await db.execute('DELETE FROM app_doc_bindings WHERE app_id = ? AND row_id = ?', [APP_ID, seeded.rowId]).catch(() => {});
    await db.execute('DELETE FROM app_contract_mgr_v2_content WHERE row_id = ?', [seeded.rowId]).catch(() => {});
    await db.execute('DELETE FROM documents WHERE id = ?', [seeded.documentId]).catch(() => {});
  } else {
    await db.execute('DELETE FROM app_contract_mgr_v2_content WHERE row_id = ?', [seeded.rowId]).catch(() => {});
  }
  await db.execute('DELETE FROM mini_app_rows WHERE id = ?', [seeded.rowId]).catch(() => {});
  await db.execute('DELETE FROM attachments WHERE id = ?', [seeded.attachmentId]).catch(() => {});
}

async function cleanupAddedColumns(db, addedColumns = []) {
  for (const columnName of addedColumns) {
    await db.execute(`ALTER TABLE app_contract_mgr_v2_content DROP COLUMN ${columnName}`).catch(() => {});
  }
}

async function main() {
  const db = new Database(DB_CONFIG);
  await db.connect();

  let seeded = null;
  let addedColumns = [];
  try {
    const installedState = await loadInstalledState(db);
    const contentColumnState = await ensureRequiredContentColumns(db);
    addedColumns = contentColumnState.addedColumns;
    const userId = await pickUserId(db);
    seeded = await seedInstalledScenario(db, userId);
    const tickResult = await runInstalledFlow(db);
    const verification = await loadVerification(db, seeded.rowId, seeded.documentId);

    console.log(JSON.stringify({
      success: true,
      installedState,
      addedColumns,
      intake: seeded.initial,
      tickResult,
      verification,
    }, null, 2));
  } finally {
    await cleanup(db, seeded).catch(() => {});
    await cleanupAddedColumns(db, addedColumns).catch(() => {});
    await db.close();
  }
}

main().catch((error) => {
  console.error('verify-contract-v2-installed-flow failed:', error.message);
  process.exitCode = 1;
});
