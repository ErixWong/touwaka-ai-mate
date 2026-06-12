import logger from '../../../lib/logger.js';
import path from 'path';
import fs from 'fs/promises';

const CONTENT_TABLE = 'app_contract_mgr_content';
const ROWS_TABLE = 'app_contract_mgr_rows';

const DEFAULT_CHUNK_MAX_LENGTH = parseInt(process.env.TEXT_FILTER_MAX_LENGTH) || 50000;

const PENDING_STATES = ['pending_ocr', 'pending_clean', 'pending_extract', 'pending_section'];
const SYNC_PROCESSING_STATES = ['cleaning', 'extract_processing', 'section_processing'];
const OCR_PROCESSING_STATE = 'ocr_processing';
const ALL_ACTIVE_STATES = [...PENDING_STATES, OCR_PROCESSING_STATE, ...SYNC_PROCESSING_STATES];

const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

function backfillStartedAt(record, data, status) {
  const fallback = record.updated_at || record.created_at;
  const now = new Date().toISOString();
  const startedAt = fallback ? new Date(fallback).toISOString() : now;
  
  data._processing_started_at = startedAt;
  data._processing_step = status;
  
  if (fallback) {
    const elapsed = Math.round((Date.now() - new Date(fallback).getTime()) / 60000);
    logger.info(`[contract-mgr tick] Backfilled _processing_started_at for ${record.id} from record timestamp, elapsed ~${elapsed}min`);
  } else {
    logger.info(`[contract-mgr tick] Backfilled _processing_started_at for ${record.id} with current time (no record timestamp available)`);
  }
  
  return startedAt;
}

export async function tick(context) {
  const { app, services } = context;
  
  if (!app) {
    logger.info('[contract-mgr tick] No app found');
    return { skipped: true, reason: 'no_app' };
  }
  
  logger.info(`[contract-mgr tick] App loaded: id=${app.id}, name=${app.name}`);
  
  const MiniAppRow = services.getModel('mini_app_row');
  
  const pendingRecords = await MiniAppRow.findAll({
    where: {
      app_id: 'contract-mgr',
      status: ALL_ACTIVE_STATES
    },
    limit: 5,
    order: [['created_at', 'ASC']]
  });
  
  if (pendingRecords.length === 0) {
    logger.info('[contract-mgr tick] No pending records');
    return { skipped: true, reason: 'no_data' };
  }
  
  let processed = 0;
  let skipped = 0;
  
  for (const record of pendingRecords) {
    const status = record.status;
    
    if (SYNC_PROCESSING_STATES.includes(status)) {
      const data = record.data ? JSON.parse(record.data) : {};
      let startedAt = data._processing_started_at;
      
      if (!startedAt) {
        startedAt = backfillStartedAt(record, data, status);
        await MiniAppRow.update(
          { data: JSON.stringify(data) },
          { where: { id: record.id } }
        );
      }
      
      const elapsed = Date.now() - new Date(startedAt).getTime();
      if (elapsed > PROCESSING_TIMEOUT_MS) {
        logger.warn(`[contract-mgr tick] Record ${record.id} in ${status} for ${Math.round(elapsed/60000)} minutes - may be stuck`);
      }
      
      logger.info(`[contract-mgr tick] Skipping ${record.id}: sync processing ${status} already in progress`);
      skipped++;
      continue;
    }
    
    if (status === OCR_PROCESSING_STATE) {
      const data = record.data ? JSON.parse(record.data) : {};
      let startedAt = data._processing_started_at;
      
      if (!startedAt) {
        startedAt = backfillStartedAt(record, data, status);
        await MiniAppRow.update(
          { data: JSON.stringify(data) },
          { where: { id: record.id } }
        );
      }
      
      const elapsed = Date.now() - new Date(startedAt).getTime();
      if (elapsed > PROCESSING_TIMEOUT_MS) {
        logger.warn(`[contract-mgr tick] Record ${record.id} in ocr_processing for ${Math.round(elapsed/60000)} minutes - OCR may be stuck`);
      }
    }
    
    try {
      await processRecord(record, app, services);
      processed++;
    } catch (e) {
      logger.error(`[contract-mgr tick] Record ${record.id} failed: ${e.message}`);
    }
  }
  
  logger.info(`[contract-mgr tick] Processed ${processed}, skipped ${skipped} records`);
  return { success: true, processed, skipped };
}

