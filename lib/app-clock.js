import logger from './logger.js';
import Utils from './utils.js';
import { Sequelize, Op } from 'sequelize';
import path from 'path';
import { createRequire } from 'module';

class AppClock {
  constructor(db, config = {}) {
    this.db = db;
    this.intervalMs = config.intervalMs || 10000;
    this.batchSize = config.batchSize || 10;
    this.globalConcurrency = config.globalConcurrency || 5;
    this.residentSkillManager = config.residentSkillManager || null;
    this.llmService = config.llmService || null;
    this.skillLoader = config.skillLoader || null;
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
      logger.debug('[AppClock] Skipped tick: global concurrency reached');
      return;
    }

    try {
      const AppState = this.db.getModel('app_state');
      const MiniAppRow = this.db.getModel('mini_app_row');

      if (!AppState || !MiniAppRow) return;

      const activeStates = await AppState.findAll({
        where: {
          handler_id: { [Op.ne]: null },
        },
      });

      for (const state of activeStates) {
        if (this.activeCount >= this.globalConcurrency) break;

        const records = await MiniAppRow.findAll({
          where: {
            app_id: state.app_id,
            _status: state.name,
          },
          limit: Math.min(this.batchSize, this.globalConcurrency - this.activeCount),
        });

        for (const record of records) {
          if (this.activeCount >= this.globalConcurrency) break;

          const processingStatus = `processing_${state.name}`;

          const claimed = await this.claimRecord(record, state.name, processingStatus);
          if (!claimed) continue;

          this.activeCount++;
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

      const context = {
        record: record.toJSON(),
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
        },
      };

      const processFn = scriptModule[handler.handler_function || 'process'];
      if (typeof processFn !== 'function') {
        throw new Error(`Handler function "${handler.handler_function || 'process'}" not found in ${handler.handler}`);
      }

      const result = await processFn(context);

      const duration = Date.now() - startTime;

      if (result && result.success) {
        const newData = { ...record.data, ...result.data };
        if (state.success_next_state) {
          newData._status = state.success_next_state;
        }

        await record.update({
          data: newData,
          title: result.data ? this.extractTitle(app, result.data) || record.title : record.title,
          ai_extracted: true,
        });

        await AppActionLog.create({
          id: Utils.newID(20),
          handler_id: handler.id,
          record_id: record.id,
          app_id: state.app_id,
          trigger_status: state.name,
          result_status: state.success_next_state,
          success: true,
          output_data: result.data || null,
          duration,
        });

        logger.info(`[AppClock] Processed record ${record.id}: ${state.name} → ${state.success_next_state} (${duration}ms)`);
      } else {
        throw new Error((result && result.error) || 'Unknown error');
      }
    } catch (err) {
      const duration = Date.now() - startTime;

      const failureData = { ...record.data };
      if (state.failure_next_state) {
        failureData._status = state.failure_next_state;
      } else {
        failureData._status = state.name;
      }

      await record.update({ data: failureData });

      await AppActionLog.create({
        id: Utils.newID(20),
        handler_id: handler ? handler.id : state.handler_id,
        record_id: record.id,
        app_id: state.app_id,
        trigger_status: state.name,
        result_status: state.failure_next_state || state.name,
        success: false,
        error_message: err.message,
        duration,
      });

      logger.error(`[AppClock] Failed record ${record.id}: ${state.name} → ${state.failure_next_state || state.name}: ${err.message} (${duration}ms)`);
    }
  }

  async claimRecord(record, originalStatus, processingStatus) {
    const MiniAppRow = this.db.getModel('mini_app_row');
    const currentData = record.data || {};
    currentData._status = processingStatus;

    const [affectedCount] = await MiniAppRow.update(
      { data: currentData },
      {
        where: {
          id: record.id,
        },
        individualHooks: false,
      }
    );

    if (affectedCount === 0) {
      logger.debug(`[AppClock] Record ${record.id} already claimed by another process`);
      return false;
    }
    return true;
  }

  async loadScript(handlerPath) {
    const fullPath = path.resolve(handlerPath);

    const allowedPrefixes = [
      path.resolve('scripts'),
      path.resolve('data/skills'),
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
    const titleField = app.fields.find(f => f.type === 'text' && f.required && f.ai_extractable);
    if (titleField && data[titleField.name]) {
      return String(data[titleField.name]);
    }
    return '';
  }

  async callMcp(serviceName, method, params) {
    logger.info(`[AppClock] callMcp: ${serviceName}.${method}`);

    if (this.residentSkillManager) {
      const result = await this.residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        {
          action: 'call_tool',
          serverName: serviceName,
          toolName: method,
          arguments: params,
        },
        {},
        120000
      );
      return result;
    }

    throw new Error(`MCP service "${serviceName}" not available: residentSkillManager not configured`);
  }

  async callLlm(promptType, params) {
    logger.info(`[AppClock] callLlm: ${promptType}`);

    if (this.llmService) {
      const systemPrompt = `You are a data extraction assistant. Task: ${promptType}`;
      const userPrompt = typeof params === 'string' ? params : JSON.stringify(params);
      const temperature = params.temperature ?? 0.3;

      if (params.schema || params.response_format === 'json') {
        const result = await this.llmService.judge(systemPrompt, userPrompt, {
          temperature,
          schema: params.schema,
        });
        return { text: JSON.stringify(result), parsed: result };
      }

      const result = await this.llmService.generate(systemPrompt, userPrompt, {
        temperature,
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
