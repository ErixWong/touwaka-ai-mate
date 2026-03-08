/**
 * Department Routes - 部门路由
 */

import Router from '@koa/router';
import DepartmentController from '../controllers/department.controller.js';
import { authenticate } from '../middlewares/auth.js';

export default function createDepartmentRoutes(db) {
  const router = new Router({ prefix: '/api/departments' });
  const departmentController = new DepartmentController(db);

  // 获取部门树（需要登录）
  router.get('/tree', authenticate(), async (ctx) => {
    await departmentController.getDepartmentTree(ctx);
  });

  // 创建部门（管理员）
  router.post('/', authenticate(), async (ctx) => {
    await departmentController.createDepartment(ctx);
  });

  // 获取部门详情
  router.get('/:id', authenticate(), async (ctx) => {
    await departmentController.getDepartment(ctx);
  });

  // 更新部门（管理员）
  router.put('/:id', authenticate(), async (ctx) => {
    await departmentController.updateDepartment(ctx);
  });

  // 删除部门（管理员）
  router.delete('/:id', authenticate(), async (ctx) => {
    await departmentController.deleteDepartment(ctx);
  });

  // 获取部门职位列表
  router.get('/:id/positions', authenticate(), async (ctx) => {
    await departmentController.getDepartmentPositions(ctx);
  });

  // 获取部门负责人
  router.get('/:id/managers', authenticate(), async (ctx) => {
    await departmentController.getDepartmentManagers(ctx);
  });

  return router;
}
