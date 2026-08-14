/**
 * Internal Docs Controller - 内部文档 API 控制器
 *
 * === 身份与认证契约（task-20260814 审计 P0-2.1 收口）===
 * 所有 /internal/docs/* 路由在路由层强制 requireAuth（JWT 认证，见 server/routes/internal.routes.js），
 * 到达本控制器的请求必定携带合法用户 session。因此：
 *   - 身份来源唯一：ctx.state.session.id，禁止从 body 读取 user_id（可被调用方伪造）。
 *   - 删除历史遗留的“本地 IP 免认证”分支（isLocal）：它是死代码（被路由层拦截），
 *     且会误导未来新增内部路由时误以为可以绕过认证。
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
    // 身份来源唯一：必须携带合法用户 session。
    // 路由层 requireAuth 已保证无 token 请求被 401 拦截（server/routes/internal.routes.js）。
    return Boolean(ctx.state.session && ctx.state.session.id);
  }

  async createIntake(ctx) {
    try {
      if (!this.validateInternalAccess(ctx)) {
        ctx.error('Forbidden', 403);
        return;
      }

      this.ensureIntakeService();
      this.ensureCollectionAccessService();
      // 身份固定为 session 用户（禁止 body 伪造 user_id）
      const userId = ctx.state.session.id;
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
      // 身份固定为 session 用户（禁止 body 伪造 user_id）
      const userId = ctx.state.session.id;

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
      // 身份固定为 session 用户（禁止 body 伪造 user_id）
      const userId = ctx.state.session.id;
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
      // 身份固定为 session 用户（禁止 body 伪造 user_id）
      const userId = ctx.state.session.id;

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