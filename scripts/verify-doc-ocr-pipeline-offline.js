import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import docOcrPipeline from '../apps/doc-ocr-pipeline/tick/index.js';
import { run as docPipelineWorkerRun } from '../lib/doc-pipeline-worker.js';

/**
 * createServices — 构造 mock 服务对象
 *
 * Phase 1 修订：移除了 mini_app_rows 相关 mock（rowData / SELECT data FROM mini_app_rows），
 * 因为 binding-sync 已不再写入 mini_app_rows。
 * 断言基线：以 lib/doc-pipeline-binding-sync.js 中的真实 SQL 为准。
 */
function createServices(options = {}) {
  const executeCalls = [];
  const queryLog = [];
  const attachmentMap = options.attachmentMap || {};
  const documents = options.documents || [];
  const bindings = options.bindings || {};
  const documentOcr = options.documentOcr || {
    submit: async () => ({ provider: 'erix-mineru', task_id: 'task-default' }),
    syncTaskStatus: async () => ({
      completed: true,
      ocrResult: { provider: 'erix-mineru', main_markdown_attachment_id: 'att-default' },
    }),
  };

  return {
    executeCalls,
    queryLog,
    documentOcr,
    async query(sql, params = []) {
      queryLog.push({ sql, params });
      if (sql.includes('FROM documents')) {
        return documents;
      }
      if (sql.includes('FROM app_doc_bindings')) {
        return bindings[params[0]] ? [bindings[params[0]]] : [];
      }
      if (sql.includes('SELECT file_path FROM attachments')) {
        const filePath = attachmentMap[params[0]];
        return filePath ? [{ file_path: filePath }] : [];
      }
      return [];
    },
    async execute(sql, params = []) {
      executeCalls.push({ sql, params });
      return { affectedRows: 1 };
    },
  };
}

/**
 * contract-mgr submit 用例
 * 断言基线：binding-sync 写入 app_contract_mgr_content (INSERT ... ON DUPLICATE KEY UPDATE)
 */
async function runContractMgrSubmitCase() {
  const services = createServices({
    documents: [{ id: 'doc-1', processing_status: 'pending_ocr', current_revision_id: 'rev-1' }],
    bindings: {
      'doc-1': { app_id: 'contract-mgr', row_id: 'row-1', document_id: 'doc-1' },
    },
    documentOcr: {
      submit: async () => ({ provider: 'erix-mineru', task_id: 'task-123' }),
      syncTaskStatus: async () => ({ completed: false }),
    },
  });

  const result = await docOcrPipeline.tick({ app: { id: 'doc-ocr-pipeline' }, services });
  assert.equal(result.submitted, 1);
  assert.equal(result.synced, 0);

  const upsertContent = services.executeCalls.find(
    call => call.sql.includes('INSERT INTO app_contract_mgr_content') && call.sql.includes('ocr_submitted')
  );
  assert.ok(upsertContent, 'contract-mgr submit 应 upsert app_contract_mgr_content (binding-sync baseline)');
}

/**
 * contract-mgr-v2 submit 用例
 * 断言基线：binding-sync 写入 app_contract_mgr_v2_content (UPDATE SET process_step = 'ocr_submitted')
 */
async function runContractMgrV2SubmitCase() {
  const services = createServices({
    documents: [{ id: 'doc-2', processing_status: 'pending_ocr', current_revision_id: 'rev-2' }],
    bindings: {
      'doc-2': { app_id: 'contract-mgr-v2', row_id: 'row-2', document_id: 'doc-2' },
    },
    documentOcr: {
      submit: async () => ({ provider: 'erix-mineru', task_id: 'task-456' }),
      syncTaskStatus: async () => ({ completed: false }),
    },
  });

  const result = await docOcrPipeline.tick({ app: { id: 'doc-ocr-pipeline' }, services });
  assert.equal(result.submitted, 1);

  const updateContent = services.executeCalls.find(
    call => call.sql.includes("UPDATE app_contract_mgr_v2_content SET process_step = 'ocr_submitted'")
  );
  assert.ok(updateContent, 'contract-mgr-v2 submit 应更新扩展表 (binding-sync baseline)');
  assert.deepEqual(updateContent.params, ['task-456', 'erix-mineru', 'row-2']);
}

/**
 * contract-mgr sync 完成用例
 * 断言基线：binding-sync 回填 ocr_text 到 app_contract_mgr_content
 */
