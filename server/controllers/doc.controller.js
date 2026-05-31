/**
 * Doc Controller - 统一文档平台控制器
 *
 * 提供统一的文档管理能力：
 * - 文档 CRUD
 * - 版本管理
 * - 内容检索
 * - 比对能力
 *
 * API 规范见 docs/tasks/active/task-20260531-kb-contract-unification-analysis/UNIFIED_DOCUMENT_PLATFORM_PLAN.md §20
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op, Sequelize } from 'sequelize';
import { buildPaginatedResponse } from '../../lib/query-builder.js';
import DocRecallService from '../../lib/doc-recall-service.js';
import DocCompareExecutor from '../../lib/doc-compare-executor.js';

class DocController {
  constructor(db) {
    this.db = db;
    this.models = {};
    this.docRecallService = null;
    this.compareExecutor = null;
  }

  // ==================== 版本状态机 ====================
  VALID_TRANSITIONS = {
    'draft':    ['review', 'archived'],
    'review':   ['approved', 'draft', 'archived'],
    'approved': ['effective', 'draft', 'archived'],
    'effective':['expired', 'archived'],
    'expired':  ['draft', 'archived'],
    'archived': [],
  };

  validateTransition(from, to) {
    const valid = this.VALID_TRANSITIONS[from];
    if (!valid || !valid.includes(to)) {
      throw new Error(`Invalid status transition: ${from} → ${to}`);
    }
    return true;
  }

  ensureModels() {
    if (!this.models.DocDocument) {
      this.models.DocDocument = this.db.getModel('doc_document');
      this.models.DocVersion = this.db.getModel('doc_version');
      this.models.DocContentUnit = this.db.getModel('doc_content_unit');
      this.models.DocEmbedding = this.db.getModel('doc_embedding');
      this.models.DocTag = this.db.getModel('doc_tag');
      this.models.DocDocumentTag = this.db.getModel('doc_document_tag');
      this.models.DocPermission = this.db.getModel('doc_permission');
      this.models.DocCompareRun = this.db.getModel('doc_compare_run');
      this.models.DocCompareItem = this.db.getModel('doc_compare_item');
    }
  }

  ensureCompareExecutor() {
    if (!this.compareExecutor) {
      this.compareExecutor = new DocCompareExecutor(this.db);
    }
  }

  ensureDocRecallService() {
    if (!this.docRecallService) {
      this.docRecallService = new DocRecallService(this.db, null);
    }
  }

  /**
   * 获取文档列表
   * GET /api/docs
   */
  async listDocuments(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const userId = ctx.state.session.id;
      const orgId = ctx.state.session.org_id;
      const { page = 1, size = 20, doc_type } = ctx.query;

      const visibilityFilter = {
        [Op.or]: [
          { owner_id: userId },
          { visibility: 'public' },
          { visibility: 'org', org_id: orgId },
        ],
      };
      const where = {
        ...visibilityFilter,
        lifecycle_status: 'active',
      };
      if (doc_type) where.doc_type = doc_type;

      const { count, rows } = await this.models.DocDocument.findAndCountAll({
        where,
        attributes: ['id', 'doc_type', 'title', 'owner_id', 'org_id', 'visibility', 'current_version_id', 'created_at', 'updated_at'],
        order: [['updated_at', 'DESC']],
        offset: (page - 1) * size,
        limit: parseInt(size),
      });

      ctx.success(buildPaginatedResponse({ count, rows }, { page: parseInt(page), pageSize: parseInt(size) }, startTime));
      logger.info(`[Doc] listDocuments: ${rows.length} results, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[Doc] listDocuments error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 获取文档详情
   * GET /api/docs/:documentId
   */
  async getDocument(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;
      const orgId = ctx.state.session.org_id;

      const document = await this.models.DocDocument.findOne({
        where: {
          id: documentId,
          [Op.or]: [
            { owner_id: userId },
            { visibility: 'public' },
            { visibility: 'org', org_id: orgId },
          ],
        },
        include: [{
          model: this.models.DocVersion,
          as: 'doc_versions',
          attributes: ['id', 'version_no', 'version_label', 'version_status', 'is_current', 'effective_from', 'effective_to', 'created_at'],
          order: [['version_no', 'DESC']],
        }],
      });

      if (!document) {
        ctx.throw(404, 'Document not found');
      }

      ctx.success(document);
      logger.info(`[Doc] getDocument: ${documentId}, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[Doc] getDocument error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 获取版本列表
   * GET /api/docs/:documentId/versions
   */
  async listVersions(ctx) {
    try {
      this.ensureModels();
      const { documentId } = ctx.params;

      const versions = await this.models.DocVersion.findAll({
        where: { document_id: documentId },
        order: [['version_no', 'DESC']],
      });

      ctx.success(versions);
    } catch (error) {
      logger.error('[Doc] listVersions error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 获取内容树
   * GET /api/docs/:documentId/versions/:versionId/content-tree
   */
  async getContentTree(ctx) {
    try {
      this.ensureModels();
      const { documentId, versionId } = ctx.params;

      const version = await this.models.DocVersion.findOne({
        where: { id: versionId, document_id: documentId },
      });
      if (!version) ctx.throw(404, 'Version not found for this document');

      const units = await this.models.DocContentUnit.findAll({
        where: { version_id: versionId },
        order: [['position', 'ASC']],
      });

      const tree = this.buildContentTree(units);

      ctx.success(tree);
    } catch (error) {
      logger.error('[Doc] getContentTree error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  buildContentTree(units) {
    const unitMap = new Map();
    const rootUnits = [];

    units.forEach(unit => {
      unitMap.set(unit.id, { ...unit.toJSON(), children: [] });
    });

    units.forEach(unit => {
      const node = unitMap.get(unit.id);
      if (unit.parent_id) {
        const parent = unitMap.get(unit.parent_id);
        if (parent) {
          parent.children.push(node);
        }
      } else {
        rootUnits.push(node);
      }
    });

    return rootUnits;
  }

  async createDocument(ctx) {
    try {
      this.ensureModels();
      const userId = ctx.state.session.id;
      const orgId = ctx.state.session.org_id;
      const { doc_type, title, visibility = 'private', metadata } = ctx.request.body;

      if (!title || !doc_type) {
        ctx.throw(400, 'title and doc_type are required');
      }

      const docId = Utils.newID();
      const document = await this.models.DocDocument.create({
        id: docId,
        doc_type,
        source_system: 'doc_platform',
        source_ref_id: docId,
        title,
        owner_id: userId,
        org_id: orgId,
        visibility,
        lifecycle_status: 'active',
        metadata: metadata || null,
      });

      ctx.success(document);
      logger.info(`[Doc] createDocument: ${document.id}`);
    } catch (error) {
      logger.error('[Doc] createDocument error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async updateDocument(ctx) {
    try {
      this.ensureModels();
      const { documentId } = ctx.params;
      const { title, visibility, metadata } = ctx.request.body;

      const document = await this.models.DocDocument.findOne({
        where: { id: documentId },
      });

      if (!document) {
        ctx.throw(404, 'Document not found');
      }

      if (title) document.title = title;
      if (visibility) document.visibility = visibility;
      if (metadata) document.metadata = metadata;
      document.updated_at = new Date();

      await document.save();

      ctx.success(document);
    } catch (error) {
      logger.error('[Doc] updateDocument error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async createVersion(ctx) {
    try {
      this.ensureModels();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;
      const { version_label, change_summary, content_units } = ctx.request.body;

      const document = await this.models.DocDocument.findOne({
        where: { id: documentId },
      });
      if (!document) ctx.throw(404, 'Document not found');

      const maxVersion = await this.models.DocVersion.findOne({
        where: { document_id: documentId },
        order: [['version_no', 'DESC']],
      });
      const versionNo = maxVersion ? maxVersion.version_no + 1 : 1;
      const versionId = Utils.newID();

      await this.db.sequelize.transaction(async (t) => {
        await this.models.DocVersion.create({
          id: versionId,
          document_id: documentId,
          version_no: versionNo,
          version_label: version_label || `v${versionNo}`,
          version_status: 'draft',
          is_current: 0,
          change_summary: change_summary || null,
          created_by: userId,
        }, { transaction: t });

        if (content_units && Array.isArray(content_units) && content_units.length > 0) {
          for (let i = 0; i < content_units.length; i++) {
            const unit = content_units[i];
            await this.models.DocContentUnit.create({
              id: Utils.newID(),
              version_id: versionId,
              parent_id: unit.parent_id || null,
              unit_type: unit.unit_type || 'paragraph',
              title: unit.title || null,
              content: unit.content || null,
              position: unit.position ?? i,
              level: unit.level || 1,
              token_count: unit.token_count || null,
              is_knowledge_point: unit.is_knowledge_point ? 1 : 0,
              metadata: unit.metadata || null,
            }, { transaction: t });
          }
        }
      });

      const version = await this.models.DocVersion.findByPk(versionId);
      ctx.success(version);
      logger.info(`[Doc] createVersion: ${versionId} for ${documentId}, ${content_units?.length || 0} units`);
    } catch (error) {
      logger.error('[Doc] createVersion error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async setCurrentVersion(ctx) {
    try {
      this.ensureModels();
      const { documentId, versionId } = ctx.params;

      const document = await this.models.DocDocument.findOne({
        where: { id: documentId },
      });
      if (!document) ctx.throw(404, 'Document not found');

      const version = await this.models.DocVersion.findOne({
        where: { id: versionId, document_id: documentId },
      });
      if (!version) ctx.throw(404, 'Version not found');

      this.validateTransition(version.version_status, 'effective');

      await this.db.sequelize.transaction(async (t) => {
        const [locked] = await this.db.sequelize.query(
          'SELECT id, current_version_id FROM doc_documents WHERE id = ? FOR UPDATE',
          { replacements: [documentId], type: this.db.sequelize.QueryTypes.SELECT, transaction: t }
        );
        if (!locked || locked.length === 0) {
          throw new Error('Document not found');
        }

        const currentVersionId = locked[0].current_version_id;
        if (currentVersionId === versionId) {
          return;
        }

        await this.models.DocVersion.update(
          { is_current: 0 },
          { where: { document_id: documentId }, transaction: t }
        );

        version.is_current = 1;
        version.version_status = 'effective';
        version.published_at = new Date();
        await version.save({ transaction: t });

        await this.models.DocDocument.update(
          { current_version_id: versionId },
          { where: { id: documentId }, transaction: t }
        );
      });

      await document.reload();
      ctx.success({ document, version });
      logger.info(`[Doc] setCurrentVersion: ${versionId} for ${documentId}`);
    } catch (error) {
      logger.error('[Doc] setCurrentVersion error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async transitionVersionStatus(ctx) {
    try {
      this.ensureModels();
      const { documentId, versionId } = ctx.params;
      const { to_status } = ctx.request.body;

      if (!to_status) ctx.throw(400, 'to_status is required');

      const version = await this.models.DocVersion.findOne({
        where: { id: versionId, document_id: documentId },
      });
      if (!version) ctx.throw(404, 'Version not found');

      this.validateTransition(version.version_status, to_status);

      const updates = { version_status: to_status };
      if (to_status === 'approved') {
        updates.approved_at = new Date();
        updates.approved_by = ctx.state.session.id;
      }
      if (to_status === 'expired') {
        updates.effective_to = new Date();
      }

      await version.update(updates);
      ctx.success(version);
      logger.info(`[Doc] transitionVersionStatus: ${versionId} ${version.version_status} → ${to_status}`);
    } catch (error) {
      logger.error('[Doc] transitionVersionStatus error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 统一召回入口
   * POST /api/docs/recall
   *
   * 请求参数见计划文档 §20.3
   */
  async recall(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      this.ensureDocRecallService();

      const userId = ctx.state.session.id;
      const orgId = ctx.state.session.org_id;

      const {
        query,
        scope = 'all',
        doc_types,
        top_k = 5,
        threshold = 0.1,
      } = ctx.request.body;

      if (!query || !query.trim()) {
        ctx.throw(400, 'Query is required');
      }

      const result = await this.docRecallService.recall(query, {
        scope,
        doc_types,
        top_k: parseInt(top_k),
        threshold: parseFloat(threshold),
        userId,
        org_id: orgId,
      });

      if (!result.success) {
        ctx.throw(500, result.message || 'Recall failed');
      }

      ctx.success(result.items);
      logger.info(`[Doc] recall: ${result.items.length} results, scope=${scope}, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[Doc] recall error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 创建比对任务
   * POST /api/docs/compare-runs
   */
  async createCompareRun(ctx) {
    try {
      this.ensureModels();
      const userId = ctx.state.session.id;
      const { document_id, base_version_id, target_version_id } = ctx.request.body;

      if (!document_id || !base_version_id || !target_version_id) {
        ctx.throw(400, 'document_id, base_version_id and target_version_id are required');
      }

      const run = await this.models.DocCompareRun.create({
        id: Utils.newID(),
        document_id,
        base_version_id,
        target_version_id,
        status: 'pending',
        created_by: userId,
      });

      ctx.success(run);
      logger.info(`[Doc] createCompareRun: ${run.id}`);

      this.ensureCompareExecutor();
      setImmediate(() => this.compareExecutor.execute(run.id));
    } catch (error) {
      logger.error('[Doc] createCompareRun error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 获取比对结果
   * GET /api/docs/compare-runs/:runId
   */
  async getCompareRun(ctx) {
    try {
      this.ensureModels();
      const { runId } = ctx.params;

      const run = await this.models.DocCompareRun.findOne({
        where: { id: runId },
        include: [{
          model: this.models.DocCompareItem,
          as: 'items',
        }],
      });

      if (!run) {
        ctx.throw(404, 'Compare run not found');
      }

      ctx.success(run);
    } catch (error) {
      logger.error('[Doc] getCompareRun error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }
}

export default DocController;