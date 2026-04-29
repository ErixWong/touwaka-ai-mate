import logger from '../../lib/logger.js';
import MiniAppService from '../services/mini-app.service.js';

class MiniAppController {
  constructor(db) {
    this.db = db;
    this.miniAppService = new MiniAppService(db);
  }

  // ==================== App CRUD ====================

  async listApps(ctx) {
    try {
      const userId = ctx.state.session.id;
      const apps = await this.miniAppService.getAccessibleApps(userId);
      ctx.success(apps);
    } catch (error) {
      logger.error('List apps error:', error);
      ctx.error(error.message, 500);
    }
  }

  async getApp(ctx) {
    try {
      const { appId } = ctx.params;
      const app = await this.miniAppService.getAppById(appId);
      if (!app) {
        ctx.error('App not found', 404);
        return;
      }
      ctx.success(app);
    } catch (error) {
      logger.error('Get app error:', error);
      ctx.error(error.message, 500);
    }
  }

  async createApp(ctx) {
    try {
      const data = ctx.request.body;
      data.owner_id = data.owner_id || ctx.state.session.id;
      data.creator_id = ctx.state.session.id;
      const app = await this.miniAppService.createApp(data);
      ctx.success(app, 'Created');
    } catch (error) {
      logger.error('Create app error:', error);
      ctx.error(error.message, 400);
    }
  }

  async updateApp(ctx) {
    try {
      const { appId } = ctx.params;
      const data = ctx.request.body;
      const app = await this.miniAppService.updateApp(appId, data);
      ctx.success(app, 'Updated');
    } catch (error) {
      logger.error('Update app error:', error);
      ctx.error(error.message, 400);
    }
  }

  async deleteApp(ctx) {
    try {
      const { appId } = ctx.params;
      await this.miniAppService.deleteApp(appId);
      ctx.success(null, 'Deleted');
    } catch (error) {
      logger.error('Delete app error:', error);
      ctx.error(error.message, 400);
    }
  }

  async getAppConfig(ctx) {
    try {
      const { appId } = ctx.params;
      const config = await this.miniAppService.getAppConfig(appId);
      ctx.success(config);
    } catch (error) {
      logger.error('Get app config error:', error);
      ctx.error(error.message, 404);
    }
  }

  async updateAppConfig(ctx) {
    try {
      const { appId } = ctx.params;
      const configData = ctx.request.body;
      const config = await this.miniAppService.updateAppConfig(appId, configData);
      ctx.success(config, 'Updated');
    } catch (error) {
      logger.error('Update app config error:', error);
      ctx.error(error.message, 400);
    }
  }

  async getAvailableResources(ctx) {
    try {
      const { appId } = ctx.params;
      const resources = await this.miniAppService.getAvailableResources(appId);
      ctx.success(resources);
    } catch (error) {
      logger.error('Get available resources error:', error);
      ctx.error(error.message, 500);
    }
  }

  // ==================== Record CRUD ====================

  async listRecords(ctx) {
    try {
      const { appId } = ctx.params;
      const userId = ctx.state.session.id;
      const result = await this.miniAppService.getRecords(appId, userId, ctx.query);
      ctx.success(result);
    } catch (error) {
      logger.error('List records error:', error);
      ctx.error(error.message, 500);
    }
  }

  async getRecord(ctx) {
    try {
      const { appId, recordId } = ctx.params;
      const userId = ctx.state.session.id;
      const record = await this.miniAppService.getRecord(appId, recordId, userId);
      ctx.success(record);
    } catch (error) {
      logger.error('Get record error:', error);
      ctx.error(error.message, 404);
    }
  }

  async createRecord(ctx) {
    try {
      const { appId } = ctx.params;
      const userId = ctx.state.session.id;
      const { data, attachments, clientRecordId } = ctx.request.body;
      const record = await this.miniAppService.createRecord(appId, userId, data || {}, attachments || [], clientRecordId);
      ctx.success(record, 'Created');
    } catch (error) {
      logger.error('Create record error:', error);
      ctx.error(error.message, 400);
    }
  }

  async updateRecord(ctx) {
    try {
      const { appId, recordId } = ctx.params;
      const userId = ctx.state.session.id;
      const { data, status } = ctx.request.body;
      
      const options = {};
      if (status) {
        const isAdmin = await this.miniAppService.isAdmin(userId);
        if (!isAdmin) {
          ctx.error('Only admin can change status', 403);
          return;
        }
        options.status = status;
      }
      
      const record = await this.miniAppService.updateRecord(appId, recordId, userId, data || {}, options);
      ctx.success(record, 'Updated');
    } catch (error) {
      logger.error('Update record error:', error);
      ctx.error(error.message, 400);
    }
  }

