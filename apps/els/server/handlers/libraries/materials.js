/**
 * ELS 库内材料
 * GET /api/apps/els/libraries/:library_id/materials → 指定学习库的材料列表
 *
 * URL 映射：/libraries/:library_id/materials → 本文件，params.p0 = library_id
 */
import ELSService from '../../services/index.js';
import { safeCall, getUserId } from '../_helpers.js';

let els;

export async function get(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const result = await els.library.getMaterials(ctx.params.p0, userId);
    ctx.success(result);
  });
}
