import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';
import { Op } from 'sequelize';

const VALID_NODE_TYPES = ['group', 'party', 'project'];

class ContractV2Service {
  constructor(db) {
    this.db = db;
    this.models = {};
  }

  ensureModels() {
    if (this.models.OrgNode) return;

    this.models.OrgNode = this.db.getModel('contract_v2_org_node');
    this.models.MainRecord = this.db.getModel('contract_v2_main_record');
    this.models.Version = this.db.getModel('contract_v2_version');
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

  async listContracts(filters = {}) {
    this.ensureModels();
    const where = {};

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

    const offset = ((filters.page || 1) - 1) * (filters.page_size || 20);

    const result = await this.models.MainRecord.findAndCountAll({
      where,
      order: [['updated_at', 'DESC']],
      limit: filters.page_size || 20,
      offset,
      raw: true,
    });

    return {
      items: result.rows,
      total: result.count,
      page: filters.page || 1,
      page_size: filters.page_size || 20,
    };
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

  async getContract(contractId) {
    this.ensureModels();
    const contract = await this.models.MainRecord.findByPk(contractId, { raw: true });
    if (!contract) throw new Error('合同不存在');

    const versions = await this.models.Version.findAll({
      where: { contract_id: contractId },
      order: [['created_at', 'DESC']],
      raw: true,
    });

    return { ...contract, versions };
  }

  async updateContract(contractId, data) {
    this.ensureModels();
    const contract = await this.models.MainRecord.findByPk(contractId);
    if (!contract) throw new Error('合同不存在');

    const updates = {};
    if (data.contract_name !== undefined) updates.contract_name = data.contract_name;
    if (data.contract_type !== undefined) updates.contract_type = data.contract_type;
    if (data.status !== undefined) updates.status = data.status;

    await contract.update(updates);
    return contract.toJSON();
  }

  async deleteContract(contractId) {
    this.ensureModels();
    const contract = await this.models.MainRecord.findByPk(contractId);
    if (!contract) throw new Error('合同不存在');

    await contract.destroy();
  }

  async createVersion(contractId, data, userId) {
    this.ensureModels();

    const t = await this.db.sequelize.transaction();
    try {
      const contract = await this.models.MainRecord.findByPk(contractId, { transaction: t, lock: true });
      if (!contract) throw new Error('合同不存在');

      const existingCount = contract.version_count || 0;
      const versionNumber = data.version_number || `v${existingCount + 1}.0`;

      const existing = await this.models.Version.findOne({
        where: { contract_id: contractId, version_number: versionNumber },
        transaction: t,
      });
      if (existing) throw new Error(`版本号 ${versionNumber} 已存在`);

      const isFirst = existingCount === 0;
      const version = await this.models.Version.create({
        id: Utils.newID(20),
        contract_id: contractId,
        row_id: data.row_id,
        file_id: data.file_id || null,
        version_number: versionNumber,
        version_name: data.version_name || null,
        version_type: data.version_type || 'draft',
        version_status: 'draft',
        is_current: isFirst ? 1 : 0,
        created_by: userId,
      }, { transaction: t });

      await contract.update({
        version_count: existingCount + 1,
        current_version_id: isFirst ? version.id : contract.current_version_id,
        status: 'active',
      }, { transaction: t });

      await t.commit();
      return version.toJSON();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  async listVersions(contractId) {
    this.ensureModels();
    return await this.models.Version.findAll({
      where: { contract_id: contractId },
      order: [['created_at', 'DESC']],
      raw: true,
    });
  }

  async updateVersion(versionId, data) {
    this.ensureModels();
    const version = await this.models.Version.findByPk(versionId);
    if (!version) throw new Error('版本不存在');

    const updates = {};
    const allowedFields = ['version_name', 'version_type', 'version_status', 'effective_date',
      'expiry_date', 'contract_number', 'party_a', 'party_b', 'total_amount', 'change_summary'];

    for (const field of allowedFields) {
      if (data[field] !== undefined) updates[field] = data[field];
    }

    await version.update(updates);
    return version.toJSON();
  }

  async setCurrentVersion(versionId) {
    this.ensureModels();
    const version = await this.models.Version.findByPk(versionId);
    if (!version) throw new Error('版本不存在');

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

  async approveVersion(versionId) {
    this.ensureModels();
    const version = await this.models.Version.findByPk(versionId);
    if (!version) throw new Error('版本不存在');

    await version.update({ version_status: 'approved' });
    return version.toJSON();
  }

  async deleteVersion(versionId) {
    this.ensureModels();
    const version = await this.models.Version.findByPk(versionId);
    if (!version) throw new Error('版本不存在');

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

  async getDashboard(userId) {
    this.ensureModels();

    const totalContracts = await this.models.MainRecord.count();

    const totalVersions = await this.models.Version.count();

    const totalNodes = await this.models.OrgNode.count({ where: { is_active: 1 } });

    const byStatus = await this.models.MainRecord.findAll({
      attributes: ['status', [this.db.sequelize.fn('COUNT', '*'), 'count']],
      group: ['status'],
      raw: true,
    });

    const byType = await this.models.MainRecord.findAll({
      attributes: ['contract_type', [this.db.sequelize.fn('COUNT', '*'), 'count']],
      group: ['contract_type'],
      raw: true,
    });

    const recentContracts = await this.models.MainRecord.findAll({
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
}

export default ContractV2Service;
