import logger from './logger.js';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const DEFAULT_APPS_DIR = path.join(process.cwd(), 'apps');

const globalCache = new Map();
const cacheSubscribers = new Set();

function notifyCacheChange(appId) {
  for (const callback of cacheSubscribers) {
    try {
      callback(appId);
    } catch (e) {
      logger.warn(`[AppRuntimeLoader] Cache subscriber error: ${e.message}`);
    }
  }
}

export function subscribeGlobalCache(callback) {
  cacheSubscribers.add(callback);
  return () => cacheSubscribers.delete(callback);
}

export function clearGlobalCache(appId, appsDir = null) {
  const targetPrefix = appsDir ? `dir:${appsDir}:` : null;
  
  const keysToDelete = [];
  for (const key of globalCache.keys()) {
    if (!key.includes(appId)) continue;
    if (targetPrefix && !key.startsWith(targetPrefix)) continue;
    keysToDelete.push(key);
  }
  for (const key of keysToDelete) {
    globalCache.delete(key);
  }
  notifyCacheChange(appId);
  logger.info(`[AppRuntimeLoader] Global cache cleared for ${appId}${targetPrefix ? ` (prefix: ${targetPrefix})` : ''}`);
}

class AppRuntimeLoader {
  constructor(db, appsDir = DEFAULT_APPS_DIR) {
    this.db = db;
    this.appsDir = appsDir;
    this.cache = globalCache;
    this.cachePrefix = `dir:${this.appsDir}:`;
    cacheSubscribers.add((appId) => {
      logger.info(`[AppRuntimeLoader] Instance notified: cache cleared for ${appId}`);
    });
  }

  _makeKey(type, appId) {
    return `${this.cachePrefix}${type}:${appId}`;
  }
  
  async loadManifest(appId) {
    const cacheKey = this._makeKey('manifest', appId);
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    const manifestPath = path.join(this.appsDir, appId, 'manifest.json');
    
    try {
      const content = await fsPromises.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      
      if (manifest.id !== appId) {
        logger.warn(`[AppRuntimeLoader] Manifest id "${manifest.id}" does not match directory "${appId}"`);
      }
      
      this.cache.set(cacheKey, manifest);
      return manifest;
    } catch (err) {
      logger.error(`[AppRuntimeLoader] Failed to load manifest for ${appId}: ${err.message}`);
      throw new Error(`Failed to load manifest for ${appId}: ${err.message}`);
    }
  }

