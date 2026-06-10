import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import path from 'path';

import Database from '../lib/db.js';
import Utils from '../lib/utils.js';
import OcrToolController from '../server/controllers/ocr-tool.controller.js';
import { execute as contractBatchUpload } from '../apps/contract-mgr-v2/controllers/batch-upload.js';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const ATTACHMENT_BASE_PATH = path.resolve(process.env.ATTACHMENT_BASE_PATH || './data/attachments');

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
    source_tag: 'verify-script',
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
  if (!user?.id) {
    throw new Error('No user found in users table, cannot run fake intake verification');
  }
  return user.id;
}

async function verifyOcrToolIntake(db, userId) {
  const attachment = await createFakeAttachment(db, userId, 'verify-ocr-tool.txt', 'fake ocr tool attachment');
  const controller = new OcrToolController(db);
  const result = await controller.createDocumentPlatformTask({
    userId,
    attachmentId: attachment.id,
    prompt: 'verify prompt',
  });

  const doc = await db.getOne('SELECT id, current_revision_id, processing_status, source_system FROM documents WHERE id = ?', [result.document_id]);
  const binding = await db.getOne('SELECT app_id, row_id, document_id, binding_status FROM app_doc_bindings WHERE document_id = ? LIMIT 1', [result.document_id]);
  const row = await db.getOne('SELECT id, app_id, status FROM mini_app_rows WHERE id = ? LIMIT 1', [result.record_id]);

  return {
    task_id: result.task_id,
    document_id: result.document_id,
    revision_id: result.revision_id || null,
    record_id: result.record_id,
    document: doc,
    binding,
    row,
  };
}

async function verifyContractMgrV2Intake(db, userId) {
  const contentTable = await db.getOne(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_contract_mgr_v2_content'
  `);
  if (!contentTable?.TABLE_NAME) {
    return {
      skipped: true,
      reason: 'app_contract_mgr_v2_content table missing; install contract-mgr-v2 migration first',
    };
  }

  const attachment = await createFakeAttachment(db, userId, 'verify-contract-v2.txt', 'fake contract attachment');
  const result = await contractBatchUpload({ db }, { userId, attachmentIds: [attachment.id] });
  const record = result.records?.[0];
  if (!record?.document_id) {
    return { result, document: null, binding: null, content: null };
  }

  const document = await db.getOne('SELECT id, processing_status, source_system FROM documents WHERE id = ?', [record.document_id]);
  const binding = await db.getOne('SELECT app_id, row_id, document_id, binding_status FROM app_doc_bindings WHERE document_id = ? LIMIT 1', [record.document_id]);
  const content = await db.getOne('SELECT row_id, process_step, file_id, document_id FROM app_contract_mgr_v2_content WHERE row_id = ? LIMIT 1', [record.id]);
  const attachmentRow = await db.getOne('SELECT source_tag, source_id FROM attachments WHERE id = ? LIMIT 1', [attachment.id]);

  return {
    result,
    document,
    binding,
    content,
    attachment: attachmentRow,
  };
}

async function main() {
  const db = new Database(DB_CONFIG);
  await db.connect();

  try {
    const userId = await pickUserId(db);
    const ocrTool = await verifyOcrToolIntake(db, userId);
    const contractV2 = await verifyContractMgrV2Intake(db, userId);

    console.log('=== Fake Intake Verification ===');
    console.log(JSON.stringify({ userId, ocrTool, contractV2 }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('Fake intake verification failed:', error.message);
  process.exitCode = 1;
});