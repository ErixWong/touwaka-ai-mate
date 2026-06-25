/**
 * 桥接层：主工程 → app 内路由实现
 *
 * 真实路由实现位于 apps/current-feature-analyzer/server/routes.js
 * 本文件仅作为薄封装保留，以确保 server/index.js 现有注册方式不受影响。
 *
 * 路由统一挂载在 /api/apps/current-feature-analyzer/*
 */
import createAppRoutes from '../../apps/current-feature-analyzer/server/routes.js';

export default (controller) => {
  return createAppRoutes({ db: controller.db });
};