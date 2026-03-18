/**
 * Solution Routes - 解决方案路由
 *
 * API 设计：
 * GET    /api/solutions           - 获取解决方案列表
 * POST   /api/solutions/query     - 复杂查询
 * GET    /api/solutions/tags      - 获取所有标签
 * GET    /api/solutions/:id       - 获取详情（按 ID）
 * GET    /api/solutions/slug/:slug - 获取详情（按 slug）
 * POST   /api/solutions           - 创建解决方案（管理员）
 * PUT    /api/solutions/:id       - 更新解决方案（管理员）
 * DELETE /api/solutions/:id       - 删除解决方案（管理员）
 * POST   /api/solutions/:id/tasks - 从解决方案创建任务
 * POST   /api/solutions/:id/validate - 验证启动条件
 */

import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middleware/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/solutions' });

  // ==================== 公开路由 ====================

  // 获取所有可用标签（放在 /:id 之前）
  router.get('/tags', (ctx) => controller.listTags(ctx));

  // 复杂查询
  router.post('/query', authenticate(), (ctx) => controller.list(ctx));

  // 获取解决方案列表
  router.get('/', authenticate(), (ctx) => controller.list(ctx));

  // 按 slug 获取详情（放在 /:id 之前）
  router.get('/slug/:slug', authenticate(), (ctx) => controller.get(ctx));

  // 获取解决方案详情
  router.get('/:id', authenticate(), (ctx) => controller.get(ctx));

  // ==================== 管理员路由 ====================

  // 创建解决方案
  router.post('/', authenticate(), requireAdmin(), (ctx) => controller.create(ctx));

  // 更新解决方案
  router.put('/:id', authenticate(), requireAdmin(), (ctx) => controller.update(ctx));

  // 删除解决方案（软删除）
  router.delete('/:id', authenticate(), requireAdmin(), (ctx) => controller.delete(ctx));

  // ==================== 任务相关 ====================

  // 从解决方案创建任务
  router.post('/:id/tasks', authenticate(), (ctx) => controller.createTask(ctx));

  // 验证启动条件
  router.post('/:id/validate', authenticate(), (ctx) => controller.validate(ctx));

  return router;
};