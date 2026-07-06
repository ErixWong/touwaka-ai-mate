import { UploadSessionService } from '../server/services/index.js';

export async function tick(context) {
  if (!context?.db) {
    return { ok: true, skipped: true, reason: 'no_db_deps' };
  }

  try {
    const db = context.db;
    const uploadSessionService = new UploadSessionService(db);
    uploadSessionService.pruneExpiredSessions();

    return {
      ok: true,
      skipped: false,
      reason: 'pruned_expired_sessions',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export default { tick }