  async deleteRecord(ctx) {
    try {
      const { appId, recordId } = ctx.params;
      const userId = ctx.state.session.id;
      await this.miniAppService.deleteRecord(appId, recordId, userId);
      ctx.success(null, 'Deleted');
    } catch (error) {
      logger.error('Delete record error:', error);
      ctx.error(error.message, 400);
    }
  }

  async confirmRecord(ctx) {
    try {
      const { appId, recordId } = ctx.params;
      const userId = ctx.state.session.id;
      const { data } = ctx.request.body;
      const record = await this.miniAppService.confirmRecord(appId, recordId, userId, data || {});
      ctx.success(record, 'Confirmed');
    } catch (error) {
      logger.error('Confirm record error:', error);
      ctx.error(error.message, 400);
    }
  }

  async reExtractRecord(ctx) {
    try {
      const { appId, recordId } = ctx.params;
      const userId = ctx.state.session.id;
      
      const isAdmin = await this.miniAppService.isAdmin(userId);
      if (!isAdmin) {
        ctx.error('Only admin can re-extract', 403);
        return;
      }
      
      const record = await this.miniAppService.updateRecord(appId, recordId, userId, {}, { status: 'pending_extract' });
      ctx.success(record, 'Re-extract triggered');
    } catch (error) {
      logger.error('Re-extract error:', error);
      ctx.error(error.message, 400);
    }
  }

