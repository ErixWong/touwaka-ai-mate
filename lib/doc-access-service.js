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
import { Op } from 'sequelize';
import CollectionAccessService from './collection-access-service.js';

class DocAccessService {
  constructor(db) {
    this.db = db;
    // 权限语义单一实现：可见性判定统一委托 CollectionAccessService（集合层权威）。
    // 历史实现自建部门可见性规则时遗漏 department_scope 判定，导致
    // scope=self 的上游部门集合被下级部门用户越权读取（task-20260814 审计 P0-1.1）。
    this.collectionAccessService = new CollectionAccessService(db);
  }

  /**
   * 获取用户可访问的集合 ID 列表
   *
   * 文档权限 = 所属集合权限。可见性规则唯一来源是
   * CollectionAccessService.buildAccessibleCollectionsWhere()：
   *   - owner（admin，任何 visibility）
   *   - public
   *   - department + department_scope='self'（仅集合本部门）
   *   - department + department_scope='self_and_descendants'（集合部门及其下级）
   */
  async getAccessibleCollectionIds(userId) {
    const where = await this.collectionAccessService.buildAccessibleCollectionsWhere(userId);
    const DocCollection = this.db.getModel('document_collection');
    const collections = await DocCollection.findAll({
      where,
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
