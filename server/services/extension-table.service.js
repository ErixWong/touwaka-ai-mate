import { Sequelize, Op } from 'sequelize';
import logger from '../../lib/logger.js';

class ExtensionTableService {
  constructor(db) {
    this.db = db;
    this.sequelize = db.sequelize;
    this.QueryTypes = Sequelize.QueryTypes;
  }

  ensureModels() {
    if (!this.models) {
      this.models = {
        MiniApp: this.db.getModel('mini_app'),
        MiniAppRow: this.db.getModel('mini_app_row'),
      };
    }
  }

  async handle(appId, tableName, action, data, transaction = null) {
    const extConfig = await this.getExtensionConfig(appId, tableName);
    if (!extConfig) {
      throw new Error(`Extension table ${tableName} not found for app ${appId}`);
    }
    
    switch (action) {
      case 'create':
        return await this.createExtensionRow(appId, tableName, data, transaction);
      case 'update':
        return await this.updateExtensionRow(appId, tableName, data.row_id, data, transaction);
      case 'read':
        return await this.readExtensionRow(appId, tableName, data.row_id, data.fields);
      case 'delete':
        return await this.deleteExtensionRow(appId, tableName, data.row_id, transaction);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async getRecordsWithExtension(appId, userId, params) {
    this.ensureModels();
    const extConfigs = await this.getExtensionConfigs(appId);
    if (!extConfigs || extConfigs.length === 0) return null;

    const primaryConfig = extConfigs.find(c => c.type === 'primary');
    if (!primaryConfig) return null;

    const { page = 1, size = 10, filter, sort } = params || {};
    const offset = (parseInt(page) - 1) * parseInt(size);

    const isAdmin = await this.isAdmin(userId);

    const replacements = { appId, userId, limit: parseInt(size), offset };
    const whereClause = this.buildWhereClause(filter, primaryConfig, isAdmin, userId, replacements);
    const orderClause = this.buildOrderClause(sort, primaryConfig);

    const selectFields = primaryConfig.fields.map(f => `e.${f.name}`).join(', ');

    const sql = `
      SELECT 
        r.id, r.app_id, r.user_id, r._status, r.title, r.data, r.created_at, r.updated_at,
        ${selectFields}
      FROM mini_app_rows r
      LEFT JOIN ${primaryConfig.name} e ON e.row_id = r.id
      WHERE r.app_id = :appId ${whereClause}
      ${orderClause}
      LIMIT :limit OFFSET :offset
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM mini_app_rows r
      LEFT JOIN ${primaryConfig.name} e ON e.row_id = r.id
      WHERE r.app_id = :appId ${whereClause}
    `;

    const [rows, countResult] = await Promise.all([
      this.sequelize.query(sql, {
        replacements,
        type: this.QueryTypes.SELECT
      }),
      this.sequelize.query(countSql, {
        replacements,
        type: this.QueryTypes.SELECT
      })
    ]);

    return { rows, count: countResult[0]?.total || 0 };
  }

  async getRecordWithExtension(appId, rowId) {
    this.ensureModels();
    const extConfigs = await this.getExtensionConfigs(appId);
    if (!extConfigs || extConfigs.length === 0) return null;

    const primaryConfig = extConfigs.find(c => c.type === 'primary');
    if (!primaryConfig) return null;

    const selectFields = primaryConfig.fields.map(f => `e.${f.name}`).join(', ');

    const sql = `
      SELECT 
        r.id, r.app_id, r.user_id, r._status, r.title, r.data, r.created_at, r.updated_at,
        ${selectFields}
      FROM mini_app_rows r
      LEFT JOIN ${primaryConfig.name} e ON e.row_id = r.id
      WHERE r.id = :rowId AND r.app_id = :appId
    `;

    const rows = await this.sequelize.query(sql, {
      replacements: { rowId, appId },
      type: this.QueryTypes.SELECT
    });

    return rows[0] || null;
  }

  async getDistinctValues(appId, fieldName) {
    this.ensureModels();
    const extConfigs = await this.getExtensionConfigs(appId);
    if (!extConfigs || extConfigs.length === 0) {
      throw new Error(`App ${appId} has no extension table`);
    }

    const primaryConfig = extConfigs.find(c => c.type === 'primary');
    if (!primaryConfig) {
      throw new Error(`App ${appId} has no primary extension table`);
    }

    const fieldDef = primaryConfig.fields.find(f => f.name === fieldName);
    if (!fieldDef) {
      throw new Error(`Field ${fieldName} not in extension table`);
    }

    const sql = `
      SELECT DISTINCT ${fieldName} as value
      FROM ${primaryConfig.name}
      WHERE ${fieldName} IS NOT NULL
      ORDER BY ${fieldName}
    `;

    return await this.sequelize.query(sql, {
      type: this.QueryTypes.SELECT
    });
  }

  async createExtensionRow(appId, tableName, data, transaction = null) {
    const extConfig = await this.getExtensionConfig(appId, tableName);
    if (!extConfig) return;

    const rowId = data.row_id;
    if (!rowId) {
      throw new Error('row_id is required for createExtensionRow');
    }

    const fields = extConfig.fields.map(f => f.name);
    const values = extConfig.fields.map(f => {
      const key = f.source || f.name;
      return data[key];
    });

    const placeholders = values.map(() => '?').join(', ');

    const sql = `
      INSERT INTO ${extConfig.name} (row_id, ${fields.join(', ')})
      VALUES (?, ${placeholders})
    `;

    await this.sequelize.query(sql, {
      replacements: [rowId, ...values],
      transaction
    });

    logger.info(`[ExtensionTableService] Created row in ${tableName} for row_id ${rowId}`);
  }

  async updateExtensionRow(appId, tableName, rowId, data, transaction = null) {
    const extConfig = await this.getExtensionConfig(appId, tableName);
    if (!extConfig) return;

    const updates = extConfig.fields
      .filter(f => {
        const key = f.source || f.name;
        return data[key] !== undefined;
      })
      .map(f => {
        const key = f.source || f.name;
        const val = data[key];
        return `${f.name} = ?`;
      });

    if (updates.length === 0) return;

    const values = extConfig.fields
      .filter(f => {
        const key = f.source || f.name;
        return data[key] !== undefined;
      })
      .map(f => {
        const key = f.source || f.name;
        return data[key];
      });

    const sql = `
      UPDATE ${extConfig.name}
      SET ${updates.join(', ')}
      WHERE row_id = ?
    `;

    await this.sequelize.query(sql, {
      replacements: [...values, rowId],
      transaction
    });

    logger.info(`[ExtensionTableService] Updated row in ${tableName} for row_id ${rowId}`);
  }

  async readExtensionRow(appId, tableName, rowId, fields = null) {
    const extConfig = await this.getExtensionConfig(appId, tableName);
    if (!extConfig) return null;

    let selectFields;
    if (fields && fields.length > 0) {
      const validFields = fields.filter(f => extConfig.fields.some(ef => ef.name === f));
      if (validFields.length === 0) {
        selectFields = extConfig.fields.map(f => f.name).join(', ');
      } else {
        selectFields = validFields.join(', ');
      }
    } else {
      selectFields = extConfig.fields.map(f => f.name).join(', ');
    }

    const sql = `
      SELECT row_id, ${selectFields}
      FROM ${extConfig.name}
      WHERE row_id = ?
    `;

    const rows = await this.sequelize.query(sql, {
      replacements: [rowId],
      type: this.QueryTypes.SELECT
    });

    return rows[0] || null;
  }

  async deleteExtensionRow(appId, tableName, rowId, transaction = null) {
    const extConfig = await this.getExtensionConfig(appId, tableName);
    if (!extConfig) return;

    const sql = `DELETE FROM ${extConfig.name} WHERE row_id = ?`;
    
    await this.sequelize.query(sql, {
      replacements: [rowId],
      transaction
    });

    logger.info(`[ExtensionTableService] Deleted row in ${tableName} for row_id ${rowId}`);
  }

  buildWhereClause(filter, extConfig, isAdmin, userId, replacements) {
    const conditions = [`r.app_id = :appId`];
    
    if (!isAdmin) {
      conditions.push(`r.user_id = :userId`);
    }
    
    if (filter) {
      const filterObj = typeof filter === 'string' ? JSON.parse(filter) : filter;
      for (const [key, value] of Object.entries(filterObj)) {
        if (key === '_status') {
          const paramName = `filter_${key}`;
          conditions.push(`r._status = :${paramName}`);
          replacements[paramName] = value;
        } else if (extConfig.fields.find(f => f.name === key)) {
          const paramName = `filter_${key}`;
          conditions.push(`e.${key} = :${paramName}`);
          replacements[paramName] = value;
        }
      }
    }
    
    return `AND ${conditions.join(' AND ')}`;
  }

  buildOrderClause(sort, extConfig) {
    if (!sort) return 'ORDER BY r.created_at DESC';
    
    const { field, order = 'DESC' } = sort;
    const validOrder = ['ASC', 'DESC'].includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
    
    if (extConfig.fields.find(f => f.name === field)) {
      return `ORDER BY e.${field} ${validOrder}`;
    }
    return `ORDER BY r.${field} ${validOrder}`;
  }
    if (extConfig.fields.find(f => f.name === field)) {
      return `ORDER BY e.${field} ${order}`;
    }
    return `ORDER BY r.${field} ${order}`;
  }

  async getExtensionConfig(appId, tableName) {
    const configs = await this.getExtensionConfigs(appId);
    if (!configs || configs.length === 0) return null;
    return configs.find(c => c.name === tableName);
  }

  async getExtensionConfigs(appId) {
    this.ensureModels();
    const app = await this.models.MiniApp.findByPk(appId);
    if (!app) return null;
    
    let config = app.config;
    if (typeof config === 'string') {
      try {
        config = JSON.parse(config);
      } catch (e) {
        logger.error(`[ExtensionTableService] Failed to parse app.config: ${e.message}`);
        return null;
      }
    }
    
    return config.extension_tables || null;
  }

  async isAdmin(userId) {
    this.ensureModels();
    const UserRole = this.db.getModel('user_role');
    const Role = this.db.getModel('role');
    
    const userRole = await UserRole.findOne({
      where: { user_id: userId },
      include: [{
        model: Role,
        as: 'role',
        where: { level: 'admin' },
        required: true
      }]
    });
    
    return !!userRole;
  }
}

export default ExtensionTableService;