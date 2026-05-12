import logger from '../../../lib/logger.js';
import { splitIntoChunks, parseLlmResponse, getStepResource, getPrompt, buildLlmParams } from '../handlers/shared.js';

const CONTENT_TABLE = 'app_contract_mgr_v2_content';
const ROWS_TABLE = 'app_contract_mgr_v2_rows';

const CONTRACT_FIELDS = [
  { name: 'contract_number', label: '合同编号', guide: '查找合同编号，通常在合同首页顶部' },
  { name: 'party_a', label: '甲方', guide: '查找甲方名称' },
  { name: 'party_b', label: '乙方', guide: '查找乙方名称' },
  { name: 'parent_company', label: '上级公司', guide: '如果甲方是子公司，推断上级公司' },
  { name: 'contract_amount', label: '合同金额', guide: '查找合同总金额' },
  { name: 'contract_date', label: '签订日期', guide: '查找签订日期，格式 YYYY-MM-DD' },
];

const DEFAULT_CHUNK_MAX_LENGTH = parseInt(process.env.TEXT_FILTER_MAX_LENGTH) || 50000;

const JSON_FORMAT_PROMPT = `
返回JSON格式：
{
  "processed_text": "本轮清洗后的完整章节内容",
  "carried_over": "末尾不完整章节的原文"
}`;

export async function tick(context) {
  const { db, app, registry, services } = context;
  
  if (!app) {
    logger.info('[tick] No app found');
    return { skipped: true, reason: 'no_app' };
  }
  
  const lastRun = await services.query(`
    SELECT created_at FROM app_tick_log
    WHERE registry_id = ? AND success = 1
    ORDER BY created_at DESC LIMIT 1
  `, [registry.id]);
  
  if (lastRun.length > 0) {
    const elapsed = Date.now() - new Date(lastRun[0].created_at).getTime();
    const minInterval = 10 * 60 * 1000;
    
    if (elapsed < minInterval) {
      logger.info(`[tick] Skipped: last run ${Math.round(elapsed/1000)}s ago`);
      return { skipped: true, reason: 'interval_not_reached' };
    }
  }
  
  const pending = await services.query(`
    SELECT id, status, data FROM mini_app_rows 
    WHERE app_id = ? AND status IN ('pending_ocr', 'ocr_submitted', 'pending_filter', 'pending_extract', 'pending_section')
    LIMIT 5
  `, [app.id]);
  
  if (pending.length === 0) {
    logger.info('[tick] No pending records');
    return { skipped: true, reason: 'no_data' };
  }
  
  let processed = 0;
  
  for (const row of pending) {
    try {
      await processRow(row, app, services);
      processed++;
    } catch (e) {
      logger.error(`[tick] Row ${row.id} failed: ${e.message}`);
    }
  }
  
  logger.info(`[tick] Processed ${processed} records`);
  return { success: true, processed };
}

async function processRow(row, app, services) {
  const rowData = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
  
  switch (row.status) {
    case 'pending_ocr':
      await handleOcrSubmit(row, rowData, app, services);
      break;
    case 'ocr_submitted':
      await handleOcrCheck(row, rowData, app, services);
      break;
    case 'pending_filter':
      await handleFilter(row, app, services);
      break;
    case 'pending_extract':
      await handleExtract(row, app, services);
      break;
    case 'pending_section':
      await handleSection(row, app, services);
      break;
  }
}

async function handleOcrSubmit(row, rowData, app, services) {
  logger.info(`[tick] Submitting OCR for ${row.id}`);
  
  const files = await services.getFiles(row.id);
  if (!files || files.length === 0) {
    await services.execute(`UPDATE mini_app_rows SET status = 'ocr_failed' WHERE id = ?`, [row.id]);
    return;
  }
  
  const file = files[0];
  const attachment = file.attachment || file;
  
  const config = getStepResource(app, 'pending_ocr', {});
  const mcp = config.mcp || { server: 'markitdown', tool: 'submit_conversion_task' };
  
  try {
    const result = await services.callMcp(mcp.server, mcp.tool, {
      content: attachment.base64 || attachment.content,
      filename: attachment.filename || attachment.name
    });
    
    let taskId;
    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result);
        taskId = parsed.task_id || parsed.id || result;
      } catch {
        taskId = result;
      }
    } else {
      taskId = result.task_id || result.id || JSON.stringify(result);
    }
    
    const newData = { ...rowData, _ocr_task_id: taskId };
    await services.execute(
      `UPDATE mini_app_rows SET status = 'ocr_submitted', data = ? WHERE id = ?`,
      [JSON.stringify(newData), row.id]
    );
    
    logger.info(`[tick] OCR submitted for ${row.id}, task_id=${taskId}`);
  } catch (e) {
    await services.execute(`UPDATE mini_app_rows SET status = 'ocr_failed' WHERE id = ?`, [row.id]);
    logger.error(`[tick] OCR submit failed for ${row.id}: ${e.message}`);
  }
}

