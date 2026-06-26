import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import Utils from '../../lib/utils.js';
import logger from '../../lib/logger.js';

const TOKEN_EXPIRES_IN = 3600;

const SOURCE_TAG_ACCESS_LEVEL_MAP = {
  user_avatar: 'public',
  expert_avatar: 'public',
  site_logo: 'public',
  site_background: 'public',
  /** @deprecated kb_article_* 已废弃，控制器层已拒绝访问，此处仅为历史兼容保留 */
  kb_article_image: 'private',
  /** @deprecated kb_article_* 已废弃，控制器层已拒绝访问，此处仅为历史兼容保留 */
  kb_article_cover: 'private',
  'doc-platform': 'private',
  task_export: 'private',
  admin_upload: 'private',
  mini_app: 'private',
  mini_app_file: 'private',
};

const PUBLIC_ONLY_SOURCE_TAGS = ['user_avatar', 'expert_avatar', 'site_logo', 'site_background'];

class AttachmentService {
  constructor(db) {
    this.db = db;
    this.Attachment = null;
    this.AttachmentToken = null;
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

  resolveDefaultAccessLevel(sourceTag) {
    return SOURCE_TAG_ACCESS_LEVEL_MAP[sourceTag] || 'private';
  }

  generateFilePath(attachmentId, extName) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return path.join(String(year), month, day, `${attachmentId}.${extName}`);
  }

  async createFromBuffer(options) {
    this.ensureModels();
    const {
      sourceTag,
      sourceId,
      createdBy = null,
      fileName,
      mimeType,
      buffer,
      altText = null,
      description = null,
      width = null,
      height = null,
      accessLevel = null,
    } = options;

    if (!sourceTag || !sourceId) {
      throw new Error('sourceTag and sourceId are required');
    }
    if (!mimeType || !buffer) {
      throw new Error('mimeType and buffer are required');
    }

    const id = Utils.newID(20);
    const extName = fileName ? path.extname(fileName).slice(1) : mimeType.split('/')[1];
    const filePath = this.generateFilePath(id, extName);
    const fullPath = path.join(this.getAttachmentBasePath(), filePath);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);

    const resolvedAccessLevel = (accessLevel === 'public' && PUBLIC_ONLY_SOURCE_TAGS.includes(sourceTag))
      ? 'public'
      : this.resolveDefaultAccessLevel(sourceTag);

    const attachment = await this.Attachment.create({
      id,
      source_tag: sourceTag,
      source_id: sourceId,
      file_name: fileName || null,
      ext_name: extName,
      mime_type: mimeType,
      file_size: buffer.length,
      file_path: filePath,
      width,
      height,
      alt_text: altText || null,
      description: description || null,
      access_level: resolvedAccessLevel,
      created_by: createdBy,
    });

