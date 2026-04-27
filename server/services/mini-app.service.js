import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op, Sequelize } from 'sequelize';
import { pathToFileURL } from 'url';
import {
  buildPaginatedResponse,
} from '../../lib/query-builder.js';
import ExtensionTableService from './extension-table.service.js';

class MiniAppService {
  constructor(db) {
    this.db = db;
    this.models = {};
    this.extensionService = new ExtensionTableService(db);
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
    return config || {};
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

  async updateRecord(appId, recordId, userId, data) {
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

    const mergedData = { ...record.data, ...data };
    const title = this.computeTitle(app.fields, mergedData);

    const transaction = await this.db.sequelize.transaction();
    
    try {
      await record.update({
        data: mergedData,
        title,
        revision: record.revision + 1,
      }, { transaction });

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

    let mergedData = { ...record.data, ...data };

    const confirmedState = await this.models.AppState.findOne({
      where: { app_id: appId, is_terminal: true },
    });

    const title = this.computeTitle(app.fields, mergedData);

    // 更新 record，status 是实体字段
    await this.models.MiniAppRow.update(
      {
        data: mergedData,
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
