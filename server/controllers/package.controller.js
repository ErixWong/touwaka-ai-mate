/**
 * PackageController - 包管理控制器
 * 
 * 管理已安装包列表和白名单配置
 * 仅管理员可访问
 */

import logger from '../../lib/logger.js';
import { getPackageService } from '../services/package.service.js';

class PackageController {
  constructor(db) {
    this.db = db;
    this.packageService = getPackageService(db);
  }

  _checkAdmin(ctx) {
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return false;
    }
    return true;
  }

  /**
   * 获取已安装的包列表
   * GET /api/system/packages
   */
  async getPackages(ctx) {
    if (!this._checkAdmin(ctx)) return;
    
    try {
      const packages = await this.packageService.getAllPackages();
      ctx.success(packages);
    } catch (error) {
      logger.error('Get packages error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 获取包白名单配置
   * GET /api/system/packages/whitelist
   */
  async getWhitelist(ctx) {
    if (!this._checkAdmin(ctx)) return;
    
    try {
      const whitelist = await this.packageService.getWhitelist();
      ctx.success(whitelist);
    } catch (error) {
      logger.error('Get whitelist error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 更新包白名单配置
   * PATCH /api/system/packages/whitelist
   */
  async updateWhitelist(ctx) {
    if (!this._checkAdmin(ctx)) return;
    
    try {
      const updates = ctx.request.body;
      const whitelist = await this.packageService.updateWhitelist(updates);
      ctx.success(whitelist);
    } catch (error) {
      logger.error('Update whitelist error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 重置白名单为默认值
   * POST /api/system/packages/whitelist/reset
   */
  async resetWhitelist(ctx) {
    if (!this._checkAdmin(ctx)) return;
    
    try {
      const defaultWhitelist = this.packageService.getDefaultWhitelist();
      const whitelist = await this.packageService.updateWhitelist(defaultWhitelist);
      ctx.success(whitelist);
    } catch (error) {
      logger.error('Reset whitelist error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 安装包
   * POST /api/system/packages/install
   */
  async installPackage(ctx) {
    if (!this._checkAdmin(ctx)) return;
    
    try {
      const { type, name, version } = ctx.request.body;
      
      // 参数验证
      if (!type || !name) {
        ctx.error('Missing required parameters: type and name', 400);
        return;
      }
      
      if (!['nodejs', 'python'].includes(type)) {
        ctx.error('Invalid package type. Must be "nodejs" or "python"', 400);
        return;
      }
      
      logger.info(`Admin ${ctx.state.session?.userId} installing ${type} package: ${name}${version ? '@' + version : ''}`);
      
      const result = await this.packageService.installPackage(type, name, version);
      
      if (result.success) {
        ctx.success(result);
      } else {
        ctx.error(result.message, 400);
      }
    } catch (error) {
      logger.error('Install package error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }
}

export default PackageController;