import Router from '@koa/router';
import { authenticate, requireAdmin } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router();

  router.get('/api/contract-v2/org-nodes/tree', authenticate(), (ctx) => controller.getTree(ctx));
  router.post('/api/contract-v2/org-nodes', authenticate(), requireAdmin(), (ctx) => controller.createNode(ctx));
  router.put('/api/contract-v2/org-nodes/:nodeId', authenticate(), requireAdmin(), (ctx) => controller.updateNode(ctx));
  router.delete('/api/contract-v2/org-nodes/:nodeId', authenticate(), requireAdmin(), (ctx) => controller.deleteNode(ctx));
  router.get('/api/contract-v2/org-nodes/:nodeId/stats', authenticate(), (ctx) => controller.getNodeStats(ctx));

  router.get('/api/contract-v2/contracts', authenticate(), (ctx) => controller.listContracts(ctx));
  router.post('/api/contract-v2/contracts', authenticate(), requireAdmin(), (ctx) => controller.createContract(ctx));
  router.get('/api/contract-v2/contracts/:contractId', authenticate(), (ctx) => controller.getContract(ctx));
  router.put('/api/contract-v2/contracts/:contractId', authenticate(), requireAdmin(), (ctx) => controller.updateContract(ctx));
  router.delete('/api/contract-v2/contracts/:contractId', authenticate(), requireAdmin(), (ctx) => controller.deleteContract(ctx));

  router.post('/api/contract-v2/contracts/:contractId/versions', authenticate(), (ctx) => controller.createVersion(ctx));
  router.get('/api/contract-v2/contracts/:contractId/versions', authenticate(), (ctx) => controller.listVersions(ctx));
  router.put('/api/contract-v2/versions/:versionId', authenticate(), (ctx) => controller.updateVersion(ctx));
  router.put('/api/contract-v2/versions/:versionId/approve', authenticate(), requireAdmin(), (ctx) => controller.approveVersion(ctx));
  router.put('/api/contract-v2/versions/:versionId/current', authenticate(), (ctx) => controller.setCurrentVersion(ctx));
  router.delete('/api/contract-v2/versions/:versionId', authenticate(), requireAdmin(), (ctx) => controller.deleteVersion(ctx));

  router.get('/api/contract-v2/dashboard', authenticate(), (ctx) => controller.getDashboard(ctx));

  return router;
};
