import logger from '../../../../lib/logger.js';
import path from 'path';
import { getStepResource, resolveAttachmentPath } from '../shared.js';

const ROWS_TABLE = 'app_invoice_mgr_rows';

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
  "issuer": "开票人",
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

// 第2页及之后只提取 items，不需要表头信息
const ITEMS_ONLY_PROMPT = `你是一个中国发票识别专家。请从这张发票**续页**图片中提取商品明细。

严格返回JSON格式：
{
  "items": [
    { "category": "分类", "name": "商品名称", "model": "规格", "unit": "单位",
      "quantity": 数量, "price": 单价, "amount": 金额,
      "taxRate": "税率", "taxAmount": 税额 }
  ]
}

规则：
- 金额为纯数字，不含逗号和符号
- 无法识别的字段用空字符串或0
- 无商品明细则items为空数组
- **注意：你只看到发票的续页，不要返回发票号、日期等表头信息**`;

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
    issuer: data.issuer || '',
    ocr_method: ocrMethod,
    ocr_raw: JSON.stringify(data),
    extraction_status: 'success',
    text_items_count: 0,
    keyword_count: 0,
  });
}

async function insertItems(services, recordId, items) {
  if (!items || items.length === 0) return 0;

  const insertList = [];
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

  // 批量插入：单条多行 SQL，减少 RTT 并保证原子性
  const COLUMNS = ['id', 'row_id', 'page_number', 'sort_order', 'category', 'name', 'model', 'unit', 'quantity', 'price', 'amount', 'tax_rate', 'tax_amount'];
  const placeholders = insertList.map(() => `(${COLUMNS.map(() => '?').join(',')})`).join(', ');
  const flatValues = [];
  for (const row of insertList) {
    flatValues.push(row.id, row.row_id, row.page_number, row.sort_order, row.category, row.name, row.model, row.unit, row.quantity, row.price, row.amount, row.tax_rate, row.tax_amount);
  }

  const sql = `INSERT INTO app_invoice_mgr_items (${COLUMNS.join(', ')}) VALUES ${placeholders}`;
  await services.execute(sql, flatValues);

  return insertList.length;
}

export const availableOutputs = [
  { key: 'invoice_number', label: '发票号码', type: 'string' },
  { key: 'invoice_date', label: '开票日期', type: 'string' },
  { key: 'seller_name', label: '销售方', type: 'string' },
  { key: 'total_with_tax', label: '价税合计', type: 'number' },
  { key: 'issuer', label: '开票人', type: 'string' },
];

