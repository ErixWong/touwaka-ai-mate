/**
 * Skill Routes - 技能路由
 */

import Router from '@koa/router';
import multer from '@koa/multer';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

// 配置 multer 用于文件上传
const upload = multer({
  dest: 'temp/uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

/**
 * 创建路由实例
 * @param {object} controller - SkillController 实例
 */
export default function createSkillRoutes(controller) {
  const router = new Router({ prefix: '/api/skills' });

  // ==================== 只读操作（需要认证）====================

  // GET /api/skills - 获取技能列表
  router.get('/', authenticate(), controller.list.bind(controller));

  // GET /api/skills/:id - 获取技能详情
  router.get('/:id', authenticate(), controller.get.bind(controller));

  // GET /api/skills/:id/parameters - 获取技能参数
  router.get('/:id/parameters', authenticate(), controller.getParameters.bind(controller));

  // ==================== 写入操作（需要管理员权限）====================

  // POST /api/skills/from-url - 从 URL 安装
  router.post('/from-url', authenticate(), requireAdmin(), controller.installFromUrl.bind(controller));

  // POST /api/skills/from-zip - 从 ZIP 安装
  router.post('/from-zip', authenticate(), requireAdmin(), upload.single('file'), controller.installFromZip.bind(controller));

  // POST /api/skills/from-path - 从本地目录安装
  router.post('/from-path', authenticate(), requireAdmin(), controller.installFromPath.bind(controller));

  // PUT /api/skills/:id - 更新技能
  router.put('/:id', authenticate(), requireAdmin(), controller.update.bind(controller));

  // DELETE /api/skills/:id - 删除技能
  router.delete('/:id', authenticate(), requireAdmin(), controller.delete.bind(controller));

  // POST /api/skills/:id/reanalyze - 重新分析技能
  router.post('/:id/reanalyze', authenticate(), requireAdmin(), controller.reanalyze.bind(controller));

  // POST /api/skills/:id/parameters - 保存技能参数（全量替换）
  router.post('/:id/parameters', authenticate(), requireAdmin(), controller.saveParameters.bind(controller));

  // ==================== Skills Studio API（需要管理员权限）====================

  // POST /api/skills/register - 注册技能（从本地路径）
  router.post('/register', authenticate(), requireAdmin(), controller.register.bind(controller));

  // POST /api/skills/assign - 分配技能给专家
  router.post('/assign', authenticate(), requireAdmin(), controller.assign.bind(controller));

  // POST /api/skills/unassign - 取消技能分配
  router.post('/unassign', authenticate(), requireAdmin(), controller.unassign.bind(controller));

  // PATCH /api/skills/:id/toggle - 启用/禁用技能
  router.patch('/:id/toggle', authenticate(), requireAdmin(), controller.toggle.bind(controller));

  return router;
}
