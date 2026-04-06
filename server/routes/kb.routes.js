/**
 * KB Routes - 新知识库路由
 *
 * 层级结构：
 * /api/kb - 知识库列表
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

  // ==================== 知识库路由 ====================

  // 获取知识库列表
  router.get('/', authenticate(), controller.listKnowledgeBases.bind(controller));

  // 创建知识库
  router.post('/', authenticate(), controller.createKnowledgeBase.bind(controller));

  // 获取知识库详情
  router.get('/:kb_id', authenticate(), controller.getKnowledgeBase.bind(controller));

  // 更新知识库
  router.put('/:kb_id', authenticate(), controller.updateKnowledgeBase.bind(controller));

  // 删除知识库
  router.delete('/:kb_id', authenticate(), controller.deleteKnowledgeBase.bind(controller));

  // 转移知识库 owner（仅 admin）
  router.post('/:kb_id/transfer-owner', authenticate(), controller.transferOwner.bind(controller));

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

  // ==================== 搜索路由 ====================
  // ⚠️ 注意：静态路由必须在动态路由（/:kb_id）之前定义！

  // 全局搜索（搜索用户所有知识库）- 静态路由，必须在前
  router.post('/search', authenticate(), controller.globalSearch.bind(controller));

  // 在指定知识库中搜索 - 动态路由
  router.post('/:kb_id/search', authenticate(), controller.searchInKnowledgeBase.bind(controller));

  // ==================== 召回路由 (Issue #558) ====================
  // ⚠️ 注意：静态路由必须在动态路由（/:kb_id）之前定义！

  // 全局召回（搜索用户所有可访问的知识库）- 静态路由，必须在前
  router.post('/recall', authenticate(), controller.globalRecall.bind(controller));

  // 单知识库召回（支持图文召回、上下文增强）- 动态路由
  router.post('/:kb_id/recall', authenticate(), controller.recallKnowledge.bind(controller));

  // ==================== 向量化路由 ====================

  // 重新向量化知识库所有段落
  router.post('/:kb_id/revectorize', authenticate(), controller.startRevectorize.bind(controller));

  // 获取重新向量化进度
  router.get('/:kb_id/revectorize/:jobId', authenticate(), controller.getRevectorizeProgress.bind(controller));

  return router;
};
