import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op, Sequelize } from 'sequelize';
import { pathToFileURL } from 'url';
import {
  buildPaginatedResponse,
} from '../../lib/query-builder.js';
import ExtensionTableService from './extension-table.service.js';
import InternalLLMService from '../../lib/internal-llm-service.js';

class MiniAppService {
  constructor(db) {
    this.db = db;
    this.models = {};
    this.extensionService = new ExtensionTableService(db);
    this.llmService = new InternalLLMService(db);
  }

  ensureModels() {
    if (!this.models.MiniApp) {
      this.models.MiniApp = this.db.getModel('mini_app');
      this.models.MiniAppRow = this.db.getModel('mini_app_row');
      this.models.MiniAppFile = this.db.getModel('mini_app_file');
      this.models.AppRowHandler = this.db.getModel('app_row_handler');
      this.models.AppState = this.db.getModel('app_state');
      this.models.AppActionLog = this.db.getModel('app_action_log');
      this.models.MiniAppRoleAccess = this.db.getModel('mini_app_role_access');
      this.models.User = this.db.getModel('user');
      this.models.Role = this.db.getModel('role');
      this.models.UserRole = this.db.getModel('user_role');
      this.models.Attachment = this.db.getModel('attachment');
      this.models.AiModel = this.db.getModel('ai_model');
    }
    this.extensionService.ensureModels();
  }

  // ==================== App CRUD ====================

  async getAccessibleApps(userId) {
    this.ensureModels();

    const user = await this.models.User.findByPk(userId);
    if (!user) return [];

    const isAdmin = await this.isAdmin(userId);

    if (isAdmin) {
      return await this.models.MiniApp.findAll({
        where: { is_active: true },
        order: [['sort_order', 'ASC'], ['created_at', 'DESC']],
      });
    }

    const apps = await this.models.MiniApp.findAll({
      where: { is_active: true },
      order: [['sort_order', 'ASC'], ['created_at', 'DESC']],
    });

    const result = [];
    for (const app of apps) {
      if (app.visibility === 'all') {
        result.push(app);
      } else if (app.visibility === 'owner') {
        if (app.owner_id === userId) {
          result.push(app);
        }
      } else if (app.visibility === 'department') {
        if (user && app.owner_id) {
          const appOwner = await this.models.User.findByPk(app.owner_id);
          if (appOwner && user.department_id && appOwner.department_id &&
              user.department_id === appOwner.department_id) {
            result.push(app);
          }
        }
      } else if (app.visibility === 'role') {
        const hasAccess = await this.models.MiniAppRoleAccess.findOne({
          where: { app_id: app.id },
          include: [{
            model: this.models.UserRole,
            where: { user_id: userId },
            required: true,
          }],
        });
        if (hasAccess) result.push(app);
      }
    }
    return result;
  }

