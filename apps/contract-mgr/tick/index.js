import logger from '../../../lib/logger.js';
import path from 'path';
import fs from 'fs/promises';

const CONTENT_TABLE = 'app_contract_mgr_content';
const ROWS_TABLE = 'app_contract_mgr_rows';

const DEFAULT_CHUNK_MAX_LENGTH = parseInt(process.env.TEXT_FILTER_MAX_LENGTH) || 50000;

export async function tick(context) {
  const { app, services } = context;
  
  if (!app) {
    logger.info('[contract-mgr tick] No app found');
    return { skipped: true, reason: 'no_app' };
  }
  
  logger.info(`[contract-mgr tick] App loaded: id=${app.id}, name=${app.name}, config type=${typeof app.config}`);
  
  const MiniAppRow = services.getModel('mini_app_row');
  
  const pendingRecords = await MiniAppRow.findAll({
    where: {
      app_id: 'contract-mgr',
      status: ['pending_ocr', 'ocr_submitted', 'pending_filter', 'pending_extract', 'pending_section']
    },
    limit: 5,
    order: [['created_at', 'ASC']]
  });
  
  if (pendingRecords.length === 0) {
    logger.info('[contract-mgr tick] No pending records');
    return { skipped: true, reason: 'no_data' };
  }
  
  let processed = 0;
  
  for (const record of pendingRecords) {
    try {
      await processRecord(record, app, services);
      processed++;
    } catch (e) {
      logger.error(`[contract-mgr tick] Record ${record.id} failed: ${e.message}`);
    }
  }
  
  logger.info(`[contract-mgr tick] Processed ${processed} records`);
  return { success: true, processed };
}

async function processRecord(record, app, services) {
  const status = record.status;
  
  switch (status) {
    case 'pending_ocr':
      await handleOcrSubmit(record, app, services);
      break;
    case 'ocr_submitted':
      await handleOcrCheck(record, app, services);
      break;
    case 'pending_filter':
      await handleFilter(record, app, services);
      break;
    case 'pending_extract':
      await handleExtract(record, app, services);
      break;
    case 'pending_section':
      await handleSection(record, app, services);
      break;
  }
}

function getConfig(app, stepName) {
  let config = app?.config;
  logger.info(`[contract-mgr tick] getConfig: app.config type=${typeof config}, preview=${typeof config === 'string' ? config.substring(0, 200) : 'object'}`);
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  const stepConfig = config?.step_resources?.[stepName] || {};
  logger.info(`[contract-mgr tick] getConfig stepConfig for ${stepName}: ${JSON.stringify(stepConfig).substring(0, 200)}`);
  return stepConfig;
}