async function processRecord(record, app, services) {
  const status = record.status;
  
  switch (status) {
    case 'pending_ocr':
      await handleOcr(record, app, services);
      break;
    case 'ocr_processing':
      await handleOcrProcessing(record, app, services);
      break;
    case 'pending_clean':
      await handleClean(record, app, services);
      break;
    case 'cleaning':
      logger.info(`[contract-mgr tick] Skipping ${record.id}: cleaning already in progress`);
      break;
    case 'pending_extract':
      await handleExtract(record, app, services);
      break;
    case 'extract_processing':
      logger.info(`[contract-mgr tick] Skipping ${record.id}: extraction already in progress`);
      break;
    case 'pending_section':
      await handleSection(record, app, services);
      break;
    case 'section_processing':
      logger.info(`[contract-mgr tick] Skipping ${record.id}: section analysis already in progress`);
      break;
    default:
      logger.warn(`[contract-mgr tick] Unknown status ${status} for ${record.id}`);
  }
}

function getConfig(app, stepName) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config?.step_resources?.[stepName] || {};
}

function parseLlmResponse(response) {
  const text = response?.text || response?.parsed || '';
  if (typeof text !== 'string') return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function splitTextIntoChunks(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return [text];
  }

  const paragraphs = text.split('\n\n');
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 <= maxLength) {
      current += `${current ? '\n\n' : ''}${paragraph}`;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }

    let remaining = paragraph;
    while (remaining.length > maxLength) {
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }

    current = remaining;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [text];
}

async function filterTextByChunks(recordId, services, prompt, text, options) {
  const maxLength = options.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
  const chunks = splitTextIntoChunks(text, maxLength);
  logger.info(`[contract-mgr tick] Filter input length=${text.length}, chunks=${chunks.length}`);

  const results = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const chunkPrompt = chunks.length > 1
      ? `${prompt}\n\n这是第 ${index + 1}/${chunks.length} 段，请只返回清洗后的正文，不要解释，不要补充原文中不存在的内容。`
      : prompt;

    logger.info(`[contract-mgr tick] Filtering chunk ${index + 1}/${chunks.length} for ${recordId}`);
    const filteredChunk = await services.llm.generateText(chunkPrompt, chunk, options);
    results.push(filteredChunk || chunk);
  }

  return results.join('\n\n');
}

async function getFiles(services, recordId) {
  const MiniAppFile = services.getModel('mini_app_file');
  const Attachment = services.getModel('attachment');
  
  const files = await MiniAppFile.findAll({
    where: { record_id: recordId },
    include: Attachment ? [{ model: Attachment, as: 'attachment' }] : []
  });
  
  return files.map(f => f.toJSON());
}

async function transitionToProcessing(services, recordId, processingState, expectedCurrentState) {
  const MiniAppRow = services.getModel('mini_app_row');
  const record = await MiniAppRow.findByPk(recordId);
  const data = record.data ? JSON.parse(record.data) : {};
  data._processing_started_at = new Date().toISOString();
  data._processing_step = processingState;
  
  const [affectedRows] = await MiniAppRow.update(
    { status: processingState, data: JSON.stringify(data) },
    { where: { id: recordId, status: expectedCurrentState } }
  );
  
  if (affectedRows === 0) {
    logger.warn(`[contract-mgr tick] Record ${recordId} transition to ${processingState} failed - status may have changed`);
    return { success: false, data: null };
  }
  
  logger.info(`[contract-mgr tick] Record ${recordId} atomically transitioned from ${expectedCurrentState} to ${processingState}`);
  return { success: true, data };
}

async function transitionToNext(services, recordId, nextState, clearProcessing = true) {
  const MiniAppRow = services.getModel('mini_app_row');
  const record = await MiniAppRow.findByPk(recordId);
  const data = record.data ? JSON.parse(record.data) : {};
  
  if (clearProcessing) {
    delete data._processing_started_at;
    delete data._processing_step;
  }
  
  await MiniAppRow.update(
    { status: nextState, data: JSON.stringify(data) },
    { where: { id: recordId } }
  );
  
  logger.info(`[contract-mgr tick] Record ${recordId} transitioned to ${nextState}`);
}

async function transitionToFailed(services, recordId, failedState) {
  const MiniAppRow = services.getModel('mini_app_row');
  const record = await MiniAppRow.findByPk(recordId);
  const data = record.data ? JSON.parse(record.data) : {};
  data._failed_at = new Date().toISOString();
  data._failed_step = failedState;
  delete data._processing_started_at;
  delete data._processing_step;
  
  await MiniAppRow.update(
    { status: failedState, data: JSON.stringify(data) },
    { where: { id: recordId } }
  );
  
  logger.info(`[contract-mgr tick] Record ${recordId} transitioned to ${failedState}`);
}

