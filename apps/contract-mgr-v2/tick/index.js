import logger from '../../../lib/logger.js';
import path from 'path';
import { splitIntoChunks, getStepResource, getPrompt, callLlmJson } from '../server/handlers/shared.js';

const MAX_LOG_STRING_LENGTH = parseInt(process.env.CONTRACT_MGR_V2_LOG_MAX_LENGTH || '1000', 10);
const MAX_EXTRACT_TEXT_LENGTH = parseInt(process.env.CONTRACT_MGR_V2_EXTRACT_TEXT_MAX_LENGTH || '200000', 10);

function truncateString(value, maxLength = MAX_LOG_STRING_LENGTH) {
  if (typeof value !== 'string') return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function looksLikeDataUrl(value) {
  return typeof value === 'string' && /^data:[^;]+;base64,/i.test(value);
}

function looksLikeLargeBase64(value) {
  return typeof value === 'string' && value.length > 1024 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function sanitizeString(value, maxLength = MAX_LOG_STRING_LENGTH) {
  if (looksLikeDataUrl(value)) return `[data-url omitted length=${value.length}]`;
  if (looksLikeLargeBase64(value)) return `[base64 omitted length=${value.length}]`;
  return truncateString(value, maxLength);
}

function summarizeForLog(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;

  if (depth >= 3) {
    if (Array.isArray(value)) return `[array(${value.length}) truncated]`;
    return '[object truncated]';
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      const items = value.slice(0, 8).map(item => summarizeForLog(item, depth + 1, seen));
      if (value.length > 8) items.push(`[+${value.length - 8} more items]`);
      return items;
    }

    const keys = Object.keys(value);
    const result = {};
    for (const key of keys.slice(0, 16)) {
      result[key] = summarizeForLog(value[key], depth + 1, seen);
    }
    if (keys.length > 16) result.__truncated_keys__ = keys.length - 16;
    return result;
  }

  return truncateString(String(value));
}

function stringifyForLog(value, maxLength = MAX_LOG_STRING_LENGTH) {
  try {
    return truncateString(JSON.stringify(summarizeForLog(value)), maxLength);
  } catch (error) {
    return `[unserializable: ${error.message}]`;
  }
}

function safeParseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractTaskIdFromMcpResult(value, allowPlainString = true, seen = new Set()) {
  if (value == null) return '';

  if (typeof value === 'string') {
    const parsed = safeParseJson(value);
    if (parsed && parsed !== value) {
      return extractTaskIdFromMcpResult(parsed, false, seen);
    }
    return allowPlainString ? value.trim() : '';
  }

  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);

  if (value.task_id || value.id) {
    return String(value.task_id || value.id);
  }

  if (Array.isArray(value)) {
    const text = value
      .filter(item => item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .join('\n');
    const fromText = text ? extractTaskIdFromMcpResult(text, false, seen) : '';
    if (fromText) return fromText;

    for (const item of value) {
      const taskId = extractTaskIdFromMcpResult(item, false, seen);
      if (taskId) return taskId;
    }
    return '';
  }

  for (const key of ['result', 'content', 'text', 'raw']) {
    const taskId = extractTaskIdFromMcpResult(value[key], false, seen);
    if (taskId) return taskId;
  }

  return '';
}

function extractTextValue(value, maxLength = MAX_EXTRACT_TEXT_LENGTH) {
  if (value == null) return '';
  if (typeof value === 'string') return sanitizeString(value, maxLength);
  if (Array.isArray(value)) {
    return truncateString(value.map(item => extractTextValue(item, maxLength)).filter(Boolean).join('\n'), maxLength);
  }
  if (typeof value === 'object') {
    const preferredKeys = ['text', 'content', 'markdown', 'md', 'result', 'output', 'message'];
    for (const key of preferredKeys) {
      if (value[key]) {
        const extracted = extractTextValue(value[key], maxLength);
        if (extracted) return extracted;
      }
    }
    return truncateString(JSON.stringify(summarizeForLog(value)), maxLength);
  }
  return truncateString(String(value), maxLength);
}

const CONTENT_TABLE = 'app_contract_mgr_v2_content';
const ROWS_TABLE = 'app_contract_mgr_v2_rows';

const CONTRACT_FIELDS = [
  { name: 'contract_number', label: '合同编号', guide: '查找合同编号，通常在合同首页顶部' },
  { name: 'party_a', label: '甲方', guide: '查找甲方名称' },
  { name: 'party_b', label: '乙方', guide: '查找乙方名称' },
  { name: 'parent_company', label: '上级公司', guide: '如果甲方是子公司，推断上级公司' },
  { name: 'contract_amount', label: '合同金额', guide: '查找合同总金额，去除 RMB/人民币/￥/$ 前缀和千分位，优先输出阿拉伯数字' },
  { name: 'contract_date', label: '签订日期', guide: '查找签订日期，格式 YYYY-MM-DD' },
];

const DEFAULT_CHUNK_MAX_LENGTH = parseInt(process.env.TEXT_FILTER_MAX_LENGTH) || 12000;

function parseContractAmount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;

  const normalized = value
    .trim()
    .replace(/^(?:rmb|cny|usd|人民币|美元)\s*/i, '')
    .replace(/^[¥￥$]\s*/, '')
    .replace(/[,，\s]/g, '');
  const match = normalized.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;

  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : null;
}

