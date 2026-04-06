/**
 * Attachment Static Routes - 附件 Token 访问路由
 *
 * Issue #557: 实现通用附件服务
 * 通过 Token 认证提供附件访问，支持 <img> / <video> 等媒体元素
 * URL 格式: /attach/t/:token/:attachment_id
 *
 * 参考：task-static.routes.js (Issue #140)
 */

import Router from '@koa/router';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import logger from '../../lib/logger.js';

// Content-Type 映射
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

// 最大文件大小：50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * 创建附件静态文件服务路由
 * @param {Object} db - 数据库实例
 */
export default (db) => {
  const router = new Router({ prefix: '/attach' });

  /**
   * 附件 Token 访问路由
   * 匹配: /attach/t/:token/:attachment_id
   */
  router.get('/t/:token/:attachment_id', async (ctx) => {
    const { token, attachment_id } = ctx.params;
    const ipAddress = ctx.ip;
    const userAgent = ctx.get('User-Agent') || '';

    // 1. 验证参数存在
    if (!token || !attachment_id) {
      ctx.status = 400;
      ctx.body = 'Bad Request: Missing token or attachment_id';
      return;
    }

    try {
      // 2. 查询数据库验证 token
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

      // 3. 检查 token 是否过期
      if (new Date() > new Date(tokenRecord.expires_at)) {
        ctx.status = 401;
        ctx.body = 'Unauthorized: Token expired';
        return;
      }

      // 4. 查询附件信息
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

      // 5. 验证 source_tag 和 source_id 匹配
      if (attachment.source_tag !== tokenRecord.source_tag ||
          attachment.source_id !== tokenRecord.source_id) {
        ctx.status = 403;
        ctx.body = 'Forbidden: Token does not match attachment resource';
        return;
      }

      // 6. 获取附件基础路径
      const attachmentBasePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
      const fullPath = path.join(attachmentBasePath, attachment.file_path);

      // 7. 检查文件是否存在及大小限制
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

      // 8. 更新最后访问时间（异步，不阻塞响应）
      db.query(
        `UPDATE attachment_token SET last_access_at = NOW() WHERE id = ?`,
        [tokenRecord.id]
      ).catch(err => logger.error('Failed to update last_access_at:', err.message));

      // 9. 设置 Content-Type
      const ext = path.extname(fullPath).toLowerCase();
      ctx.type = CONTENT_TYPES[ext] || attachment.mime_type || 'application/octet-stream';

      // 10. 设置缓存控制（附件可以缓存，因为 Token 有过期时间）
      ctx.set('Cache-Control', 'public, max-age=3600');

      // 11. 返回文件内容
      ctx.body = createReadStream(fullPath);

    } catch (error) {
      console.error('Attachment static file error:', error);
      ctx.status = 500;
      ctx.body = 'Internal server error';
    }
  });

  /**
   * 健康检查端点
   */
  router.get('/health', async (ctx) => {
    ctx.body = { status: 'ok', service: 'attachment-static' };
  });

  return router;
};