  async getAppById(appId) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) return null;

    const states = await this.models.AppState.findAll({
      where: { app_id: appId },
      order: [['sort_order', 'ASC']],
    });

    const appJson = app.toJSON();
    appJson.states = states;
    return appJson;
  }

  async createApp(data) {
    this.ensureModels();
    const app = await this.models.MiniApp.create({
      id: Utils.newID(20),
      ...data,
    });
    return app;
  }

  async updateApp(appId, data) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');

    await app.update(data);
    if (data.fields) {
      await app.update({ revision: app.revision + 1 });
    }
    return app;
  }

  async getAppConfig(appId) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');

    let config = app.config;
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch { config = {}; }
    }

    // 合并 manifest 的 step_resources 默认值
    let manifest = app.fields;
    if (typeof manifest === 'string') {
      try { manifest = JSON.parse(manifest); } catch { manifest = {}; }
    }
    
    // 从 app 的 manifest 字段获取 step_resources（如果存在）
    // 注意：manifest 数据分布在 app 的各个字段中，这里需要从 manifest.json 文件读取
    const defaultStepResources = this.getDefaultStepResources(appId);
    
    if (defaultStepResources && config) {
      config.step_resources = { ...defaultStepResources, ...config.step_resources };
    } else if (defaultStepResources) {
      config = { ...config, step_resources: defaultStepResources };
    }
    
    return config || {};
  }

  getDefaultStepResources(appId) {
    // 从 manifest 文件读取默认 step_resources
    try {
      const fs = require('fs');
      const path = require('path');
      const manifestPath = path.join(process.cwd(), 'apps', appId, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifestContent = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        return manifest.config?.step_resources || null;
      }
    } catch (e) {
      // 文件不存在或解析失败，返回 null
    }
    return null;
  }

  async updateAppConfig(appId, configData) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');

    let currentConfig = app.config;
    if (typeof currentConfig === 'string') {
      try { currentConfig = JSON.parse(currentConfig); } catch { currentConfig = {}; }
    }

    const mergedConfig = { ...currentConfig, ...configData };
    await app.update({ config: JSON.stringify(mergedConfig) });
    return mergedConfig;
  }

  async getAvailableResources(appId) {
    this.ensureModels();
    const MCPServer = this.db.getModel('mcp_server');
    const MCPToolsCache = this.db.getModel('mcp_tools_cache');
    const AppRowHandler = this.db.getModel('app_row_handler');
    const AiModel = this.db.getModel('ai_model');
    const Provider = this.db.getModel('provider');

    const servers = await MCPServer.findAll({
      where: { is_enabled: true },
      raw: true,
    });

    const result = [];
    for (const server of servers) {
      const tools = await MCPToolsCache.findAll({
        where: { mcp_server_id: server.id },
        raw: true,
      });
      result.push({
        id: server.id,
        name: server.name,
        display_name: server.display_name,
        transport_type: server.transport_type,
        tools: tools.map(t => {
          let inputSchema = null;
          if (t.input_schema) {
            try { inputSchema = JSON.parse(t.input_schema); } catch { inputSchema = null; }
          }
          return {
            name: t.tool_name,
            description: t.description,
            input_schema: inputSchema,
          };
        }),
      });
    }

    const models = await AiModel.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'model_name', 'provider_id', 'model_type'],
      include: [{
        model: Provider,
        as: 'provider',
        attributes: [['id', 'provider_id'], ['name', 'provider_name']],
      }],
      order: [['name', 'ASC']],
      raw: true,
      nest: true,
    });

    let handlerOutputs = {};
    if (appId) {
      const app = await this.models.MiniApp.findByPk(appId);
      if (app) {
        const AppState = this.db.getModel('app_state');
        const states = await AppState.findAll({
          where: { app_id: appId },
          raw: true,
        });

        const handlerIds = states.filter(s => s.handler_id).map(s => s.handler_id);
        const uniqueHandlerIds = [...new Set(handlerIds)];

        for (const hid of uniqueHandlerIds) {
          const handler = await AppRowHandler.findByPk(hid);
          if (!handler) {
            logger.warn(`[getAvailableResources] Handler ${hid} not found`);
            continue;
          }

          try {
            const scriptModule = await this.loadHandlerScript(handler.handler);
            const outputs = scriptModule.availableOutputs || [];
            logger.info(`[getAvailableResources] Handler ${hid} loaded, outputs: ${outputs.length}`);
            handlerOutputs[hid] = outputs;
          } catch (e) {
            logger.error(`[getAvailableResources] Handler ${hid} load failed: ${e.message}`);
            handlerOutputs[hid] = [];
          }
        }
      }
    }

    return {
      mcp_servers: result,
      internal_llm: {
        available: true,
        models: models.map(m => ({
          id: m.id,
          name: m.name,
          model_name: m.model_name,
          provider_name: m.provider?.provider_name || '',
        })),
      },
      handler_outputs: handlerOutputs,
    };
  }

  async loadHandlerScript(handlerPath) {
    const fs = await import('fs');
    const path = await import('path');
    const allowedPrefixes = ['scripts/', 'data/skills/'];
    const absPath = path.resolve(handlerPath);
    const isAllowed = allowedPrefixes.some(p => absPath.includes(p.replace('/', path.sep)));
    if (!isAllowed) {
      throw new Error(`Handler path not allowed: ${handlerPath}`);
    }

    const indexPath = path.join(absPath, 'index.js');
    if (!fs.default.existsSync(indexPath)) {
      throw new Error(`Handler script not found: ${indexPath}`);
    }

    return await import(`${pathToFileURL(indexPath).href}?t=${Date.now()}`);
  }

  async deleteApp(appId) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');
    await app.destroy();
    return true;
  }

  // ==================== Record CRUD ====================

  async getRecords(appId, userId, queryParams) {
    this.ensureModels();
    
    const extRecords = await this.extensionService.getRecordsWithExtension(appId, userId, queryParams);
    if (extRecords) {
      const pagination = { 
        page: queryParams?.page || 1, 
        size: queryParams?.size || 10,
        total: extRecords.count,
        pages: Math.ceil(extRecords.count / (queryParams?.size || 10))
      };
      return buildPaginatedResponse({ rows: extRecords.rows, count: extRecords.count }, pagination, Date.now());
    }

    const { page = 1, size = 10, filter, sort } = queryParams || {};
    const limit = Math.min(Math.max(parseInt(size) || 10, 1), 100);
    const offset = (parseInt(page) - 1) * limit;

    const isAdmin = await this.isAdmin(userId);
    const where = { app_id: appId };
    if (!isAdmin) {
      where.user_id = userId;
    }

    if (filter) {
      try {
        const filterObj = typeof filter === 'string' ? JSON.parse(filter) : filter;
        for (const [key, value] of Object.entries(filterObj)) {
          if (key === 'status') {
            where.status = value;
          }
        }
      } catch (e) {
        // ignore invalid filter
      }
    }

    const { count, rows } = await this.models.MiniAppRow.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']],
    });

    const pagination = { page: parseInt(page), size: limit };
    return buildPaginatedResponse({ rows, count }, pagination, Date.now());
  }

  async getRecord(appId, recordId, userId) {
    this.ensureModels();
    
    const extRecord = await this.extensionService.getRecordWithExtension(appId, recordId);
    if (extRecord) {
      const isAdmin = await this.isAdmin(userId);
      if (!isAdmin && extRecord.user_id !== userId) {
        throw new Error('Permission denied');
      }
      return extRecord;
    }
    
    const isAdmin = await this.isAdmin(userId);
    const where = { id: recordId, app_id: appId };
    if (!isAdmin) {
      where.user_id = userId;
    }
    const record = await this.models.MiniAppRow.findOne({
      where,
      include: [{
        model: this.models.MiniAppFile,
        as: 'files',
        include: [{
          model: this.models.Attachment,
          as: 'attachment',
        }],
      }],
    });
    if (!record) throw new Error('Record not found');
    return record;
  }

  async createRecord(appId, userId, data, attachmentIds = [], clientRecordId = null) {
    this.ensureModels();
    logger.info(`[MiniAppService] createRecord start: appId=${appId}, userId=${userId}, clientRecordId=${clientRecordId}`);

    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');
    logger.info(`[MiniAppService] App found: ${app.id}`);

    this.validateData(app.fields, data);
    logger.info(`[MiniAppService] Data validated`);

    const initialState = await this.models.AppState.findOne({
      where: { app_id: appId, is_initial: true },
    });
    logger.info(`[MiniAppService] Initial state: ${initialState?.name || 'none'}`);

    // status 现在是实体字段，不放在 data 里
    const status = initialState?.name || 'pending_ocr';

    const title = this.computeTitle(app.fields, data);
    logger.info(`[MiniAppService] Title computed: ${title}`);

    const transaction = await this.db.sequelize.transaction();
    logger.info(`[MiniAppService] Transaction started`);
    
    try {
      // 使用前端提供的 ID 或生成新 ID
      const rowId = clientRecordId || Utils.newID(20);
      logger.info(`[MiniAppService] Creating row with id=${rowId}, data=${JSON.stringify(data).substring(0, 100)}`);
      
      // 序列化 data 为字符串（模型 getter/setter 会处理）
      const dataStr = typeof data === 'object' ? JSON.stringify(data) : data;
      
      const record = await this.models.MiniAppRow.create({
        id: rowId,
        app_id: appId,
        user_id: userId,
        data: dataStr,
        title,
        status: status,
      }, { transaction });
      logger.info(`[MiniAppService] Row created: ${record.id}`);

      const extConfigs = await this.extensionService.getExtensionConfigs(appId);
      logger.info(`[MiniAppService] Extension configs: ${extConfigs?.length || 0}`);
      
      if (extConfigs && extConfigs.length > 0) {
        const primaryConfig = extConfigs.find(c => c.type === 'primary');
        if (primaryConfig) {
          const extData = { row_id: rowId };
          for (const f of primaryConfig.fields) {
            const key = f.source || f.name;
            if (data[key] !== undefined) {
              extData[f.name] = data[key];
            }
          }
          logger.info(`[MiniAppService] Creating extension row: ${JSON.stringify(extData)}`);
          await this.extensionService.createExtensionRow(appId, primaryConfig.name, extData, transaction);
          logger.info(`[MiniAppService] Extension row created`);
        }
      }

      if (attachmentIds.length > 0) {
        logger.info(`[MiniAppService] Creating ${attachmentIds.length} file associations`);
        for (const attId of attachmentIds) {
          await this.models.MiniAppFile.create({
            id: Utils.newID(20),
            record_id: record.id,
            app_id: appId,
            attachment_id: attId,
          }, { transaction });
        }
        logger.info(`[MiniAppService] File associations created`);
      }

      await transaction.commit();
      logger.info(`[MiniAppService] Transaction committed, returning record`);
      return record;
    } catch (err) {
      logger.error(`[MiniAppService] Transaction error: ${err.message}`);
      await transaction.rollback();
      throw new Error(`创建失败: ${err.message}`);
    }
  }

  async updateRecord(appId, recordId, userId, data, options = {}) {
    this.ensureModels();
    const record = await this.models.MiniAppRow.findOne({
      where: { id: recordId, app_id: appId },
    });
    if (!record) throw new Error('Record not found');

    const isAdmin = await this.isAdmin(userId);
    if (!isAdmin && record.user_id !== userId) {
      throw new Error('Permission denied');
    }

    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');

    this.validateData(app.fields, data);

    const existingData = typeof record.data === 'string' ? JSON.parse(record.data) : (record.data || {});
    const mergedData = { ...existingData, ...data };
    const title = this.computeTitle(app.fields, mergedData);

    const transaction = await this.db.sequelize.transaction();
    
    try {
      const updateFields = {
        data: JSON.stringify(mergedData),
        title,
        revision: record.revision + 1,
      };
      
      if (options.status) {
        updateFields.status = options.status;
      }
      
      await record.update(updateFields, { transaction });

      const extConfigs = await this.extensionService.getExtensionConfigs(appId);
      if (extConfigs && extConfigs.length > 0) {
        const primaryConfig = extConfigs.find(c => c.type === 'primary');
        if (primaryConfig) {
          const extData = { row_id: recordId };
          for (const f of primaryConfig.fields) {
            const key = f.source || f.name;
            if (data[key] !== undefined) {
              extData[f.name] = data[key];
            }
          }
          await this.extensionService.updateExtensionRow(appId, primaryConfig.name, recordId, extData, transaction);
        }
      }

      await transaction.commit();
      return record;
    } catch (err) {
      await transaction.rollback();
      throw new Error(`更新失败: ${err.message}`);
    }
  }

  async deleteRecord(appId, recordId, userId) {
    this.ensureModels();
    const record = await this.models.MiniAppRow.findOne({
      where: { id: recordId, app_id: appId },
    });
    if (!record) throw new Error('Record not found');

    const isAdmin = await this.isAdmin(userId);
    if (!isAdmin && record.user_id !== userId) {
      throw new Error('Permission denied');
    }
    await record.destroy();
    return true;
  }

  async confirmRecord(appId, recordId, userId, data) {
    this.ensureModels();
    const record = await this.models.MiniAppRow.findOne({
      where: { id: recordId, app_id: appId },
    });
    if (!record) throw new Error('Record not found');

    const isAdmin = await this.isAdmin(userId);
    if (!isAdmin && record.user_id !== userId) {
      throw new Error('Permission denied');
    }

    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');

    const existingData = typeof record.data === 'string' ? JSON.parse(record.data) : (record.data || {});
    const mergedData = { ...existingData, ...data };

    const confirmedState = await this.models.AppState.findOne({
      where: { app_id: appId, is_terminal: true },
    });

    const title = this.computeTitle(app.fields, mergedData);

    await this.models.MiniAppRow.update(
      {
        data: JSON.stringify(mergedData),
        title,
        revision: record.revision + 1,
        status: confirmedState?.name || 'confirmed',
      },
      { where: { id: record.id } }
    );

    return await this.models.MiniAppRow.findByPk(record.id);
  }

  async batchUpload(appId, userId, attachmentIds) {
    this.ensureModels();

    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');
    if (!app.is_active) throw new Error('App is not active');

    const initialState = await this.models.AppState.findOne({
      where: { app_id: appId, is_initial: true },
    });
    const initialStatus = initialState ? initialState.name : 'pending';

    const records = [];
    for (const attId of attachmentIds) {
      const attachment = await this.models.Attachment.findByPk(attId);
      if (!attachment) continue;
      if (attachment.created_by && attachment.created_by !== userId) continue;

      const data = {};

      const record = await this.models.MiniAppRow.create({
        id: Utils.newID(20),
        app_id: appId,
        user_id: userId,
        data,
        title: attachment.file_name || 'Unknown',
        status: initialStatus,
      });

      await this.models.MiniAppFile.create({
        id: Utils.newID(20),
        record_id: record.id,
        app_id: appId,
        attachment_id: attId,
      });

      records.push(record);
    }

    return {
      upload_time: new Date().toISOString(),
      count: records.length,
      records,
    };
  }

  async getStatusSummary(appId, userId, createdAfter) {
    this.ensureModels();
    const isAdmin = await this.isAdmin(userId);

    const where = { app_id: appId };
    if (!isAdmin) {
      where.user_id = userId;
    }
    if (createdAfter) {
      where.created_at = { [Op.gte]: createdAfter };
    }

    const results = await this.db.sequelize.query(
      `SELECT status, COUNT(*) as count FROM mini_app_rows WHERE app_id = ? ${!isAdmin ? 'AND user_id = ?' : ''} ${createdAfter ? 'AND created_at >= ?' : ''} GROUP BY status`,
      {
        replacements: [
          appId,
          ...(!isAdmin ? [userId] : []),
          ...(createdAfter ? [createdAfter] : []),
        ],
        type: Sequelize.QueryTypes.SELECT,
      }
    );

    const byStatus = {};
    let total = 0;
    let completed = 0;
    let processing = 0;
    let failed = 0;

    for (const row of results) {
      const status = row.status || 'unknown';
      const count = row.count;
      byStatus[status] = count;
      total += count;

      if (status === 'confirmed' || status === 'pending_review') {
        completed += count;
      } else if (status && status.endsWith('_failed')) {
        failed += count;
      } else {
        processing += count;
      }
    }

    return { total, by_status: byStatus, completed, processing, failed };
  }

  // ==================== State CRUD ====================

  async getStates(appId) {
    this.ensureModels();
    return await this.models.AppState.findAll({
      where: { app_id: appId },
      order: [['sort_order', 'ASC']],
    });
  }

  async createState(appId, data) {
    this.ensureModels();
    return await this.models.AppState.create({
      id: Utils.newID(20),
      app_id: appId,
      ...data,
    });
  }

  async updateState(appId, stateId, data) {
    this.ensureModels();
    const state = await this.models.AppState.findOne({
      where: { id: stateId, app_id: appId },
    });
    if (!state) throw new Error('State not found');
    await state.update(data);
    return state;
  }

  async deleteState(appId, stateId) {
    this.ensureModels();
    const state = await this.models.AppState.findOne({
      where: { id: stateId, app_id: appId },
    });
    if (!state) throw new Error('State not found');
    await state.destroy();
    return true;
  }

  // ==================== Handler CRUD ====================

  async getHandlers() {
    this.ensureModels();
    return await this.models.AppRowHandler.findAll({
      order: [['created_at', 'DESC']],
    });
  }

  async getHandlerById(handlerId) {
    this.ensureModels();
    return await this.models.AppRowHandler.findByPk(handlerId);
  }

  async createHandler(data) {
    this.ensureModels();
    return await this.models.AppRowHandler.create({
      id: Utils.newID(20),
      ...data,
    });
  }

  async updateHandler(handlerId, data) {
    this.ensureModels();
    const handler = await this.models.AppRowHandler.findByPk(handlerId);
    if (!handler) throw new Error('Handler not found');
    await handler.update(data);
    return handler;
  }

  async deleteHandler(handlerId) {
    this.ensureModels();
    const handler = await this.models.AppRowHandler.findByPk(handlerId);
    if (!handler) throw new Error('Handler not found');
    await handler.destroy();
    return true;
  }

  async getHandlerLogs(handlerId, limit = 20) {
    this.ensureModels();
    return await this.models.AppActionLog.findAll({
      where: { handler_id: handlerId },
      order: [['created_at', 'DESC']],
      limit,
    });
  }

  // ==================== Compare ====================

  async getCompareResult(appId, rowId) {
    const [rows] = await this.db.sequelize.query(`
      SELECT target_row_id, compare_result, summary_identical, summary_modified,
             summary_added, summary_removed, model_name, duration_ms, updated_at
      FROM app_contract_mgr_compares
      WHERE row_id = ?
    `, { replacements: [rowId] });

    const result = rows[0];
    if (!result) return null;

    let compareResult = result.compare_result;
    if (typeof compareResult === 'string') {
      try {
        compareResult = JSON.parse(compareResult);
      } catch {
        compareResult = [];
      }
    }

    return {
      target_row_id: result.target_row_id,
      results: compareResult || [],
      summary: {
        total: (compareResult || []).length,
        identical: result.summary_identical || 0,
        modified: result.summary_modified || 0,
        added: result.summary_added || 0,
        removed: result.summary_removed || 0,
      },
      model_name: result.model_name,
      duration_ms: result.duration_ms,
      compared_at: result.updated_at,
    };
  }

  async compareRecords(appId, rowIdA, rowIdB, options = {}) {
    this.ensureModels();

    logger.info(`[compareRecords] Starting compare: ${rowIdA} vs ${rowIdB}`);

    const startTime = Date.now();

    const [contentA, contentB] = await Promise.all([
      this._loadRecordContent(appId, rowIdA),
      this._loadRecordContent(appId, rowIdB),
    ]);

    if (!contentA || !contentB) {
      throw new Error('One or both records have no content');
    }

    logger.info(`[compareRecords] Loaded content: A=${contentA.sections.length} sections, B=${contentB.sections.length} sections`);

    const appConfig = await this.getAppConfig(appId);
    const comparePrompt = appConfig?.prompts?.compare || this._defaultComparePrompt();

    const modelId = options.model_id || null;
    const temperature = options.temperature ?? 0.3;
    const concurrency = Math.max(1, Math.min(options.concurrency || 3, 10));

    logger.info(`[compareRecords] Model: ${modelId || 'default'}, Temperature: ${temperature}, Concurrency: ${concurrency}`);

    logger.info(`[compareRecords] Step 1: LLM section matching`);
    const matchedSections = await this._matchSectionsWithLlm(contentA.sections, contentB.sections, modelId, temperature);

    const matchedItems = matchedSections.filter(m => m.type === 'matched');
    const linesA = contentA.filtered_text.split('\n');
    const linesB = contentB.filtered_text.split('\n');

    const matchedResults = await this._runConcurrent(matchedItems, concurrency, async (match, index) => {
      const textA = linesA.slice(match.sectionA.start_line, match.sectionA.end_line).join('\n');
      const textB = linesB.slice(match.sectionB.start_line, match.sectionB.end_line).join('\n');

      let result;
      try {
        logger.info(`[compareRecords] Comparing section ${index + 1}/${matchedItems.length}: ${match.sectionA.title} (textA=${textA.length} chars, textB=${textB.length} chars)`);
        const sectionStart = Date.now();

        result = await this.llmService.judge(
          comparePrompt,
          JSON.stringify({
            section_title: match.sectionA.title,
            text_a: textA,
            text_b: textB,
          }),
          { modelId, temperature, defaultValue: { change_type: 'error', summary: 'LLM call failed' } }
        );

        logger.info(`[compareRecords] Section done: ${match.sectionA.title} -> ${result.change_type} (${Date.now() - sectionStart}ms)`);
      } catch (e) {
        logger.error(`[compareRecords] LLM failed for section ${match.sectionA.title}: ${e.message}`);
        result = { change_type: 'error', summary: e.message };
      }

      return {
        type: 'matched',
        section_id_a: match.sectionA.id,
        section_id_b: match.sectionB.id,
        title: match.sectionA.title,
        change_type: result.change_type || 'modified',
        summary: result.summary || '',
        key_changes: result.key_changes || [],
        risk_level: result.risk_level || 'low',
      };
    });

    const results = [...matchedResults];

    for (const match of matchedSections.filter(m => m.type === 'added')) {
      const textB = linesB.slice(match.section.start_line, match.section.end_line).join('\n');
      results.push({
        type: 'added',
        section_id: match.section.id,
        title: match.section.title,
        change_type: 'added',
        summary: 'Added in target contract',
        content_preview: textB.substring(0, 200),
      });
    }

    for (const match of matchedSections.filter(m => m.type === 'removed')) {
      const textA = linesA.slice(match.section.start_line, match.section.end_line).join('\n');
      results.push({
        type: 'removed',
        section_id: match.section.id,
        title: match.section.title,
        change_type: 'removed',
        summary: 'Removed from base contract',
        content_preview: textA.substring(0, 200),
      });
    }

    const summary = {
      total: results.length,
      identical: results.filter(r => r.change_type === 'identical').length,
      modified: results.filter(r => r.change_type === 'modified' || r.change_type === 'semantic_change').length,
      added: results.filter(r => r.change_type === 'added').length,
      removed: results.filter(r => r.change_type === 'removed').length,
    };

    const durationMs = Date.now() - startTime;

    logger.info(`[compareRecords] Complete: ${summary.total} sections, ${summary.identical} identical, ${summary.modified} modified, ${summary.added} added, ${summary.removed} removed (${durationMs}ms)`);

    if (options.save !== false) {
      try {
        let modelName = null;
        if (modelId) {
          const model = await this.models.AiModel.findByPk(modelId);
          modelName = model?.name || null;
        }

        await this.extensionService.upsertExtensionRow(
          appId,
          'app_contract_mgr_compares',
          rowIdA,
          {
            target_row_id: rowIdB,
            compare_result: JSON.stringify(results),
            summary_identical: summary.identical,
            summary_modified: summary.modified,
            summary_added: summary.added,
            summary_removed: summary.removed,
            model_name: modelName,
            duration_ms: durationMs,
          }
        );
        logger.info(`[compareRecords] Saved compare result for row_id ${rowIdA}`);
      } catch (e) {
        logger.error(`[compareRecords] Failed to save compare result: ${e.message}`);
      }
    }

    return { results, summary, duration_ms: durationMs };
  }

  async _loadRecordContent(appId, rowId) {
    const extConfigs = await this.extensionService.getExtensionConfigs(appId);
    const contentConfig = extConfigs?.find(c => c.type === 'content');

    if (!contentConfig) return null;

    const content = await this.extensionService.readExtensionRow(
      appId,
      contentConfig.name,
      rowId,
      ['filtered_text', 'sections']
    );

    if (!content || !content.filtered_text) return null;

    let sections = [];
    if (content.sections) {
      try {
        sections = typeof content.sections === 'string' ? JSON.parse(content.sections) : content.sections;
      } catch {
        sections = [];
      }
    }

    return { filtered_text: content.filtered_text, sections };
  }

  async _matchSectionsWithLlm(sectionsA, sectionsB, modelId, temperature) {
    const listA = sectionsA.map((s, i) => ({ id: s.id || `a-${i}`, title: s.title }));
    const listB = sectionsB.map((s, i) => ({ id: s.id || `b-${i}`, title: s.title }));

    const matchPrompt = `你是一个合同结构分析专家。给你两组合同的章节列表，请分析它们的对应关系。

合同A的章节列表：
${JSON.stringify(listA, null, 2)}

合同B的章节列表：
${JSON.stringify(listB, null, 2)}

请返回 JSON 格式：
{
  "matches": [
    { "a_id": "章节A的id", "b_id": "章节B的id", "confidence": 0.9, "reason": "匹配原因" }
  ],
  "added_in_b": ["b-id1", "b-id2"],
  "removed_in_a": ["a-id1", "a-id2"]
}

规则：
1. matches: 语义上对应的章节配对（a_id 和 b_id 各只能出现一次）
2. added_in_b: 合同B有但A没有的章节id列表
3. removed_in_a: 合同A有但B没有的章节id列表
4. 匹配基于章节标题的语义，而非字面文本（如"第一条 付款方式"和"Article 1 Payment Terms"应匹配）
5. confidence: 0-1 的匹配置信度
6. 所有章节必须被分配到 matches、added_in_b 或 removed_in_a 中`;

    let result;
    try {
      logger.info(`[matchSections] Calling LLM for section matching (A=${listA.length}, B=${listB.length})`);
      const startTime = Date.now();

      result = await this.llmService.judge(
        matchPrompt,
        JSON.stringify({}),
        { modelId, temperature: Math.min(temperature, 0.3), defaultValue: null }
      );

      logger.info(`[matchSections] LLM matching done (${Date.now() - startTime}ms)`);
    } catch (e) {
      logger.error(`[matchSections] LLM matching failed, fallback to algorithm: ${e.message}`);
      return this._matchSections(sectionsA, sectionsB);
    }

    let parsed;
    try {
      const jsonStr = typeof result === 'string' ? result : (result?.text || JSON.stringify(result));
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      logger.error(`[matchSections] Failed to parse LLM matching result: ${e.message}`);
      return this._matchSections(sectionsA, sectionsB);
    }

    if (!parsed || !Array.isArray(parsed.matches)) {
      logger.error(`[matchSections] Invalid LLM matching result structure`);
      return this._matchSections(sectionsA, sectionsB);
    }

    const matchedIdsA = new Set(parsed.matches.map(m => m.a_id));
    const matchedIdsB = new Set(parsed.matches.map(m => m.b_id));

    const matches = [];
    for (const m of parsed.matches) {
      const secA = sectionsA.find(s => (s.id || '') === m.a_id || `a-${sectionsA.indexOf(s)}` === m.a_id);
      const secB = sectionsB.find(s => (s.id || '') === m.b_id || `b-${sectionsB.indexOf(s)}` === m.b_id);
      if (secA && secB) {
        matches.push({ type: 'matched', sectionA: secA, sectionB: secB, confidence: m.confidence || 0.5 });
      }
    }

    for (const secA of sectionsA) {
      const aId = secA.id || `a-${sectionsA.indexOf(secA)}`;
      if (!matchedIdsA.has(aId)) {
        matches.push({ type: 'removed', section: secA });
      }
    }

    for (const secB of sectionsB) {
      const bId = secB.id || `b-${sectionsB.indexOf(secB)}`;
      if (!matchedIdsB.has(bId)) {
        matches.push({ type: 'added', section: secB });
      }
    }

    logger.info(`[matchSections] LLM result: ${matches.filter(m => m.type === 'matched').length} matched, ${matches.filter(m => m.type === 'added').length} added, ${matches.filter(m => m.type === 'removed').length} removed`);

    return matches;
  }

  _matchSections(sectionsA, sectionsB) {
    const matches = [];
    const usedA = new Set();
    const usedB = new Set();

    for (const secA of sectionsA) {
      let bestMatch = null;
      let bestScore = 0;

      for (const secB of sectionsB) {
        if (usedB.has(secB.id)) continue;
        const score = this._titleSimilarity(secA.title, secB.title);
        if (score > bestScore && score > 0.4) {
          bestScore = score;
          bestMatch = secB;
        }
      }

      if (bestMatch) {
        matches.push({ type: 'matched', sectionA: secA, sectionB: bestMatch, score: bestScore });
        usedA.add(secA.id);
        usedB.add(bestMatch.id);
      }
    }

    for (const secA of sectionsA) {
      if (!usedA.has(secA.id)) {
        matches.push({ type: 'removed', section: secA });
      }
    }

    for (const secB of sectionsB) {
      if (!usedB.has(secB.id)) {
        matches.push({ type: 'added', section: secB });
      }
    }

    return matches;
  }

  _titleSimilarity(a, b) {
    if (!a || !b) return 0;
    const sa = a.trim().toLowerCase();
    const sb = b.trim().toLowerCase();
    if (sa === sb) return 1;

    const numA = sa.match(/[\d]+/);
    const numB = sb.match(/[\d]+/);
    if (numA && numB && numA[0] === numB[0]) return 0.8;

    const keywordsA = sa.split(/[\s,，、第条第款项]/).filter(Boolean);
    const keywordsB = sb.split(/[\s,，、第条第款项]/).filter(Boolean);
    const common = keywordsA.filter(w => keywordsB.includes(w));
    if (keywordsA.length === 0 || keywordsB.length === 0) return 0;
    return common.length / Math.max(keywordsA.length, keywordsB.length);
  }

  async _runConcurrent(items, concurrency, handler) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        const idx = nextIndex++;
        results[idx] = await handler(items[idx], idx);
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }

  _defaultComparePrompt() {
    return `你是一个合同对比分析专家。请对比以下两个合同章节的文本，分析语义差异。

输入是一个 JSON 对象，包含：
- section_title: 章节标题
- text_a: 基准合同（A）的章节文本
- text_b: 对比合同（B）的章节文本

请严格返回 JSON 格式：
{
  "change_type": "identical | modified | semantic_change",
  "summary": "一句话概括差异，如果一致则写'两份合同此章节内容一致'",
  "key_changes": [
    { "description": "具体差异描述", "old": "A中的原文片段", "new": "B中的原文片段" }
  ],
  "risk_level": "low | medium | high"
}

规则：
- change_type: identical=完全一致, modified=有文字修改, semantic_change=语义发生了变化
- risk_level: 仅在有实质性风险变更时标 high，一般修改标 medium，无风险标 low
- key_changes: 仅在有差异时列出，一致时为空数组
- 多语种比对时，忽略语言差异，只关注语义是否相同（如中文"付款期限30天"与英文"Payment terms: 30 days"视为语义一致）`;
  }

  // ==================== Helpers ====================

  async isAdmin(userId) {
    this.ensureModels();
    const userRole = await this.models.UserRole.findOne({
      where: { user_id: userId },
      include: [{
        model: this.models.Role,
        as: 'role',
        where: { level: 'admin' },
      }],
    });
    return !!userRole;
  }

  validateData(fields, data) {
    if (!fields || !Array.isArray(fields)) return;

    for (const field of fields) {
      if (field.type === 'group') {
        this.validateGroupField(field, data[field.name]);
      } else if (field.type === 'repeating') {
        this.validateRepeatingField(field, data[field.name]);
      } else {
        if (field.required && field.type !== 'file') {
          const value = data[field.name];
          if (value === undefined || value === null || value === '') {
            throw new Error(`${field.label} 为必填项`);
          }
        }
      }
    }
  }

  validateGroupField(field, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      if (field.required) {
        throw new Error(`${field.label} 必须是对象`);
      }
      return;
    }
    for (const subField of field.fields || []) {
      if (subField.required && subField.type !== 'file') {
        const subValue = value[subField.name];
        if (subValue === undefined || subValue === null || subValue === '') {
          throw new Error(`${field.label}.${subField.label} 为必填项`);
        }
      }
    }
  }

  validateRepeatingField(field, value) {
    if (!Array.isArray(value)) {
      if (field.required) {
        throw new Error(`${field.label} 必须是数组`);
      }
      return;
    }
    if (field.min_items && value.length < field.min_items) {
      throw new Error(`${field.label} 至少需要 ${field.min_items} 项`);
    }
    if (field.max_items && value.length > field.max_items) {
      throw new Error(`${field.label} 最多 ${field.max_items} 项`);
    }
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      for (const subField of field.fields || []) {
        if (subField.required && subField.type !== 'file') {
          const subValue = item[subField.name];
          if (subValue === undefined || subValue === null || subValue === '') {
            throw new Error(`${field.label} 第${i + 1}行的 ${subField.label} 为必填项`);
          }
        }
      }
    }
  }

  computeSummaries(data, fields) {
    for (const field of fields) {
      if (field.type === 'repeating' && field.summary_fields) {
        const items = data[field.name] || [];
        for (const summary of field.summary_fields) {
          switch (summary.function) {
            case 'sum':
              data[summary.target] = items.reduce((sum, item) =>
                sum + (Number(item[summary.source]) || 0), 0);
              break;
            case 'count':
              data[summary.target] = items.length;
              break;
            case 'avg':
              data[summary.target] = items.length > 0
                ? items.reduce((sum, item) => sum + (Number(item[summary.source]) || 0), 0) / items.length
                : 0;
              break;
          }
        }
      }
    }
    return data;
  }

  computeTitle(fields, data) {
    if (!fields || !Array.isArray(fields)) return '';

    const titleField = fields.find(
      f => f.type === 'text' && f.required && f.ai_extractable
    );
    if (titleField && data[titleField.name]) {
      return String(data[titleField.name]);
    }

    const firstTextField = fields.find(f => f.type === 'text' && f.required);
    if (firstTextField && data[firstTextField.name]) {
      return String(data[firstTextField.name]);
    }

    return '';
  }
}

export default MiniAppService;
