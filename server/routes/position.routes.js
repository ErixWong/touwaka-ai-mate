/**
 * Position Routes - 职位路由
 */

import Router from '@koa/router';
import PositionController from '../controllers/position.controller.js';
import { authenticate } from '../middlewares/auth.js';

export default function createPositionRoutes(db) {
  const router = new Router({ prefix: '/api/positions' });
  const positionController = new PositionController(db);

  // 创建职位（管理员）
  router.post('/', authenticate(), async (ctx) => {
    await positionController.createPosition(ctx);
  });

  // 获取部门下的所有职位
  router.get('/department/:department_id', authenticate(), async (ctx) => {
    await positionController.getDepartmentPositions(ctx);
  });

  // 获取职位详情
  router.get('/:id', authenticate(), async (ctx) => {
    await positionController.getPosition(ctx);
  });

  // 更新职位（管理员）
  router.put('/:id', authenticate(), async (ctx) => {
    await positionController.updatePosition(ctx);
  });

  // 删除职位（管理员）
  router.delete('/:id', authenticate(), async (ctx) => {
    await positionController.deletePosition(ctx);
  });

  // 获取职位成员列表
  router.get('/:id/members', authenticate(), async (ctx) => {
    await positionController.getPositionMembers(ctx);
  });

  return router;
}
