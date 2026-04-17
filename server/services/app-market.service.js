import logger from '../../lib/logger.js';
import { Op } from 'sequelize';
import fs from 'fs/promises';
import path from 'path';
import { generateId } from '../../lib/utils.js';

/**
 * App Market 服务
 * 负责从 GitHub Registry 拉取、安装、卸载 App
 */
class AppMarketService {
  constructor(db) {
    this.db = db;
    this.models = {};
    this.appsDir = path.join(process.cwd(), 'apps');
  }

  ensureModels() {
    if (!this.models.MiniApp) {
      this.models.MiniApp = this.db.getModel('mini_app');
      this.models.AppState = this.db.getModel('app_state');
      this.models.AppRowHandler = this.db.getModel('app_row_handler');
      this.models.SystemSetting = this.db.getModel('system_setting');
      this.models.McpServer = this.db.getModel('mcp_server');
    }
  }

  // ==================== Registry 配置 ====================

  /**
   * 获取 Registry 配置
   */
  async getRegistryConfig() {
    this.ensureModels();
    
    const settings = await this.models.SystemSetting.findAll({
      where: { setting_key: { [Op.like]: 'app_market.%' } }
    });
    
    const config = {};
    for (const s of settings) {
      const key = s.setting_key.replace('app_market.', '');
      config[key] = this.parseValue(s.setting_value, s.value_type);
    }
    
    return {
      registry_url: config.registry_url || 'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps',
      registry_branch: config.registry_branch || 'main',
      auto_check_updates: config.auto_check_updates !== 'false',
      check_interval_hours: parseInt(config.check_interval_hours) || 24,
      offline_mode: config.offline_mode === 'true',
      cache_ttl_hours: parseInt(config.cache_ttl_hours) || 168,
      last_check_at: config.last_check_at || null
    };
  }

  parseValue(value, type) {
    switch (type) {
      case 'boolean': return value === 'true';
      case 'number': return parseFloat(value);
      default: return value;
    }
  }

  /**
   * 更新 Registry 配置
   */
  async updateRegistryConfig(updates) {
    this.ensureModels();
    
    for (const [key, value] of Object.entries(updates)) {
      const settingKey = `app_market.${key}`;
      const stringValue = String(value);
      
      // 推断 value_type
      let valueType = 'string';
      if (typeof value === 'boolean') valueType = 'boolean';
      else if (typeof value === 'number') valueType = 'number';
      
      await this.models.SystemSetting.upsert({
        setting_key: settingKey,
        setting_value: stringValue,
        value_type: valueType
      });
    }
    
    logger.info('Registry config updated:', updates);
  }

  // ==================== Registry 拉取 ====================

