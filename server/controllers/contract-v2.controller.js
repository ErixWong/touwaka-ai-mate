import logger from '../../lib/logger.js';
import ContractV2Service from '../services/contract-v2.service.js';

class ContractV2Controller {
  constructor(db) {
    this.db = db;
    this.contractV2Service = new ContractV2Service(db);
  }

  async getTree(ctx) {
    try {
      const tree = await this.contractV2Service.getTree();
      ctx.success(tree);
    } catch (error) {
      logger.error('[ContractV2] getTree error:', error.message);
      ctx.error(error.message, 500);
    }
  }

  async createNode(ctx) {
    try {
      const data = ctx.request.body;
      if (!data.name || !data.node_type) {
        return ctx.error('name 和 node_type 必填', 400);
      }
      const node = await this.contractV2Service.createNode(data);
      ctx.success(node);
    } catch (error) {
      logger.error('[ContractV2] createNode error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async updateNode(ctx) {
    try {
      const { nodeId } = ctx.params;
      const data = ctx.request.body;
      const node = await this.contractV2Service.updateNode(nodeId, data);
      ctx.success(node);
    } catch (error) {
      logger.error('[ContractV2] updateNode error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async deleteNode(ctx) {
    try {
      const { nodeId } = ctx.params;
      await this.contractV2Service.deleteNode(nodeId);
      ctx.success(null, '删除成功');
    } catch (error) {
      logger.error('[ContractV2] deleteNode error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async getNodeStats(ctx) {
    try {
      const { nodeId } = ctx.params;
      const stats = await this.contractV2Service.getNodeStats(nodeId);
      ctx.success(stats);
    } catch (error) {
      logger.error('[ContractV2] getNodeStats error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async listContracts(ctx) {
    try {
      const filters = {
        org_node_id: ctx.query.org_node_id,
        include_children: ctx.query.include_children === 'true',
        contract_type: ctx.query.contract_type,
        status: ctx.query.status,
        page: parseInt(ctx.query.page) || 1,
        page_size: parseInt(ctx.query.page_size) || 20,
      };
      const result = await this.contractV2Service.listContracts(filters);
      ctx.success(result);
    } catch (error) {
      logger.error('[ContractV2] listContracts error:', error.message);
      ctx.error(error.message, 500);
    }
  }

  async getContract(ctx) {
    try {
      const { contractId } = ctx.params;
      const contract = await this.contractV2Service.getContract(contractId);
      ctx.success(contract);
    } catch (error) {
      logger.error('[ContractV2] getContract error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async createContract(ctx) {
    try {
      const data = ctx.request.body;
      const userId = ctx.state.session.id;
      if (!data.org_node_id || !data.contract_name) {
        return ctx.error('org_node_id 和 contract_name 必填', 400);
      }
      const contract = await this.contractV2Service.createContract(data, userId);
      ctx.success(contract);
    } catch (error) {
      logger.error('[ContractV2] createContract error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async updateContract(ctx) {
    try {
      const { contractId } = ctx.params;
      const data = ctx.request.body;
      const contract = await this.contractV2Service.updateContract(contractId, data);
      ctx.success(contract);
    } catch (error) {
      logger.error('[ContractV2] updateContract error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async deleteContract(ctx) {
    try {
      const { contractId } = ctx.params;
      await this.contractV2Service.deleteContract(contractId);
      ctx.success(null, '删除成功');
    } catch (error) {
      logger.error('[ContractV2] deleteContract error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async createVersion(ctx) {
    try {
      const { contractId } = ctx.params;
      const data = ctx.request.body;
      const userId = ctx.state.session.id;
      if (!data.row_id) {
        return ctx.error('row_id 必填', 400);
      }
      const version = await this.contractV2Service.createVersion(contractId, data, userId);
      ctx.success(version);
    } catch (error) {
      logger.error('[ContractV2] createVersion error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async listVersions(ctx) {
    try {
      const { contractId } = ctx.params;
      const versions = await this.contractV2Service.listVersions(contractId);
      ctx.success(versions);
    } catch (error) {
      logger.error('[ContractV2] listVersions error:', error.message);
      ctx.error(error.message, 500);
    }
  }

  async updateVersion(ctx) {
    try {
      const { versionId } = ctx.params;
      const data = ctx.request.body;
      const version = await this.contractV2Service.updateVersion(versionId, data);
      ctx.success(version);
    } catch (error) {
      logger.error('[ContractV2] updateVersion error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async approveVersion(ctx) {
    try {
      const { versionId } = ctx.params;
      const version = await this.contractV2Service.approveVersion(versionId);
      ctx.success(version);
    } catch (error) {
      logger.error('[ContractV2] approveVersion error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async setCurrentVersion(ctx) {
    try {
      const { versionId } = ctx.params;
      const version = await this.contractV2Service.setCurrentVersion(versionId);
      ctx.success(version);
    } catch (error) {
      logger.error('[ContractV2] setCurrentVersion error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async deleteVersion(ctx) {
    try {
      const { versionId } = ctx.params;
      await this.contractV2Service.deleteVersion(versionId);
      ctx.success(null, '删除成功');
    } catch (error) {
      logger.error('[ContractV2] deleteVersion error:', error.message);
      ctx.error(error.message, 400);
    }
  }

  async getDashboard(ctx) {
    try {
      const userId = ctx.state.session.id;
      const dashboard = await this.contractV2Service.getDashboard(userId);
      ctx.success(dashboard);
    } catch (error) {
      logger.error('[ContractV2] getDashboard error:', error.message);
      ctx.error(error.message, 500);
    }
  }
}

export default ContractV2Controller;
