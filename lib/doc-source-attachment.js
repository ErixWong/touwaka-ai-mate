/**
 * doc-source-attachment — 原始上传文件附件查询 helper
 *
 * 封装 "获取文档原始上传文件附件" 的查询逻辑，统一 `source_tag='doc-platform'`
 * 语义。所有消费点（controller、service）应通过此 helper 获取 source_attachment，
 * 而不是手写重复查询条件。
 *
 * 语义约定：
 *   - source_attachment 专指用户上传的原始文件
 *   - 不包含 OCR / Clean 产物附件（它们走 `doc-platform-ocr` 或 `doc_ocr_results.*_attachment_id` 通道）
 *
 * 使用方式：
 *   import { getSourceAttachment, getSourceAttachments } from './doc-source-attachment.js';
 *   const att = await getSourceAttachment(db, revisionId, { attributes: ... });
 *   const atts = await getSourceAttachments(db, revisionIds, { attributes: ... });
 */

/**
 * 按单个 revision ID 获取原始上传文件附件
 *
 * @param {Object} db - 数据库实例（需提供 getModel 方法）
 * @param {string} revisionId - document_revision 的 ID
 * @param {Object} [options]
 * @param {string[]} [options.attributes] - 要查询的 attachment 字段
 * @returns {Promise<Object|null>} attachment 记录（raw: true）
 */
export async function getSourceAttachment(db, revisionId, options = {}) {
  if (!revisionId) return null;
  const Attachment = db.getModel('attachment');
  const attrs = options.attributes || ['id', 'file_name', 'mime_type', 'file_size', 'access_level', 'source_tag', 'source_id', 'created_by', 'created_at'];
  return await Attachment.findOne({
    where: { source_tag: 'doc-platform', source_id: revisionId },
    attributes: attrs,
    order: [['created_at', 'ASC']],
    raw: true,
  });
}

/**
 * 按多个 revision ID 批量获取原始上传文件附件
 *
 * 返回值是一个 Map<revision_id, attachment>（当同 revision 有多个附件时只保留最早的）
 *
 * @param {Object} db - 数据库实例
 * @param {string[]} revisionIds - document_revision ID 列表
 * @param {Object} [options]
 * @param {string[]} [options.attributes] - 要查询的 attachment 字段
 * @returns {Promise<Map<string, Object>>} revision_id → attachment
 */
export async function getSourceAttachments(db, revisionIds, options = {}) {
  const { Op } = await import('sequelize');
  if (!revisionIds || revisionIds.length === 0) return new Map();
  const Attachment = db.getModel('attachment');
  const attrs = options.attributes || ['id', 'file_name', 'mime_type', 'file_size', 'source_id', 'created_at'];
  const rows = await Attachment.findAll({
    where: { source_tag: 'doc-platform', source_id: { [Op.in]: revisionIds } },
    attributes: attrs,
    order: [['created_at', 'ASC']],
    raw: true,
  });
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.source_id)) {
      map.set(r.source_id, r);
    }
  }
  return map;
}