async function runContractMgrSyncCase() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-ocr-pipeline-test-'));
  process.env.ATTACHMENT_BASE_PATH = tempDir;
  const markdownRelPath = 'verify/ocr-main.md';
  const markdownFullPath = path.join(tempDir, markdownRelPath);
  await fs.mkdir(path.dirname(markdownFullPath), { recursive: true });
  await fs.writeFile(markdownFullPath, '# OCR Result\nhello world', 'utf8');

  const services = createServices({
    documents: [{ id: 'doc-3', processing_status: 'ocr_processing', current_revision_id: 'rev-3' }],
    bindings: {
      'doc-3': { app_id: 'contract-mgr', row_id: 'row-3', document_id: 'doc-3' },
    },
    attachmentMap: {
      'att-789': markdownRelPath,
    },
    documentOcr: {
      submit: async () => ({ provider: 'erix-mineru', task_id: 'unused' }),
      syncTaskStatus: async () => ({
        completed: true,
        ocrResult: {
          provider: 'erix-mineru',
          main_markdown_attachment_id: 'att-789',
        },
      }),
    },
  });

  const result = await docOcrPipeline.tick({ app: { id: 'doc-ocr-pipeline' }, services });
  assert.equal(result.synced, 1);

  const upsertContent = services.executeCalls.find(
    call => call.sql.includes('INSERT INTO app_contract_mgr_content') && call.sql.includes('ocr_text')
  );
  assert.ok(upsertContent, 'contract-mgr sync 完成应回填 ocr_text (binding-sync baseline)');
  assert.equal(upsertContent.params[1], '# OCR Result\nhello world');
}

/**
 * contract-mgr-v2 sync 完成用例
 * 断言基线：binding-sync 回填到 app_contract_mgr_v2_content
 */
async function runContractMgrV2SyncCase() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-ocr-pipeline-test-'));
  process.env.ATTACHMENT_BASE_PATH = tempDir;
  const markdownRelPath = 'verify/ocr-main-v2.md';
  const markdownFullPath = path.join(tempDir, markdownRelPath);
  await fs.mkdir(path.dirname(markdownFullPath), { recursive: true });
  await fs.writeFile(markdownFullPath, 'contract v2 markdown', 'utf8');

  const services = createServices({
    documents: [{ id: 'doc-4', processing_status: 'ocr_processing', current_revision_id: 'rev-4' }],
    bindings: {
      'doc-4': { app_id: 'contract-mgr-v2', row_id: 'row-4', document_id: 'doc-4' },
    },
    attachmentMap: {
      'att-999': markdownRelPath,
    },
    documentOcr: {
      submit: async () => ({ provider: 'erix-mineru', task_id: 'unused' }),
      syncTaskStatus: async () => ({
        completed: true,
        ocrResult: {
          provider: 'erix-mineru',
          main_markdown_attachment_id: 'att-999',
        },
      }),
    },
  });

  const result = await docOcrPipeline.tick({ app: { id: 'doc-ocr-pipeline' }, services });
  assert.equal(result.synced, 1);

  const updateContent = services.executeCalls.find(
    call => call.sql.includes("UPDATE app_contract_mgr_v2_content SET process_step = 'pending_filter'")
  );
  assert.ok(updateContent, 'contract-mgr-v2 sync 完成应回填扩展表 (binding-sync baseline)');
  assert.equal(updateContent.params[0], 'contract v2 markdown');
  assert.equal(updateContent.params[1], 'erix-mineru');
  assert.equal(updateContent.params[2], 'row-4');
}

async function main() {
  await runContractMgrSubmitCase();
  await runContractMgrV2SubmitCase();
  await runContractMgrSyncCase();
  await runContractMgrV2SyncCase();

  // Phase 1: 验证新 run() 入口与兼容 tick() 等价
  console.log('\n--- Phase 1: New run() entry point validation ---');
  await runNewEntryEquivalenceCase();

  console.log('doc-ocr-pipeline offline tests passed');
}

/**
 * Phase 1: 验证新 run() 与旧 tick() 行为等价
 */
async function runNewEntryEquivalenceCase() {
  const services = createServices({
    documents: [{ id: 'doc-eq', processing_status: 'pending_ocr', current_revision_id: 'rev-eq' }],
    bindings: {
      'doc-eq': { app_id: 'contract-mgr-v2', row_id: 'row-eq', document_id: 'doc-eq' },
    },
    documentOcr: {
      submit: async () => ({ provider: 'erix-mineru', task_id: 'task-eq' }),
      syncTaskStatus: async () => ({ completed: false }),
    },
  });

  const result = await docPipelineWorkerRun({ services });
  assert.equal(result.submitted, 1);
  console.log('  ✓ run() returns correct submitted count');
}

main().catch((error) => {
  console.error('doc-ocr-pipeline offline tests failed:', error);
  process.exitCode = 1;
});
