import Router from '@koa/router';
import { requireAdmin } from '../../../server/middlewares/auth.js';
import ContractV2Service from '../../../server/services/contract-v2.service.js';

export default function createRoutes(context) {
  const router = new Router();
  const contractV2Service = new ContractV2Service(context.db);

  // 组织节点
  router.get('/org-nodes/tree', async (ctx) => {
    try {
      const tree = await contractV2Service.getTree();
      ctx.success(tree);
    } catch (error) {
      ctx.error(error.message, 500);
    }
  });

  router.post('/org-nodes', requireAdmin(), async (ctx) => {
    try {
      const data = ctx.request.body;
      if (!data.name || !data.node_type) {
        ctx.error('name 和 node_type 必填', 400);
        return;
      }
      const node = await contractV2Service.createNode(data);
      ctx.success(node);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.put('/org-nodes/:nodeId', requireAdmin(), async (ctx) => {
    try {
      const node = await contractV2Service.updateNode(ctx.params.nodeId, ctx.request.body);
      ctx.success(node);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.delete('/org-nodes/:nodeId', requireAdmin(), async (ctx) => {
    try {
      await contractV2Service.deleteNode(ctx.params.nodeId);
      ctx.success(null, '删除成功');
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.get('/org-nodes/:nodeId/stats', async (ctx) => {
    try {
      const stats = await contractV2Service.getNodeStats(ctx.params.nodeId);
      ctx.success(stats);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  // 合同
  router.get('/contracts', async (ctx) => {
    try {
      const contracts = await contractV2Service.listContracts(ctx.query, ctx.state.session.id);
      ctx.success(contracts);
    } catch (error) {
      ctx.error(error.message, 500);
    }
  });

  router.post('/contracts', async (ctx) => {
    try {
      const contract = await contractV2Service.createContract(ctx.request.body, ctx.state.session.id);
      ctx.success(contract);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.get('/contracts/:contractId', async (ctx) => {
    try {
      const contract = await contractV2Service.getContract(ctx.params.contractId, ctx.state.session.id);
      ctx.success(contract);
    } catch (error) {
      ctx.error(error.message, 404);
    }
  });

  router.put('/contracts/:contractId', async (ctx) => {
    try {
      const contract = await contractV2Service.updateContract(ctx.params.contractId, ctx.request.body, ctx.state.session.id);
      ctx.success(contract);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.delete('/contracts/:contractId', async (ctx) => {
    try {
      await contractV2Service.deleteContract(ctx.params.contractId, ctx.state.session.id);
      ctx.success(null, '删除成功');
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  // 版本
  router.get('/contracts/:contractId/versions', async (ctx) => {
    try {
      const versions = await contractV2Service.listVersions(ctx.params.contractId, ctx.state.session.id);
      ctx.success(versions);
    } catch (error) {
      ctx.error(error.message, 500);
    }
  });

  /**
   * 旧版建版本入口 - 已废弃，仅返回明确拦截错误
   * 
   * 为防止继续产生不带 document_id/revision_id 的半残版本，
   * 此入口不再允许创建新数据。所有版本创建必须走 from-attachment 入口。
   * 
   * @deprecated 使用 POST /contracts/:contractId/versions/from-attachment 替代
   */
  router.post('/contracts/:contractId/versions', async (ctx) => {
    ctx.error('此建版本入口已废弃，请使用 /from-attachment 入口创建版本', 410);
  });

  /**
   * 创建版本（从已上传的附件）
   * 不依赖 mini-app.service.js 和 mini_app_rows
   *
   * 权限策略：与集中式 createVersion 一致，认证用户即可创建版本
   * authenticate() 由 AppRouterLoader 在 /api/apps/contract-mgr-v2 前缀上全局挂载
   */
  router.post('/contracts/:contractId/versions/from-attachment', async (ctx) => {
    try {
      const { contractId } = ctx.params;
      const { file_id, contract_type, version_number, version_name, version_type, document_mode, existing_document_id } = ctx.request.body;
      const userId = ctx.state.session.id;

      if (!file_id) {
        ctx.error('file_id 必填', 400);
        return;
      }
      if (!contract_type) {
        ctx.error('contract_type 必填', 400);
        return;
      }

        const version = await contractV2Service.createVersionFromAttachment(
          contractId,
          file_id,
          { contract_type, version_number, version_name, version_type, document_mode, existing_document_id },
          userId
        );
      ctx.success(version);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.put('/versions/:versionId', async (ctx) => {
    try {
      const version = await contractV2Service.updateVersion(ctx.params.versionId, ctx.request.body, ctx.state.session.id);
      ctx.success(version);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.put('/versions/:versionId/approve', async (ctx) => {
    try {
      const version = await contractV2Service.approveVersion(ctx.params.versionId, ctx.state.session.id);
      ctx.success(version);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.put('/versions/:versionId/current', async (ctx) => {
    try {
      const version = await contractV2Service.setCurrentVersion(ctx.params.versionId, ctx.state.session.id);
      ctx.success(version);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.delete('/versions/:versionId', async (ctx) => {
    try {
      await contractV2Service.deleteVersion(ctx.params.versionId, ctx.state.session.id);
      ctx.success(null, '删除成功');
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  // Dashboard
  router.get('/dashboard', async (ctx) => {
    try {
      const dashboard = await contractV2Service.getDashboard(ctx.state.session.id);
      ctx.success(dashboard);
    } catch (error) {
      ctx.error(error.message, 500);
    }
  });

  // 版本状态和内容
  router.get('/versions/:versionId/processing-status', async (ctx) => {
    try {
      const status = await contractV2Service.getVersionProcessingStatus(ctx.params.versionId, ctx.state.session.id);
      ctx.success(status);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.get('/versions/:versionId/content', async (ctx) => {
    try {
      const content = await contractV2Service.getVersionContent(ctx.params.versionId, ctx.state.session.id);
      ctx.success(content);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  // 元数据提取
  router.post('/versions/:versionId/extract-metadata', async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const result = await contractV2Service.extractMetadata(ctx.params.versionId, userId);
      ctx.success(result);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  // 获取版本元数据
  router.get('/versions/:versionId/metadata', async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const result = await contractV2Service.getVersionMetadata(ctx.params.versionId, userId);
      ctx.success(result);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  // 更新版本元数据
  router.put('/versions/:versionId/metadata', async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const result = await contractV2Service.updateVersionMetadata(ctx.params.versionId, ctx.request.body, userId);
      ctx.success(result);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  // 比对
  router.post('/compare-runs', async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const { version_id_a, version_id_b } = ctx.request.body;
      const result = await contractV2Service.createCompareRun(version_id_a, version_id_b, userId);
      ctx.success(result);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.get('/compare-runs/:runId', async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const result = await contractV2Service.getCompareRunResult(ctx.params.runId, userId);
      ctx.success(result);
    } catch (error) {
      ctx.error(error.message, 403);
    }
  });

  return router;
}