    logger.info(`[AttachmentService] createFromBuffer: ${id} - ${fileName || 'unnamed'} (${resolvedAccessLevel})`);
    return attachment;
  }

  async createFromDataUrl(options) {
    const { fileName, dataUrl, altText = null, description = null } = options;
    
    const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || '');
    if (!match) {
      throw new Error(`Invalid data URL for ${fileName}`);
    }
    
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    
    return await this.createFromBuffer({
      ...options,
      mimeType,
      buffer,
      altText,
      description,
    });
  }

  async createTextAttachment(options) {
    const { fileName, content, mimeType = 'text/plain' } = options;
    const buffer = Buffer.from(content || '', 'utf8');
    
    return await this.createFromBuffer({
      ...options,
      mimeType,
      buffer,
    });
  }

  async getById(id) {
    this.ensureModels();
    return await this.Attachment.findByPk(id);
  }

  async listBySource(sourceTag, sourceId) {
    this.ensureModels();
    return await this.Attachment.findAll({
      where: { source_tag: sourceTag, source_id: sourceId },
      order: [['created_at', 'DESC']],
    });
  }

  async rebindAttachment(id, { sourceTag, sourceId }) {
    this.ensureModels();
    const attachment = await this.Attachment.findByPk(id);
    if (!attachment) {
      throw new Error(`Attachment not found: ${id}`);
    }
    
    const newAccessLevel = this.resolveDefaultAccessLevel(sourceTag);
    await attachment.update({
      source_tag: sourceTag,
      source_id: sourceId,
      access_level: newAccessLevel,
    });
    
    logger.info(`[AttachmentService] rebindAttachment: ${id} -> ${sourceTag}:${sourceId} (${newAccessLevel})`);
    return attachment;
  }

  async rebindMany(ids, { sourceTag, sourceId }) {
    this.ensureModels();
    const { Op } = await import('sequelize');
    const newAccessLevel = this.resolveDefaultAccessLevel(sourceTag);

    const [count] = await this.Attachment.update(
      { source_tag: sourceTag, source_id: sourceId, access_level: newAccessLevel },
      { where: { id: { [Op.in]: ids } } }
    );

    logger.info(`[AttachmentService] rebindMany: ${count} attachments -> ${sourceTag}:${sourceId} (${newAccessLevel})`);
    return count;
  }

  async deleteAttachment(id, options = {}) {
    this.ensureModels();
    const { deleteFile = true } = options;
    
    const attachment = await this.Attachment.findByPk(id);
    if (!attachment) {
      throw new Error(`Attachment not found: ${id}`);
    }

    if (deleteFile) {
      const fullPath = path.join(this.getAttachmentBasePath(), attachment.file_path);
      try {
        await fs.unlink(fullPath);
      } catch (err) {
        logger.warn(`[AttachmentService] Failed to delete file: ${fullPath}`, err.message);
      }
    }

    await attachment.destroy();
    logger.info(`[AttachmentService] deleteAttachment: ${id}`);
    return true;
  }

  async deleteMany(ids, options = {}) {
    this.ensureModels();
    const { Op } = await import('sequelize');
    const { deleteFile = true } = options;

    const attachments = await this.Attachment.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'file_path'],
    });

    if (deleteFile) {
      for (const attachment of attachments) {
        const fullPath = path.join(this.getAttachmentBasePath(), attachment.file_path);
        try {
          await fs.unlink(fullPath);
        } catch (err) {
          logger.warn(`[AttachmentService] Failed to delete file: ${fullPath}`, err.message);
        }
      }
    }

    await this.Attachment.destroy({ where: { id: { [Op.in]: ids } } });
    logger.info(`[AttachmentService] deleteMany: ${ids.length} attachments`);
    return ids.length;
  }

  async buildAccessDescriptor(attachment, userContext = {}) {
    this.ensureModels();
    const { userId } = userContext;

    const accessLevel = attachment.access_level || 'private';

    if (accessLevel === 'public') {
      return {
        access_level: 'public',
        preview_url: `/attach/public/${attachment.id}`,
        download_url: `/attach/public/${attachment.id}`,
      };
    }

    if (!userId) {
      return {
        access_level: 'private',
        preview_url: null,
        download_url: null,
        requires_auth: true,
      };
    }

    const sourceTag = attachment.source_tag;
    const sourceId = attachment.source_id;
    const token = await this.generateToken(sourceTag, sourceId, userId);
    return {
      access_level: 'private',
      preview_url: `/attach/t/${token.token}/${attachment.id}`,
      download_url: `/attach/t/${token.token}/${attachment.id}`,
      expires_at: token.expires_at,
    };
  }

  async generateToken(sourceTag, sourceId, userId) {
    this.ensureModels();
    const { Op } = await import('sequelize');

    const existingToken = await this.AttachmentToken.findOne({
      where: {
        source_tag: sourceTag,
        source_id: sourceId,
        user_id: userId,
        expires_at: { [Op.gt]: new Date() },
      },
    });

    if (existingToken) {
      return {
        token: existingToken.token,
        url: `/attach/t/${existingToken.token}`,
        expires_at: existingToken.expires_at,
      };
    }

    const tokenStr = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRES_IN * 1000);

    await this.AttachmentToken.create({
      token: tokenStr,
      source_tag: sourceTag,
      source_id: sourceId,
      user_id: userId,
      expires_at: expiresAt,
    });

    logger.info(`[AttachmentService] generateToken: ${tokenStr} for ${sourceTag}:${sourceId}`);
    return {
      token: tokenStr,
      url: `/attach/t/${tokenStr}`,
      expires_at: expiresAt,
    };
  }

  async readFileContent(attachment) {
    const fullPath = path.join(this.getAttachmentBasePath(), attachment.file_path);
    return await fs.readFile(fullPath);
  }

  async readFileBase64(attachment) {
    const buffer = await this.readFileContent(attachment);
    return buffer.toString('base64');
  }

  mimeToExt(mimeType) {
    const map = {
      'text/markdown': 'md',
      'application/json': 'json',
      'text/plain': 'txt',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    };
    return map[mimeType] || 'bin';
  }
}

export default AttachmentService;