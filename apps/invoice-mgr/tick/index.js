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

/**
 * 构建结构化失败信息，写入 record.data._last_failure
 * 不新增数据库字段，利用现有 data JSON 承载故障分类
 */
function buildFailurePayload(result, stage, status) {
  return {
    _last_failure: {
      failure_stage: stage,
      failure_code: result.failure_code || 'unknown',
      failure_message: result.error || 'unknown',
      failed_status: status,
      failed_at: new Date().toISOString(),
    },
  };
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
        // 成功后清理旧失败信息，防止残留 _last_failure 误导后续排障
        if (newData._last_failure) {
          delete newData._last_failure;
        }
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
        // 失败路径：合并 handler 输出的 data + 结构化失败信息
        const failurePayload = buildFailurePayload(result, graphEntry.handler, row.status);
        const mergedHandlerData = mergeRecordData(result.data || {}, failurePayload);
        const newData = mergeRecordData(recordData, mergedHandlerData);
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

      // 即使 handler 硬崩溃，也尝试写入 _last_failure 到 record.data
      // 使用独立的 try/catch，写入失败不阻断其他记录处理
      try {
        const crashPayload = buildFailurePayload(
          { failure_code: 'handler_crash', error: e.message },
          graphEntry?.handler || 'unknown',
          row.status
        );
        const crashData = mergeRecordData(recordData, crashPayload);
        await services.execute(
          'UPDATE app_invoice_mgr_records SET data = ? WHERE id = ?',
          [JSON.stringify(crashData), row.id]
        );
      } catch (writeErr) {
        logger.error(`[invoice-mgr tick] Row ${row.id} failed to write _last_failure: ${writeErr.message}`);
      }
    }
  }

  logger.info(`[invoice-mgr tick] Processed ${processed} records`);
  return { success: true, processed };
}