const JSON_FORMAT_PROMPT = `
返回JSON格式：
{
  "processed_text": "本轮清洗后的完整章节内容",
  "carried_over": "末尾不完整章节的原文"
}`;

/**
 * 归一化标题：去掉所有空白，便于 `## 标题行` 与 LLM 输出标题的匹配
 */
function normalizeTitle(t) {
  return (t || '').replace(/\s+/g, '').toLowerCase();
}

/**
 * 根据清洗后文本（markdown，含 `## 章节标题` 行）计算每个 section 的行号范围。
 * 分 section 比对依赖 start_line/end_line 从 filtered_text 中切片，
 * 否则比对时 slice(undefined, undefined) 会退化为全文比对（慢且重复）。
 */
function computeSectionLines(filteredText, sections) {
  // 存量数据可能把换行存成了字面 `\n`（split 后是单行），先还原为真实换行
  const normalized = (filteredText || '').replace(/\\n/g, '\n');
  const lines = normalized.split('\n');
  // 收集所有 `##` 标题行（注意跳过正文中非标题的 `##` 引用，只认行首 `##`）
  const headingLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,3}\s+/.test(line)) {
      headingLines.push({ lineNo: i, title: line.replace(/^#+\s*/, '').trim() });
    }
  }

  const result = sections.map((s) => {
    const titleNorm = normalizeTitle(s.title);
    let start = -1;
    for (const h of headingLines) {
      const hNorm = normalizeTitle(h.title);
      if (titleNorm && (hNorm.includes(titleNorm) || titleNorm.includes(hNorm))) {
        start = h.lineNo;
        break;
      }
    }
    return { ...s, start_line: start >= 0 ? start : 0, end_line: 0 };
  });

  // end_line = 下一个 section 的 start_line（未找到则取全文末尾）
  for (let i = 0; i < result.length; i++) {
    const next = result[i + 1];
    const nextStart = next && next.start_line > 0 ? next.start_line : lines.length;
    result[i].end_line = nextStart;
  }
  return result;
}

export async function tick(context) {
  const { app, registry, services } = context;
  
  if (!app) {
    logger.info('[tick] No app found');
    return { skipped: true, reason: 'no_app' };
  }
  
  const pending = await services.query(`
    SELECT row_id, content_id, process_step, ocr_task_id, file_id, filter_carried_over, filter_chunk_index
    FROM ${CONTENT_TABLE}
    WHERE process_step IN ('pending_ocr', 'ocr_submitted', 'pending_filter', 'pending_extract', 'pending_section', 'pending_classify')
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
    case 'pending_classify':
      await handleClassify(row, app, services);
      break;
  }
}

async function handleOcrSubmit(row, app, services) {
  logger.info(`[tick] Submitting OCR for ${row.row_id}`);
  
  if (!row.file_id) {
    await updateProcessStep(services, row.content_id, 'ocr_failed');
    return;
  }
  
  // 获取文件信息（用于 params_mapping）
  const fileInfo = await services.query(`
    SELECT a.id, a.file_name, a.file_path
    FROM attachments a
    WHERE a.id = ?
  `, [row.file_id]);
  
  if (!fileInfo || fileInfo.length === 0) {
    await updateProcessStep(services, row.content_id, 'ocr_failed');
    return;
  }
  
  const file = fileInfo[0];
  
  // 读取文件为 base64
  const fullPath = path.join(process.cwd(), 'data', 'attachments', file.file_path);
  const fs = await import('fs/promises');
  const buffer = await fs.readFile(fullPath);
  const base64 = buffer.toString('base64');
  
  const config = getStepResource(app, 'pending_ocr', {});
  const mcp = config.mcp || { server: 'mineru', tool: 'create_task' };
  
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
      params.file_base64 = base64;
      params.file_name = file.file_name;
    }
    
    logger.info(`[tick] OCR request params: filename=${params.filename || params.name}, base64_length=${base64.length}`);
    logger.debug(`[tick] OCR request full params keys: ${Object.keys(params).join(', ')}`);
    
    const result = await services.callMcp(mcp.server, mcp.tool, params);
    
    logger.info(`[tick] OCR response type: ${typeof result}`);
    logger.debug(`[tick] OCR response: ${stringifyForLog(result, 500)}`);
    
    let taskId = '';
    
    const parsePrompt = `从以下 MCP 工具调用结果中提取 task_id（任务ID）。
如果结果中包含任务ID，返回JSON格式：{"task_id": "提取的ID值"}
如果没有找到task_id但有其他标识符（如id、job_id等），也提取出来。
如果完全无法提取，返回：{"task_id": ""}

MCP返回结果：
${stringifyForLog(result, 1000)}`;

    try {
      const parsed = await services.llm.extractJson(parsePrompt, '', {
        modelId: config.parse_model_id || null,
        temperature: 0.1,
        defaultValue: { task_id: '' },
      });

      if (parsed && parsed.task_id) {
        taskId = parsed.task_id;
        logger.info(`[tick] OCR task_id extracted by LLM: ${taskId}`);
      }
    } catch (e) {
      logger.warn(`[tick] LLM parse failed, fallback to hardcoded: ${e.message}`);
    }
    
    if (!taskId) {
      taskId = extractTaskIdFromMcpResult(result);
      if (taskId) {
        logger.info(`[tick] OCR task_id extracted by fallback: ${taskId}`);
      }
    }
    
    if (!taskId) {
      logger.error(`[tick] OCR returned no task_id for ${row.row_id}, result: ${stringifyForLog(result, 200)}`);
      await updateProcessStep(services, row.content_id, 'ocr_failed');
      return;
    }
    
    await services.execute(`
      UPDATE ${CONTENT_TABLE} 
      SET process_step = 'ocr_submitted', ocr_task_id = ?
      WHERE content_id = ?
    `, [taskId, row.content_id]);

    await advanceDocStatus(services, row.row_id, 'ocr_submitted');
    
    logger.info(`[tick] OCR submitted for ${row.row_id}, task_id=${taskId}`);
  } catch (e) {
    await updateProcessStep(services, row.content_id, 'ocr_failed');
    await advanceDocStatus(services, row.row_id, 'ocr_failed', true);
    logger.error(`[tick] OCR submit failed for ${row.row_id}: ${e.message}`);
    logger.error(`[tick] OCR submit error stack: ${e.stack}`);
    logger.error(`[tick] OCR submit error details: ${JSON.stringify({ name: e.name, message: e.message, code: e.code, cause: e.cause })}`);
  }
}

function normalizeOcrStatus(status) {
  const s = String(status || '').toLowerCase();
  if (['completed', 'done', 'succeeded', 'success', 'finished', 'complete'].some(k => s.includes(k))) {
    return 'completed';
  }
  if (['processing', 'pending', 'running', 'in_progress', 'ongoing', 'wait', 'waiting', 'queued'].some(k => s.includes(k))) {
    return 'pending';
  }
  if (['failed', 'failure', 'error', 'rejected', 'timeout', 'expired'].some(k => s.includes(k))) {
    return 'failed';
  }
  return null;
}

function parseOcrProgress(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const parsed = parseFloat(String(value).replace('%', ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function extractOcrStatusFromMcpResult(value, seen = new Set()) {
  if (value == null) return null;

  if (typeof value === 'string') {
    const parsed = safeParseJson(value);
    if (parsed && parsed !== value) {
      return extractOcrStatusFromMcpResult(parsed, seen);
    }
    return null;
  }

  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const status = extractOcrStatusFromMcpResult(item, seen);
      if (status) return status;
    }
    return null;
  }

  for (const key of ['status', 'state', 'task_status']) {
    if (value[key] !== undefined) {
      const normalized = normalizeOcrStatus(value[key]);
      if (normalized) {
        return {
          status: normalized,
          progress: parseOcrProgress(value.progress ?? value.percent ?? value.completion),
        };
      }
    }
  }

  for (const key of ['result', 'content', 'raw', 'text', 'data']) {
    const status = extractOcrStatusFromMcpResult(value[key], seen);
    if (status) return status;
  }

  return null;
}

async function handleOcrCheck(row, app, services) {
  logger.info(`[tick] Checking OCR for ${row.row_id}`);
  
  const taskId = row.ocr_task_id;
  if (!taskId) {
    await updateProcessStep(services, row.content_id, 'ocr_failed');
    return;
  }
  
  const config = getStepResource(app, 'ocr_submitted', {});
  const mcp = config.mcp || { server: 'mineru', tool: 'get_task_status' };
  
  try {
    const mcpResult = await services.callMcp(mcp.server, mcp.tool || 'get_task_status', { task_id: taskId });
    
    let parsed = extractOcrStatusFromMcpResult(mcpResult);
    if (!parsed) {
      logger.info(`[tick] OCR deterministic status parse failed for ${row.row_id}, falling back to LLM`);
      const taskInfo = stringifyForLog(mcpResult, 1000);
      
      const judgePrompt = `判断OCR任务是否完成。
任务返回信息：
${taskInfo}

返回JSON：{"status": "completed|pending|failed", "progress": 0-100}`;
      
      const judgeResult = await services.llm.extractJson(judgePrompt, '', {
        modelId: config.judge_model_id || null,
        temperature: config.judge_temperature || 0.1,
        defaultValue: { status: 'pending', progress: 0 },
      });

      parsed = { ...judgeResult };
    }
    if (!parsed.status) parsed.status = 'pending';
    
    if (parsed.status === 'completed') {
      // OCR 任务完成后，通过交付物协议获取真实文本：
      // 1. list_deliverables 列出产物（primary markdown）
      // 2. download_deliverable 下载并提取 content 文本
      // 说明：get_task_status 只返回状态 JSON，不包含解析文本。
      let ocrText = '';
      try {
        // OCR 交付物协议：list_deliverables -> download_deliverable
        // 响应可能多层包装：{result:{content:"<json>"}} / {content:"<json>"} / 直接字符串
        const unwrapContent = (input) => {
          let cur = input;
          for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
            if (cur.result && typeof cur.result === 'object') { cur = cur.result; continue; }
            if (typeof cur.content === 'string') {
              const parsed = safeParseJson(cur.content);
              if (parsed && typeof parsed === 'object') cur = parsed;
            }
            break;
          }
          return cur;
        };

        const deliverables = await services.callMcp(mcp.server, 'list_deliverables', { task_id: taskId });
        const deliverablesObj = unwrapContent(deliverables);
        const artifacts = (deliverablesObj && (deliverablesObj.artifacts || deliverablesObj.result?.artifacts)) || [];
        const primary =
          artifacts.find(a => a.is_default) ||
          artifacts.find(a => a.artifact_type === 'markdown') ||
          artifacts.find(a => a.role === 'primary') ||
          artifacts[0];
        if (primary?.download_key) {
          const dl = await services.callMcp(mcp.server, 'download_deliverable', {
            task_id: taskId,
            download_key: primary.download_key,
            include_content: true,
          });
          const dlObj = unwrapContent(dl);
          ocrText = (dlObj && (dlObj.content || dlObj.text)) || extractTextFromMcpResult(dl);
        } else {
          logger.warn(`[tick] No downloadable deliverable for ${row.row_id}`);
        }
      } catch (dlErr) {
        logger.warn(`[tick] OCR deliverable download failed for ${row.row_id}: ${dlErr.message}, falling back to status text`);
      }
      if (!ocrText) ocrText = extractTextFromMcpResult(mcpResult);
      ocrText = ocrText.replace(/\\n/g, '\n');
      
      await services.execute(`
        UPDATE ${CONTENT_TABLE} 
        SET process_step = 'pending_filter', ocr_text = ?, ocr_service = ?, ocr_at = NOW()
        WHERE content_id = ?
      `, [ocrText, mcp.server, row.content_id]);
      
      await advanceDocStatus(services, row.row_id, 'pending_filter');
      logger.info(`[tick] OCR completed for ${row.row_id}, text length=${ocrText.length}`);
    } else if (parsed.status === 'pending') {
      logger.info(`[tick] OCR pending for ${row.row_id}, progress=${parsed.progress}`);
    } else {
      await updateProcessStep(services, row.content_id, 'ocr_failed');
      await advanceDocStatus(services, row.row_id, 'ocr_submitted_failed', true);
    }
  } catch (e) {
    logger.error(`[tick] OCR check failed for ${row.row_id}: ${e.message}`);
  }
}

function extractTextFromMcpResult(mcpResult) {
  if (!mcpResult) return '';
  if (typeof mcpResult === 'string') return extractTextValue(mcpResult);
  if (mcpResult.result) return extractTextValue(mcpResult.result);
  if (mcpResult.content) return extractTextValue(mcpResult.content);
  if (mcpResult.text) return extractTextValue(mcpResult.text);
  return extractTextValue(mcpResult);
}

async function handleFilter(row, app, services) {
  logger.info(`[tick] Filtering text for ${row.row_id}`);
  
  const content = await services.query(`
    SELECT ocr_text, filter_carried_over, filter_chunk_index FROM ${CONTENT_TABLE}
    WHERE content_id = ?
  `, [row.content_id]);
  
  if (!content.length || !content[0].ocr_text) {
    await updateProcessStep(services, row.content_id, 'filter_failed');
    return;
  }
  
  const ocrText = content[0].ocr_text;
  const existingCarriedOver = content[0].filter_carried_over || '';
  const existingChunkIndex = content[0].filter_chunk_index || 0;
  
  const filterConfig = getStepResource(app, 'pending_filter', { temperature: 0.3 });
  const filterPrompt = getPrompt(app, 'filter', '去除页码、水印、乱码，保留正文。必须保留章节标题行（以##开头的markdown标题，如"## 一、前言 Preface"），标题行不要修改、不要删除，它们是后续章节定位的依据');
  const maxLen = filterConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
  const filterLlmConfig = { ...filterConfig, timeout: filterConfig.timeout ?? 300000 };

  let filteredText;

  if (ocrText.length <= maxLen) {
    try {
      const parsed = await callLlmJson(services, filterPrompt + JSON_FORMAT_PROMPT, ocrText, filterLlmConfig);
      filteredText = parsed?.processed_text || ocrText;
    } catch (e) {
      logger.error(`[tick] Filter failed for ${row.row_id}: ${e.message}`);
      filteredText = ocrText;
    }

    await services.execute(`
      UPDATE ${CONTENT_TABLE}
      SET process_step = 'pending_extract', filtered_text = ?, filter_at = NOW(),
          filter_carried_over = NULL, filter_chunk_index = 0
      WHERE content_id = ?
    `, [filteredText, row.content_id]);

    logger.info(`[tick] Filter completed for ${row.row_id}, length=${filteredText.length}`);
  } else {
    const result = await filterWithSlidingWindow(ocrText, filterPrompt, filterLlmConfig, services, row.row_id, existingCarriedOver, existingChunkIndex);

    if (result.completed) {
      await services.execute(`
        UPDATE ${CONTENT_TABLE}
        SET process_step = 'pending_extract', filtered_text = ?, filter_at = NOW(),
            filter_carried_over = NULL, filter_chunk_index = 0
        WHERE content_id = ?
      `, [result.filteredText, row.content_id]);
      await advanceDocStatus(services, row.row_id, 'pending_extract');
      logger.info(`[tick] Filter completed for ${row.row_id}, length=${result.filteredText.length}, chunk_failures=${result.failureCount || 0}`);
    } else {
      await services.execute(`
        UPDATE ${CONTENT_TABLE}
        SET filter_carried_over = ?, filter_chunk_index = ?
        WHERE content_id = ?
      `, [result.carriedOver, result.chunkIndex, row.content_id]);
      logger.info(`[tick] Filter progress for ${row.row_id}, chunk ${result.chunkIndex}, chunk_failures=${result.failureCount || 0}`);
    }
  }
}

async function filterWithSlidingWindow(ocrText, filterPrompt, filterConfig, services, rowId, existingCarriedOver, existingChunkIndex) {
  const maxLen = filterConfig.chunk_max_length || DEFAULT_CHUNK_MAX_LENGTH;
  const chunks = splitIntoChunks(ocrText, maxLen);

  const allProcessed = [];
  let carriedOver = existingCarriedOver || '';
  let startIndex = existingChunkIndex || 0;
  let failureCount = 0;

  async function processChunk(chunkInput, label) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const parsed = await callLlmJson(services, filterPrompt + JSON_FORMAT_PROMPT, chunkInput, filterConfig);
        return { processed: parsed?.processed_text || chunkInput, carriedOver: parsed?.carried_over || '' };
      } catch (e) {
        lastError = e;
        logger.warn(`[tick] Chunk ${label} attempt ${attempt + 1} failed for ${rowId}: ${e.message}`);
      }
    }
    failureCount += 1;
    logger.error(`[tick] Chunk ${label} ultimately failed for ${rowId}: ${lastError?.message}`);
    return { processed: chunkInput, carriedOver: '' };
  }

  for (let i = startIndex; i < chunks.length; i++) {
    const chunkInput = carriedOver + (carriedOver ? '\n' : '') + chunks[i];
    const chunkResult = await processChunk(chunkInput, `${i + 1}/${chunks.length}`);
    allProcessed.push(chunkResult.processed);
    carriedOver = chunkResult.carriedOver;

    logger.info(`[tick] Chunk ${i + 1}/${chunks.length} done for ${rowId}`);
  }

  if (carriedOver) {
    const tailResult = await processChunk(carriedOver, 'tail');
    allProcessed.push(tailResult.processed);
    carriedOver = tailResult.carriedOver;
  }

  return {
    completed: true,
    filteredText: allProcessed.join('\n'),
    carriedOver,
    chunkIndex: chunks.length,
    failureCount,
  };
}

async function handleExtract(row, app, services) {
  logger.info(`[tick] Extracting metadata for ${row.row_id}`);
  
  const content = await services.query(`
    SELECT filtered_text FROM ${CONTENT_TABLE}
    WHERE content_id = ?
  `, [row.content_id]);
  
  if (!content.length || !content[0].filtered_text) {
    await updateProcessStep(services, row.content_id, 'extract_failed');
    return;
  }
  
  const extractConfig = getStepResource(app, 'pending_extract', { temperature: 0.3 });
  const extractLlmConfig = { ...extractConfig, timeout: extractConfig.timeout ?? 180000 };
  
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
    const metadata = await callLlmJson(services, prompt, content[0].filtered_text, extractLlmConfig);
    
    if (!metadata) {
      await updateProcessStep(services, row.content_id, 'extract_failed');
      return;
    }
    
    const cleanMetadata = {};
    for (const field of CONTRACT_FIELDS) {
      const value = metadata[field.name];
      if (!value) continue;
      
      if (field.name === 'contract_amount') {
        const amount = parseContractAmount(value);
        if (amount !== null) cleanMetadata[field.name] = amount;
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
      WHERE content_id = ?
    `, [JSON.stringify(cleanMetadata), extractConfig.model_id || null, 
        extractConfig.temperature || 0.3, row.content_id]);

    try {
      const docId = await getDocumentId(services, row.row_id);
      if (docId) {
        await services.execute(
          `UPDATE documents SET metadata = ?, updated_at = NOW() WHERE id = ?`,
          [JSON.stringify({ contract_number: cleanMetadata.contract_number || null, contract_date: cleanMetadata.contract_date || null, party_a: cleanMetadata.party_a || null }), docId]
        );
      }
    } catch (e) {}

    await advanceDocStatus(services, row.row_id, 'pending_section');
    logger.info(`[tick] Extract completed for ${row.row_id}`);
  } catch (e) {
    await updateProcessStep(services, row.content_id, 'extract_failed');
    logger.error(`[tick] Extract failed for ${row.row_id}: ${e.message}`);
  }
}

