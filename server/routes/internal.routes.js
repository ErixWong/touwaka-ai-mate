/**
 * Internal Routes - 内部 API 路由
 * 
 * 用于服务间通信，不走用户认证
 * 
 * API 设计：
 * - POST /internal/messages/insert - 插入消息并触发专家响应
 * - GET /internal/models/:model_id - 获取模型配置（含 Provider 信息）
 * - GET /internal/models/resolve?name=xxx - 通过名称解析模型 ID
 * - POST /internal/resident/invoke - 调用驻留式技能工具
 */

import Router from '@koa/router';

/**
 * 创建内部路由
 * @param {Object} controller - InternalController 实例
 * @returns {Router}
 */
export default function createInternalRoutes(controller) {
  const router = new Router({
    prefix: '/internal'
  });

  // 消息插入 API
  router.post('/messages/insert', controller.insertMessage.bind(controller));

  // 通过名称解析模型 ID（必须在 /:model_id 之前注册）
  router.get('/models/resolve', controller.resolveModelName.bind(controller));

  // 获取模型配置 API
  router.get('/models/:model_id', controller.getModelConfig.bind(controller));

  // 调用驻留式技能工具 API
  router.post('/resident/invoke', controller.invokeResidentTool.bind(controller));

  return router;
}