/**
 * Doc Collection Controller - 文档集合管理控制器
 *
 * 提供集合 CRUD、文档关联、可见性判定、重新向量化等能力。
 * 重构后: documents.collection_id 直连，不再使用桥接表。
 */
import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op } from 'sequelize';
import { buildPaginatedResponse } from '../../lib/query-builder.js';
import CollectionAccessService from '../../lib/collection-access-service.js';

class DocCollectionController {
  constructor(db) {
    this.db = db;
    this.models = {};
    this.accessService = null;
  }

  ensureModels() {
    if (!this.models.DocCollection) {
      this.models.DocCollection = this.db.getModel('document_collection');
      this.models.DocDocument = this.db.getModel('document');
    }
  }

  ensureAccessService() {
    if (!this.accessService) {
      this.accessService = new CollectionAccessService(this.db);
    }
  }

  // ==================== 集合 CRUD ====================

  async listCollections(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      this.ensureAccessService();
      const userId = ctx.state.session.id;
      const { page = 1, size = 20, query } = ctx.query;

      const where = await this.accessService.buildAccessibleCollectionsWhere(userId);
      if (query) {
        where[Op.and] = [{ name: { [Op.like]: `%${query}%` } }];
      }

      const { count, rows } = await this.models.DocCollection.findAndCountAll({
        where,
        attributes: ['id', 'name', 'description', 'owner_id', 'visibility', 'department_scope', 'embedding_model_id', 'created_at', 'updated_at'],
        order: [['updated_at', 'DESC']],
        offset: (page - 1) * size,
        limit: parseInt(size),
      });

      const collectionIds = rows.map(r => r.id);
      let docCountMap = {};
      if (collectionIds.length > 0) {
        const counts = await this.models.DocDocument.findAll({
          where: { collection_id: { [Op.in]: collectionIds } },
          attributes: ['collection_id', [this.db.sequelize.fn('COUNT', this.db.sequelize.col('id')), 'doc_count']],
          group: ['collection_id'],
          raw: true,
        });
        counts.forEach(c => {
          docCountMap[c.collection_id] = parseInt(c.doc_count);
        });
      }

      const items = rows.map(r => ({
        ...r.toJSON(),
        doc_count: docCountMap[r.id] || 0,
      }));

      ctx.success(buildPaginatedResponse({ count, rows: items }, { page: parseInt(page), pageSize: parseInt(size) }, startTime));
      logger.info(`[Collection] listCollections: ${items.length} results, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[Collection] listCollections error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async createCollection(ctx) {
    try {
      this.ensureModels();
      const userId = ctx.state.session.id;
      const {
        name, description, visibility = 'private',
        department_id, department_scope = 'self',
        embedding_model_id, metadata,
      } = ctx.request.body;

      if (!name || !name.trim()) ctx.throw(400, 'name is required');
      if (name.length > 100) ctx.throw(400, 'name must not exceed 100 characters');
      if (!embedding_model_id) ctx.throw(400, 'embedding_model_id is required');

      const finalDepartmentId = department_id || await this.getUserDepartmentId(userId);
      if (!finalDepartmentId) ctx.throw(400, 'department_id is required: user has no department');

      const collectionId = Utils.newID();
      const collection = await this.models.DocCollection.create({
        id: collectionId,
        name: name.trim(),
        description: description || null,
        owner_id: userId,
        created_by: userId,
        department_id: finalDepartmentId,
        visibility,
        department_scope: visibility === 'department' ? department_scope : 'self',
        embedding_model_id,
        metadata: metadata || null,
      });

      ctx.success(collection);
      logger.info(`[Collection] createCollection: ${collection.id} by ${userId}`);
    } catch (error) {
      logger.error('[Collection] createCollection error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async getCollection(ctx) {
    try {
      this.ensureModels();
      this.ensureAccessService();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;

      const access = await this.accessService.checkAccess(id, userId);
      if (!access) ctx.throw(403, 'Access denied');

      const collection = await this.models.DocCollection.findByPk(id);
      if (!collection) ctx.throw(404, 'Collection not found');

      const docCount = await this.models.DocDocument.count({ where: { collection_id: id } });

      ctx.success({ ...collection.toJSON(), doc_count: docCount });
    } catch (error) {
      logger.error('[Collection] getCollection error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async updateCollection(ctx) {
    try {
      this.ensureModels();
      this.ensureAccessService();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.accessService.canWrite(id, userId);
      if (!canWrite) ctx.throw(403, 'Only the owner can edit this collection');

      const collection = await this.models.DocCollection.findByPk(id);
      if (!collection) ctx.throw(404, 'Collection not found');

      const {
        name, description, visibility, department_id,
        department_scope, embedding_model_id, owner_id, metadata,
      } = ctx.request.body;

      if (name !== undefined) {
        if (!name.trim()) ctx.throw(400, 'name must not be empty');
        if (name.length > 100) ctx.throw(400, 'name must not exceed 100 characters');
        collection.name = name.trim();
      }
      if (description !== undefined) collection.description = description;
      if (visibility !== undefined) collection.visibility = visibility;
      if (department_id !== undefined) collection.department_id = department_id;
      if (department_scope !== undefined) collection.department_scope = department_scope;
      if (owner_id !== undefined) collection.owner_id = owner_id;
      if (metadata !== undefined) collection.metadata = metadata;

      let needsRevectorize = false;
      if (embedding_model_id !== undefined && embedding_model_id !== collection.embedding_model_id) {
        collection.embedding_model_id = embedding_model_id;
        needsRevectorize = true;
      }

      collection.updated_at = new Date();
      await collection.save();

      ctx.success({ ...collection.toJSON(), needs_revectorize: needsRevectorize });
      logger.info(`[Collection] updateCollection: ${id} by ${userId}, needsRevectorize=${needsRevectorize}`);
    } catch (error) {
      logger.error('[Collection] updateCollection error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async deleteCollection(ctx) {
    try {
      this.ensureModels();
      this.ensureAccessService();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.accessService.canWrite(id, userId);
      if (!canWrite) ctx.throw(403, 'Only the owner can delete this collection');

      const docCount = await this.models.DocDocument.count({ where: { collection_id: id } });
      if (docCount > 0) ctx.throw(409, 'Cannot delete collection with documents. Remove all documents first.');

      const collection = await this.models.DocCollection.findByPk(id);
      if (!collection) ctx.throw(404, 'Collection not found');

      await collection.destroy();
      ctx.success({ deleted: true });
      logger.info(`[Collection] deleteCollection: ${id} by ${userId}`);
    } catch (error) {
      logger.error('[Collection] deleteCollection error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  // ==================== 文档关联 ====================

  async listCollectionDocuments(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      this.ensureAccessService();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;
      const { page = 1, size = 20, keyword, processing_status } = ctx.query;

      const access = await this.accessService.checkAccess(id, userId);
      if (!access) ctx.throw(403, 'Access denied');

      const where = { collection_id: id };
      if (keyword) where.title = { [Op.like]: `%${keyword}%` };
      if (processing_status) where.processing_status = processing_status;

      const { count, rows } = await this.models.DocDocument.findAndCountAll({
        where,
        attributes: ['id', 'title', 'doc_type', 'processing_status', 'current_revision_id', 'created_at', 'updated_at'],
        order: [['updated_at', 'DESC']],
        offset: (page - 1) * size,
        limit: parseInt(size),
      });

      const DocVersion = this.db.getModel('document_revision');
      const DocOcrResult = this.db.getModel('doc_ocr_result');
      const Attachment = this.db.getModel('attachment');

      const revisionIds = rows.map(r => r.current_revision_id).filter(Boolean);
      const docIds = rows.map(r => r.id);

      const [revisionRows, ocrRows, attachmentRows] = await Promise.all([
        revisionIds.length > 0
          ? DocVersion.findAll({
            where: { id: { [Op.in]: revisionIds } },
            attributes: ['id', 'revision_no', 'revision_label'],
            raw: true,
          })
          : [],
        DocOcrResult.findAll({
          where: { document_id: { [Op.in]: docIds } },
          attributes: ['id', 'document_id', 'task_id', 'status', 'progress', 'main_markdown_attachment_id', 'updated_at', 'created_at'],
          order: [['created_at', 'DESC']],
          raw: true,
        }),
        revisionIds.length > 0
          ? Attachment.findAll({
            where: { source_tag: 'doc-platform', source_id: { [Op.in]: revisionIds } },
            attributes: ['id', 'file_name', 'mime_type', 'file_size', 'source_id', 'created_at'],
            order: [['created_at', 'ASC']],
            raw: true,
          })
          : [],
      ]);

      const revisionMap = new Map();
      for (const r of revisionRows) revisionMap.set(r.id, r);

      const ocrMap = new Map();
      for (const r of ocrRows) {
        if (!ocrMap.has(r.document_id)) ocrMap.set(r.document_id, r);
      }

      const attachmentMap = new Map();
      for (const a of attachmentRows) {
        if (!attachmentMap.has(a.source_id)) attachmentMap.set(a.source_id, a);
      }

      const enrichedRows = rows.map((row) => {
        const doc = row.toJSON ? row.toJSON() : row;
        const currentRevision = doc.current_revision_id ? revisionMap.get(doc.current_revision_id) || null : null;
        const latestOcrResult = ocrMap.get(doc.id) || null;
        const sourceAttachment = doc.current_revision_id ? attachmentMap.get(doc.current_revision_id) || null : null;

        return {
          ...doc,
          current_revision: currentRevision,
          source_attachment: sourceAttachment,
          ocr_status: latestOcrResult?.status || null,
          has_preview_result: !!latestOcrResult?.main_markdown_attachment_id,
        };
      });

      ctx.success(buildPaginatedResponse({ count, rows: enrichedRows }, { page: parseInt(page), pageSize: parseInt(size) }, startTime));
      logger.info(`[Collection] listCollectionDocuments: ${enrichedRows.length} results, ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('[Collection] listCollectionDocuments error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async addDocument(ctx) {
    try {
      this.ensureModels();
      this.ensureAccessService();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;
      const { document_id } = ctx.request.body;

      const canWrite = await this.accessService.canWrite(id, userId);
      if (!canWrite) ctx.throw(403, 'Only the owner can add documents');

      const document = await this.models.DocDocument.findByPk(document_id);
      if (!document) ctx.throw(404, 'Document not found');

      if (document.collection_id) {
        if (document.collection_id === id) {
          ctx.success({ message: 'Document already in this collection', existing: true });
          return;
        }
        ctx.throw(409, 'Document already belongs to another collection. Use move-collection API instead.');
      }

      document.collection_id = id;
      await document.save();

      ctx.success(document);
      logger.info(`[Collection] addDocument: ${document_id} → collection ${id}`);
    } catch (error) {
      logger.error('[Collection] addDocument error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async removeDocument(ctx) {
    try {
      this.ensureModels();
      this.ensureAccessService();
      const { id, docId } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.accessService.canWrite(id, userId);
      if (!canWrite) ctx.throw(403, 'Only the owner can remove documents');

      const document = await this.models.DocDocument.findOne({ where: { id: docId, collection_id: id } });
      if (!document) ctx.throw(404, 'Document not found in this collection');
      ctx.throw(409, 'Document must belong to a collection. Use moveDocument to move it to another collection.');
    } catch (error) {
      logger.error('[Collection] removeDocument error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async moveDocument(ctx) {
    try {
      this.ensureModels();
      this.ensureAccessService();
      const { docId } = ctx.params;
      const userId = ctx.state.session.id;
      const { target_collection_id, request_id } = ctx.request.body;

      if (!target_collection_id) ctx.throw(400, 'target_collection_id is required');

      const canWrite = await this.accessService.canWrite(target_collection_id, userId);
      if (!canWrite) ctx.throw(403, 'Only the owner of the target collection can move documents there');

      const document = await this.models.DocDocument.findByPk(docId);
      if (!document) ctx.throw(404, 'Document not found');

      if (document.collection_id) {
        const canWriteSource = await this.accessService.canWrite(document.collection_id, userId);
        if (!canWriteSource) ctx.throw(403, 'Only the owner of the source collection can move this document');
      }

      document.collection_id = target_collection_id;
      await document.save();

      ctx.success({ moved: true, document_id: docId, collection_id: target_collection_id });
      logger.info(`[Collection] moveDocument: ${docId} → collection ${target_collection_id}`);
    } catch (error) {
      logger.error('[Collection] moveDocument error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  // ==================== 重新向量化 ====================

  async revectorize(ctx) {
    try {
      this.ensureModels();
      this.ensureAccessService();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.accessService.canWrite(id, userId);
      if (!canWrite) ctx.throw(403, 'Only the owner can trigger revectorization');

      const collection = await this.models.DocCollection.findByPk(id);
      if (!collection) ctx.throw(404, 'Collection not found');

      const documents = await this.models.DocDocument.findAll({
        where: { collection_id: id },
        attributes: ['id'],
        raw: true,
      });
      if (documents.length === 0) {
        ctx.success({ message: 'No documents in this collection', revectorized_count: 0 });
        return;
      }

      const docIds = documents.map(d => d.id);
      const DocVersion = this.db.getModel('document_revision');
      const DocChunk = this.db.getModel('document_chunk');

      const currentVersions = await DocVersion.findAll({
        where: { document_id: { [Op.in]: docIds }, is_current: 1 },
        attributes: ['id', 'document_id'],
        raw: true,
      });
      const versionIds = currentVersions.map(v => v.id);
      if (versionIds.length === 0) {
        ctx.success({ message: 'No current versions to revectorize', revectorized_count: 0 });
        return;
      }

      await DocChunk.update(
        {
          embedding_model_id: collection.embedding_model_id,
          embedding_status: 'pending',
          embedding_vector: null,
          updated_at: new Date(),
        },
        { where: { revision_id: { [Op.in]: versionIds } } }
      );

      // 同步将相关文档状态回退到 pending_embedding，确保文档状态与 chunk 状态一致
      const affectedDocIds = [...new Set(currentVersions.map(v => v.document_id))];
      if (affectedDocIds.length > 0) {
        await this.models.DocDocument.update(
          {
            processing_status: 'pending_embedding',
            processing_error_code: null,
            processing_error_message: null,
            processing_updated_at: new Date(),
          },
          { where: { id: { [Op.in]: affectedDocIds } } }
        );
        logger.info(`[Collection] revectorize: ${affectedDocIds.length} document(s) reset to pending_embedding`);
      }

      ctx.success({
        message: 'Revectorization triggered',
        revectorized_count: versionIds.length,
        embedding_model_id: collection.embedding_model_id,
      });
      logger.info(`[Collection] revectorize: collection ${id}, ${versionIds.length} chunks reset to pending`);
    } catch (error) {
      logger.error('[Collection] revectorize error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async getUserDepartmentId(userId) {
    try {
      const User = this.db.getModel('user');
      const user = await User.findOne({
        where: { id: userId },
        attributes: ['department_id'],
        raw: true,
      });
      return user?.department_id || null;
    } catch {
      return null;
    }
  }
}

export default DocCollectionController;
