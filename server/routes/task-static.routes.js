/**
 * Task Static Routes - 任务静态文件服务路由
 * 
 * 通过 Token 认证提供静态文件访问，支持 HTML 相对路径资源
 * URL 格式: /task-static/t/:token/p/*filePath
 * 
 * Issue #140: 将文件预览窗口嵌入任务面板
 */

import Router from '@koa/router';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';
const MAX_FILE_SIZE = 50 * 1024 * 1024;  // 50MB 限制

// Content-Type 映射
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

/**
 * 创建静态文件服务路由
 * @param {Object} db - 数据库实例
 */
export default (db) => {
  const router = new Router({ prefix: '/task-static' });

  /**
   * 静态文件服务
   * 匹配: /task-static/t/:token/p/*filePath
   * 
   * 路由设计说明：
   * - 使用 /t/:token/p/ 分隔符结构，避免路由冲突
   * - Token 在 URL 路径中，HTML 相对路径资源自动继承 Token
   * - 例如：
   *   /task-static/t/abc123/p/input/index.html
   *   /task-static/t/abc123/p/input/assets/001.jpg  ← 相对路径自动继承 token
   * 
   * Note: path-to-regexp v8+ 使用 *filePath 语法匹配任意路径（wildcard）
   */
  router.get('/t/:token/p/*filePath', async (ctx) => {
    const { token, filePath } = ctx.params;
    const ipAddress = ctx.ip;
    const userAgent = ctx.get('User-Agent') || '';

    // 1. 验证 token 存在
    if (!token) {
      ctx.status = 401;
      ctx.body = 'Unauthorized: Missing token';
      return;
    }

    try {
      // 2. 查询数据库验证 token
      const tokenRows = await db.query(
        `SELECT tt.*, t.workspace_path 
         FROM task_token tt
         JOIN tasks t ON tt.task_id = t.id
         WHERE tt.token = ?`,
        [token]
      );

      if (!tokenRows || tokenRows.length === 0) {
        ctx.status = 401;
        ctx.body = 'Unauthorized: Invalid token';
        return;
      }

      const tokenRecord = tokenRows[0];

      // 3. 检查是否过期
      if (new Date() > new Date(tokenRecord.expires_at)) {
        ctx.status = 401;
        ctx.body = 'Unauthorized: Token expired';
        return;
      }

      // 4. 获取任务工作空间路径
      const workspacePath = tokenRecord.workspace_path;

      // 5. 构建完整文件路径
      const fullPath = path.join(WORKSPACE_ROOT, workspacePath, filePath);
      
      // 6. 安全检查：防止目录穿越
      const resolvedPath = path.resolve(fullPath);
      const taskWorkspacePath = path.resolve(WORKSPACE_ROOT, workspacePath);
      if (!resolvedPath.startsWith(taskWorkspacePath)) {
        ctx.status = 403;
        ctx.body = 'Forbidden: Path traversal detected';
        return;
      }

      // 7. 检查文件是否存在及大小限制
      let stats;
      try {
        stats = await fs.stat(resolvedPath);
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

      // 8. 记录访问日志（异步，不阻塞响应）
      db.insert(
        `INSERT INTO task_token_access_log (token_id, file_path, ip_address, user_agent)
         VALUES (?, ?, ?, ?)`,
        [tokenRecord.id, filePath, ipAddress, userAgent.substring(0, 512)]
      ).catch(err => console.error('Failed to log access:', err.message));

      // 9. 设置 Content-Type
      const ext = path.extname(resolvedPath).toLowerCase();
      ctx.type = CONTENT_TYPES[ext] || 'application/octet-stream';

      // 10. 设置缓存控制（预览场景不建议缓存）
      ctx.set('Cache-Control', 'no-store');

      // 11. 返回文件内容
      ctx.body = createReadStream(resolvedPath);

    } catch (error) {
      console.error('Task static file error:', error);
      ctx.status = 500;
      ctx.body = 'Internal server error';
    }
  });

  /**
   * 健康检查端点
   */
  router.get('/health', async (ctx) => {
    ctx.body = { status: 'ok', service: 'task-static' };
  });

  return router;
};