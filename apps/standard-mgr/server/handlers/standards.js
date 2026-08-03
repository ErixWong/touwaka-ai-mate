/**
 * standards handler
 *
 * GET /api/apps/standard-mgr/standards — 列表（R2-4：忽略客户端 enterprise_id）
 * GET /api/apps/standard-mgr/standards/:standardId — 详情
 *
 * 路由扁平化（R2-3）：合并原 list.js + get.js 为单文件，按 ctx.params.standardId 有无分流。
 */

import StandardMgrService from '../service.js';
import logger from '../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

// R3-3：去掉 ? — 路由器 extractNamedParams 不支持 ? 语法，
// 用 ':' 即可；少一段时不提取参数，自然走列表分支
export const route = {
  path: '/standards/:standardId',
};

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    const service = new StandardMgrService(deps.db);

    // R2-4：在企业对象用户映射落地前，忽略客户端传入的 enterprise_id
    // 统一按"不过滤"处理，由 getStandard/listStandards 内部按实际需求处理

    if (ctx.params.standardId) {
      // 获取单个标准详情
      const standard = await service.getStandard(ctx.params.standardId);
      if (!standard) {
        ctx.throw(404, 'Standard not found');
      }
      ctx.success(standard);
      return;
    }

    // 列出标准
    const standard_type = ctx.query.standard_type || null;
    const is_active = ctx.query.is_active !== undefined ? parseInt(ctx.query.is_active, 10) : undefined;

    // R2-4 过渡策略：不过滤 enterprise_id，返回全部
    const standards = await service.listAllStandards({ standard_type, is_active });
    ctx.success(standards);
  } catch (err) {
    logger.error(`[standard-mgr] standards error: ${err.message}`);
    ctx.error(err.message, err.status || 500);
  }
}