  async validateRuntime(manifest) {
    const runtime = manifest.runtime || {};
    const errors = [];
    const warnings = [];
    
    if (!manifest.id) {
      errors.push('manifest.id is required');
    }
    
    if (!manifest.name) {
      errors.push('manifest.name is required');
    }
    
    if (!manifest.version) {
      warnings.push('manifest.version is recommended');
    }
    
    const appId = manifest.id;
    
    if (runtime.tick) {
      const tickPath = path.join(this.appsDir, appId, runtime.tick);
      const exists = await this.fileExistsAsync(tickPath);
      if (!exists) {
        errors.push(`runtime.tick path "${runtime.tick}" does not exist`);
      }
    }
    
    if (runtime.server?.routes) {
      warnings.push(`[DEPRECATED] runtime.server.routes is deprecated and will be removed. Use manifest.apis + wildcard router instead.`);
      const routesPath = path.join(this.appsDir, appId, runtime.server.routes);
      const exists = await this.fileExistsAsync(routesPath);
      if (!exists) {
        warnings.push(`runtime.server.routes path "${runtime.server.routes}" does not exist`);
      }
    }
    
    if (runtime.frontend?.entry) {
      const entryPath = path.join(this.appsDir, appId, runtime.frontend.entry);
      const exists = await this.fileExistsAsync(entryPath);
      if (!exists) {
        warnings.push(`runtime.frontend.entry path "${runtime.frontend.entry}" does not exist`);
      }
    }
    
    if (runtime.backup?.export) {
      const exportPath = path.join(this.appsDir, appId, runtime.backup.export);
      const exists = await this.fileExistsAsync(exportPath);
      if (!exists) {
        warnings.push(`runtime.backup.export path "${runtime.backup.export}" does not exist`);
      }
    }
    
    if (runtime.backup?.import) {
      const importPath = path.join(this.appsDir, appId, runtime.backup.import);
      const exists = await this.fileExistsAsync(importPath);
      if (!exists) {
        warnings.push(`runtime.backup.import path "${runtime.backup.import}" does not exist`);
      }
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }

  async fileExistsAsync(filePath) {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  fileExistsSync(filePath) {
    try {
      fs.accessSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  resolveRuntimePaths(manifest) {
    const appId = manifest.id;
    const runtime = manifest.runtime || {};
    
    const resolved = {
      tick: null,
      routes: null,
      frontendEntry: null,
      backupExport: null,
      backupImport: null,
    };
    
    if (runtime.tick) {
      resolved.tick = path.join(this.appsDir, appId, runtime.tick);
    } else {
      const defaultTick = path.join(this.appsDir, appId, 'tick', 'index.js');
      if (this.fileExistsSync(defaultTick)) {
        resolved.tick = defaultTick;
        logger.info(`[AppRuntimeLoader] Using default tick path for ${appId}`);
      }
    }
    
    if (runtime.server?.routes) {
      logger.warn(`[DEPRECATED] runtime.server.routes is deprecated for app ${appId}. Use manifest.apis + wildcard router instead.`);
      resolved.routes = path.join(this.appsDir, appId, runtime.server.routes);
    }
    
    if (runtime.frontend?.entry) {
      resolved.frontendEntry = path.join(this.appsDir, appId, runtime.frontend.entry);
    }
    
    if (runtime.backup?.export) {
      resolved.backupExport = path.join(this.appsDir, appId, runtime.backup.export);
    }
    
    if (runtime.backup?.import) {
      resolved.backupImport = path.join(this.appsDir, appId, runtime.backup.import);
    }
    
    return resolved;
  }

  async loadTick(appId) {
    const cacheKey = this._makeKey('tick', appId);
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    const manifest = await this.loadManifest(appId);
    const paths = this.resolveRuntimePaths(manifest);
    
    if (!paths.tick) {
      logger.warn(`[AppRuntimeLoader] No tick entry for ${appId}`);
      return null;
    }
    
    try {
      const tickPath = paths.tick;
      const normalizedPath = path.normalize(tickPath);
      
      if (!normalizedPath.startsWith(path.normalize(this.appsDir))) {
        throw new Error(`Tick path not allowed: ${tickPath}`);
      }
      
      const module = await import(`${pathToFileURL(normalizedPath).href}?t=${Date.now()}`);
      const tickModule = module.default || module;
      
      if (!tickModule.tick && typeof tickModule !== 'function') {
        logger.warn(`[AppRuntimeLoader] Tick module for ${appId} has no tick export`);
      }
      
      this.cache.set(cacheKey, tickModule);
      logger.info(`[AppRuntimeLoader] Loaded tick for ${appId} from ${tickPath}`);
      return tickModule;
    } catch (err) {
      logger.error(`[AppRuntimeLoader] Failed to load tick for ${appId}: ${err.message}`);
      throw err;
    }
  }

  async loadRoutes(appId) {
    logger.warn(`[DEPRECATED] loadRoutes() is deprecated. Use manifest.apis + wildcard router instead.`);
    
    const cacheKey = this._makeKey('routes', appId);
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    const manifest = await this.loadManifest(appId);
    const paths = this.resolveRuntimePaths(manifest);
    
    if (!paths.routes) {
      return null;
    }
    
    try {
      const routesPath = paths.routes;
      const normalizedPath = path.normalize(routesPath);
      
      if (!normalizedPath.startsWith(path.normalize(this.appsDir))) {
        throw new Error(`Routes path not allowed: ${routesPath}`);
      }
      
      const module = await import(`${pathToFileURL(normalizedPath).href}?t=${Date.now()}`);
      const routesModule = module.default || module;
      
      this.cache.set(cacheKey, routesModule);
      logger.info(`[AppRuntimeLoader] Loaded routes for ${appId} from ${routesPath}`);
      return routesModule;
    } catch (err) {
      logger.error(`[AppRuntimeLoader] Failed to load routes for ${appId}: ${err.message}`);
      throw err;
    }
  }

  async loadBackupExport(appId) {
    const cacheKey = this._makeKey('backupExport', appId);
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    const manifest = await this.loadManifest(appId);
    const paths = this.resolveRuntimePaths(manifest);
    
    if (!paths.backupExport) {
      return null;
    }
    
    try {
      const exportPath = paths.backupExport;
      const normalizedPath = path.normalize(exportPath);
      
      if (!normalizedPath.startsWith(path.normalize(this.appsDir))) {
        throw new Error(`Backup export path not allowed: ${exportPath}`);
      }
      
      const module = await import(`${pathToFileURL(normalizedPath).href}?t=${Date.now()}`);
      const exportModule = module.default || module;
      
      this.cache.set(cacheKey, exportModule);
      logger.info(`[AppRuntimeLoader] Loaded backup export for ${appId} from ${exportPath}`);
      return exportModule;
    } catch (err) {
      logger.error(`[AppRuntimeLoader] Failed to load backup export for ${appId}: ${err.message}`);
      throw err;
    }
  }

  async loadBackupImport(appId) {
    const cacheKey = this._makeKey('backupImport', appId);
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    const manifest = await this.loadManifest(appId);
    const paths = this.resolveRuntimePaths(manifest);
    
    if (!paths.backupImport) {
      return null;
    }
    
    try {
      const importPath = paths.backupImport;
      const normalizedPath = path.normalize(importPath);
      
      if (!normalizedPath.startsWith(path.normalize(this.appsDir))) {
        throw new Error(`Backup import path not allowed: ${importPath}`);
      }
      
      const module = await import(`${pathToFileURL(normalizedPath).href}?t=${Date.now()}`);
      const importModule = module.default || module;
      
      this.cache.set(cacheKey, importModule);
      logger.info(`[AppRuntimeLoader] Loaded backup import for ${appId} from ${importPath}`);
      return importModule;
    } catch (err) {
      logger.error(`[AppRuntimeLoader] Failed to load backup import for ${appId}: ${err.message}`);
      throw err;
    }
  }

  async getFrontendEntry(appId) {
    const manifest = await this.loadManifest(appId);
    const runtime = manifest.runtime || {};
    
    if (runtime.frontend?.entry) {
      return {
        path: runtime.frontend.entry,
        fullPath: path.join(this.appsDir, appId, runtime.frontend.entry),
        meta: runtime.frontend.meta || null,
      };
    }
    
    if (manifest.component) {
      return {
        component: manifest.component,
        legacy: true,
      };
    }
    
    return null;
  }

  buildTickContext(app, registry, extraServices = {}) {
    const Sequelize = this.db.sequelize.constructor;
    
    return {
      app: app ? (app.toJSON ? app.toJSON() : app) : null,
      registry: registry ? (registry.toJSON ? registry.toJSON() : registry) : null,
      db: this.db,
      sequelize: this.db.sequelize,
      services: {
        query: async (sql, replacements = []) => {
          return await this.db.sequelize.query(sql, {
            replacements,
            type: Sequelize.QueryTypes.SELECT,
          });
        },
        execute: async (sql, replacements = []) => {
          return await this.db.sequelize.query(sql, {
            replacements,
            type: Sequelize.QueryTypes.RAW,
          });
        },
        getModel: (modelName) => {
          return this.db.getModel(modelName);
        },
        getFiles: async (recordId) => {
          const MiniAppFile = this.db.getModel('mini_app_file');
          const Attachment = this.db.getModel('attachment');
          
          if (!MiniAppFile) {
            throw new Error('mini_app_file model not available');
          }
          
          const query = { where: { record_id: recordId } };
          if (Attachment) {
            query.include = [{ model: Attachment, as: 'attachment' }];
          }
          
          return await MiniAppFile.findAll(query);
        },
        log: async (action, data = {}) => {
          const AppTickLog = this.db.getModel('app_tick_log');
          const Utils = await import('./utils.js');
          
          if (!AppTickLog || !registry) return;
          
          await AppTickLog.create({
            id: Utils.default.newID(20),
            registry_id: registry.id,
            app_id: registry.app_id,
            success: true,
            output_data: JSON.stringify({ action, ...data }),
            duration: 0,
          });
        },
        ...extraServices,
      },
    };
  }

  buildServerContext(appId, extraServices = {}) {
    const Sequelize = this.db.sequelize.constructor;
    
    return {
      appId,
      db: this.db,
      services: {
        query: async (sql, replacements = []) => {
          return await this.db.sequelize.query(sql, {
            replacements,
            type: Sequelize.QueryTypes.SELECT,
          });
        },
        execute: async (sql, replacements = []) => {
          return await this.db.sequelize.query(sql, {
            replacements,
            type: Sequelize.QueryTypes.RAW,
          });
        },
        getModel: (modelName) => {
          return this.db.getModel(modelName);
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
        ...extraServices,
      },
    };
  }

  buildBackupContext(appId, extraServices = {}) {
    const Sequelize = this.db.sequelize.constructor;
    
    return {
      appId,
      db: this.db,
      services: {
        query: async (sql, replacements = []) => {
          return await this.db.sequelize.query(sql, {
            replacements,
            type: Sequelize.QueryTypes.SELECT,
          });
        },
        execute: async (sql, replacements = []) => {
          return await this.db.sequelize.query(sql, {
            replacements,
            type: Sequelize.QueryTypes.RAW,
          });
        },
        getModel: (modelName) => {
          return this.db.getModel(modelName);
        },
        ...extraServices,
      },
    };
  }

  clearCache(appId) {
    clearGlobalCache(appId);
  }

  clearAllCache() {
    globalCache.clear();
    logger.info('[AppRuntimeLoader] All global cache cleared');
  }

  async getAppRuntimeInfo(appId) {
    const manifest = await this.loadManifest(appId);
    const validation = await this.validateRuntime(manifest);
    const paths = this.resolveRuntimePaths(manifest);
    
    return {
      appId,
      manifest,
      validation,
      paths,
      hasTick: !!paths.tick,
      hasRoutes: !!paths.routes,
      hasFrontend: !!paths.frontendEntry || !!manifest.component,
      hasBackupExport: !!paths.backupExport,
      hasBackupImport: !!paths.backupImport,
    };
  }

  async executeTick(appId, context) {
    const tickModule = await this.loadTick(appId);
    
    if (!tickModule) {
      throw new Error(`No tick module found for ${appId}`);
    }
    
    const tickFn = tickModule.tick || tickModule;
    
    if (typeof tickFn !== 'function') {
      throw new Error(`Tick module for ${appId} is not a function`);
    }
    
    return await tickFn(context);
  }

  async createRoutes(appId, context) {
    const routesModule = await this.loadRoutes(appId);
    
    if (!routesModule) {
      return null;
    }
    
    if (typeof routesModule === 'function') {
      return await routesModule(context);
    }
    
    return routesModule;
  }

  async exportBackup(appId, context, options = {}) {
    const exportModule = await this.loadBackupExport(appId);
    
    if (!exportModule) {
      throw new Error(`No backup export module found for ${appId}`);
    }
    
    const exportFn = exportModule.exportBackup || exportModule.default?.exportBackup || exportModule;
    
    if (typeof exportFn !== 'function') {
      throw new Error(`Backup export module for ${appId} is not a function`);
    }
    
    return await exportFn(context, options);
  }

  async importBackup(appId, context, payload, options = {}) {
    const importModule = await this.loadBackupImport(appId);
    
    if (!importModule) {
      throw new Error(`No backup import module found for ${appId}`);
    }
    
    const importFn = importModule.importBackup || importModule.default?.importBackup || importModule;
    
    if (typeof importFn !== 'function') {
      throw new Error(`Backup import module for ${appId} is not a function`);
    }
    
    return await importFn(context, payload, options);
  }
}

export { subscribeGlobalCache };
export default AppRuntimeLoader;