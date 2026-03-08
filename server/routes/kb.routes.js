/**
 * KB Routes - 新知识库路由
 *
 * 层级结构：
 * /api/kb/:kb_id/articles - 文章列表
 * /api/kb/:kb_id/articles/:article_id/tree - 文章节树
 * /api/kb/:kb_id/sections - 节列表
 * /api/kb/:kb_id/paragraphs - 段落列表
 * /api/kb/:kb_id/tags - 标签列表
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/kb' });

  // ==================== 文章路由 ====================

  // 复杂查询文章列表
  router.post('/:kb_id/articles/query', authenticate(), controller.queryArticles.bind(controller));

  // 获取文章列表
  router.get('/:kb_id/articles', authenticate(), controller.queryArticles.bind(controller));

  // 创建文章
  router.post('/:kb_id/articles', authenticate(), controller.createArticle.bind(controller));

  // 获取文章详情
  router.get('/:kb_id/articles/:id', authenticate(), controller.getArticle.bind(controller));

  // 更新文章
  router.put('/:kb_id/articles/:id', authenticate(), controller.updateArticle.bind(controller));

  // 删除文章
  router.delete('/:kb_id/articles/:id', authenticate(), controller.deleteArticle.bind(controller));

  // 获取文章节树
  router.get('/:kb_id/articles/:article_id/tree', authenticate(), controller.getArticleTree.bind(controller));

  // ==================== 节路由 ====================

  // 复杂查询节列表
  router.post('/:kb_id/sections/query', authenticate(), controller.querySections.bind(controller));

  // 创建节
  router.post('/:kb_id/sections', authenticate(), controller.createSection.bind(controller));

  // 更新节
  router.put('/:kb_id/sections/:id', authenticate(), controller.updateSection.bind(controller));

  // 移动节
  router.post('/:kb_id/sections/:id/move', authenticate(), controller.moveSection.bind(controller));

  // 删除节
  router.delete('/:kb_id/sections/:id', authenticate(), controller.deleteSection.bind(controller));

  // ==================== 段落路由 ====================

  // 复杂查询段落列表
  router.post('/:kb_id/paragraphs/query', authenticate(), controller.queryParagraphs.bind(controller));

  // 创建段落
  router.post('/:kb_id/paragraphs', authenticate(), controller.createParagraph.bind(controller));

  // 更新段落
  router.put('/:kb_id/paragraphs/:id', authenticate(), controller.updateParagraph.bind(controller));

  // 移动段落
  router.post('/:kb_id/paragraphs/:id/move', authenticate(), controller.moveParagraph.bind(controller));

  // 删除段落
  router.delete('/:kb_id/paragraphs/:id', authenticate(), controller.deleteParagraph.bind(controller));

  // ==================== 标签路由 ====================

  // 复杂查询标签列表
  router.post('/:kb_id/tags/query', authenticate(), controller.queryTags.bind(controller));

  // 获取标签列表
  router.get('/:kb_id/tags', authenticate(), controller.queryTags.bind(controller));

  // 创建标签
  router.post('/:kb_id/tags', authenticate(), controller.createTag.bind(controller));

  // 更新标签
  router.put('/:kb_id/tags/:id', authenticate(), controller.updateTag.bind(controller));

  // 删除标签
  router.delete('/:kb_id/tags/:id', authenticate(), controller.deleteTag.bind(controller));

  return router;
};
