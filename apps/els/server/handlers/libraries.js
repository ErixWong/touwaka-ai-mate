/**
 * ELS 学习库
 * GET  /api/apps/els/libraries              → 学习库列表
 * POST /api/apps/els/libraries/select       → 切换选中学习库
 *
 * 嵌套（见 libraries/materials.js）：
 * GET  /api/apps/els/libraries/:library_id/materials → 库内材料列表
 */
import ELSService from '../services/index.js';
import { safeCall, getUserId } from './_helpers.js';

let els;

export async function get(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const selectedLibraryId = await els.resolveSelectedLibraryId(userId);
    const items = await els.library.list(userId);

    const result = items.map((item) => ({
      ...item,
      is_selected: item.id === selectedLibraryId,
    }));

    ctx.success({
      selected_library_id: selectedLibraryId,
      items: result.filter((item) => item.type !== 'shared'),
    });
  });
}

export async function post(ctx, deps) {
  await safeCall(ctx, async () => {
    if (!els) els = new ELSService(deps.db);
    const userId = getUserId(ctx);
    const { library_id } = ctx.request.body || {};

    if (!library_id) {
      ctx.error('ELS_NOT_FOUND', 404, '学习库 ID 为空');
      return;
    }

    const library = await els.library.getById(library_id);
    if (!library) {
      ctx.error('ELS_NOT_FOUND', 404);
      return;
    }
    if (library.library_type === 'personal' && library.owner_user_id !== userId) {
      ctx.error('ELS_FORBIDDEN', 403);
      return;
    }

    await els.preference.setSelectedLibrary(userId, library_id);
    ctx.success({
      selected_library_id: library_id,
      selected_library_name: library.name,
    });
  });
}
