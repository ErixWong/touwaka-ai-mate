/**
 * Doc Access Service - 文档统一权限判定
 *
 * 提供文档读/写/审批/管理权限的统一入口。
 * 当前阶段：owner/visibility 基础判断 + doc_permissions ACL（有数据时生效）。
 */

import logger from './logger.js';
import { Op } from 'sequelize';

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
   * 获取用户部门祖先链路 ID 列表（自身 + 所有上级部门）
   */
  async getUserDepartmentLineage(userId) {
    try {
      const User = this.db.getModel('user');
      const user = await User.findOne({
        where: { id: userId },
        attributes: ['department_id'],
        raw: true,
      });
      if (!user?.department_id) return [];

      const Department = this.db.getModel('department');
      const dept = await Department.findOne({
        where: { id: user.department_id },
        attributes: ['id', 'path'],
        raw: true,
      });
      if (!dept) return [user.department_id];

      return dept.path.split('/').filter(Boolean);
    } catch (error) {
      logger.error('[DocAccess] getUserDepartmentLineage error:', error);
      return [];
    }
  }

  /**
   * 构建查询过滤条件（可见性 + 所有者 + 部门血缘）
   */
  async buildAccessFilter(userId) {
    const lineage = await this.getUserDepartmentLineage(userId);

    const conditions = [
      { owner_id: userId },
      { visibility: 'public' },
    ];

    if (lineage.length > 0) {
      conditions.push({
        visibility: 'department',
        department_id: { [Op.in]: lineage },
      });
    }

    return { [Op.or]: conditions };
  }

  /**
   * 检查单个文档的读取权限
   * 策略：owner/visibility 基础判断 + doc_permissions ACL（有数据时生效）
   */
  async canRead(documentId, userId) {
    const DocDoc = this.db.getModel('doc_document');
    const doc = await DocDoc.findOne({
      where: {
        id: documentId,
        ...await this.buildAccessFilter(userId),
      },
    });
    if (!doc) return false;

    this.ensureModels();
    const acl = await this.models.DocPermission.findOne({
      where: {
        document_id: documentId,
        subject_type: 'user',
        subject_id: userId,
        permission_type: 'read',
      },
    });
    if (acl) return true;

    return true;
  }

  /**
   * 检查单个文档的写权限（owner + ACL）
   */
  async canWrite(documentId, userId) {
    const DocDoc = this.db.getModel('doc_document');
    const doc = await DocDoc.findOne({
      where: { id: documentId, owner_id: userId },
    });
    if (doc) return true;

    this.ensureModels();
    const acl = await this.models.DocPermission.findOne({
      where: {
        document_id: documentId,
        subject_type: 'user',
        subject_id: userId,
        permission_type: 'write',
      },
    });
    return !!acl;
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
