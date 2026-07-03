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
 * Handler 级元数据（可选导出）：
 *   export const route = {
 *     path: '/batches/:batch_id/files/:file_id',  // 具名参数声明
 *     methods: ['GET', 'POST'],                     // 允许的 HTTP 方法
 *     upload: { mode: 'multipart', fields: [...] }, // 上传配置
 *   }
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
import multer from '@koa/multer';
import AppRuntimeLoader from '../../lib/app-runtime-loader.js';

const APPS_DIR = path.join(process.cwd(), 'apps');
const HANDLERS_DIR = 'server/handlers';

/**
 * 从 route.path 声明中提取具名参数
 * 例如 '/batches/:batch_id/files/:file_id' + 请求 '/batches/123/files/456'
 *   → { batch_id: '123', file_id: '456' }
 */
function extractNamedParams(routePath, requestSegments) {
  const routeSegments = routePath.split('/').filter(Boolean);
  const params = {};

  for (let i = 0; i < routeSegments.length && i < requestSegments.length; i++) {
    const routeSeg = routeSegments[i];
    const reqSeg = requestSegments[i];

    if (routeSeg.startsWith(':')) {
      const paramName = routeSeg.slice(1);
      params[paramName] = reqSeg;
    }
  }

  return params;
}

/**
 * 解析 handler 文件路径
 * 
 * 核心规则：最长匹配优先 + 支持目录内嵌套 handler
 * 
 * 解析策略：同时查找 handler 文件和目录，优先选择最深/最具体的匹配
 * 
 * 例如请求 /contracts/123/versions/from-attachment ：
 *   文字匹配: handlers/contracts.js (浅层, depth=1)
 *   目录遍历: handlers/contracts/ 目录存在 → 将 '123' 视为参数
 *     → 查找 handlers/contracts/versions-from-attachment.js (存在！, depth=2)
 *   结果: 选择更深层的 contracts/versions-from-attachment.js, params={p0:'123'}
 * 
 * 例如请求 /batches/BID/files/FID ：
 *   文字匹配: handlers/batches.js (如果存在, depth=1)
 *   目录遍历: handlers/batches/ 目录存在 → 将 'BID' 视为参数
 *     → handlers/batches/files.js (存在, depth=2) → 将 'FID' 视为参数
 *   结果: 选择更深层的 batches/files.js, params={p0:'BID', p1:'FID'}
 */
function resolveHandlerPath(appInternalPath, appId, method) {
  const segments = appInternalPath.split('/').filter(Boolean);
  
  if (segments.length === 0) {
    return null;
  }

  const candidates = [];

  // 收集所有候选匹配（字面文件 + 目录递归）
  _collectCandidates(segments, [], [], appId, candidates);

  if (candidates.length === 0) {
    return null;
  }

  // 按 depth 降序排列，选择最深（最具体）的匹配
  candidates.sort((a, b) => b.depth - a.depth);
  return candidates[0];
}

/**
 * 递归收集所有候选 handler 匹配
 * 
 * @param {string[]} remainingSegs - 剩余未处理的请求段
 * @param {string[]} handlerPrefix - handler 文件路径前缀
 * @param {string[]} collectedParams - 已收集的参数值（来自目录遍历）
 * @param {string} appId - app ID
 * @param {Object[]} candidates - 候选结果数组（就地修改）
 */
