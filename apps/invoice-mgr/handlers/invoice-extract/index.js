import logger from '../../../../lib/logger.js';
import path from 'path';
import { resolveAttachmentPath } from '../shared.js';

const ROWS_TABLE = 'app_invoice_mgr_rows';
const ITEMS_TABLE = 'app_invoice_mgr_items';

function isValidInvoice(data) {
  const invNum = data.invoice_number;
  const total = data.total_with_tax || 0;
  return invNum && /^\d{8,20}$/.test(invNum) && total > 0;
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
    issuer: data.issuer || '',
    ocr_method: ocrMethod,
    ocr_raw: typeof data.content === 'string' ? data.content : JSON.stringify(data),
    extraction_status: 'success',
  });
}

async function insertItems(services, recordId, data) {
  const pages = data.pages || (data.invoice?.pages) || [];
  const items = data.items || [];
  const insertList = [];

  if (pages.length > 0) {
    let sortOrder = 0;
    for (const page of pages) {
      for (const item of (page.items || [])) {
        sortOrder++;
        insertList.push({
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
        });
      }
    }
  } else if (items.length > 0) {
    let sortOrder = 0;
    for (const item of items) {
      sortOrder++;
      insertList.push({
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

  if (insertList.length === 0) return 0;

  // 规范化：从商品名称中提取被混入的负值金额
  for (const row of insertList) {
    const negMatches = [...row.name.matchAll(/(-?\d+(?:\.\d+)?)/g)];
    if (negMatches.length > 0) {
      const lastNeg = negMatches[negMatches.length - 1];
      const negVal = parseFloat(lastNeg[0]);
      if (negVal < 0 && (row.amount === 0 || row.amount === null || row.amount === undefined)) {
        // 名称中混入了负数金额，提取出来放到 amount 字段
        const prefix = row.name.substring(0, lastNeg.index);
        const suffix = row.name.substring(lastNeg.index + lastNeg[0].length);
        row.name = (prefix + suffix).replace(/\s+/g, '').trim();
        row.amount = negVal;
      }
    }
  }

  const sql = `
    INSERT INTO app_invoice_mgr_items
    (id, row_id, page_number, sort_order, category, name, model, unit, quantity, price, amount, tax_rate, tax_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  for (const row of insertList) {
    await services.execute(sql, [
      row.id,
      row.row_id,
      row.page_number,
      row.sort_order,
      row.category,
      row.name,
      row.model,
      row.unit,
      row.quantity,
      row.price,
      row.amount,
      row.tax_rate,
      row.tax_amount,
    ]);
  }

  return insertList.length;
}

export const availableOutputs = [
  { key: 'invoice_number', label: '发票号码', type: 'string' },
  { key: 'invoice_date', label: '开票日期', type: 'string' },
  { key: 'seller_name', label: '销售方', type: 'string' },
  { key: 'buyer_name', label: '购买方', type: 'string' },
  { key: 'total_with_tax', label: '价税合计', type: 'number' },
  { key: 'issuer', label: '开票人', type: 'string' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, files, services } = context;
    const file = files[0];

    if (!file || !file.attachment) {
      logger.error(`[invoice-extract] Record ${record.id}: No file`);
      return { success: false, failure_code: 'no_file', error: '未找到发票文件' };
    }

    const fileName = file.attachment.file_name;
    const filePath = file.attachment._resolvedPath || resolveAttachmentPath(file.attachment);
    const ext = path.extname(fileName).toLowerCase();

    logger.info(`[invoice-extract] Record ${record.id}: ${fileName} (${ext})`);

    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      logger.info(`[invoice-extract] Record ${record.id}: 图片文件，路由到VL视觉提取`);
      return { success: false, failure_code: 'image_routed_to_vl', target_state: 'pending_vl_extract', error: '图片文件路由到VL' };
    }

    if (ext !== '.pdf') {
      logger.warn(`[invoice-extract] Record ${record.id}: 不支持的文件格式 ${ext}`);
      return { success: false, failure_code: 'unsupported_format', error: `不支持的文件格式: ${ext}` };
    }

    let result;
    try {
      result = await services.callSkill('fapiao', 'extract', { path: filePath });
    } catch (e) {
      logger.warn(`[invoice-extract] Record ${record.id}: fapiao异常 → ${e.message}`);
      logger.info(`[invoice-extract] Record ${record.id}: PDF fapiao失败，路由到VL`);
      return { success: false, failure_code: 'fapiao_exception', target_state: 'pending_vl_extract', error: `fapiao异常: ${e.message}` };
    }

    if (!result) {
      logger.info(`[invoice-extract] Record ${record.id}: PDF fapiao返回空，路由到VL`);
      return { success: false, failure_code: 'fapiao_empty', target_state: 'pending_vl_extract', error: 'fapiao返回为空' };
    }

    const data = result.data || result;

    if (!isValidInvoice(data)) {
      logger.warn(`[invoice-extract] Record ${record.id}: 未识别到有效发票（inv=${data.invoice_number || '(空)'} total=${data.total_with_tax}）`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        ocr_method: 'fapiao',
        extraction_status: 'failed',
        ocr_raw: JSON.stringify({ error: 'not_invoice', reason: 'fapiao did not extract valid invoice data' }),
      });
      return { success: false, failure_code: 'not_invoice', target_state: 'pending_vl_extract', error: 'not_invoice' };
    }

    const existing = await checkDuplicate(services, data.invoice_number, record.id);
    if (existing) {
      logger.info(`[invoice-extract] Record ${record.id}: 发票号 ${data.invoice_number} 已存在于 row_id=${existing.row_id}`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        invoice_number: data.invoice_number,
        ocr_method: 'fapiao',
        extraction_status: 'duplicate',
        text_items_count: 0,
        keyword_count: 0,
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

    // 从 fapiao 数据中提取开票人（取第一页的 issuer）
    if (!data.issuer) {
      const pages = data.pages || (data.invoice?.pages) || [];
      data.issuer = pages[0]?.issuer || '';
    }

    await upsertRows(services, record.id, data, 'fapiao');
    const itemCount = await insertItems(services, record.id, data);

    logger.info(`[invoice-extract] Record ${record.id}: 入库成功 ${data.invoice_number}, ${itemCount}项商品`);
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
