import logger from './logger.js';
import Utils from './utils.js';
import { Sequelize, Op } from 'sequelize';
import path from 'path';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import ExtensionTableService from '../server/services/extension-table.service.js';

class AppClock {
  constructor(db, config = {}) {
    this.db = db;
    this.intervalMs = config.intervalMs || 10000;
    this.batchSize = config.batchSize || 10;
    this.globalConcurrency = config.globalConcurrency || 5;
    this.residentSkillManager = config.residentSkillManager || null;
    this.llmService = config.llmService || null;
    this.skillLoader = config.skillLoader || null;
    this.extensionService = new ExtensionTableService(db);
    this.running = false;
    this.timer = null;
    this.activeCount = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    logger.info(`[AppClock] Started (interval=${this.intervalMs}ms, batch=${this.batchSize}, concurrency=${this.globalConcurrency})`);

    this.timer = setInterval(() => {
      this.tick().catch(err => {
        logger.error('[AppClock] Tick error:', err.message);
      });
    }, this.intervalMs);

    setImmediate(() => this.tick());
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[AppClock] Stopped');
  }

  async triggerImmediate() {
    logger.info('[AppClock] Immediate trigger requested');
    await this.tick();
  }

  async tick() {
    if (this.activeCount >= this.globalConcurrency) {
      logger.info('[AppClock] Skipped tick: global concurrency reached');
      return;
    }

    try {
      const AppState = this.db.getModel('app_state');
      const MiniAppRow = this.db.getModel('mini_app_row');

      if (!AppState || !MiniAppRow) {
        logger.warn('[AppClock] Models not available');
        return;
      }

      const activeStates = await AppState.findAll({
        where: {
          handler_id: { [Op.ne]: null },
        },
      });

      logger.info(`[AppClock] Tick: found ${activeStates.length} active states`);

      for (const state of activeStates) {
        if (this.activeCount >= this.globalConcurrency) break;

        const records = await MiniAppRow.findAll({
          where: {
            app_id: state.app_id,
            status: state.name,
          },
          limit: Math.min(this.batchSize, this.globalConcurrency - this.activeCount),
        });

        logger.info(`[AppClock] State ${state.name}: found ${records.length} records`);

        for (const record of records) {
          if (this.activeCount >= this.globalConcurrency) break;

          const processingStatus = `processing_${state.name}`;

          const claimed = await this.claimRecord(record, state.name, processingStatus);
          if (!claimed) continue;

          this.activeCount++;
          logger.info(`[AppClock] Processing record ${record.id} (state=${state.name})`);
          this.processRecord(state, record).finally(() => {
            this.activeCount--;
          });
        }
      }
    } catch (error) {
      logger.error('[AppClock] Tick error:', error.message);
    }
  }

