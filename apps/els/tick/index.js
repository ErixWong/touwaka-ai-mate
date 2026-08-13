/**
 * ELS app tick — 由平台 AppClock 周期唤醒
 *
 * 职责：扫描所有 processing 状态的学习材料并异步加工
 * （敏感词过滤 → 难度分级 → 模板化小测 → 置为 ready）
 *
 * 说明：创建材料（POST /api/apps/els/materials）后材料停留在 processing，
 * 由本 tick 驱动状态前进，享受平台治理（防并发重入、失败冷却、重启中断恢复）。
 */

import logger from '../../../lib/logger.js';
import MaterialProcessorService from '../server/services/material-processor.service.js';

export async function tick(context) {
  const { db } = context;

  const processor = new MaterialProcessorService(db);

  const results = await processor.reprocessAllPending();

  logger.info(`[ELS] tick processed ${results.length} pending materials`);

  return {
    processed: results.length,
    details: results,
  };
}

export default { tick };