export default {
  availableOutputs,
  async process(context) {
    const { record, files, services, app } = context;
    const file = files[0];

    const stepConfig = getStepResource(app, 'pending_vl_extract', {
      type: 'internal_llm',
      llm: { model_id: null, temperature: 0.1, timeout_ms: 300000 },
      render: { scale: 1.0, desired_width: 1400, retry_scale: 0.8, retry_desired_width: 1100 },
    });
    const llmCfg = stepConfig.llm || {};
    const renderCfg = stepConfig.render || {};

    if (!file || !file.attachment) {
      logger.error(`[invoice-vl-extract] Record ${record.id}: No file`);
      return { success: false, failure_code: 'no_file', error: '未找到文件' };
    }

    const resolvedPath = file.attachment._resolvedPath || resolveAttachmentPath(file.attachment);
    if (!resolvedPath) {
      logger.error(`[invoice-vl-extract] Record ${record.id}: 无法解析文件路径`);
      return { success: false, failure_code: 'path_resolve_failed', error: '无法解析文件路径' };
    }

    const skillPath = path.join('data', 'attachments', file.attachment.file_path);

    const fileName = file.attachment.file_name;
    const ext = path.extname(fileName).toLowerCase();

    logger.info(`[invoice-vl-extract] Record ${record.id}: ${fileName} (${ext}), path=${skillPath}`);

    let images = [];
    const isPdf = ext === '.pdf';

    const renderPdfPages = async ({ fromPage, toPage, scale, desiredWidth, tag }) => {
      const params = {
        operation: 'render',
        path: skillPath,
        scale,
        fromPage,
        toPage,
      };
      if (desiredWidth) {
        params.desiredWidth = desiredWidth;
      }

      const result = await services.callSkill('pdf', 'read', params);
      const pages = result?.pages || [];
      logger.info(
        `[invoice-vl-extract] Record ${record.id}: PDF渲染(${tag}) scale=${scale}, desiredWidth=${desiredWidth || 'n/a'}, pages=${pages.length}`
      );
      return pages;
    };

    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      const { readFile } = await import('fs/promises');
      const buffer = await readFile(resolvedPath);
      const mimeType = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      }[ext];
      images.push(`data:${mimeType};base64,${buffer.toString('base64')}`);
      logger.info(`[invoice-vl-extract] Record ${record.id}: 图片已转为dataUrl`);
    } else if (isPdf) {
      try {
        const renderResultPages = await renderPdfPages({
          fromPage: undefined,
          toPage: undefined,
          scale: renderCfg.scale ?? 1.0,
          desiredWidth: renderCfg.desired_width,
          tag: 'normal',
        });

        if (renderResultPages.length > 0) {
          images = renderResultPages.map(p => p.dataUrl);
          logger.info(`[invoice-vl-extract] Record ${record.id}: PDF渲染 ${renderResultPages.length} 页 → VL`);
        } else {
          logger.warn(`[invoice-vl-extract] Record ${record.id}: PDF 渲染无页面`);
          return { success: false, failure_code: 'pdf_render_empty', error: 'PDF渲染失败' };
        }
      } catch (e) {
        logger.error(`[invoice-vl-extract] Record ${record.id}: PDF渲染异常: ${e.message}`);
        return { success: false, failure_code: 'pdf_render_failed', error: `PDF渲染失败: ${e.message}` };
      }
    } else {
      logger.warn(`[invoice-vl-extract] Record ${record.id}: 不支持的文件格式 ${ext}`);
      return { success: false, failure_code: 'unsupported_format', error: `不支持的文件格式: ${ext}` };
    }

    if (images.length === 0) {
      return { success: false, failure_code: 'no_image_data', error: '无图片数据' };
    }

    const callVL = (prompt, imageUrl) => services.llm.extractJson(prompt, '', {
      images: [imageUrl],
      modelId: llmCfg.model_id || undefined,
      temperature: llmCfg.temperature ?? 0.1,
      timeout: llmCfg.timeout_ms ?? 300000,
    });

    // ========== 逐页调用 VL（每页一次请求，避免多页图片 payload 过大超时）==========

    let data;
    const allItems = [];

    for (let i = 0; i < images.length; i++) {
      const isFirstPage = (i === 0);
      const prompt = isFirstPage ? EXTRACT_PROMPT : ITEMS_ONLY_PROMPT;
      logger.info(`[invoice-vl-extract] Record ${record.id}: VL 第${i + 1}/${images.length}页...`);

      let pageResult;
      try {
        pageResult = await callVL(prompt, images[i]);
      } catch (e) {
        logger.error(`[invoice-vl-extract] Record ${record.id}: 第${i + 1}页 VL 异常: ${e.message}`);
        if (isFirstPage) {
          if (isPdf) {
            logger.warn(`[invoice-vl-extract] Record ${record.id}: 首页VL失败，尝试低分辨率重试`);
            try {
              const retryPages = await renderPdfPages({
                fromPage: 1,
                toPage: 1,
                scale: renderCfg.retry_scale ?? 0.8,
                desiredWidth: renderCfg.retry_desired_width ?? 1100,
                tag: 'retry-lowres',
              });
              const retryImage = retryPages?.[0]?.dataUrl;
              if (!retryImage) {
                throw new Error('低分辨率渲染首页为空');
              }
              pageResult = await callVL(prompt, retryImage);
              logger.info(`[invoice-vl-extract] Record ${record.id}: 首页VL低分辨率重试成功`);
            } catch (retryErr) {
              return { success: false, failure_code: 'vl_first_page_failed', error: `首页 VL 提取失败: ${retryErr.message}` };
            }
          } else {
            return { success: false, failure_code: 'vl_first_page_failed', error: `首页 VL 提取失败: ${e.message}` };
          }
        }
        // 续页失败跳过，不阻塞整张发票
        else {
          continue;
        }
      }

      if (!pageResult) {
        logger.warn(`[invoice-vl-extract] Record ${record.id}: 第${i + 1}页 VL 返回空，跳过`);
        if (isFirstPage) {
          return { success: false, failure_code: 'vl_first_page_empty', error: '首页 VL 返回空' };
        }
        continue;
      }

      if (isFirstPage) {
        data = pageResult;
      }

      const pageItems = pageResult.items || [];
      allItems.push(...pageItems);
      logger.info(`[invoice-vl-extract] Record ${record.id}: 第${i + 1}页 → ${pageItems.length} 项商品`);
    }

    if (!data) {
      logger.error(`[invoice-vl-extract] Record ${record.id}: 首页 VL 返回空`);
      return { success: false, failure_code: 'vl_no_result', error: 'VL提取结果为空' };
    }

    // 合并所有页的 items
    data.items = allItems;
    data.page_count = images.length;

    logger.info(`[invoice-vl-extract] Record ${record.id}: VL 完成，共 ${images.length} 页 ${allItems.length} 项商品`);


    if (!isValidInvoice(data)) {
      logger.warn(`[invoice-vl-extract] Record ${record.id}: VL提取结果无效(非发票)`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        ocr_method: 'vl',
        extraction_status: 'failed',
        ocr_raw: JSON.stringify({ error: 'not_invoice', reason: 'VL did not extract valid invoice data' }),
      });
      return { success: false, failure_code: 'not_invoice', error: 'not_invoice' };
    }

    const existingRowId = await checkDuplicate(services, data.invoice_number, record.id);
    if (existingRowId) {
      logger.info(`[invoice-vl-extract] Record ${record.id}: 发票号 ${data.invoice_number} 已存在`);
      await services.callExtension(ROWS_TABLE, 'upsert', {
        row_id: record.id,
        invoice_number: data.invoice_number,
        ocr_method: 'vl',
        extraction_status: 'duplicate',
        text_items_count: 0,
        keyword_count: 0,
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
