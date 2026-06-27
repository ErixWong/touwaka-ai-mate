import { Sequelize, Op } from 'sequelize';
import logger from '../../lib/logger.js';

/**
 * ============================================================
 * Phase 6 LEGACY BOUNDARY AUDIT
 * ============================================================
 * 
 * 当前状态：本服务的 getRecordsWithExtension / getRecordWithExtension
 * 以 `mini_app_rows r` 作为查询主表，LEFT JOIN 扩展表。
 * 
 * 问题：
 *   - 将 mini_app_rows 视为唯一不可替代的中心记录模型
 *   - 自治 app（如 contract-mgr-v2）已有自己的主记录表（contract_v2_main_records），
 *     但扩展表查询仍绕回 mini_app_rows 做 JOIN 锚点
 * 
 * 扩展路线（Phase 6+）：
 *   Step 1 (当前 Round 1): 添加本审计块，标记中心表依赖
 *   Step 2: 新增 getRecordsAutonomous() 方法，接受 autonomousTable + pkColumn 参数
 *           替代 FROM mini_app_rows r 硬编码
 *   Step 3: 在 mini-app.service.js 的 getRecords() 中判断 app 是否为自治 app，
 *           自治 app 走 autonomous 路径，legacy app 保留原路径
 *   Step 4: contract-mgr + invoice-mgr 完成迁移后，移除原路径
 * 
 * 当前调用方：
 *   - mini-app.service.js: getRecords() / getRecord() — 优先调 extension 路径
 *   - mini-app.service.js: createRecord() / updateRecord() — 调用 createExtensionRow / updateExtensionRow
 *   - mini-app.service.js: compareRecords() — 调用 upsertExtensionRow / readExtensionRow
 * ============================================================
 */

