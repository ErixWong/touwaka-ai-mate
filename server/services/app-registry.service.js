import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import AppRuntimeLoader from '../../lib/app-runtime-loader.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const DEFAULT_APPS_DIR = path.join(process.cwd(), 'apps');

function normalizeJsonColumnValue(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
}

class AppRegistryService {
  constructor(db, appsDir = DEFAULT_APPS_DIR) {
    this.db = db;
    this.appsDir = appsDir;
    this.models = {};
    this.runtimeLoader = new AppRuntimeLoader(db, appsDir);
    this.wildcardCacheManager = null;
  }

  setWildcardCacheManager(cacheManager) {
    this.wildcardCacheManager = cacheManager;
  }

  clearAppCache(appId) {
    this.runtimeLoader.clearCache(appId);
    if (this.wildcardCacheManager) {
      this.wildcardCacheManager.clearAppCache(appId);
    }
  }

  ensureModels() {
    if (!this.models.MiniApp) {
      this.models.MiniApp = this.db.getModel('mini_app');
      this.models.MiniAppRoleAccess = this.db.getModel('mini_app_role_access');
      this.models.User = this.db.getModel('user');
      this.models.UserRole = this.db.getModel('user_role');
      this.models.Role = this.db.getModel('role');
      this.models.AppClockRegistry = this.db.getModel('app_clock_registry');
    }
  }

  async getAccessibleApps(userId) {
    this.ensureModels();

    const user = await this.models.User.findByPk(userId);
    if (!user) return [];

    const isAdmin = await this.isAdmin(userId);

    if (isAdmin) {
      return await this.models.MiniApp.findAll({
        where: { is_active: true },
        order: [['sort_order', 'ASC'], ['created_at', 'DESC']],
      });
    }

    const apps = await this.models.MiniApp.findAll({
      where: { is_active: true },
      order: [['sort_order', 'ASC'], ['created_at', 'DESC']],
    });

    const result = [];
    for (const app of apps) {
      if (app.visibility === 'all') {
        result.push(app);
      } else if (app.visibility === 'owner') {
        if (app.owner_id === userId) {
          result.push(app);
        }
      } else if (app.visibility === 'department') {
        if (user && app.owner_id) {
          const appOwner = await this.models.User.findByPk(app.owner_id);
          if (appOwner && user.department_id && appOwner.department_id &&
              user.department_id === appOwner.department_id) {
            result.push(app);
          }
        }
      } else if (app.visibility === 'role') {
        const hasAccess = await this.models.MiniAppRoleAccess.findOne({
          where: { app_id: app.id },
          include: [{
            model: this.models.UserRole,
            where: { user_id: userId },
            required: true,
          }],
        });
        if (hasAccess) result.push(app);
      }
    }
    return result;
  }

  async getAppById(appId) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) return null;

    const appJson = app.toJSON();

    if (appJson.fields && typeof appJson.fields === 'string') {
      try {
        appJson.fields = JSON.parse(appJson.fields);
      } catch {
        appJson.fields = [];
      }
    }

    if (appJson.views && typeof appJson.views === 'string') {
      try {
        appJson.views = JSON.parse(appJson.views);
      } catch {
        appJson.views = {};
      }
    }

    if (appJson.config && typeof appJson.config === 'string') {
      try {
        appJson.config = JSON.parse(appJson.config);
      } catch {
        appJson.config = {};
      }
    }

    // 从 manifest 读取 states（用于步骤配置面板）
    try {
      const manifestPath = path.join(this.appsDir, appId, 'manifest.json');
      if (fsSync.existsSync(manifestPath)) {
        const manifestContent = fsSync.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        appJson.states = manifest.states || [];
      }
    } catch {
      appJson.states = [];
    }

    return appJson;
  }

