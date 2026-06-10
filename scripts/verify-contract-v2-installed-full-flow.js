import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

import Database from '../lib/db.js';
import Utils from '../lib/utils.js';
import { execute as contractBatchUpload } from '../apps/contract-mgr-v2/controllers/batch-upload.js';
import { tick as contractMgrV2Tick } from '../apps/contract-mgr-v2/tick/index.js';

dotenv.config();

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const ATTACHMENT_BASE_PATH = path.resolve(process.env.ATTACHMENT_BASE_PATH || './data/attachments');
const TEST_TAG = 'verify-contract-v2-installed-full';
const APP_ID = 'contract-mgr-v2';

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

async function ensureInstalledSkeleton(db) {
  const existing = await db.getOne(`SELECT id, config FROM mini_apps WHERE id = ? LIMIT 1`, [APP_ID]);
  if (!existing?.id) {
    throw new Error('contract-mgr-v2 is not installed in mini_apps');
  }
  const hasRowsTable = await db.getOne(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_contract_mgr_v2_rows'
  `);
  if (!hasRowsTable?.TABLE_NAME) {
    throw new Error('app_contract_mgr_v2_rows table is missing; run upgrade-database.js first');
  }

  await db.execute(
    `DELETE c, r, b, d, m
     FROM app_contract_mgr_v2_content c
     LEFT JOIN app_contract_mgr_v2_rows r ON r.row_id = c.row_id
     LEFT JOIN app_doc_bindings b ON b.app_id = ? AND b.row_id = c.row_id
     LEFT JOIN documents d ON d.id = b.document_id AND d.source_system = 'contract-mgr-v2'
     LEFT JOIN mini_app_rows m ON m.id = c.row_id
     WHERE c.row_id IN (
       SELECT row_id FROM (
         SELECT row_id FROM app_contract_mgr_v2_content WHERE row_id NOT IN (SELECT id FROM mini_app_rows)
       ) dangling
     )`,
    [APP_ID]
  ).catch(() => {});
}

async function seedScenario(db, userId) {
  const attachment = await createFakeAttachment(
    db,
    userId,
    'verify-installed-contract-v2-full.txt',
    [
      '合同编号：HT-2026-001',
      '甲方：甲方测试科技有限公司',
      '乙方：乙方样例服务有限公司',
      '合同金额：123456.78 元',
      '第一章 总则',
      '本合同用于安装态验证。',
      '第二章 服务内容',
      '乙方负责提供 OCR 平台测试服务。',
      '签订日期：2026-06-10',
    ].join('\n')
  );

  const intake = await contractBatchUpload({ db }, { userId, attachmentIds: [attachment.id] });
  const record = intake.records?.[0];
  if (!record?.id) throw new Error('batch_upload did not create a record');

  const content = await db.getOne(
    'SELECT row_id, process_step, file_id, document_id FROM app_contract_mgr_v2_content WHERE row_id = ? LIMIT 1',
    [record.id]
  );
  if (!content?.document_id) {
    throw new Error('batch_upload did not create document_id binding');
  }

  await db.execute(
    `INSERT INTO mini_app_rows (id, app_id, user_id, data, title, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), data = VALUES(data), title = VALUES(title), status = VALUES(status), updated_at = NOW()`,
    [
      record.id,
      APP_ID,
      userId,
      JSON.stringify({ _status: 'active', source: TEST_TAG }),
      record.title || 'verify-installed-contract-v2-full',
      'active',
    ]
  );

  return {
    attachmentId: attachment.id,
    rowId: record.id,
    documentId: content.document_id,
  };
}

function buildAppConfig() {
  return {
    step_resources: {
      pending_ocr: {
        type: 'mcp',
        mcp: {
          server: 'markitdown',
          tool: 'submit_conversion_task',
          params_mapping: { content: 'file.base64', filename: 'file.name' },
        },
      },
      ocr_submitted: {
        type: 'mcp',
        mcp: { server: 'markitdown', tool: 'get_task', hide_params_mapping: true },
        judge_model_id: null,
        judge_temperature: 0.1,
      },
      pending_filter: {
        type: 'internal_llm',
        model_id: null,
        temperature: 0.3,
        chunk_max_length: 50000,
      },
      pending_extract: {
        type: 'internal_llm',
        model_id: null,
        temperature: 0.3,
      },
      pending_section: {
        type: 'internal_llm',
        model_id: null,
        temperature: 0.3,
      },
    },
    prompts: {
      filter: '去除页码、水印、乱码，多余空白，保留合同正文与章节标题。',
      extract: '请从合同文本中提取合同编号、甲方、乙方、上级公司、合同金额、签订日期，返回 JSON。',
      section: '请分析合同文本章节结构，识别章节标题与层级，返回 JSON。',
    },
  };
}

function createServices(db) {
  const appConfig = buildAppConfig();

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
    async callMcp(_server, tool, params) {
      if (tool === 'submit_conversion_task') {
        return { task_id: `${TEST_TAG}-task` };
      }
      if (tool === 'get_task') {
        return {
          status: 'completed',
          result: [
            '合同编号：HT-2026-001',
            '甲方：甲方测试科技有限公司',
            '乙方：乙方样例服务有限公司',
            '合同金额：123456.78 元',
            '第一章 总则',
            '本合同用于安装态验证。',
            '第二章 服务内容',
            '乙方负责提供 OCR 平台测试服务。',
            '签订日期：2026-06-10',
          ].join('\n'),
          task_id: params?.task_id || `${TEST_TAG}-task`,
        };
      }
      throw new Error(`Unexpected MCP tool: ${tool}`);
    },
    llm: {
      async extractJson(prompt, input, options = {}) {
        const defaultValue = options.defaultValue ?? null;

        if (typeof prompt === 'string' && prompt.includes('提取 task_id')) {
          return { task_id: `${TEST_TAG}-task` };
        }
        if (typeof prompt === 'string' && prompt.includes('判断OCR任务是否完成')) {
          return { status: 'completed', progress: 100, reason: 'verify script forced completed' };
        }
        if (typeof prompt === 'string' && prompt.includes('processed_text')) {
          return { processed_text: input, carried_over: '' };
        }
        if (typeof prompt === 'string' && prompt.includes('合同编号') && typeof input === 'string') {
          return {
            contract_number: 'HT-2026-001',
            party_a: '甲方测试科技有限公司',
            party_b: '乙方样例服务有限公司',
            parent_company: '甲方测试集团',
            contract_amount: '123456.78',
            contract_date: '2026-06-10',
          };
        }
        if (typeof prompt === 'string' && prompt.includes('sections')) {
          return {
            sections: [
              { title: '第一章 总则', level: 1, index: 0, start_offset: 0, summary: '合同背景与目的' },
              { title: '第二章 服务内容', level: 1, index: 1, start_offset: 1, summary: '服务范围说明' },
            ],
          };
        }
        if (defaultValue !== null) {
          return defaultValue;
        }
        return {};
      },
    },
    async callExtension(tableName, action, payload) {
      if (action === 'read') {
        const fields = Array.isArray(payload.fields) && payload.fields.length > 0
          ? payload.fields.join(', ')
          : '*';
        return await db.getOne(`SELECT ${fields} FROM ${tableName} WHERE row_id = ? LIMIT 1`, [payload.row_id]);
      }

      if (action === 'upsert') {
        const keys = Object.keys(payload);
        const columns = keys.join(', ');
        const placeholders = keys.map(() => '?').join(', ');
        const updates = keys
          .filter((key) => key !== 'row_id')
          .map((key) => `${key} = VALUES(${key})`)
          .join(', ');
        await db.execute(
          `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`,
          keys.map((key) => payload[key])
        );
        return { success: true };
      }

      throw new Error(`Unsupported callExtension action: ${action}`);
    },
    _appConfig: appConfig,
  };
}

async function runTicks(db, rowId) {
  const services = createServices(db);
  const app = { id: APP_ID, name: '销售合同管理 v2', config: JSON.stringify(services._appConfig) };

  const snapshots = [];
  for (let i = 0; i < 6; i++) {
    const tickResult = await contractMgrV2Tick({ app, services, registry: null });
    const content = await db.getOne(
      'SELECT row_id, process_step, ocr_task_id, ocr_text, filtered_text, extract_json, sections, classification_json FROM app_contract_mgr_v2_content WHERE row_id = ? LIMIT 1',
      [rowId]
    );
    const rowMeta = await db.getOne(
      'SELECT row_id, contract_number, party_a, parent_company, contract_amount, contract_date FROM app_contract_mgr_v2_rows WHERE row_id = ? LIMIT 1',
      [rowId]
    );
    const document = await db.getOne(
      `SELECT d.id, d.processing_status
       FROM documents d
       INNER JOIN app_doc_bindings b ON b.document_id = d.id
       WHERE b.app_id = ? AND b.row_id = ? LIMIT 1`,
      [APP_ID, rowId]
    );

    snapshots.push({ tick: i + 1, tickResult, content, rowMeta, document });

    if (content?.process_step === 'pending_review') {
      break;
    }
  }

  return snapshots;
}

async function cleanup(db, seeded) {
  if (!seeded) return;
  await db.execute('DELETE FROM app_contract_mgr_v2_rows WHERE row_id = ?', [seeded.rowId]).catch(() => {});
  await db.execute('DELETE FROM app_contract_mgr_v2_content WHERE row_id = ?', [seeded.rowId]).catch(() => {});
  await db.execute('DELETE FROM app_doc_bindings WHERE app_id = ? AND row_id = ?', [APP_ID, seeded.rowId]).catch(() => {});
  await db.execute('DELETE FROM documents WHERE id = ?', [seeded.documentId]).catch(() => {});
  await db.execute('DELETE FROM mini_app_rows WHERE id = ?', [seeded.rowId]).catch(() => {});
  await db.execute('DELETE FROM attachments WHERE id = ?', [seeded.attachmentId]).catch(() => {});
}

async function main() {
  const db = new Database(DB_CONFIG);
  await db.connect();

  let seeded = null;
  try {
    await ensureInstalledSkeleton(db);
    const userId = await pickUserId(db);
    seeded = await seedScenario(db, userId);
    const snapshots = await runTicks(db, seeded.rowId);

    console.log(JSON.stringify({
      success: true,
      rowId: seeded.rowId,
      documentId: seeded.documentId,
      snapshots,
    }, null, 2));
  } finally {
    await cleanup(db, seeded).catch(() => {});
    await db.close();
  }
}

main().catch((error) => {
  console.error('verify-contract-v2-installed-full-flow failed:', error.message);
  process.exitCode = 1;
});
