/**
 * Doc Access Service - 文档统一权限判定
 *
 * 提供文档读/写/审批/管理权限的统一入口。
 * 当前阶段：owner/visibility/org 过滤。
 * ACL 阶段（后续）：叠加 doc_permissions 表。
 */

import logger from './logger.js';

class DocAccessService {
  constructor(db) {
    this.db = db;
    this.models = {};
  }

  ensureModels() {
    if (!this.models.DocPermission) {
      this.models.DocPermission = this.db.getModel('doc_permission');
    }
  }

  /**
   * 构建查询过滤条件（可见性 + 所有者）
   */
  buildAccessFilter(userId, orgId) {
    return {
      [this.db.Sequelize.Op.or]: [
        { owner_id: userId },
        { visibility: 'public' },
        { org_id: orgId, visibility: 'org' },
      ],
    };
  }

  /**
   * 检查单个文档的读取权限
   */
  async canRead(documentId, userId, orgId) {
    const DocDoc = this.db.getModel('doc_document');
    const doc = await DocDoc.findOne({
      where: {
        id: documentId,
        ...this.buildAccessFilter(userId, orgId),
      },
    });
    return !!doc;
  }

  /**
   * 检查单个文档的写权限
   */
  async canWrite(documentId, userId) {
    const DocDoc = this.db.getModel('doc_document');
    const doc = await DocDoc.findOne({
      where: { id: documentId, owner_id: userId },
    });
    return !!doc;
  }

  /**
   * 检查单个文档的审批权限（owner + 未来ACL）
   */
  async canApprove(documentId, userId) {
    return await this.canWrite(documentId, userId);
  }

  /**
   * 检查单个文档的管理权限
   */
  async canAdmin(documentId, userId) {
    return await this.canWrite(documentId, userId);
  }
}

export default DocAccessService;
