/**
 * Doc Access Service - 文档统一权限判定
 *
 * 文档权限由所属 Collection 的 visibility 决定。
 * 读取: 文档可被用户读取 = 文档所属集合对该用户可见
 * 写入: 仅文档 owner
 */
import logger from './logger.js';
import { Op } from 'sequelize';

class DocAccessService {
  constructor(db) {
    this.db = db;
  }

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

  async getAccessibleCollectionIds(userId) {
    const lineage = await this.getUserDepartmentLineage(userId);
    const ownDeptId = lineage.length > 0 ? lineage[lineage.length - 1] : null;

    const DocCollection = this.db.getModel('document_collection');
    const conditions = [{ owner_id: userId }, { visibility: 'public' }];
    if (ownDeptId && lineage.length > 0) {
      conditions.push({ visibility: 'department', department_id: { [Op.in]: lineage } });
    }

    const collections = await DocCollection.findAll({
      where: { [Op.or]: conditions },
      attributes: ['id'],
      raw: true,
    });
    return collections.map(c => c.id);
  }

  async buildAccessFilter(userId) {
    const collectionIds = await this.getAccessibleCollectionIds(userId);
    return { collection_id: { [Op.in]: collectionIds } };
  }

  async canRead(documentId, userId) {
    const Document = this.db.getModel('document');
    const doc = await Document.findOne({
      where: {
        id: documentId,
        ...await this.buildAccessFilter(userId),
      },
    });
    return !!doc;
  }

  async canWrite(documentId, userId) {
    const Document = this.db.getModel('document');
    const DocumentCollection = this.db.getModel('document_collection');
    const doc = await Document.findOne({
      where: { id: documentId },
      include: [{ model: DocumentCollection, as: 'collection', attributes: ['owner_id'] }],
    });
    return doc && doc.collection && doc.collection.owner_id === userId;
  }

  async canApprove(documentId, userId) {
    return await this.canWrite(documentId, userId);
  }

  async canAdmin(documentId, userId) {
    return await this.canWrite(documentId, userId);
  }
}

export default DocAccessService;
