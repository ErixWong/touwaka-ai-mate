import logger from '../../lib/logger.js';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import AppRuntimeLoader from '../../lib/app-runtime-loader.js';

const APPS_DIR = path.join(process.cwd(), 'apps');
const HANDLERS_DIR = 'server/handlers';

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

      const appRecord = await MiniApp.findOne({ where: { id: appId } });

      if (!appRecord) {
        logger.info(`[WildcardRouter] App "${appId}" not found in mini_apps, passing to next middleware`);
        return await next();
      }

      if (!appRecord.is_active) {
        ctx.error(`App "${appId}" is not active`, 404);
        return;
      }

      const handlerInfo = resolveHandlerPath(appInternalPath, method);

      if (!handlerInfo) {
        logger.info(`[WildcardRouter] No handler for "${appInternalPath}", passing to next middleware`);
        return await next();
      }

      const { handlerPath, params, remainingPath } = handlerInfo;
      const handlerModule = await getHandler(appId, handlerPath);
      
      const methodLower = method.toLowerCase();
      let handlerFn = handlerModule[methodLower];

      if (!handlerFn && handlerModule.default) {
        handlerFn = handlerModule.default[methodLower] || handlerModule.default;
      }

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

      ctx.params = { ...ctx.params, ...params };
      if (remainingPath) {
        ctx.params._ = remainingPath;
      }

      const deps = buildDeps(db, appId, appRecord);

      logger.info(`[WildcardRouter] ${method} ${ctx.path} -> ${appId}:${handlerPath}:${methodLower}`);

      await handlerFn(ctx, deps);

    } catch (err) {
      logger.error(`[WildcardRouter] Error handling ${ctx.path}: ${err.message}`, err.stack);

      if (err.message.includes('not allowed')) {
        ctx.error('Handler path not allowed', 403);
        return;
      }

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