  async processRecord(state, record) {
    const startTime = Date.now();
    const AppRowHandler = this.db.getModel('app_row_handler');
    const AppActionLog = this.db.getModel('app_action_log');
    const MiniAppRow = this.db.getModel('mini_app_row');
    const MiniAppFile = this.db.getModel('mini_app_file');
    const MiniApp = this.db.getModel('mini_app');
    const Attachment = this.db.getModel('attachment');

    let handler = null;

    try {
      handler = await AppRowHandler.findByPk(state.handler_id);
      if (!handler || !handler.is_active) {
        throw new Error(`Handler ${state.handler_id} not found or inactive`);
      }

      const app = await MiniApp.findByPk(state.app_id);
      const fileQuery = {
        where: { record_id: record.id },
      };
      if (Attachment) {
        fileQuery.include = [{
          model: Attachment,
          as: 'attachment',
        }];
      }
      const files = await MiniAppFile.findAll(fileQuery);

      const filesWithAttachment = files.map(f => f.toJSON());

const scriptModule = await this.loadScript(handler.handler);
      
      const recordData = typeof record.data === 'string' ? JSON.parse(record.data) : (record.data || {});
      
      const context = {
        record: { ...record.toJSON(), data: recordData },
        app: app ? app.toJSON() : null,
        files: filesWithAttachment,
        stateName: state.name,
        services: {
          callMcp: async (serviceName, method, params) => {
            return await this.callMcp(serviceName, method, params);
          },
          callLlm: async (promptType, params) => {
            return await this.callLlm(promptType, params);
          },
          callSkill: async (skillName, method, params) => {
            return await this.callSkill(skillName, method, params);
          },
          callExtension: async (tableName, action, data) => {
            return await this.extensionService.handle(app.id, tableName, action, data);
          },
        },
      };

      const processFn = scriptModule[handler.handler_function || 'process'];
      if (typeof processFn !== 'function') {
        throw new Error(`Handler function "${handler.handler_function || 'process'}" not found in ${handler.handler}`);
      }

      const result = await processFn(context);

      const duration = Date.now() - startTime;

      if (result && result.pending) {
        logger.info(`[AppClock] Record ${record.id} pending in ${state.name} (${duration}ms)`);
        return;
      }

      if (result && result.success) {
        const existingData = typeof record.data === 'string' ? JSON.parse(record.data) : (record.data || {});
        const newData = { ...existingData, ...result.data };
        
        const updateData = {
          data: JSON.stringify(newData),
          title: result.data ? this.extractTitle(app, result.data) || record.title : record.title,
          ai_extracted: true,
          status: state.success_next_state || record.status,
        };

        await MiniAppRow.update(updateData, {
          where: { id: record.id },
          individualHooks: false,
        });

        await AppActionLog.create({
          id: Utils.newID(20),
          handler_id: handler.id,
          record_id: record.id,
          app_id: state.app_id,
          trigger_status: state.name,
          result_status: state.success_next_state,
          success: true,
          output_data: result.data ? JSON.stringify(result.data) : null,
          duration,
        });

        logger.info(`[AppClock] Processed record ${record.id}: ${state.name} → ${state.success_next_state} (${duration}ms)`);
      } else {
        throw new Error((result && result.error) || 'Unknown error');
      }
    } catch (err) {
      const duration = Date.now() - startTime;

      // 失败时更新实体字段 status
      const failureStatus = state.failure_next_state || state.name;
      await MiniAppRow.update(
        { status: failureStatus },
        {
          where: { id: record.id },
          individualHooks: false,
        }
      );

      await AppActionLog.create({
        id: Utils.newID(20),
        handler_id: handler ? handler.id : state.handler_id,
        record_id: record.id,
        app_id: state.app_id,
        trigger_status: state.name,
        result_status: failureStatus,
        success: false,
        error_message: err.message,
        duration,
      });

      logger.error(`[AppClock] Failed record ${record.id}: ${state.name} → ${failureStatus}: ${err.message} (${duration}ms)`);
    }
  }

  async claimRecord(record, originalStatus, processingStatus) {
    const MiniAppRow = this.db.getModel('mini_app_row');

    // 直接更新实体字段 status（不再修改 data）
    const [affectedCount] = await MiniAppRow.update(
      { status: processingStatus },
      {
        where: {
          id: record.id,
          status: originalStatus, // 乐观锁：只有状态未变的才能 claim
        },
        individualHooks: false,
      }
    );

    if (affectedCount === 0) {
      logger.info(`[AppClock] Record ${record.id} already claimed by another process`);
      return false;
    }
    logger.info(`[AppClock] Record ${record.id} claimed (${originalStatus} → ${processingStatus})`);
    return true;
  }