async function handleOcrCheck(row, rowData, app, services) {
  logger.info(`[tick] Checking OCR for ${row.id}`);
  
  const taskId = rowData._ocr_task_id;
  if (!taskId) {
    await services.execute(`UPDATE mini_app_rows SET status = 'ocr_failed' WHERE id = ?`, [row.id]);
    return;
  }
  
  const config = getStepResource(app, 'ocr_submitted', {});
  const mcp = config.mcp || { server: 'markitdown', tool: 'get_task' };
  
  try {
    const mcpResult = await services.callMcp(mcp.server, mcp.tool || 'get_task', { task_id: taskId });
    
    const taskInfo = JSON.stringify(mcpResult, null, 2).substring(0, 1000);
    
    const judgePrompt = `判断OCR任务是否完成。
任务返回信息：
${taskInfo}

返回JSON：{"status": "completed|pending|failed", "progress": 0-100}`;
    
    const judgeResult = await services.callLlm('judge_ocr_status', {
      instruction: judgePrompt,
      model_id: config.judge_model_id,
      temperature: config.judge_temperature || 0.1,
      response_format: 'json'
    });
    
    const parsed = parseLlmResponse(judgeResult) || { status: 'pending', progress: 0 };
    
    if (parsed.status === 'completed') {
      let ocrText = extractTextFromMcpResult(mcpResult);
      ocrText = ocrText.replace(/\\n/g, '\n');
      
      await services.callExtension(CONTENT_TABLE, 'upsert', {
        row_id: row.id,
        ocr_text: ocrText,
        ocr_service: mcp.server,
        ocr_at: new Date()
      });
      
      await services.execute(`UPDATE mini_app_rows SET status = 'pending_filter' WHERE id = ?`, [row.id]);
      logger.info(`[tick] OCR completed for ${row.id}, text length=${ocrText.length}`);
    } else if (parsed.status === 'pending') {
      logger.info(`[tick] OCR pending for ${row.id}, progress=${parsed.progress}`);
    } else {
      await services.execute(`UPDATE mini_app_rows SET status = 'ocr_failed' WHERE id = ?`, [row.id]);
    }
  } catch (e) {
    logger.error(`[tick] OCR check failed for ${row.id}: ${e.message}`);
  }
}

function extractTextFromMcpResult(mcpResult) {
  if (!mcpResult) return '';
  if (typeof mcpResult === 'string') return mcpResult;
  if (mcpResult.result) return typeof mcpResult.result === 'string' ? mcpResult.result : JSON.stringify(mcpResult.result);
  if (mcpResult.content) return typeof mcpResult.content === 'string' ? mcpResult.content : JSON.stringify(mcpResult.content);
  if (mcpResult.text) return mcpResult.text;
  return JSON.stringify(mcpResult);
}

async function handleFilter(row, app, services) {
  logger.info(`[tick] Filtering text for ${row.id}`);
  
  const content = await services.callExtension(CONTENT_TABLE, 'read', {
    row_id: row.id,
    fields: ['ocr_text']
  });
  
  if (!content || !content.ocr_text) {
    await services.execute(`UPDATE mini_app_rows SET status = 'filter_failed' WHERE id = ?`, [row.id]);
    return;
  }
  
  const filterConfig = getStepResource(app, 'pending_filter', { temperature: 0.3 });
  const filterPrompt = getPrompt(app, 'filter', '去除页码、水印、乱码，保留正文');
  const maxLen = filterConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
  
  let filteredText;
  
  if (content.ocr_text.length <= maxLen) {
    try {
      const response = await services.callLlm('filter_text', {
        instruction: filterPrompt + JSON_FORMAT_PROMPT,
        ocr_text: content.ocr_text,
        response_format: 'json',
        ...buildLlmParams(filterConfig)
      });
      const parsed = parseLlmResponse(response);
      filteredText = parsed?.processed_text || content.ocr_text;
    } catch (e) {
      filteredText = content.ocr_text;
    }
  } else {
    filteredText = await filterWithSlidingWindow(content.ocr_text, filterPrompt, filterConfig, services);
  }
  
  await services.callExtension(CONTENT_TABLE, 'upsert', {
    row_id: row.id,
    filtered_text: filteredText,
    filter_at: new Date()
  });
  
  await services.execute(`UPDATE mini_app_rows SET status = 'pending_extract' WHERE id = ?`, [row.id]);
  logger.info(`[tick] Filter completed for ${row.id}, length=${filteredText.length}`);
}

async function filterWithSlidingWindow(ocrText, filterPrompt, filterConfig, services) {
  const maxLen = filterConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
  const chunks = splitIntoChunks(ocrText, maxLen);
  
  const allProcessed = [];
  let carriedOver = '';
  
  for (let i = 0; i < chunks.length; i++) {
    const chunkInput = carriedOver + (carriedOver ? '\n' : '') + chunks[i];
    
    try {
      const response = await services.callLlm('filter_text', {
        instruction: filterPrompt + JSON_FORMAT_PROMPT,
        ocr_text: chunkInput,
        response_format: 'json',
        ...buildLlmParams(filterConfig)
      });
      const result = parseLlmResponse(response);
      allProcessed.push(result?.processed_text || chunkInput);
      carriedOver = result?.carried_over || '';
    } catch (e) {
      allProcessed.push(chunkInput);
      carriedOver = '';
    }
  }
  
  return allProcessed.join('\n');
}

