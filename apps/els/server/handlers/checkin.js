/**
 * ELS 签到
 * GET /api/apps/els/checkin → 今日签到状态
 */
import ELSService from '../services/index.js';
import { safeCall, getUserId } from './_helpers.js';

let els;

export async function get(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const result = await els.checkin.getToday(userId);
    ctx.success(result);
  });
}