async getAppWithRuntime(appId) {
    const app = await this.getAppById(appId);
    if (!app) return { success: false, error_type: 'app_not_found', error: 'App not found' };

    let runtimeInfo = null;
    let manifestError = null;
    
    try {
      runtimeInfo = await this.runtimeLoader.getAppRuntimeInfo(appId);
    } catch (err) {
      manifestError = err.message;
      logger.warn(`[AppRegistryService] Manifest error for ${appId}: ${err.message}`);
    }
    
    if (manifestError) {
      return {
        success: false,
        error_type: 'manifest_missing',
        error: manifestError,
        app: {
          ...app,
          runtime: {
            valid: false,
            manifest_error: manifestError,
            has_tick: false,
            has_frontend: !!app.component,
            has_backup: false,
          },
        },
      };
    }
    
    return {
      success: true,
      app: {
        ...app,
        runtime: {
          valid: runtimeInfo.validation?.valid ?? true,
          errors: runtimeInfo.validation?.errors ?? [],
          warnings: runtimeInfo.validation?.warnings ?? [],
          has_tick: runtimeInfo.hasTick,
          has_frontend: runtimeInfo.hasFrontend,
          has_backup: runtimeInfo.hasBackupExport,
        },
      },
    };
  }

  async getAppManifest(appId) {
    try {
      const manifest = await this.runtimeLoader.loadManifest(appId);
      return { success: true, manifest };
    } catch (err) {
      return { success: false, error: err.message, error_type: 'manifest_missing' };
    }
  }

  async validateAppRuntime(appId) {
    try {
      const manifest = await this.runtimeLoader.loadManifest(appId);
      const validation = await this.runtimeLoader.validateRuntime(manifest);
      return { success: true, validation };
    } catch (err) {
      return { success: false, error: err.message, error_type: 'manifest_missing' };
    }
  }

  async createApp(data) {
    this.ensureModels();
    const fields = normalizeJsonColumnValue(data.fields, []);
    const views = normalizeJsonColumnValue(data.views, {});
    const config = normalizeJsonColumnValue(data.config, {});

    const app = await this.models.MiniApp.create({
      id: data.id || Utils.newID(20),
      name: data.name,
      description: data.description || '',
      icon: data.icon || '',
      type: data.type || 'utility',
      component: data.component || null,
      fields: JSON.stringify(fields),
      views: JSON.stringify(views),
      config: JSON.stringify(config),
      visibility: data.visibility || 'all',
      owner_id: data.owner_id,
      creator_id: data.creator_id,
      sort_order: data.sort_order || 0,
      is_active: data.is_active !== undefined ? data.is_active : true,
      revision: 1,
    });
    return app;
  }

  async updateApp(appId, data) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');

    const updateData = {};
    
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.icon !== undefined) updateData.icon = data.icon;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.component !== undefined) updateData.component = data.component;
    if (data.visibility !== undefined) updateData.visibility = data.visibility;
    if (data.owner_id !== undefined) updateData.owner_id = data.owner_id;
    if (data.creator_id !== undefined) updateData.creator_id = data.creator_id;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;
    if (data.sort_order !== undefined) updateData.sort_order = data.sort_order;
    
    if (data.fields !== undefined) {
      updateData.fields = JSON.stringify(normalizeJsonColumnValue(data.fields, []));
      updateData.revision = app.revision + 1;
    }
    
    if (data.views !== undefined) {
      updateData.views = JSON.stringify(normalizeJsonColumnValue(data.views, {}));
    }
    
    if (data.config !== undefined) {
      updateData.config = JSON.stringify(normalizeJsonColumnValue(data.config, {}));
    }

    await app.update(updateData);
    
    this.runtimeLoader.clearCache(appId);
    
    return app;
  }

  async deleteApp(appId) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');
    
    await app.destroy();
    
    await this.models.AppClockRegistry.destroy({ where: { app_id: appId } });
    
    this.runtimeLoader.clearCache(appId);
    
    return true;
  }

  async getAppConfig(appId) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');

    let config = app.config;
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch { config = {}; }
    }

    const manifestConfig = await this.getManifestConfig(appId);
    
    if (manifestConfig) {
      config = { ...manifestConfig, ...config };
    }
    
    return config || {};
  }

  async getManifestConfig(appId) {
    try {
      const manifest = await this.runtimeLoader.loadManifest(appId);
      return manifest.config || null;
    } catch {
      return null;
    }
  }

  async updateAppConfig(appId, configData) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');

    let currentConfig = app.config;
    if (typeof currentConfig === 'string') {
      try { currentConfig = JSON.parse(currentConfig); } catch { currentConfig = {}; }
    }

    const mergedConfig = { ...currentConfig, ...configData };
    await app.update({ config: JSON.stringify(mergedConfig) });
    
    this.runtimeLoader.clearCache(appId);
    
    return mergedConfig;
  }

  async getClockRegistry(appId) {
    this.ensureModels();
    
    if (!appId) {
      return await this.models.AppClockRegistry.findAll({
        order: [['created_at', 'ASC']],
      });
    }
    
    return await this.models.AppClockRegistry.findOne({
      where: { app_id: appId },
    });
  }

  async updateClockRegistry(appId, data) {
    this.ensureModels();
    
    const registry = await this.models.AppClockRegistry.findOne({
      where: { app_id: appId },
    });
    
    if (!registry) {
      throw new Error(`App ${appId} not found in clock registry`);
    }
    
    await registry.update(data);
    
    return registry;
  }

  async isAdmin(userId) {
    this.ensureModels();
    const userRole = await this.models.UserRole.findOne({
      where: { user_id: userId },
      include: [{
        model: this.models.Role,
        as: 'role',
        where: { level: 'admin' },
      }],
    });
    return !!userRole;
  }

  async listInstalledApps() {
    this.ensureModels();
    
    const apps = await this.models.MiniApp.findAll({
      order: [['sort_order', 'ASC'], ['created_at', 'DESC']],
      raw: true,
    });
    
    const result = [];
    for (const app of apps) {
      let config = {};
      if (app.config) {
        try {
          config = typeof app.config === 'string' ? JSON.parse(app.config) : app.config;
        } catch {
          config = {};
        }
      }
      
      let runtimeInfo = null;
      let runtimeError = null;
      
      try {
        runtimeInfo = await this.runtimeLoader.getAppRuntimeInfo(app.id);
      } catch (err) {
        runtimeError = err.message;
        logger.warn(`[AppRegistryService] Failed to get runtime info for ${app.id}: ${err.message}`);
      }
      
      result.push({
        id: app.id,
        name: app.name,
        description: app.description,
        icon: app.icon,
        type: app.type,
        component: app.component,
        visibility: app.visibility,
        is_active: app.is_active,
        revision: app.revision,
        created_at: app.created_at,
        updated_at: app.updated_at,
        config,
        runtime: runtimeInfo ? {
          valid: runtimeInfo.validation?.valid ?? true,
          has_tick: runtimeInfo.hasTick,
          has_frontend: runtimeInfo.hasFrontend,
          has_backup: runtimeInfo.hasBackupExport,
        } : {
          valid: false,
          error: runtimeError,
          has_tick: false,
          has_frontend: !!app.component,
          has_backup: false,
        },
      });
    }
    
    return result;
  }

  getDefaultStepResources(appId) {
    try {
      const manifestPath = path.join(this.appsDir, appId, 'manifest.json');
      if (fsSync.existsSync(manifestPath)) {
        const manifestContent = fsSync.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        return manifest.config?.step_resources || null;
      }
    } catch (e) {
      logger.warn(`[AppRegistryService] Failed to read manifest step_resources for ${appId}: ${e.message}`);
    }
    return null;
  }

  async getAvailableResources(appId) {
    const MCPServer = this.db.getModel('mcp_server');
    const MCPToolsCache = this.db.getModel('mcp_tools_cache');
    const AiModel = this.db.getModel('ai_model');
    const Provider = this.db.getModel('provider');

    const servers = await MCPServer.findAll({
      where: { is_enabled: true },
      raw: true,
    });

    const result = [];
    for (const server of servers) {
      const tools = await MCPToolsCache.findAll({
        where: { mcp_server_id: server.id },
        raw: true,
      });
      result.push({
        id: server.id,
        name: server.name,
        display_name: server.display_name,
        transport_type: server.transport_type,
        tools: tools.map(t => {
          let inputSchema = null;
          if (t.input_schema) {
            try { inputSchema = JSON.parse(t.input_schema); } catch { inputSchema = null; }
          }
          return {
            name: t.tool_name,
            description: t.description,
            input_schema: inputSchema,
          };
        }),
      });
    }

    const models = await AiModel.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'model_name', 'provider_id', 'model_type'],
      include: [{
        model: Provider,
        as: 'provider',
        attributes: [['id', 'provider_id'], ['name', 'provider_name']],
      }],
      order: [['name', 'ASC']],
      raw: true,
      nest: true,
    });

    return {
      mcp_servers: result,
      internal_llm: {
        available: true,
        models: models.map(m => ({
          id: m.id,
          name: m.name,
          model_name: m.model_name,
          model_type: m.model_type || null,
          provider_name: m.provider?.provider_name || '',
        })),
      },
      handler_outputs: {},
      configurable_states: {},
    };
  }
}

export default AppRegistryService;
