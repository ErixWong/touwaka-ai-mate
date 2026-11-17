/**
 * doc-pipeline-worker - 文档平台流水线推进器 (internal job)
 *
 * 职责：扫描待处理文档，按 processing_status 阶段路由到对应 service，
 * 推进文档平台处理链（OCR → Clean → Outline → Chunk → Embedding）。
 *
 * 这是 Unified Clock Phase 1 的第一个 internal job 样板。
 * 核心逻辑从历史 doc-ocr-pipeline app tick 迁移而来。
 *
 * 导出: export async function run(context)
 */

import logger from './logger.js';
import { syncDocBindingOnOcrSubmit, syncDocBindingOnOcrCompleted } from './doc-pipeline-binding-sync.js';

/**
 * 每轮捉取待处理文档数。默认 5（历史行为）；
 * 外部导入/回填等批量场景可用 DOC_PIPELINE_MAX_BATCH 临时拉高，
 * 清洗阶段本身就是异步后台执行，卡点不在 worker 而在单文档串行分块。
 */
const MAX_BATCH_SIZE = Math.max(1, parseInt(process.env.DOC_PIPELINE_MAX_BATCH || '5', 10) || 5);

/**
 * 启动清理：结清 doc_process_runs 中的僵尸 running 记录。
 *
 * 服务器在阶段执行中途崩溃/重启时，正在执行的运行记录会永远停留在
 * running 状态，后续 submit 会被 "already running" 守卫永久拒绝，
 * 文档被锁死。进程启动时不可能存在本进程仍在执行的阶段，因此所有
 * running 记录必然来自已死亡的进程，可安全结清。
 *
 * 与 AppClock 对 app_tick_run 的启动清理（interrupted_by_restart）同语义。
 * 注意：result_status 列为 STRING(16)，放不下 'interrupted_by_restart'，
 * 统一用 'nok' + 明确 message。
 *
 * @param {Object} db - Database 实例
 */
export async function settleStalePipelineRuns(db) {
  try {
    const DocProcessRun = db.getModel('doc_process_run');
    if (!DocProcessRun) {
      logger.warn('[doc-pipeline-worker] doc_process_run model not available, skipping startup cleanup');
      return;
    }
    const [affected] = await DocProcessRun.update(
      {
        result_status: 'nok',
        finished_at: new Date(),
        message: 'Interrupted by server restart before stage settled',
      },
      { where: { result_status: 'running' } }
    );
    if (affected > 0) {
      logger.info(`[doc-pipeline-worker] Startup cleanup: ${affected} stale running run(s) settled to nok`);
    } else {
      logger.info('[doc-pipeline-worker] Startup cleanup: no stale running runs');
    }
  } catch (error) {
    logger.warn('[doc-pipeline-worker] Startup cleanup failed (non-fatal):', error.message);
  }
}

/**
 * 文档流水线推进主入口
 *
 * @param {Object} context - 由 ClockCore 或兼容层注入
 * @param {Object} context.services - { query, execute, getModel, documentOcr, documentClean, documentOutline, documentChunk, documentEmbedding }
 * @returns {Object} { success, processed, submitted, synced, skipped, outlineSubmitted, chunksGenerated, failed }
 */
