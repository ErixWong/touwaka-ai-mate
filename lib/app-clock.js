import logger from './logger.js';
import Utils from './utils.js';
import { Sequelize } from 'sequelize';
import path from 'path';
import jwt from 'jsonwebtoken';
import ExtensionTableService from '../server/services/extension-table.service.js';

class AppClock {
  constructor(db, config = {}) {
    this.db = db;
    this.sequelize = db.sequelize;
    this.intervalMs = config.intervalMs || 5000;
    this.residentSkillManager = config.residentSkillManager || null;
    this.llmService = config.llmService || null;
    this.skillLoader = config.skillLoader || null;
    this.extensionService = new ExtensionTableService(db);
    this.running = false;
    this.timer = null;
    this.lastWakeIndex = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    logger.info(`[AppClock] Started (interval=${this.intervalMs}ms, callback mode)`);
    
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
    
    logger.info(`[AppClock] Waking app: ${entry.app_id}`);
    await this.invokeTick(entry);
  }

  async invokeTick(entry) {
    const startTime = Date.now();
    const AppTickLog = this.db.getModel('app_tick_log');
    const MiniApp = this.db.getModel('mini_app');
    
    try {
      const app = await MiniApp.findByPk(entry.app_id);
      
      const scriptModule = await this.loadTickScript(entry, app);
      const context = this.buildContext(app, entry);
      
      const result = await scriptModule.tick(context);
      const duration = Date.now() - startTime;
      
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
      
      await AppTickLog.create({
        id: Utils.newID(20),
        registry_id: entry.id,
        app_id: entry.app_id,
        success: false,
        error_message: err.message,
        duration
      });
      
      logger.error(`[AppClock] App ${entry.app_id} tick failed: ${err.message} (${duration}ms)`);
    }
  }

  buildContext(app, entry) {
    return {
      db: this.db,
      sequelize: this.sequelize,
      app: app ? app.toJSON() : null,
      registry: entry.toJSON(),
      
      services: {
        callMcp: async (server, tool, params) => {
          return await this.callMcp(server, tool, params);
        },
        
        callLlm: async (promptType, params) => {
          return await this.callLlm(promptType, params);
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
        }
      }
    };
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
      const module = await import(`file://${normalizedPath.replace(/\\/g, '/')}/index.js`);
      return module.default || module;
    } catch (e) {
      throw new Error(`Cannot load tick script: ${normalizedPath} - ${e.message}`);
    }
  }

  async callMcp(server, tool, params) {
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
        120000
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
      { userId: adminUser.id, role: 'admin', isAdmin: true },
      jwtSecret,
      { expiresIn: '1h' }
    );
    
    return token;
  }

  async callLlm(promptType, params) {
    logger.info(`[AppClock] callLlm: ${promptType}`);
    
    if (this.llmService) {
      const systemPrompt = `You are a data extraction assistant. Task: ${promptType}`;
      
      let userPrompt;
      if (typeof params === 'string') {
        userPrompt = params;
      } else if (params.instruction && params.ocr_text) {
        userPrompt = `${params.instruction}\n\n原文：\n${params.ocr_text}`;
      } else {
        userPrompt = JSON.stringify(params);
      }
      
      const temperature = params.temperature ?? 0.3;
      const modelId = params.model_id;

      if (promptType.includes('filter') || promptType.includes('section')) {
        logger.info(`[AppClock] callLlm userPrompt length=${userPrompt.length}, has_ocr_text=${userPrompt.includes('ocr_text')}, preview=${userPrompt.substring(0, 300)}`);
      }

      if (params.schema || params.response_format === 'json') {
        const result = await this.llmService.judge(systemPrompt, userPrompt, {
          temperature,
          schema: params.schema,
          modelId,
          enableThinking: params.enable_thinking,
          thinkingBudget: params.thinking_budget,
        });
        return { text: JSON.stringify(result), parsed: result };
      }
      
      const result = await this.llmService.generate(systemPrompt, userPrompt, {
        temperature,
        modelId,
        enableThinking: params.enable_thinking,
        thinkingBudget: params.thinking_budget,
      });
      return { text: result };
    }
    
    throw new Error('LLM service not available: llmService not configured');
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