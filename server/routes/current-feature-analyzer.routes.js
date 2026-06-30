/**
 * 桥接层：主工程 → app 内路由实现
 *
 * 真实路由实现位于 apps/current-feature-analyzer/server/routes.js
 * 本文件仅作为薄封装保留，以确保 server/index.js 现有注册方式不受影响。
 *
 * 路由主入口: /api/current-feature-analyzer/*
 * Legacy 兼容: /api/apps/current-feature-analyzer/* (deprecated, 带 X-Deprecated header)
 */
import createAppRoutes from '../../apps/current-feature-analyzer/server/routes.js';

export default (controller) => {
  return createAppRoutes({ db: controller.db });
};