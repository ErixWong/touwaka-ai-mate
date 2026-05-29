import logger from '../../../lib/logger.js';
import path from 'path';
import { pathToFileURL } from 'url';

const ROWS_TABLE = 'app_invoice_mgr_rows';

export async function tick(context) {
  const { app, services } = context;
  
  if (!app) {
    logger.info('[invoice-mgr tick] No app found');
    return { skipped: true, reason: 'no_app' };
  }
  
  logger.info(`[invoice-mgr tick] App loaded: id=${app.id}, name=${app.name}`);
  
  const MiniAppRow = services.getModel('mini_app_row');
  const AppState = services.getModel('app_state');
  const AppRowHandler = services.getModel('app_row_handler');
  
  // 获取所有状态及其 handler 配置
  const states = await AppState.findAll({
    where: { app_id: app.id },
    raw: true,
  });
  
  // 找出有待处理记录的 handler 状态（有 handler_id 的非终态）
  const handlerStates = states.filter(s => s.handler_id && !s.is_terminal);
  
  if (handlerStates.length === 0) {
    logger.info('[invoice-mgr tick] No handler states found');
    return { skipped: true, reason: 'no_handler_states' };
  }
  
  // 获取所有 handler 信息
  const handlerIds = handlerStates.map(s => s.handler_id);
  const handlers = await AppRowHandler.findAll({
    where: { id: handlerIds },
    raw: true,
  });
  
  // 构建 handler_id -> handler name 的映射
  const handlerMap = {};
  for (const h of handlers) {
    handlerMap[h.id] = h.name;
  }
  
  // 收集所有需要处理的状态
  const statusList = handlerStates.map(s => s.name);
  
  // 查询待处理记录
  const pendingRecords = await MiniAppRow.findAll({
    where: {
      app_id: app.id,
      status: statusList
    },
    limit: 10,
    order: [['created_at', 'ASC']]
  });
  
  if (pendingRecords.length === 0) {
    logger.info('[invoice-mgr tick] No pending records');
    return { skipped: true, reason: 'no_data' };
  }
  
  logger.info(`[invoice-mgr tick] Found ${pendingRecords.length} pending records`);
  
  // 构建状态映射
  const stateMap = {};
  for (const s of states) {
    stateMap[s.name] = s;
  }
  
  let processed = 0;
  let errors = 0;
  
  for (const record of pendingRecords) {
    try {
      const currentState = stateMap[record.status];
      if (!currentState || !currentState.handler_id) {
        logger.warn(`[invoice-mgr tick] Record ${record.id}: No handler for status ${record.status}`);
        continue;
      }
      
      // 从 handler_id 获取 handler 名称
      const handlerName = handlerMap[currentState.handler_id];
      if (!handlerName) {
        logger.error(`[invoice-mgr tick] Record ${record.id}: Handler not found for handler_id ${currentState.handler_id}`);
        await updateStatus(services, record.id, currentState.failure_next_state || 'extract_failed');
        errors++;
        continue;
      }
      
      // 加载 handler
      const handlerModule = await loadHandler(app.id, handlerName);
      if (!handlerModule || !handlerModule.default?.process) {
        logger.error(`[invoice-mgr tick] Record ${record.id}: Handler ${handlerName} not found or has no process function`);
        await updateStatus(services, record.id, currentState.failure_next_state || 'extract_failed');
        errors++;
        continue;
      }
      
      // 获取文件
      const files = await services.getFiles(record.id);
      
      // 构建 context
      const handlerContext = {
        record: record.toJSON(),
        files,
        services: {
          callSkill: services.callSkill,
          callMcp: services.callMcp,
          callExtension: services.callExtension,
          query: services.query,
          execute: services.execute,
          getModel: services.getModel,
        }
      };
      
      // 执行 handler
      logger.info(`[invoice-mgr tick] Executing handler ${handlerName} for record ${record.id}`);
      const result = await handlerModule.default.process(handlerContext);
      
      // 根据结果更新状态
      if (result && result.success) {
        const nextStatus = currentState.success_next_state || 'pending_review';
        await updateStatus(services, record.id, nextStatus);
        logger.info(`[invoice-mgr tick] Record ${record.id}: Handler succeeded, status -> ${nextStatus}`);
      } else {
        const nextStatus = currentState.failure_next_state || 'extract_failed';
        await updateStatus(services, record.id, nextStatus);
        logger.info(`[invoice-mgr tick] Record ${record.id}: Handler failed (${result?.error || 'unknown'}), status -> ${nextStatus}`);
      }
      
      processed++;
    } catch (e) {
      logger.error(`[invoice-mgr tick] Record ${record.id} failed: ${e.message}`);
      errors++;
    }
  }
  
  logger.info(`[invoice-mgr tick] Processed ${processed} records, errors: ${errors}`);
  return { success: true, processed, errors };
}

async function loadHandler(appId, handlerName) {
  const handlerPath = path.join(process.cwd(), 'apps', appId, 'handlers', handlerName, 'index.js');
  
  try {
    const module = await import(`${pathToFileURL(handlerPath).href}?t=${Date.now()}`);
    return module;
  } catch (e) {
    logger.error(`[invoice-mgr tick] Failed to load handler ${handlerName}: ${e.message}`);
    return null;
  }
}

async function updateStatus(services, recordId, newStatus) {
  const MiniAppRow = services.getModel('mini_app_row');
  await MiniAppRow.update({ status: newStatus }, { where: { id: recordId } });
}