async function handleOcr(record, app, services) {
  logger.info(`[contract-mgr tick] Starting OCR for ${record.id}`);
  
  const result = await transitionToProcessing(services, record.id, 'ocr_processing', 'pending_ocr');
  if (!result.success) {
    logger.warn(`[contract-mgr tick] Skip ${record.id}: failed to acquire ocr_processing lock`);
    return;
  }
  
  const existingData = result.data || {};
  const existingTaskId = existingData._ocr_task_id;
  
  if (existingTaskId) {
    logger.info(`[contract-mgr tick] OCR task already submitted for ${record.id}, taskId=${existingTaskId}`);
    return;
  }
  
  const files = await getFiles(services, record.id);
  const file = files[0]?.attachment;
  
  if (!file) {
    await transitionToFailed(services, record.id, 'ocr_failed');
    return;
  }
  
  const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
  const fullPath = path.resolve(basePath, file.file_path);
  
  let buffer;
  try {
    buffer = await fs.readFile(fullPath);
  } catch (e) {
    logger.error(`[contract-mgr tick] Failed to read file: ${e.message}`);
    await transitionToFailed(services, record.id, 'ocr_failed');
    return;
  }
  
  const config = getConfig(app, 'pending_ocr');
  const mcp = config.mcp || { server: 'markitdown', tool: 'submit_conversion_task' };
  
  const params = {};
  if (mcp.params_mapping) {
    for (const [key, src] of Object.entries(mcp.params_mapping)) {
      if (src === 'file.base64') params[key] = buffer.toString('base64');
      else if (src === 'file.name') params[key] = file.file_name;
    }
  } else {
    params.content = buffer.toString('base64');
    params.filename = file.file_name;
  }
  
  try {
    const result = await services.callMcp(mcp.server, mcp.tool, params, config.timeout_ms ?? 1200000);
    
    logger.info(`[contract-mgr tick] OCR submit response: ${JSON.stringify(result).substring(0, 500)}`);
    
    let taskId = '';
    
    const parsePrompt = `从以下 MCP 工具调用结果中提取 task_id（任务ID）。
如果结果中包含任务ID，返回JSON格式：{"task_id": "提取的ID值"}
如果没有找到task_id但有其他标识符（如id、job_id等），也提取出来。
如果完全无法提取，返回：{"task_id": ""}

MCP返回结果：
${JSON.stringify(result).substring(0, 1000)}`;

    try {
      const ocrProcessingConfig = getConfig(app, 'ocr_processing');
      const parsed = await services.llm.extractJson(parsePrompt, '', {
        modelId: ocrProcessingConfig.judge_model_id || null,
        temperature: 0.1,
        timeout: ocrProcessingConfig.timeout_ms ?? 600000,
        defaultValue: { task_id: '' },
      });

      if (parsed && parsed.task_id) {
        taskId = parsed.task_id;
        logger.info(`[contract-mgr tick] OCR task_id extracted by LLM: ${taskId}`);
      }
    } catch (e) {
      logger.warn(`[contract-mgr tick] LLM parse failed: ${e.message}`);
    }
    
    if (!taskId) {
      if (typeof result === 'string') taskId = result;
      else if (result?.task_id) taskId = result.task_id;
      else if (result?.id) taskId = result.id;
      else if (result?.result?.task_id) taskId = result.result.task_id;
    }
    
    if (!taskId) {
      logger.error(`[contract-mgr tick] No task_id returned after all parsing attempts`);
      await transitionToFailed(services, record.id, 'ocr_failed');
      return;
    }
    
    const MiniAppRow = services.getModel('mini_app_row');
    const currentRecord = await MiniAppRow.findByPk(record.id);
    const data = currentRecord.data ? JSON.parse(currentRecord.data) : {};
    data._ocr_task_id = taskId;
    data._ocr_service = mcp.server;
    
    await MiniAppRow.update(
      { data: JSON.stringify(data) },
      { where: { id: record.id } }
    );
    
    logger.info(`[contract-mgr tick] OCR task submitted for ${record.id}, taskId=${taskId}`);
  } catch (e) {
    logger.error(`[contract-mgr tick] OCR submit failed: ${e.message}`);
    await transitionToFailed(services, record.id, 'ocr_failed');
  }
}

