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
import fs from 'fs/promises';
import path from 'path';
import { buildPaginatedResponse } from '../../lib/query-builder.js';
import { parseOcrMetadata, getPreviewAttachmentId, hasPreviewResult } from '../../lib/doc-ocr-utils.js';
import DocRecallService from '../../lib/doc-recall-service.js';
import DocCompareExecutor from '../../lib/doc-compare-executor.js';
import DocAccessService from '../../lib/doc-access-service.js';
import CollectionAccessService from '../../lib/collection-access-service.js';
import DocumentOcrService from '../../lib/document-ocr-service.js';
import DocumentOutlineService from '../../lib/document-outline-service.js';
import DocumentChunkService from '../../lib/document-chunk-service.js';
import AttachmentService from '../services/attachment.service.js';
import { getSystemSettingService } from '../services/system-setting.service.js';
import { DOC_PIPELINE_KEYS, mergeWithDefaults, createCallLlmFn } from '../../lib/doc-pipeline-defaults.js';

class DocController {
  constructor(db) {
    this.db = db;
    this.models = {};
    this.docRecallService = null;
    this.compareExecutor = null;
    this.docAccessService = null;
    this.collectionAccessService = null;
    this.attachmentService = new AttachmentService(db);
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
      this.models.DocDocument = this.db.getModel('document');
      this.models.DocVersion = this.db.getModel('document_revision');
      this.models.DocChunk = this.db.getModel('document_chunk');
      this.models.DocTag = this.db.getModel('doc_tag');
      this.models.DocDocumentTag = this.db.getModel('doc_document_tag');
      this.models.DocCompareRun = this.db.getModel('doc_compare_run');
      this.models.DocCompareItem = this.db.getModel('doc_compare_item');
    }
  }

  ensureCompareExecutor() {
    if (!this.compareExecutor) {
      this.compareExecutor = new DocCompareExecutor(this.db);
    }
  }

  ensureDocAccessService() {
    if (!this.docAccessService) {
      this.docAccessService = new DocAccessService(this.db);
    }
  }

  ensureDocRecallService() {
    if (!this.docRecallService) {
      this.docRecallService = new DocRecallService(this.db, null);
    }
  }

  ensureCollectionAccessService() {
    if (!this.collectionAccessService) {
      this.collectionAccessService = new CollectionAccessService(this.db);
    }
  }

  ensureDocumentOcrService(ctx) {
    if (!this.documentOcrService) {
      const systemSettingService = getSystemSettingService(this.db);
      this.documentOcrService = new DocumentOcrService(this.db, {
        callMcp: async (server, tool, params, timeoutMs) => {
          const appClock = ctx?.app?.context?.appClock;
          if (!appClock || typeof appClock.callMcp !== 'function') {
            throw new Error('AppClock MCP caller not available');
          }
          return await appClock.callMcp(server, tool, params, timeoutMs);
        },
        getDocPipelineConfig: async () => {
          const records = await systemSettingService.SystemSetting.findAll({
            where: { setting_key: DOC_PIPELINE_KEYS.map(k => `doc_pipeline.${k}`) },
            raw: true,
          });
          const stored = {};
          for (const record of records) {
            const stageKey = record.setting_key.replace('doc_pipeline.', '');
            try {
              stored[stageKey] = JSON.parse(record.setting_value);
            } catch {
              stored[stageKey] = null;
            }
          }
          return mergeWithDefaults(stored);
        },
        callLlm: createCallLlmFn(this.db),
      });
    }
  }

  ensureDocumentOutlineService(ctx) {
    if (!this.documentOutlineService) {
      const systemSettingService = getSystemSettingService(this.db);
      this.documentOutlineService = new DocumentOutlineService(this.db, {
        getDocPipelineConfig: async () => {
          const records = await systemSettingService.SystemSetting.findAll({
            where: { setting_key: DOC_PIPELINE_KEYS.map(k => `doc_pipeline.${k}`) },
            raw: true,
          });
          const stored = {};
          for (const record of records) {
            const stageKey = record.setting_key.replace('doc_pipeline.', '');
            try {
              stored[stageKey] = JSON.parse(record.setting_value);
            } catch {
              stored[stageKey] = null;
            }
          }
          return mergeWithDefaults(stored);
        },
        callLlm: createCallLlmFn(this.db),
      });
    }
  }

  ensureDocumentChunkService(ctx) {
    if (!this.documentChunkService) {
      const systemSettingService = getSystemSettingService(this.db);
      this.documentChunkService = new DocumentChunkService(this.db, {
        getDocPipelineConfig: async () => {
          const records = await systemSettingService.SystemSetting.findAll({
            where: { setting_key: DOC_PIPELINE_KEYS.map(k => `doc_pipeline.${k}`) },
            raw: true,
          });
          const stored = {};
          for (const record of records) {
            const stageKey = record.setting_key.replace('doc_pipeline.', '');
            try {
              stored[stageKey] = JSON.parse(record.setting_value);
            } catch {
              stored[stageKey] = null;
            }
          }
          return mergeWithDefaults(stored);
        },
      });
    }
  }

  /**
   * 获取文档列表
   * GET /api/docs/documents
   */
  async listDocuments(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const userId = ctx.state.session.id;
      const { page = 1, page_size = 20, doc_type, collection_id, processing_status, keyword } = ctx.query;
      const size = parseInt(page_size);

      const where = {
        ...await this.docAccessService.buildAccessFilter(userId),
      };
      if (doc_type) where.doc_type = doc_type;
      if (collection_id) where.collection_id = collection_id;
      if (processing_status) where.processing_status = processing_status;
      if (keyword) where.title = { [Op.like]: `%${keyword}%` };

      const { count, rows } = await this.models.DocDocument.findAndCountAll({
        where,
        attributes: [
          'id',
          'doc_type',
          'title',
          'collection_id',
          'current_revision_id',
          'processing_status',
          'created_at',
          'updated_at',
          'metadata',
        ],
        order: [['updated_at', 'DESC']],
        offset: (page - 1) * size,
        limit: size,
      });

      const DocVersion = this.db.getModel('document_revision');
      const DocOcrResult = this.db.getModel('doc_ocr_result');
      const Attachment = this.db.getModel('attachment');

      const enrichedRows = await Promise.all(rows.map(async (row) => {
        const doc = row.toJSON ? row.toJSON() : row;
        const currentRevision = doc.current_revision_id
          ? await DocVersion.findByPk(doc.current_revision_id, {
            attributes: ['id', 'revision_no', 'revision_label'],
            raw: true,
          })
          : null;

        const latestOcrResult = await DocOcrResult.findOne({
          where: { document_id: doc.id },
          attributes: ['id', 'task_id', 'status', 'progress', 'main_markdown_attachment_id', 'error_message', 'updated_at', 'metadata', 'created_at'],
          order: [['created_at', 'DESC']],
          raw: true,
        });

        const hasPreview = hasPreviewResult(latestOcrResult);

        const sourceAttachment = doc.current_revision_id
          ? await Attachment.findOne({
            where: { source_tag: 'doc-platform', source_id: doc.current_revision_id },
            attributes: ['id', 'file_name', 'mime_type', 'file_size', 'created_at'],
            order: [['created_at', 'ASC']],
            raw: true,
          })
          : null;

        return {
          ...doc,
          current_revision: currentRevision,
          source_attachment: sourceAttachment,
          ocr_task_id: latestOcrResult?.task_id || null,
          has_preview_result: hasPreview,
          ocr_status: latestOcrResult?.status || null,
          ocr_progress: typeof latestOcrResult?.progress === 'number' ? latestOcrResult.progress : null,
          ocr_error_message: latestOcrResult?.error_message || null,
        };
      }));

      ctx.success(buildPaginatedResponse({ count, rows: enrichedRows }, { page: parseInt(page), pageSize: size }, startTime));
      logger.info(`[Doc] listDocuments: ${enrichedRows.length} results, ${Date.now() - startTime}ms`);
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
      this.ensureDocAccessService();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canRead = await this.docAccessService.canRead(documentId, userId);
      if (!canRead) ctx.throw(403, 'Access denied');

      const document = await this.models.DocDocument.findOne({
        where: { id: documentId },
        include: [{
          model: this.models.DocVersion,
          as: 'document_revisions',
          attributes: ['id', 'revision_no', 'revision_label', 'revision_status', 'is_current', 'effective_from', 'effective_to', 'created_at'],
          order: [['revision_no', 'DESC']],
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
   * 获取文档结果详情（阶段一：上传->OCR->预览）
   * GET /api/docs/documents/:documentId/result
   */
  async getDocumentResult(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canRead = await this.docAccessService.canRead(documentId, userId);
      if (!canRead) ctx.throw(403, 'Access denied');

      const DocumentRevision = this.db.getModel('document_revision');
      const Attachment = this.db.getModel('attachment');
      const DocOcrResult = this.db.getModel('doc_ocr_result');
      const DocOcrImage = this.db.getModel('doc_ocr_image');
      const User = this.db.getModel('user');

      const document = await this.models.DocDocument.findOne({
        where: { id: documentId },
        attributes: [
          'id',
          'title',
          'doc_type',
          'source_system',
          'source_ref_id',
          'collection_id',
          'current_revision_id',
          'processing_status',
          'processing_error_code',
          'processing_error_message',
          'created_at',
          'updated_at',
          'metadata',
        ],
        raw: true,
      });

      if (!document) ctx.throw(404, 'Document not found');

      const revision = document.current_revision_id
        ? await DocumentRevision.findByPk(document.current_revision_id, {
          attributes: ['id', 'document_id', 'revision_no', 'revision_label', 'revision_status', 'created_by', 'created_at'],
          raw: true,
        })
        : null;

      const uploader = revision?.created_by
        ? await User.findOne({
          where: { id: revision.created_by },
          attributes: ['id', 'username'],
          raw: true,
        })
        : null;

      const sourceAttachment = revision?.id
        ? await Attachment.findOne({
          where: { source_tag: 'doc-platform', source_id: revision.id },
          attributes: ['id', 'file_name', 'mime_type', 'file_size', 'access_level', 'source_tag', 'source_id', 'created_by', 'created_at'],
          order: [['created_at', 'ASC']],
          raw: true,
        })
        : null;

      const latestOcrResult = await DocOcrResult.findOne({
        where: { document_id: documentId },
        order: [['created_at', 'DESC']],
        raw: true,
      });

      const previewAttachmentId = getPreviewAttachmentId(latestOcrResult);
      const ocrMetadata = parseOcrMetadata(latestOcrResult?.metadata);
      const attachmentIds = [
        previewAttachmentId,
        latestOcrResult?.raw_result_attachment_id,
        latestOcrResult?.deliverables_manifest_attachment_id,
        latestOcrResult?.image_manifest_attachment_id,
        ocrMetadata?.cleaned_markdown_attachment_id,
      ].filter(Boolean);

      const resultAttachments = attachmentIds.length > 0
        ? await Attachment.findAll({
          where: { id: { [Op.in]: attachmentIds } },
          attributes: ['id', 'file_name', 'mime_type', 'file_size', 'access_level', 'source_tag', 'source_id', 'created_at'],
          raw: true,
        })
        : [];

      const ocrImages = latestOcrResult?.id
        ? await DocOcrImage.findAll({
          where: { ocr_result_id: latestOcrResult.id },
          attributes: ['id', 'attachment_id', 'filename', 'media_type', 'sort_order', 'alt_text', 'description', 'markdown_path', 'referenced_in_markdown', 'line_number'],
          order: [['sort_order', 'ASC']],
          raw: true,
        })
        : [];

      const imageAttachmentIds = [...new Set(ocrImages.map(item => item.attachment_id).filter(Boolean))];
      const imageAttachments = imageAttachmentIds.length > 0
        ? await Attachment.findAll({
          where: { id: { [Op.in]: imageAttachmentIds } },
          attributes: ['id', 'file_name', 'mime_type', 'file_size', 'access_level', 'source_tag', 'source_id', 'created_at'],
          raw: true,
        })
        : [];

      const resultAttachmentMap = new Map(resultAttachments.map(item => [item.id, item]));
      const imageAttachmentMap = new Map(imageAttachments.map(item => [item.id, item]));
      const allAttachmentMap = new Map([
        ...(sourceAttachment ? [[sourceAttachment.id, sourceAttachment]] : []),
        ...resultAttachments.map(item => [item.id, item]),
        ...imageAttachments.map(item => [item.id, item]),
      ]);

      const allAttachments = [
        sourceAttachment,
        ...(attachmentIds.map(id => resultAttachmentMap.get(id)).filter(Boolean)),
        ...(imageAttachments),
      ].filter(Boolean);

      const sourceGroups = new Map();
      for (const att of allAttachments) {
        if (att.access_level !== 'public') {
          const key = `${att.source_tag}:${att.source_id}`;
          if (!sourceGroups.has(key)) {
            sourceGroups.set(key, { sourceTag: att.source_tag, sourceId: att.source_id, attachments: [] });
          }
          sourceGroups.get(key).attachments.push(att);
        }
      }

      const tokenCache = new Map();
      for (const [key, group] of sourceGroups) {
        try {
          const tokenResult = await this.attachmentService.generateToken(group.sourceTag, group.sourceId, userId);
          tokenCache.set(key, tokenResult);
        } catch (err) {
          logger.warn(`[Doc] Failed to generate token for ${key}:`, err.message);
        }
      }

      const buildAttachmentResponse = (attachmentId) => {
        const attachment = attachmentId ? allAttachmentMap.get(attachmentId) : null;
        if (!attachment) return null;

        const accessLevel = attachment.access_level || 'private';
        let previewUrl = null;
        let downloadUrl = null;

        if (accessLevel === 'public') {
          previewUrl = `/attach/public/${attachment.id}`;
          downloadUrl = `/attach/public/${attachment.id}`;
        } else {
          const key = `${attachment.source_tag}:${attachment.source_id}`;
          const tokenResult = tokenCache.get(key);
          if (tokenResult) {
            previewUrl = `/attach/t/${tokenResult.token}/${attachment.id}`;
            downloadUrl = `/attach/t/${tokenResult.token}/${attachment.id}`;
          }
        }

        return {
          ...attachment,
          access_level: accessLevel,
          preview_url: previewUrl,
          download_url: downloadUrl,
          requires_auth: !previewUrl,
        };
      };

      const hasPreview = hasPreviewResult(latestOcrResult);

      ctx.success({
        document: {
          ...document,
          has_preview_result: hasPreview,
        },
        revision: revision ? {
          ...revision,
          uploader: uploader ? {
            id: uploader.id,
            username: uploader.username,
          } : null,
        } : null,
        source_attachment: buildAttachmentResponse(sourceAttachment?.id),
        processing: {
          status: document.processing_status,
          error_code: document.processing_error_code,
          error_message: document.processing_error_message,
          updated_at: document.processing_updated_at,
        },
        ocr_result: latestOcrResult ? {
          id: latestOcrResult.id,
          task_id: latestOcrResult.task_id,
          status: latestOcrResult.status,
          progress: latestOcrResult.progress,
          image_count: latestOcrResult.image_count,
          line_count: latestOcrResult.line_count,
          started_at: latestOcrResult.started_at,
          completed_at: latestOcrResult.completed_at,
          error_code: latestOcrResult.error_code,
          error_message: latestOcrResult.error_message,
          cleaned_markdown_attachment: buildAttachmentResponse(ocrMetadata?.cleaned_markdown_attachment_id),
          main_markdown_attachment: buildAttachmentResponse(latestOcrResult.main_markdown_attachment_id),
          raw_result_attachment: buildAttachmentResponse(latestOcrResult.raw_result_attachment_id),
          deliverables_manifest_attachment: buildAttachmentResponse(latestOcrResult.deliverables_manifest_attachment_id),
          image_manifest_attachment: buildAttachmentResponse(latestOcrResult.image_manifest_attachment_id),
        } : null,
        image_attachments: ocrImages.map((item) => ({
          ...item,
          attachment: buildAttachmentResponse(item.attachment_id),
        })),
      });
    } catch (error) {
      logger.error('[Doc] getDocumentResult error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 获取版本列表
   * GET /api/docs/documents/:documentId/revisions
   */
  async listVersions(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canRead = await this.docAccessService.canRead(documentId, userId);
      if (!canRead) ctx.throw(403, 'Access denied');

      const document = await this.models.DocDocument.findOne({
        where: { id: documentId },
        attributes: ['id', 'current_revision_id'],
      });

      const versions = await this.models.DocVersion.findAll({
        where: { document_id: documentId },
        order: [['revision_no', 'DESC']],
      });

      ctx.success({
        document_id: document.id,
        current_revision_id: document.current_revision_id,
        items: versions,
      });
    } catch (error) {
      logger.error('[Doc] listVersions error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 获取内容块列表（扁平有序）
   * GET /api/docs/documents/:documentId/revisions/:revisionId/content-tree
   */
  async getContentTree(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { documentId, revisionId } = ctx.params;
      const userId = ctx.state.session.id;

      const canRead = await this.docAccessService.canRead(documentId, userId);
      if (!canRead) ctx.throw(403, 'Access denied');

      const version = await this.models.DocVersion.findOne({
        where: { id: revisionId, document_id: documentId },
      });
      if (!version) ctx.throw(404, 'Version not found for this document');

      const chunks = await this.models.DocChunk.findAll({
        where: { revision_id: revisionId },
        order: [['seq', 'ASC']],
        attributes: ['id', 'outline_id', 'title', 'content', 'seq', 'from_line', 'to_line', 'text_hash', 'byte_count', 'token_count', 'embedding_status'],
      });

      ctx.success(chunks);
    } catch (error) {
      logger.error('[Doc] getContentTree error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async createDocument(ctx) {
    try {
      this.ensureModels();
      this.ensureCollectionAccessService();
      const userId = ctx.state.session.id;
      const { doc_type, title, collection_id, source_system = 'doc_platform', source_ref_id, metadata } = ctx.request.body;

      if (!title || !doc_type) {
        ctx.throw(400, 'title and doc_type are required');
      }
      if (!collection_id) {
        ctx.throw(400, 'collection_id is required');
      }

      const canWriteCollection = await this.collectionAccessService.canWrite(collection_id, userId);
      if (!canWriteCollection) ctx.throw(403, 'Only the owner can create document in this collection');

      const docId = Utils.newID();
      const document = await this.models.DocDocument.create({
        id: docId,
        doc_type,
        source_system,
        source_ref_id: source_ref_id || docId,
        title,
        collection_id,
        processing_status: 'ready',
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
      this.ensureDocAccessService();
      this.ensureCollectionAccessService();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.docAccessService.canWrite(documentId, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

      const { title, collection_id, metadata } = ctx.request.body;
      const document = await this.models.DocDocument.findOne({ where: { id: documentId } });
      if (!document) ctx.throw(404, 'Document not found');

      if (title) document.title = title;
      if (collection_id && collection_id !== document.collection_id) {
        const canWriteTarget = await this.collectionAccessService.canWrite(collection_id, userId);
        if (!canWriteTarget) ctx.throw(403, 'Only the owner can move document to target collection');

        if (document.collection_id) {
          const canWriteSource = await this.collectionAccessService.canWrite(document.collection_id, userId);
          if (!canWriteSource) ctx.throw(403, 'Only the source collection owner can move this document');
        }
        document.collection_id = collection_id;
      }
      if (metadata) document.metadata = metadata;
      document.updated_at = new Date();

      await document.save();

      ctx.success(document);
    } catch (error) {
      logger.error('[Doc] updateDocument error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async deleteDocument(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      this.ensureDocumentOcrService(ctx);
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.docAccessService.canWrite(documentId, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

      const DocumentRevision = this.db.getModel('document_revision');
      const DocumentChunk = this.db.getModel('document_chunk');
      const DocOcrResult = this.db.getModel('doc_ocr_result');
      const DocOcrImage = this.db.getModel('doc_ocr_image');
      const Attachment = this.db.getModel('attachment');
      const DocCompareRun = this.db.getModel('doc_compare_run');
      const DocCompareItem = this.db.getModel('doc_compare_item');
      const DocDocumentTag = this.db.getModel('doc_document_tag');

      const document = await this.models.DocDocument.findOne({
        where: { id: documentId },
        attributes: ['id', 'processing_status'],
      });
      if (!document) ctx.throw(404, 'Document not found');

      if (['pending_ocr', 'ocr_processing'].includes(document.processing_status)) {
        await document.update({
          processing_status: 'error',
          processing_error_code: 'document_deleted',
          processing_error_message: 'Document deleted by user',
          processing_updated_at: new Date(),
        });
      }

      try {
        await this.documentOcrService.cancelTask(documentId);
      } catch (error) {
        logger.warn(`[Doc] deleteDocument cancelTask failed for ${documentId}: ${error.message}`);
      }

      const revisions = await DocumentRevision.findAll({
        where: { document_id: documentId },
        attributes: ['id'],
        raw: true,
      });
      const revisionIds = revisions.map(item => item.id);

      const ocrResults = await DocOcrResult.findAll({
        where: { document_id: documentId },
        attributes: ['id', 'main_markdown_attachment_id', 'raw_result_attachment_id', 'deliverables_manifest_attachment_id', 'image_manifest_attachment_id'],
        raw: true,
      });
      const ocrResultIds = ocrResults.map(item => item.id);

      const ocrImages = ocrResultIds.length > 0
        ? await DocOcrImage.findAll({
          where: { ocr_result_id: { [Op.in]: ocrResultIds } },
          attributes: ['attachment_id'],
          raw: true,
        })
        : [];

      const attachmentIds = new Set();
      for (const result of ocrResults) {
        [result.main_markdown_attachment_id, result.raw_result_attachment_id, result.deliverables_manifest_attachment_id, result.image_manifest_attachment_id]
          .filter(Boolean)
          .forEach(id => attachmentIds.add(id));
      }
      ocrImages.forEach(item => {
        if (item.attachment_id) attachmentIds.add(item.attachment_id);
      });

      if (revisionIds.length > 0) {
        const sourceAttachments = await Attachment.findAll({
          where: {
            source_tag: 'doc-platform',
            source_id: { [Op.in]: revisionIds },
          },
          attributes: ['id'],
          raw: true,
        });
        sourceAttachments.forEach(item => attachmentIds.add(item.id));
      }

      const attachmentRows = attachmentIds.size > 0
        ? await Attachment.findAll({
          where: { id: { [Op.in]: [...attachmentIds] } },
          attributes: ['id', 'file_path'],
          raw: true,
        })
        : [];

      const compareRuns = await DocCompareRun.findAll({
        where: { document_id: documentId },
        attributes: ['id'],
        raw: true,
      });
      const compareRunIds = compareRuns.map(item => item.id);

      await this.db.sequelize.transaction(async (t) => {
        await this.models.DocDocument.update(
          { current_revision_id: null },
          { where: { id: documentId }, transaction: t }
        );

        if (compareRunIds.length > 0) {
          await DocCompareItem.destroy({ where: { compare_run_id: { [Op.in]: compareRunIds } }, transaction: t });
          await DocCompareRun.destroy({ where: { id: { [Op.in]: compareRunIds } }, transaction: t });
        }

        if (ocrResultIds.length > 0) {
          await DocOcrImage.destroy({ where: { ocr_result_id: { [Op.in]: ocrResultIds } }, transaction: t });
          await DocOcrResult.destroy({ where: { id: { [Op.in]: ocrResultIds } }, transaction: t });
        }

        if (revisionIds.length > 0) {
          await DocumentChunk.destroy({ where: { revision_id: { [Op.in]: revisionIds } }, transaction: t });
          await DocumentRevision.destroy({ where: { id: { [Op.in]: revisionIds } }, transaction: t });
        }

        await DocDocumentTag.destroy({ where: { document_id: documentId }, transaction: t });

        if (attachmentIds.size > 0) {
          await Attachment.destroy({ where: { id: { [Op.in]: [...attachmentIds] } }, transaction: t });
        }

        await this.models.DocDocument.destroy({ where: { id: documentId }, transaction: t });
      });

      for (const attachment of attachmentRows) {
        const fullPath = attachment.file_path
          ? path.join(this.attachmentService.getAttachmentBasePath(), attachment.file_path)
          : null;
        if (!fullPath) continue;
        try {
          await fs.unlink(fullPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            logger.warn(`[Doc] deleteDocument unlink failed: ${fullPath}`, error.message);
          }
        }
      }

      ctx.success({ deleted: true, document_id: documentId });
      logger.info(`[Doc] deleteDocument: ${documentId}`);
    } catch (error) {
      logger.error('[Doc] deleteDocument error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

async createVersion(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.docAccessService.canWrite(documentId, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

       const { revision_label, change_summary, chunks: chunksInput, content_units } = ctx.request.body;
       const chunks = chunksInput || content_units;
      const document = await this.models.DocDocument.findOne({ where: { id: documentId } });
      if (!document) ctx.throw(404, 'Document not found');

      const maxVersion = await this.models.DocVersion.findOne({
        where: { document_id: documentId },
        order: [['revision_no', 'DESC']],
      });
      const revisionNo = maxVersion ? maxVersion.revision_no + 1 : 1;
      const versionId = Utils.newID();

      await this.db.sequelize.transaction(async (t) => {
        await this.models.DocVersion.create({
          id: versionId,
          document_id: documentId,
          revision_no: revisionNo,
          revision_label: revision_label || `v${revisionNo}`,
          revision_status: 'draft',
          is_current: 0,
          change_summary: change_summary || null,
          created_by: userId,
        }, { transaction: t });

        if (chunks && Array.isArray(chunks) && chunks.length > 0) {
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            await this.models.DocChunk.create({
              id: Utils.newID(),
              revision_id: versionId,
              outline_id: chunk.outline_id || null,
              title: chunk.title || null,
              content: chunk.content || null,
              seq: chunk.seq ?? i,
              from_line: chunk.from_line ?? null,
              to_line: chunk.to_line ?? null,
              text_hash: chunk.text_hash || null,
              byte_count: chunk.byte_count ?? null,
              token_count: chunk.token_count || null,
            }, { transaction: t });
          }
        }
      });

      const version = await this.models.DocVersion.findByPk(versionId);
      ctx.success(version);
      logger.info(`[Doc] createVersion: ${versionId} for ${documentId}, ${chunks?.length || 0} chunks`);
    } catch (error) {
      logger.error('[Doc] createVersion error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async setCurrentVersion(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { revisionId } = ctx.params;
      const userId = ctx.state.session.id;

      const version = await this.models.DocVersion.findOne({
        where: { id: revisionId },
      });
      if (!version) ctx.throw(404, 'Revision not found');

      const documentId = version.document_id;
      const canWrite = await this.docAccessService.canWrite(documentId, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

      const document = await this.models.DocDocument.findOne({ where: { id: documentId } });
      if (!document) ctx.throw(404, 'Document not found');

      this.validateTransition(version.revision_status, 'effective');

      await this.db.sequelize.transaction(async (t) => {
        const rows = await this.db.sequelize.query(
          'SELECT id, current_revision_id FROM documents WHERE id = ? FOR UPDATE',
          { replacements: [documentId], type: this.db.sequelize.QueryTypes.SELECT, transaction: t }
        );
        if (!rows || rows.length === 0) {
          throw new Error('Document not found');
        }

        const currentRevisionId = rows[0].current_revision_id;
        if (currentRevisionId === revisionId) {
          return;
        }

        await this.models.DocVersion.update(
          { is_current: 0 },
          { where: { document_id: documentId }, transaction: t }
        );

        version.is_current = 1;
        version.revision_status = 'effective';
        await version.save({ transaction: t });

        await this.models.DocDocument.update(
          { current_revision_id: revisionId },
          { where: { id: documentId }, transaction: t }
        );
      });

      await document.reload();
      ctx.success({
        document_id: documentId,
        current_revision_id: revisionId,
      });
      logger.info(`[Doc] setCurrentVersion: ${revisionId} for ${documentId}`);
    } catch (error) {
      logger.error('[Doc] setCurrentVersion error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async transitionVersionStatus(ctx) {
    try {
      this.ensureModels();
      const { revisionId } = ctx.params;
      const { to_status } = ctx.request.body;

      if (!to_status) ctx.throw(400, 'to_status is required');

      const version = await this.models.DocVersion.findOne({
        where: { id: revisionId },
      });
      if (!version) ctx.throw(404, 'Revision not found');

      this.validateTransition(version.revision_status, to_status);

      const updates = { revision_status: to_status };
      if (to_status === 'approved') {
        updates.approved_at = new Date();
        updates.approved_by = ctx.state.session.id;
      }
      if (to_status === 'expired') {
        updates.effective_to = new Date();
      }

      await version.update(updates);
      ctx.success(version);
      logger.info(`[Doc] transitionVersionStatus: ${revisionId} ${version.revision_status} → ${to_status}`);
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
      this.ensureDocAccessService();
      const userId = ctx.state.session.id;
      const { document_id, base_version_id, target_version_id } = ctx.request.body;

      if (!document_id || !base_version_id || !target_version_id) {
        ctx.throw(400, 'document_id, base_version_id and target_version_id are required');
      }

      const canWrite = await this.docAccessService.canWrite(document_id, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

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
      this.ensureDocAccessService();
      const { runId } = ctx.params;
      const userId = ctx.state.session.id;

      const run = await this.models.DocCompareRun.findOne({
        where: { id: runId },
        include: [{
          model: this.models.DocCompareItem,
          as: 'items',
        }],
      });

      if (!run) ctx.throw(404, 'Compare run not found');

      const canRead = await this.docAccessService.canRead(run.document_id, userId);
      if (!canRead) ctx.throw(403, 'Access denied');

      ctx.success(run);
    } catch (error) {
      logger.error('[Doc] getCompareRun error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 处理失败重试映射
   * 优先按 error_code 精确回到失败阶段；未知错误再回退到 pending_ocr。
   */
  PROCESSING_RETRY_ERROR_STAGE = {
    ocr_failed: 'pending_ocr',
    clean_failed: 'pending_clean',
    outline_extraction_failed: 'pending_outline',
    chunk_generation_failed: 'pending_chunk',
    embedding_failed: 'pending_embedding',
  };

  /**
   * 查询文档处理状态
   * GET /api/docs/documents/:documentId/processing
   */
  async getProcessingStatus(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canRead = await this.docAccessService.canRead(documentId, userId);
      if (!canRead) ctx.throw(403, 'Access denied');

      const document = await this.models.DocDocument.findOne({
        where: { id: documentId },
        attributes: ['id', 'processing_status', 'processing_error_code', 'processing_error_message', 'processing_retry_count', 'processing_updated_at'],
      });
      if (!document) ctx.throw(404, 'Document not found');

      const DocOcrResult = this.db.getModel('doc_ocr_result');
      const latestOcrResult = await DocOcrResult.findOne({
        where: { document_id: documentId },
        order: [['created_at', 'DESC']],
        raw: true,
      });

      const hasPreview = hasPreviewResult(latestOcrResult);

      ctx.success({
        document_id: document.id,
        processing_status: document.processing_status,
        processing_error_code: document.processing_error_code,
        processing_error_message: document.processing_error_message,
        processing_retry_count: document.processing_retry_count,
        processing_updated_at: document.processing_updated_at,
        ocr_result: latestOcrResult ? {
          id: latestOcrResult.id,
          revision_id: latestOcrResult.revision_id,
          task_id: latestOcrResult.task_id,
          status: latestOcrResult.status,
          progress: latestOcrResult.progress,
          image_count: latestOcrResult.image_count,
          main_markdown_attachment_id: latestOcrResult.main_markdown_attachment_id,
          raw_result_attachment_id: latestOcrResult.raw_result_attachment_id,
          deliverables_manifest_attachment_id: latestOcrResult.deliverables_manifest_attachment_id,
          image_manifest_attachment_id: latestOcrResult.image_manifest_attachment_id,
          line_count: latestOcrResult.line_count,
          error_code: latestOcrResult.error_code,
          error_message: latestOcrResult.error_message,
          started_at: latestOcrResult.started_at,
          completed_at: latestOcrResult.completed_at,
          has_preview_result: hasPreview,
        } : null,
      });
    } catch (error) {
      logger.error('[Doc] getProcessingStatus error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 重试失败阶段
   * POST /api/docs/documents/:documentId/retry
   */
  async retryProcessing(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.docAccessService.canWrite(documentId, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

      const document = await this.models.DocDocument.findOne({ where: { id: documentId } });
      if (!document) ctx.throw(404, 'Document not found');

      if (document.processing_status !== 'error') {
        ctx.throw(400, 'Only documents in error state can be retried');
      }

      const retryStage = this.PROCESSING_RETRY_ERROR_STAGE[document.processing_error_code] || 'pending_ocr';

      await document.update({
        processing_status: retryStage,
        processing_error_code: null,
        processing_error_message: null,
        processing_retry_count: document.processing_retry_count + 1,
        processing_updated_at: new Date(),
      });

      ctx.success({
        document_id: document.id,
        processing_status: retryStage,
      });
      logger.info(`[Doc] retryProcessing: ${documentId} → ${retryStage} (retry #${document.processing_retry_count + 1})`);
    } catch (error) {
      logger.error('[Doc] retryProcessing error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 提交文档 OCR 任务
   * POST /api/docs/documents/:documentId/ocr/submit
   */
  async submitOcr(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      this.ensureDocumentOcrService(ctx);
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.docAccessService.canWrite(documentId, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

      const { attachment_id, backend, lang, image_analysis, formula_enable, table_enable } = ctx.request.body || {};
      const ocrResult = await this.documentOcrService.submit(documentId, {
        attachmentId: attachment_id || null,
        userId,
        backend,
        lang,
        imageAnalysis: image_analysis,
        formulaEnable: formula_enable,
        tableEnable: table_enable,
      });

      ctx.success({
        document_id: documentId,
        ocr_result_id: ocrResult.id,
        task_id: ocrResult.task_id,
        status: ocrResult.status,
        progress: ocrResult.progress,
      });
    } catch (error) {
      logger.error('[Doc] submitOcr error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 同步 OCR 任务状态
   * POST /api/docs/documents/:documentId/ocr/sync
   */
  async syncOcr(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      this.ensureDocumentOcrService(ctx);
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canWrite = await this.docAccessService.canWrite(documentId, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

      const result = await this.documentOcrService.syncTaskStatus(documentId);
      ctx.success({
        document_id: documentId,
        ocr_result_id: result.ocrResult.id,
        status: result.ocrResult.status,
        progress: result.ocrResult.progress,
        completed: result.completed,
      });
    } catch (error) {
      const normalized = this.documentOcrService?.normalizeError
        ? this.documentOcrService.normalizeError(error)
        : { status: error?.status || 500, message: error?.message || String(error), summary: null };
      logger.error('[Doc] syncOcr error:', normalized.summary || normalized.message);
      ctx.throw(normalized.status || 500, normalized.message);
    }
  }

  /**
   * 提取章节大纲
   * POST /api/docs/revisions/:revisionId/outline/extract
   */
  async extractOutline(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      this.ensureDocumentOutlineService(ctx);
      const { revisionId } = ctx.params;
      const userId = ctx.state.session.id;

      const revision = await this.models.DocVersion.findOne({
        where: { id: revisionId },
        attributes: ['id', 'document_id'],
      });
      if (!revision) ctx.throw(404, 'Revision not found');

      const document = await this.models.DocDocument.findOne({
        where: { id: revision.document_id },
        attributes: ['id', 'processing_status'],
      });
      if (!document) ctx.throw(404, 'Document not found');

      const validStates = ['pending_outline', 'error'];
      if (!validStates.includes(document.processing_status)) {
        ctx.throw(400, `Document must be in pending_outline or error state (current: ${document.processing_status})`);
      }

      const canWrite = await this.docAccessService.canWrite(revision.document_id, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

      const result = await this.documentOutlineService.extract(revisionId, {
        initiatedByType: 'user',
        initiatedById: userId,
      });
      ctx.success({
        revision_id: revisionId,
        document_id: revision.document_id,
        outline_count: result.outline_count,
        processing_status: 'pending_chunk',
        partial: result.partial || false,
        failed_chunks: result.failed_chunks || 0,
        total_chunks: result.total_chunks || 1,
      });
    } catch (error) {
      logger.error('[Doc] extractOutline error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 生成文本分块
   * POST /api/docs/revisions/:revisionId/chunks/generate
   */
  async generateChunks(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      this.ensureDocumentChunkService(ctx);
      const { revisionId } = ctx.params;
      const userId = ctx.state.session.id;

      const revision = await this.models.DocVersion.findOne({
        where: { id: revisionId },
        attributes: ['id', 'document_id'],
      });
      if (!revision) ctx.throw(404, 'Revision not found');

      const document = await this.models.DocDocument.findOne({
        where: { id: revision.document_id },
        attributes: ['id', 'processing_status'],
      });
      if (!document) ctx.throw(404, 'Document not found');

      const validStates = ['pending_chunk', 'error'];
      if (!validStates.includes(document.processing_status)) {
        ctx.throw(400, `Document must be in pending_chunk or error state (current: ${document.processing_status})`);
      }

      const canWrite = await this.docAccessService.canWrite(revision.document_id, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

      const result = await this.documentChunkService.generate(revisionId, {
        initiatedByType: 'user',
        initiatedById: userId,
      });
      ctx.success({
        revision_id: revisionId,
        document_id: revision.document_id,
        chunk_count: result.chunk_count,
        outline_count: result.outline_count,
        processing_status: 'pending_embedding',
      });
    } catch (error) {
      logger.error('[Doc] generateChunks error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 查询版本差异状态
   * GET /api/docs/revisions/:revisionId/diff-status
   */
  async getDiffStatus(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { revisionId } = ctx.params;
      const userId = ctx.state.session.id;

      const revision = await this.models.DocVersion.findOne({
        where: { id: revisionId },
        attributes: ['id', 'document_id', 'revision_no', 'diff_status', 'updated_at'],
      });
      if (!revision) ctx.throw(404, 'Revision not found');

      const canRead = await this.docAccessService.canRead(revision.document_id, userId);
      if (!canRead) ctx.throw(403, 'Access denied');

      ctx.success({
        revision_id: revision.id,
        document_id: revision.document_id,
        revision_no: revision.revision_no,
        diff_status: revision.diff_status,
        updated_at: revision.updated_at,
      });
    } catch (error) {
      logger.error('[Doc] getDiffStatus error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 查询文档权限
   * GET /api/docs/documents/:documentId/permissions
   */
  async getDocumentPermissions(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;

      const canView = await this.docAccessService.canRead(documentId, userId);
      if (!canView) ctx.throw(403, 'Access denied');

      const canWrite = await this.docAccessService.canWrite(documentId, userId);

      const document = await this.models.DocDocument.findOne({
        where: { id: documentId },
        attributes: ['processing_status'],
      });

      ctx.success({
        can_view: true,
        can_retry_processing: canWrite && document && document.processing_status === 'error',
        can_set_current_revision: canWrite,
        can_relocate: canWrite,
      });
    } catch (error) {
      logger.error('[Doc] getDocumentPermissions error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 迁移文档集合
   * POST /api/docs/documents/:documentId/relocate
   */
  async relocateDocument(ctx) {
    try {
      this.ensureModels();
      this.ensureDocAccessService();
      const { documentId } = ctx.params;
      const userId = ctx.state.session.id;
      const { target_collection_id } = ctx.request.body;

      if (!target_collection_id) ctx.throw(400, 'target_collection_id is required');

      const canWrite = await this.docAccessService.canWrite(documentId, userId);
      if (!canWrite) ctx.throw(403, 'Write access denied');

      const DocumentCollection = this.db.getModel('document_collection');
      const targetCollection = await DocumentCollection.findByPk(target_collection_id);
      if (!targetCollection) ctx.throw(404, 'Target collection not found');

      const collectionAccess = new CollectionAccessService(this.db);
      const canAccessTarget = await collectionAccess.canWrite(target_collection_id, userId);
      if (!canAccessTarget) ctx.throw(403, 'Only the target collection owner can accept relocated documents');

      const document = await this.models.DocDocument.findOne({ where: { id: documentId } });
      if (!document) ctx.throw(404, 'Document not found');

      if (document.collection_id === target_collection_id) {
        ctx.throw(400, 'Document already belongs to target collection');
      }

      await document.update({
        collection_id: target_collection_id,
        updated_at: new Date(),
      });

      ctx.success({
        document_id: document.id,
        collection_id: target_collection_id,
      });
      logger.info(`[Doc] relocateDocument: ${documentId} → collection ${target_collection_id}`);
    } catch (error) {
      logger.error('[Doc] relocateDocument error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 创建文档接入记录
   * POST /api/docs/intakes
   */
  async createIntake(ctx) {
    try {
      this.ensureModels();
      const userId = ctx.state.session.id;
      const { app_id, collection_id, schema_id, attachments } = ctx.request.body;

      if (!app_id) ctx.throw(400, 'app_id is required');
      if (!collection_id) ctx.throw(400, 'collection_id is required');

      const DocumentCollection = this.db.getModel('document_collection');
      const collection = await DocumentCollection.findByPk(collection_id);
      if (!collection) ctx.throw(404, 'Collection not found');

      const collectionAccess = new CollectionAccessService(this.db);
      const canWrite = await collectionAccess.canWrite(collection_id, userId);
      if (!canWrite) ctx.throw(403, 'Only the collection owner can create intake documents');

      const attachmentList = Array.isArray(attachments) ? attachments : [];
      const attachmentIds = attachmentList.map(item => item?.id).filter(Boolean);
      const uniqueAttachmentIds = [...new Set(attachmentIds)];
      if (attachmentList.length > 0 && attachmentIds.length !== attachmentList.length) {
        ctx.throw(400, 'attachments must contain valid attachment ids');
      }

      if (uniqueAttachmentIds.length > 0) {
        const Attachment = this.db.getModel('attachment');
        const attachmentRows = await Attachment.findAll({
          where: { id: uniqueAttachmentIds },
          attributes: ['id', 'created_by'],
          raw: true,
        });

        if (attachmentRows.length !== uniqueAttachmentIds.length) {
          ctx.throw(404, 'One or more attachments not found');
        }

        const deniedAttachment = attachmentRows.find(item => item.created_by !== userId);
        if (deniedAttachment) {
          ctx.throw(403, 'Attachment access denied');
        }
      }

      const sourceRefId = Utils.newID();
      const firstAttachment = attachmentList.length > 0 ? attachmentList[0] : null;
      const intakeMetadata = JSON.stringify({
        app_id,
        schema_id: schema_id || null,
        attachments: attachmentList,
      });

      const documentId = Utils.newID();
      const revisionId = Utils.newID();
      const document = await this.db.sequelize.transaction(async (t) => {
        const createdDocument = await this.models.DocDocument.create({
          id: documentId,
          collection_id,
          doc_type: app_id.startsWith('contract') ? 'contract' : 'knowledge',
          source_system: app_id,
          source_ref_id: sourceRefId,
          title: firstAttachment ? `Intake ${sourceRefId}` : `Document ${sourceRefId}`,
          processing_status: 'pending_ocr',
            current_revision_id: null,
          metadata: intakeMetadata,
        }, { transaction: t });

        await this.models.DocVersion.create({
          id: revisionId,
          document_id: documentId,
          revision_no: 1,
          revision_label: 'v1',
          revision_status: 'draft',
          is_current: 1,
          change_summary: 'Initial intake revision',
          created_by: userId,
        }, { transaction: t });

          await createdDocument.update({
            current_revision_id: revisionId,
          }, { transaction: t });

        if (attachmentList.length > 0) {
          const Attachment = this.db.getModel('attachment');
          for (const item of attachmentList) {
            if (!item?.id) continue;
            await Attachment.update({
              source_tag: 'doc-platform',
              source_id: revisionId,
            }, {
              where: { id: item.id },
              transaction: t,
            });
          }
        }

        return createdDocument;
      });

      ctx.success({
        document_id: document.id,
        revision_id: revisionId,
        processing_status: document.processing_status,
        source_ref_id: sourceRefId,
        attachment_count: attachmentList.length,
      });
      logger.info(`[Doc] createIntake: ${document.id} for app ${app_id}, collection ${collection_id}`);
    } catch (error) {
      logger.error('[Doc] createIntake error:', error);
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

export default DocController;
