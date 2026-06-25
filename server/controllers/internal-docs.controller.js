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
        ctx.error('Forbidden', 403);
        return;
      }

      this.ensureIntakeService();
      this.ensureCollectionAccessService();
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

      ctx.success(result);
      logger.info(`[InternalDocs] createIntake: ${result.document_id}`);
    } catch (error) {
      logger.error('[InternalDocs] createIntake error:', error);
      ctx.error(error.message, error.status || 500);
    }
  }

  async getProcessingStatus(ctx) {
    try {
      if (!this.validateInternalAccess(ctx)) {
        ctx.error('Forbidden', 403);
        return;
      }

      const { document_id } = ctx.params;
      const userId = ctx.state.session?.id || ctx.request.body?.user_id;

      this.ensureDocAccessService();
      const canRead = await this.docAccessService.canRead(document_id, userId);
      if (!canRead) {
        ctx.error('Access denied', 403);
        return;
      }

      const Document = this.db.getModel('document');
      const document = await Document.findByPk(document_id, {
        attributes: ['id', 'processing_status', 'processing_error_code', 'processing_error_message', 'processing_updated_at'],
        raw: true,
      });

      if (!document) {
        ctx.error('Document not found', 404);
        return;
      }

      ctx.success(document);
    } catch (error) {
      logger.error('[InternalDocs] getProcessingStatus error:', error);
      ctx.error(error.message, error.status || 500);
    }
  }

  async recall(ctx) {
    try {
      if (!this.validateInternalAccess(ctx)) {
        ctx.error('Forbidden', 403);
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

      ctx.success({ items, total: items.length });
      logger.info(`[InternalDocs] recall: ${items.length} results`);
    } catch (error) {
      logger.error('[InternalDocs] recall error:', error);
      ctx.error(error.message, error.status || 500);
    }
  }

  async listRevisions(ctx) {
    try {
      if (!this.validateInternalAccess(ctx)) {
        ctx.error('Forbidden', 403);
        return;
      }

      const { document_id } = ctx.params;
      const userId = ctx.state.session?.id || ctx.request.body?.user_id;

      this.ensureDocAccessService();
      const canRead = await this.docAccessService.canRead(document_id, userId);
      if (!canRead) {
        ctx.error('Access denied', 403);
        return;
      }

      this.ensureRevisionService();
      const revisions = await this.revisionService.getRevisionList(document_id);

      ctx.success(revisions);
    } catch (error) {
      logger.error('[InternalDocs] listRevisions error:', error);
      ctx.error(error.message, error.status || 500);
    }
  }
}

export default InternalDocsController;