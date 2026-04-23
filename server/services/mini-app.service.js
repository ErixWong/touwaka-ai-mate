import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op, Sequelize } from 'sequelize';
import {
  buildPaginatedResponse,
} from '../../lib/query-builder.js';

class MiniAppService {
  constructor(db) {
    this.db = db;
    this.models = {};
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

  async getAvailableResources() {
    this.ensureModels();
    const MCPServer = this.db.getModel('mcp_server');
    const MCPToolsCache = this.db.getModel('mcp_tools_cache');

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
        tools: tools.map(t => ({
          name: t.tool_name,
          description: t.description,
        })),
      });
    }

    return {
      mcp_servers: result,
      internal_llm: { available: true },
    };
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
          if (key === '_status') {
            where._status = value;
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

  async createRecord(appId, userId, data, attachmentIds = []) {
    this.ensureModels();

    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) throw new Error('App not found');

    this.validateData(app.fields, data);

    const initialState = await this.models.AppState.findOne({
      where: { app_id: appId, is_initial: true },
    });

    if (initialState) {
      data._status = initialState.name;
    }

    const title = this.computeTitle(app.fields, data);

    const record = await this.models.MiniAppRow.create({
      id: Utils.newID(20),
      app_id: appId,
      user_id: userId,
      data,
      title,
    });

    if (attachmentIds.length > 0) {
      for (const attId of attachmentIds) {
        await this.models.MiniAppFile.create({
          id: Utils.newID(20),
          record_id: record.id,
          app_id: appId,
          attachment_id: attId,
        });
      }
    }

    return record;
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

    await record.update({
      data: mergedData,
      title,
      revision: record.revision + 1,
    });

    return record;
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
    if (confirmedState) {
      mergedData._status = confirmedState.name;
    }

    const title = this.computeTitle(app.fields, mergedData);

    await record.update({
      data: mergedData,
      title,
      revision: record.revision + 1,
    });

    return record;
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

      const data = { _status: initialStatus };

      const record = await this.models.MiniAppRow.create({
        id: Utils.newID(20),
        app_id: appId,
        user_id: userId,
        data,
        title: attachment.file_name || 'Unknown',
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
      `SELECT _status, COUNT(*) as count FROM mini_app_rows WHERE app_id = ? ${!isAdmin ? 'AND user_id = ?' : ''} ${createdAfter ? 'AND created_at >= ?' : ''} GROUP BY _status`,
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
      const status = row._status || 'unknown';
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
