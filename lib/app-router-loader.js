import logger from './logger.js';
import path from 'path';
import fs from 'fs';
import Router from '@koa/router';
import AppRuntimeLoader from './app-runtime-loader.js';

const APPS_DIR = path.join(process.cwd(), 'apps');

class AppRouterLoader {
  constructor(db, koaApp = null, appsDir = APPS_DIR) {
    this.db = db;
    this.koaApp = koaApp;
    this.appsDir = appsDir;
    this.runtimeLoader = new AppRuntimeLoader(db, appsDir);
    this.mountedApps = new Map();
    this.authMiddleware = null;
  }

  setKoaApp(koaApp) {
    this.koaApp = koaApp;
  }

  setAuthMiddleware(fn) {
    this.authMiddleware = fn;
  }

  async mountAppRoutes(appId) {
    if (!this.koaApp) {
      logger.error('[AppRouterLoader] Cannot mount routes: no Koa app reference');
      return null;
    }

    const manifest = await this.runtimeLoader.loadManifest(appId);
    const runtime = manifest.runtime || {};

    if (!runtime.server?.routes) {
      return null;
    }

    const routesModule = await this.runtimeLoader.loadRoutes(appId);
    if (!routesModule) {
      logger.warn(`[AppRouterLoader] No routes module for ${appId}`);
      return null;
    }

    const context = this.runtimeLoader.buildServerContext(appId);

    let appRouter;
    if (typeof routesModule === 'function') {
      appRouter = await routesModule(context);
    } else if (routesModule.default && typeof routesModule.default === 'function') {
      appRouter = await routesModule.default(context);
    } else {
      logger.warn(`[AppRouterLoader] Routes module for ${appId} does not export a function`);
      return null;
    }

    if (!(appRouter instanceof Router)) {
      logger.warn(`[AppRouterLoader] Routes module for ${appId} did not return a Router instance`);
      return null;
    }

    const prefixRouter = new Router();

    if (this.authMiddleware) {
      prefixRouter.use(`/api/apps/${appId}`, this.authMiddleware());
    }

    prefixRouter.use(`/api/apps/${appId}`, appRouter.routes(), appRouter.allowedMethods());

    this.koaApp.use(prefixRouter.routes());
    this.koaApp.use(prefixRouter.allowedMethods());

    this.mountedApps.set(appId, { router: prefixRouter, manifest, routesPath: runtime.server.routes });

    logger.info(`[AppRouterLoader] Mounted routes for ${appId} at /api/apps/${appId}/*`);

    return prefixRouter;
  }

  softUnmountAppRoutes(appId) {
    this.mountedApps.delete(appId);
    this.runtimeLoader.clearCache(appId);
    logger.warn(`[AppRouterLoader] Soft-unmounted routes for ${appId} (Koa does not support true middleware removal, restart required for full cleanup)`);
  }

  getAllMountedRoutes() {
    const routers = [];
    for (const [appId, entry] of this.mountedApps) {
      routers.push(entry.router);
    }
    return routers;
  }

  getMountedAppIds() {
    return Array.from(this.mountedApps.keys());
  }

  async mountAllApps() {
    if (!this.koaApp) {
      logger.warn('[AppRouterLoader] Cannot mountAllApps: no Koa app reference');
      return [];
    }

    const appsDir = this.appsDir;
    
    if (!fs.existsSync(appsDir)) {
      return [];
    }

    const entries = fs.readdirSync(appsDir, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const appId = entry.name;
      const manifestPath = path.join(appsDir, appId, 'manifest.json');

      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      try {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(content);

        if (!manifest.runtime?.server?.routes) {
          continue;
        }

        const router = await this.mountAppRoutes(appId);
        if (router) {
          count++;
        }
      } catch (err) {
        logger.warn(`[AppRouterLoader] Failed to mount routes for ${appId}: ${err.message}`);
      }
    }

    logger.info(`[AppRouterLoader] Mounted ${count} app routes`);
    return count;
  }
}

export default AppRouterLoader;