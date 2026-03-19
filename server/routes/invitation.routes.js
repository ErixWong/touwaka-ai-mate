/**
 * Invitation Routes - 邀请码路由
 */

import Router from '@koa/router';
import InvitationController from '../controllers/invitation.controller.js';
import { authenticate } from '../middlewares/auth.js';

/**
 * 创建邀请路由
 * @param {Object} db - 数据库实例
 * @returns {Router}
 */
export function createInvitationRoutes(db) {
  const router = new Router({
    prefix: '/api/invitations',
  });

  const controller = new InvitationController(db);

  // 需要登录的接口
  router.get('/quota', authenticate(), controller.getQuota.bind(controller));
  router.post('/', authenticate(), controller.create.bind(controller));
  router.get('/', authenticate(), controller.list.bind(controller));
  router.get('/:id/usage', authenticate(), controller.getUsage.bind(controller));
  router.delete('/:id', authenticate(), controller.revoke.bind(controller));

  // 公开接口（验证邀请码）
  router.get('/:code/verify', controller.verify.bind(controller));

  return router;
}

export default createInvitationRoutes;