import logger from '../../../lib/logger.js';
import path from 'path';

const ROWS_TABLE = 'app_invoice_mgr_rows';
const ITEMS_TABLE = 'app_invoice_mgr_items';

const EXTRACT_PROMPT = `你是一个中国发票识别专家。请从图片中提取发票结构化信息。

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

async function checkDuplicate(services, invoiceNumber, currentRowId) {
  const rows = await services.query(
    'SELECT row_id FROM app_invoice_mgr_rows WHERE invoice_number = ? LIMIT 1',
    [invoiceNumber]
  );
  if (rows && rows.length > 0 && rows[0].row_id !== currentRowId) {
    return rows[0].row_id;
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
    page_count: data.page_count || 0,
    remarks: data.remarks || '',
    ocr_method: ocrMethod,
    ocr_raw: JSON.stringify(data),
    extraction_status: 'success',
    text_items_count: 0,
    keyword_count: 0,
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
  { key: 'invoice_number', label: '发票号码', type: 'string' },
  { key: 'invoice_date', label: '开票日期', type: 'string' },
  { key: 'seller_name', label: '销售方', type: 'string' },
  { key: 'total_with_tax', label: '价税合计', type: 'number' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, files, services } = context;
    const file = files[0];

    if (!file || !file.attachment) {
      logger.error(`[invoice-vl-extract] Record ${record.id}: No file`);
      return { success: false, error: '未找到文件' };
    }

    const filePath = file.attachment.file_path;
    const fileName = file.attachment.file_name;
    const ext = path.extname(fileName).toLowerCase();
    const absolutePath = path.join(process.cwd(), 'data', 'attachments', filePath);

    logger.info(`[invoice-vl-extract] Record ${record.id}: ${fileName} (${ext})`);

    let images = [];

    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      const { readFile } = await import('fs/promises');
      const buffer = await readFile(absolutePath);
      const mimeType = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      }[ext];
      images.push(`data:${mimeType};base64,${buffer.toString('base64')}`);
      logger.info(`[invoice-vl-extract] Record ${record.id}: 图片已转为dataUrl`);
    } else if (ext === '.pdf') {
      try {
        const renderResult = await services.callSkill('pdf', 'read', {
          operation: 'render',
          path: filePath,
          scale: 1.5,
        });

        if (renderResult.pages && renderResult.pages.length > 0) {
          images = renderResult.pages.map(p => p.dataUrl);
          logger.info(`[invoice-vl-extract] Record ${record.id}: PDF渲染 ${renderResult.pages.length} 页 → VL`);
        } else {
          logger.warn(`[invoice-vl-extract] Record ${record.id}: PDF 渲染无页面`);
          return { success: false, error: 'PDF渲染失败' };
        }
      } catch (e) {
        logger.error(`[invoice-vl-extract] Record ${record.id}: PDF渲染异常: ${e.message}`);
        return { success: false, error: `PDF渲染失败: ${e.message}` };
      }
    } else {
      logger.warn(`[invoice-vl-extract] Record ${record.id}: 不支持的文件格式 ${ext}`);
      return { success: false, error: `不支持的文件格式: ${ext}` };
    }

    if (images.length === 0) {
      return { success: false, error: '无图片数据' };
    }

    let data;
    try {
      data = await services.llm.extractJson(EXTRACT_PROMPT, '', {
        images: images,
        temperature: 0.1,
      });
    } catch (e) {
      logger.error(`[invoice-vl-extract] Record ${record.id}: VL提取异常: ${e.message}`);
      return { success: false, error: `VL提取失败: ${e.message}` };
    }

    if (!data) {
      logger.error(`[invoice-vl-extract] Record ${record.id}: VL返回空`);
      return { success: false, error: 'VL提取结果为空' };
    }

    if (!isValidInvoice(data)) {
      logger.warn(`[invoice-vl-extract] Record ${record.id}: VL提取结果无效(非发票)`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        ocr_method: 'vl',
        extraction_status: 'failed',
        ocr_raw: JSON.stringify({ error: 'not_invoice', reason: 'VL did not extract valid invoice data' }),
      });
      return { success: false, error: 'not_invoice' };
    }

    const existingRowId = await checkDuplicate(services, data.invoice_number, record.id);
    if (existingRowId) {
      logger.info(`[invoice-vl-extract] Record ${record.id}: 发票号 ${data.invoice_number} 已存在`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        invoice_number: data.invoice_number,
        ocr_method: 'vl',
        extraction_status: 'duplicate',
        ocr_raw: JSON.stringify({ duplicate: true, existing_row_id: existingRowId }),
      });
      return {
        success: true,
        data: {
          invoice_number: data.invoice_number,
          duplicate: true,
          existing_row_id: existingRowId,
        },
      };
    }

    await upsertRows(services, record.id, data, 'vl');
    const itemCount = await insertItems(services, record.id, data.items);

    logger.info(`[invoice-vl-extract] Record ${record.id}: 入库成功 ${data.invoice_number}, ${itemCount}项商品`);
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
