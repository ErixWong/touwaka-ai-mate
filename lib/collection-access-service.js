/**
 * Collection Access Service - 文档集合可见性/权限判定
 *
 * 实现 PRD §4 定义的访问模型：
 * 1. owner_id → admin
 * 2. visibility 判定 (private/department/public)
 * 3. department_scope 部门拓展判定
 *
 * department_scope 语义：
 *   self: 仅集合 department_id 本部门可读
 *   self_and_descendants: 集合 department_id 及其下级部门可读
 */

import logger from './logger.js';
import { Op } from 'sequelize';

class CollectionAccessService {
  constructor(db) {
    this.db = db;
  }

  /**
   * 获取用户部门祖先链路 ID 列表（自身 + 所有上级部门）
   * 路径如 /1/2/3 → [3, 2, 1]
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

      const segments = dept.path.split('/').filter(Boolean);
      return segments;
    } catch (error) {
      logger.error('[CollectionAccess] getUserDepartmentLineage error:', error);
      return [];
    }
  }

  /**
   * 构建用户可访问集合的查询条件
   */
  async buildAccessibleCollectionsWhere(userId) {
    const conditions = [];

    conditions.push({ owner_id: userId });

    const lineage = await this.getUserDepartmentLineage(userId);
    const ownDeptId = lineage.length > 0 ? lineage[lineage.length - 1] : null;

    if (ownDeptId) {
      conditions.push({
        visibility: 'department',
        department_scope: 'self_and_descendants',
        department_id: { [Op.in]: lineage },
      });
      conditions.push({
        visibility: 'department',
        department_scope: 'self',
        department_id: ownDeptId,
      });
    }

    conditions.push({ visibility: 'public' });

    return { [Op.or]: conditions };
  }

  /**
   * 检查用户对集合的访问权
   * 返回 'admin' | 'read' | null
   */
  async checkAccess(collectionId, userId) {
    try {
      const DocCollection = this.db.getModel('doc_collection');
      const collection = await DocCollection.findOne({
        where: { id: collectionId },
        raw: true,
      });
      if (!collection) return null;

      if (collection.owner_id === userId) return 'admin';

      if (collection.visibility === 'public') return 'read';

      if (collection.visibility === 'department') {
        const lineage = await this.getUserDepartmentLineage(userId);
        const ownDeptId = lineage.length > 0 ? lineage[lineage.length - 1] : null;

        if (collection.department_scope === 'self' || !collection.department_scope) {
          if (ownDeptId === collection.department_id) {
            return 'read';
          }
        } else if (collection.department_scope === 'self_and_descendants') {
          if (lineage.includes(collection.department_id)) {
            return 'read';
          }
        }
      }

      return null;
    } catch (error) {
      logger.error('[CollectionAccess] checkAccess error:', error);
      return null;
    }
  }

  /**
   * 检查读权限
   */
  async canRead(collectionId, userId) {
    const access = await this.checkAccess(collectionId, userId);
    return access !== null;
  }

  /**
   * 检查写/管理权限（仅 owner）
   */
  async canWrite(collectionId, userId) {
    const access = await this.checkAccess(collectionId, userId);
    return access === 'admin';
  }
}

export default CollectionAccessService;
