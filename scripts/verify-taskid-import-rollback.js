/**
 * 文档平台 — taskid 版本级导入失败回滚验证脚本
 *
 * 用途：验证 `DocumentOcrService.importGatewayTaskAsRevision` 在产物导入失败时，
 *       回滚是否完整恢复导入前状态（P2-2 审计修复验收）。
 *
 * 验证项（round02-audit 放行条件）：
 *   1. 文档主源 current_revision_id 恢复为导入前原版本；
 *   2. 原版本 revision_status='effective'、is_current=1（两态语义，createIntakeRevision 曾将其降为 draft）；
 *   3. 失败版本 revision_status='draft'、is_current=0；
 *   4. 文档 metadata 恢复为导入前原始值（原 attachments 元数据不丢失）；
 *   5. processing_status='error'、processing_error_code='gateway_import_failed'。
 *
 * 运行方式：node scripts/verify-taskid-import-rollback.js
 * 依赖：本地 MySQL（.env 的 DB_* 配置）可用；脚本自带测试数据创建与清理，可重复执行。
 */

import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config();

import Database from '../lib/db.js';
import Utils from '../lib/utils.js';
import DocumentOcrService from '../lib/document-ocr-service.js';

async function main() {
  const db = new Database({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5,
  });
  await db.connect();

  const Document = db.getModel('document');
  const DocumentRevision = db.getModel('document_revision');
  const DocumentCollection = db.getModel('document_collection');

  const taskId = `rollback-verify-${Date.now()}`;
  const collectionId = Utils.newID();
  const documentId = Utils.newID();
  const previousRevisionId = Utils.newID();
  const originalMetadata = JSON.stringify({
    app_id: 'contract',
    schema_id: null,
    attachments: [{ id: 'att-rollback-1', filename: 'original.pdf' }],
  });

  try {
    // ---- 准备测试数据：collection + document（带原始 metadata）+ 初始 effective 版本 ----
    await DocumentCollection.create({
      id: collectionId,
      name: 'rollback-verify-collection',
      description: 'temporary test collection (auto-cleanup)',
      owner_id: 'system',
      created_by: 'system',
      department_id: 'D0001',
      visibility: 'private',
      embedding_model_id: 'model-test',
    });
    // 注意顺序：document_revisions.document_id 外键引用 documents.id，必须先建 document 再建 revision
    await Document.create({
      id: documentId,
      collection_id: collectionId,
      doc_type: 'knowledge',
      source_system: 'verify-rollback',
      source_ref_id: Utils.newID(),
      title: 'Rollback verification document',
      processing_status: 'pending_clean',
      current_revision_id: null,
      metadata: originalMetadata,
    });
    await DocumentRevision.create({
      id: previousRevisionId,
      document_id: documentId,
      revision_no: 1,
      revision_label: 'v1',
      revision_status: 'effective',
      is_current: 1,
      change_summary: 'Initial revision',
      created_by: 'system',
    });
    await Document.update(
      { current_revision_id: previousRevisionId },
      { where: { id: documentId } }
    );

    // ---- stub MCP 返回 completed，产物导入强制失败以触发回滚 ----
    const service = new DocumentOcrService(db, {
      callMcp: async (server, method, params) => {
        if (method === 'get_task_status') {
          return {
            structuredContent: {
              task_id: params.task_id,
              status: 'completed',
              progress: 100,
              created_at: '2026-08-01T00:00:00Z',
              completed_at: '2026-08-01T00:10:00Z',
            },
          };
        }
        if (method === 'list_tasks') {
          return { structuredContent: { result: [{ task_id: params.task_id, filename: 'rollback-input.pdf' }] } };
        }
        if (method === 'list_deliverables') {
          return {
            structuredContent: {
              artifacts: [{ is_default: true, filename: 'rollback-result.md', artifact_type: 'markdown' }],
            },
          };
        }
        throw new Error(`Unexpected mcp method: ${method}`);
      },
    });
    service._importTaskArtifacts = async () => {
      throw new Error('Simulated artifact import failure');
    };

    // ---- 执行导入（期望失败并触发回滚）----
    let importError = null;
    try {
      await service.importGatewayTaskAsRevision({
        documentId,
        taskId,
        userId: 'system',
        revisionLabel: 'v2-import',
        changeSummary: 'rollback verification import',
      });
    } catch (error) {
      importError = error;
    }
    assert.ok(importError, '期望 importGatewayTaskAsRevision 抛出异常');

    // ---- 验证回滚后的数据库状态 ----
    const docAfter = await Document.findByPk(documentId, { raw: true });
    const prevRevAfter = await DocumentRevision.findByPk(previousRevisionId, { raw: true });
    const failedRev = await DocumentRevision.findOne({
      where: { document_id: documentId, revision_no: 2 },
      raw: true,
    });

    // 1. 主源 current_revision_id 恢复
    assert.equal(
      docAfter.current_revision_id,
      previousRevisionId,
      '文档 current_revision_id 应恢复为导入前原版本'
    );
    console.log('✓ 文档主源 current_revision_id 恢复为原版本');

    // 2. 原版本恢复 effective + is_current=1
    assert.equal(prevRevAfter.revision_status, 'effective', '原版本 revision_status 应恢复为 effective');
    assert.equal(Boolean(prevRevAfter.is_current), true, '原版本 is_current 应恢复为 true');
    console.log('✓ 原版本 revision_status=effective、is_current=1');

    // 3. 失败版本保持 draft + is_current=0
    assert.ok(failedRev, '应存在失败版本（revision_no=2）');
    assert.equal(failedRev.revision_status, 'draft', '失败版本 revision_status 应为 draft');
    assert.equal(Boolean(failedRev.is_current), false, '失败版本 is_current 应为 false');
    console.log('✓ 失败版本 revision_status=draft、is_current=0');

    // 4. metadata 恢复为导入前原始值（原 attachments 不丢失）
    assert.equal(docAfter.metadata, originalMetadata, '文档 metadata 应恢复为导入前原始值（原 attachments 不丢失）');
    console.log('✓ 文档 metadata 恢复（原 attachments 元数据保留）');

    // 5. 处理状态标记失败
    assert.equal(docAfter.processing_status, 'error', '文档 processing_status 应为 error');
    assert.equal(docAfter.processing_error_code, 'gateway_import_failed', '错误码应为 gateway_import_failed');
    console.log('✓ 文档 processing_status=error / gateway_import_failed');

    console.log('\nPASS: taskid 导入失败回滚完整，失败版本/原版本/文档主源三者一致');
  } finally {
    // ---- 清理测试数据（失败时也执行）----
    // 注意：documents 存在 fk_document_current_revision（current_revision_id → document_revisions），
    // 必须先置空 current_revision_id 再删 revision / document
    await Document.update(
      { current_revision_id: null },
      { where: { id: documentId } }
    );
    await DocumentRevision.destroy({ where: { document_id: documentId } });
    await Document.destroy({ where: { id: documentId } });
    await DocumentCollection.destroy({ where: { id: collectionId } });
    await db.close();
  }
}

main().catch((error) => {
  console.error('FAIL:', error.message);
  process.exit(1);
});
