import logger from '../../../lib/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { splitIntoChunks, getStepResource, getPrompt, callLlmJson } from '../server/handlers/shared.js';

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
  const { app, services } = context;
  
  if (!app) {
    logger.info('[tick] No app found');
    return { skipped: true, reason: 'no_app' };
  }
  
  const pending = await services.query(`
    SELECT row_id, content_id, document_id, process_step, filter_carried_over, filter_chunk_index
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
      await handleOcrSubmit(row, services);
      break;
    case 'ocr_submitted':
      await handleOcrCheck(row, services);
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

const DOC_OCR_WAITING_STATUSES = new Set(['pending_ocr', 'ocr_processing']);
const DOC_OCR_RESULT_STATUSES = new Set([
  'pending_clean',
  'pending_outline',
  'pending_chunk',
  'pending_embedding',
  'ready',
  'error',
]);

async function getActiveDocumentBinding(services, rowId) {
  const bindings = await services.query(
    `SELECT document_id
     FROM app_doc_bindings
     WHERE app_id = 'contract-mgr-v2' AND row_id = ? AND binding_status = 'active'
     LIMIT 1`,
    [rowId]
  );
  return bindings?.[0] || null;
}

async function readAttachmentText(services, attachmentId) {
  if (!attachmentId) {
    throw new Error('OCR completed without main markdown attachment');
  }

  const attachments = await services.query(
    `SELECT file_path FROM attachments WHERE id = ? LIMIT 1`,
    [attachmentId]
  );
  const filePath = attachments?.[0]?.file_path;
  if (!filePath) {
    throw new Error(`OCR markdown attachment not found: ${attachmentId}`);
  }

  const basePath = process.env.ATTACHMENT_BASE_PATH || './data/attachments';
  return fs.readFile(path.resolve(basePath, filePath), 'utf8');
}

async function markOcrFailed(services, row, errorCode, errorMessage, provider = null, taskId = null) {
  await services.execute(
    `UPDATE ${CONTENT_TABLE}
     SET process_step = 'ocr_failed',
         ocr_service = COALESCE(?, ocr_service),
         ocr_task_id = COALESCE(?, ocr_task_id)
     WHERE content_id = ?`,
    [provider, taskId, row.content_id]
  );
  logger.error(`[tick] OCR failed for ${row.row_id}: ${errorCode} - ${errorMessage}`);
}

async function handleOcrSubmit(row, services) {
  logger.info(`[tick] Waiting for document platform OCR for ${row.row_id}`);

  let binding;
  try {
    binding = await getActiveDocumentBinding(services, row.row_id);
  } catch (error) {
    logger.warn(`[tick] Cannot read document binding for ${row.row_id}; keeping pending_ocr: ${error.message}`);
    return;
  }

  if (!binding?.document_id) {
    logger.warn(`[tick] No active document binding for ${row.row_id}; keeping pending_ocr`);
    return;
  }

  const documents = await services.query(
    `SELECT processing_status FROM documents WHERE id = ? LIMIT 1`,
    [binding.document_id]
  );
  const processingStatus = documents?.[0]?.processing_status;
  if (!processingStatus) {
    logger.warn(`[tick] Document ${binding.document_id} not found for ${row.row_id}; keeping pending_ocr`);
    return;
  }

  if (DOC_OCR_WAITING_STATUSES.has(processingStatus)) {
    logger.info(`[tick] Document platform OCR pending for ${row.row_id}: ${processingStatus}`);
    return;
  }

  if (!DOC_OCR_RESULT_STATUSES.has(processingStatus)) {
    logger.warn(`[tick] Unexpected document status for ${row.row_id}: ${processingStatus}; keeping pending_ocr`);
    return;
  }

  await updateProcessStep(services, row.content_id, 'ocr_submitted');
  await handleOcrCheck(row, services);
}

async function handleOcrCheck(row, services) {
  logger.info(`[tick] Reading document platform OCR result for ${row.row_id}`);

  let binding;
  try {
    binding = await getActiveDocumentBinding(services, row.row_id);
  } catch (error) {
    logger.warn(`[tick] Cannot read document binding for ${row.row_id}; keeping ocr_submitted: ${error.message}`);
    return;
  }

  const documentId = binding?.document_id || row.document_id;
  if (!documentId) {
    logger.warn(`[tick] No document binding or document_id for ${row.row_id}; keeping ocr_submitted`);
    return;
  }
  if (!binding) {
    logger.warn(`[tick] No active document binding for ${row.row_id}; using content document_id ${documentId}`);
  }

  const results = await services.query(
    `SELECT provider, task_id, status, main_markdown_attachment_id, error_code, error_message
     FROM doc_ocr_results
     WHERE document_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [documentId]
  );
  const ocrResult = results?.[0];
  if (!ocrResult) {
    logger.warn(`[tick] No document platform OCR result for ${row.row_id}; keeping ocr_submitted`);
    return;
  }

  if (ocrResult.status === 'pending' || ocrResult.status === 'processing') {
    logger.info(`[tick] Document platform OCR pending for ${row.row_id}: ${ocrResult.status}`);
    return;
  }

  if (ocrResult.status === 'failed') {
    await markOcrFailed(
      services,
      row,
      ocrResult.error_code || 'doc_ocr_failed',
      ocrResult.error_message || 'Document platform OCR failed',
      'mineru',
      ocrResult.task_id
    );
    return;
  }

  if (ocrResult.status !== 'completed') {
    logger.warn(`[tick] Unknown document platform OCR status for ${row.row_id}: ${ocrResult.status}; keeping ocr_submitted`);
    return;
  }

  try {
    const ocrText = (await readAttachmentText(services, ocrResult.main_markdown_attachment_id)).replace(/\\n/g, '\n');
    if (!ocrText.trim()) {
      throw new Error('OCR markdown attachment is empty');
    }

    await services.execute(
      `UPDATE ${CONTENT_TABLE}
       SET process_step = 'pending_filter', ocr_text = ?, ocr_service = 'mineru', ocr_at = NOW()
       WHERE content_id = ?`,
      [ocrText, row.content_id]
    );
    logger.info(`[tick] Document platform OCR completed for ${row.row_id}, text length=${ocrText.length}`);
  } catch (error) {
    await markOcrFailed(
      services,
      row,
      'doc_ocr_text_read_failed',
      error.message,
      'mineru',
      ocrResult.task_id
    );
  }
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
