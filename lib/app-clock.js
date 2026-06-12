import logger from './logger.js';
import Utils from './utils.js';
import { Sequelize } from 'sequelize';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import ExtensionTableService from '../server/services/extension-table.service.js';
import InternalLLMService from './internal-llm-service.js';
import DocumentOcrService from './document-ocr-service.js';

class AppClock {
  constructor(db, config = {}) {
    this.db = db;
    this.sequelize = db.sequelize;
    this.intervalMs = config.intervalMs || 5000;
    this.residentSkillManager = config.residentSkillManager || null;
    this.skillLoader = config.skillLoader || null;
    this.extensionService = new ExtensionTableService(db);
    this.llmService = new InternalLLMService(db);
    this.running = false;
    this.timer = null;
    this.lastWakeIndex = 0;
    this.runningApps = new Set();
    this.appFailures = new Map();
    this.tickTimeoutMs = config.tickTimeoutMs || 30000;
    this.maxConsecutiveFailures = config.maxConsecutiveFailures || 3;
    this.failureCooldownMs = config.failureCooldownMs || 2 * 60 * 1000;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    logger.info(`[AppClock] Started (interval=${this.intervalMs}ms, callback mode)`);

    await this.validateTickScripts();

    this.timer = setInterval(() => {
      this.wakeNext().catch(err => {
        logger.error('[AppClock] Wake error:', err.message);
      });
    }, this.intervalMs);
    
    setImmediate(() => this.wakeNext());
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[AppClock] Stopped');
  }

  async wakeNext() {
    const AppClockRegistry = this.db.getModel('app_clock_registry');
    
    if (!AppClockRegistry) {
      logger.warn('[AppClock] app_clock_registry model not available');
      return;
    }
    
    const activeEntries = await AppClockRegistry.findAll({
      where: { is_active: true },
      order: [['created_at', 'ASC']]
    });
    
    if (activeEntries.length === 0) {
      return;
    }
    
    const entry = activeEntries[this.lastWakeIndex % activeEntries.length];
    this.lastWakeIndex++;

    const failureState = this.appFailures.get(entry.app_id);
    if (failureState?.cooldownUntil && Date.now() < failureState.cooldownUntil) {
      logger.warn(`[AppClock] Skip app ${entry.app_id}: in cooldown until ${new Date(failureState.cooldownUntil).toISOString()}`);
      return;
    }
    
    logger.info(`[AppClock] Waking app: ${entry.app_id}`);
    await this.invokeTick(entry);
  }

