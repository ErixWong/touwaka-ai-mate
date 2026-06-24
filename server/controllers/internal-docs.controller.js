/**
 * Internal Docs Controller - 内部文档 API 控制器
 *
 * 用于驻留进程/技能调用文档能力
 *
 * API 设计（按审计报告 P27）：
 * - POST /internal/docs/intakes - 文档接入
 * - GET /internal/docs/:document_id/processing - 查询处理状态
 * - POST /internal/docs/recall - 文档召回
 * - GET /internal/docs/:document_id/revisions - 版本列表
 */

import logger from '../../lib/logger.js';
import DocumentIntakeService from '../../lib/document-intake.service.js';
import DocumentRecallService from '../../lib/document-recall.service.js';
import DocumentRevisionService from '../../lib/document-revision.service.js';
import DocAccessService from '../../lib/doc-access-service.js';
import CollectionAccessService from '../../lib/collection-access-service.js';

class InternalDocsController {
  constructor(db) {
    this.db = db;
    this.intakeService = null;
    this.recallService = null;
    this.revisionService = null;
    this.docAccessService = null;
    this.collectionAccessService = null;
  }

  ensureIntakeService() {
    if (!this.intakeService) {
      this.intakeService = new DocumentIntakeService(this.db);
    }
  }

  ensureRecallService() {
    if (!this.recallService) {
      this.recallService = new DocumentRecallService(this.db);
    }
  }

  ensureRevisionService() {
    if (!this.revisionService) {
      this.revisionService = new DocumentRevisionService(this.db);
    }
  }

  ensureDocAccessService() {
    if (!this.docAccessService) {
      this.docAccessService = new DocAccessService(this.db);
    }
  }

  ensureCollectionAccessService() {
    if (!this.collectionAccessService) {
      this.collectionAccessService = new CollectionAccessService(this.db);
    }
  }

  validateInternalAccess(ctx) {
    const ip = ctx.ip || ctx.request.ip || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.0.0.1');
    return isLocal || ctx.state.session;
  }

  async createIntake(ctx) {
    try {
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.body = { success: false, message: 'Forbidden', code: 'FORBIDDEN' };
        return;
      }

      this.ensureIntakeService();
      const userId = ctx.state.session?.id || ctx.request.body?.user_id;
      const { app_id, collection_id, schema_id, attachments } = ctx.request.body;

      const { collection } = await this.intakeService.validateIntakeRequest({
        appId: app_id,
        collectionId: collection_id,
        attachmentIds: attachments?.map(a => a.id).filter(Boolean) || [],
        userId,
        collectionAccessService: this.collectionAccessService,
      });

      const result = await this.intakeService.createIntakeDocument({
        appId: app_id,
        collectionId: collection_id,
        schemaId: schema_id,
        attachments,
        userId,
      });

      ctx.body = { success: true, data: result };
      logger.info(`[InternalDocs] createIntake: ${result.document_id}`);
    } catch (error) {
      logger.error('[InternalDocs] createIntake error:', error);
      ctx.status = error.status || 500;
      ctx.body = { success: false, message: error.message, code: error.code || 'INTERNAL_ERROR' };
    }
  }

  async getProcessingStatus(ctx) {
    try {
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.body = { success: false, message: 'Forbidden', code: 'FORBIDDEN' };
        return;
      }

      const { document_id } = ctx.params;
      const userId = ctx.state.session?.id || ctx.request.body?.user_id;

      this.ensureDocAccessService();
      const canRead = await this.docAccessService.canRead(document_id, userId);
      if (!canRead) {
        ctx.status = 403;
        ctx.body = { success: false, message: 'Access denied', code: 'FORBIDDEN' };
        return;
      }

      const Document = this.db.getModel('document');
      const document = await Document.findByPk(document_id, {
        attributes: ['id', 'processing_status', 'processing_error_code', 'processing_error_message', 'processing_updated_at'],
        raw: true,
      });

      if (!document) {
        ctx.status = 404;
        ctx.body = { success: false, message: 'Document not found', code: 'NOT_FOUND' };
        return;
      }

      ctx.body = { success: true, data: document };
    } catch (error) {
      logger.error('[InternalDocs] getProcessingStatus error:', error);
      ctx.status = error.status || 500;
      ctx.body = { success: false, message: error.message, code: error.code || 'INTERNAL_ERROR' };
    }
  }

  async recall(ctx) {
    try {
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.body = { success: false, message: 'Forbidden', code: 'FORBIDDEN' };
        return;
      }

      this.ensureRecallService();
      const userId = ctx.state.session?.id || ctx.request.body?.user_id;
      const { query, scope, doc_types, top_k, threshold } = ctx.request.body;

      const items = await this.recallService.recall(query, {
        scope: scope || 'all',
        doc_types,
        top_k: top_k || 5,
        threshold: threshold || 0.1,
        userId,
      });

      ctx.body = { success: true, data: items, total: items.length };
      logger.info(`[InternalDocs] recall: ${items.length} results`);
    } catch (error) {
      logger.error('[InternalDocs] recall error:', error);
      ctx.status = error.status || 500;
      ctx.body = { success: false, message: error.message, code: error.code || 'INTERNAL_ERROR' };
    }
  }

  async listRevisions(ctx) {
    try {
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.body = { success: false, message: 'Forbidden', code: 'FORBIDDEN' };
        return;
      }

      const { document_id } = ctx.params;
      const userId = ctx.state.session?.id || ctx.request.body?.user_id;

      this.ensureDocAccessService();
      const canRead = await this.docAccessService.canRead(document_id, userId);
      if (!canRead) {
        ctx.status = 403;
        ctx.body = { success: false, message: 'Access denied', code: 'FORBIDDEN' };
        return;
      }

      this.ensureRevisionService();
      const revisions = await this.revisionService.getRevisionList(document_id);

      ctx.body = { success: true, data: revisions };
    } catch (error) {
      logger.error('[InternalDocs] listRevisions error:', error);
      ctx.status = error.status || 500;
      ctx.body = { success: false, message: error.message, code: error.code || 'INTERNAL_ERROR' };
    }
  }
}

export default InternalDocsController;