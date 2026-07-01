/**
 * App Wildcard Router
 * 
 * 约定大于配置：直接映射 handler 文件，无需显式路由声明
 * 
 * 详细规范见：docs/apps/wildcard-handler-spec.md
 * 
 * URL 映射规则：
 *   /api/apps/{appId}/xxx/yyy → apps/{appId}/server/handlers/xxx.js
 * 
 * 例如：
 *   GET /api/apps/ocr-tool/analyze/123 → apps/ocr-tool/server/handlers/analyze.js
 *   GET /api/apps/ocr-tool/status     → apps/ocr-tool/server/handlers/status.js
 * 
 * ==========================================
 * 快速入门
 * ==========================================
 * 
 * 1. 创建 handler 文件：apps/{appId}/server/handlers/xxx.js
 * 2. 导出 get/post/put/delete/patch 方法
 * 3. 接收 (ctx, deps) 参数
 * 
 * 完整规范请阅读：docs/apps/wildcard-handler-spec.md
 * 
 * @param {Object} db - Sequelize 实例
 * @param {Object} options - 配置项
 * @param {Function} options.authMiddleware - 认证中间件（可选）
 * @returns {Function} Koa 中间件
 */

import logger from '../../lib/logger.js';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import AppRuntimeLoader from '../../lib/app-runtime-loader.js';

const APPS_DIR = path.join(process.cwd(), 'apps');
const HANDLERS_DIR = 'server/handlers';

/**
 * 解析 handler 文件路径
 * 从 URL 路径逐级尝试匹配 handler 文件
 */
function resolveHandlerPath(appInternalPath, method) {
  const segments = appInternalPath.split('/').filter(Boolean);
  
  if (segments.length === 0) {
    return null;
  }

  const handlerSegments = [];
  const params = {};

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    handlerSegments.push(seg);
    
    const handlerPath = path.join(HANDLERS_DIR, ...handlerSegments) + '.js';
    
    const fullPath = path.join(APPS_DIR, handlerPath);
    if (fs.existsSync(fullPath)) {
      const remainingSegments = segments.slice(i + 1);
      for (let j = 0; j < remainingSegments.length; j++) {
        params[`p${j}`] = remainingSegments[j];
      }
      return { handlerPath, params, remainingPath: remainingSegments.join('/') };
    }
  }

  return null;
}

async function loadHandler(appId, handlerPath, appsDir) {
  const fullPath = path.join(appsDir, appId, handlerPath);
  const normalizedPath = path.normalize(fullPath);

  if (!normalizedPath.startsWith(path.normalize(appsDir))) {
    throw new Error(`Handler path not allowed: ${handlerPath}`);
  }

  const cacheBuster = process.env.NODE_ENV === 'development' ? `?t=${Date.now()}` : '';
  const module = await import(`${pathToFileURL(normalizedPath).href}${cacheBuster}`);

  return module;
}

/**
 * 构建 handler 依赖注入
 * 传递 db、app 信息和服务方法给 handler
 */
function buildDeps(db, appId, appRecord = null) {
  const Sequelize = db.sequelize.constructor;

  return {
    db,
    appId,
    app: appRecord,
    services: {
      query: async (sql, replacements = []) => {
        return await db.sequelize.query(sql, {
          replacements,
          type: Sequelize.QueryTypes.SELECT,
        });
      },
      execute: async (sql, replacements = []) => {
        return await db.sequelize.query(sql, {
          replacements,
          type: Sequelize.QueryTypes.RAW,
        });
      },
      getModel: (modelName) => {
        return db.getModel(modelName);
      },
      log: (level, message, meta = {}) => {
        if (level === 'error') {
          logger.error(`[App:${appId}] ${message}`, meta);
        } else if (level === 'warn') {
          logger.warn(`[App:${appId}] ${message}`, meta);
        } else {
          logger.info(`[App:${appId}] ${message}`, meta);
        }
      },
    },
  };
}

