import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op } from 'sequelize';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

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
      this.models.AppClockRegistry = this.db.getModel('app_clock_registry');
      this.models.AppState = this.db.getModel('app_state');
      this.models.AppRowHandler = this.db.getModel('app_row_handler');
      this.models.SystemSetting = this.db.getModel('system_setting');
      this.models.McpServer = this.db.getModel('mcp_server');
    }
  }

  validateTableName(tableName, appId) {
    const safePrefix = `app_${appId.replace(/-/g, '_')}_`;
    
    if (!tableName.startsWith(safePrefix)) {
      throw new Error(`Security: table ${tableName} must start with ${safePrefix}`);
    }
    
    const forbidden = ['users', 'roles', 'mini_app', 'mini_apps', 'attachment', 'knowledge', 'kb_'];
    if (forbidden.some(f => tableName.toLowerCase().includes(f))) {
      throw new Error(`Security: table ${tableName} contains forbidden keyword`);
    }
    
    return tableName;
  }

  async runMigration(appId, scriptPath, direction = 'up') {
    // 校验 scriptPath 不能包含路径穿越
    if (scriptPath.includes('..')) {
      throw new Error(`Security: invalid migration script path ${scriptPath}`);
    }
    
    const fullPath = path.join(this.appsDir, appId, scriptPath);
    
    // 校验 fullPath 是否在 appsDir 范围内
    const normalizedPath = path.normalize(fullPath);
    if (!normalizedPath.startsWith(path.normalize(this.appsDir))) {
      throw new Error(`Security: migration script path out of bounds`);
    }
    
    try {
      const migrationModule = await import(pathToFileURL(normalizedPath).href);
      const migration = migrationModule.default || migrationModule;
      
      if (migration.check) {
        const shouldRun = await migration.check(this.db.sequelize);
        if (!shouldRun) {
          logger.info(`Migration ${scriptPath} skipped (check returned false)`);
          return;
        }
      }
      
      if (direction === 'up') {
        await migration.up(this.db.sequelize);
        logger.info(`Migration ${scriptPath} executed (up)`);
      } else {
        await migration.down(this.db.sequelize);
        logger.info(`Migration ${scriptPath} executed (down)`);
      }
    } catch (err) {
      if (direction === 'down') {
        logger.warn(`Migration ${scriptPath} failed (down): ${err.message}`);
      } else {
        throw new Error(`Migration ${scriptPath} failed: ${err.message}`);
      }
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
      registry_url: config.registry_url || 'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/master/apps',
      registry_branch: config.registry_branch || 'master',
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
   * 从本地 apps 目录读取 index.json
   */
  async fetchLocalIndex() {
    const indexPath = path.join(this.appsDir, 'index.json');
    const content = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * 从 GitHub Registry 拉取索引（失败时 fallback 到本地）
   */
  async fetchIndex() {
    const config = await this.getRegistryConfig();
    
    if (config.offline_mode) {
      logger.info('Offline mode: reading from local apps/index.json');
      return await this.fetchLocalIndex();
    }
    
    const url = `${config.registry_url}/index.json`;
    logger.info(`Fetching Registry index from: ${url}`);
    
    try {
      const response = await fetch(url, { 
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const index = await response.json();
      
      await this.models.SystemSetting.update(
        { setting_value: new Date().toISOString() },
        { where: { setting_key: 'app_market.last_check_at' } }
      );
      
      return index;
    } catch (error) {
      logger.warn('Remote Registry failed, fallback to local:', error.message);
      return await this.fetchLocalIndex();
    }
  }

  /**
   * 从本地 apps 目录读取 manifest.json
   */
  async fetchLocalManifest(appId) {
    const manifestPath = path.join(this.appsDir, appId, 'manifest.json');
    const content = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * 从 GitHub Registry 拉取 App manifest（失败时 fallback 到本地）
   */
  async fetchManifest(appId) {
    const config = await this.getRegistryConfig();
    
    if (config.offline_mode) {
      logger.info(`Offline mode: reading local manifest for ${appId}`);
      return await this.fetchLocalManifest(appId);
    }
    
    const url = `${config.registry_url}/${appId}/manifest.json`;
    logger.info(`Fetching manifest for ${appId} from: ${url}`);
    
    try {
      const response = await fetch(url, { 
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`App ${appId} not found in Registry`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.warn(`Remote manifest failed for ${appId}, fallback to local:`, error.message);
      try {
        return await this.fetchLocalManifest(appId);
      } catch (localError) {
        logger.error(`App ${appId} not found locally either:`, localError.message);
        throw new Error(`App ${appId} not found in Registry or local apps`);
      }
    }
  }

  /**
   * 从本地 apps 目录读取 handler 脚本
   */
  async fetchLocalHandler(appId, handlerName) {
    const handlerPath = path.join(this.appsDir, appId, 'handlers', handlerName, 'index.js');
    return await fs.readFile(handlerPath, 'utf-8');
  }

  /**
   * 拉取处理脚本内容（失败时 fallback 到本地）
   */
  async fetchHandler(appId, handlerName) {
    const config = await this.getRegistryConfig();
    
    if (config.offline_mode) {
      logger.info(`Offline mode: reading local handler ${handlerName} for ${appId}`);
      return await this.fetchLocalHandler(appId, handlerName);
    }
    
    const url = `${config.registry_url}/${appId}/handlers/${handlerName}/index.js`;
    logger.info(`Fetching handler ${handlerName} for ${appId}`);
    
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch handler: HTTP ${response.status}`);
      }
      
      return await response.text();
    } catch (error) {
      logger.warn(`Remote handler failed for ${handlerName}, fallback to local:`, error.message);
      try {
        return await this.fetchLocalHandler(appId, handlerName);
      } catch (localError) {
        logger.error(`Handler ${handlerName} not found locally:`, localError.message);
        throw error;
      }
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
      const requiredMcp = compatibility.requires.mcp;
      
      // 支持两种格式：
      // 1. 数组格式：只要有一个满足即可（容错设计）
      // 2. 对象格式：{ all: [...], any: [...] }
      if (Array.isArray(requiredMcp)) {
        // 数组格式：多服务容错，至少有一个即可
        const hasAny = requiredMcp.some(mcp => configuredMcp.includes(mcp));
        if (!hasAny) {
          missing.mcp = requiredMcp; // 返回所有可能的选项
        }
      } else if (typeof requiredMcp === 'object') {
        // 对象格式：精确控制
        if (requiredMcp.all) {
          // 必须全部满足
          for (const mcp of requiredMcp.all) {
            if (!configuredMcp.includes(mcp)) {
              missing.mcp.push(mcp);
            }
          }
        }
        if (requiredMcp.any) {
          // 至少满足一个
          const hasAny = requiredMcp.any.some(mcp => configuredMcp.includes(mcp));
          if (!hasAny) {
            missing.mcp = requiredMcp.any;
          }
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
      where: { is_enabled: true },
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

  /**
   * 拉取迁移脚本
   */
  async fetchLocalMigration(appId, scriptPath) {
    if (scriptPath.includes('..')) {
      throw new Error(`Security: invalid migration script path ${scriptPath}`);
    }
    const fullPath = path.join(this.appsDir, appId, scriptPath);
    const normalizedPath = path.normalize(fullPath);
    if (!normalizedPath.startsWith(path.normalize(this.appsDir))) {
      throw new Error(`Security: migration script path out of bounds`);
    }
    return await fs.readFile(normalizedPath, 'utf-8');
  }

  async fetchMigration(appId, scriptPath) {
    const config = await this.getRegistryConfig();
    
    if (config.offline_mode) {
      logger.info(`Offline mode: reading local migration ${scriptPath} for ${appId}`);
      return await this.fetchLocalMigration(appId, scriptPath);
    }
    
    const url = `${config.registry_url}/${appId}/${scriptPath}`;
    logger.info(`Fetching migration ${scriptPath} for ${appId}`);
    
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch migration: HTTP ${response.status}`);
      }
      
      return await response.text();
    } catch (error) {
      logger.warn(`Remote migration failed for ${scriptPath}, fallback to local:`, error.message);
      try {
        return await this.fetchLocalMigration(appId, scriptPath);
      } catch (localError) {
        logger.error(`Migration ${scriptPath} not found locally:`, localError.message);
        throw error;
      }
    }
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
    
    // 4. 校验 extension_tables 表名
    if (manifest.extension_tables) {
      for (const table of manifest.extension_tables) {
        this.validateTableName(table.name, appId);
      }
    }
    
    // 5. 创建 App 目录
    const appDir = path.join(this.appsDir, appId);
    let migrationExecuted = false;
    
    try {
      await fs.mkdir(appDir, { recursive: true });
      
      // 6. 拉取并保存 migration 文件
      if (manifest.migrations?.install) {
        const scriptContent = await this.fetchMigration(appId, manifest.migrations.install);
        const scriptDir = path.join(appDir, path.dirname(manifest.migrations.install));
        await fs.mkdir(scriptDir, { recursive: true });
        await fs.writeFile(
          path.join(appDir, manifest.migrations.install),
          scriptContent,
          'utf-8'
        );
      }
      
      if (manifest.migrations?.uninstall) {
        const scriptContent = await this.fetchMigration(appId, manifest.migrations.uninstall);
        const scriptDir = path.join(appDir, path.dirname(manifest.migrations.uninstall));
        await fs.mkdir(scriptDir, { recursive: true });
        await fs.writeFile(
          path.join(appDir, manifest.migrations.uninstall),
          scriptContent,
          'utf-8'
        );
      }
      
      // 7. 执行迁移脚本
      if (manifest.migrations?.install) {
        await this.runMigration(appId, manifest.migrations.install, 'up');
        migrationExecuted = true;
      }
      
      // 8. 保存 manifest 到本地
      await fs.writeFile(
        path.join(appDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
      );
      
      // 9. 插入数据库（extension_tables 存入 config）
      const config = {
        ...manifest.config,
        extension_tables: manifest.extension_tables || []
      };
      await this.installAppMetadata(manifest, userId, visibility, config);
      
      // 10. 安装 handlers（处理脚本）
      const { handlerIdMap } = await this.installHandlers(appId, manifest);
      
      // 11. 安装 states（状态机），传入 handlerIdMap
      await this.installStates(appId, manifest, handlerIdMap);
      
      // 12. 注册到 app_clock_registry
      await this.registerToClockRegistry(appId);
      
      logger.info(`App ${appId} installed successfully`);
      
      return {
        success: true,
        app_id: appId,
        name: manifest.name,
        version: manifest.version
      };
    } catch (error) {
      logger.error(`App ${appId} installation failed, rolling back:`, error);
      await this.rollbackInstall(appId, appDir, migrationExecuted, manifest);
      throw error;
    }
  }

  /**
   * 安装失败回滚
   */
  async rollbackInstall(appId, appDir, migrationExecuted, manifest) {
    // 1. 如果已执行 install migration，尝试执行 uninstall migration 回滚
    if (migrationExecuted && manifest.migrations?.uninstall) {
      try {
        await this.runMigration(appId, manifest.migrations.uninstall, 'up');
        logger.info(`Rolled back migration for ${appId}`);
      } catch (err) {
        logger.warn(`Failed to rollback migration for ${appId}:`, err);
      }
    }
    
    // 2. 删除数据库记录（如果已创建）
    try {
      await this.models.MiniApp.destroy({ where: { id: appId } });
      await this.models.AppClockRegistry.destroy({ where: { app_id: appId } });
      await this.models.AppState.destroy({ where: { app_id: appId } });
      await this.models.AppRowHandler.destroy({ 
        where: { handler: { [Op.like]: `apps/${appId}/handlers/%` } }
      });
      logger.info(`Rolled back DB records for ${appId}`);
    } catch (err) {
      logger.warn(`Failed to rollback DB records for ${appId}:`, err);
    }
    
    // 3. 删除目录
    try {
      await fs.rm(appDir, { recursive: true, force: true });
      logger.info(`Rolled back app directory for ${appId}`);
    } catch (err) {
      logger.warn(`Failed to rollback app directory for ${appId}:`, err);
    }
    
    logger.info(`Installation rollback completed for ${appId}`);
  }

  /**
   * 安装 App 元数据到数据库
   */
  async installAppMetadata(manifest, userId, visibility, config = null) {
    await this.models.MiniApp.create({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      icon: manifest.icon || '📱',
      type: manifest.type,
      component: manifest.component || null,
      fields: JSON.stringify(manifest.fields || []),
      views: JSON.stringify(manifest.views || {}),
      config: JSON.stringify(config || manifest.config || {}),
      visibility,
      owner_id: userId,
      creator_id: userId,
      sort_order: 0,
      is_active: true,
      revision: 1
    });
  }

  /**
   * 注册 App 到 app_clock_registry
   */
  async registerToClockRegistry(appId) {
    this.ensureModels();
    
    const Utils = await import('../../lib/utils.js');
    
    await this.models.AppClockRegistry.create({
      id: Utils.default.newID(20),
      app_id: appId,
      tick_script: null,
      is_active: true
    });
    
    logger.info(`App ${appId} registered to app_clock_registry`);
  }

  /**
   * 恢复 App metadata（用于更新失败时回滚）
   */
  async restoreAppMetadata(appId, backup, userId) {
    this.ensureModels();
    
    const Utils = await import('../../lib/utils.js');
    
    await this.models.MiniApp.create({
      id: appId,
      name: backup.name || appId,
      description: backup.description || '',
      icon: backup.icon || '',
      type: backup.type || 'document',
      component: backup.component || null,
      fields: backup.fields || '[]',
      views: backup.views || '{}',
      config: backup.config || '{}',
      visibility: backup.visibility || 'all',
      owner_id: backup.owner_id || userId,
      creator_id: backup.creator_id || userId,
      sort_order: backup.sort_order || 0,
      is_active: backup.is_active !== undefined ? backup.is_active : true,
      revision: backup.revision || 1
    });
    
    await this.models.AppClockRegistry.create({
      id: Utils.default.newID(20),
      app_id: appId,
      tick_script: null,
      is_active: true
    });
    
    logger.info(`App ${appId} metadata restored after failed update`);
  }

  // ==================== 安装 States（状态机）====================
  async installStates(appId, manifest, handlerIdMap = new Map()) {
    if (!manifest.states || manifest.states.length === 0) return;
    
    for (const state of manifest.states) {
      // handler_id 引用 app_row_handlers 表的实际 ID
      let handlerId = null;
      if (state.handler && handlerIdMap.has(state.handler)) {
        handlerId = handlerIdMap.get(state.handler);
      }
      
      await this.models.AppState.create({
        id: Utils.newID(20),
        app_id: appId,
        name: state.name,
        label: state.label,
        description: state.description || null,
        sort_order: state.sort_order || 0,
        is_initial: state.is_initial || false,
        is_terminal: state.is_terminal || false,
        is_error: state.is_error || false,
        handler_id: handlerId,
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
    const handlerIdMap = new Map(); // handlerName → app_row_handlers.id
    
    if (!manifest.states) return { installed, handlerIdMap };
    
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
        // 先检查 handler 是否已存在于数据库（通用 handler）
        const existingHandler = await this.models.AppRowHandler.findByPk(handlerName);
        if (existingHandler) {
          handlerIdMap.set(handlerName, handlerName);
          installed.push(handlerName);
          logger.info(`Handler ${handlerName} already exists, using existing handler`);
          continue;
        }

        // 先检查本地是否已有 handler 脚本
        const localHandlerPath = path.join(appHandlersDir, handlerName, 'index.js');
        let scriptContent;
        try {
          scriptContent = await fs.readFile(localHandlerPath, 'utf-8');
          logger.info(`Handler ${handlerName} found locally at ${localHandlerPath}`);
        } catch {
          // 本地没有，从 Registry 拉取
          scriptContent = await this.fetchHandler(appId, handlerName);
        }

        // 保存到本地
        const handlerDir = path.join(appHandlersDir, handlerName);
        await fs.mkdir(handlerDir, { recursive: true });
        await fs.writeFile(
          path.join(handlerDir, 'index.js'),
          scriptContent,
          'utf-8'
        );

        // 插入数据库记录
        const handlerId = `${appId}-${handlerName}`;
        await this.models.AppRowHandler.create({
          id: handlerId,
          name: handlerName,
          description: `${manifest.name} - ${handlerName}`,
          handler: `apps/${appId}/handlers/${handlerName}`,
          handler_function: 'process',
          concurrency: manifest.config?.handler_concurrency?.[handlerName] || 3,
          timeout: manifest.config?.handler_timeout?.[handlerName] || 60,
          max_retries: 2,
          is_active: true
        });

        // 记录映射关系：handler名称 → 数据库ID
        handlerIdMap.set(handlerName, handlerId);
        installed.push(handlerName);
        logger.info(`Installed handler ${handlerName} for ${appId}`);
      } catch (error) {
        logger.error(`Failed to install handler ${handlerName}:`, error.message);
        // 继续安装其他 handlers
      }
    }
    
    return { installed, handlerIdMap };
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
    
    // 2. 获取 manifest（从 app.config 或本地文件）
    let manifest;
    try {
      const manifestPath = path.join(this.appsDir, appId, 'manifest.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
    } catch (err) {
      // fallback: 从 app.config 读取 extension_tables
      const config = app.config ? JSON.parse(app.config) : {};
      manifest = {
        migrations: config.migrations || null
      };
    }
    
    // 3. 执行卸载迁移脚本（keepData=true 时不执行，避免删除表结构）
    if (!keepData && manifest.migrations?.uninstall) {
      await this.runMigration(appId, manifest.migrations.uninstall, 'up');
    }
    
    // 4. 删除数据库记录
    await this.models.MiniApp.destroy({ where: { id: appId } });
    await this.models.AppState.destroy({ where: { app_id: appId } });
    await this.models.AppRowHandler.destroy({ 
      where: { handler: { [Op.like]: `apps/${appId}/handlers/%` } }
    });
    await this.models.AppClockRegistry.destroy({ where: { app_id: appId } });
    
    // 5. 根据选项决定是否删除数据行
    if (!keepData) {
      const { MiniAppRow } = this.db.getModels();
      await MiniAppRow.destroy({ where: { app_id: appId } });
    }
    
    // 6. 删除本地文件
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
