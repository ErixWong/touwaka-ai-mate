import path from 'path';
import { pathToFileURL } from 'url';
import logger from '../../../lib/logger.js';
import { resolveAttachmentPath } from '../handlers/shared.js';

const APP_ID = 'invoice-mgr';
const HANDLERS_DIR = path.join(process.cwd(), 'apps', APP_ID, 'handlers');

const STATE_GRAPH = {
  pending_process: {
    handler: 'invoice-extract',
    success_next: 'pending_review',
    failure_next: 'pending_vl_extract',
  },
  pending_vl_extract: {
    handler: 'invoice-vl-extract',
    success_next: 'pending_review',
    failure_next: 'extract_failed',
  },
};

function loadHandlersModule(handlerDir, handlerName) {
  const handlerPath = pathToFileURL(path.join(handlerDir, handlerName, 'index.js')).href;
  return import(handlerPath);
}

function mergeRecordData(existingData, handlerData) {
  if (!handlerData) return existingData;
  const data = typeof existingData === 'string' ? JSON.parse(existingData || '{}') : { ...(existingData || {}) };
  if (typeof handlerData === 'object' && !Array.isArray(handlerData)) {
    Object.assign(data, handlerData);
  }
  return data;
}

export function getStateGraph() {
  return STATE_GRAPH;
}

export async function tick(context) {
  const { app, services } = context;

  if (!app) {
    return { skipped: true, reason: 'no_app' };
  }

  const stateNames = Object.keys(STATE_GRAPH);

  if (stateNames.length === 0) {
    return { skipped: true, reason: 'no_states' };
  }

  const placeholders = stateNames.map(() => '?').join(',');
  const rows = await services.query(
    `SELECT id, status, data FROM app_invoice_mgr_records
     WHERE status IN (${placeholders})
     ORDER BY created_at ASC
     LIMIT 5`,
    stateNames
  );

  if (rows.length === 0) {
    return { skipped: true, reason: 'no_pending_records' };
  }

  let processed = 0;

  for (const row of rows) {
    try {
      const graphEntry = STATE_GRAPH[row.status];
      if (!graphEntry) continue;

      logger.info(`[invoice-mgr tick] Processing row ${row.id} (status=${row.status}, handler=${graphEntry.handler})`);

      const recordData = row.data ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : {};
      const record = { id: row.id, status: row.status, data: recordData };

      const [fileRows] = await services.execute(
        `SELECT a.id, a.file_name, a.file_path, a.mime_type, a.ext_name
         FROM attachments a
         JOIN app_invoice_mgr_records r ON r.attachment_id = a.id
         WHERE r.id = ?`,
        [row.id]
      );
      const files = fileRows.map(r => ({
        attachment: {
          id: r.id,
          file_name: r.file_name,
          file_path: r.file_path,
          mime_type: r.mime_type,
          ext_name: r.ext_name,
        },
      }));

      for (const file of files) {
        if (file.attachment) {
          if (!file.attachment._resolvedPath) {
            file.attachment._resolvedPath = resolveAttachmentPath(file.attachment);
          }
        }
      }

      const handlerModule = await loadHandlersModule(HANDLERS_DIR, graphEntry.handler);
      const handlerFn = handlerModule.default || handlerModule;

      const result = await handlerFn.process({ record, files, services, app });

      if (result.pending) {
        const newData = mergeRecordData(recordData, result.data);
        await services.execute(
          'UPDATE app_invoice_mgr_records SET data = ? WHERE id = ?',
          [JSON.stringify(newData), row.id]
        );
        logger.info(`[invoice-mgr tick] Row ${row.id}: pending, keep status=${row.status}`);
      } else if (result.success) {
        const newData = mergeRecordData(recordData, result.data);
        const nextState = graphEntry.success_next;

        if (nextState) {
          await services.execute(
            'UPDATE app_invoice_mgr_records SET status = ?, data = ? WHERE id = ?',
            [nextState, JSON.stringify(newData), row.id]
          );
          logger.info(`[invoice-mgr tick] Row ${row.id}: ${row.status} → ${nextState}`);
        } else {
          await services.execute(
            'UPDATE app_invoice_mgr_records SET data = ? WHERE id = ?',
            [JSON.stringify(newData), row.id]
          );
          logger.warn(`[invoice-mgr tick] Row ${row.id} success but no success_next defined for ${row.status}`);
        }
      } else {
        const newData = mergeRecordData(recordData, result.data);
        const nextState = result.target_state || graphEntry.failure_next;

        if (nextState) {
          await services.execute(
            'UPDATE app_invoice_mgr_records SET status = ?, data = ? WHERE id = ?',
            [nextState, JSON.stringify(newData), row.id]
          );
          logger.warn(`[invoice-mgr tick] Row ${row.id}: ${row.status} → ${nextState} (error: ${result.error || 'unknown'})`);
        } else {
          await services.execute(
            'UPDATE app_invoice_mgr_records SET data = ? WHERE id = ?',
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
