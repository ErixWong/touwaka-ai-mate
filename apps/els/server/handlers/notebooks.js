/**
 * ELS 词本
 * GET  /api/apps/els/notebooks        → 词本列表
 * POST /api/apps/els/notebooks/select → 切换选中词本
 */
import ELSService from '../services/index.js';
import { safeCall, getUserId, ERROR_HTTP_STATUS } from './_helpers.js';

let els;

export async function get(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const selectedNotebookId = await els.resolveSelectedNotebookId(userId);
    const items = await els.notebook.list(userId);

    const result = items.map((item) => ({
      ...item,
      is_selected: item.id === selectedNotebookId,
    }));

    ctx.success({
      selected_notebook_id: selectedNotebookId,
      items: result,
    });
  });
}

export async function post(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const { notebook_id } = ctx.request.body || {};

    if (!notebook_id) {
      ctx.error('ELS_INVALID_STATUS', 409);
      return;
    }

    const notebook = await els.notebook.getById(notebook_id);
    if (!notebook) {
      ctx.error('ELS_NOT_FOUND', ERROR_HTTP_STATUS.ELS_NOT_FOUND);
      return;
    }
    if (notebook.user_id !== userId) {
      ctx.error('ELS_FORBIDDEN', ERROR_HTTP_STATUS.ELS_FORBIDDEN);
      return;
    }

    await els.preference.setSelectedNotebook(userId, notebook_id);
    ctx.success({
      selected_notebook_id: notebook_id,
      selected_notebook_name: notebook.name,
    });
  });
}