function parseLlmResponse(response) {
  const text = response?.text || response?.parsed || '';
  if (typeof text !== 'string') return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
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

async function handleOcrSubmit(record, app, services) {
  logger.info(`[contract-mgr tick] Submitting OCR for ${record.id}`);
  
  const files = await getFiles(services, record.id);
  const file = files[0]?.attachment;
  
  if (!file) {
    await updateStatus(services, record.id, 'ocr_failed');
    return;
  }
  
  const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
  const fullPath = path.resolve(basePath, file.file_path);
  
  let buffer;
  try {
    buffer = await fs.readFile(fullPath);
  } catch (e) {
    logger.error(`[contract-mgr tick] Failed to read file: ${e.message}`);
    await updateStatus(services, record.id, 'ocr_failed');
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
    const result = await services.callMcp(mcp.server, mcp.tool, params);
    
    logger.info(`[contract-mgr tick] OCR response: ${JSON.stringify(result).substring(0, 500)}`);
    
    let taskId = '';
    
    const parsePrompt = `从以下 MCP 工具调用结果中提取 task_id（任务ID）。
如果结果中包含任务ID，返回JSON格式：{"task_id": "提取的ID值"}
如果没有找到task_id但有其他标识符（如id、job_id等），也提取出来。
如果完全无法提取，返回：{"task_id": ""}

MCP返回结果：
${JSON.stringify(result).substring(0, 1000)}`;

    try {
      const ocrSubmittedConfig = getConfig(app, 'ocr_submitted');
      const parsed = await services.llm.extractJson(parsePrompt, '', {
        modelId: ocrSubmittedConfig.judge_model_id || null,
        temperature: 0.1,
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
      await updateStatus(services, record.id, 'ocr_failed');
      return;
    }
    
    const data = record.data ? JSON.parse(record.data) : {};
    data._ocr_task_id = taskId;
    data._ocr_service = mcp.server;
    
    await updateRecordData(services, record.id, data, 'ocr_submitted');
    logger.info(`[contract-mgr tick] OCR submitted, task_id=${taskId}`);
  } catch (e) {
    logger.error(`[contract-mgr tick] OCR submit failed: ${e.message}`);
    await updateStatus(services, record.id, 'ocr_failed');
  }
}

async function handleOcrCheck(record, app, services) {
  logger.info(`[contract-mgr tick] Checking OCR for ${record.id}`);
  
  const data = record.data ? JSON.parse(record.data) : {};
  const taskId = data._ocr_task_id;
  
  if (!taskId) {
    await updateStatus(services, record.id, 'ocr_failed');
    return;
  }
  
  const config = getConfig(app, 'ocr_submitted');
  const mcp = config.mcp || { server: 'markitdown', tool: 'get_task' };
  
  try {
    const result = await services.callMcp(mcp.server, mcp.tool || 'get_task', { task_id: taskId });
    
    const judgePrompt = `判断OCR任务是否完成。任务返回信息：${JSON.stringify(result).substring(0, 1000)}。返回JSON：{"status": "completed|pending|failed", "progress": 0-100}`;
    
    const judgeResult = await services.llm.extractJson(judgePrompt, '', {
      modelId: config.judge_model_id || null,
      temperature: config.judge_temperature || 0.1,
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
        [record.id, ocrText, mcp.server]
      );
      
      await updateStatus(services, record.id, 'pending_filter');
      logger.info(`[contract-mgr tick] OCR completed, text length=${ocrText.length}`);
    } else if (parsed.status === 'failed') {
      await updateStatus(services, record.id, 'ocr_failed');
    }
  } catch (e) {
    logger.error(`[contract-mgr tick] OCR check failed: ${e.message}`);
  }
}

async function handleFilter(record, app, services) {
  logger.info(`[contract-mgr tick] Filtering text for ${record.id}`);
  
  const contentRows = await services.query(
    `SELECT ocr_text FROM ${CONTENT_TABLE} WHERE row_id = ?`,
    [record.id]
  );
  
  if (!contentRows.length || !contentRows[0].ocr_text) {
    await updateStatus(services, record.id, 'filter_failed');
    return;
  }
  
  const ocrText = contentRows[0].ocr_text;
  const config = getConfig(app, 'pending_filter');
  const filterPrompt = '去除页码、水印、乱码，保留正文';
  
  try {
    const filteredText = await services.llm.generateText(filterPrompt, ocrText, {
      modelId: config.model_id || null,
      temperature: config.temperature || 0.3,
    }) || ocrText;
    
    await services.execute(
      `UPDATE ${CONTENT_TABLE} SET filtered_text = ?, filter_at = NOW() WHERE row_id = ?`,
      [filteredText, record.id]
    );
    
    await updateStatus(services, record.id, 'pending_extract');
    logger.info(`[contract-mgr tick] Filter completed, length=${filteredText.length}`);
  } catch (e) {
    logger.error(`[contract-mgr tick] Filter failed: ${e.message}`);
    await updateStatus(services, record.id, 'filter_failed');
  }
}

async function handleExtract(record, app, services) {
  logger.info(`[contract-mgr tick] Extracting metadata for ${record.id}`);
  
  const contentRows = await services.query(
    `SELECT filtered_text FROM ${CONTENT_TABLE} WHERE row_id = ?`,
    [record.id]
  );
  
  if (!contentRows.length || !contentRows[0].filtered_text) {
    await updateStatus(services, record.id, 'extract_failed');
    return;
  }
  
  const config = getConfig(app, 'pending_extract');
  const extractPrompt = `从文本中提取元数据：合同编号、甲方、乙方、上级公司、合同金额、签订日期。返回JSON格式：{"contract_number": "...", "party_a": "...", "party_b": "...", "parent_company": "...", "contract_amount": 0, "contract_date": "YYYY-MM-DD"}`;
  
  try {
    const metadata = await services.llm.extractJson(extractPrompt, contentRows[0].filtered_text, {
      modelId: config.model_id || null,
      temperature: config.temperature || 0.3,
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
    
    await updateStatus(services, record.id, 'pending_section');
    logger.info(`[contract-mgr tick] Extract completed`);
  } catch (e) {
    logger.error(`[contract-mgr tick] Extract failed: ${e.message}`);
    await updateStatus(services, record.id, 'extract_failed');
  }
}

async function handleSection(record, app, services) {
  logger.info(`[contract-mgr tick] Analyzing sections for ${record.id}`);
  
  const contentRows = await services.query(
    `SELECT filtered_text FROM ${CONTENT_TABLE} WHERE row_id = ?`,
    [record.id]
  );
  
  if (!contentRows.length || !contentRows[0].filtered_text) {
    await updateStatus(services, record.id, 'section_failed');
    return;
  }
  
  const config = getConfig(app, 'pending_section');
  const sectionPrompt = '分析章节结构，返回JSON：{"sections": [{"title": "章节标题", "level": 1}]}';
  
  try {
    const result = await services.llm.extractJson(sectionPrompt, contentRows[0].filtered_text, {
      modelId: config.model_id || null,
      temperature: config.temperature || 0.3,
    });
    const sections = result?.sections || [];
    
    await services.execute(
      `UPDATE ${CONTENT_TABLE} SET sections = ? WHERE row_id = ?`,
      [JSON.stringify(sections), record.id]
    );
    
    await updateStatus(services, record.id, 'pending_review');
    logger.info(`[contract-mgr tick] Section completed, found ${sections.length} sections`);
  } catch (e) {
    logger.error(`[contract-mgr tick] Section failed: ${e.message}`);
    await updateStatus(services, record.id, 'section_failed');
  }
}

async function updateStatus(services, recordId, newStatus) {
  const MiniAppRow = services.getModel('mini_app_row');
  await MiniAppRow.update({ status: newStatus }, { where: { id: recordId } });
}

async function updateRecordData(services, recordId, data, newStatus) {
  const MiniAppRow = services.getModel('mini_app_row');
  await MiniAppRow.update(
    { data: JSON.stringify(data), status: newStatus },
    { where: { id: recordId } }
  );
}