  async loadScript(handlerPath) {
    const fullPath = path.resolve(handlerPath);

    const allowedPrefixes = [
      path.resolve('scripts'),
      path.resolve('apps'),
    ];
    const isAllowed = allowedPrefixes.some(prefix => fullPath.startsWith(prefix));
    if (!isAllowed) {
      throw new Error(`Script path not allowed: ${handlerPath}. Must be under scripts/ or data/skills/`);
    }

    const require = createRequire(import.meta.url);

    try {
      const module = await import(`file://${fullPath.replace(/\\/g, '/')}/index.js`);
      return module.default || module;
    } catch (e) {
      try {
        return require(fullPath);
      } catch (e2) {
        throw new Error(`Cannot load script: ${fullPath} - ${e2.message}`);
      }
    }
  }

  extractTitle(app, data) {
    if (!app || !app.fields) return '';
    
    let fields = app.fields;
    if (typeof fields === 'string') {
      try { fields = JSON.parse(fields); } catch { return ''; }
    }
    if (!Array.isArray(fields)) return '';
    
    const titleField = fields.find(f => f.type === 'text' && f.required && f.ai_extractable);
    if (titleField && data[titleField.name]) {
      return String(data[titleField.name]);
    }
    return '';
  }

async callMcp(serviceName, method, params) {
    logger.info(`[AppClock] callMcp: ${serviceName}.${method}`);

    if (this.residentSkillManager) {
      // 查询记录创建者的信息生成真实 token
      const adminToken = await this.generateUserToken();
      
      const result = await this.residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        {
          action: 'call_tool',
          server_name: serviceName,
          tool_name: method,
          arguments: params,
        },
        {
          accessToken: adminToken,
          isAdmin: true,
        },
        120000
      );
      return result;
    }

    throw new Error(`MCP service "${serviceName}" not available: residentSkillManager not configured`);
  }

  async generateUserToken() {
    // 查询一个真实的管理员用户生成 token
    const User = this.db.getModel('user');
    const UserRole = this.db.getModel('user_role');
    const Role = this.db.getModel('role');
    
    // 查询管理员用户
    const adminRole = await Role.findOne({
      where: { mark: 'admin' },
      raw: true,
    });
    
    if (!adminRole) {
      throw new Error('Admin role not found');
    }
    
    const adminUserRole = await UserRole.findOne({
      where: { role_id: adminRole.id },
      raw: true,
    });
    
    if (!adminUserRole) {
      throw new Error('No admin user found');
    }
    
    const adminUser = await User.findOne({
      where: { id: adminUserRole.user_id, status: 'active' },
      raw: true,
    });
    
    if (!adminUser) {
      throw new Error('Admin user not found or inactive');
    }
    
    // 生成真实用户 JWT token
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const token = jwt.sign(
      { userId: adminUser.id, role: 'admin', isAdmin: true },
      jwtSecret,
      { expiresIn: '1h' }
    );
    
    logger.info(`[AppClock] Generated token for admin user: ${adminUser.id}`);
    return token;
  }

  async callLlm(promptType, params) {
    logger.info(`[AppClock] callLlm: ${promptType}`);

    if (this.llmService) {
      const systemPrompt = `You are a data extraction assistant. Task: ${promptType}`;
      const userPrompt = typeof params === 'string' ? params : JSON.stringify(params);
      const temperature = params.temperature ?? 0.3;
      const modelId = params.model_id;

      if (params.schema || params.response_format === 'json') {
        const result = await this.llmService.judge(systemPrompt, userPrompt, {
          temperature,
          schema: params.schema,
          modelId,
        });
        return { text: JSON.stringify(result), parsed: result };
      }

      const result = await this.llmService.generate(systemPrompt, userPrompt, {
        temperature,
        modelId,
      });
      return { text: result };
    }

    throw new Error('LLM service not available: llmService not configured');
  }

  async callSkill(skillName, method, params) {
    logger.info(`[AppClock] callSkill: ${skillName}.${method}`);

    if (this.skillLoader) {
      const result = await this.skillLoader.executeSkillTool(
        skillName,
        method,
        params,
        { isAdmin: true }
      );
      return result;
    }

    throw new Error(`Skill "${skillName}" not available: skillLoader not configured`);
  }
}

export default AppClock;
