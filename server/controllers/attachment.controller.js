/**
 * Attachment Controller - 附件服务控制器
 *
 * Issue #557: 实现通用附件服务
 * 功能：
 * - 附件 CRUD API
 * - Token 生成 API
 * - 权限检查（通过 source_tag 分发到各业务模块）
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op } from 'sequelize';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import crypto from 'crypto';
import SystemSettingService from '../services/system-setting.service.js';
import AttachmentService from '../services/attachment.service.js';
import multer from '@koa/multer';
import DocAccessService from '../../lib/doc-access-service.js';

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Token 配置
const TOKEN_CONFIG = {
  EXPIRES_IN: 3600,  // 有效期：1 小时（秒）
};

// 批量上传单次最多 20 个文件
const MAX_BATCH_SIZE = 20;

// 允许上传的 MIME 类型白名单
const ALLOWED_MIME_TYPES = [
  // 图片
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  // 文档
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  // Word 文档
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Excel 表格
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // PowerPoint 演示文稿
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // 压缩包
  'application/zip',
  'application/x-zip-compressed'
];

// 文件魔数验证
const MAGIC_NUMBERS = {
  'image/png': [0x89, 0x50, 0x4E, 0x47],  // \x89PNG
  'image/jpeg': [0xFF, 0xD8, 0xFF],         // \xFF\xD8\xFF
  'image/gif': [0x47, 0x49, 0x46],         // GIF
  'image/webp': [0x52, 0x49, 0x46, 0x46],   // RIFF (WebP)
  'image/svg+xml': null,                     // SVG 是文本，需特殊处理
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
  'application/zip': [0x50, 0x4B, 0x03, 0x04], // PK (ZIP)
  'application/x-zip-compressed': [0x50, 0x4B, 0x03, 0x04], // PK (ZIP)
  'text/plain': [0x54, 0x58, 0x54],        // TXT: TXT
  'application/json': [0x7B, 0x22],        // JSON: {"
  'text/markdown': null,                    // Markdown 是文本，跳过验证
  // Office 文档 (都是 ZIP 格式)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [0x50, 0x4B, 0x03, 0x04],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [0x50, 0x4B, 0x03, 0x04],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [0x50, 0x4B, 0x03, 0x04],
  'application/msword': [0xD0, 0xCF, 0x11, 0xE0],  // DOC (OLE compound)
  'application/vnd.ms-excel': [0xD0, 0xCF, 0x11, 0xE0],  // XLS (OLE compound)
  'application/vnd.ms-powerpoint': [0xD0, 0xCF, 0x11, 0xE0],  // PPT (OLE compound)
};

const DEFAULT_MAX_UPLOAD_SIZE_MB = 50;

function looksLikeMojibake(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }

  return /[ÃÂÅÄÖØæçéèêëîïôöûüñ]/.test(value);
}

function normalizeUploadedFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return fileName || null;
  }

  let normalized = fileName.trim();
  if (!normalized) {
    return null;
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // ignore malformed URI content and keep original string
  }

  if (!looksLikeMojibake(normalized)) {
    return normalized;
  }

  try {
    const repaired = Buffer.from(normalized, 'latin1').toString('utf8').trim();
    if (repaired) {
      return repaired;
    }
  } catch {
    // fallback to normalized original name
  }

  return normalized;
}

class AttachmentController {
  constructor(db) {
    this.db = db;
    this.Attachment = null;
    this.AttachmentToken = null;
    this.systemSettingService = new SystemSettingService(db);
    this.attachmentService = new AttachmentService(db);
    this.docAccessService = null;
  }

  ensureModels() {
    if (!this.Attachment) {
      this.Attachment = this.db.getModel('attachment');
      this.AttachmentToken = this.db.getModel('attachment_token');
      this.attachmentService.ensureModels();
    }
  }

  ensureDocAccessService() {
    if (!this.docAccessService) {
      this.docAccessService = new DocAccessService(this.db);
    }
  }

  getAttachmentBasePath() {
    return process.env.ATTACHMENT_BASE_PATH || './data/attachments';
  }

  async getMaxFileSize() {
    try {
      const settings = await this.systemSettingService.getAllSettings();
      const maxMb = settings?.app?.max_upload_size || DEFAULT_MAX_UPLOAD_SIZE_MB;
      return maxMb * 1024 * 1024;
    } catch {
      return DEFAULT_MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    }
  }

  /**
   * 生成文件存储路径
   * 格式：YYYY/MM/DD/{attachment_id}.{ext_name}
   */
  generateFilePath(attachmentId, extName) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return path.join(String(year), month, day, `${attachmentId}.${extName}`);
  }

  /**
   * 验证 MIME 类型（通过文件魔数）
   */
  async validateMimeType(base64Data, declaredMimeType) {
    // 1. 解码 Base64
    const buffer = Buffer.from(base64Data, 'base64');

    // 2. 获取文件魔数
    const magicNumber = MAGIC_NUMBERS[declaredMimeType];
    if (!magicNumber) {
      // SVG 等文本类型，检查开头是否为 <svg
      if (declaredMimeType === 'image/svg+xml') {
        const content = buffer.toString('utf-8').trim();
        if (!content.startsWith('<svg') && !content.startsWith('<?xml')) {
          throw new Error('Invalid SVG file');
        }
        return true;
      }
      // 其他类型跳过魔数验证
      return true;
    }

    // 3. 验证魔数
    for (let i = 0; i < magicNumber.length; i++) {
      if (buffer[i] !== magicNumber[i]) {
        throw new Error(`File content does not match declared MIME type: ${declaredMimeType}`);
      }
    }

    return true;
  }

  /**
   * 验证 MIME 类型白名单
   */
  validateMimeTypeWhitelist(mimeType) {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new Error(`MIME type not allowed: ${mimeType}`);
    }
  }

  /**
   * 验证 MIME 类型（通过文件魔数 - Buffer 版本）
   */
  async validateMimeTypeFromBuffer(buffer, declaredMimeType) {
    const magicNumber = MAGIC_NUMBERS[declaredMimeType];
    if (!magicNumber) {
      if (declaredMimeType === 'image/svg+xml') {
        const content = buffer.toString('utf-8').trim();
        if (!content.startsWith('<svg') && !content.startsWith('<?xml')) {
          throw new Error('Invalid SVG file');
        }
        return true;
      }
      return true;
    }

    for (let i = 0; i < magicNumber.length; i++) {
      if (buffer[i] !== magicNumber[i]) {
        throw new Error(`File content does not match declared MIME type: ${declaredMimeType}`);
      }
    }

    return true;
  }

  /**
   * 获取图片尺寸（仅图片类型）
   */
  async getImageDimensions(base64Data, mimeType) {
    if (!mimeType.startsWith('image/')) {
      return { width: null, height: null };
    }

    try {
      const buffer = Buffer.from(base64Data, 'base64');
      
      // PNG
      if (mimeType === 'image/png') {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
      
      // JPEG (简化解析，查找 SOF0 标记)
      if (mimeType === 'image/jpeg') {
        for (let i = 0; i < buffer.length - 9; i++) {
          if (buffer[i] === 0xFF && (buffer[i + 1] === 0xC0 || buffer[i + 1] === 0xC2)) {
            const height = buffer.readUInt16BE(i + 5);
            const width = buffer.readUInt16BE(i + 7);
            return { width, height };
          }
        }
      }
      
      // GIF
      if (mimeType === 'image/gif') {
        const width = buffer.readUInt16LE(6);
        const height = buffer.readUInt16LE(8);
        return { width, height };
      }
      
      return { width: null, height: null };
    } catch (error) {
      logger.warn('[Attachment] Failed to get image dimensions:', error.message);
      return { width: null, height: null };
    }
  }

  /**
   * 检查附件权限
   * 通过 source_tag 分发到各业务模块
   */
  async resolveDocPlatformDocumentId(sourceId) {
    if (!sourceId || sourceId === 'temp') {
      return null;
    }

    const Document = this.db.getModel('document');
    const DocumentRevision = this.db.getModel('document_revision');

    const document = await Document.findByPk(sourceId, {
      attributes: ['id'],
      raw: true,
    });
    if (document?.id) {
      return document.id;
    }

    const revision = await DocumentRevision.findByPk(sourceId, {
      attributes: ['document_id'],
      raw: true,
    });

    return revision?.document_id || null;
  }

  async checkAttachmentPermission(ctx, sourceTag, sourceId, accessMode = 'read') {
    const userId = ctx.state.session.id;
    
    switch (sourceTag) {
      case 'kb_article_image':
      case 'kb_article_cover': {
        // 旧 KB 模块已废弃，kb_article_* 附件不再开放访问
        // 详见: docs/tasks/active/task-20260624-kb-retirement-doc-platform-convergence/kb-article-attachment-retirement-evidence.md
        // 数据库盘点结论: 生产环境无 kb_article_* 附件记录，拒绝访问无实际影响
        logger.warn(`[Attachment] kb_article_* source_tag is deprecated (tag=${sourceTag}, sourceId=${sourceId}). Access denied.`);
        return false;
      }

      case 'user_avatar': {
        // 头像公开可见，或检查是否本人
        return true;
      }
      
      case 'expert_avatar': {
        // 专家头像公开可见
        return true;
      }
      
      case 'task_export': {
        // 检查任务权限
        const Task = this.db.getModel('task');
        const task = await Task.findByPk(sourceId);
        if (!task) return false;
        // 任务创建者或管理员可以访问
        return task.created_by === userId;
      }
      
      case 'admin_upload': {
        // 管理员直接上传的附件，只有管理员可以访问
        const { isSystemAdmin } = await import('../../lib/permission-utils.js');
        return await isSystemAdmin(this.db, userId);
      }
      
      case 'mini_app':
      case 'mini_app_file': {
        // Mini App 文件上传
        // sourceId 可以是 app_id（新建时）或 record_id（编辑时）或 'temp'（临时）
        const MiniApp = this.db.getModel('mini_app');
        const MiniAppRow = this.db.getModel('mini_app_row');
        
        // 'temp' 是临时上传，允许所有登录用户
        if (sourceId === 'temp') {
          return true;
        }
        
        // 先检查是否是 app_id
        const app = await MiniApp.findByPk(sourceId);
        if (app) {
          // App 存在，允许上传
          return app.visibility === 'all' || app.owner_id === userId;
        }
        
        // 检查是否是 record_id
        const record = await MiniAppRow.findByPk(sourceId);
        if (record) {
          const recordApp = await MiniApp.findByPk(record.app_id);
          if (!recordApp) return false;
          return record.user_id === userId || recordApp.owner_id === userId || recordApp.visibility === 'all';
        }
        
        return false;
      }

      case 'doc-platform':
      case 'doc-platform-ocr': {
        // 文档平台第一阶段上传入口 / OCR 产物附件。
        // source_id 可以是 document_id 或 revision_id
        if (sourceId === 'temp') {
          return accessMode === 'write';
        }

        this.ensureDocAccessService();

        const documentId = await this.resolveDocPlatformDocumentId(sourceId);
        if (!documentId) {
          return false;
        }

        return accessMode === 'write'
          ? await this.docAccessService.canWrite(documentId, userId)
          : await this.docAccessService.canRead(documentId, userId);
      }
      
      default:
        // 未知类型默认拒绝
        return false;
    }
  }

  /**
   * 上传附件
   * POST /api/attachments
   */
  async upload(ctx) {
    try {
      this.ensureModels();
      const data = ctx.request.body;
      const userId = ctx.state.session.id;

      if (!data.source_tag || !data.source_id) {
        ctx.throw(400, 'source_tag and source_id are required');
      }
      if (!data.mime_type || !data.base64_data) {
        ctx.throw(400, 'mime_type and base64_data are required');
      }

      this.validateMimeTypeWhitelist(data.mime_type);
      await this.validateMimeType(data.base64_data, data.mime_type);

      const maxFileSize = await this.getMaxFileSize();
      const fileSize = Buffer.from(data.base64_data, 'base64').length;
      if (fileSize > maxFileSize) {
        ctx.throw(413, `File size exceeds limit of ${maxFileSize} bytes`);
      }

      const hasPermission = await this.checkAttachmentPermission(ctx, data.source_tag, data.source_id, 'write');
      if (!hasPermission) {
        ctx.throw(403, '无权访问此资源');
      }

      const buffer = Buffer.from(data.base64_data, 'base64');
      const { width, height } = await this.getImageDimensions(data.base64_data, data.mime_type);

      const attachment = await this.attachmentService.createFromBuffer({
        sourceTag: data.source_tag,
        sourceId: data.source_id,
        createdBy: userId,
        fileName: data.file_name || null,
        mimeType: data.mime_type,
        buffer,
        altText: data.alt_text || null,
        accessLevel: data.access_level || null,
        width,
        height,
      });

      const accessDescriptor = await this.attachmentService.buildAccessDescriptor(attachment, { userId });

      ctx.success({
        id: attachment.id,
        source_tag: attachment.source_tag,
        source_id: attachment.source_id,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        file_size: attachment.file_size,
        width: attachment.width,
        height: attachment.height,
        access_level: attachment.access_level,
        preview_url: accessDescriptor.preview_url,
        download_url: accessDescriptor.download_url,
        expires_at: accessDescriptor.expires_at || null,
        ref: `attach:${attachment.id}`,
        created_at: attachment.created_at,
      });
      ctx.status = 201;

      logger.info(`[Attachment] upload: ${attachment.id} - ${data.file_name || 'unnamed'} (${attachment.access_level})`);
    } catch (error) {
      logger.error('[Attachment] upload error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 上传附件 (FormData)
   * POST /api/attachments/upload
   */
  async uploadFormData(ctx) {
    try {
      this.ensureModels();
      const userId = ctx.state.session.id;
      const file = ctx.file;
      const body = ctx.request.body;

      if (!file) {
        ctx.throw(400, 'file is required');
      }
      if (!body.source_tag || !body.source_id) {
        ctx.throw(400, 'source_tag and source_id are required');
      }

      const maxFileSize = await this.getMaxFileSize();
      if (file.size > maxFileSize) {
        ctx.throw(413, `File size exceeds limit of ${maxFileSize} bytes`);
      }

      const hasPermission = await this.checkAttachmentPermission(ctx, body.source_tag, body.source_id, 'write');
      if (!hasPermission) {
        ctx.throw(403, '无权访问此资源');
      }

      const buffer = file.buffer;
      const base64Data = buffer.toString('base64');
      const normalizedFileName = normalizeUploadedFileName(file.originalname || null);

      this.validateMimeTypeWhitelist(file.mimetype);
      await this.validateMimeTypeFromBuffer(buffer, file.mimetype);

      const { width, height } = await this.getImageDimensions(base64Data, file.mimetype);

      const attachment = await this.attachmentService.createFromBuffer({
        sourceTag: body.source_tag,
        sourceId: body.source_id,
        createdBy: userId,
        fileName: normalizedFileName,
        mimeType: file.mimetype,
        buffer,
        altText: body.alt_text || null,
        accessLevel: body.access_level || null,
        width,
        height,
      });

      const accessDescriptor = await this.attachmentService.buildAccessDescriptor(attachment, { userId });

      ctx.success({
        id: attachment.id,
        source_tag: attachment.source_tag,
        source_id: attachment.source_id,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        file_size: attachment.file_size,
        width: attachment.width,
        height: attachment.height,
        access_level: attachment.access_level,
        preview_url: accessDescriptor.preview_url,
        download_url: accessDescriptor.download_url,
        expires_at: accessDescriptor.expires_at || null,
        ref: `attach:${attachment.id}`,
        created_at: attachment.created_at,
      });
      ctx.status = 201;

      logger.info(`[Attachment] uploadFormData: ${attachment.id} - ${normalizedFileName || 'unnamed'} (${attachment.access_level})`);
    } catch (error) {
      logger.error('[Attachment] uploadFormData error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 批量上传附件
   * POST /api/attachments/batch
   */
  async uploadBatch(ctx) {
    try {
      this.ensureModels();
      const data = ctx.request.body;
      const userId = ctx.state.session.id;

      if (!data.source_tag || !data.source_id) {
        ctx.throw(400, 'source_tag and source_id are required');
      }
      if (!data.files || !Array.isArray(data.files) || data.files.length === 0) {
        ctx.throw(400, 'files array is required');
      }
      if (data.files.length > MAX_BATCH_SIZE) {
        ctx.throw(400, `Maximum ${MAX_BATCH_SIZE} files allowed per batch`);
      }

      const hasPermission = await this.checkAttachmentPermission(ctx, data.source_tag, data.source_id, 'write');
      if (!hasPermission) {
        ctx.throw(403, '无权访问此资源');
      }

      const maxFileSize = await this.getMaxFileSize();
      const results = [];
      const errors = [];

      for (const file of data.files) {
        try {
          this.validateMimeTypeWhitelist(file.mime_type);
          await this.validateMimeType(file.base64_data, file.mime_type);

          const fileSize = Buffer.from(file.base64_data, 'base64').length;
          if (fileSize > maxFileSize) {
            throw new Error(`File size exceeds limit of ${maxFileSize} bytes`);
          }

          const buffer = Buffer.from(file.base64_data, 'base64');
          const { width, height } = await this.getImageDimensions(file.base64_data, file.mime_type);

          const attachment = await this.attachmentService.createFromBuffer({
            sourceTag: data.source_tag,
            sourceId: data.source_id,
            createdBy: userId,
            fileName: file.file_name || null,
            mimeType: file.mime_type,
            buffer,
            altText: file.alt_text || null,
            accessLevel: data.access_level || null,
            width,
            height,
          });

          const accessDescriptor = await this.attachmentService.buildAccessDescriptor(attachment, { userId });

          results.push({
            id: attachment.id,
            file_name: attachment.file_name,
            file_size: attachment.file_size,
            access_level: attachment.access_level,
            preview_url: accessDescriptor.preview_url,
            download_url: accessDescriptor.download_url,
            ref: `attach:${attachment.id}`,
          });
        } catch (error) {
          errors.push({
            file_name: file.file_name,
            error: error.message,
          });
        }
      }

      ctx.success({
        items: results,
        total: results.length,
        errors: errors.length > 0 ? errors : undefined,
      });
      ctx.status = 201;

      logger.info(`[Attachment] uploadBatch: ${results.length} success, ${errors.length} failed`);
    } catch (error) {
      logger.error('[Attachment] uploadBatch error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 获取附件详情（返回 data_url）
   * GET /api/attachments/:id
   */
  async get(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;

      const attachment = await this.Attachment.findByPk(id);
      if (!attachment) {
        ctx.throw(404, 'Attachment not found');
      }

      const hasPermission = await this.checkAttachmentPermission(ctx, attachment.source_tag, attachment.source_id, 'read');
      if (!hasPermission) {
        ctx.throw(403, '无权访问此附件');
      }

      const accessDescriptor = await this.attachmentService.buildAccessDescriptor(attachment, { userId });

      ctx.success({
        id: attachment.id,
        source_tag: attachment.source_tag,
        source_id: attachment.source_id,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        file_size: attachment.file_size,
        width: attachment.width,
        height: attachment.height,
        alt_text: attachment.alt_text,
        description: attachment.description,
        access_level: attachment.access_level,
        preview_url: accessDescriptor.preview_url,
        download_url: accessDescriptor.download_url,
        expires_at: accessDescriptor.expires_at || null,
        created_at: attachment.created_at,
      });
    } catch (error) {
      logger.error('[Attachment] get error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  async getContent(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;

      const attachment = await this.Attachment.findByPk(id);
      if (!attachment) {
        ctx.throw(404, 'Attachment not found');
      }

      const hasPermission = await this.checkAttachmentPermission(ctx, attachment.source_tag, attachment.source_id, 'read');
      if (!hasPermission) {
        ctx.throw(403, '无权访问此附件');
      }

      const fullPath = path.join(this.getAttachmentBasePath(), attachment.file_path);
      try {
        const stats = await fs.stat(fullPath);
        if (!stats.isFile()) {
          ctx.throw(404, 'Not a file');
        }
        if (stats.size > MAX_FILE_SIZE) {
          ctx.throw(413, 'File too large (max 50MB)');
        }
      } catch (fileError) {
        ctx.throw(404, 'File not found');
      }

      const ext = path.extname(fullPath).toLowerCase();
      ctx.type = CONTENT_TYPES[ext] || attachment.mime_type || 'application/octet-stream';
      ctx.set('Cache-Control', 'private, max-age=3600');

      const stream = createReadStream(fullPath);
      stream.on('error', (err) => {
        logger.error('[Attachment] stream read error:', err);
        if (!ctx.headersSent) {
          ctx.status = 500;
          ctx.body = 'File read error';
        }
      });
      ctx.body = stream;
    } catch (error) {
      logger.error('[Attachment] getContent error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 批量获取附件元信息（轻量级）
   * POST /api/attachments/meta
   */
  async getMeta(ctx) {
    try {
      this.ensureModels();
      const { ids } = ctx.request.body;
      const userId = ctx.state.session.id;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        ctx.throw(400, 'ids array is required');
      }

      const attachments = await this.Attachment.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ['id', 'mime_type', 'ext_name', 'file_size', 'width', 'height', 'alt_text', 'source_tag', 'source_id'],
      });

      // 权限检查：过滤出用户有权访问的附件
      const accessibleAttachments = [];
      for (const attachment of attachments) {
        const hasPermission = await this.checkAttachmentPermission(ctx, attachment.source_tag, attachment.source_id, 'read');
        if (hasPermission) {
          accessibleAttachments.push({
            id: attachment.id,
            mime_type: attachment.mime_type,
            ext_name: attachment.ext_name,
            file_size: attachment.file_size,
            width: attachment.width,
            height: attachment.height,
            alt_text: attachment.alt_text,
          });
        }
      }

      ctx.success({
        items: accessibleAttachments,
        total: accessibleAttachments.length,
      });
    } catch (error) {
      logger.error('[Attachment] getMeta error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 列出某资源的所有附件
   * GET /api/attachments?source_tag=xxx&source_id=xxx
   */
  async list(ctx) {
    try {
      this.ensureModels();
      const { source_tag, source_id } = ctx.query;
      const userId = ctx.state.session.id;

      if (!source_tag || !source_id) {
        ctx.throw(400, 'source_tag and source_id query parameters are required');
      }

      const hasPermission = await this.checkAttachmentPermission(ctx, source_tag, source_id, 'read');
      if (!hasPermission) {
        ctx.throw(403, '无权访问此资源');
      }

      const attachments = await this.Attachment.findAll({
        where: { source_tag, source_id },
        order: [['created_at', 'DESC']],
      });

      const items = await Promise.all(attachments.map(async (a) => {
        const accessDescriptor = await this.attachmentService.buildAccessDescriptor(a, { userId });
        return {
          id: a.id,
          file_name: a.file_name,
          mime_type: a.mime_type,
          file_size: a.file_size,
          width: a.width,
          height: a.height,
          access_level: a.access_level,
          preview_url: accessDescriptor.preview_url,
          download_url: accessDescriptor.download_url,
          expires_at: accessDescriptor.expires_at || null,
          ref: `attach:${a.id}`,
          created_at: a.created_at,
        };
      }));

      ctx.success({
        items,
        total: attachments.length,
      });
    } catch (error) {
      logger.error('[Attachment] list error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 管理员列表（全局附件列表，支持分页和筛选）
   * GET /api/attachments/admin
   */
  async listAdmin(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModels();
      const { page = 1, size = 20, source_tag, source_id, mime_type, uploader_id, start_date, end_date } = ctx.query;
      const userId = ctx.state.session.id;

      // 检查管理员权限
      const { isSystemAdmin } = await import('../../lib/permission-utils.js');
      const isAdmin = await isSystemAdmin(this.db, userId);
      if (!isAdmin) {
        ctx.throw(403, '无权访问管理员接口');
      }

      // 构建查询条件
      const where = {};
      if (source_tag) {
        where.source_tag = source_tag;
      }
      if (source_id) {
        where.source_id = source_id;
      }
      if (mime_type) {
        // 支持 mime_type 前缀筛选（如 'image' 匹配所有 image/* 类型）
        if (mime_type === 'image' || mime_type === 'video' || mime_type === 'document') {
          const mimePrefixes = {
            'image': ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'],
            'video': ['video/mp4', 'video/webm'],
            'document': ['application/pdf', 'text/plain', 'text/markdown', 'application/json'],
          };
          where.mime_type = { [Op.in]: mimePrefixes[mime_type] || [mime_type] };
        } else {
          where.mime_type = mime_type;
        }
      }
      if (uploader_id) {
        where.created_by = uploader_id;
      }
      if (start_date || end_date) {
        where.created_at = {};
        if (start_date) {
          where.created_at[Op.gte] = new Date(start_date);
        }
        if (end_date) {
          where.created_at[Op.lte] = new Date(end_date + 'T23:59:59');
        }
      }

      // 分页查询
      const pagination = { page: parseInt(page), size: parseInt(size) };
      const offset = (pagination.page - 1) * pagination.size;

      const rawResult = await this.Attachment.findAndCountAll({
        where,
        order: [['created_at', 'DESC']],
        limit: pagination.size,
        offset,
        include: [{
          model: this.db.getModel('user'),
          as: 'created_by_user',
          attributes: ['id', 'username'],
          required: false,
        }],
      });

      // 使用 buildPaginatedResponse 构建响应
      const { buildPaginatedResponse } = await import('../../lib/query-builder.js');
      
      // 转换数据格式（保持 result 结构，只转换 rows 内容）
      const result = {
        rows: rawResult.rows.map(a => ({
          id: a.id,
          filename: a.file_name,
          mime_type: a.mime_type,
          size: a.file_size,
          source_tag: a.source_tag,
          source_id: a.source_id,
          uploader_id: a.created_by,
          uploader_name: a.created_by_user?.username || null,
          created_at: a.created_at,
        })),
        count: rawResult.count,
      };

      // 构建符合规范的分页响应
      const response = buildPaginatedResponse(result, pagination, startTime);

      ctx.success(response);
      
      logger.info(`[Attachment] listAdmin: ${rawResult.count} total, page ${pagination.page}`);
    } catch (error) {
      logger.error('[Attachment] listAdmin error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 删除附件
   * DELETE /api/attachments/:id
   */
  async delete(ctx) {
    try {
      this.ensureModels();
      const { id } = ctx.params;
      const userId = ctx.state.session.id;

      const attachment = await this.Attachment.findByPk(id);
      if (!attachment) {
        ctx.throw(404, 'Attachment not found');
      }

      // 权限检查：只有上传者或管理员可以删除
      if (attachment.created_by !== userId) {
        // 检查用户是否为管理员
        const { isSystemAdmin } = await import('../../lib/permission-utils.js');
        const isAdmin = await isSystemAdmin(this.db, userId);
        if (!isAdmin) {
          ctx.throw(403, '无权删除此附件');
        }
      }

      // 删除文件
      const fullPath = path.join(this.getAttachmentBasePath(), attachment.file_path);
      try {
        await fs.unlink(fullPath);
      } catch (fileError) {
        logger.warn(`[Attachment] Failed to delete file: ${fullPath}`, fileError.message);
        // 继续删除数据库记录
      }

      // 删除数据库记录
      await attachment.destroy();

      ctx.success({ success: true });
      logger.info(`[Attachment] delete: ${id}`);
    } catch (error) {
      logger.error('[Attachment] delete error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }

  /**
   * 生成资源级 Token
   * POST /api/attachments/token
   */
  async generateToken(ctx) {
    try {
      this.ensureModels();
      const { source_tag, source_id } = ctx.request.body;
      const userId = ctx.state.session.id;

      if (!source_tag || !source_id) {
        ctx.throw(400, 'source_tag and source_id are required');
      }

      const hasPermission = await this.checkAttachmentPermission(ctx, source_tag, source_id, 'read');
      if (!hasPermission) {
        ctx.throw(403, '无权访问此资源');
      }

      const tokenResult = await this.attachmentService.generateToken(source_tag, source_id, userId);

      ctx.success(tokenResult);
      
      logger.info(`[Attachment] generateToken: ${tokenResult.token} for ${source_tag}:${source_id}`);
    } catch (error) {
      logger.error('[Attachment] generateToken error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }
}

export default AttachmentController;