async function handleSection(row, app, services) {
  logger.info(`[tick] Analyzing sections for ${row.row_id}`);
  
  const content = await services.query(`
    SELECT filtered_text FROM ${CONTENT_TABLE}
    WHERE content_id = ?
  `, [row.content_id]);
  
  if (!content.length || !content[0].filtered_text) {
    await updateProcessStep(services, row.content_id, 'section_failed');
    return;
  }
  
  const sectionConfig = getStepResource(app, 'pending_section', { temperature: 0.3 });
  const sectionLlmConfig = { ...sectionConfig, timeout: sectionConfig.timeout ?? 180000 };
  const sectionPrompt = getPrompt(app, 'section', '分析章节结构。只输出一级大章（如"一、前言"、"二、质量要求"、"七、召回和三包"），不要展开子章节；章节标题必须与原文中的##标题行完全一致（含序号），不要改写或省略，便于按标题定位正文范围');
  
  const jsonFormat = `
返回JSON:
{
  "sections": [
    { "title": "章节标题", "level": 1, "index": 0, "summary": "摘要" }
  ]
}`;
  
  try {
    const result = await callLlmJson(services, sectionPrompt + jsonFormat, content[0].filtered_text, sectionLlmConfig);
    const sections = result?.sections || result;
    
    if (!Array.isArray(sections)) {
      await updateProcessStep(services, row.content_id, 'section_failed');
      return;
    }

    // 关键：为 section 计算 start_line/end_line（基于清洗后文本的 `## 标题` 行），
    // 分 section 比对依赖行号切片，缺失会退化为全文比对
    const sectionsWithLines = computeSectionLines(content[0].filtered_text, sections);

    await services.execute(`
      UPDATE ${CONTENT_TABLE} 
      SET process_step = 'pending_classify', sections = ?
      WHERE content_id = ?
    `, [JSON.stringify(sectionsWithLines), row.content_id]);

    await advanceDocStatus(services, row.row_id, 'pending_classify');
    logger.info(`[tick] Section completed for ${row.row_id}, found ${sections.length} sections`);
  } catch (e) {
    await updateProcessStep(services, row.content_id, 'section_failed');
    logger.error(`[tick] Section failed for ${row.row_id}: ${e.message}`);
  }
}

