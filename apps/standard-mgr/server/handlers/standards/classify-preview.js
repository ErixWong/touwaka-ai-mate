/**
 * standards/classify-preview handler
 *
 * POST /api/apps/standard-mgr/standards/classify-preview
 *
 * R11-2: 归属推断预览 —— 输入 {document_id, revision_id}，返回推断的 standard_type/standard_code/standard_name/enterprise
 * 纯只读，不落库。
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

export const route = {
  path: '/standards/classify-preview',
};

export async function post(ctx, deps) {
  try {
    const service = new StandardMgrService(deps.db);
    const body = ctx.request.body;

    const { document_id, revision_id } = body || {};

    if (!document_id) {
      ctx.error('document_id is required', 400);
      return;
    }

    if (!revision_id) {
      ctx.error('revision_id is required', 400);
      return;
    }

    const result = await service.classifyPreview({ document_id, revision_id });
    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] classifyPreview error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}
