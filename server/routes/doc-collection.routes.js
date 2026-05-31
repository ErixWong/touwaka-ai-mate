/**
 * Doc Collection Routes - 文档集合路由
 * 路径前缀：/api/docs/collections
 */
import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';

export default (controller) => {
  const router = new Router({ prefix: '/api/docs' });

  // ==================== 集合 CRUD ====================
  router.get('/collections', authenticate(), controller.listCollections.bind(controller));
  router.post('/collections', authenticate(), controller.createCollection.bind(controller));
  router.get('/collections/:id', authenticate(), controller.getCollection.bind(controller));
  router.patch('/collections/:id', authenticate(), controller.updateCollection.bind(controller));
  router.delete('/collections/:id', authenticate(), controller.deleteCollection.bind(controller));

  // ==================== 集合文档关联 ====================
  router.get('/collections/:id/documents', authenticate(), controller.listCollectionDocuments.bind(controller));
  router.post('/collections/:id/documents', authenticate(), controller.addDocument.bind(controller));
  router.delete('/collections/:id/documents/:docId', authenticate(), controller.removeDocument.bind(controller));

  // ==================== 文档移动 ====================
  router.post('/documents/:docId/move-collection', authenticate(), controller.moveDocument.bind(controller));

  // ==================== 重新向量化 ====================
  router.post('/collections/:id/revectorize', authenticate(), controller.revectorize.bind(controller));

  return router;
};
