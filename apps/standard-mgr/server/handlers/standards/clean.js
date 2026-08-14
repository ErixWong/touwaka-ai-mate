/**
 * clean handler — 服务端锚点清洗触发器
 *
 * POST /api/apps/standard-mgr/standards/:standardId/clean
 *
 * R13-1: 进程内驱动清洗专家跑一次 AgentLoop，无对话 UI。
 * R17-1: 编排全部收进 service.runCleaningPipeline()，本端点只负责
 *        鉴权 + 调用 + 按返回结果映射 409 / 成功。
 *
 * 并发约束：同一标准已有 processing 运行时返回 409。
 * 超时上限：15 分钟（在 service 内），超时置 error 并写明原因。
 * 鉴权：以触发操作的管理员身份运行。
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/standards/:standardId/clean',
};

export async function post(ctx, deps) {
  try {
    // 管理员权限校验
    if (!ctx.state.session?.isAdmin) {
      ctx.error('需要管理员权限', 403);
      return;
    }

    const userId = getUserId(ctx);
    if (!userId) {
      ctx.error('未登录', 401);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const { standardId } = ctx.params;

    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }

    // 获取 chatService（由 server/index.js 注入到 ctx）
    const chatService = deps.request?.chatService;
    if (!chatService) {
      ctx.error('ChatService 不可用', 500);
      return;
    }

    // R17-1：完整生命周期（锁、清 auto、驱动 agent、置 done、重建、回填）在 service 内编排
    const result = await service.runCleaningPipeline(standardId, {
      session: ctx.state.session,
      chatService,
    });

    if (!result.accepted) {
      ctx.error(result.reason || '该标准正在清洗中，请勿重复触发', 409);
      return;
    }

    ctx.success({ accepted: true, standard_id: standardId });
  } catch (err) {
    logger.error(`[standard-mgr] clean error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}

