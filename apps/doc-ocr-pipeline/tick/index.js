/**
 * apps/doc-ocr-pipeline/tick/index.js
 *
 * COMPATIBILITY SHELL (Phase 1)
 *
 * 本文件保留用于向后兼容，实际执行已委托给 lib/doc-pipeline-worker.js。
 * 当 AppClock 仍然拉取 doc-ocr-pipeline 时，tick() 会将调用转发到新的 run()。
 *
 * Phase 2 退役后本文件将被移除。
 */

import logger from '../../../lib/logger.js';
import { run as docPipelineWorkerRun } from '../../../lib/doc-pipeline-worker.js';

export async function tick(context) {
  const { app, services } = context;

  if (!app) {
    return { skipped: true, reason: 'no_app' };
  }

  logger.info('[doc-ocr-pipeline:tick] Compatibility shell: delegating to doc-pipeline-worker');

  try {
    const result = await docPipelineWorkerRun({ services });
    return result;
  } catch (error) {
    logger.error(`[doc-ocr-pipeline:tick] Delegation failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

export default { tick };