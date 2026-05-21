import logger from '../../../lib/logger.js';

function getAppConfig(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config || {};
}

function getStepResource(app, stateName, fallback = {}) {
  const config = getAppConfig(app);
  return config?.step_resources?.[stateName] || fallback;
}

const ROWS_TABLE = 'app_invoice_mgr_rows';
const ITEMS_TABLE = 'app_invoice_mgr_items';

const EXTRACT_PROMPT = `你是一个中国发票识别专家。请从OCR文本中提取发票结构化信息。

发票类型：增值税专用发票、增值税普通发票、电子发票。

严格返回JSON格式：
{
  "invoice_number": "20位数字发票号码",
  "invoice_date": "YYYY-MM-DD",
  "invoice_type": "发票类型描述",
  "seller": { "name": "销售方名称", "taxId": "纳税人识别号" },
  "buyer": { "name": "购买方名称", "taxId": "纳税人识别号" },
  "total_amount": 合计金额(不含税),
  "total_tax": 税额,
  "total_with_tax": 价税合计,
  "remarks": "备注",
  "items": [
    { "category": "分类", "name": "商品名称", "model": "规格", "unit": "单位",
      "quantity": 数量, "price": 单价, "amount": 金额,
      "taxRate": "税率", "taxAmount": 税额 }
  ]
}

规则：
- 金额为纯数字，不含逗号和符号
- 日期严格YYYY-MM-DD
- 发票号码20位数字
- 无法识别的字段用空字符串或0
- 无商品明细则items为空数组`;

function isValidInvoice(data) {
  const invNum = data.invoice_number;
  const total = data.total_with_tax || 0;
  return invNum && /^\d{20}$/.test(invNum) && total > 0;
}