  /**
   * 从 GitHub Registry 拉取索引
   */
  async fetchIndex() {
    const config = await this.getRegistryConfig();
    const url = `${config.registry_url}/index.json`;
    
    logger.info(`Fetching Registry index from: ${url}`);
    
    try {
      const response = await fetch(url, { 
        headers: { 'Accept': 'application/json' },
        timeout: 10000 
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const index = await response.json();
      
      // 更新最后检查时间
      await this.models.SystemSetting.update(
        { setting_value: new Date().toISOString() },
        { where: { setting_key: 'app_market.last_check_at' } }
      );
      
      return index;
    } catch (error) {
      logger.error('Failed to fetch Registry index:', error);
      throw new Error(`无法连接到 App Market Registry: ${error.message}`);
    }
  }

  /**
   * 从 GitHub Registry 拉取 App manifest
   */
  async fetchManifest(appId) {
    const config = await this.getRegistryConfig();
    const url = `${config.registry_url}/${appId}/manifest.json`;
    
    logger.info(`Fetching manifest for ${appId} from: ${url}`);
    
    try {
      const response = await fetch(url, { 
        headers: { 'Accept': 'application/json' },
        timeout: 10000 
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`App ${appId} not found in Registry`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.error(`Failed to fetch manifest for ${appId}:`, error);
      throw error;
    }
  }

  /**
   * 拉取处理脚本内容
   */
  async fetchHandler(appId, handlerName) {
    const config = await this.getRegistryConfig();
    const url = `${config.registry_url}/${appId}/handlers/${handlerName}/index.js`;
    
    logger.info(`Fetching handler ${handlerName} for ${appId}`);
    
    try {
      const response = await fetch(url, { timeout: 10000 });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch handler: HTTP ${response.status}`);
      }
      
      return await response.text();
    } catch (error) {
      logger.error(`Failed to fetch handler ${handlerName}:`, error);
      throw error;
    }
  }

  // ==================== 依赖检查 ====================

  /**
   * 检查 App 依赖是否满足
   */
  async checkDependencies(manifest) {
    this.ensureModels();
    
    const missing = { mcp: [], skills: [], platform_version: false };
    const compatibility = manifest.compatibility || {};
    
    // 检查 MCP 服务
    if (compatibility.requires?.mcp) {
      const configuredMcp = await this.getConfiguredMcpServices();
      for (const mcp of compatibility.requires.mcp) {
        if (!configuredMcp.includes(mcp)) {
          missing.mcp.push(mcp);
        }
      }
    }
    
    // 检查平台版本（简化处理，实际应比较版本号）
    if (compatibility.min_platform_version) {
      const currentVersion = process.env.PLATFORM_VERSION || '2.0.0';
      if (this.compareVersion(currentVersion, compatibility.min_platform_version) < 0) {
        missing.platform_version = true;
      }
    }
    
    return {
      satisfied: missing.mcp.length === 0 && missing.skills.length === 0 && !missing.platform_version,
      missing
    };
  }

  async getConfiguredMcpServices() {
    this.ensureModels();
    const servers = await this.models.McpServer.findAll({
      where: { is_active: true },
      attributes: ['name']
    });
    return servers.map(s => s.name);
  }

  compareVersion(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    return 0;
  }

  // ==================== App 安装 ====================

  /**
   * 安装 App
   */
  async installApp(appId, options = {}) {
    this.ensureModels();
    
    const { userId, visibility = 'all' } = options;
    
    // 1. 检查 App 是否已存在
    const existing = await this.models.MiniApp.findByPk(appId);
    if (existing) {
      throw new Error(`App ${appId} 已安装`);
    }
    
    // 2. 拉取 manifest
    const manifest = await this.fetchManifest(appId);
    
    // 3. 检查依赖
    const deps = await this.checkDependencies(manifest);
    if (!deps.satisfied) {
      const missingMcp = deps.missing.mcp.join(', ');
      throw new Error(`缺少依赖的 MCP 服务: ${missingMcp}`);
    }
    
    // 4. 创建 App 目录
    const appDir = path.join(this.appsDir, appId);
    await fs.mkdir(appDir, { recursive: true });
    
    // 5. 保存 manifest 到本地
    await fs.writeFile(
      path.join(appDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );
    
    // 6. 安装 handlers
    const installedHandlers = await this.installHandlers(appId, manifest);
    
    // 7. 插入数据库
    await this.installAppMetadata(manifest, userId, visibility);
    await this.installStates(appId, manifest);
    
    logger.info(`App ${appId} installed successfully`);
    
    return {
      success: true,
      app_id: appId,
      name: manifest.name,
      version: manifest.version,
      installed_handlers: installedHandlers
    };
  }

  /**
   * 安装 App 元数据到数据库
   */
  async installAppMetadata(manifest, userId, visibility) {
    await this.models.MiniApp.create({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      icon: manifest.icon || '📱',
      type: manifest.type,
      component: manifest.component || null,
      fields: JSON.stringify(manifest.fields || []),
      views: JSON.stringify(manifest.views || {}),
      config: JSON.stringify(manifest.config || {}),
      visibility,
      owner_id: userId,
      creator_id: userId,
      sort_order: 0,
      is_active: true,
      revision: 1
    });
  }

  /**
   * 安装状态定义到数据库
   */
  async installStates(appId, manifest) {
    if (!manifest.states || manifest.states.length === 0) return;
    
    for (const state of manifest.states) {
      await this.models.AppState.create({
        id: generateId(),
        app_id: appId,
        name: state.name,
        label: state.label,
        sort_order: state.sort_order || 0,
        is_initial: state.is_initial || false,
        is_terminal: state.is_terminal || false,
        is_error: state.is_error || false,
        handler_id: state.handler || null,
        success_next_state: state.success_next || null,
        failure_next_state: state.failure_next || null
      });
    }
  }

  /**
   * 安装处理脚本
   */
  async installHandlers(appId, manifest) {
    const installed = [];
    
    if (!manifest.states) return installed;
    
    // 收集需要安装的 handlers（去重）
    const handlerNames = new Set();
    for (const state of manifest.states) {
      if (state.handler) {
        handlerNames.add(state.handler);
      }
    }
    
    // App 专属 handlers 目录
    const appHandlersDir = path.join(this.appsDir, appId, 'handlers');
    await fs.mkdir(appHandlersDir, { recursive: true });
    
    for (const handlerName of handlerNames) {
      try {
        // 从 Registry 拉取脚本
        const scriptContent = await this.fetchHandler(appId, handlerName);
        
        // 保存到本地
        const handlerDir = path.join(appHandlersDir, handlerName);
        await fs.mkdir(handlerDir, { recursive: true });
        await fs.writeFile(
          path.join(handlerDir, 'index.js'),
          scriptContent,
          'utf-8'
        );
        
        // 插入数据库记录
        await this.models.AppRowHandler.create({
          id: `${appId}-${handlerName}`,
          name: handlerName,
          description: `${manifest.name} - ${handlerName}`,
          handler: `apps/${appId}/handlers/${handlerName}`,
          handler_function: 'process',
          concurrency: 3,
          timeout: 60,
          max_retries: 2,
          is_active: true
        });
        
        installed.push(handlerName);
        logger.info(`Installed handler ${handlerName} for ${appId}`);
      } catch (error) {
        logger.error(`Failed to install handler ${handlerName}:`, error);
        // 继续安装其他 handlers
      }
    }
    
    return installed;
  }

  // ==================== App 卸载 ====================

  /**
   * 卸载 App
   */
  async uninstallApp(appId, options = {}) {
    this.ensureModels();
    
    const { keepData = false } = options;
    
    // 1. 检查 App 是否存在
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) {
      throw new Error(`App ${appId} 不存在`);
    }
    
    // 2. 删除数据库记录
    await this.models.MiniApp.destroy({ where: { id: appId } });
    await this.models.AppState.destroy({ where: { app_id: appId } });
    await this.models.AppRowHandler.destroy({ 
      where: { handler: { [Op.like]: `apps/${appId}/handlers/%` } }
    });
    
    // 3. 根据选项决定是否删除数据行
    if (!keepData) {
      const { MiniAppRow } = this.db.getModels();
      await MiniAppRow.destroy({ where: { app_id: appId } });
    }
    
    // 4. 删除本地文件
    const appDir = path.join(this.appsDir, appId);
    try {
      await fs.rm(appDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(`Failed to remove app directory ${appDir}:`, error);
    }
    
    logger.info(`App ${appId} uninstalled successfully`);
    
    return { success: true, app_id: appId, keepData };
  }

  // ==================== App 更新 ====================

  /**
   * 检查更新
   */
  async checkUpdate(appId) {
    this.ensureModels();
    
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) {
      throw new Error(`App ${appId} 不存在`);
    }
    
    const manifest = await this.fetchManifest(appId);
    const localVersion = app.getDataValue ? app.getDataValue('revision') : 1;
    
    return {
      has_update: this.compareVersion(manifest.version, localVersion.toString()) > 0,
      local_version: localVersion.toString(),
      registry_version: manifest.version,
      changelog: manifest.changelog || ''
    };
  }
}

export default AppMarketService;
