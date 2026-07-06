import Utils from '../../../../lib/utils.js';
import logger from '../../../../lib/logger.js';
import { DEFAULT_JSON_OUTPUT_SCHEMA } from './config.service.js';

function normalizeRuleSetName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const DEFAULT_STAGE_COLORS = ['#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function normalizeStage(stage, index) {
  return {
    stage_code: typeof stage.stage_code === 'string' ? stage.stage_code.trim() : '',
    stage_name: typeof stage.stage_name === 'string' ? stage.stage_name.trim() : '',
    stage_order: Number.isFinite(Number(stage.stage_order)) ? Number(stage.stage_order) : index,
    stage_color: typeof stage.stage_color === 'string' && stage.stage_color.trim()
      ? stage.stage_color.trim()
      : DEFAULT_STAGE_COLORS[index % DEFAULT_STAGE_COLORS.length],
    semantic_definition: typeof stage.semantic_definition === 'string' ? stage.semantic_definition.trim() : '',
  };
}

function validateStages(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error('请至少配置一个阶段定义');
  }

  const stageCodes = new Set();
  for (let index = 0; index < stages.length; index++) {
    const stage = normalizeStage(stages[index], index);
    if (!stage.stage_code) {
      throw new Error(`阶段 ${index + 1} 的阶段标识不能为空`);
    }
    if (!stage.stage_name) {
      throw new Error(`阶段 ${index + 1} 的阶段名称不能为空`);
    }
    if (!stage.semantic_definition) {
      throw new Error(`阶段 ${index + 1} 的业务语义不能为空`);
    }
    if (stageCodes.has(stage.stage_code)) {
      throw new Error(`阶段标识 ${stage.stage_code} 重复，请保持唯一`);
    }
    stageCodes.add(stage.stage_code);
  }
}

class RuleSetService {
  constructor(db) {
    this.db = db;
  }

  async list() {
    const sets = await this.db.query(`
      SELECT
        rs.id,
        rs.rule_set_name,
        rs.description,
        rs.is_default,
        rs.is_enabled,
        rs.created_at,
        rs.updated_at,
        COUNT(st.id) AS stage_count
      FROM app_current_feature_rule_sets rs
      LEFT JOIN app_current_feature_rule_stages st ON st.rule_set_id = rs.id
      GROUP BY rs.id, rs.rule_set_name, rs.description, rs.is_default, rs.is_enabled, rs.created_at, rs.updated_at
      ORDER BY rs.is_default DESC, rs.created_at DESC
    `);
    return sets;
  }

  async getById(id, includeStages = false) {
    const ruleSet = await this.db.getOne(
      `SELECT * FROM app_current_feature_rule_sets WHERE id = ?`,
      [id]
    );
    if (!ruleSet) return null;

    if (includeStages && ruleSet) {
      const stages = await this.db.query(
        `SELECT * FROM app_current_feature_rule_stages
         WHERE rule_set_id = ? ORDER BY stage_order ASC`,
        [id]
      );
      ruleSet.stages = stages.map(s => ({
        stage_code: s.stage_code,
        stage_name: s.stage_name,
        stage_order: s.stage_order,
        stage_color: s.stage_color,
        semantic_definition: s.semantic_definition,
      }));
    }

    return ruleSet;
  }

