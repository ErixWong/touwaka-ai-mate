/**
 * Doc Collection Controller - 文档集合管理控制器
 *
 * 提供集合 CRUD、文档关联、可见性判定、重新向量化等能力。
 * 重构后: doc_documents.collection_id 直连，不再使用桥接表。
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
      this.models.DocCollection = this.db.getModel('doc_collection');
      this.models.DocDocument = this.db.getModel('doc_document');
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
    try {
      this.ensureModels();
      this.ensureAccessService();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;
      const { page = 1, size = 20 } = ctx.query;

      const access = await this.accessService.checkAccess(id, userId);
      if (!access) ctx.throw(403, 'Access denied');

      const { count, rows } = await this.models.DocDocument.findAndCountAll({
        where: { collection_id: id },
        attributes: ['id', 'title', 'doc_type', 'visibility', 'lifecycle_status', 'current_version_id', 'created_at', 'updated_at'],
        order: [['updated_at', 'DESC']],
        offset: (page - 1) * size,
        limit: parseInt(size),
      });

      ctx.success(buildPaginatedResponse({ count, rows }, { page: parseInt(page), pageSize: parseInt(size) }));
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
      if (document.owner_id !== userId) ctx.throw(403, 'Only the document owner can add it to a collection');

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

      document.collection_id = null;
      await document.save();

      ctx.success({ removed: true });
      logger.info(`[Collection] removeDocument: ${docId} from collection ${id}`);
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
      if (document.owner_id !== userId) ctx.throw(403, 'Only the document owner can move it');

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
      const DocVersion = this.db.getModel('doc_version');
      const DocChunk = this.db.getModel('doc_chunk');

      const currentVersions = await DocVersion.findAll({
        where: { document_id: { [Op.in]: docIds }, is_current: 1 },
        attributes: ['id'],
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
        { where: { version_id: { [Op.in]: versionIds } } }
      );

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
