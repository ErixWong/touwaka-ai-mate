/**
 * KB v2 Routes - KB 路由迁移到 /api/docs/kb
 *
 * 全部 KB API 统一到 /api/docs/kb 前缀下
 * 与旧 /api/kb/* 一一对应，调用相同的 kbController 方法
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/docs/kb' });

  // ==================== 知识库路由 ====================
  router.get('/', authenticate(), controller.listKnowledgeBases.bind(controller));
  router.post('/', authenticate(), controller.createKnowledgeBase.bind(controller));
  router.get('/:kb_id', authenticate(), controller.getKnowledgeBase.bind(controller));
  router.put('/:kb_id', authenticate(), controller.updateKnowledgeBase.bind(controller));
  router.delete('/:kb_id', authenticate(), controller.deleteKnowledgeBase.bind(controller));
  router.post('/:kb_id/transfer-owner', authenticate(), controller.transferOwner.bind(controller));

  // ==================== 文章路由 ====================
  router.post('/:kb_id/articles/query', authenticate(), controller.queryArticles.bind(controller));
  router.get('/:kb_id/articles', authenticate(), controller.queryArticles.bind(controller));
  router.post('/:kb_id/articles', authenticate(), controller.createArticle.bind(controller));
  router.get('/:kb_id/articles/:id', authenticate(), controller.getArticle.bind(controller));
  router.put('/:kb_id/articles/:id', authenticate(), controller.updateArticle.bind(controller));
  router.delete('/:kb_id/articles/:id', authenticate(), controller.deleteArticle.bind(controller));
  router.get('/:kb_id/articles/:article_id/tree', authenticate(), controller.getArticleTree.bind(controller));

  // ==================== 节路由 ====================
  router.post('/:kb_id/sections/query', authenticate(), controller.querySections.bind(controller));
  router.post('/:kb_id/sections', authenticate(), controller.createSection.bind(controller));
  router.put('/:kb_id/sections/:id', authenticate(), controller.updateSection.bind(controller));
  router.post('/:kb_id/sections/:id/move', authenticate(), controller.moveSection.bind(controller));
  router.delete('/:kb_id/sections/:id', authenticate(), controller.deleteSection.bind(controller));

  // ==================== 段落路由 ====================
  router.post('/:kb_id/paragraphs/query', authenticate(), controller.queryParagraphs.bind(controller));
  router.post('/:kb_id/paragraphs', authenticate(), controller.createParagraph.bind(controller));
  router.put('/:kb_id/paragraphs/:id', authenticate(), controller.updateParagraph.bind(controller));
  router.post('/:kb_id/paragraphs/:id/move', authenticate(), controller.moveParagraph.bind(controller));
  router.delete('/:kb_id/paragraphs/:id', authenticate(), controller.deleteParagraph.bind(controller));

  // ==================== 标签路由 ====================
  router.post('/:kb_id/tags/query', authenticate(), controller.queryTags.bind(controller));
  router.get('/:kb_id/tags', authenticate(), controller.queryTags.bind(controller));
  router.post('/:kb_id/tags', authenticate(), controller.createTag.bind(controller));
  router.put('/:kb_id/tags/:id', authenticate(), controller.updateTag.bind(controller));
  router.delete('/:kb_id/tags/:id', authenticate(), controller.deleteTag.bind(controller));

  // ==================== 向量化路由 ====================
  router.post('/:kb_id/revectorize', authenticate(), controller.startRevectorize.bind(controller));
  router.get('/:kb_id/revectorize/:jobId', authenticate(), controller.getRevectorizeProgress.bind(controller));

  return router;
};
