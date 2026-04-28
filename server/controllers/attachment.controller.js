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
import crypto from 'crypto';
import SystemSettingService from '../services/system-setting.service.js';

// Token 配置
const TOKEN_CONFIG = {
  EXPIRES_IN: 3600,  // 有效期：1 小时（秒）
};

// 批量上传单次最多 10 个文件
const MAX_BATCH_SIZE = 10;

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
};

const DEFAULT_MAX_UPLOAD_SIZE_MB = 50;

class AttachmentController {
  constructor(db) {
    this.db = db;
    this.Attachment = null;
    this.AttachmentToken = null;
    this.systemSettingService = new SystemSettingService(db);
  }

  ensureModels() {
    if (!this.Attachment) {
      this.Attachment = this.db.getModel('attachment');
      this.AttachmentToken = this.db.getModel('attachment_token');
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
  async checkAttachmentPermission(ctx, sourceTag, sourceId) {
    const userId = ctx.state.session.id;
    
    switch (sourceTag) {
      case 'kb_article_image':
      case 'kb_article_cover': {
        // 检查用户是否有权限访问该知识库文章
        const { canAccessKbArticle } = await import('../../lib/kb-permission.js');
        return await canAccessKbArticle(this.db, sourceId, userId);
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
        const { isSystemAdmin } = await import('../../lib/kb-permission.js');
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

      // 参数验证
      if (!data.source_tag || !data.source_id) {
        ctx.throw(400, 'source_tag and source_id are required');
      }
      if (!data.mime_type || !data.base64_data) {
        ctx.throw(400, 'mime_type and base64_data are required');
      }

      // 验证 MIME 类型白名单
      this.validateMimeTypeWhitelist(data.mime_type);

      // 验证文件魔数
      await this.validateMimeType(data.base64_data, data.mime_type);

      // 检查文件大小
      const maxFileSize = await this.getMaxFileSize();
      const fileSize = Buffer.from(data.base64_data, 'base64').length;
      if (fileSize > maxFileSize) {
        ctx.throw(413, `File size exceeds limit of ${maxFileSize} bytes`);
      }

      // 权限检查
      const hasPermission = await this.checkAttachmentPermission(ctx, data.source_tag, data.source_id);
      if (!hasPermission) {
        ctx.throw(403, '无权访问此资源');
      }

      // 生成附件 ID
      const id = Utils.newID(20);
      
      // 提取扩展名
      const extName = data.file_name 
        ? path.extname(data.file_name).slice(1) 
        : data.mime_type.split('/')[1];

      // 生成文件路径
      const filePath = this.generateFilePath(id, extName);
      const fullPath = path.join(this.getAttachmentBasePath(), filePath);

      // 确保目录存在
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // 写入文件
      const buffer = Buffer.from(data.base64_data, 'base64');
      await fs.writeFile(fullPath, buffer);

      // 获取图片尺寸
      const { width, height } = await this.getImageDimensions(data.base64_data, data.mime_type);

      // 创建数据库记录
      const attachment = await this.Attachment.create({
        id,
        source_tag: data.source_tag,
        source_id: data.source_id,
        file_name: data.file_name || null,
        ext_name: extName,
        mime_type: data.mime_type,
        file_size: fileSize,
        file_path: filePath,
        width,
        height,
        alt_text: data.alt_text || null,
        description: null,
        created_by: userId,
      });

      // 生成 data_url
      const dataUrl = `data:${data.mime_type};base64,${data.base64_data}`;

      ctx.success({
        id: attachment.id,
        source_tag: attachment.source_tag,
        source_id: attachment.source_id,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        file_size: attachment.file_size,
        width: attachment.width,
        height: attachment.height,
        file_path: attachment.file_path,
        data_url: dataUrl,
        ref: `attach:${attachment.id}`,
        created_at: attachment.created_at,
      });
      ctx.status = 201;
      
      logger.info(`[Attachment] upload: ${id} - ${data.file_name || 'unnamed'}`);
    } catch (error) {
      logger.error('[Attachment] upload error:', error);
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

      // 参数验证
      if (!data.source_tag || !data.source_id) {
        ctx.throw(400, 'source_tag and source_id are required');
      }
      if (!data.files || !Array.isArray(data.files) || data.files.length === 0) {
        ctx.throw(400, 'files array is required');
      }
      if (data.files.length > MAX_BATCH_SIZE) {
        ctx.throw(400, `Maximum ${MAX_BATCH_SIZE} files allowed per batch`);
      }

      // 权限检查
      const hasPermission = await this.checkAttachmentPermission(ctx, data.source_tag, data.source_id);
      if (!hasPermission) {
        ctx.throw(403, '无权访问此资源');
      }

      const maxFileSize = await this.getMaxFileSize();
      const results = [];
      const errors = [];

      for (const file of data.files) {
        try {
          // 验证 MIME 类型白名单
          this.validateMimeTypeWhitelist(file.mime_type);

          // 验证文件魔数
          await this.validateMimeType(file.base64_data, file.mime_type);

          // 检查文件大小
          const fileSize = Buffer.from(file.base64_data, 'base64').length;
          if (fileSize > maxFileSize) {
            throw new Error(`File size exceeds limit of ${maxFileSize} bytes`);
          }

          // 生成附件 ID
          const id = Utils.newID(20);
          
          // 提取扩展名
          const extName = file.file_name 
            ? path.extname(file.file_name).slice(1) 
            : file.mime_type.split('/')[1];

          // 生成文件路径
          const filePath = this.generateFilePath(id, extName);
          const fullPath = path.join(this.getAttachmentBasePath(), filePath);

          // 确保目录存在
          await fs.mkdir(path.dirname(fullPath), { recursive: true });

          // 写入文件
          const buffer = Buffer.from(file.base64_data, 'base64');
          await fs.writeFile(fullPath, buffer);

          // 获取图片尺寸
          const { width, height } = await this.getImageDimensions(file.base64_data, file.mime_type);

          // 创建数据库记录
          const attachment = await this.Attachment.create({
            id,
            source_tag: data.source_tag,
            source_id: data.source_id,
            file_name: file.file_name || null,
            ext_name: extName,
            mime_type: file.mime_type,
            file_size: fileSize,
            file_path: filePath,
            width,
            height,
            alt_text: file.alt_text || null,
            description: null,
            created_by: userId,
          });

          // 生成 data_url
          const dataUrl = `data:${file.mime_type};base64,${file.base64_data}`;

          results.push({
            id: attachment.id,
            file_name: attachment.file_name,
            file_size: attachment.file_size,
            data_url: dataUrl,
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

      // 权限检查
      const hasPermission = await this.checkAttachmentPermission(ctx, attachment.source_tag, attachment.source_id);
      if (!hasPermission) {
        ctx.throw(403, '无权访问此附件');
      }

      // 读取文件并生成 data_url
      const fullPath = path.join(this.getAttachmentBasePath(), attachment.file_path);
      let dataUrl = null;
      try {
        const buffer = await fs.readFile(fullPath);
        dataUrl = `data:${attachment.mime_type};base64,${buffer.toString('base64')}`;
      } catch (fileError) {
        logger.error(`[Attachment] Failed to read file: ${fullPath}`, fileError.message);
        ctx.throw(500, 'Failed to read attachment file');
      }

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
        data_url: dataUrl,
        created_at: attachment.created_at,
      });
    } catch (error) {
      logger.error('[Attachment] get error:', error);
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
        const hasPermission = await this.checkAttachmentPermission(ctx, attachment.source_tag, attachment.source_id);
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

      // 权限检查
      const hasPermission = await this.checkAttachmentPermission(ctx, source_tag, source_id);
      if (!hasPermission) {
        ctx.throw(403, '无权访问此资源');
      }

      const attachments = await this.Attachment.findAll({
        where: { source_tag, source_id },
        order: [['created_at', 'DESC']],
      });

      ctx.success({
        items: attachments.map(a => ({
          id: a.id,
          file_name: a.file_name,
          mime_type: a.mime_type,
          file_size: a.file_size,
          width: a.width,
          height: a.height,
          alt_text: a.alt_text,
          ref: `attach:${a.id}`,
          created_at: a.created_at,
        })),
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
      const { page = 1, size = 20, source_tag, mime_type, uploader_id, start_date, end_date } = ctx.query;
      const userId = ctx.state.session.id;

      // 检查管理员权限
      const { isSystemAdmin } = await import('../../lib/kb-permission.js');
      const isAdmin = await isSystemAdmin(this.db, userId);
      if (!isAdmin) {
        ctx.throw(403, '无权访问管理员接口');
      }

      // 构建查询条件
      const where = {};
      if (source_tag) {
        where.source_tag = source_tag;
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
        const { isSystemAdmin } = await import('../../lib/kb-permission.js');
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

      // 权限检查
      const hasPermission = await this.checkAttachmentPermission(ctx, source_tag, source_id);
      if (!hasPermission) {
        ctx.throw(403, '无权访问此资源');
      }

      // 查找现有未过期的 Token
      const existingToken = await this.AttachmentToken.findOne({
        where: {
          source_tag,
          source_id,
          user_id: userId,
          expires_at: { [Op.gt]: new Date() },
        },
      });

      if (existingToken) {
        ctx.success({
          token: existingToken.token,
          url: `/attach/t/${existingToken.token}`,
          expires_at: existingToken.expires_at,
        });
        return;
      }

      // 生成新 Token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + TOKEN_CONFIG.EXPIRES_IN * 1000);

      const attachmentToken = await this.AttachmentToken.create({
        token,
        source_tag,
        source_id,
        user_id: userId,
        expires_at: expiresAt,
      });

      ctx.success({
        token: attachmentToken.token,
        url: `/attach/t/${attachmentToken.token}`,
        expires_at: attachmentToken.expires_at,
      });
      
      logger.info(`[Attachment] generateToken: ${token} for ${source_tag}:${source_id}`);
    } catch (error) {
      logger.error('[Attachment] generateToken error:', error);
      ctx.throw(error.status || 500, error.message);
    }
  }
}

export default AttachmentController;