  async batchUpload(ctx) {
    try {
      const { appId } = ctx.params;
      const userId = ctx.state.session.id;
      const { attachments } = ctx.request.body;

      if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
        ctx.error('attachments array is required', 400);
        return;
      }

      const result = await this.miniAppService.batchUpload(appId, userId, attachments);
      ctx.success(result, 'Uploaded');
    } catch (error) {
      logger.error('Batch upload error:', error);
      ctx.error(error.message, 500);
    }
  }

  async getStatusSummary(ctx) {
    try {
      const { appId } = ctx.params;
      const userId = ctx.state.session.id;
      const { created_after } = ctx.query;
      const result = await this.miniAppService.getStatusSummary(appId, userId, created_after);
      ctx.success(result);
    } catch (error) {
      logger.error('Get status summary error:', error);
      ctx.error(error.message, 500);
    }
  }

  // ==================== State CRUD ====================

  async listStates(ctx) {
    try {
      const { appId } = ctx.params;
      const states = await this.miniAppService.getStates(appId);
      ctx.success(states);
    } catch (error) {
      logger.error('List states error:', error);
      ctx.error(error.message, 500);
    }
  }

  async createState(ctx) {
    try {
      const { appId } = ctx.params;
      const data = ctx.request.body;
      const state = await this.miniAppService.createState(appId, data);
      ctx.success(state, 'Created');
    } catch (error) {
      logger.error('Create state error:', error);
      ctx.error(error.message, 400);
    }
  }

  async updateState(ctx) {
    try {
      const { appId, stateId } = ctx.params;
      const data = ctx.request.body;
      const state = await this.miniAppService.updateState(appId, stateId, data);
      ctx.success(state, 'Updated');
    } catch (error) {
      logger.error('Update state error:', error);
      ctx.error(error.message, 400);
    }
  }

  async deleteState(ctx) {
    try {
      const { appId, stateId } = ctx.params;
      await this.miniAppService.deleteState(appId, stateId);
      ctx.success(null, 'Deleted');
    } catch (error) {
      logger.error('Delete state error:', error);
      ctx.error(error.message, 400);
    }
  }

  // ==================== Handler CRUD ====================

  async listHandlers(ctx) {
    try {
      const handlers = await this.miniAppService.getHandlers();
      ctx.success(handlers);
    } catch (error) {
      logger.error('List handlers error:', error);
      ctx.error(error.message, 500);
    }
  }

  async getHandler(ctx) {
    try {
      const { handlerId } = ctx.params;
      const handler = await this.miniAppService.getHandlerById(handlerId);
      if (!handler) {
        ctx.error('Handler not found', 404);
        return;
      }
      ctx.success(handler);
    } catch (error) {
      logger.error('Get handler error:', error);
      ctx.error(error.message, 500);
    }
  }

  async createHandler(ctx) {
    try {
      const data = ctx.request.body;
      const handler = await this.miniAppService.createHandler(data);
      ctx.success(handler, 'Created');
    } catch (error) {
      logger.error('Create handler error:', error);
      ctx.error(error.message, 400);
    }
  }

  async updateHandler(ctx) {
    try {
      const { handlerId } = ctx.params;
      const data = ctx.request.body;
      const handler = await this.miniAppService.updateHandler(handlerId, data);
      ctx.success(handler, 'Updated');
    } catch (error) {
      logger.error('Update handler error:', error);
      ctx.error(error.message, 400);
    }
  }

  async deleteHandler(ctx) {
    try {
      const { handlerId } = ctx.params;
      await this.miniAppService.deleteHandler(handlerId);
      ctx.success(null, 'Deleted');
    } catch (error) {
      logger.error('Delete handler error:', error);
      ctx.error(error.message, 400);
    }
  }

  async getHandlerLogs(ctx) {
    try {
      const { handlerId } = ctx.params;
      const limit = parseInt(ctx.query.limit) || 20;
      const logs = await this.miniAppService.getHandlerLogs(handlerId, limit);
      ctx.success(logs);
    } catch (error) {
      logger.error('Get handler logs error:', error);
      ctx.error(error.message, 500);
    }
  }

  async testHandler(ctx) {
    try {
      const { handlerId } = ctx.params;
      const { record_id } = ctx.request.body;

      const handler = await this.miniAppService.getHandlerById(handlerId);
      if (!handler) {
        ctx.error('Handler not found', 404);
        return;
      }

      ctx.success({ message: 'Test not implemented yet', handler_id: handlerId, record_id });
    } catch (error) {
      logger.error('Test handler error:', error);
      ctx.error(error.message, 500);
    }
  }

  // ==================== Extension Tables ====================

  async compareRecords(ctx) {
    try {
      const { appId } = ctx.params;
      const { row_id_a, row_id_b, model_id, temperature, concurrency } = ctx.request.body;

      if (!row_id_a || !row_id_b) {
        ctx.error('row_id_a and row_id_b are required', 400);
        return;
      }
      if (row_id_a === row_id_b) {
        ctx.error('Cannot compare the same record', 400);
        return;
      }

      const result = await this.miniAppService.compareRecords(appId, row_id_a, row_id_b, {
        model_id,
        temperature,
        concurrency,
      });
      ctx.success(result);
    } catch (error) {
      logger.error('Compare records error:', error);
      ctx.error(error.message, 500);
    }
  }

  // ==================== Extension Tables (original) ====================

  async getDistinctValues(ctx) {
    try {
      const { appId } = ctx.params;
      const { fields } = ctx.query;
      
      if (!fields) {
        ctx.error('Missing fields parameter', 400);
        return;
      }
      
      const fieldList = fields.split(',').map(f => f.trim()).filter(f => f);
      
      if (fieldList.length > 10) {
        ctx.error('Too many fields (max 10)', 400);
        return;
      }
      
      const results = {};
      
      for (const field of fieldList) {
        try {
          results[field] = await this.miniAppService.extensionService.getDistinctValues(appId, field);
        } catch (err) {
          results[field] = [];
        }
      }
      
      ctx.success(results);
    } catch (error) {
      logger.error('Get distinct values error:', error);
      ctx.error(error.message, 500);
    }
  }

  async getDistinctField(ctx) {
    try {
      const { appId, field } = ctx.params;
      const values = await this.miniAppService.extensionService.getDistinctValues(appId, field);
      ctx.success({ field, values });
    } catch (error) {
      logger.error('Get distinct field error:', error);
      ctx.error(error.message, 500);
    }
  }

  // ==================== Content (OCR) ====================

  async getDocumentContent(ctx) {
    try {
      const { appId, rowId } = ctx.params;
      const userId = ctx.state.session.id;
      
      const record = await this.miniAppService.getRecord(appId, rowId, userId);
      if (!record) {
        ctx.error('Record not found', 404);
        return;
      }
      
      const extConfigs = await this.miniAppService.extensionService.getExtensionConfigs(appId);
      const contentConfig = extConfigs?.find(c => c.type === 'content');
      
      if (!contentConfig) {
        ctx.success({ has_content: false, message: 'No content table' });
        return;
      }
      
      const content = await this.miniAppService.extensionService.readExtensionRow(
        appId,
        contentConfig.name,
        rowId,
        ['ocr_text', 'filtered_text', 'sections', 'extract_prompt', 'extract_json', 'extract_at']
      );
      
      if (!content) {
        ctx.success({ has_content: false });
        return;
      }
      
      let sections = [];
      if (content.sections) {
        try {
          sections = typeof content.sections === 'string' ? JSON.parse(content.sections) : content.sections;
        } catch {
          sections = [];
        }
      }
      
      ctx.success({
        has_content: true,
        ocr_text: content.ocr_text || '',
        filtered_text: content.filtered_text || '',
        sections: sections,
        extract_prompt: content.extract_prompt || '',
        extract_json: content.extract_json ? (() => { try { return JSON.parse(content.extract_json); } catch { return null; } })() : null,
        extract_at: content.extract_at
      });
    } catch (error) {
      logger.error('Get document content error:', error);
      ctx.error(error.message, 500);
    }
  }
}

export default MiniAppController;
