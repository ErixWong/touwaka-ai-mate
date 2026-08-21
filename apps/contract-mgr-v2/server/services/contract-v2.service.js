import logger from '../../../../lib/logger.js';
import Utils from '../../../../lib/utils.js';
import { Op, Transaction } from 'sequelize';
import modelRegistry from '../../../../lib/model-registry.js';
import DocumentIntakeService from '../../../../lib/document-intake.service.js';
import CollectionAccessService from '../../../../lib/collection-access-service.js';
import { buildPaginatedResponse } from '../../../../lib/query-builder.js';

const VALID_NODE_TYPES = ['group', 'party', 'project'];
const APP_ID = 'contract-mgr-v2';

class ContractV2Service {
  constructor(db) {
    this.db = db;
    this.models = {};
    this.Attachment = null;
    this._contractTypeConfig = null;
  }

  ensureModels() {
    if (this.models.OrgNode) return;

    this.models.OrgNode = this.db.getModel('contract_v2_org_node');
    this.models.MainRecord = this.db.getModel('contract_v2_main_record');
    this.models.Version = this.db.getModel('contract_v2_version');

    // Lazy-load Attachment model
    if (!this.Attachment) {
      try {
        this.Attachment = this.db.getModel('attachment');
      } catch (e) {
        logger.warn('[ContractV2Service] Attachment model not available');
      }
    }
  }

  async ensureContractOwner(contractId, userId) {
    this.ensureModels();
    const contract = await this.models.MainRecord.findByPk(contractId, { raw: true });
    if (!contract) throw new Error('合同不存在');
    if (contract.created_by !== userId) throw new Error('无权限操作该合同');
    return contract;
  }

  async ensureVersionOwner(versionId, userId) {
    this.ensureModels();
    const rows = await this.db.sequelize.query(
      `SELECT id, contract_id, row_id, file_id, document_id, revision_id, version_number,
              version_name, version_type, version_status, effective_date, expiry_date,
              contract_number, party_a, party_b, total_amount, change_summary,
              is_current, created_by, created_at, updated_at
         FROM contract_v2_versions
        WHERE id = ?
        LIMIT 1`,
      {
        replacements: [versionId],
        type: this.db.sequelize.QueryTypes.SELECT,
        plain: true,
      }
    );
    const version = rows || null;
    if (!version) throw new Error('版本不存在');
    const contract = await this.ensureContractOwner(version.contract_id, userId);
    return { version, contract };
  }

  async getUserDepartmentId(userId) {
    const User = this.db.getModel('user');
    const user = await User.findByPk(userId, {
      attributes: ['department_id'],
      raw: true,
    });
    return user?.department_id || null;
  }

  async loadVersionsByContractIds(contractIds) {
    if (!contractIds.length) return [];

    const placeholders = contractIds.map(() => '?').join(', ');
    return await this.db.sequelize.query(
      `SELECT id, contract_id, row_id, file_id, document_id, revision_id, version_number,
              version_name, version_type, version_status, effective_date, expiry_date,
              contract_number, party_a, party_b, total_amount, change_summary,
              is_current, created_by, created_at, updated_at
         FROM contract_v2_versions
        WHERE contract_id IN (${placeholders})
        ORDER BY created_at DESC`,
      {
        replacements: contractIds,
        type: this.db.sequelize.QueryTypes.SELECT,
      }
    );
  }

  async getTree() {
    this.ensureModels();
    const nodes = await this.models.OrgNode.findAll({
      where: { is_active: 1 },
      order: [['level', 'ASC'], ['sort_order', 'ASC'], ['created_at', 'ASC']],
      raw: true,
    });

    return this.buildTree(nodes);
  }

