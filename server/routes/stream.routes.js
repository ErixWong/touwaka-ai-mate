/**
 * Stream Routes - SSE 流式路由
 * 注意：聊天相关路由已移至 chat.routes.js
 * 此文件保留用于未来其他流式功能
 */

import Router from '@koa/router';

export default (controller) => {
  const router = new Router({ prefix: '/api/stream' });

  // 预留未来其他流式功能

  return router;
};
