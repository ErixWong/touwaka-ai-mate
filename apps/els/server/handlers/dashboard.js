/**
 * GET /api/apps/els/dashboard → 学习工作台
 */
import ELSService from '../services/index.js';
import { safeCall, getUserId } from './_helpers.js';

let els;

export async function get(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const result = await els.getDashboard(userId);
    ctx.success(result);
  });
}