  buildTree(nodes) {
    const map = {};
    const roots = [];

    for (const node of nodes) {
      node.children = [];
      map[node.id] = node;
    }

    for (const node of nodes) {
      if (node.parent_id && map[node.parent_id]) {
        map[node.parent_id].children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async createNode(data) {
    this.ensureModels();

    let path = '';
    let level = 1;

    if (data.parent_id) {
      const parent = await this.models.OrgNode.findByPk(data.parent_id);
      if (!parent) throw new Error('父节点不存在');
      path = parent.path + '/' + parent.id;
      level = parent.level + 1;
    }

    if (level > 3) throw new Error('最多支持3层节点');

    const nodeType = data.node_type;
    if (!VALID_NODE_TYPES.includes(nodeType)) throw new Error(`node_type 必须是 ${VALID_NODE_TYPES.join('/')}`);
    if (level === 1 && nodeType !== 'group') throw new Error('第1层只能是集团(group)');
    if (level === 2 && nodeType !== 'party') throw new Error('第2层只能是甲方(party)');
    if (level === 3 && nodeType !== 'project') throw new Error('第3层只能是项目(project)');

    const siblings = await this.models.OrgNode.count({
      where: { parent_id: data.parent_id || null },
    });

    const node = await this.models.OrgNode.create({
      id: Utils.newID(20),
      parent_id: data.parent_id || null,
      node_type: nodeType,
      name: data.name,
      path,
      level,
      sort_order: data.sort_order || siblings,
      is_active: 1,
    });

    return node.toJSON();
  }

  async updateNode(nodeId, data) {
    this.ensureModels();
    const node = await this.models.OrgNode.findByPk(nodeId);
    if (!node) throw new Error('节点不存在');

    const updates = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.sort_order !== undefined) updates.sort_order = data.sort_order;

    await node.update(updates);
    return node.toJSON();
  }

  async deleteNode(nodeId) {
    this.ensureModels();
    const node = await this.models.OrgNode.findByPk(nodeId);
    if (!node) throw new Error('节点不存在');

    await node.destroy();
  }

  async getNodeStats(nodeId) {
    this.ensureModels();
    const node = await this.models.OrgNode.findByPk(nodeId);
    if (!node) throw new Error('节点不存在');

    const directContracts = await this.models.MainRecord.count({
      where: { org_node_id: nodeId },
    });

    const descendantIds = await this.getDescendantIds(nodeId);
    const totalContracts = await this.models.MainRecord.count({
      where: { org_node_id: descendantIds },
    });

    return {
      node_id: nodeId,
      node_name: node.name,
      node_type: node.node_type,
      direct_contracts: directContracts,
      total_contracts: totalContracts,
    };
  }

  async getDescendantIds(nodeId) {
    this.ensureModels();
    const node = await this.models.OrgNode.findByPk(nodeId);
    if (!node) return [nodeId];

    const prefix = (node.path || '') + '/' + node.id;
    const escaped = prefix.replace(/[%_]/g, '\\$&');
    const descendants = await this.models.OrgNode.findAll({
      where: { path: { [Op.like]: escaped + '%' } },
      attributes: ['id'],
      raw: true,
    });

    return [nodeId, ...descendants.map(d => d.id)];
  }

  async listContracts(filters = {}, userId) {
    this.ensureModels();
    const where = { created_by: userId };

    if (filters.org_node_id) {
      if (filters.include_children) {
        const ids = await this.getDescendantIds(filters.org_node_id);
        where.org_node_id = { [Op.in]: ids };
      } else {
        where.org_node_id = filters.org_node_id;
      }
    }

    if (filters.contract_type) where.contract_type = filters.contract_type;
    if (filters.status) where.status = filters.status;

    const page = Math.max(parseInt(filters.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(filters.page_size, 10) || 20, 1), 100);
    const offset = (page - 1) * pageSize;

    const result = await this.models.MainRecord.findAndCountAll({
      where,
      order: [['updated_at', 'DESC']],
      limit: pageSize,
      offset,
      raw: true,
    });

    // 聚合每个合同的当前版本 document_id
    const contracts = result.rows;
    if (contracts.length > 0) {
      const contractIds = contracts.map(c => c.id);
      const versions = await this.loadVersionsByContractIds(contractIds);

      // 按 contract_id 分组，查找当前版本或最新版本
      const versionMap = {};
      for (const v of versions) {
        if (!versionMap[v.contract_id] || v.is_current) {
          versionMap[v.contract_id] = { document_id: v.document_id };
        }
      }

      for (const contract of contracts) {
        const v = versionMap[contract.id];
        contract.document_id = v?.document_id || null;
      }
    }

    // 复用统一分页响应构造
    const pagination = { page, size: pageSize };
    return buildPaginatedResponse({ rows: contracts, count: result.count }, pagination, Date.now());
  }

  async createContract(data, userId) {
    this.ensureModels();

    const node = await this.models.OrgNode.findByPk(data.org_node_id);
    if (!node) throw new Error('组织节点不存在');

    const contract = await this.models.MainRecord.create({
      id: Utils.newID(20),
      org_node_id: data.org_node_id,
      contract_name: data.contract_name,
      contract_type: data.contract_type || null,
      current_version_id: null,
      version_count: 0,
      status: 'draft',
      created_by: userId,
    });

    return contract.toJSON();
  }

  async getContract(contractId, userId) {
    const contract = await this.ensureContractOwner(contractId, userId);

    const versions = await this.loadVersionsByContractIds([contractId]);

    // 聚合当前版本的 document_id 和处理状态到合同 DTO
    const currentVersion = versions.find(v => v.is_current) || versions[0];
    let documentId = null;
    let processingStatus = null;

    if (currentVersion?.document_id) {
      documentId = currentVersion.document_id;
      // 查询文档平台的处理状态
      try {
        const Document = this.db.getModel('document');
        const doc = await Document.findByPk(documentId, {
          attributes: ['processing_status', 'processing_error_code'],
          raw: true
        });
        if (doc) {
          processingStatus = doc.processing_status;
        }
      } catch (e) {
        logger.warn('[ContractV2Service] Cannot fetch document status:', e.message);
      }
    }

    return {
      ...contract,
      document_id: documentId,
      processing_status: processingStatus,
      versions
    };
  }

  async updateContract(contractId, data, userId) {
    this.ensureModels();
    await this.ensureContractOwner(contractId, userId);
    const contract = await this.models.MainRecord.findByPk(contractId);

    const updates = {};
    if (data.contract_name !== undefined) updates.contract_name = data.contract_name;
    if (data.contract_type !== undefined) updates.contract_type = data.contract_type;
    if (data.status !== undefined) updates.status = data.status;

    await contract.update(updates);
    return contract.toJSON();
  }

  async deleteContract(contractId, userId) {
    this.ensureModels();
    await this.ensureContractOwner(contractId, userId);
    const contract = await this.models.MainRecord.findByPk(contractId);

    await contract.destroy();
  }

  /**
   * 获取合同类型配置（从 app config 中读取）
   */
  async getContractTypeConfig() {
    if (this._contractTypeConfig) {
      return this._contractTypeConfig;
    }
    try {
      const MiniApp = this.db.getModel('mini_app');
      const app = await MiniApp.findByPk(APP_ID, { attributes: ['config'], raw: true });
      // mini_app.config 为 TEXT 列，raw 查询返回 JSON 字符串，需解析后再读取
      let config = app?.config;
      if (typeof config === 'string') {
        try {
          config = JSON.parse(config);
        } catch {
          config = null;
        }
      }
      if (config?.contract_types) {
        this._contractTypeConfig = config.contract_types;
        return this._contractTypeConfig;
      }
    } catch (e) {
      logger.warn('[ContractV2Service] Cannot load contract type config:', e.message);
    }
    // 返回默认值
    return [
      { id: 'sales', name: '销售合同', collection_name: '销售合同', metadata_fields: ['客户', '合同名称', '合同编号', '甲方', '乙方', '生效日期', '版本号'] },
      { id: 'supply', name: '供货合同', collection_name: '供货合同', metadata_fields: ['供应商', '交货日期', '合同金额', '版本号'] }
    ];
  }

  /**
   * 根据合同类型自动获取或创建私有 collection
   * - 私有，仅 contract-mgr-v2 可访问
   * - 自动创建，无需管理员预配置
   * - 严格复用现有 document_collection 模型字段
   */
  async getOrCreateCollection(contractType, userId) {
    const types = await this.getContractTypeConfig();
    let typeConfig = types.find(t => t.id === contractType);
    if (!typeConfig) {
      // 兜底：配置缺失/未知类型时不阻断业务，回退到 other（或首个类型）
      logger.warn(`[ContractV2Service] 未知的合同类型: ${contractType}, fallback 到 other`);
      typeConfig = types.find(t => t.id === 'other') || types[0] || { id: 'other' };
    }

    // 使用“每用户 + 合同类型”维度的私有 collection，避免跨用户串用
    const collectionName = `contract_${userId}_${contractType}`;
    const DocumentCollection = this.db.getModel('document_collection');

    // 查找已存在的私有 collection（按 owner + name + visibility 查找）
    let collection = await DocumentCollection.findOne({
      where: { 
        name: collectionName,
        owner_id: userId,
        visibility: 'private'
      },
      raw: true
    });

    if (collection) {
      return collection;
    }

    let departmentId = await this.getUserDepartmentId(userId);
    if (!departmentId) {
      // 系统管理员允许无部门创建私有集合（department_id 无外键约束）
      // 产品逻辑：管理员拥有全部权限，不应被组织数据配置卡住
      const { isSystemAdmin } = await import('../../../../lib/permission-utils.js');
      if (!(await isSystemAdmin(this.db, userId))) {
        throw new Error('当前用户缺少 department_id，无法创建私有文档集合');
      }
      departmentId = 'sysadmin';
    }

    // 自动创建私有 collection，严格按照 document_collection 模型字段
    try {
      // 获取默认 embedding model
      let embeddingModelId = '';
      try {
        const embeddingConfig = await modelRegistry.getDefaultEmbeddingModelConfig();
        embeddingModelId = embeddingConfig?.id || '';
      } catch (e) {
        logger.warn('[ContractV2Service] Cannot get default embedding model:', e.message);
      }

      collection = await DocumentCollection.create({
        id: Utils.newID(),
        name: collectionName,
        description: `合同管理-${typeConfig.name}文档（私有）`,
        owner_id: userId,
        created_by: userId,
        department_id: departmentId,
        visibility: 'private',
        department_scope: 'self',
        embedding_model_id: embeddingModelId,
        metadata: JSON.stringify({ contract_type: contractType, auto_created: true })
      });

      logger.info(`[ContractV2Service] Auto-created private collection ${collection.id} for contract type ${contractType}`);
      return collection;
    } catch (createError) {
      logger.error('[ContractV2Service] Failed to create collection:', createError.message);
      throw new Error('创建文档集合失败，请稍后重试');
    }
  }

  /**
   * 创建版本（从已上传的附件）
   * 这是一个自包含方法，直接在 ContractV2Service 内完成 row_id 生成和 content 表写入，
   * 不依赖 mini-app.service.js 和 mini_app_rows
   * 
   * @param {string} contractId - 合同ID
   * @param {string} fileId - 附件ID（必须已上传到 attachments 表）
   * @param {Object} options - 版本选项
   * @param {string} options.contract_type - 合同类型（strategy|framework|development|sales|supply|purchase|quality|nda|technical|other），必填
   * @param {string} options.version_number - 版本号，默认 v{n+1}.0
   * @param {string} options.version_name - 版本名称
   * @param {string} options.version_type - 版本类型 (draft|signed|amendment|supplement)
   * @param {string} userId - 创建人ID
   * @returns {Object} 创建的版本对象，包含 row_id 和 document_id
   */
  async createVersionFromAttachment(contractId, fileId, options = {}, userId) {
    this.ensureModels();
    await this.ensureContractOwner(contractId, userId);

    // 验证合同类型
    const contractType = options.contract_type;
    if (!contractType) {
      throw new Error('contract_type 必填');
    }

    // 获取或创建私有 collection
    const collection = await this.getOrCreateCollection(contractType, userId);

    // 验证附件是否存在
    if (this.Attachment) {
      const attachment = await this.Attachment.findByPk(fileId);
      if (!attachment) {
        throw new Error('附件不存在');
      }
    } else {
      logger.warn('[ContractV2Service] Cannot verify attachment - model not available');
    }

    // 事务外预读：计算版本号/是否首版（intake 在独立事务中执行，需在外部事务之前完成，
    // 避免 MariaDB 11.7 在“外部事务 + 内部嵌套独立事务”组合下 INSERT 报
    // ER_CHECKREAD (1117) "Record has changed since last read" 的问题）
    const preContract = await this.models.MainRecord.findByPk(contractId);
    if (!preContract) throw new Error('合同不存在');

    const preCount = preContract.version_count || 0;
    const versionNumber = options.version_number || `v${preCount + 1}.0`;
    const isFirst = preCount === 0;

    const documentMode = options.document_mode === 'existing' ? 'existing' : 'new';
    const existingDocumentId = options.existing_document_id || null;

    // 复用公共文档 intake 入口（独立事务，自动提交）
    let documentId = null;
    let revisionId = null;
    try {
      const intakeService = new DocumentIntakeService(this.db);
      const collectionAccessService = new CollectionAccessService(this.db);

      await intakeService.validateIntakeRequest({
        appId: APP_ID,
        collectionId: collection.id,
        attachmentIds: [fileId],
        userId,
        collectionAccessService,
      });

      let intakeResult;
      if (documentMode === 'existing') {
        if (!existingDocumentId) {
          throw new Error('沿用已有 document 时，existing_document_id 必填');
        }

        const Document = this.db.getModel('document');
        const existingDocument = await Document.findByPk(existingDocumentId, {
          attributes: ['id', 'collection_id'],
          raw: true,
        });
        if (!existingDocument) {
          throw new Error('指定的 document 不存在');
        }
        if (existingDocument.collection_id !== collection.id) {
          throw new Error('指定的 document 不属于当前合同类型集合');
        }

        intakeResult = await intakeService.createIntakeRevision({
          documentId: existingDocumentId,
          attachments: [{ id: fileId }],
          userId,
          revisionLabel: options.version_number || undefined,
          changeSummary: options.version_name || 'Contract version upload',
        });
      } else {
        intakeResult = await intakeService.createIntakeDocument({
          appId: APP_ID,
          collectionId: collection.id,
          attachments: [{ id: fileId }],
          userId,
        });
      }

      documentId = intakeResult.document_id;
      revisionId = intakeResult.revision_id;
      logger.info(`[ContractV2Service] Created doc intake ${documentId}/${revisionId} for version ${versionNumber}`);
    } catch (intakeError) {
      // 如果创建 intake 失败，整体失败，不允许创建没有 document_id 的版本
      logger.error('[ContractV2Service] Failed to create doc intake:', intakeError.message);
      throw new Error(`文档创建失败: ${intakeError.message}`);
    }

    const runTxnOnce = async () => {
      const t = await this.db.sequelize.transaction({
        // MariaDB 11.7 + REPEATABLE READ 下，先独立 intake 再开外部事务时偶发出现
        // ER_CHECKREAD (1117) "Record has changed since last read"，用 READ_COMMITTED 规避
        isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
      });
      try {
      const contract = await this.models.MainRecord.findByPk(contractId, { transaction: t, lock: true });
      if (!contract) throw new Error('合同不存在');

      const existingCount = contract.version_count || 0;

      const existing = await this.models.Version.findOne({
        where: { contract_id: contractId, version_number: versionNumber },
        transaction: t,
      });
      if (existing) throw new Error(`版本号 ${versionNumber} 已存在`);

      // 生成独立 row_id，不依赖 mini_app_rows
      const rowId = Utils.newID(20);
      const contentId = Utils.newID(20);
      const isFirst = existingCount === 0;

      await this.db.sequelize.query(
        `INSERT INTO app_doc_bindings
           (id, app_id, row_id, document_id, current_revision_id, binding_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           document_id = VALUES(document_id),
           current_revision_id = VALUES(current_revision_id),
           binding_status = 'active',
           updated_at = NOW()`,
        {
          replacements: [Utils.newID(), APP_ID, rowId, documentId, revisionId],
          transaction: t,
        }
      );

      const version = await this.models.Version.create({
        id: Utils.newID(20),
        contract_id: contractId,
        row_id: rowId,
        file_id: fileId,
        version_number: versionNumber,
        version_name: options.version_name || null,
        version_type: options.version_type || 'draft',
        version_status: 'draft',
        is_current: isFirst ? 1 : 0,
        created_by: userId,
      }, { transaction: t });

      await this.db.sequelize.query(
        `UPDATE contract_v2_versions SET document_id = ?, revision_id = ? WHERE id = ?`,
        {
          replacements: [documentId, revisionId, version.id],
          transaction: t
        }
      );

      // 直接写入 content 表，不经过 mini-app.service.js
      await this.db.sequelize.query(`
        INSERT INTO app_contract_mgr_v2_content 
        (row_id, content_id, document_id, process_step, file_id, created_at, updated_at)
        VALUES (?, ?, ?, 'pending_ocr', ?, NOW(), NOW())
      `, {
        replacements: [rowId, contentId, documentId, fileId],
        transaction: t
      });

      // 同时初始化 rows 表，确保元数据提取时有对应行可更新
      await this.db.sequelize.query(`
        INSERT INTO app_contract_mgr_v2_rows 
        (row_id, contract_number, party_a, party_b, contract_amount, created_at, updated_at)
        VALUES (?, NULL, NULL, NULL, NULL, NOW(), NOW())
      `, {
        replacements: [rowId],
        transaction: t
      });

      // 更新合同统计
      await contract.update({
        version_count: existingCount + 1,
        current_version_id: isFirst ? version.id : contract.current_version_id,
        status: 'active',
      }, { transaction: t });

      await t.commit();
      logger.info(`[ContractV2Service] Created version ${versionNumber} for contract ${contractId} with row_id ${rowId} (no mini_app_rows dependency)`);
       return { ...version.toJSON(), row_id: rowId, document_id: documentId, revision_id: revisionId };
      } catch (e) {
        await t.rollback();
        throw e;
      }
    };

    // 事务外已创建 intake（独立提交），事务内失败仅回滚本事务数据；
    // MariaDB 11.7 偶发 ER_CHECKREAD (1117)，重试一次
    try {
      return await runTxnOnce();
    } catch (e) {
      if (/Record has changed since last read/.test(e?.message || '')) {
        logger.warn(`[ContractV2Service] ER_CHECKREAD detected, retrying version creation once`);
        return await runTxnOnce();
      }
      throw e;
    }
  }

  async listVersions(contractId, userId) {
    this.ensureModels();
    await this.ensureContractOwner(contractId, userId);
    return await this.loadVersionsByContractIds([contractId]);
  }

  async updateVersion(versionId, data, userId, skipOwnerCheck = false) {
    this.ensureModels();
    if (!skipOwnerCheck) await this.ensureVersionOwner(versionId, userId);
    const version = await this.models.Version.findByPk(versionId);

    const updates = {};
    const allowedFields = ['version_name', 'version_type', 'version_status', 'effective_date',
      'expiry_date', 'contract_number', 'party_a', 'party_b', 'total_amount', 'change_summary'];

    for (const field of allowedFields) {
      if (data[field] !== undefined) updates[field] = data[field];
    }

    await version.update(updates);
    return version.toJSON();
  }

  async setCurrentVersion(versionId, userId) {
    this.ensureModels();
    await this.ensureVersionOwner(versionId, userId);
    const version = await this.models.Version.findByPk(versionId);

    const t = await this.db.sequelize.transaction();
    try {
      await this.models.Version.update(
        { is_current: 0 },
        { where: { contract_id: version.contract_id }, transaction: t }
      );

      await this.models.Version.update(
        { is_current: 1 },
        { where: { id: versionId }, transaction: t }
      );

      await this.models.MainRecord.update(
        { current_version_id: versionId },
        { where: { id: version.contract_id }, transaction: t }
      );

      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }

    return (await this.models.Version.findByPk(versionId)).toJSON();
  }

  async approveVersion(versionId, userId) {
    this.ensureModels();
    await this.ensureVersionOwner(versionId, userId);
    const version = await this.models.Version.findByPk(versionId);

    await version.update({ version_status: 'approved' });
    return version.toJSON();
  }

  async deleteVersion(versionId, userId, skipOwnerCheck = false) {
    this.ensureModels();
    if (!skipOwnerCheck) await this.ensureVersionOwner(versionId, userId);
    const version = await this.models.Version.findByPk(versionId);

    const contractId = version.contract_id;
    const isCurrent = version.is_current;

    const t = await this.db.sequelize.transaction();
    try {
      await version.destroy({ transaction: t });

      const contract = await this.models.MainRecord.findByPk(contractId, { transaction: t });
      if (contract) {
        const newCount = Math.max(0, (contract.version_count || 1) - 1);

        if (isCurrent) {
          const latest = await this.models.Version.findOne({
            where: { contract_id: contractId },
            order: [['created_at', 'DESC']],
            transaction: t,
          });
          await contract.update({
            version_count: newCount,
            current_version_id: latest ? latest.id : null,
          }, { transaction: t });
        } else {
          await contract.update({ version_count: newCount }, { transaction: t });
        }
      }

      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  /**
   * 获取版本的内容（不依赖 mini_app_rows）
   */
  async getVersionContent(versionId, userId) {
    this.ensureModels();
    const { version } = await this.ensureVersionOwner(versionId, userId);

    // 从 app_contract_mgr_v2_content 表读取内容
    const content = await this.db.sequelize.query(`
      SELECT * FROM app_contract_mgr_v2_content WHERE row_id = ?
    `, {
      replacements: [version.row_id],
      type: this.db.sequelize.QueryTypes.SELECT,
      plain: true
    });

    if (!content) {
      return {
        has_content: false,
        ocr_text: null,
        filtered_text: null,
        sections: null,
        extract_json: null
      };
    }

    return {
      has_content: true,
      row_id: content.row_id,
      ocr_text: content.ocr_text,
      ocr_service: content.ocr_service,
      ocr_at: content.ocr_at,
      filtered_text: content.filtered_text,
      filter_at: content.filter_at,
      sections: content.sections ? JSON.parse(content.sections) : null,
      extract_json: content.extract_json ? JSON.parse(content.extract_json) : null,
      extract_at: content.extract_at
    };
  }

  async getDashboard(userId) {
    this.ensureModels();

    const totalContracts = await this.models.MainRecord.count({ where: { created_by: userId } });

    const ownedContracts = await this.models.MainRecord.findAll({ where: { created_by: userId }, attributes: ['id'], raw: true });
    const ownedContractIds = ownedContracts.map(item => item.id);
    const totalVersions = ownedContractIds.length
      ? await this.models.Version.count({ where: { contract_id: { [Op.in]: ownedContractIds } } })
      : 0;

    const totalNodes = await this.models.OrgNode.count({ where: { is_active: 1 } });

    const byStatus = await this.models.MainRecord.findAll({
      attributes: ['status', [this.db.sequelize.fn('COUNT', '*'), 'count']],
      where: { created_by: userId },
      group: ['status'],
      raw: true,
    });

    const byType = await this.models.MainRecord.findAll({
      attributes: ['contract_type', [this.db.sequelize.fn('COUNT', '*'), 'count']],
      where: { created_by: userId },
      group: ['contract_type'],
      raw: true,
    });

    const recentContracts = await this.models.MainRecord.findAll({
      where: { created_by: userId },
      order: [['created_at', 'DESC']],
      limit: 5,
      raw: true,
    });

    return {
      total_contracts: totalContracts,
      total_versions: totalVersions,
      total_nodes: totalNodes,
      by_status: byStatus.reduce((acc, r) => { acc[r.status] = r.count; return acc; }, {}),
      by_type: byType.reduce((acc, r) => { acc[r.contract_type || 'unknown'] = r.count; return acc; }, {}),
      recent_contracts: recentContracts,
    };
  }

  /**
   * 创建文档平台 intake
   */
  /**
   * 获取版本的文档处理状态
   *
   * 口径说明（audit-round06 P1-1）：
   * - 当前平台 processing_status 是 document 维度字段，每次新建 revision 会被重置为 pending_ocr
   * - 在"同一 document 多 revision"场景下，document.processing_status 表达的是
   *   最新 revision 的处理进度，并不直接等于某一历史版本对应 revision 的处理事实
   * - 这里同时返回 revision_id 和口径说明，便于前端区分"document 状态"与"版本绑定 revision"
   */
  async getVersionProcessingStatus(versionId, userId) {
    this.ensureModels();
    const { version } = await this.ensureVersionOwner(versionId, userId);

    if (!version.document_id) {
      return {
        has_document: false,
        document_id: null,
        revision_id: version.revision_id || null,
        processing_status: null,
        status_scope: 'none',
        status_scope_note: '该版本未关联文档平台',
      };
    }

    const Document = this.db.getModel('document');
    const document = await Document.findByPk(version.document_id, {
      attributes: ['id', 'current_revision_id', 'processing_status', 'processing_error_code', 'processing_error_message'],
      raw: true
    });

    if (!document) {
      return {
        has_document: false,
        document_id: version.document_id,
        revision_id: version.revision_id || null,
        processing_status: null,
        status_scope: 'none',
        status_scope_note: '文档记录不存在',
      };
    }

    // 判断该版本绑定 revision 是否就是 document 当前 active revision
    const isCurrentRevision = version.revision_id
      && document.current_revision_id
      && version.revision_id === document.current_revision_id;

    return {
      has_document: true,
      document_id: document.id,
      revision_id: version.revision_id || null,
      // document 维度的处理状态（平台状态机当前口径）
      document_processing_status: document.processing_status,
      // 兼容字段：保留 processing_status 供现有前端继续使用
      processing_status: document.processing_status,
      processing_error_code: document.processing_error_code,
      processing_error_message: document.processing_error_message,
      // 状态口径标识，前端可据此决定如何表述
      status_scope: isCurrentRevision ? 'document_current_revision' : 'document_shared',
      status_scope_note: isCurrentRevision
        ? '该版本绑定的 revision 即为 document 当前 revision，状态可直接代表该版本'
        : '该版本绑定的 revision 不是 document 当前 revision；processing_status 反映的是 document 最新 revision 的处理进度，不一定等于该历史版本的处理事实',
    };
  }

  /**
   * 手动提取元数据
   * 从文档内容中提取结构化元数据
   *
   * revision 级事实口径（audit-round06 P0-1）：
   * - 严格使用 version.revision_id 取该版本自己的 revision 内容
   * - 不再通过 document_id + is_current=1 反查当前 active revision
   * - 避免同一 document 多 revision 场景下把新版本内容回填到旧版本 row_id
   */
  async extractMetadata(versionId, userId) {
    this.ensureModels();
    const { version } = await this.ensureVersionOwner(versionId, userId);

    if (!version.document_id) {
      throw new Error('该版本没有关联文档');
    }

    if (!version.revision_id) {
      // 版本没有绑定 revision_id，属于未接入文档平台的半残版本
      // 不允许回退到 document_id + is_current=1 的模糊逻辑，避免写错版本事实
      throw new Error('该版本未绑定 revision_id，无法定位该版本的文档内容');
    }

    // 获取文档（用于上下文记录，不再用 document.processing_status 做硬前置阻断）
    const Document = this.db.getModel('document');
    const DocVersion = this.db.getModel('document_revision');
    const document = await Document.findByPk(version.document_id, { raw: true });
    if (!document) {
      throw new Error('文档不存在');
    }

    // 严格按该版本绑定的 revision_id 取内容，而不是 document 当前 active revision
    const revision = await DocVersion.findByPk(version.revision_id, {
      attributes: ['id', 'document_id', 'revision_no', 'revision_status', 'is_current'],
      raw: true
    });

    if (!revision) {
      throw new Error('该版本绑定的 revision 不存在');
    }

    // 查找 chunk 内容（严格使用该版本 revision_id）
    const DocChunk = this.db.getModel('document_chunk');
    if (!DocChunk) {
      throw new Error('文档分段表不可用');
    }

    const chunks = await DocChunk.findAll({
      where: { revision_id: version.revision_id },
      attributes: ['content'],
      order: [['seq', 'ASC']],
      raw: true
    });

    if (!chunks.length) {
      // revision 自身尚无可用 chunk：
      // - 若该 revision 即为 document 当前 revision，说明 document 正在处理中
      // - 若该 revision 不是当前 revision（历史版本），说明该历史版本当时未完成处理或 chunk 已不可用
      const isCurrent = revision.is_current;
      throw new Error(
        isCurrent
          ? `该版本正在处理中（document 状态：${document.processing_status}），请等待处理完成后再提取元数据`
          : '该历史版本对应的文档内容为空（revision 没有 chunk），可能当时未完成处理，无法提取元数据'
      );
    }

    const fullText = chunks.map(c => c.content).join('\n\n');

    // 获取合同类型配置
    const typeConfig = await this.getContractTypeConfig();
    const contract = await this.models.MainRecord.findByPk(version.contract_id, { raw: true });
    const contractType = contract?.contract_type || 'sales';
    const typeInfo = typeConfig.find(t => t.id === contractType) || typeConfig[0];

    // 构建提取 prompt
    const metadataFields = typeInfo?.metadata_fields || ['客户', '合同名称', '合同编号', '甲方', '乙方', '生效日期', '版本号'];
    
    const prompt = `请从以下合同文档中提取结构化信息。
    
提取字段：${metadataFields.join('、')}

要求：
1. 只提取文档中明确存在的信息，不要猜测
2. 如果某个字段在文档中找不到，设为 null
3. 返回 JSON 格式

合同文档内容：
${fullText.substring(0, 8000)}`;

    // 调用 LLM 提取
    try {
      const InternalLLMService = (await import('../../../../lib/internal-llm-service.js')).default;
      const llmService = new InternalLLMService(this.db);
      
      const result = await llmService.chat({
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
      });

      // 解析 JSON 结果
      let metadata = {};
      try {
        metadata = JSON.parse(result.content);
      } catch {
        // 如果不是 JSON，尝试提取 JSON 部分
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          metadata = JSON.parse(jsonMatch[0]);
        }
      }

      // 回填到业务表 app_contract_mgr_v2_rows（按 version.row_id 隔离，版本级事实）
      // 注意：不再向 document.metadata 写入 contract_metadata。
      // 原因：document.metadata 是 document 维度，同一 document 多 revision 场景下
      // 会把不同版本的提取结果互相覆盖，且该字段当前无任何读取方，属于半残写入。
      // 版本级元数据的唯一事实来源是 app_contract_mgr_v2_rows（按 row_id 隔离）。
      const [updateResult] = await this.db.sequelize.query(`
        UPDATE app_contract_mgr_v2_rows 
        SET contract_number = ?, party_a = ?, party_b = ?, contract_amount = ?
        WHERE row_id = ?
      `, {
        replacements: [
          metadata['合同编号'] || metadata['contract_number'] || null,
          metadata['甲方'] || metadata['party_a'] || null,
          metadata['乙方'] || metadata['party_b'] || null,
          metadata['合同金额'] || metadata['contract_amount'] || null,
          version.row_id
        ]
      });

      // 检查是否真的更新了数据行（通过 affectedRows 属性判断）
      const affectedRows = updateResult?.affectedRows || 0;
      if (affectedRows === 0) {
        throw new Error(`业务表不存在对应 row_id=${version.row_id}，元数据回填失败`);
      }

      logger.info(`[ContractV2Service] Metadata saved to business table for version ${versionId} (revision_id=${version.revision_id}), affected rows: ${affectedRows}`);

      return {
        success: true,
        metadata,
        fields: metadataFields,
        revision_id: version.revision_id,
        row_id: version.row_id,
      };
    } catch (e) {
      logger.error('[ContractV2Service] extractMetadata error:', e.message);
      throw new Error(`元数据提取失败: ${e.message}`);
    }
  }

  /**
   * 获取版本元数据
   * 从业务表 app_contract_mgr_v2_rows 读取当前已保存的元数据
   */
  async getVersionMetadata(versionId, userId) {
    this.ensureModels();
    const { version } = await this.ensureVersionOwner(versionId, userId);

    if (!version.row_id) {
      return {
        has_metadata: false,
        contract_number: null,
        party_a: null,
        party_b: null,
        contract_amount: null,
      };
    }

    const row = await this.db.sequelize.query(`
      SELECT contract_number, party_a, party_b, contract_amount
      FROM app_contract_mgr_v2_rows
      WHERE row_id = ?
    `, {
      replacements: [version.row_id],
      type: this.db.sequelize.QueryTypes.SELECT,
      plain: true
    });

    if (!row) {
      return {
        has_metadata: false,
        contract_number: null,
        party_a: null,
        party_b: null,
        contract_amount: null,
      };
    }

    return {
      has_metadata: true,
      ...row
    };
  }

  /**
   * 更新版本元数据
   * 直接更新业务表 app_contract_mgr_v2_rows 的字段
   * 这是最小 key/value 编辑器实现
   */
  async updateVersionMetadata(versionId, metadata, userId) {
    this.ensureModels();
    const { version } = await this.ensureVersionOwner(versionId, userId);

    if (!version.row_id) {
      throw new Error('该版本没有关联业务表数据');
    }

    // 只允许更新固定字段
    const allowedFields = ['contract_number', 'party_a', 'party_b', 'contract_amount'];
    const updates = {};
    for (const field of allowedFields) {
      if (metadata[field] !== undefined) {
        updates[field] = metadata[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new Error('没有有效的更新字段');
    }

    // 构建动态更新语句
    const setClauses = [];
    const replacements = [];
    for (const [field, value] of Object.entries(updates)) {
      setClauses.push(`${field} = ?`);
      replacements.push(value);
    }
    replacements.push(version.row_id);

    const [updateResult] = await this.db.sequelize.query(`
      UPDATE app_contract_mgr_v2_rows 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE row_id = ?
    `, {
      replacements
    });

    const affectedRows = updateResult?.affectedRows || 0;
    if (affectedRows === 0) {
      throw new Error('更新失败，业务表不存在对应 row_id');
    }

    logger.info(`[ContractV2Service] Metadata updated for version ${versionId}`);

    return {
      success: true,
      ...updates
    };
  }

  /**
   * 创建比对任务
   * 用户手动选择两个版本进行比对
   * 
   * 按已拍板语义：
   * - compare 对象是 revision，不是 document
   * - 允许同一合同下的不同 document 的 revision 进行比对
   * - 不再要求 document_id 必须相等
   */
  async createCompareRun(versionIdA, versionIdB, userId) {
    this.ensureModels();

    const [versionAResult, versionBResult] = await Promise.all([
      this.ensureVersionOwner(versionIdA, userId),
      this.ensureVersionOwner(versionIdB, userId)
    ]);
    const versionA = versionAResult.version;
    const versionB = versionBResult.version;

    if (!versionA || !versionB) {
      throw new Error('版本不存在');
    }

    // 必须是同一合同下的版本
    if (versionA.contract_id !== versionB.contract_id) {
      throw new Error('只能比对同一合同下的版本');
    }

    // 两个版本都必须有 revision_id（已接入文档平台）
    if (!versionA.revision_id || !versionB.revision_id) {
      throw new Error('两个版本都必须已接入文档平台（拥有 revision_id）才能比对');
    }

    // 检查两个版本各自的 revision 是否有可用 chunk（revision 级事实口径）
    // 不再使用 document.processing_status 做硬前置阻断：
    // - document.processing_status 是 document 维度字段，反映最新 revision 处理进度
    // - 同一 document 下历史 revision 自己的 chunk 可能仍然完整可用
    // - compare executor 实际按 revision_id 读取 chunk，不依赖 document 当前状态
    const Document = this.db.getModel('document');
    const DocVersion = this.db.getModel('document_revision');
    const DocChunk = this.db.getModel('document_chunk');

    const [documentA, documentB, revisionA, revisionB] = await Promise.all([
      versionA.document_id ? Document.findByPk(versionA.document_id, {
        attributes: ['id', 'processing_status'],
        raw: true
      }) : null,
      versionB.document_id ? Document.findByPk(versionB.document_id, {
        attributes: ['id', 'processing_status'],
        raw: true
      }) : null,
      versionA.revision_id
        ? DocVersion.findByPk(versionA.revision_id, {
            attributes: ['id', 'document_id', 'revision_no', 'revision_status', 'is_current'],
            raw: true
          })
        : null,
      versionB.revision_id
        ? DocVersion.findByPk(versionB.revision_id, {
            attributes: ['id', 'document_id', 'revision_no', 'revision_status', 'is_current'],
            raw: true
          })
        : null,
    ]);

    if (!revisionA || !revisionB) {
      throw new Error('两个版本绑定的 revision 均必须存在才能比对');
    }

    const [chunksA, chunksB] = await Promise.all([
      DocChunk.findAll({
        where: { revision_id: versionA.revision_id },
        attributes: ['id'],
        raw: true
      }),
      DocChunk.findAll({
        where: { revision_id: versionB.revision_id },
        attributes: ['id'],
        raw: true
      })
    ]);

    if (!chunksA.length || !chunksB.length) {
      // 按 revision.is_current 区分错误语义，并带出 document 当前状态，便于排查
      const issues = [];

      if (!chunksA.length) {
        issues.push(
          revisionA.is_current
            ? `版本A正在处理中（document 状态：${documentA?.processing_status || 'unknown'}），请等待处理完成后再比对`
            : '版本A对应的历史 revision 无可用 chunk，可能当时未完成处理，无法比对'
        );
      }

      if (!chunksB.length) {
        issues.push(
          revisionB.is_current
            ? `版本B正在处理中（document 状态：${documentB?.processing_status || 'unknown'}），请等待处理完成后再比对`
            : '版本B对应的历史 revision 无可用 chunk，可能当时未完成处理，无法比对'
        );
      }

      throw new Error(issues.join('；'));
    }

    // 按已拍板语义：围绕两个 revision_id 创建比对任务
    // 不再要求 document_id 必须相等
    const DocCompareRun = this.db.getModel('doc_compare_run');
    const runId = Utils.newID();

    // 优先使用 versionA 关联的 document_id 作为主文档
    // 如果 versionA 没有 document_id，则使用 versionB 的
    const primaryDocumentId = versionA.document_id || versionB.document_id;
    if (!primaryDocumentId) {
      throw new Error('两个版本都没有关联文档，无法比对');
    }

    const run = await DocCompareRun.create({
      id: runId,
      document_id: primaryDocumentId,
      base_version_id: versionA.revision_id,
      target_version_id: versionB.revision_id,
      status: 'pending',
      created_by: userId,
    });

    // 异步执行比对
    const DocController = (await import('../../../../lib/doc-compare-executor.js')).default;
    const executor = new DocController(this.db);
    setImmediate(() => executor.execute(runId));

    return {
      run_id: runId,
      status: 'pending'
    };
  }

  /**
   * 获取比对结果
   * @param {string} runId - 比对任务ID
   * @param {string} userId - 当前用户ID（用于权限校验）
   */
  async getCompareRunResult(runId, userId) {
    const DocCompareRun = this.db.getModel('doc_compare_run');
    const DocCompareItem = this.db.getModel('doc_compare_item');

    const run = await DocCompareRun.findByPk(runId, { raw: true });
    if (!run) {
      throw new Error('比对任务不存在');
    }

    // 资源级授权校验：只能查看自己创建的比对任务
    if (run.created_by !== userId) {
      throw new Error('无权限查看该比对任务');
    }

    // 按真实表结构字段查询：run_id, risk_level, summary
    const items = await DocCompareItem.findAll({
      where: { run_id: runId },
      order: [['risk_level', 'DESC'], ['id', 'ASC']],
      raw: true
    });

    // 按 risk_level 分组
    const highSeverity = items.filter(i => i.risk_level === 'high');
    const mediumSeverity = items.filter(i => i.risk_level === 'medium');
    const lowSeverity = items.filter(i => i.risk_level === 'low');

    return {
      run_id: runId,
      status: run.status,
      summary: {
        total: items.length,
        high: highSeverity.length,
        medium: mediumSeverity.length,
        low: lowSeverity.length,
      },
      items: items,
      high_severity_items: highSeverity,
      medium_severity_items: mediumSeverity,
      low_severity_items: lowSeverity,
    };
  }
}

export default ContractV2Service;