async function handleClassify(row, app, services) {
  logger.info(`[tick] Classifying for ${row.row_id}`);

  try {
    const content = await services.query(
      `SELECT extract_json, filtered_text, classification_json FROM ${CONTENT_TABLE} WHERE content_id = ?`,
      [row.content_id]
    );
    if (!content.length) {
      await updateProcessStep(services, row.content_id, 'pending_review');
      return;
    }

    let extract = {};
    if (content[0].extract_json) {
      try { extract = JSON.parse(content[0].extract_json); } catch (e) {}
    }

    const contractNumber = extract.contract_number || '';
    const partyA = extract.party_a || '';
    const contractDate = extract.contract_date || '';

    if (!contractNumber && !partyA) {
      await services.execute(
        `UPDATE ${CONTENT_TABLE} SET process_step = 'pending_review', classification_json = ? WHERE content_id = ?`,
        [JSON.stringify([]), row.content_id]
      );
      return;
    }

    const params = [];
    const conditions = ["d.doc_type = 'contract'", 'd.id != (SELECT document_id FROM app_contract_mgr_v2_content WHERE content_id = ?)'];
    params.push(row.content_id);

    const fieldConditions = [];
    if (contractNumber) {
      fieldConditions.push("(JSON_EXTRACT(d.metadata, '$.contract_number') = ? OR d.title LIKE ?)");
      params.push(contractNumber, `%${contractNumber}%`);
    }
    if (partyA) {
      fieldConditions.push("(d.title LIKE ? OR JSON_EXTRACT(d.metadata, '$.party_a') = ?)");
      params.push(`%${partyA}%`, partyA);
    }
    if (fieldConditions.length > 0) {
      conditions.push(`(${fieldConditions.join(' OR ')})`);
    }

    const whereClause = conditions.join(' AND ');
    const matches = await services.query(
      `SELECT d.id, d.title, d.created_at, d.metadata,
              (SELECT MAX(r.effective_from) FROM document_revisions r WHERE r.document_id = d.id) as latest_effective
       FROM documents d
       WHERE ${whereClause}
       ORDER BY latest_effective DESC
       LIMIT 10`,
      params
    );

    const suggestions = (matches || []).map(m => {
      let matchMeta = {};
      try { matchMeta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {}); } catch (e) {}

      let score = 0.5;
      let reasons = [];

      if (contractNumber && matchMeta.contract_number === contractNumber) {
        score += 0.3; reasons.push('合同编号完全匹配');
      } else if (contractNumber && m.title && m.title.includes(contractNumber)) {
        score += 0.15; reasons.push('合同编号标题匹配');
      }
      if (partyA && matchMeta.party_a === partyA) {
        score += 0.2; reasons.push('甲方一致');
      } else if (partyA && m.title && m.title.includes(partyA)) {
        score += 0.1; reasons.push('甲方标题匹配');
      }
      if (contractDate && matchMeta.contract_date && matchMeta.contract_date !== contractDate) {
        reasons.push(`合同日期差异: ${matchMeta.contract_date} vs ${contractDate}`);
      }

      return {
        document_id: m.id,
        title: m.title,
        latest_effective: m.latest_effective,
        confidence: Math.min(score, 1),
        reasons,
      };
    }).filter(s => s.confidence >= 0.3)
      .sort((a, b) => {
        if (a.latest_effective && b.latest_effective) {
          return a.latest_effective < b.latest_effective ? 1 : -1;
        }
        return b.confidence - a.confidence;
      });

    await services.execute(
      `UPDATE ${CONTENT_TABLE} SET process_step = 'pending_review', classification_json = ? WHERE content_id = ?`,
      [JSON.stringify(suggestions), row.content_id]
    );

    logger.info(`[tick] Classify completed for ${row.row_id}, found ${suggestions.length} version suggestions`);
  } catch (e) {
    await updateProcessStep(services, row.content_id, 'pending_review');
    logger.error(`[tick] Classify failed for ${row.row_id}: ${e.message}`);
  }
}

