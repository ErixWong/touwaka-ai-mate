/**
 * sections/find-candidates handler
 *
 * POST /api/apps/standard-mgr/sections/find-candidates
 *
 * 按节号/标题等线索查找候选 section（outline）。
 * 组合使用 outline title/seq 匹配 + DocRecallService.recallWithinDocuments 辅助。
 */

import StandardMgrService from '../../service.js';
import DocumentReadService from '../../../../lib/document-read.service.js';
import DocRecallService from '../../../../lib/doc-recall-service.js';
import DocAccessService from '../../../../lib/doc-access-service.js';
import logger from '../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/sections/find-candidates',
};

export async function post(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const { document_id, revision_id, title_hint, seq_hint, query_text } = ctx.request.body;

    if (!document_id && !revision_id) {
      ctx.error('document_id or revision_id is required', 400);
      return;
    }

    const docAccessService = new DocAccessService(deps.db);

    // R3-5：仅传 revision_id 时先解析 document_id 再做权限校验
    let resolvedDocumentId = document_id;
    if (!resolvedDocumentId && revision_id) {
      const DocumentRevision = deps.db.getModel('document_revision');
      const rev = await DocumentRevision.findByPk(revision_id, { raw: true });
      if (!rev) {
        ctx.error('Revision not found', 404);
        return;
      }
      resolvedDocumentId = rev.document_id;
    }

    if (resolvedDocumentId) {
      const canRead = await docAccessService.canRead(resolvedDocumentId, userId);
      if (!canRead) {
        ctx.throw(403, 'Access denied');
      }
    }

    const documentReadService = new DocumentReadService(deps.db);

    // 确定 revision_id
    let targetRevisionId = revision_id;
    if (!targetRevisionId && resolvedDocumentId) {
      const Document = deps.db.getModel('document');
      const doc = await Document.findByPk(resolvedDocumentId, { raw: true });
      if (!doc) {
        ctx.error('Document not found', 404);
        return;
      }
      targetRevisionId = doc.current_revision_id;
    }

    if (!targetRevisionId) {
      ctx.error('No revision_id available', 400);
      return;
    }

    // 1. 读取 outline 列表
    const outlines = await documentReadService.listOutlines(targetRevisionId);

    // 2. 按 title/seq 精确/模糊匹配（优先）
    let candidates = [];
    if (title_hint) {
      const titleLower = title_hint.toLowerCase();
      candidates = outlines.filter(o => {
        if (!o.title) return false;
        const t = o.title.toLowerCase();
        return t === titleLower || t.includes(titleLower);
      });
    }

    if (seq_hint != null && candidates.length === 0) {
      const seqNum = parseInt(seq_hint, 10);
      if (!isNaN(seqNum)) {
        candidates = outlines.filter(o => o.seq === seqNum);
      }
    }

    // 3. 如果无匹配且有 query_text，用向量召回辅助
    // R2-6：修正 recallWithinDocuments 参数名 top_n→top_k，revision_id→revisionIds
    if (candidates.length === 0 && query_text && document_id) {
      try {
        const docRecallService = new DocRecallService(deps.db, null);
        const recallResult = await docRecallService.recallWithinDocuments(query_text, [document_id], {
          top_k: 5,
          revisionIds: [targetRevisionId],
        });

        if (recallResult && recallResult.items && recallResult.items.length > 0) {
          // 通过 chunk 的 outline_id 反查 outline 信息
          const matchedOutlineIds = [...new Set(
            recallResult.items
              .filter(c => c.outline_id)
              .map(c => c.outline_id)
          )];

          candidates = outlines.filter(o => matchedOutlineIds.includes(o.id));
        }
      } catch (recallErr) {
        logger.warn(`[standard-mgr] findSectionCandidates recall failed: ${recallErr.message}`);
      }
    }

    // 4. 返回结果
    ctx.success({
      candidates,
      total: candidates.length,
      strategy: title_hint ? 'title_match' : (seq_hint != null ? 'seq_match' : (query_text ? 'vector_recall' : 'full_list')),
      revision_id: targetRevisionId,
    });
  } catch (err) {
    logger.error(`[standard-mgr] findSectionCandidates error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}
