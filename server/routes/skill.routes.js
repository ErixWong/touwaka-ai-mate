/**
 * Skill Routes - 技能路由
 */

import Router from '@koa/router';
import multer from '@koa/multer';

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

  // GET /api/skills - 获取技能列表
  router.get('/', controller.list.bind(controller));

  // GET /api/skills/:id - 获取技能详情
  router.get('/:id', controller.get.bind(controller));

  // POST /api/skills/from-url - 从 URL 安装
  router.post('/from-url', controller.installFromUrl.bind(controller));

  // POST /api/skills/from-zip - 从 ZIP 安装
  router.post('/from-zip', upload.single('file'), controller.installFromZip.bind(controller));

  // POST /api/skills/from-path - 从本地目录安装
  router.post('/from-path', controller.installFromPath.bind(controller));

  // PUT /api/skills/:id - 更新技能
  router.put('/:id', controller.update.bind(controller));

  // DELETE /api/skills/:id - 删除技能
  router.delete('/:id', controller.delete.bind(controller));

  // POST /api/skills/:id/reanalyze - 重新分析技能
  router.post('/:id/reanalyze', controller.reanalyze.bind(controller));

  // GET /api/skills/:id/parameters - 获取技能参数
  router.get('/:id/parameters', controller.getParameters.bind(controller));

  // POST /api/skills/:id/parameters - 保存技能参数（全量替换）
  router.post('/:id/parameters', controller.saveParameters.bind(controller));

  return router;
}
