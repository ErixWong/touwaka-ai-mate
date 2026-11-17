/**
 * standards/images handler
 *
 * GET /api/apps/standard-mgr/standards/:standardId/images
 *
 * 返回该标准正文里可渲染的图片：markdown 相对路径 + 可直接放进 <img src> 的 url。
 *
 * 存在理由：副本正文里的图是 OCR 产物的相对路径（`imgs/xxx.jpg` / `images/xxx.jpg`），
 * 而附件是 private，浏览器 `<img>` 带不上 Bearer 头，相对路径又会被当成 SPA 路由下的
 * 地址（实测 404）。只有 `/attach/t/<token>/<attachment_id>` 这条路走得通（与知识库查看器
 * 同一条通路）。这里负责签发 token 并把路径映射给前端，鉴权口径仍是文档读权限。
 *
 * 只读端点：不要求 admin，但必须是该文档的可读用户（service 内 canRead 判定）。
 */

import StandardMgrService from '../../service.js';
import logger from '../../../../../lib/logger.js';

function getUserId(ctx) {
  return ctx.state.session?.id || null;
}

export const route = {
  path: '/standards/:standardId/images',
};

export async function get(ctx, deps) {
  try {
    const { standardId } = ctx.params;
    if (!standardId) {
      ctx.error('standardId is required', 400);
      return;
    }

    const userId = getUserId(ctx);
    if (!userId) {
      ctx.error('未登录', 401);
      return;
    }

    const service = new StandardMgrService(deps.db);
    const result = await service.getStandardImages(standardId, userId);

    if (result === null) {
      ctx.error('Standard not found', 404);
      return;
    }
    if (result.forbidden) {
      ctx.error('无权访问该标准的文档', 403);
      return;
    }

    ctx.success(result);
  } catch (err) {
    logger.error(`[standard-mgr] images error: ${err.message}`);
    ctx.error(err.message, 500);
  }
}
