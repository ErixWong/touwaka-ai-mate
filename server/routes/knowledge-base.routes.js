/**
 * Knowledge Base Routes - 知识库路由
 *
 * 层级结构：
 * /api/kb - 知识库列表
 * /api/kb/:kb_id/knowledges - 文章列表
 * /api/kb/:kb_id/knowledges/:id/points - 知识点列表
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/kb' });

  // ==================== 知识库路由 ====================

  // 复杂查询知识库列表
  router.post('/query', authenticate(), controller.queryKbs.bind(controller));

  // 获取知识库列表
  router.get('/', authenticate(), controller.listKbs.bind(controller));

  // 创建知识库
  router.post('/', authenticate(), controller.createKb.bind(controller));

  // 获取知识库详情
  router.get('/:id', authenticate(), controller.getKb.bind(controller));

  // 更新知识库
  router.put('/:id', authenticate(), controller.updateKb.bind(controller));

  // 删除知识库
  router.delete('/:id', authenticate(), controller.deleteKb.bind(controller));

  // ==================== 文章路由 ====================

  // 复杂查询文章列表
  router.post('/:kb_id/knowledges/query', authenticate(), controller.queryKnowledges.bind(controller));

  // 获取文章树状结构
  router.get('/:kb_id/knowledges/tree', authenticate(), controller.getKnowledgeTree.bind(controller));

  // 创建文章
  router.post('/:kb_id/knowledges', authenticate(), controller.createKnowledge.bind(controller));

  // 获取文章详情
  router.get('/:kb_id/knowledges/:id', authenticate(), controller.getKnowledge.bind(controller));

  // 更新文章
  router.put('/:kb_id/knowledges/:id', authenticate(), controller.updateKnowledge.bind(controller));

  // 删除文章
  router.delete('/:kb_id/knowledges/:id', authenticate(), controller.deleteKnowledge.bind(controller));

  // ==================== 知识点路由 ====================

  // 获取知识点列表
  router.get('/:kb_id/knowledges/:knowledge_id/points', authenticate(), controller.listPoints.bind(controller));

  // 创建知识点
  router.post('/:kb_id/knowledges/:knowledge_id/points', authenticate(), controller.createPoint.bind(controller));

  // 获取知识点详情
  router.get('/:kb_id/knowledges/:knowledge_id/points/:id', authenticate(), controller.getPoint.bind(controller));

  // 更新知识点
  router.put('/:kb_id/knowledges/:knowledge_id/points/:id', authenticate(), controller.updatePoint.bind(controller));

  // 删除知识点
  router.delete('/:kb_id/knowledges/:knowledge_id/points/:id', authenticate(), controller.deletePoint.bind(controller));

  return router;
};