async function handleOcrProcessing(record, app, services) {
  logger.info(`[contract-mgr tick] Checking OCR status for ${record.id}`);
  
  const data = record.data ? JSON.parse(record.data) : {};
  const taskId = data._ocr_task_id;
  
  if (!taskId) {
    logger.warn(`[contract-mgr tick] No task_id found for ${record.id} in ocr_processing, reverting to pending_ocr`);
    await transitionToNext(services, record.id, 'pending_ocr', false);
    return;
  }
  
  await checkOcrAndComplete(record.id, app, services, taskId, data._ocr_service || 'markitdown');
}

async function checkOcrAndComplete(recordId, app, services, taskId, ocrService) {
  logger.info(`[contract-mgr tick] Checking OCR status for ${recordId}, taskId=${taskId}`);
  
  const config = getConfig(app, 'ocr_processing');
  const mcp = config.mcp || { server: 'markitdown', tool: 'get_task' };
  
  try {
    const result = await services.callMcp(mcp.server, mcp.tool || 'get_task', { task_id: taskId }, config.timeout_ms ?? 600000);
    
    const judgePrompt = `判断OCR任务是否完成。任务返回信息：${JSON.stringify(result).substring(0, 1000)}。返回JSON：{"status": "completed|pending|failed", "progress": 0-100}`;
    
    const judgeResult = await services.llm.extractJson(judgePrompt, '', {
      modelId: config.judge_model_id || null,
      temperature: config.judge_temperature || 0.1,
      timeout: config.timeout_ms ?? 600000,
      defaultValue: { status: 'pending', progress: 0 },
    });

    const parsed = { ...judgeResult };
    if (!parsed.status) parsed.status = 'pending';
    
    if (parsed.status === 'completed') {
      const ocrText = result.content || result.text || result.output || JSON.stringify(result);
      
      await services.execute(
        `INSERT INTO ${CONTENT_TABLE} (row_id, ocr_text, ocr_service, ocr_at, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW(), NOW())
         ON DUPLICATE KEY UPDATE ocr_text = VALUES(ocr_text), ocr_service = VALUES(ocr_service), ocr_at = VALUES(ocr_at)`,
        [recordId, ocrText, ocrService]
      );
      
      await transitionToNext(services, recordId, 'pending_clean');
      logger.info(`[contract-mgr tick] OCR completed for ${recordId}, text length=${ocrText.length}`);
    } else if (parsed.status === 'failed') {
      await transitionToFailed(services, recordId, 'ocr_failed');
    } else {
      logger.info(`[contract-mgr tick] OCR still pending for ${recordId}, progress=${parsed.progress}`);
    }
  } catch (e) {
    logger.error(`[contract-mgr tick] OCR check failed for ${recordId}: ${e.message}`);
  }
}

async function handleClean(record, app, services) {
  logger.info(`[contract-mgr tick] Starting text cleaning for ${record.id}`);
  
  const result = await transitionToProcessing(services, record.id, 'cleaning', 'pending_clean');
  if (!result.success) {
    logger.warn(`[contract-mgr tick] Skip ${record.id}: failed to acquire cleaning lock`);
    return;
  }
  
  const contentRows = await services.query(
    `SELECT ocr_text FROM ${CONTENT_TABLE} WHERE row_id = ?`,
    [record.id]
  );
  
  if (!contentRows.length || !contentRows[0].ocr_text) {
    await transitionToFailed(services, record.id, 'clean_failed');
    return;
  }
  
  const ocrText = contentRows[0].ocr_text;
  const config = getConfig(app, 'cleaning');
  const filterPrompt = '去除页码、水印、乱码，保留正文';
  const timeout = config.timeout_ms ?? 600000;
  const chunkMaxLength = config.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;

  try {
    const filteredText = await filterTextByChunks(record.id, services, filterPrompt, ocrText, {
      modelId: config.model_id || null,
      temperature: config.temperature || 0.3,
      timeout,
      chunk_max_length: chunkMaxLength,
    }) || ocrText;
    
    await services.execute(
      `UPDATE ${CONTENT_TABLE} SET filtered_text = ?, filter_at = NOW() WHERE row_id = ?`,
      [filteredText, record.id]
    );
    
    await transitionToNext(services, record.id, 'pending_extract');
    logger.info(`[contract-mgr tick] Cleaning completed for ${record.id}, length=${filteredText.length}`);
  } catch (e) {
    logger.error(`[contract-mgr tick] Cleaning failed for ${record.id}: ${e.message}`);
    await transitionToFailed(services, record.id, 'clean_failed');
  }
}