function _collectCandidates(remainingSegs, handlerPrefix, collectedParams, appId, candidates) {
  if (remainingSegs.length === 0) {
    return;
  }

  // ── 1. 检查字面 handler 文件（从长到短） ──
  for (let len = remainingSegs.length; len >= 1; len--) {
    const trySegments = remainingSegs.slice(0, len);
    const relPath = [...handlerPrefix, ...trySegments].join('/');
    const handlerFile = path.join(HANDLERS_DIR, relPath) + '.js';
    const fullPath = path.join(APPS_DIR, appId, handlerFile);

    if (fs.existsSync(fullPath)) {
      const rest = remainingSegs.slice(len);
      const allParams = [...collectedParams, ...rest];
      const params = {};
      for (let j = 0; j < allParams.length; j++) {
        params[`p${j}`] = allParams[j];
      }
      candidates.push({
        handlerPath: handlerFile,
        params,
        remainingPath: allParams.join('/'),
        depth: handlerPrefix.length + len,
        handlerSegments: [...handlerPrefix, ...trySegments],
      });
    }
  }

  // ── 2. 尝试目录遍历（将后续段视为参数，查找更深的 handler） ──
  for (let prefixLen = 1; prefixLen <= remainingSegs.length - 1; prefixLen++) {
    const dirSegments = remainingSegs.slice(0, prefixLen);
    const dirPath = path.join(APPS_DIR, appId, HANDLERS_DIR, ...dirSegments);

    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      // dirSegments 后的段作为参数值
      const paramValue = remainingSegs[prefixLen];
      const nextRemaining = remainingSegs.slice(prefixLen + 1);
      const newPrefix = [...handlerPrefix, ...dirSegments];
      const newCollectedParams = [...collectedParams, paramValue];

      // 递归查找目录内更深的 handler
      _collectCandidates(nextRemaining, newPrefix, newCollectedParams, appId, candidates);
    }
  }
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
        // 安装态唯一真相：app 不存在直接返回 404
        ctx.error(`App "${appId}" not found`, 404);
        return;
      }

      if (!appRecord.is_active) {
        ctx.error(`App "${appId}" is not active`, 404);
        return;
      }

      // 解析 handler 文件路径
      const handlerInfo = resolveHandlerPath(appInternalPath, appId, method);

      if (!handlerInfo) {
        // handler 不存在时，放行给后续路由（平台管理路由如 /config、/runtime 仍可工作）
        logger.info(`[WildcardRouter] No handler for "${appInternalPath}", passing to next middleware`);
        return await next();
      }

      const { handlerPath, params, remainingPath, handlerSegments } = handlerInfo;
      const handlerModule = await getHandler(appId, handlerPath);
      
      // 读取 handler 级元数据
      const routeMeta = handlerModule.route || handlerModule.config || {};

      // ── 参数注入 ──
      // 1. 基础 p0/p1/... 位置参数
      ctx.params = { ...ctx.params, ...params };
      if (remainingPath) {
        ctx.params._ = remainingPath;
      }

      // 2. 如果 handler 声明了 route.path，提取具名参数
      if (routeMeta.path && typeof routeMeta.path === 'string') {
        const namedParams = extractNamedParams(routeMeta.path, requestSegments);
        Object.assign(ctx.params, namedParams);
      }

      const methodLower = method.toLowerCase();
      let handlerFn = handlerModule[methodLower];

      // 尝试从 default 导出获取
      if (!handlerFn && handlerModule.default) {
        handlerFn = handlerModule.default[methodLower] || handlerModule.default;
      }

      // 检查方法是否支持
      if (!handlerFn && Object.keys(handlerModule).length > 0) {
        const availableMethods = Object.keys(handlerModule).filter(k => k !== 'default' && k !== 'route' && k !== 'config');
        ctx.error(`Method ${method} not allowed for "${appInternalPath}"`, 405);
        ctx.body.data = { allowed_methods: availableMethods };
        return;
      }

      if (!handlerFn || typeof handlerFn !== 'function') {
        ctx.error(`Handler for "${appInternalPath}" is not a function`, 500);
        return;
      }

      // ── 上传解析 ──
      // 如果 handler 声明了上传配置，在调用业务函数前先解析 multipart
      const uploadConfig = routeMeta.upload || (routeMeta.multer ? { _legacyMulter: routeMeta.multer } : null);
      if (uploadConfig) {
        try {
          let uploadMiddleware;
          if (uploadConfig._legacyMulter) {
            // 兼容旧 config.multer 形式
            uploadMiddleware = uploadConfig._legacyMulter;
          } else {
            // 新声明式：route.upload = { mode, fields, single }
            const multerInstance = multer({
              storage: multer.memoryStorage(),
              limits: { fileSize: 50 * 1024 * 1024 },
            });

            if (uploadConfig.single) {
              uploadMiddleware = multerInstance.single(uploadConfig.single);
            } else if (uploadConfig.fields) {
              uploadMiddleware = multerInstance.fields(uploadConfig.fields);
            } else {
              // 默认：单个文件字段 'file'
              uploadMiddleware = multerInstance.single('file');
            }
          }

          await new Promise((resolve, reject) => {
            uploadMiddleware(ctx, async (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } catch (uploadErr) {
          logger.error(`[WildcardRouter] Upload parse error for ${ctx.path}: ${uploadErr.message}`);
          ctx.error(uploadErr.message || 'Upload parse failed', 400);
          return;
        }
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