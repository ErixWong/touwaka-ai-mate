/**
 * Doc Compare Executor - 文档比对执行器
 *
 * 异步执行比任务，从 pending 状态逐步推进到 completed/failed
 */

import logger from './logger.js';

class DocCompareExecutor {
  constructor(db) {
    this.db = db;
    this.models = {};
  }

  ensureModels() {
    if (!this.models.DocCompareRun) {
      this.models.DocCompareRun = this.db.getModel('doc_compare_run');
      this.models.DocCompareItem = this.db.getModel('doc_compare_item');
      this.models.DocChunk = this.db.getModel('document_chunk');
      this.models.DocVersion = this.db.getModel('document_revision');
    }
  }

  /**
   * 执行指定比对任务
   */
  async execute(runId) {
    this.ensureModels();
    const run = await this.models.DocCompareRun.findByPk(runId);
    if (!run) {
      logger.error(`[CompareExecutor] Run not found: ${runId}`);
      return;
    }
    if (run.status !== 'pending') {
      logger.warn(`[CompareExecutor] Run ${runId} already ${run.status}`);
      return;
    }

    const startTime = Date.now();
    try {
      await run.update({ status: 'processing' });

      const baseUnits = await this.models.DocChunk.findAll({
        where: { revision_id: run.base_version_id },
        order: [['seq', 'ASC']],
      });
      const targetUnits = await this.models.DocChunk.findAll({
        where: { revision_id: run.target_version_id },
        order: [['seq', 'ASC']],
      });

      const items = this.compareUnits(baseUnits, targetUnits);

      for (const item of items) {
        await this.models.DocCompareItem.create({
          id: this.generateId(),
          run_id: run.id,
          base_unit_id: item.base_unit_id || null,
          target_unit_id: item.target_unit_id || null,
          change_type: item.change_type,
          summary: item.summary || null,
          risk_level: item.risk_level || null,
          key_changes_json: item.key_changes || null,
        });
      }

      const summary = {
        total: items.length,
        identical: items.filter(i => i.change_type === 'identical').length,
        modified: items.filter(i => i.change_type === 'modified').length,
        semantic_change: items.filter(i => i.change_type === 'semantic_change').length,
        added: items.filter(i => i.change_type === 'added').length,
        removed: items.filter(i => i.change_type === 'removed').length,
      };

      await run.update({
        status: 'completed',
        summary_json: summary,
        duration_ms: Date.now() - startTime,
      });

      logger.info(`[CompareExecutor] Run ${runId} completed:`, summary);
    } catch (error) {
      logger.error(`[CompareExecutor] Run ${runId} failed:`, error);
      await run.update({
        status: 'failed',
        summary_json: { error: error.message },
        duration_ms: Date.now() - startTime,
      });
    }
  }

  compareUnits(baseUnits, targetUnits) {
    const items = [];
    const baseMap = new Map(baseUnits.map(u => [u.seq, u]));
    const targetMap = new Map(targetUnits.map(u => [u.seq, u]));

    const allPositions = new Set([
      ...baseMap.keys(),
      ...targetMap.keys(),
    ]);

    for (const seq of [...allPositions].sort((a, b) => a - b)) {
      const base = baseMap.get(seq);
      const target = targetMap.get(seq);

      if (base && target) {
        const isIdentical = base.title === target.title && base.content === target.content;
        items.push({
          base_unit_id: base.id,
          target_unit_id: target.id,
          change_type: isIdentical ? 'identical' : 'modified',
          summary: isIdentical ? null : this.getDiffSummary(base, target),
          risk_level: isIdentical ? 'none' : this.assessRisk(base, target),
          key_changes: isIdentical ? null : {
            title_changed: base.title !== target.title,
            content_changed: base.content !== target.content,
          },
        });
      } else if (base && !target) {
        items.push({
          base_unit_id: base.id,
          change_type: 'removed',
          summary: `Removed: ${base.title || '(no title)'}`,
          risk_level: 'medium',
        });
      } else if (!base && target) {
        items.push({
          target_unit_id: target.id,
          change_type: 'added',
          summary: `Added: ${target.title || '(no title)'}`,
          risk_level: 'low',
        });
      }
    }

    return items;
  }

  getDiffSummary(base, target) {
    const changes = [];
    if (base.title !== target.title) {
      changes.push(`Title: "${base.title}" → "${target.title}"`);
    }
    if (base.content !== target.content) {
      const baseLen = base.content?.length || 0;
      const targetLen = target.content?.length || 0;
      changes.push(`Content length: ${baseLen} → ${targetLen}`);
    }
    return changes.join('; ') || 'Modified';
  }

  assessRisk(base, target) {
    if (!base.content && target.content) return 'low';
    if (base.content && !target.content) return 'high';
    if (base.title !== target.title && base.content !== target.content) return 'high';
    if (base.content !== target.content) return 'medium';
    return 'low';
  }

  /**
   * 取出所有 pending 任务并执行
   */
  async processPending() {
    this.ensureModels();
    const pendingRuns = await this.models.DocCompareRun.findAll({
      where: { status: 'pending' },
      order: [['created_at', 'ASC']],
      limit: 10,
    });
    for (const run of pendingRuns) {
      await this.execute(run.id);
    }
  }

  generateId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 20; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }
}

export default DocCompareExecutor;