export function createAppWildcardRouter(db, options = {}) {
  const runtimeLoader = options.runtimeLoader || new AppRuntimeLoader(db, APPS_DIR);
  const authMiddleware = options.authMiddleware || null;
  const handlerCache = new Map();

  const cacheManager = {
    clearAppCache(appId) {
      runtimeLoader.clearCache(appId);
      for (const key of handlerCache.keys()) {
        if (key.startsWith(`handler:${appId}:`)) {
          handlerCache.delete(key);
        }
      }
      logger.info(`[WildcardRouter] Cache cleared for ${appId}`);
    },
  };

  if (options.onCacheReady) {
    options.onCacheReady(cacheManager);
  }

  async function getHandler(appId, handlerPath) {
    const cacheKey = `handler:${appId}:${handlerPath}`;

    if (handlerCache.has(cacheKey) && process.env.NODE_ENV !== 'development') {
      return handlerCache.get(cacheKey);
    }

    const module = await loadHandler(appId, handlerPath, APPS_DIR);
    handlerCache.set(cacheKey, module);
    return module;
  }

  return async function appWildcardRouter(ctx, next) {
    // 仅处理 /api/apps/ 开头的请求
    if (!ctx.path.startsWith('/api/apps/')) {
      return await next();
    }

    const pathParts = ctx.path.slice('/api/apps/'.length).split('/');
    const appId = pathParts[0];

    if (!appId) {
      ctx.error('Missing appId in path', 400);
      return;
    }

    const appInternalPath = '/' + pathParts.slice(1).join('/');
    const requestSegments = pathParts.slice(1);
    const method = ctx.method.toUpperCase();

    // 可选：统一认证
    if (authMiddleware) {
      await authMiddleware(ctx, async () => {});
      if (ctx.status === 401 || ctx.status === 403) {
        return;
      }
    }

    try {
      const MiniApp = db.getModel('mini_app');

      if (!MiniApp) {
        ctx.error(`mini_app model not available`, 500);
        return;
      }

      // 校验 app 是否存在且已启用
      const appRecord = await MiniApp.findOne({ where: { id: appId } });

      if (!appRecord) {
        logger.info(`[WildcardRouter] App "${appId}" not found in mini_apps, passing to next middleware`);
        return await next();
      }

      if (!appRecord.is_active) {
        ctx.error(`App "${appId}" is not active`, 404);
        return;
      }

      // 解析 handler 文件路径
      const handlerInfo = resolveHandlerPath(appInternalPath, method);

      if (!handlerInfo) {
        logger.info(`[WildcardRouter] No handler for "${appInternalPath}", passing to next middleware`);
        return await next();
      }

      const { handlerPath, params, remainingPath } = handlerInfo;
      const handlerModule = await getHandler(appId, handlerPath);
      
      const methodLower = method.toLowerCase();
      let handlerFn = handlerModule[methodLower];

      // 尝试从 default 导出获取
      if (!handlerFn && handlerModule.default) {
        handlerFn = handlerModule.default[methodLower] || handlerModule.default;
      }

      // 检查方法是否支持
      if (!handlerFn && Object.keys(handlerModule).length > 0) {
        const availableMethods = Object.keys(handlerModule).filter(k => k !== 'default');
        ctx.error(`Method ${method} not allowed for "${appInternalPath}"`, 405);
        ctx.body.data = { allowed_methods: availableMethods };
        return;
      }

      if (!handlerFn || typeof handlerFn !== 'function') {
        ctx.error(`Handler for "${appInternalPath}" is not a function`, 500);
        return;
      }

      // 注入路径参数到 ctx.params
      ctx.params = { ...ctx.params, ...params };
      if (remainingPath) {
        ctx.params._ = remainingPath;
      }

      // 构建依赖注入
      const deps = buildDeps(db, appId, appRecord);

      logger.info(`[WildcardRouter] ${method} ${ctx.path} -> ${appId}:${handlerPath}:${methodLower}`);

      // 执行 handler
      await handlerFn(ctx, deps);

    } catch (err) {
      logger.error(`[WildcardRouter] Error handling ${ctx.path}: ${err.message}`, err.stack);

      if (err.message.includes('not allowed')) {
        ctx.error('Handler path not allowed', 403);
        return;
      }

      // handler 文件不存在，传递给下一个中间件
      if (err.message.includes('not found') || err.code === 'ENOENT') {
        logger.info(`[WildcardRouter] No handler for "${appInternalPath}", passing to next middleware`);
        return await next();
      }

      ctx.error(err.message || 'Internal server error', 500);
    }
  };
}

export function clearWildcardCache(appId, appsDir = APPS_DIR) {
  logger.info(`[WildcardRouter] Cache clear requested for ${appId}`);
}