import Router from '@koa/router';
import ContractV2Service from '../../../server/services/contract-v2.service.js';

export default function createRoutes(context) {
  const router = new Router();
  const contractV2Service = new ContractV2Service(context.db);

  router.get('/org-nodes/tree', async (ctx) => {
    try {
      const tree = await contractV2Service.getTree();
      ctx.success(tree);
    } catch (error) {
      ctx.error(error.message, 500);
    }
  });

  router.post('/org-nodes', async (ctx) => {
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

  router.get('/contracts', async (ctx) => {
    try {
      const contracts = await contractV2Service.listContracts(ctx.query);
      ctx.success(contracts);
    } catch (error) {
      ctx.error(error.message, 500);
    }
  });

  router.post('/contracts', async (ctx) => {
    try {
      const contract = await contractV2Service.createContract(ctx.request.body);
      ctx.success(contract);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.get('/contracts/:contractId', async (ctx) => {
    try {
      const contract = await contractV2Service.getContract(ctx.params.contractId);
      ctx.success(contract);
    } catch (error) {
      ctx.error(error.message, 404);
    }
  });

  router.put('/contracts/:contractId', async (ctx) => {
    try {
      const contract = await contractV2Service.updateContract(ctx.params.contractId, ctx.request.body);
      ctx.success(contract);
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.delete('/contracts/:contractId', async (ctx) => {
    try {
      await contractV2Service.deleteContract(ctx.params.contractId);
      ctx.success(null, '删除成功');
    } catch (error) {
      ctx.error(error.message, 400);
    }
  });

  router.get('/dashboard', async (ctx) => {
    try {
      const dashboard = await contractV2Service.getDashboard();
      ctx.success(dashboard);
    } catch (error) {
      ctx.error(error.message, 500);
    }
  });

  return router;
}