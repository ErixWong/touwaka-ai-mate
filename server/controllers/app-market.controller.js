import logger from '../../lib/logger.js';
import AppMarketService from '../services/app-market.service.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * App Market 控制器
 */
class AppMarketController {
  constructor(db) {
    this.db = db;
    this.appMarketService = new AppMarketService(db);
  }

  // ==================== Registry 配置 ====================

  /**
   * 获取 Registry 配置
   */
  async getSettings(ctx) {
    try {
      const config = await this.appMarketService.getRegistryConfig();
      ctx.success(config);
    } catch (error) {
      logger.error('Get registry settings error:', error);
      ctx.error(error.message, 500);
    }
  }

  /**
   * 更新 Registry 配置
   */
  async updateSettings(ctx) {
    try {
      const updates = ctx.request.body;
      await this.appMarketService.updateRegistryConfig(updates);
      ctx.success({ message: 'Settings updated' });
    } catch (error) {
      logger.error('Update registry settings error:', error);
      ctx.error(error.message, 400);
    }
  }

  // ==================== Registry 浏览 ====================

  /**
   * 获取 Registry 索引（可用 App 列表）
   */
  async getIndex(ctx) {
    try {
      const index = await this.appMarketService.fetchIndex();
      ctx.success(index);
    } catch (error) {
      logger.error('Fetch registry index error:', error);
      ctx.error(error.message, 500);
    }
  }

  /**
   * 获取 App manifest（从 Registry 拉取）
   */
  async getManifest(ctx) {
    try {
      const { appId } = ctx.params;
      const manifest = await this.appMarketService.fetchManifest(appId);
      ctx.success(manifest);
    } catch (error) {
      logger.error(`Fetch manifest for ${ctx.params.appId} error:`, error);
      ctx.error(error.message, 404);
    }
  }

  // ==================== App 安装/卸载 ====================

  /**
   * 检查依赖
   */
  async checkDependencies(ctx) {
    try {
      const { app_id } = ctx.request.body;
      const manifest = await this.appMarketService.fetchManifest(app_id);
      const result = await this.appMarketService.checkDependencies(manifest);
      ctx.success(result);
    } catch (error) {
      logger.error('Check dependencies error:', error);
      ctx.error(error.message, 400);
    }
  }

  /**
   * 安装 App
   */
  async installApp(ctx) {
    try {
      const { app_id, visibility = 'all' } = ctx.request.body;
      const userId = ctx.state.session.id;
      
      const result = await this.appMarketService.installApp(app_id, {
        userId,
        visibility
      });
      
      ctx.success(result, 'App installed successfully');
    } catch (error) {
      logger.error('Install app error:', error);
      ctx.error(error.message, 400);
    }
  }

  /**
   * 卸载 App
   */
  async uninstallApp(ctx) {
    try {
      const { appId } = ctx.params;
      const { keep_data = false } = ctx.request.body || {};
      
      const result = await this.appMarketService.uninstallApp(appId, {
        keepData: keep_data
      });
      
      ctx.success(result, 'App uninstalled successfully');
    } catch (error) {
      logger.error('Uninstall app error:', error);
      ctx.error(error.message, 400);
    }
  }

  /**
   * 检查更新
   */
  async checkUpdate(ctx) {
    try {
      const { appId } = ctx.params;
      const result = await this.appMarketService.checkUpdate(appId);
      ctx.success(result);
    } catch (error) {
      logger.error('Check update error:', error);
      ctx.error(error.message, 400);
    }
  }

  /**
   * 更新 App（重新安装最新版本）
   */
  async updateApp(ctx) {
    try {
      const { appId } = ctx.params;
      const userId = ctx.state.session.id;
      
      // 保留旧 App 的 visibility
      const oldApp = await this.db.getModels().MiniApp.findByPk(appId);
      const oldVisibility = oldApp ? oldApp.visibility : 'all';
      
      // 先卸载旧版本（保留数据）
      await this.appMarketService.uninstallApp(appId, { keepData: true });
      
      // 安装新版本
      const result = await this.appMarketService.installApp(appId, {
        userId,
        visibility: oldVisibility
      });
      
      ctx.success(result, 'App updated successfully');
    } catch (error) {
      logger.error('Update app error:', error);
      ctx.error(error.message, 400);
    }
  }

  // ==================== 自定义组件 ====================

  /**
   * 获取 App 自定义组件代码
   */
  async getComponent(ctx) {
    try {
      const { appId } = ctx.params;
      const { MiniApp } = this.db.getModels();
      
      // 获取 App 信息
      const app = await MiniApp.findByPk(appId);
      if (!app || !app.is_active) {
        ctx.error('App not found or inactive', 404);
        return;
      }
      
      // 无自定义组件
      if (!app.component) {
        ctx.status = 204;
        return;
      }
      
      // 从文件系统读取组件代码
      const componentPath = path.join(
        process.cwd(),
        'apps',
        appId,
        'frontend',
        `${app.component}.umd.js`
      );
      
      try {
        const code = await fs.readFile(componentPath, 'utf-8');
        
        // 读取 CSS（可选）
        const cssPath = componentPath.replace('.umd.js', '.css');
        let css = null;
        try {
          css = await fs.readFile(cssPath, 'utf-8');
        } catch {
          // CSS 不存在，忽略
        }
        
        // 获取文件修改时间作为版本
        const stat = await fs.stat(componentPath);
        const version = stat.mtime.toISOString();
        
        // ETag 缓存
        const etag = `"${version}"`;
        if (ctx.headers['if-none-match'] === etag) {
          ctx.status = 304;
          return;
        }
        
        ctx.set('ETag', etag);
        ctx.set('Cache-Control', 'public, max-age=3600');
        ctx.success({
          name: app.component,
          code,
          css,
          version
        });
      } catch (error) {
        logger.error(`Failed to load component for ${appId}:`, error);
        ctx.error(`Component ${app.component} not found`, 404);
      }
    } catch (error) {
      logger.error('Get component error:', error);
      ctx.error(error.message, 500);
    }
  }
}

export default AppMarketController;