class ExtensionTableService {
  constructor(db) {
    this.db = db;
    this.sequelize = db.sequelize;
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
      case 'upsert':
        return await this.upsertExtensionRow(appId, tableName, data.row_id, data, transaction);
      case 'read':
        return await this.readExtensionRow(appId, tableName, data.row_id, data.fields);
      case 'delete':
        return await this.deleteExtensionRow(appId, tableName, data.row_id, transaction);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // LEGACY (Phase 6): 以 mini_app_rows 为中心查询主表
  // 扩展路线：Step 2 新增 getRecordsAutonomous(appId, userId, params, autonomousTable, pkColumn)
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
        r.id, r.app_id, r.user_id, r.status, r.title, r.data, r.created_at, r.updated_at,
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
        type: Sequelize.QueryTypes.SELECT
      }),
      this.sequelize.query(countSql, {
        replacements,
        type: Sequelize.QueryTypes.SELECT
      })
    ]);

    return { rows, count: countResult[0]?.total || 0 };
  }

  // LEGACY (Phase 6): 以 mini_app_rows 为中心查询单条记录
  // 扩展路线：Step 2 新增 getRecordAutonomous(appId, rowId, autonomousTable, pkColumn)
  async getRecordWithExtension(appId, rowId) {
    this.ensureModels();
    const extConfigs = await this.getExtensionConfigs(appId);
    if (!extConfigs || extConfigs.length === 0) return null;

    const primaryConfig = extConfigs.find(c => c.type === 'primary');
    if (!primaryConfig) return null;

    const selectFields = primaryConfig.fields.map(f => `e.${f.name}`).join(', ');

    const sql = `
      SELECT 
        r.id, r.app_id, r.user_id, r.status, r.title, r.data, r.created_at, r.updated_at,
        ${selectFields}
      FROM mini_app_rows r
      LEFT JOIN ${primaryConfig.name} e ON e.row_id = r.id
      WHERE r.id = :rowId AND r.app_id = :appId
    `;

    const rows = await this.sequelize.query(sql, {
      replacements: { rowId, appId },
      type: Sequelize.QueryTypes.SELECT
    });

    return rows[0] || null;
  }

  // ============================================================
  // Phase 6 NEW: Autonomous query path (no mini_app_rows anchor)
  // ============================================================
  //
  // NOTE: These methods are provided as a reusable generic capability.
  // Currently, invoice-mgr and contract-mgr use the hardcoded config in
  // mini-app.service.js getAutonomousAppConfig() instead.
  // These methods can be used by apps that don't have hardcoded config.
  //
  // Current status:
  //   - contract-mgr-v2: uses its own dedicated route system (/api/apps/contract-mgr-v2/*)
  //   - invoice-mgr: uses mini-app.service.js autonomous path
  //   - contract-mgr: uses mini-app.service.js autonomous path
  //
  // The generic autonomous path in this file remains available for:
  //   - Future autonomous apps without hardcoded config
  //   - Apps that need dynamic table configuration
  //
  // When used, pass options with:
  //   - base_table: Main records table (e.g., 'app_contract_mgr_v2_records')
  //   - primary_table: Extension primary table (e.g., 'app_contract_mgr_v2_rows')
  //   - And other config options as documented in the method JSDoc
  // ============================================================

  /**
   * Autonomous app records query - uses autonomous main table as anchor
   * instead of mini_app_rows
   * 
   * @param {string} appId - App ID (e.g., 'contract-mgr-v2')
   * @param {string} userId - User ID for permission filtering
   * @param {Object} params - Query params: { page, size, filter, sort }
   * @param {Object} options - Autonomous table config
   *   - base_table: Main records table (e.g., 'app_contract_mgr_v2_records')
   *   - base_alias: Table alias (e.g., 'm')
   *   - pk_column: Primary key column (e.g., 'id')
   *   - primary_table: Extension primary table (e.g., 'app_contract_mgr_v2_rows')
   *   - primary_alias: Extension table alias (e.g., 'e')
   *   - user_column: User ID column in main table (e.g., 'user_id')
   *   - status_column: Status column in main table (e.g., 'status')
   *   - created_at_column: Created_at column (e.g., 'created_at')
   *   - app_id_column: App ID column (optional, for multi-app tables)
   *   - app_id_value: App ID value (if app_id_column is set)
   */
  async getRecordsWithExtensionAutonomous(appId, userId, params, options) {
    this.ensureModels();
    const extConfigs = await this.getExtensionConfigs(appId);
    if (!extConfigs || extConfigs.length === 0) return null;

    const primaryConfig = extConfigs.find(c => c.type === 'primary');
    if (!primaryConfig) return null;

    const {
      base_table,
      base_alias = 'm',
      pk_column = 'id',
      primary_table,
      primary_alias = 'e',
      user_column = 'user_id',
      status_column = 'status',
      created_at_column = 'created_at',
      app_id_column = null,
      app_id_value = null
    } = options;

    if (!base_table || !primary_table) {
      throw new Error('base_table and primary_table are required for autonomous query');
    }

    const { page = 1, size = 10, filter, sort } = params || {};
    const limit = Math.min(Math.max(parseInt(size) || 10, 1), 100);
    const offset = (parseInt(page) - 1) * limit;

    const isAdmin = await this.isAdmin(userId);

    const replacements = { appId, userId, limit, offset };
    const conditions = [];

    // Add app_id condition if specified
    if (app_id_column && app_id_value) {
      conditions.push(`${base_alias}.${app_id_column} = :appId`);
      replacements.appId = app_id_value;
    }

    // Add user_id condition for non-admin
    if (!isAdmin && user_column) {
      conditions.push(`${base_alias}.${user_column} = :userId`);
    }

    // Build filter conditions
    if (filter) {
      const filterObj = typeof filter === 'string' ? JSON.parse(filter) : filter;
      for (const [key, value] of Object.entries(filterObj)) {
        const paramName = `filter_${key}`;
        if (key === 'status') {
          conditions.push(`${base_alias}.${status_column} = :${paramName}`);
          replacements[paramName] = value;
        } else if (primaryConfig.fields.some(f => f.name === key)) {
          conditions.push(`${primary_alias}.${key} = :${paramName}`);
          replacements[paramName] = value;
        }
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Build order clause
    let orderClause = `ORDER BY ${base_alias}.${created_at_column} DESC`;
    if (sort) {
      const { field, order = 'DESC' } = sort;
      const validOrder = ['ASC', 'DESC'].includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
      
      if (field === 'created_at' || field === 'status') {
        orderClause = `ORDER BY ${base_alias}.${field} ${validOrder}`;
      } else if (primaryConfig.fields.some(f => f.name === field)) {
        orderClause = `ORDER BY ${primary_alias}.${field} ${validOrder}`;
      }
    }

    const selectFields = primaryConfig.fields.map(f => `${primary_alias}.${f.name}`).join(', ');

    const sql = `
      SELECT 
        ${base_alias}.${pk_column} as id, 
        ${app_id_column ? `${base_alias}.${app_id_column} as app_id,` : ''}
        ${base_alias}.${user_column} as user_id, 
        ${base_alias}.${status_column} as status, 
        ${base_alias}.data, 
        ${base_alias}.${created_at_column} as created_at, 
        ${base_alias}.updated_at,
        ${selectFields}
      FROM ${base_table} ${base_alias}
      LEFT JOIN ${primary_table} ${primary_alias} ON ${primary_alias}.row_id = ${base_alias}.${pk_column}
      ${whereClause}
      ${orderClause}
      LIMIT :limit OFFSET :offset
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM ${base_table} ${base_alias}
      LEFT JOIN ${primary_table} ${primary_alias} ON ${primary_alias}.row_id = ${base_alias}.${pk_column}
      ${whereClause}
    `;

    const [rows, countResult] = await Promise.all([
      this.sequelize.query(sql, {
        replacements,
        type: Sequelize.QueryTypes.SELECT
      }),
      this.sequelize.query(countSql, {
        replacements,
        type: Sequelize.QueryTypes.SELECT
      })
    ]);

    return { rows, count: countResult[0]?.total || 0 };
  }

  /**
   * Autonomous app single record query
   */
  async getRecordWithExtensionAutonomous(appId, recordId, options) {
    this.ensureModels();
    const extConfigs = await this.getExtensionConfigs(appId);
    if (!extConfigs || extConfigs.length === 0) return null;

    const primaryConfig = extConfigs.find(c => c.type === 'primary');
    if (!primaryConfig) return null;

    const {
      base_table,
      base_alias = 'm',
      pk_column = 'id',
      primary_table,
      primary_alias = 'e',
      user_column = 'user_id',
      status_column = 'status',
      created_at_column = 'created_at',
      app_id_column = null,
      app_id_value = null
    } = options;

    if (!base_table || !primary_table) {
      throw new Error('base_table and primary_table are required for autonomous query');
    }

    const selectFields = primaryConfig.fields.map(f => `${primary_alias}.${f.name}`).join(', ');

    let appIdCondition = '';
    if (app_id_column && app_id_value) {
      appIdCondition = `AND ${base_alias}.${app_id_column} = :appIdValue`;
    }

    const sql = `
      SELECT 
        ${base_alias}.${pk_column} as id, 
        ${app_id_column ? `${base_alias}.${app_id_column} as app_id,` : ''}
        ${base_alias}.${user_column} as user_id, 
        ${base_alias}.${status_column} as status, 
        ${base_alias}.data, 
        ${base_alias}.${created_at_column} as created_at, 
        ${base_alias}.updated_at,
        ${selectFields}
      FROM ${base_table} ${base_alias}
      LEFT JOIN ${primary_table} ${primary_alias} ON ${primary_alias}.row_id = ${base_alias}.${pk_column}
      WHERE ${base_alias}.${pk_column} = :recordId ${appIdCondition}
    `;

    const rows = await this.sequelize.query(sql, {
      replacements: { recordId, appIdValue: app_id_value },
      type: Sequelize.QueryTypes.SELECT
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
      type: Sequelize.QueryTypes.SELECT
    });
  }

  async createExtensionRow(appId, tableName, data, transaction = null) {
    const extConfig = await this.getExtensionConfig(appId, tableName);
    if (!extConfig) return;

    const rowId = data.row_id;
    if (!rowId) {
      throw new Error('row_id is required for createExtensionRow');
    }

    // 只包含有值的字段
    const fieldsWithData = extConfig.fields.filter(f => {
      const key = f.source || f.name;
      return data[key] !== undefined && data[key] !== null;
    });

    if (fieldsWithData.length === 0) {
      // 没有数据，只插入 row_id
      const sql = `INSERT INTO ${extConfig.name} (row_id) VALUES (?)`;
      await this.sequelize.query(sql, { replacements: [rowId], transaction });
    } else {
      const fields = fieldsWithData.map(f => f.name);
      const values = fieldsWithData.map(f => {
        const key = f.source || f.name;
        const val = data[key];
        
        if (f.type.toUpperCase() === 'DATE' && val) {
          if (typeof val === 'string' && val.includes('T')) {
            return val.split('T')[0];
          }
          if (val instanceof Date) {
            return val.toISOString().split('T')[0];
          }
        }
        
        return val;
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
    }

    logger.info(`[ExtensionTableService] Created row in ${tableName} for row_id ${rowId}`);
  }

  async upsertExtensionRow(appId, tableName, rowId, data, transaction = null) {
    const extConfig = await this.getExtensionConfig(appId, tableName);
    if (!extConfig) return;

    const existing = await this.readExtensionRow(appId, tableName, rowId);
    if (existing) {
      await this.updateExtensionRow(appId, tableName, rowId, data, transaction);
    } else {
      const createData = { row_id: rowId, ...data };
      await this.createExtensionRow(appId, tableName, createData, transaction);
    }
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
        const val = data[key];
        
        if (f.type.toUpperCase() === 'DATE' && val) {
          if (typeof val === 'string' && val.includes('T')) {
            return val.split('T')[0];
          }
          if (val instanceof Date) {
            return val.toISOString().split('T')[0];
          }
        }
        
        return val;
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
      type: Sequelize.QueryTypes.SELECT
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
        if (key === 'status') {
          const paramName = `filter_${key}`;
          conditions.push(`r.status = :${paramName}`);
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