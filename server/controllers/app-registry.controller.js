import logger from '../../lib/logger.js';
import AppRegistryService from '../services/app-registry.service.js';

class AppRegistryController {
  constructor(db, registryService = null) {
    this.db = db;
    this.registryService = registryService || new AppRegistryService(db);
  }

  setWildcardCacheManager(cacheManager) {
    this.registryService.setWildcardCacheManager(cacheManager);
  }

  async listApps(ctx) {
    try {
      const userId = ctx.state.session.id;
      const apps = await this.registryService.getAccessibleApps(userId);
      ctx.success(apps);
    } catch (error) {
      logger.error('List apps error:', error);
      ctx.error(error.message, 500);
    }
  }

  async listInstalledApps(ctx) {
    try {
      const apps = await this.registryService.listInstalledApps();
      ctx.success(apps);
    } catch (error) {
      logger.error('List installed apps error:', error);
      ctx.error(error.message, 500);
    }
  }

  async getApp(ctx) {
    try {
      const { appId } = ctx.params;
      const app = await this.registryService.getAppById(appId);
      if (!app) {
        ctx.error('App not found', 404);
        return;
      }
      ctx.success(app);
    } catch (error) {
      logger.error('Get app error:', error);
      ctx.error(error.message, 500);
    }
  }

  async getAppWithRuntime(ctx) {
    try {
      const { appId } = ctx.params;
      const result = await this.registryService.getAppWithRuntime(appId);
      
      if (!result.success) {
        if (result.error_type === 'app_not_found') {
          ctx.error(result.error, 404);
        } else if (result.error_type === 'manifest_missing') {
          ctx.error(`Manifest not found or invalid: ${result.error}`, 422);
        } else {
          ctx.error(result.error, 500);
        }
        return;
      }
      
      ctx.success(result.app);
    } catch (error) {
      logger.error('Get app with runtime error:', error);
      ctx.error(error.message, 500);
    }
  }

  async createApp(ctx) {
    try {
      const data = ctx.request.body;
      data.owner_id = data.owner_id || ctx.state.session.id;
      data.creator_id = ctx.state.session.id;
      const app = await this.registryService.createApp(data);
      ctx.success(app, 'Created');
    } catch (error) {
      logger.error('Create app error:', error);
      ctx.error(error.message, 400);
    }
  }

  async updateApp(ctx) {
    try {
      const { appId } = ctx.params;
      const data = ctx.request.body;
      const app = await this.registryService.updateApp(appId, data);
      ctx.success(app, 'Updated');
    } catch (error) {
      logger.error('Update app error:', error);
      ctx.error(error.message, 400);
    }
  }

  async deleteApp(ctx) {
    try {
      const { appId } = ctx.params;
      await this.registryService.deleteApp(appId);
      ctx.success(null, 'Deleted');
    } catch (error) {
      logger.error('Delete app error:', error);
      ctx.error(error.message, 400);
    }
  }

  async getAppConfig(ctx) {
    try {
      const { appId } = ctx.params;
      const config = await this.registryService.getAppConfig(appId);
      ctx.success(config);
    } catch (error) {
      logger.error('Get app config error:', error);
      ctx.error(error.message, 404);
    }
  }

  async updateAppConfig(ctx) {
    try {
      const { appId } = ctx.params;
      const configData = ctx.request.body;
      const config = await this.registryService.updateAppConfig(appId, configData);
      ctx.success(config, 'Updated');
    } catch (error) {
      logger.error('Update app config error:', error);
      ctx.error(error.message, 400);
    }
  }

  async getAppManifest(ctx) {
    try {
      const { appId } = ctx.params;
      const result = await this.registryService.getAppManifest(appId);
      
      if (!result.success) {
        if (result.error_type === 'manifest_missing') {
          ctx.error(`Manifest not found or invalid: ${result.error}`, 422);
        } else {
          ctx.error(result.error, 500);
        }
        return;
      }
      
      ctx.success(result.manifest);
    } catch (error) {
      logger.error('Get app manifest error:', error);
      ctx.error(error.message, 500);
    }
  }

  async validateAppRuntime(ctx) {
    try {
      const { appId } = ctx.params;
      const result = await this.registryService.validateAppRuntime(appId);
      
      if (!result.success) {
        if (result.error_type === 'manifest_missing') {
          ctx.error(`Manifest not found or invalid: ${result.error}`, 422);
        } else {
          ctx.error(result.error, 500);
        }
        return;
      }
      
      ctx.success(result.validation);
    } catch (error) {
      logger.error('Validate app runtime error:', error);
      ctx.error(error.message, 500);
    }
  }

  async getClockRegistry(ctx) {
    try {
      const { appId } = ctx.params;
      const registry = await this.registryService.getClockRegistry(appId);
      ctx.success(registry);
    } catch (error) {
      logger.error('Get clock registry error:', error);
      ctx.error(error.message, 500);
    }
  }

  async listClockRegistry(ctx) {
    try {
      const registries = await this.registryService.getClockRegistry();
      ctx.success(registries);
    } catch (error) {
      logger.error('List clock registry error:', error);
      ctx.error(error.message, 500);
    }
  }

  async updateClockRegistry(ctx) {
    try {
      const { appId } = ctx.params;
      const data = ctx.request.body;
      const registry = await this.registryService.updateClockRegistry(appId, data);
      ctx.success(registry, 'Updated');
    } catch (error) {
      logger.error('Update clock registry error:', error);
      ctx.error(error.message, 400);
    }
  }

  async getAvailableResources(ctx) {
    try {
      const { appId } = ctx.params;
      const resources = await this.registryService.getAvailableResources(appId);
      ctx.success(resources);
    } catch (error) {
      logger.error('Get available resources error:', error);
      ctx.error(error.message, 500);
    }
  }
}

export default AppRegistryController;