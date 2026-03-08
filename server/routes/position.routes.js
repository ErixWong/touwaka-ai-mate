/**
 * Position Routes - 职位路由
 */

import Router from '@koa/router';
import PositionController from '../controllers/position.controller.js';
import authMiddleware from '../middlewares/auth.js';

const router = new Router({ prefix: '/api/positions' });

let positionController = null;

// 初始化控制器
const initController = (db) => {
  if (!positionController) {
    positionController = new PositionController(db);
  }
  return positionController;
};

// 创建职位（管理员）
router.post('/', authMiddleware, async (ctx) => {
  await initController(ctx.db).createPosition(ctx);
});

// 获取职位详情
router.get('/:id', authMiddleware, async (ctx) => {
  await initController(ctx.db).getPosition(ctx);
});

// 更新职位（管理员）
router.put('/:id', authMiddleware, async (ctx) => {
  await initController(ctx.db).updatePosition(ctx);
});

// 删除职位（管理员）
router.delete('/:id', authMiddleware, async (ctx) => {
  await initController(ctx.db).deletePosition(ctx);
});

// 获取职位成员列表
router.get('/:id/members', authMiddleware, async (ctx) => {
  await initController(ctx.db).getPositionMembers(ctx);
});

// 获取部门下的所有职位
router.get('/department/:department_id', authMiddleware, async (ctx) => {
  await initController(ctx.db).getDepartmentPositions(ctx);
});

export default router;