function parseLLMResponse(text) {
  if (!text) return null;
  if (typeof text === 'object') return text;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function checkDuplicate(services, invoiceNumber, currentRowId) {
  const rows = await services.query(
    'SELECT row_id, invoice_number FROM app_invoice_mgr_rows WHERE invoice_number = ? LIMIT 1',
    [invoiceNumber]
  );
  if (rows && rows.length > 0 && rows[0].row_id !== currentRowId) {
    return rows[0];
  }
  return null;
}

async function upsertRows(services, recordId, data, ocrMethod) {
  await services.callExtension(ROWS_TABLE, 'upsert', {
    row_id: recordId,
    invoice_number: data.invoice_number,
    invoice_date: data.invoice_date || null,
    invoice_type: data.invoice_type || '',
    seller_name: data.seller?.name || '',
    seller_tax_id: data.seller?.taxId || '',
    buyer_name: data.buyer?.name || '',
    buyer_tax_id: data.buyer?.taxId || '',
    total_amount: data.total_amount || 0,
    total_tax: data.total_tax || 0,
    total_with_tax: data.total_with_tax || 0,
    item_count: (data.items || []).length,
    remarks: data.remarks || '',
    ocr_method: ocrMethod,
    ocr_raw: JSON.stringify(data),
    extraction_status: 'success',
  });
}

async function insertItems(services, recordId, items) {
  let sortOrder = 0;
  for (const item of (items || [])) {
    sortOrder++;
    await services.callExtension(ITEMS_TABLE, 'create', {
      id: `${recordId}_${String(sortOrder).padStart(3, '0')}`,
      row_id: recordId,
      page_number: 1,
      sort_order: sortOrder,
      category: item.category || '',
      name: item.name || '',
      model: item.model || '',
      unit: item.unit || '',
      quantity: item.quantity || 0,
      price: item.price || 0,
      amount: item.amount || 0,
      tax_rate: item.taxRate || '',
      tax_amount: item.taxAmount || 0,
    });
  }
  return sortOrder;
}

export const availableOutputs = [
  { key: 'ocr_status', label: 'OCR状态', type: 'string' },
  { key: 'invoice_number', label: '发票号码', type: 'string' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, services, app } = context;

    const ocrStepConfig = getStepResource(app, 'ocr_submitted', {
      type: 'mcp',
      mcp: { server: 'markitdown', tool: 'get_task' },
    });
    const mcpServer = ocrStepConfig.mcp?.server || 'markitdown';
    const mcpTool = ocrStepConfig.mcp?.tool || 'get_task';

    const taskId = record.data?._ocr_task_id || record.data?.ocr_task_id;
    if (!taskId) {
      logger.error(`[invoice-ocr-check] Record ${record.id}: 缺少OCR task_id`);
      return { success: false, error: '缺少OCR任务ID' };
    }

    logger.info(`[invoice-ocr-check] Record ${record.id}: 检查 task_id=${taskId} via ${mcpServer}`);

    let mcpResult;
    try {
      mcpResult = await services.callMcp(mcpServer, mcpTool, { task_id: taskId });
    } catch (e) {
      logger.error(`[invoice-ocr-check] Record ${record.id}: ${mcpServer} get_task异常 - ${e.message}`);
      return { success: false, error: `OCR状态查询失败: ${e.message}` };
    }

    if (!mcpResult) {
      return { success: true, pending: true };
    }

    const status = mcpResult.status || mcpResult.state || '';
    logger.info(`[invoice-ocr-check] Record ${record.id}: OCR状态=${status}`);

    if (status === 'pending' || status === 'processing' || status === 'running') {
      return { success: true, pending: true };
    }

    if (status === 'failed' || status === 'error') {
      logger.error(`[invoice-ocr-check] Record ${record.id}: OCR任务失败 status=${status}`);
      return { success: false, error: `OCR任务失败: ${mcpResult.error || status}` };
    }

    if (status !== 'completed' && status !== 'success') {
      return { success: true, pending: true };
    }

    const ocrText = mcpResult.text || mcpResult.content || mcpResult.result || '';
    if (!ocrText || ocrText.trim().length < 10) {
      logger.error(`[invoice-ocr-check] Record ${record.id}: OCR文本为空或过短 (len=${ocrText.length})`);
      return { success: false, error: 'OCR返回文本为空或过短' };
    }

    logger.info(`[invoice-ocr-check] Record ${record.id}: OCR完成, 文本长度=${ocrText.length}`);

    const llmStepConfig = getStepResource(app, 'pending_extract', {
      type: 'internal_llm',
      model_id: null,
      temperature: 0.1,
      prompt_type: 'extract_invoice_from_ocr',
    });

    const promptType = llmStepConfig.prompt_type || 'extract_invoice_from_ocr';
    const llmParams = {
      instruction: EXTRACT_PROMPT,
      ocr_text: ocrText.substring(0, 60000),
      response_format: 'json',
      temperature: llmStepConfig.temperature ?? 0.1,
    };
    if (llmStepConfig.model_id) llmParams.model_id = llmStepConfig.model_id;

    let llmResult;
    try {
      llmResult = await services.callLlm(promptType, llmParams);
    } catch (e) {
      logger.error(`[invoice-ocr-check] Record ${record.id}: LLM提取异常 - ${e.message}`);
      return { success: false, error: `LLM提取异常: ${e.message}` };
    }

    const data = parseLLMResponse(llmResult?.text || llmResult?.parsed);
    if (!data) {
      logger.error(`[invoice-ocr-check] Record ${record.id}: LLM返回无法解析`);
      return { success: false, error: 'LLM提取结果无法解析为JSON' };
    }

    if (!isValidInvoice(data)) {
      logger.warn(`[invoice-ocr-check] Record ${record.id}: LLM提取无效（inv=${data.invoice_number || '(空)'} total=${data.total_with_tax}）`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        ocr_method: 'markitdown',
        extraction_status: 'failed',
        ocr_raw: JSON.stringify({ error: 'not_invoice', llm_result: data }),
      });
      return { success: false, error: 'not_invoice' };
    }

    const existing = await checkDuplicate(services, data.invoice_number, record.id);
    if (existing) {
      logger.info(`[invoice-ocr-check] Record ${record.id}: 发票号 ${data.invoice_number} 已存在`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        invoice_number: data.invoice_number,
        ocr_method: 'markitdown',
        extraction_status: 'duplicate',
        ocr_raw: JSON.stringify({ duplicate: true, existing_row_id: existing.row_id }),
      });
      return {
        success: true,
        data: { invoice_number: data.invoice_number, duplicate: true, existing_row_id: existing.row_id },
      };
    }

    await upsertRows(services, record.id, data, 'markitdown');
    const itemCount = await insertItems(services, record.id, data.items);

    logger.info(`[invoice-ocr-check] Record ${record.id}: 入库成功 ${data.invoice_number}, ${itemCount}项商品`);
    return {
      success: true,
      data: {
        invoice_number: data.invoice_number,
        invoice_date: data.invoice_date,
        seller_name: data.seller?.name || '',
        buyer_name: data.buyer?.name || '',
        total_with_tax: data.total_with_tax,
        item_count: itemCount,
      },
    };
  },
};