async function handleExtract(row, app, services) {
  logger.info(`[tick] Extracting metadata for ${row.id}`);
  
  const content = await services.callExtension(CONTENT_TABLE, 'read', {
    row_id: row.id,
    fields: ['filtered_text']
  });
  
  if (!content || !content.filtered_text) {
    await services.execute(`UPDATE mini_app_rows SET status = 'extract_failed' WHERE id = ?`, [row.id]);
    return;
  }
  
  const extractConfig = getStepResource(app, 'pending_extract', { temperature: 0.3 });
  
  const fieldDefs = CONTRACT_FIELDS.map(f => `- ${f.name} (${f.label}): ${f.guide}`).join('\n');
  const exampleJson = CONTRACT_FIELDS.map(f => `  "${f.name}": "值"`).join(',\n');
  
  const prompt = `从文本中提取元数据。
字段定义:
${fieldDefs}

返回JSON:
{
${exampleJson}
}`;
  
  try {
    const response = await services.callLlm('extract_metadata', {
      instruction: prompt,
      ocr_text: content.filtered_text,
      response_format: 'json',
      ...buildLlmParams(extractConfig)
    });
    
    const metadata = parseLlmResponse(response);
    
    if (!metadata) {
      await services.execute(`UPDATE mini_app_rows SET status = 'extract_failed' WHERE id = ?`, [row.id]);
      return;
    }
    
    const cleanMetadata = {};
    for (const field of CONTRACT_FIELDS) {
      const value = metadata[field.name];
      if (!value) continue;
      
      if (field.name === 'contract_amount') {
        const num = Number(String(value).replace(/[,，]/g, ''));
        if (!isNaN(num)) cleanMetadata[field.name] = num;
      } else if (field.name === 'contract_date') {
        const dateStr = String(value).replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) cleanMetadata[field.name] = dateStr;
      } else {
        cleanMetadata[field.name] = value;
      }
    }
    
    await services.callExtension(ROWS_TABLE, 'upsert', {
      row_id: row.id,
      ...cleanMetadata
    });
    
    await services.callExtension(CONTENT_TABLE, 'upsert', {
      row_id: row.id,
      extract_json: JSON.stringify(cleanMetadata),
      extract_model: extractConfig.model_id,
      extract_temperature: extractConfig.temperature,
      extract_at: new Date()
    });
    
    await services.execute(`UPDATE mini_app_rows SET status = 'pending_section' WHERE id = ?`, [row.id]);
    logger.info(`[tick] Extract completed for ${row.id}`);
  } catch (e) {
    await services.execute(`UPDATE mini_app_rows SET status = 'extract_failed' WHERE id = ?`, [row.id]);
    logger.error(`[tick] Extract failed for ${row.id}: ${e.message}`);
  }
}

async function handleSection(row, app, services) {
  logger.info(`[tick] Analyzing sections for ${row.id}`);
  
  const content = await services.callExtension(CONTENT_TABLE, 'read', {
    row_id: row.id,
    fields: ['filtered_text']
  });
  
  if (!content || !content.filtered_text) {
    await services.execute(`UPDATE mini_app_rows SET status = 'section_failed' WHERE id = ?`, [row.id]);
    return;
  }
  
  const sectionConfig = getStepResource(app, 'pending_section', { temperature: 0.3 });
  const sectionPrompt = getPrompt(app, 'section', '分析章节结构');
  
  const jsonFormat = `
返回JSON:
{
  "sections": [
    { "title": "章节标题", "level": 1, "index": 0, "summary": "摘要" }
  ]
}`;
  
  try {
    const response = await services.callLlm('analyze_sections', {
      instruction: sectionPrompt + jsonFormat,
      ocr_text: content.filtered_text,
      response_format: 'json',
      ...buildLlmParams(sectionConfig)
    });
    
    const result = parseLlmResponse(response);
    const sections = result?.sections || result;
    
    if (!Array.isArray(sections)) {
      await services.execute(`UPDATE mini_app_rows SET status = 'section_failed' WHERE id = ?`, [row.id]);
      return;
    }
    
    await services.callExtension(CONTENT_TABLE, 'upsert', {
      row_id: row.id,
      sections: JSON.stringify(sections)
    });
    
    await services.execute(`UPDATE mini_app_rows SET status = 'pending_review' WHERE id = ?`, [row.id]);
    logger.info(`[tick] Section completed for ${row.id}, found ${sections.length} sections`);
  } catch (e) {
    await services.execute(`UPDATE mini_app_rows SET status = 'section_failed' WHERE id = ?`, [row.id]);
    logger.error(`[tick] Section failed for ${row.id}: ${e.message}`);
  }
}