/**
 * Position Routes - 职位路由
 */

import Router from '@koa/router';
import PositionController from '../controllers/position.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

let positionController = null;

// 初始化控制器
const initController = (db) => {
  if (!positionController) {
    positionController = new PositionController(db);
  }
  return positionController;
};

export default (db) => {
  const router = new Router({ prefix: '/api/positions' });

  // 创建职位（管理员）
  router.post('/', authenticate(), requireAdmin(), async (ctx) => {
    await initController(db).createPosition(ctx);
  });

  // 获取部门下的所有职位（放在 /:id 前面，避免路由冲突）
  router.get('/department/:department_id', authenticate(), async (ctx) => {
    await initController(db).getDepartmentPositions(ctx);
  });

  // 获取职位详情
  router.get('/:id', authenticate(), async (ctx) => {
    await initController(db).getPosition(ctx);
  });

  // 更新职位（管理员）
  router.put('/:id', authenticate(), requireAdmin(), async (ctx) => {
    await initController(db).updatePosition(ctx);
  });

  // 删除职位（管理员）
  router.delete('/:id', authenticate(), requireAdmin(), async (ctx) => {
    await initController(db).deletePosition(ctx);
  });

  // 获取职位成员列表
  router.get('/:id/members', authenticate(), async (ctx) => {
    await initController(db).getPositionMembers(ctx);
  });

  return router;
};
