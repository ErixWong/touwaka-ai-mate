/**
 * Attachment Routes - 附件服务路由
 *
 * Issue #557: 实现通用附件服务
 * API 设计：
 * POST   /api/attachments           - 上传附件
 * POST   /api/attachments/batch     - 批量上传
 * GET    /api/attachments/:id      - 获取附件（返回 data_url）
 * POST   /api/attachments/meta      - 批量获取元信息
 * GET    /api/attachments            - 列出资源附件（query: source_tag, source_id）
 * DELETE /api/attachments/:id        - 删除附件
 * POST   /api/attachments/token     - 生成资源级 Token
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/attachments' });

  // 上传附件
  router.post('/', authenticate(), (ctx) => controller.upload(ctx));

  // 批量上传
  router.post('/batch', authenticate(), (ctx) => controller.uploadBatch(ctx));

  // 批量获取元信息（轻量级）
  router.post('/meta', authenticate(), (ctx) => controller.getMeta(ctx));

  // 生成资源级 Token
  router.post('/token', authenticate(), (ctx) => controller.generateToken(ctx));

  // 列出资源附件（query: source_tag, source_id）
  router.get('/', authenticate(), (ctx) => controller.list(ctx));

  // 获取附件详情（返回 data_url）
  router.get('/:id', authenticate(), (ctx) => controller.get(ctx));

  // 删除附件
  router.delete('/:id', authenticate(), (ctx) => controller.delete(ctx));

  return router;
};
