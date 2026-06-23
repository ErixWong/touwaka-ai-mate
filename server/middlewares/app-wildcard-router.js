import logger from '../../lib/logger.js';
import path from 'path';
import { pathToFileURL } from 'url';
import AppRuntimeLoader from '../../lib/app-runtime-loader.js';

const APPS_DIR = path.join(process.cwd(), 'apps');
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

function parseApiPath(apiPath) {
  const segments = apiPath.split('/').filter(Boolean);
  const paramNames = [];
  const pattern = [];

  for (const seg of segments) {
    if (seg.startsWith(':')) {
      paramNames.push(seg.slice(1));
      pattern.push({ type: 'param', name: seg.slice(1) });
    } else {
      pattern.push({ type: 'static', value: seg });
    }
  }

  return { segments, paramNames, pattern };
}

function matchPath(requestSegments, apiPattern) {
  if (requestSegments.length !== apiPattern.length) {
    return null;
  }

  const params = {};

  for (let i = 0; i < requestSegments.length; i++) {
    const reqSeg = requestSegments[i];
    const apiSeg = apiPattern[i];

    if (apiSeg.type === 'static') {
      if (reqSeg !== apiSeg.value) {
        return null;
      }
    } else if (apiSeg.type === 'param') {
      params[apiSeg.name] = reqSeg;
    }
  }

  return params;
}

function validateApis(apis) {
  if (!Array.isArray(apis)) {
    return { valid: false, errors: ['apis must be an array'] };
  }

  const errors = [];
  const seen = new Set();

  for (const api of apis) {
    if (!api.path) {
      errors.push(`api missing path field`);
      continue;
    }

    if (!api.path.startsWith('/')) {
      errors.push(`api path "${api.path}" must start with /`);
    }

    if (!api.methods || !Array.isArray(api.methods) || api.methods.length === 0) {
      errors.push(`api "${api.path}" missing methods array`);
      continue;
    }

    for (const method of api.methods) {
      if (!ALLOWED_METHODS.includes(method)) {
        errors.push(`api "${api.path}" has invalid method "${method}"`);
      }

      const key = `${api.path}:${method}`;
      if (seen.has(key)) {
        errors.push(`duplicate api declaration: ${key}`);
      }
      seen.add(key);
    }

    if (!api.handler) {
      errors.push(`api "${api.path}" missing handler field`);
    }
  }

  return { valid: errors.length === 0, errors };
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

function buildDeps(db, appId) {
  const Sequelize = db.sequelize.constructor;

  return {
    db,
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
  const handlerCache = new Map();
  const apisCache = new Map();

  const cacheManager = {
    clearAppCache(appId) {
      runtimeLoader.clearCache(appId);
      const apisKey = `apis:${appId}`;
      apisCache.delete(apisKey);
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

  async function getAppApis(appId) {
    const cacheKey = `apis:${appId}`;

    if (apisCache.has(cacheKey) && process.env.NODE_ENV !== 'development') {
      return apisCache.get(cacheKey);
    }

    const manifest = await runtimeLoader.loadManifest(appId);
    const apis = manifest.apis;

    if (!apis || (Array.isArray(apis) && apis.length === 0)) {
      const result = { parsedApis: [], hasApis: false };
      apisCache.set(cacheKey, result);
      return result;
    }

    const validation = validateApis(apis);

    if (!validation.valid) {
      logger.error(`[WildcardRouter] Invalid apis for ${appId}: ${validation.errors.join(', ')}`);
      const result = { parsedApis: [], hasApis: false, validationErrors: validation.errors };
      apisCache.set(cacheKey, result);
      return result;
    }

    const parsedApis = apis.map(api => ({
      ...api,
      parsed: parseApiPath(api.path),
    }));

    const result = { parsedApis, hasApis: true };
    apisCache.set(cacheKey, result);
    return result;
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
    const requestSegments = pathParts.slice(1).filter(Boolean);
    const method = ctx.method.toUpperCase();

    try {
      const MiniApp = db.getModel('mini_app');

      if (!MiniApp) {
        ctx.error(`mini_app model not available`, 500);
        return;
      }

      const appRecord = await MiniApp.findOne({ where: { id: appId } });

      if (!appRecord) {
        ctx.error(`App "${appId}" not found`, 404);
        return;
      }

      if (!appRecord.is_active) {
        ctx.error(`App "${appId}" is not active`, 404);
        return;
      }

      const apisResult = await getAppApis(appId);

      if (!apisResult.hasApis) {
        return await next();
      }

      const apis = apisResult.parsedApis;
      const matchedApis = [];

      for (const api of apis) {
        const params = matchPath(requestSegments, api.parsed.pattern);
        if (params !== null) {
          matchedApis.push({ api, params });
        }
      }

      if (matchedApis.length === 0) {
        ctx.error(`API "${appInternalPath}" not declared in manifest.apis`, 404);
        return;
      }

      let matchedApi = null;
      let matchedParams = null;

      for (const { api, params } of matchedApis) {
        if (api.methods.includes(method)) {
          matchedApi = api;
          matchedParams = params;
          break;
        }
      }

      if (!matchedApi) {
        const allMethods = matchedApis.flatMap(m => m.api.methods);
        const uniqueMethods = [...new Set(allMethods)];
        ctx.error(`Method ${method} not allowed for "${appInternalPath}"`, 405);
        ctx.body.data = { allowed_methods: uniqueMethods };
        return;
      }

      const methodLower = method.toLowerCase();
      const handlerModule = await getHandler(appId, matchedApi.handler);
      const handlerFn = handlerModule[methodLower] || handlerModule.default?.[methodLower];

      if (!handlerFn || typeof handlerFn !== 'function') {
        ctx.error(`Handler function "${methodLower}" not found in ${matchedApi.handler}`, 500);
        return;
      }

      ctx.params = { ...ctx.params, ...matchedParams };

      const deps = buildDeps(db, appId);

      logger.info(`[WildcardRouter] ${method} ${ctx.path} -> ${appId}:${matchedApi.handler}:${methodLower}`);

      await handlerFn(ctx, deps);

    } catch (err) {
      logger.error(`[WildcardRouter] Error handling ${ctx.path}: ${err.message}`);

      if (err.message.includes('not allowed')) {
        ctx.error('Handler path not allowed', 403);
        return;
      }

      ctx.error(err.message || 'Internal server error', 500);
    }
  };
}