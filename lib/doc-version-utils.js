/**
 * doc-version-utils.js — 文档版本统一工具
 *
 * 职责：
 *   1. 版本列表排序（年份优先 → 版号次之 → 上传时间兜底）
 *   2. 当前版本解析（用户指定优先 → 排序后取最新）
 *   3. revision_label 唯一性校验
 *   4. 默认 revision_label 生成
 *
 * 这是文档平台版本语义的**唯一收口点**。
 * 所有需要"当前版本"或"版本排序"的地方必须走这里的函数，
 * 禁止在控制器、前端、或上层业务中各自重复实现。
 */

import logger from './logger.js';

/**
 * 尝试从 revision_label 中提取年份
 * 支持格式：2012、2012版、2012年、v2012 等
 * @param {string} label
 * @returns {number|null} 提取到的年份（4位数字），或 null
 */
function extractYear(label) {
  if (!label || typeof label !== 'string') return null;
  const match = label.match(/(\d{4})/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  // 只接受合理年份范围：1900-2099
  if (year >= 1900 && year <= 2099) return year;
  return null;
}

/**
 * 尝试从 revision_label 中提取版本编号
 * 支持格式：v1、v2.0、v3.1、1.0、2 等
 * @param {string} label
 * @returns {number|null} 提取到的版本号，或 null
 */
function extractVersionNumber(label) {
  if (!label || typeof label !== 'string') return null;
  // 匹配 "v1" "v1.0" "1.0" "1" 等
  const match = label.match(/^v?(\d+)(?:\.(\d+))?$/i);
  if (!match) return null;
  const major = parseInt(match[1], 10);
  const minor = match[2] ? parseInt(match[2], 10) : 0;
  return major * 1000 + minor; // 合并为可比较数字
}

/**
 * 版本排序比较函数
 *
 * 排序规则（按优先级）：
 *   1. 若双方都有可识别年份 → 按年份降序（最新在前）
 *   2. 若双方都有可识别版号 → 按版号降序（最新在前）
 *   3. 否则 → 按 created_at 降序（最新在前）
 *
 * 注意：这是展示与默认选择规则，不是系统对版本事实的重新解释。
 * 一旦排序结果不稳定，调用方应退回人工指定。
 *
 * @param {Object} a - 版本对象（需含 revision_label, revision_no, created_at）
 * @param {Object} b - 版本对象
 * @returns {number} 比较结果：<0 表示 a 排在 b 前面（即 a 更新）
 */
export function compareRevisions(a, b) {
  const yearA = extractYear(a.revision_label);
  const yearB = extractYear(b.revision_label);

  // 双方都有年份 → 按年份降序
  if (yearA !== null && yearB !== null && yearA !== yearB) {
    return yearB - yearA;
  }

  // 单方有年份 → 有年份的优先
  if (yearA !== null && yearB === null) return -1;
  if (yearB !== null && yearA === null) return 1;

  // 双方都没有年份 → 尝试按版号排序
  const verA = extractVersionNumber(a.revision_label);
  const verB = extractVersionNumber(b.revision_label);

  if (verA !== null && verB !== null && verA !== verB) {
    return verB - verA;
  }

  // 单方有版号 → 有版号的优先
  if (verA !== null && verB === null) return -1;
  if (verB !== null && verA === null) return 1;

  // 兜底：按 revision_no 降序
  if (a.revision_no !== b.revision_no) {
    return b.revision_no - a.revision_no;
  }

  // 最终兜底：按创建时间降序
  const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
  const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
  return timeB - timeA;
}

/**
 * 对版本列表排序（返回新数组，不修改原数组）
 *
 * @param {Array} revisions - 版本对象数组
 * @returns {Array} 排序后的新数组
 */
export function sortRevisionList(revisions) {
  if (!Array.isArray(revisions) || revisions.length === 0) return [];
  return [...revisions].sort(compareRevisions);
}

/**
 * 解析文档的"当前版本"
 *
 * 规则：
 *   1. 若 document.current_revision_id 已设置且该版本存在于列表中 → 返回该版本
 *   2. 否则 → 对版本列表排序后返回第一个（最新）
 *   3. 若列表为空 → 返回 null
 *
 * @param {Object} document - 文档对象（含 current_revision_id）
 * @param {Array} revisions - 版本列表
 * @returns {Object|null} 当前版本对象，或 null
 */
export function resolveCurrentRevision(document, revisions) {
  if (!document || !Array.isArray(revisions) || revisions.length === 0) return null;

  // 用户已指定当前版本
  if (document.current_revision_id) {
    const specified = revisions.find(r => r.id === document.current_revision_id);
    if (specified) return specified;

    logger.warn(
      `[doc-version-utils] current_revision_id ${document.current_revision_id} not found in revision list for document ${document.id}, falling back to latest`
    );
  }

  // 回退到排序后的第一个
  const sorted = sortRevisionList(revisions);
  return sorted[0] || null;
}

/**
 * 解析文档的"当前版本 ID"（轻量版，仅返回 ID）
 *
 * @param {Object} document - 文档对象（含 id, current_revision_id）
 * @param {Array} revisions - 版本列表（至少含 id, revision_label, created_at）
 * @returns {string|null} 当前版本 ID，或 null
 */
export function resolveCurrentRevisionId(document, revisions) {
  const current = resolveCurrentRevision(document, revisions);
  return current ? current.id : null;
}

/**
 * 校验 revision_label 在同一 doc_id 下的唯一性
 *
 * @param {Array} existingRevisions - 已有的版本列表
 * @param {string} label - 要校验的 label
 * @param {string} [excludeRevisionId] - 排除的版本 ID（用于编辑场景）
 * @returns {{ valid: boolean, message?: string }} 校验结果
 */
export function validateRevisionLabelUniqueness(existingRevisions, label, excludeRevisionId) {
  if (!label || typeof label !== 'string' || !label.trim()) {
    return { valid: false, message: '版本号不能为空' };
  }

  const trimmed = label.trim();

  const duplicate = existingRevisions.find(
    r => r.revision_label === trimmed && r.id !== excludeRevisionId
  );

  if (duplicate) {
    return {
      valid: false,
      message: `版本号 "${trimmed}" 已存在（版本 ID: ${duplicate.id}），同一文档下版本号必须唯一`,
    };
  }

  return { valid: true };
}

/**
 * 为已有版本列表生成下一个默认 revision_label
 *
 * 规则：
 *   1. 若已有版本明显是年份体系（超过半数 label 含年份语义），
 *      返回 null 表示应由用户手动填写，避免混入 vN 破坏命名体系
 *   2. 扫描已有 label，找出最大 v{n} 编号 → 返回 v{n+1}
 *   3. 若所有 label 均为非标准格式，返回 v1
 *
 * @param {Array} existingRevisions - 版本列表（至少含 revision_label）
 * @returns {string|null} 生成的默认 label，若为年份体系则返回 null
 */
export function generateDefaultRevisionLabel(existingRevisions) {
  if (!Array.isArray(existingRevisions) || existingRevisions.length === 0) {
    return 'v1';
  }

  // 检测是否为年份体系：超过半数已有 label 包含年份语义
  const yearLabels = existingRevisions.filter(r => extractYear(r.revision_label) !== null);
  if (yearLabels.length > 0 && yearLabels.length >= existingRevisions.length / 2) {
    // 年份体系 — 不应自动生成 vN，返回 null 让调用方提示用户手动填写
    logger.warn(
      `[doc-version-utils] Year-based version system detected (${yearLabels.length}/${existingRevisions.length} labels have year semantic). ` +
      'Default label generation skipped — user should provide year manually.'
    );
    return null;
  }

  let maxN = 0;
  for (const rev of existingRevisions) {
    const num = extractVersionNumber(rev.revision_label);
    if (num !== null) {
      // 还原为纯编号（去掉 minor 偏移）
      const major = Math.floor(num / 1000);
      if (major > maxN) maxN = major;
    }
  }

  return `v${maxN + 1}`;
}

/**
 * 判断版本 label 是否包含年份语义
 *
 * @param {string} label
 * @returns {boolean}
 */
export function hasYearSemantic(label) {
  return extractYear(label) !== null;
}

export default {
  compareRevisions,
  sortRevisionList,
  resolveCurrentRevision,
  resolveCurrentRevisionId,
  validateRevisionLabelUniqueness,
  generateDefaultRevisionLabel,
  hasYearSemantic,
  extractYear,
  extractVersionNumber,
};
