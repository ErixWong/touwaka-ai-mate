import path from 'path';
import { pathToFileURL } from 'url';
import logger from '../../../lib/logger.js';
import { getManifestStates, resolveAttachmentPath, validateManifestStates } from '../handlers/shared.js';

const APP_ID = 'invoice-mgr';

function loadHandlersModule(handlerDir, handlerName) {
  const handlerPath = pathToFileURL(path.join(handlerDir, handlerName, 'index.js')).href;
  return import(handlerPath);
}

function getPendingStates(states) {
  return states
    .filter(s => s.handler && !s.is_terminal && !s.is_error)
    .map(s => s.name);
}

function mergeRecordData(existingData, handlerData) {
  if (!handlerData) return existingData;
  const data = typeof existingData === 'string' ? JSON.parse(existingData || '{}') : { ...(existingData || {}) };
  if (typeof handlerData === 'object' && !Array.isArray(handlerData)) {
    Object.assign(data, handlerData);
  }
  return data;
}

export async function tick(context) {
  const { app, services } = context;

  if (!app) {
    return { skipped: true, reason: 'no_app' };
  }

  const states = getManifestStates(app);

  if (states.length === 0) {
    logger.warn('[invoice-mgr tick] No states defined in manifest');
    return { skipped: true, reason: 'no_states' };
  }

  const manifestValidation = validateManifestStates(app);
  if (!manifestValidation.valid) {
    logger.warn(`[invoice-mgr tick] Ghost states in step_resources (not in states): ${manifestValidation.orphans.join(', ')}`);
  }

  const pendingStates = getPendingStates(states);
  if (pendingStates.length === 0) {
    return { skipped: true, reason: 'no_pending_states' };
  }

  const stateMap = new Map(states.map(s => [s.name, s]));

  const placeholders = pendingStates.map(() => '?').join(',');
  const rows = await services.query(
    `SELECT id, status, data FROM mini_app_rows
     WHERE app_id = ? AND status IN (${placeholders})
     ORDER BY created_at ASC
     LIMIT 5`,
    [APP_ID, ...pendingStates]
  );

  if (rows.length === 0) {
    return { skipped: true, reason: 'no_pending_records' };
  }

  const handlersDir = path.join(process.cwd(), 'apps', APP_ID, 'handlers');
  let processed = 0;

  for (const row of rows) {
    try {
      const state = stateMap.get(row.status);
      if (!state || !state.handler) continue;

      logger.info(`[invoice-mgr tick] Processing row ${row.id} (status=${row.status}, handler=${state.handler})`);

      const recordData = row.data ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : {};
      const record = { id: row.id, status: row.status, data: recordData };

      const files = await services.getFiles(row.id);

      for (const file of files) {
        if (file.attachment) {
          if (!file.attachment._resolvedPath) {
            file.attachment._resolvedPath = resolveAttachmentPath(file.attachment);
          }
        }
      }

      const handlerModule = await loadHandlersModule(handlersDir, state.handler);
      const handlerFn = handlerModule.default || handlerModule;

      const result = await handlerFn.process({ record, files, services, app });

      if (result.pending) {
        const newData = mergeRecordData(recordData, result.data);
        await services.execute(
          'UPDATE mini_app_rows SET data = ? WHERE id = ?',
          [JSON.stringify(newData), row.id]
        );
        logger.info(`[invoice-mgr tick] Row ${row.id}: pending, keep status=${row.status}`);
      } else if (result.success) {
        const newData = mergeRecordData(recordData, result.data);
        const nextState = state.success_next;

        if (nextState) {
          await services.execute(
            'UPDATE mini_app_rows SET status = ?, data = ? WHERE id = ?',
            [nextState, JSON.stringify(newData), row.id]
          );
          logger.info(`[invoice-mgr tick] Row ${row.id}: ${row.status} → ${nextState}`);
        } else {
          await services.execute(
            'UPDATE mini_app_rows SET data = ? WHERE id = ?',
            [JSON.stringify(newData), row.id]
          );
          logger.warn(`[invoice-mgr tick] Row ${row.id} success but no success_next defined for ${row.status}`);
        }
      } else {
        const newData = mergeRecordData(recordData, result.data);
        const nextState = state.failure_next;

        if (nextState) {
          await services.execute(
            'UPDATE mini_app_rows SET status = ?, data = ? WHERE id = ?',
            [nextState, JSON.stringify(newData), row.id]
          );
          logger.warn(`[invoice-mgr tick] Row ${row.id}: ${row.status} → ${nextState} (error: ${result.error || 'unknown'})`);
        } else {
          await services.execute(
            'UPDATE mini_app_rows SET data = ? WHERE id = ?',
            [JSON.stringify(newData), row.id]
          );
          logger.warn(`[invoice-mgr tick] Row ${row.id} failed but no failure_next defined for ${row.status}`);
        }
      }

      processed++;
    } catch (e) {
      logger.error(`[invoice-mgr tick] Row ${row.id} error: ${e.message}`);
      logger.error(`[invoice-mgr tick] Row ${row.id} stack: ${e.stack}`);
    }
  }

  logger.info(`[invoice-mgr tick] Processed ${processed} records`);
  return { success: true, processed };
}