async function handleExtract(record, app, services) {
  logger.info(`[contract-mgr tick] Starting metadata extraction for ${record.id}`);
  
  const result = await transitionToProcessing(services, record.id, 'extract_processing', 'pending_extract');
  if (!result.success) {
    logger.warn(`[contract-mgr tick] Skip ${record.id}: failed to acquire extract_processing lock`);
    return;
  }
  
  const contentRows = await services.query(
    `SELECT filtered_text FROM ${CONTENT_TABLE} WHERE row_id = ?`,
    [record.id]
  );
  
  if (!contentRows.length || !contentRows[0].filtered_text) {
    await transitionToFailed(services, record.id, 'extract_failed');
    return;
  }
  
  const config = getConfig(app, 'extract_processing');
  const extractPrompt = `从文本中提取元数据：合同编号、甲方、乙方、上级公司、合同金额、签订日期。返回JSON格式：{"contract_number": "...", "party_a": "...", "party_b": "...", "parent_company": "...", "contract_amount": 0, "contract_date": "YYYY-MM-DD"}`;
  const timeout = config.timeout_ms ?? 600000;

  try {
    const metadata = await services.llm.extractJson(extractPrompt, contentRows[0].filtered_text, {
      modelId: config.model_id || null,
      temperature: config.temperature || 0.3,
      timeout,
    });
    
    if (metadata) {
      await services.execute(
        `INSERT INTO ${ROWS_TABLE} (row_id, contract_number, party_a, party_b, parent_company, contract_amount, contract_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE contract_number = VALUES(contract_number), party_a = VALUES(party_a), party_b = VALUES(party_b), parent_company = VALUES(parent_company), contract_amount = VALUES(contract_amount), contract_date = VALUES(contract_date)`,
        [record.id, metadata.contract_number || null, metadata.party_a || null, metadata.party_b || null, metadata.parent_company || null, metadata.contract_amount || null, metadata.contract_date || null]
      );
      
      await services.execute(
        `UPDATE ${CONTENT_TABLE} SET extract_json = ?, extract_at = NOW() WHERE row_id = ?`,
        [JSON.stringify(metadata), record.id]
      );
    }
    
    await transitionToNext(services, record.id, 'pending_section');
    logger.info(`[contract-mgr tick] Extraction completed for ${record.id}`);
  } catch (e) {
    logger.error(`[contract-mgr tick] Extraction failed for ${record.id}: ${e.message}`);
    await transitionToFailed(services, record.id, 'extract_failed');
  }
}

async function handleSection(record, app, services) {
  logger.info(`[contract-mgr tick] Starting section analysis for ${record.id}`);
  
  const result = await transitionToProcessing(services, record.id, 'section_processing', 'pending_section');
  if (!result.success) {
    logger.warn(`[contract-mgr tick] Skip ${record.id}: failed to acquire section_processing lock`);
    return;
  }
  
  const contentRows = await services.query(
    `SELECT filtered_text FROM ${CONTENT_TABLE} WHERE row_id = ?`,
    [record.id]
  );
  
  if (!contentRows.length || !contentRows[0].filtered_text) {
    await transitionToFailed(services, record.id, 'section_failed');
    return;
  }
  
  const config = getConfig(app, 'section_processing');
  const sectionPrompt = '分析章节结构，返回JSON：{"sections": [{"title": "章节标题", "level": 1}]}';
  const timeout = config.timeout_ms ?? 600000;

  try {
    const result = await services.llm.extractJson(sectionPrompt, contentRows[0].filtered_text, {
      modelId: config.model_id || null,
      temperature: config.temperature || 0.3,
      timeout,
    });
    const sections = result?.sections || [];
    
    await services.execute(
      `UPDATE ${CONTENT_TABLE} SET sections = ? WHERE row_id = ?`,
      [JSON.stringify(sections), record.id]
    );
    
    await transitionToNext(services, record.id, 'pending_review');
    logger.info(`[contract-mgr tick] Section analysis completed for ${record.id}, found ${sections.length} sections`);
  } catch (e) {
    logger.error(`[contract-mgr tick] Section analysis failed for ${record.id}: ${e.message}`);
    await transitionToFailed(services, record.id, 'section_failed');
  }
}