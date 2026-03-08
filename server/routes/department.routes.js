/**
 * Department Routes - 部门路由
 */

import Router from '@koa/router';
import DepartmentController from '../controllers/department.controller.js';
import authMiddleware from '../middlewares/auth.js';

const router = new Router({ prefix: '/api/departments' });

let departmentController = null;

// 初始化控制器
const initController = (db) => {
  if (!departmentController) {
    departmentController = new DepartmentController(db);
  }
  return departmentController;
};

// 获取部门树（需要登录）
router.get('/tree', authMiddleware, async (ctx) => {
  await initController(ctx.db).getDepartmentTree(ctx);
});

// 创建部门（管理员）
router.post('/', authMiddleware, async (ctx) => {
  await initController(ctx.db).createDepartment(ctx);
});

// 获取部门详情
router.get('/:id', authMiddleware, async (ctx) => {
  await initController(ctx.db).getDepartment(ctx);
});

// 更新部门（管理员）
router.put('/:id', authMiddleware, async (ctx) => {
  await initController(ctx.db).updateDepartment(ctx);
});

// 删除部门（管理员）
router.delete('/:id', authMiddleware, async (ctx) => {
  await initController(ctx.db).deleteDepartment(ctx);
});

// 获取部门职位列表
router.get('/:id/positions', authMiddleware, async (ctx) => {
  await initController(ctx.db).getDepartmentPositions(ctx);
});

// 获取部门负责人
router.get('/:id/managers', authMiddleware, async (ctx) => {
  await initController(ctx.db).getDepartmentManagers(ctx);
});

export default router;