  async invokeTick(entry) {
    const startTime = Date.now();
    const AppTickLog = this.db.getModel('app_tick_log');
    const MiniApp = this.db.getModel('mini_app');

    if (this.runningApps.has(entry.app_id)) {
      logger.warn(`[AppClock] Skip app ${entry.app_id}: previous tick is still running`);
      return;
    }

    this.runningApps.add(entry.app_id);
    
    try {
      const app = await MiniApp.findByPk(entry.app_id);
      
      const scriptModule = await this.loadTickScript(entry, app);
      const context = this.buildContext(app, entry);

      const result = await Promise.race([
        scriptModule.tick(context),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Tick timeout after ${this.tickTimeoutMs}ms`)), this.tickTimeoutMs);
        }),
      ]);
      const duration = Date.now() - startTime;

      this.appFailures.delete(entry.app_id);
      
      await AppTickLog.create({
        id: Utils.newID(20),
        registry_id: entry.id,
        app_id: entry.app_id,
        success: true,
        output_data: result ? JSON.stringify(result) : null,
        duration
      });
      
      logger.info(`[AppClock] App ${entry.app_id} tick completed (${duration}ms)`);
      
    } catch (err) {
      const duration = Date.now() - startTime;

      const currentFailureState = this.appFailures.get(entry.app_id) || { count: 0, cooldownUntil: null };
      const nextCount = currentFailureState.count + 1;
      const nextFailureState = {
        count: nextCount,
        cooldownUntil: nextCount >= this.maxConsecutiveFailures
          ? Date.now() + this.failureCooldownMs
          : null,
      };
      this.appFailures.set(entry.app_id, nextFailureState);
      
      await AppTickLog.create({
        id: Utils.newID(20),
        registry_id: entry.id,
        app_id: entry.app_id,
        success: false,
        error_message: err.message,
        duration
      });
      
      logger.error(`[AppClock] App ${entry.app_id} tick failed: ${err.message} (${duration}ms)`);
      if (nextFailureState.cooldownUntil) {
        logger.warn(`[AppClock] App ${entry.app_id} entered cooldown after ${nextCount} consecutive failures until ${new Date(nextFailureState.cooldownUntil).toISOString()}`);
      }
    } finally {
      this.runningApps.delete(entry.app_id);
    }
  }

  buildContext(app, entry) {
    const documentOcrService = new DocumentOcrService(this.db, {
      callMcp: async (server, tool, params, timeoutMs) => {
        return await this.callMcp(server, tool, params, timeoutMs);
      },
    });

    return {
      db: this.db,
      sequelize: this.sequelize,
      app: app ? app.toJSON() : null,
      registry: entry.toJSON(),
      documentOcrService,
      
      services: {
        llm: this.llmService,
        
        callMcp: async (server, tool, params, timeoutMs) => {
          return await this.callMcp(server, tool, params, timeoutMs);
        },
        
        callSkill: async (name, method, params) => {
          return await this.callSkill(name, method, params);
        },
        
        callExtension: async (table, action, data) => {
          if (!app) {
            throw new Error('App not found for callExtension');
          }
          return await this.extensionService.handle(app.id, table, action, data);
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
        
        query: async (sql, replacements = []) => {
          return await this.sequelize.query(sql, {
            replacements,
            type: Sequelize.QueryTypes.SELECT
          });
        },
        
        execute: async (sql, replacements = []) => {
          return await this.sequelize.query(sql, {
            replacements,
            type: Sequelize.QueryTypes.RAW
          });
        },
        
        log: async (action, data = {}) => {
          const AppTickLog = this.db.getModel('app_tick_log');
          await AppTickLog.create({
            id: Utils.newID(20),
            registry_id: entry.id,
            app_id: entry.app_id,
            success: true,
            output_data: JSON.stringify({ action, ...data }),
            duration: 0
          });
        },
        
        getModel: (modelName) => {
          return this.db.getModel(modelName);
        },

        documentOcr: documentOcrService,
      }
    };
  }

  async validateTickScripts() {
    const AppClockRegistry = this.db.getModel('app_clock_registry');

    if (!AppClockRegistry) {
      logger.warn('[AppClock] app_clock_registry model not available, skipping tick script validation');
      return;
    }

    const entries = await AppClockRegistry.findAll();

    if (entries.length === 0) return;

    const appsDir = path.join(process.cwd(), 'apps');

    for (const entry of entries) {
      const defaultPath = path.join(appsDir, entry.app_id, 'tick');
      const scriptPath = entry.tick_script
        ? path.join(appsDir, entry.app_id, entry.tick_script)
        : defaultPath;

      const indexPath = path.join(scriptPath, 'index.js');

      if (!fs.existsSync(indexPath)) {
        logger.warn(`[AppClock] App "${entry.app_id}" tick script not found at ${indexPath}, keeping registry state unchanged`);
      } else {
        logger.info(`[AppClock] App "${entry.app_id}" tick script validated: ${indexPath}`);
      }
    }
  }

  async loadTickScript(entry, app) {
    const appsDir = path.join(process.cwd(), 'apps');
    
    const defaultPath = path.join(appsDir, entry.app_id, 'tick');
    
    const scriptPath = entry.tick_script
      ? path.join(appsDir, entry.app_id, entry.tick_script)
      : defaultPath;
    
    const normalizedPath = path.normalize(scriptPath);
    if (!normalizedPath.startsWith(path.normalize(appsDir))) {
      throw new Error(`Script path not allowed: ${scriptPath}`);
    }
    
    try {
      const module = await import(`file://${normalizedPath.replace(/\\/g, '/')}/index.js?t=${Date.now()}`);
      return module.default || module;
    } catch (e) {
      throw new Error(`Cannot load tick script: ${normalizedPath} - ${e.message}`);
    }
  }

  async callMcp(server, tool, params, timeoutMs = 120000) {
    logger.info(`[AppClock] callMcp: ${server}.${tool}`);
    logger.debug(`[AppClock] callMcp params keys: ${Object.keys(params || {}).join(', ')}`);
    
    if (!this.residentSkillManager) {
      throw new Error(`MCP service "${server}" not available: residentSkillManager not configured`);
    }
    
    const adminToken = await this.generateUserToken();
    
    const invokeParams = {
      action: 'call_tool',
      server_name: server,
      tool_name: tool,
      arguments: params
    };
    
    logger.info(`[AppClock] callMcp invoking mcp-client with action=call_tool, server=${server}, tool=${tool}`);
    
    try {
      const result = await this.residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        invokeParams,
        {
          accessToken: adminToken,
          isAdmin: true
        },
        timeoutMs
      );
      
      logger.info(`[AppClock] callMcp result type: ${typeof result}`);
      logger.debug(`[AppClock] callMcp result preview: ${JSON.stringify(result).substring(0, 500)}`);
      return result;
    } catch (e) {
      logger.error(`[AppClock] callMcp failed: ${server}.${tool} - ${e.message}`);
      logger.error(`[AppClock] callMcp error stack: ${e.stack}`);
      throw e;
    }
  }

  async generateUserToken() {
    const User = this.db.getModel('user');
    const UserRole = this.db.getModel('user_role');
    const Role = this.db.getModel('role');
    
    const adminRole = await Role.findOne({
      where: { mark: 'admin' },
      raw: true
    });
    
    if (!adminRole) {
      throw new Error('Admin role not found');
    }
    
    const adminUserRole = await UserRole.findOne({
      where: { role_id: adminRole.id },
      raw: true
    });
    
    if (!adminUserRole) {
      throw new Error('No admin user found');
    }
    
    const adminUser = await User.findOne({
      where: { id: adminUserRole.user_id, status: 'active' },
      raw: true
    });
    
    if (!adminUser) {
      throw new Error('Admin user not found or inactive');
    }
    
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const token = jwt.sign(
      {
        id: adminUser.id,
        userId: adminUser.id,
        role: 'admin',
        roles: ['admin'],
        isAdmin: true,
      },
      jwtSecret,
      { expiresIn: '1h' }
    );
    
    return token;
  }

  async callSkill(name, method, params) {
    logger.info(`[AppClock] callSkill: ${name}.${method}`);
    
    if (this.skillLoader) {
      const result = await this.skillLoader.executeSkillTool(
        name,
        method,
        params,
        { isAdmin: true }
      );
      return result;
    }
    
    throw new Error(`Skill "${name}" not available: skillLoader not configured`);
  }
}

export default AppClock;
