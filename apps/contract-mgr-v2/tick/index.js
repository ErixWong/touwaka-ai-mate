import logger from '../../../lib/logger.js';
import path from 'path';
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
  const { app, registry, services } = context;
  
  if (!app) {
    logger.info('[tick] No app found');
    return { skipped: true, reason: 'no_app' };
  }
  
  const pending = await services.query(`
    SELECT row_id, process_step, ocr_task_id, file_id, filter_carried_over, filter_chunk_index
    FROM ${CONTENT_TABLE}
    WHERE process_step IN ('pending_ocr', 'ocr_submitted', 'pending_filter', 'pending_extract', 'pending_section')
    ORDER BY created_at ASC
    LIMIT 5
  `);
  
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
      logger.error(`[tick] Row ${row.row_id} failed: ${e.message}`);
    }
  }
  
  logger.info(`[tick] Processed ${processed} records`);
  return { success: true, processed };
}

async function processRow(row, app, services) {
  switch (row.process_step) {
    case 'pending_ocr':
      await handleOcrSubmit(row, app, services);
      break;
    case 'ocr_submitted':
      await handleOcrCheck(row, app, services);
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

async function handleOcrSubmit(row, app, services) {
  logger.info(`[tick] Submitting OCR for ${row.row_id}`);
  
  if (!row.file_id) {
    await updateProcessStep(services, row.row_id, 'ocr_failed');
    return;
  }
  
  // 获取文件信息（用于 params_mapping）
  const fileInfo = await services.query(`
    SELECT a.id, a.file_name, a.file_path
    FROM attachments a
    WHERE a.id = ?
  `, [row.file_id]);
  
  if (!fileInfo || fileInfo.length === 0) {
    await updateProcessStep(services, row.row_id, 'ocr_failed');
    return;
  }
  
  const file = fileInfo[0];
  
  // 读取文件为 base64
  const fullPath = path.join(process.cwd(), 'data', 'attachments', file.file_path);
  const fs = await import('fs/promises');
  const buffer = await fs.readFile(fullPath);
  const base64 = buffer.toString('base64');
  
  const config = getStepResource(app, 'pending_ocr', {});
  const mcp = config.mcp || { server: 'markitdown', tool: 'submit_conversion_task' };
  
  logger.info(`[tick] OCR MCP config: server=${mcp.server}, tool=${mcp.tool}`);
  logger.info(`[tick] OCR file: ${file.file_name}, size=${buffer.length} bytes`);
  
  try {
    const params = {};
    if (mcp.params_mapping) {
      for (const [paramKey, sourcePath] of Object.entries(mcp.params_mapping)) {
        if (sourcePath === 'file.base64') {
          params[paramKey] = base64;
        } else if (sourcePath === 'file.name') {
          params[paramKey] = file.file_name;
        }
      }
    } else {
      params.content = base64;
      params.filename = file.file_name;
    }
    
    logger.info(`[tick] OCR request params: filename=${params.filename || params.name}, base64_length=${base64.length}`);
    logger.debug(`[tick] OCR request full params keys: ${Object.keys(params).join(', ')}`);
    
    const result = await services.callMcp(mcp.server, mcp.tool, params);
    
    logger.info(`[tick] OCR response type: ${typeof result}`);
    logger.debug(`[tick] OCR response: ${JSON.stringify(result).substring(0, 500)}`);
    
    let taskId = '';
    
    const parsePrompt = `从以下 MCP 工具调用结果中提取 task_id（任务ID）。
如果结果中包含任务ID，返回JSON格式：{"task_id": "提取的ID值"}
如果没有找到task_id但有其他标识符（如id、job_id等），也提取出来。
如果完全无法提取，返回：{"task_id": ""}

MCP返回结果：
${JSON.stringify(result).substring(0, 1000)}`;

    try {
      const parseResult = await services.callLlm('parse_task_id', {
        instruction: parsePrompt,
        response_format: 'json',
        model_id: config.parse_model_id,
        temperature: 0.1,
      });
      
      const parsed = parseLlmResponse(parseResult);
      if (parsed && parsed.task_id) {
        taskId = parsed.task_id;
        logger.info(`[tick] OCR task_id extracted by LLM: ${taskId}`);
      }
    } catch (e) {
      logger.warn(`[tick] LLM parse failed, fallback to hardcoded: ${e.message}`);
    }
    
    if (!taskId) {
      if (typeof result === 'string') {
        taskId = result;
      } else if (typeof result === 'object' && result !== null) {
        taskId = result.task_id || result.id || result.result?.task_id || '';
        if (!taskId && result.content) {
          try {
            const parsed = JSON.parse(result.content);
            taskId = parsed.task_id || parsed.id || '';
          } catch (e) {
            logger.warn(`[tick] Failed to parse result.content: ${e.message}`);
          }
        }
      }
    }
    
    if (!taskId) {
      logger.error(`[tick] OCR returned no task_id for ${row.row_id}, result: ${JSON.stringify(result).substring(0, 200)}`);
      await updateProcessStep(services, row.row_id, 'ocr_failed');
      return;
    }
    
    await services.execute(`
      UPDATE ${CONTENT_TABLE} 
      SET process_step = 'ocr_submitted', ocr_task_id = ?
      WHERE row_id = ?
    `, [taskId, row.row_id]);
    
    logger.info(`[tick] OCR submitted for ${row.row_id}, task_id=${taskId}`);
  } catch (e) {
    await updateProcessStep(services, row.row_id, 'ocr_failed');
    logger.error(`[tick] OCR submit failed for ${row.row_id}: ${e.message}`);
    logger.error(`[tick] OCR submit error stack: ${e.stack}`);
    logger.error(`[tick] OCR submit error details: ${JSON.stringify({ name: e.name, message: e.message, code: e.code, cause: e.cause })}`);
  }
}

async function handleOcrCheck(row, app, services) {
  logger.info(`[tick] Checking OCR for ${row.row_id}`);
  
  const taskId = row.ocr_task_id;
  if (!taskId) {
    await updateProcessStep(services, row.row_id, 'ocr_failed');
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
      
      await services.execute(`
        UPDATE ${CONTENT_TABLE} 
        SET process_step = 'pending_filter', ocr_text = ?, ocr_service = ?, ocr_at = NOW()
        WHERE row_id = ?
      `, [ocrText, mcp.server, row.row_id]);
      
      logger.info(`[tick] OCR completed for ${row.row_id}, text length=${ocrText.length}`);
    } else if (parsed.status === 'pending') {
      logger.info(`[tick] OCR pending for ${row.row_id}, progress=${parsed.progress}`);
    } else {
      await updateProcessStep(services, row.row_id, 'ocr_failed');
    }
  } catch (e) {
    logger.error(`[tick] OCR check failed for ${row.row_id}: ${e.message}`);
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
  logger.info(`[tick] Filtering text for ${row.row_id}`);
  
  const content = await services.query(`
    SELECT ocr_text, filter_carried_over, filter_chunk_index FROM ${CONTENT_TABLE}
    WHERE row_id = ?
  `, [row.row_id]);
  
  if (!content.length || !content[0].ocr_text) {
    await updateProcessStep(services, row.row_id, 'filter_failed');
    return;
  }
  
  const ocrText = content[0].ocr_text;
  const existingCarriedOver = content[0].filter_carried_over || '';
  const existingChunkIndex = content[0].filter_chunk_index || 0;
  
  const filterConfig = getStepResource(app, 'pending_filter', { temperature: 0.3 });
  const filterPrompt = getPrompt(app, 'filter', '去除页码、水印、乱码，保留正文');
  const maxLen = filterConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
  
  let filteredText;
  
  if (ocrText.length <= maxLen) {
    try {
      const response = await services.callLlm('filter_text', {
        instruction: filterPrompt + JSON_FORMAT_PROMPT,
        ocr_text: ocrText,
        response_format: 'json',
        ...buildLlmParams(filterConfig)
      });
      const parsed = parseLlmResponse(response);
      filteredText = parsed?.processed_text || ocrText;
    } catch (e) {
      filteredText = ocrText;
    }
    
    await services.execute(`
      UPDATE ${CONTENT_TABLE} 
      SET process_step = 'pending_extract', filtered_text = ?, filter_at = NOW(),
          filter_carried_over = NULL, filter_chunk_index = 0
      WHERE row_id = ?
    `, [filteredText, row.row_id]);
    
    logger.info(`[tick] Filter completed for ${row.row_id}, length=${filteredText.length}`);
  } else {
    const result = await filterWithSlidingWindow(ocrText, filterPrompt, filterConfig, services, row.row_id, existingCarriedOver, existingChunkIndex);
    
    if (result.completed) {
      await services.execute(`
        UPDATE ${CONTENT_TABLE} 
        SET process_step = 'pending_extract', filtered_text = ?, filter_at = NOW(),
            filter_carried_over = NULL, filter_chunk_index = 0
        WHERE row_id = ?
      `, [result.filteredText, row.row_id]);
      logger.info(`[tick] Filter completed for ${row.row_id}, length=${result.filteredText.length}`);
    } else {
      await services.execute(`
        UPDATE ${CONTENT_TABLE} 
        SET filter_carried_over = ?, filter_chunk_index = ?
        WHERE row_id = ?
      `, [result.carriedOver, result.chunkIndex, row.row_id]);
      logger.info(`[tick] Filter progress for ${row.row_id}, chunk ${result.chunkIndex}`);
    }
  }
}

async function filterWithSlidingWindow(ocrText, filterPrompt, filterConfig, services, rowId, existingCarriedOver, existingChunkIndex) {
  const maxLen = filterConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
  const chunks = splitIntoChunks(ocrText, maxLen);
  
  const allProcessed = [];
  let carriedOver = existingCarriedOver || '';
  let startIndex = existingChunkIndex || 0;
  
  for (let i = startIndex; i < chunks.length; i++) {
    const chunkInput = carriedOver + (carriedOver ? '\n' : '') + chunks[i];
    
    try {
      const response = await services.callLlm('filter_text', {
        instruction: filterPrompt + JSON_FORMAT_PROMPT,
        ocr_text: chunkInput,
        response_format: 'json',
        ...buildLlmParams(filterConfig)
      });
      const parsed = parseLlmResponse(response);
      allProcessed.push(parsed?.processed_text || chunkInput);
      carriedOver = parsed?.carried_over || '';
      
      logger.info(`[tick] Chunk ${i + 1}/${chunks.length} done for ${rowId}`);
    } catch (e) {
      allProcessed.push(chunkInput);
      carriedOver = '';
    }
  }
  
  if (carriedOver) {
    try {
      const response = await services.callLlm('filter_text', {
        instruction: filterPrompt + JSON_FORMAT_PROMPT,
        ocr_text: carriedOver,
        response_format: 'json',
        ...buildLlmParams(filterConfig)
      });
      const parsed = parseLlmResponse(response);
      allProcessed.push(parsed?.processed_text || carriedOver);
    } catch (e) {
      allProcessed.push(carriedOver);
    }
  }
  
  return {
    completed: true,
    filteredText: allProcessed.join('\n'),
    carriedOver: '',
    chunkIndex: chunks.length
  };
}

async function handleExtract(row, app, services) {
  logger.info(`[tick] Extracting metadata for ${row.row_id}`);
  
  const content = await services.query(`
    SELECT filtered_text FROM ${CONTENT_TABLE}
    WHERE row_id = ?
  `, [row.row_id]);
  
  if (!content.length || !content[0].filtered_text) {
    await updateProcessStep(services, row.row_id, 'extract_failed');
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
      ocr_text: content[0].filtered_text,
      response_format: 'json',
      ...buildLlmParams(extractConfig)
    });
    
    const metadata = parseLlmResponse(response);
    
    if (!metadata) {
      await updateProcessStep(services, row.row_id, 'extract_failed');
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
    
    await services.execute(`
      INSERT INTO ${ROWS_TABLE} (row_id, contract_number, party_a, party_b, parent_company, contract_amount, contract_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        contract_number = VALUES(contract_number),
        party_a = VALUES(party_a),
        party_b = VALUES(party_b),
        parent_company = VALUES(parent_company),
        contract_amount = VALUES(contract_amount),
        contract_date = VALUES(contract_date)
    `, [row.row_id, cleanMetadata.contract_number || null, cleanMetadata.party_a || null, 
        cleanMetadata.party_b || null, cleanMetadata.parent_company || null,
        cleanMetadata.contract_amount || null, cleanMetadata.contract_date || null]);
    
    await services.execute(`
      UPDATE ${CONTENT_TABLE} 
      SET process_step = 'pending_section', 
          extract_json = ?, extract_model = ?, extract_temperature = ?, extract_at = NOW()
      WHERE row_id = ?
    `, [JSON.stringify(cleanMetadata), extractConfig.model_id || null, 
        extractConfig.temperature || 0.3, row.row_id]);
    
    logger.info(`[tick] Extract completed for ${row.row_id}`);
  } catch (e) {
    await updateProcessStep(services, row.row_id, 'extract_failed');
    logger.error(`[tick] Extract failed for ${row.row_id}: ${e.message}`);
  }
}

async function handleSection(row, app, services) {
  logger.info(`[tick] Analyzing sections for ${row.row_id}`);
  
  const content = await services.query(`
    SELECT filtered_text FROM ${CONTENT_TABLE}
    WHERE row_id = ?
  `, [row.row_id]);
  
  if (!content.length || !content[0].filtered_text) {
    await updateProcessStep(services, row.row_id, 'section_failed');
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
      ocr_text: content[0].filtered_text,
      response_format: 'json',
      ...buildLlmParams(sectionConfig)
    });
    
    const result = parseLlmResponse(response);
    const sections = result?.sections || result;
    
    if (!Array.isArray(sections)) {
      await updateProcessStep(services, row.row_id, 'section_failed');
      return;
    }
    
    await services.execute(`
      UPDATE ${CONTENT_TABLE} 
      SET process_step = 'pending_review', sections = ?
      WHERE row_id = ?
    `, [JSON.stringify(sections), row.row_id]);
    
    logger.info(`[tick] Section completed for ${row.row_id}, found ${sections.length} sections`);
  } catch (e) {
    await updateProcessStep(services, row.row_id, 'section_failed');
    logger.error(`[tick] Section failed for ${row.row_id}: ${e.message}`);
  }
}

async function updateProcessStep(services, rowId, newStep) {
  await services.execute(`
    UPDATE ${CONTENT_TABLE} SET process_step = ? WHERE row_id = ?
  `, [newStep, rowId]);
}