/**
 * Attachment Static Routes - 附件静态访问路由
 *
 * Issue #557: 实现通用附件服务
 * Issue #001: Attachment 访问级别与统一接入改造
 * 通过 Token 认证提供附件访问，支持 <img> / <video> 等媒体元素
 * URL 格式:
 *   - /attach/public/:attachment_id - 公开附件直接访问
 *   - /attach/t/:token/:attachment_id - 私有附件 Token 访问
 *
 * 参考：task-static.routes.js (Issue #140)
 */

import Router from '@koa/router';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../lib/logger.js';

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

export default (db) => {
  const router = new Router({ prefix: '/attach' });

  router.get('/public/:attachment_id', async (ctx) => {
    const { attachment_id } = ctx.params;

    if (!attachment_id) {
      ctx.status = 400;
      ctx.body = 'Bad Request: Missing attachment_id';
      return;
    }

    try {
      const attachmentRows = await db.query(
        `SELECT * FROM attachments WHERE id = ?`,
        [attachment_id]
      );

      if (!attachmentRows || attachmentRows.length === 0) {
        ctx.status = 404;
        ctx.body = 'Attachment not found';
        return;
      }

      const attachment = attachmentRows[0];

      if (attachment.access_level !== 'public') {
        ctx.status = 403;
        ctx.body = 'Forbidden: Attachment is not public';
        return;
      }

      const attachmentBasePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
      const fullPath = path.join(attachmentBasePath, attachment.file_path);

      let stats;
      try {
        stats = await fs.stat(fullPath);
        if (!stats.isFile()) {
          ctx.status = 404;
          ctx.body = 'Not a file';
          return;
        }
        if (stats.size > MAX_FILE_SIZE) {
          ctx.status = 413;
          ctx.body = 'File too large (max 50MB)';
          return;
        }
      } catch (fileError) {
        ctx.status = 404;
        ctx.body = 'File not found';
        return;
      }

      const ext = path.extname(fullPath).toLowerCase();
      ctx.type = CONTENT_TYPES[ext] || attachment.mime_type || 'application/octet-stream';
      ctx.set('Cache-Control', 'public, max-age=86400');

      const stream = createReadStream(fullPath);
      stream.on('error', (err) => {
        logger.error('[AttachmentStatic] public stream error:', err);
        if (!ctx.headersSent) {
          ctx.status = 500;
          ctx.body = 'File read error';
        }
      });
      ctx.body = stream;

    } catch (error) {
      logger.error('[AttachmentStatic] public access error:', error);
      ctx.status = 500;
      ctx.body = 'Internal server error';
    }
  });

  router.get('/t/:token/:attachment_id', async (ctx) => {
    const { token, attachment_id } = ctx.params;
    const ipAddress = ctx.ip;
    const userAgent = ctx.get('User-Agent') || '';

    if (!token || !attachment_id) {
      ctx.status = 400;
      ctx.body = 'Bad Request: Missing token or attachment_id';
      return;
    }

    try {
      const tokenRows = await db.query(
        `SELECT * FROM attachment_token WHERE token = ?`,
        [token]
      );

      if (!tokenRows || tokenRows.length === 0) {
        ctx.status = 401;
        ctx.body = 'Unauthorized: Invalid token';
        return;
      }

      const tokenRecord = tokenRows[0];

      if (new Date() > new Date(tokenRecord.expires_at)) {
        ctx.status = 401;
        ctx.body = 'Unauthorized: Token expired';
        return;
      }

      const attachmentRows = await db.query(
        `SELECT * FROM attachments WHERE id = ?`,
        [attachment_id]
      );

      if (!attachmentRows || attachmentRows.length === 0) {
        ctx.status = 404;
        ctx.body = 'Attachment not found';
        return;
      }

      const attachment = attachmentRows[0];

      if (attachment.access_level === 'public') {
        ctx.status = 400;
        ctx.body = 'Bad Request: Public attachment should use /attach/public/:id';
        return;
      }

      if (attachment.source_tag !== tokenRecord.source_tag ||
          attachment.source_id !== tokenRecord.source_id) {
        ctx.status = 403;
        ctx.body = 'Forbidden: Token does not match attachment resource';
        return;
      }

      const attachmentBasePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
      const fullPath = path.join(attachmentBasePath, attachment.file_path);

      let stats;
      try {
        stats = await fs.stat(fullPath);
        if (!stats.isFile()) {
          ctx.status = 404;
          ctx.body = 'Not a file';
          return;
        }
        if (stats.size > MAX_FILE_SIZE) {
          ctx.status = 413;
          ctx.body = 'File too large (max 50MB)';
          return;
        }
      } catch (fileError) {
        ctx.status = 404;
        ctx.body = 'File not found';
        return;
      }

      db.execute(
        `UPDATE attachment_token SET last_access_at = NOW() WHERE id = ?`,
        [tokenRecord.id]
      ).catch(err => logger.error('Failed to update last_access_at:', err.message));

      const ext = path.extname(fullPath).toLowerCase();
      ctx.type = CONTENT_TYPES[ext] || attachment.mime_type || 'application/octet-stream';
      ctx.set('Cache-Control', 'private, max-age=3600');

      const stream = createReadStream(fullPath);
      stream.on('error', (err) => {
        logger.error('[AttachmentStatic] token stream error:', err);
        if (!ctx.headersSent) {
          ctx.status = 500;
          ctx.body = 'File read error';
        }
      });
      ctx.body = stream;

    } catch (error) {
      console.error('Attachment static file error:', error);
      ctx.status = 500;
      ctx.body = 'Internal server error';
    }
  });

  router.get('/health', async (ctx) => {
    ctx.body = { status: 'ok', service: 'attachment-static' };
  });

  return router;
};
