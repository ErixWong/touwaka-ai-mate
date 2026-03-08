/**
 * Department Routes - 部门路由
 */

import Router from '@koa/router';
import DepartmentController from '../controllers/department.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

let departmentController = null;

// 初始化控制器
const initController = (db) => {
  if (!departmentController) {
    departmentController = new DepartmentController(db);
  }
  return departmentController;
};

export default (db) => {
  const router = new Router({ prefix: '/api/departments' });

  // 获取部门树（需要登录）
  router.get('/tree', authenticate(), async (ctx) => {
    await initController(db).getDepartmentTree(ctx);
  });

  // 创建部门（管理员）
  router.post('/', authenticate(), requireAdmin(), async (ctx) => {
    await initController(db).createDepartment(ctx);
  });

  // 获取部门详情
  router.get('/:id', authenticate(), async (ctx) => {
    await initController(db).getDepartment(ctx);
  });

  // 更新部门（管理员）
  router.put('/:id', authenticate(), requireAdmin(), async (ctx) => {
    await initController(db).updateDepartment(ctx);
  });

  // 删除部门（管理员）
  router.delete('/:id', authenticate(), requireAdmin(), async (ctx) => {
    await initController(db).deleteDepartment(ctx);
  });

  // 获取部门职位列表
  router.get('/:id/positions', authenticate(), async (ctx) => {
    await initController(db).getDepartmentPositions(ctx);
  });

  // 获取部门负责人
  router.get('/:id/managers', authenticate(), async (ctx) => {
    await initController(db).getDepartmentManagers(ctx);
  });

  return router;
};
