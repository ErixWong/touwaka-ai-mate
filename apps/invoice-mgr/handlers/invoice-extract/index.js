import logger from '../../../../lib/logger.js';
import path from 'path';

const ROWS_TABLE = 'app_invoice_mgr_rows';
const ITEMS_TABLE = 'app_invoice_mgr_items';

function isValidInvoice(data) {
  const invNum = data.invoice_number;
  const total = data.total_with_tax || 0;
  return invNum && /^\d{20}$/.test(invNum) && total > 0;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{4})年(\d{2})月(\d{2})日/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
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
    invoice_date: parseDate(data.invoice_date),
    invoice_type: data.invoice_type || '',
    seller_name: data.seller?.name || '',
    seller_tax_id: data.seller?.taxId || '',
    buyer_name: data.buyer?.name || '',
    buyer_tax_id: data.buyer?.taxId || '',
    total_amount: data.total_amount || 0,
    total_tax: data.total_tax || 0,
    total_with_tax: data.total_with_tax || 0,
    item_count: data.item_count || 0,
    page_count: data.page_count || 0,
    remarks: data.remarks || '',
    ocr_method: ocrMethod,
    ocr_raw: typeof data.content === 'string' ? data.content : JSON.stringify(data),
    extraction_status: data.extraction_status || 'success',
    text_items_count: data.text_items_count || 0,
    keyword_count: data.keyword_count || 0,
  });
}

async function insertItems(services, recordId, data) {
  const pages = data.pages || (data.invoice?.pages) || [];
  const items = data.items || [];
  let sortOrder = 0;

  if (pages.length > 0) {
    for (const page of pages) {
      for (const item of (page.items || [])) {
        sortOrder++;
        await services.callExtension(ITEMS_TABLE, 'create', {
          id: `${recordId}_${String(sortOrder).padStart(3, '0')}`,
          row_id: recordId,
          page_number: page.pageNumber || 1,
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
          issuer: page.issuer || '',
        });
      }
    }
  } else if (items.length > 0) {
    for (const item of items) {
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
  }
  return sortOrder;
}

export const availableOutputs = [
  { key: 'invoice_number', label: '发票号码', type: 'string' },
  { key: 'invoice_date', label: '开票日期', type: 'string' },
  { key: 'seller_name', label: '销售方', type: 'string' },
  { key: 'buyer_name', label: '购买方', type: 'string' },
  { key: 'total_with_tax', label: '价税合计', type: 'number' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, files, services } = context;
    const file = files[0];

    if (!file || !file.attachment) {
      logger.error(`[invoice-extract] Record ${record.id}: No file`);
      return { success: false, error: '未找到发票文件' };
    }

    const fileName = file.attachment.file_name;
    // 附件路径是相对于 data/attachments/ 的，需要加上前缀
    // 统一使用正斜杠，避免路径问题
    const filePath = 'attachments/' + file.attachment.file_path.replace(/\\/g, '/');
    const ext = path.extname(fileName).toLowerCase();

    logger.info(`[invoice-extract] Record ${record.id}: ${fileName} (${ext}), path=${filePath}`);

    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      logger.info(`[invoice-extract] Record ${record.id}: 图片文件，路由到OCR`);
      return { success: false, error: '图片文件需OCR识别' };
    }

    if (ext !== '.pdf') {
      logger.warn(`[invoice-extract] Record ${record.id}: 不支持的文件格式 ${ext}`);
      return { success: false, error: `不支持的文件格式: ${ext}` };
    }

    let result;
    try {
      result = await services.callSkill('fapiao', 'extract', { path: filePath });
    } catch (e) {
      logger.warn(`[invoice-extract] Record ${record.id}: fapiao异常 → ${e.message}`);
      return { success: false, error: `fapiao异常: ${e.message}` };
    }

    if (!result) {
      return { success: false, error: 'fapiao返回为空' };
    }

    const data = result.data || result;
    const extractionStatus = data.extraction_status || (isValidInvoice(data) ? 'success' : 'failed');

    if (extractionStatus === 'no_text_layer') {
      logger.info(`[invoice-extract] Record ${record.id}: 无文本层(扫描版) → 路由到VL`);
      return { success: false, error: 'no_text_layer' };
    }

    // 处理 partial 状态（发票号码为空或总金额为0）
    if (extractionStatus === 'partial') {
      logger.warn(`[invoice-extract] Record ${record.id}: 发票数据不完整（inv=${data.invoice_number || '(空)'} total=${data.total_with_tax}）→ 路由到VL`);
      return { success: false, error: 'partial' };
    }

    if (!isValidInvoice(data)) {
      logger.warn(`[invoice-extract] Record ${record.id}: 未识别到有效发票（inv=${data.invoice_number || '(空)'} total=${data.total_with_tax} status=${extractionStatus}）`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        invoice_number: data.invoice_number || '',
        invoice_date: parseDate(data.invoice_date),
        invoice_type: data.invoice_type || '',
        seller_name: data.seller?.name || '',
        seller_tax_id: data.seller?.taxId || '',
        buyer_name: data.buyer?.name || '',
        buyer_tax_id: data.buyer?.taxId || '',
        total_amount: data.total_amount || 0,
        total_tax: data.total_tax || 0,
        total_with_tax: data.total_with_tax || 0,
        item_count: data.item_count || 0,
        page_count: data.page_count || 0,
        remarks: data.remarks || '',
        ocr_method: 'fapiao',
        ocr_raw: JSON.stringify({ error: extractionStatus, reason: 'fapiao did not extract valid invoice data', extraction_status: extractionStatus }),
        extraction_status: 'failed',
      });
      return { success: false, error: 'not_invoice' };
    }

    const existing = await checkDuplicate(services, data.invoice_number, record.id);
    if (existing) {
      logger.info(`[invoice-extract] Record ${record.id}: 发票号 ${data.invoice_number} 已存在于 row_id=${existing.row_id}`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        invoice_number: data.invoice_number,
        ocr_method: 'fapiao',
        extraction_status: 'duplicate',
        ocr_raw: JSON.stringify({ duplicate: true, existing_row_id: existing.row_id }),
      });
      return {
        success: true,
        data: {
          invoice_number: data.invoice_number,
          duplicate: true,
          existing_row_id: existing.row_id,
        },
      };
    }

    await upsertRows(services, record.id, data, 'fapiao');
    const itemCount = await insertItems(services, record.id, data);

    logger.info(`[invoice-extract] Record ${record.id}: 入库成功 ${data.invoice_number}, ${itemCount}项商品 (status=${extractionStatus})`);
    return {
      success: true,
      data: {
        invoice_number: data.invoice_number,
        invoice_date: parseDate(data.invoice_date),
        seller_name: data.seller?.name || '',
        buyer_name: data.buyer?.name || '',
        total_with_tax: data.total_with_tax,
        item_count: itemCount,
      },
    };
  },
};
