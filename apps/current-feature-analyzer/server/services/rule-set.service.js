import Utils from '../../../../lib/utils.js';
import logger from '../../../../lib/logger.js';

class RuleSetService {
  constructor(db) {
    this.db = db;
  }

  async list() {
    const sets = await this.db.query(`
      SELECT id, rule_set_name, description, is_default, is_enabled, created_at, updated_at
      FROM app_current_feature_rule_sets
      ORDER BY is_default DESC, created_at DESC
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
        ...s,
        required: s.required ? !!s.required[0] : true,
        allow_repeat: s.allow_repeat ? !!s.allow_repeat[0] : false,
        allow_overlap: s.allow_overlap ? !!s.allow_overlap[0] : false,
      }));
    }

    return ruleSet;
  }

  async create(data, userId) {
    const id = Utils.newID();
    const {
      rule_set_name,
      description = '',
      business_context = '',
      prompt_template = '',
      output_json_schema = '',
      llm_instructions = '',
      is_default = false,
      is_enabled = true,
      stages = [],
    } = data;

    if (is_default) {
      await this.db.execute(
        `UPDATE app_current_feature_rule_sets SET is_default = b'0'`
      );
    }

    await this.db.execute(`
      INSERT INTO app_current_feature_rule_sets
      (id, rule_set_name, description, business_context, prompt_template,
       output_json_schema, llm_instructions, is_default, is_enabled, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, rule_set_name, description, business_context, prompt_template,
      output_json_schema, llm_instructions, is_default, is_enabled, userId,
    ]);

    for (const stage of stages) {
      await this.createStage(id, stage);
    }

    return this.getById(id, true);
  }

  async update(id, data, userId) {
    const {
      rule_set_name,
      description,
      business_context,
      prompt_template,
      output_json_schema,
      llm_instructions,
      is_default,
      is_enabled,
      stages,
    } = data;

    const updates = [];
    const params = [];

    if (rule_set_name !== undefined) { updates.push('rule_set_name = ?'); params.push(rule_set_name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (business_context !== undefined) { updates.push('business_context = ?'); params.push(business_context); }
    if (prompt_template !== undefined) { updates.push('prompt_template = ?'); params.push(prompt_template); }
    if (output_json_schema !== undefined) { updates.push('output_json_schema = ?'); params.push(output_json_schema); }
    if (llm_instructions !== undefined) { updates.push('llm_instructions = ?'); params.push(llm_instructions); }
    if (is_default !== undefined) { updates.push('is_default = ?'); params.push(is_default); }
    if (is_enabled !== undefined) { updates.push('is_enabled = ?'); params.push(is_enabled); }

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
      for (const stage of stages) {
        await this.createStage(id, stage);
      }
    }

    return this.getById(id, true);
  }

  async createStage(ruleSetId, stage) {
    const id = Utils.newID();
    await this.db.execute(`
      INSERT INTO app_current_feature_rule_stages
      (id, rule_set_id, stage_code, stage_name, stage_order,
       semantic_definition, expected_signal_features,
       required, allow_repeat, allow_overlap,
       min_duration_ms, max_duration_ms, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, ruleSetId,
      stage.stage_code || '',
      stage.stage_name || '',
      stage.stage_order ?? 0,
      stage.semantic_definition || '',
      stage.expected_signal_features || null,
      stage.required !== false,
      stage.allow_repeat ?? false,
      stage.allow_overlap ?? false,
      stage.min_duration_ms ?? null,
      stage.max_duration_ms ?? null,
      stage.notes ?? null,
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
      business_context: source.business_context,
      prompt_template: source.prompt_template,
      output_json_schema: source.output_json_schema,
      llm_instructions: source.llm_instructions,
      is_default: false,
      is_enabled: true,
      stages: (source.stages || []).map(s => ({
        stage_code: s.stage_code,
        stage_name: s.stage_name,
        stage_order: s.stage_order,
        semantic_definition: s.semantic_definition,
        expected_signal_features: s.expected_signal_features,
        required: s.required,
        allow_repeat: s.allow_repeat,
        allow_overlap: s.allow_overlap,
        min_duration_ms: s.min_duration_ms,
        max_duration_ms: s.max_duration_ms,
        notes: s.notes,
      })),
    };

    return this.create(newData, userId);
  }

  async setDefault(id) {
    await this.db.execute(`UPDATE app_current_feature_rule_sets SET is_default = b'0'`);
    await this.db.execute(`UPDATE app_current_feature_rule_sets SET is_default = b'1' WHERE id = ?`, [id]);
    return true;
  }
}

export default RuleSetService;
