import { RuleSetService } from '../../services/index.js';

export const route = {
  path: '/rule-sets/:id/copy',
  methods: ['POST'],
};

function isAdmin(ctx) {
  return ctx.state.session?.isAdmin || false;
}

function requireAdmin(ctx) {
  if (!isAdmin(ctx)) {
    ctx.error('Admin required', 403);
    return false;
  }
  return true;
}

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

export async function post(ctx, deps) {
  if (!requireAdmin(ctx)) return;

  try {
    const userId = getUserId(ctx);
    if (!userId) {
      ctx.error('Unauthorized', 401);
      return;
    }

    const { id, p0 } = ctx.params;
    const ruleSetId = id || p0;

    if (!ruleSetId) {
      ctx.error('id is required', 400);
      return;
    }

    const ruleSetService = new RuleSetService(deps.db);
    const copiedRuleSet = await ruleSetService.copy(ruleSetId, userId);
    ctx.success(copiedRuleSet);
  } catch (err) {
    ctx.error(err.message, 400);
  }
}