  async create(data, userId) {
    const id = Utils.newID();
    const {
      rule_set_name,
      description = '',
      is_default = false,
      is_enabled = true,
      stages = [],
    } = data;

    if (!normalizeRuleSetName(rule_set_name)) {
      throw new Error('规则集名称不能为空');
    }

    if (is_default) {
      await this.db.execute(
        `UPDATE app_current_feature_rule_sets SET is_default = b'0'`
      );
    }

    await this.db.execute(`
      INSERT INTO app_current_feature_rule_sets
      (id, rule_set_name, description, is_default, is_enabled, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      id, normalizeRuleSetName(rule_set_name), description, is_default, is_enabled, userId,
    ]);

    if (Array.isArray(stages) && stages.length > 0) {
      validateStages(stages);
      for (let index = 0; index < stages.length; index++) {
        await this.createStage(id, normalizeStage(stages[index], index));
      }
    }

    return this.getById(id, true);
  }

  async update(id, data, userId) {
    const {
      rule_set_name,
      description,
      is_default,
      is_enabled,
      stages,
    } = data;

    const updates = [];
    const params = [];

    if (rule_set_name !== undefined) { updates.push('rule_set_name = ?'); params.push(normalizeRuleSetName(rule_set_name)); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (is_default !== undefined) { updates.push('is_default = ?'); params.push(is_default); }
    if (is_enabled !== undefined) { updates.push('is_enabled = ?'); params.push(is_enabled); }

    if (rule_set_name !== undefined && !normalizeRuleSetName(rule_set_name)) {
      throw new Error('规则集名称不能为空');
    }
    if (stages !== undefined) {
      validateStages(stages);
    }

    if (updates.length > 0) {
      updates.push('updated_by = ?');
      params.push(userId);
      params.push(id);
      await this.db.execute(
        `UPDATE app_current_feature_rule_sets SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    if (is_default) {
      await this.db.execute(
        `UPDATE app_current_feature_rule_sets SET is_default = b'0' WHERE id != ?`,
        [id]
      );
    }

    if (stages !== undefined) {
      await this.db.execute(
        `DELETE FROM app_current_feature_rule_stages WHERE rule_set_id = ?`,
        [id]
      );
      for (let index = 0; index < stages.length; index++) {
        await this.createStage(id, normalizeStage(stages[index], index));
      }
    }

    return this.getById(id, true);
  }

  async createStage(ruleSetId, stage) {
    const id = Utils.newID();
    await this.db.execute(`
      INSERT INTO app_current_feature_rule_stages
      (id, rule_set_id, stage_code, stage_name, stage_order, stage_color, semantic_definition)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id, ruleSetId,
      stage.stage_code || '',
      stage.stage_name || '',
      stage.stage_order ?? 0,
      stage.stage_color || '',
      stage.semantic_definition || '',
    ]);
    return id;
  }

  async remove(id) {
    await this.db.execute(`DELETE FROM app_current_feature_rule_stages WHERE rule_set_id = ?`, [id]);
    await this.db.execute(`DELETE FROM app_current_feature_rule_sets WHERE id = ?`, [id]);
    return true;
  }

  async copy(id, userId) {
    const source = await this.getById(id, true);
    if (!source) throw new Error('Rule set not found');

    const newData = {
      rule_set_name: `${source.rule_set_name} (副本)`,
      description: source.description,
      is_default: false,
      is_enabled: true,
      stages: (source.stages || []).map(s => ({
        stage_code: s.stage_code,
        stage_name: s.stage_name,
        stage_order: s.stage_order,
        stage_color: s.stage_color,
        semantic_definition: s.semantic_definition,
      })),
    };

    return this.create(newData, userId);
  }

  async setDefault(id) {
    await this.db.execute(`UPDATE app_current_feature_rule_sets SET is_default = b'0'`);
    await this.db.execute(`UPDATE app_current_feature_rule_sets SET is_default = b'1' WHERE id = ?`, [id]);
    return true;
  }

  // 兼容方法别名 - 适配 handler 调用
  async listRuleSets() {
    return this.list();
  }

  async getRuleSet(id) {
    return this.getById(id, true);
  }

  async createRuleSet(data) {
    const userId = data.created_by || data.userId || 'system';
    return this.create(data, userId);
  }

  async updateRuleSet(id, data) {
    const userId = data.updated_by || data.userId || 'system';
    return this.update(id, data, userId);
  }

  async deleteRuleSet(id) {
    return this.remove(id);
  }
}

export default RuleSetService;