export async function run(context) {
  const { services } = context;

  if (!services) {
    return { skipped: true, reason: 'no_services' };
  }

  // 并发封顶算“在册总量”，不是“本轮新提交量”：submit() 是异步后台执行，
  // 文档进入清洗后会长时间保持 running，每轮再发 MAX_BATCH 篇会无限叠加
  // （实测 27 篇同时调 LLM，网关延迟从 18s 涨到 200s+ 并成批超时）。
  const inFlight = await services.query(
    `SELECT COUNT(*) c FROM documents d
     WHERE d.processing_status IN ('pending_ocr', 'ocr_processing', 'pending_clean', 'pending_outline', 'pending_chunk', 'pending_embedding')
       AND EXISTS (
         SELECT 1 FROM doc_process_runs r
          WHERE r.subject_type = 'documents'
            AND r.subject_id = d.id
            AND r.pipeline_step = d.processing_status
            AND r.result_status = 'running'
       )`,
  );
  const slots = MAX_BATCH_SIZE - Number(inFlight?.[0]?.c || 0);
  if (slots <= 0) {
    return { skipped: true, reason: 'concurrency_cap_reached', in_flight: Number(inFlight?.[0]?.c || 0) };
  }

  // 已在本阶段跑着的文档不再入批：它们仍停留在 pending_* 状态且 processing_updated_at
  // 最旧，不下钻排除就会每轮把槽位占满 → 新文档永远排不到。
  const documents = await services.query(
    `SELECT d.id, d.processing_status, d.current_revision_id
     FROM documents d
     WHERE d.processing_status IN ('pending_ocr', 'ocr_processing', 'pending_clean', 'pending_outline', 'pending_chunk', 'pending_embedding')
       AND d.current_revision_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM doc_process_runs r
          WHERE r.subject_type = 'documents'
            AND r.subject_id = d.id
            AND r.pipeline_step = d.processing_status
            AND r.result_status = 'running'
       )
     ORDER BY d.processing_updated_at ASC
     LIMIT ?`,
    [slots]
  );

  if (!documents || documents.length === 0) {
    return { skipped: true, reason: 'no_pending_documents' };
  }

  let submitted = 0;
  let synced = 0;
  let skipped = 0;
  let outlineSubmitted = 0;
  let chunksGenerated = 0;
  let failed = 0;

  for (const doc of documents) {
    try {
      if (doc.processing_status === 'pending_ocr') {
        const submittedResult = await services.documentOcr.submit(doc.id);
        await syncDocBindingOnOcrSubmit(services, doc.id, submittedResult);
        submitted += 1;
        continue;
      }

      if (doc.processing_status === 'ocr_processing') {
        const syncResult = await services.documentOcr.syncTaskStatus(doc.id);
        await syncDocBindingOnOcrCompleted(services, doc.id, syncResult);
        synced += 1;
        continue;
      }

      if (doc.processing_status === 'pending_clean') {
        if (!services.documentClean) {
          failed += 1;
          continue;
        }
        await services.documentClean.submit(doc.id, {
          initiatedByType: 'scheduler',
          initiatedById: null,
        });
        submitted += 1;
        continue;
      }

      // pending_embedding 由独立后台 worker (document-embedding-worker) 异步处理，
      // 不做同步透传，避免阻塞主循环
      if (doc.processing_status === 'pending_embedding') {
        skipped += 1;
        continue;
      }

      if (doc.processing_status === 'pending_outline') {
        if (!services.documentOutline) {
          failed += 1;
          continue;
        }
        const outlineSubmitResult = await services.documentOutline.submit(doc.current_revision_id, {});
        if (outlineSubmitResult?.accepted) {
          outlineSubmitted += 1;
        }
        continue;
      }

      if (doc.processing_status === 'pending_chunk') {
        if (!services.documentChunk) {
          failed += 1;
          continue;
        }
        await services.documentChunk.generate(doc.current_revision_id, {
          initiatedByType: 'scheduler',
          initiatedById: null,
        });
        chunksGenerated += 1;
      }
    } catch (error) {
      failed += 1;
      if (error?.code === 'DOCUMENT_DELETED') {
        logger.warn(`[doc-pipeline-worker] document ${doc.id} skipped after deletion: ${error.message}`);
      } else {
        logger.error(`[doc-pipeline-worker] document ${doc.id} failed: ${error.message}`);
      }
    }
  }

  return {
    success: true,
    processed: documents.length,
    submitted,
    synced,
    skipped,
    outlineSubmitted,
    chunksGenerated,
    failed,
  };
}

export default { run, settleStalePipelineRuns };
