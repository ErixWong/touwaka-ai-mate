import logger from '../../lib/logger.js';
import AppRuntimeLoader from '../../lib/app-runtime-loader.js';

class AppBackupController {
  constructor(db) {
    this.db = db;
    this.runtimeLoader = new AppRuntimeLoader(db);
  }

  async exportBackup(ctx) {
    try {
      const { appId } = ctx.params;
      const options = ctx.request.body || {};

      const MiniApp = this.db.getModel('mini_app');
      if (!MiniApp) {
        ctx.error('mini_app model not available', 500);
        return;
      }

      const appRecord = await MiniApp.findOne({ where: { id: appId, is_active: true }, raw: true });
      if (!appRecord) {
        ctx.error(`App ${appId} not found or not active`, 404);
        return;
      }

      const backupModule = await this.runtimeLoader.loadBackupExport(appId);
      if (!backupModule) {
        ctx.error(`App ${appId} does not support backup export`, 404);
        return;
      }

      const context = this.runtimeLoader.buildBackupContext(appId);
      const result = await this.runtimeLoader.exportBackup(appId, context, options);

      ctx.success(result);
    } catch (error) {
      logger.error('Export backup error:', error);
      ctx.error(error.message, 500);
    }
  }

  async importBackup(ctx) {
    try {
      const { appId } = ctx.params;
      const payload = ctx.request.body;
      const options = payload.options || {};

      const MiniApp = this.db.getModel('mini_app');
      if (!MiniApp) {
        ctx.error('mini_app model not available', 500);
        return;
      }

      const appRecord = await MiniApp.findOne({ where: { id: appId, is_active: true }, raw: true });
      if (!appRecord) {
        ctx.error(`App ${appId} not found or not active`, 404);
        return;
      }

      const backupModule = await this.runtimeLoader.loadBackupImport(appId);
      if (!backupModule) {
        ctx.error(`App ${appId} does not support backup import`, 404);
        return;
      }

      const context = this.runtimeLoader.buildBackupContext(appId);
      const result = await this.runtimeLoader.importBackup(appId, context, payload, options);

      ctx.success(result);
    } catch (error) {
      logger.error('Import backup error:', error);
      ctx.error(error.message, 500);
    }
  }

  async getBackupInfo(ctx) {
    try {
      const { appId } = ctx.params;
      const runtimeInfo = await this.runtimeLoader.getAppRuntimeInfo(appId);

      ctx.success({
        app_id: appId,
        backup_export_supported: runtimeInfo.hasBackupExport,
        backup_import_supported: runtimeInfo.hasBackupImport,
      });
    } catch (error) {
      logger.error('Get backup info error:', error);
      ctx.error(error.message, 500);
    }
  }

  async listBackupApps(ctx) {
    try {
      const MiniApp = this.db.getModel('mini_app');
      if (!MiniApp) {
        ctx.error('mini_app model not available', 500);
        return;
      }

      const apps = await MiniApp.findAll({
        where: { is_active: true },
        raw: true,
      });

      const result = [];
      for (const app of apps) {
        try {
          const runtimeInfo = await this.runtimeLoader.getAppRuntimeInfo(app.id);
          result.push({
            app_id: app.id,
            name: app.name,
            backup_export_supported: runtimeInfo.hasBackupExport,
            backup_import_supported: runtimeInfo.hasBackupImport,
          });
        } catch {
          result.push({
            app_id: app.id,
            name: app.name,
            backup_export_supported: false,
            backup_import_supported: false,
          });
        }
      }

      ctx.success(result);
    } catch (error) {
      logger.error('List backup apps error:', error);
      ctx.error(error.message, 500);
    }
  }
}

export default AppBackupController;