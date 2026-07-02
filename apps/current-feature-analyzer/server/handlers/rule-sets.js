import { RuleSetService } from '../services/index.js';

// Handler 元数据：声明具名参数路径
export const route = {
  path: '/rule-sets/:id',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
};

function getUserId(ctx) {
  return ctx.state.session?.id || ctx.state.user?.id || null;
}

function isAdmin(ctx) {
  return (ctx.state.session?.isAdmin || false);
}

function requireAdmin(ctx) {
  if (!isAdmin(ctx)) {
    ctx.error('Admin required', 403);
    return false;
  }
  return true;
}

export async function get(ctx, deps) {
  try {
    const userId = getUserId(ctx);
    if (!userId) { ctx.error('Unauthorized', 401); return; }

    const { id } = ctx.params;
    const ruleSetService = new RuleSetService(deps.db);

    if (id) {
      const ruleSet = await ruleSetService.getRuleSet(id);
      if (!ruleSet) { ctx.error('Rule set not found', 404); return; }
      ctx.success(ruleSet);
    } else {
      const ruleSets = await ruleSetService.listRuleSets();
      ctx.success(ruleSets);
    }
  } catch (err) {
    ctx.error(err.message, 500);
  }
}

export async function post(ctx, deps) {
  if (!requireAdmin(ctx)) return;
  try {
    const ruleSetService = new RuleSetService(deps.db);
    const ruleSet = await ruleSetService.createRuleSet(ctx.request.body);
    ctx.success(ruleSet);
  } catch (err) {
    ctx.error(err.message, 400);
  }
}

export async function put(ctx, deps) {
  if (!requireAdmin(ctx)) return;
  try {
    const { id } = ctx.params;
    const ruleSetService = new RuleSetService(deps.db);
    const ruleSet = await ruleSetService.updateRuleSet(id, ctx.request.body);
    ctx.success(ruleSet);
  } catch (err) {
    ctx.error(err.message, 400);
  }
}

async function del(ctx, deps) {
  if (!requireAdmin(ctx)) return;
  try {
    const { id } = ctx.params;
    const ruleSetService = new RuleSetService(deps.db);
    await ruleSetService.deleteRuleSet(id);
    ctx.success(null, 'Deleted');
  } catch (err) {
    ctx.error(err.message, 400);
  }
}

export { del as delete };