async function updateProcessStep(services, contentId, newStep) {
  await services.execute(`
    UPDATE ${CONTENT_TABLE} SET process_step = ? WHERE content_id = ?
  `, [newStep, contentId]);
}

async function getDocumentId(services, rowId) {
  try {
    const bindings = await services.query(
      `SELECT document_id FROM app_doc_bindings WHERE app_id = 'contract-mgr-v2' AND row_id = ? AND binding_status = 'active' LIMIT 1`,
      [rowId]
    );
    return bindings && bindings.length > 0 ? bindings[0].document_id : null;
  } catch (e) {
    return null;
  }
}

const DOC_STATUS_MAP = {
  'ocr_submitted': 'ocr_processing',
  'pending_filter': 'pending_clean',
  'pending_extract': 'pending_outline',
  'pending_section': 'pending_chunk',
  'pending_review': 'pending_embedding',
  'pending_classify': 'pending_embedding',
  'confirmed': 'ready',
};

async function advanceDocStatus(services, rowId, appProcessStep, isError = false) {
  try {
    const bindings = await services.query(
      `SELECT b.document_id FROM app_doc_bindings b
       WHERE b.app_id = 'contract-mgr-v2' AND b.row_id = ? AND b.binding_status = 'active'
       LIMIT 1`,
      [rowId]
    );
    if (!bindings || bindings.length === 0) return;

    const documentId = bindings[0].document_id;

    if (isError) {
      await services.execute(
        `UPDATE documents SET processing_status = 'error', processing_error_code = ?, processing_updated_at = NOW() WHERE id = ?`,
        [appProcessStep, documentId]
      );
    } else {
      const targetStatus = DOC_STATUS_MAP[appProcessStep];
      if (!targetStatus) return;
      await services.execute(
        `UPDATE documents SET processing_status = ?, processing_updated_at = NOW() WHERE id = ?`,
        [targetStatus, documentId]
      );
    }
  } catch (e) {
    // Doc platform sync failure is non-blocking
  }
}
