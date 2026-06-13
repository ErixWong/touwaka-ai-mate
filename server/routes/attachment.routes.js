/**
 * Attachment Routes - 附件服务路由
 *
 * Issue #557: 实现通用附件服务
 * Issue #001: Attachment 访问级别与统一接入改造
 * API 设计：
 * POST   /api/attachments           - 上传附件 (base64)
 * POST   /api/attachments/upload    - 上传附件 (FormData)
 * POST   /api/attachments/batch     - 批量上传
 * GET    /api/attachments/:id       - 获取附件元数据（不再返回 data_url）
 * GET    /api/attachments/:id/content - 获取附件文件流（需认证）
 * POST   /api/attachments/meta      - 批量获取元信息
 * GET    /api/attachments           - 列出资源附件（query: source_tag, source_id）
 * GET    /api/attachments/admin     - 管理员列表（支持分页和筛选）
 * DELETE /api/attachments/:id       - 删除附件
 * POST   /api/attachments/token     - 生成资源级 Token
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';
import multer from '@koa/multer';

const createUploadMiddleware = () => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
  });
  return upload.single('file');
};

export default (controller) => {
  const router = new Router({ prefix: '/api/attachments' });

  router.post('/', authenticate(), (ctx) => controller.upload(ctx));

  router.post('/upload', authenticate(), createUploadMiddleware(), (ctx) => controller.uploadFormData(ctx));

  router.post('/batch', authenticate(), (ctx) => controller.uploadBatch(ctx));

  router.post('/meta', authenticate(), (ctx) => controller.getMeta(ctx));

  router.post('/token', authenticate(), (ctx) => controller.generateToken(ctx));

  router.get('/admin', authenticate(), (ctx) => controller.listAdmin(ctx));

  router.get('/', authenticate(), (ctx) => controller.list(ctx));

  router.get('/:id', authenticate(), (ctx) => controller.get(ctx));

  router.get('/:id/content', authenticate(), (ctx) => controller.getContent(ctx));

  router.delete('/:id', authenticate(), (ctx) => controller.delete(ctx));

  return router;
};
