/**
 * Doc Access Service - 文档统一权限判定
 *
 * === 架构原则：唯一硬权限边界 ===
 * 本文档访问服务是系统中判断"用户能否访问某文档/集合"的唯一权威来源。
 * 所有文档检索、搜索、召回操作必须通过此服务获取用户可访问集合列表，
 * 不依赖任何其他配置层（如 knowledge_config、专家集合边界等）做权限判定。
 *
 * 权限规则：
 * - 文档权限由所属 Collection 的 visibility 决定。
 * - 读取: 文档可被用户读取 = 文档所属集合对该用户可见
 * - 写入: 仅文档 owner
 * - 可见性判断维度：owner_id、visibility（public/department）、部门归属
 *
 * 消费方：
 * - DocumentSearchService: 文档候选检索时的集合过滤
 * - DocRecallService: chunk 召回时的集合范围约束
 * - document_retrieval tool: 文档检索 skill 的权限边界
 * - doc.controller: 文档列表/详情接口的权限控制
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
