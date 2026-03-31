/**
 * Invoice Skill - 发票专用解析技能
 * 
 * 基于 pdfjs-dist 实现坐标提取，专门用于解析中国增值税发票
 * 
 * 功能：
 * - extract: 提取发票结构化数据（支持增值税发票、普通发票、电子发票）
 * 
 * 依赖：pdfjs-dist (Mozilla PDF.js)
 */

const fs = require('fs').promises;
const path = require('path');
const { pathToFileURL } = require('url');

// 使用 pdfjs-dist 2.x (CommonJS 版本，兼容 VM 沙箱)
const pdfjsLib = require('pdfjs-dist');

// 禁用 worker（在 VM 沙箱中不需要）
if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

// ============================================
// 路径安全检查
// ============================================

const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const USER_ID = process.env.USER_ID || 'default';
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? path.join(DATA_BASE_PATH, process.env.WORKING_DIRECTORY)
  : path.join(DATA_BASE_PATH, 'work', USER_ID);

const IS_ADMIN = process.env.IS_ADMIN === 'true';

let ALLOWED_BASE_PATHS;
if (IS_ADMIN) {
  ALLOWED_BASE_PATHS = [DATA_BASE_PATH];
} else {
  ALLOWED_BASE_PATHS = [USER_WORK_DIR];
}

function isPathAllowed(targetPath) {
  let resolved = path.resolve(targetPath);
  return ALLOWED_BASE_PATHS.some(basePath => {
    let resolvedBase = path.resolve(basePath);
    return resolved.startsWith(resolvedBase);
  });
}

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) {
    if (!isPathAllowed(filePath)) {
      throw new Error(`Path not allowed: ${filePath}`);
    }
    return filePath;
  }
  
  const resolved = path.join(ALLOWED_BASE_PATHS[0], filePath);
  if (!isPathAllowed(resolved)) {
    throw new Error(`Path not allowed: ${resolved}`);
  }
  return resolved;
}

// ============================================
// PDF 文本提取（带坐标）
// ============================================

async function extractPdfText(filePath) {
  const dataBuffer = await fs.readFile(filePath);
  const uint8Array = new Uint8Array(dataBuffer);
  
  const loadingTask = pdfjsLib.getDocument({
    data: uint8Array,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  
  const pdfDocument = await loadingTask.promise;
  const metadata = await pdfDocument.getMetadata();
  
  let fullText = '';
  const pages = [];
  const pagesWithPositions = [];
  
  for (let i = 1; i <= pdfDocument.numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    
    pages.push({
      pageNumber: i,
      text: pageText
    });
    fullText += pageText + '\n';
    
    // 存储带坐标的文本项
    pagesWithPositions.push({
      pageNumber: i,
      items: textContent.items.map(item => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height
      }))
    });
  }
  
  return {
    text: fullText,
    pages,
    pagesWithPositions,
    pageCount: pdfDocument.numPages,
    metadata: metadata.info
  };
}

// ============================================
// 坐标聚类算法
// ============================================

function clusterByY(items, yTolerance = 5) {
  if (items.length === 0) return [];
  
  const validItems = items.filter(item => item.str && item.str.trim());
  if (validItems.length === 0) return [];
  
  // 按 y 降序排序（PDF坐标系原点在左下角）
  const sorted = [...validItems].sort((a, b) => b.y - a.y);
  
  const clusters = [];
  let currentCluster = { y: sorted[0].y, items: [sorted[0]] };
  
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - currentCluster.y) <= yTolerance) {
      currentCluster.items.push(item);
    } else {
      currentCluster.items.sort((a, b) => a.x - b.x);
      clusters.push(currentCluster);
      currentCluster = { y: item.y, items: [item] };
    }
  }
  
  currentCluster.items.sort((a, b) => a.x - b.x);
  clusters.push(currentCluster);
  
  return clusters;
}

// ============================================
// 发票字段提取
// ============================================

// 标准增值税发票列定义
const INVOICE_COLUMNS = [
  { name: 'projectName', minX: 10, maxX: 115 },
  { name: 'specification', minX: 115, maxX: 175 },
  { name: 'unit', minX: 190, maxX: 220 },
  { name: 'quantity', minX: 260, maxX: 300 },
  { name: 'unitPrice', minX: 320, maxX: 370 },
  { name: 'amount', minX: 390, maxX: 440 },
  { name: 'taxRate', minX: 450, maxX: 510 },
  { name: 'taxAmount', minX: 530, maxX: 595 }
];

function assignToColumn(item, columns) {
  const x = item.x;
  for (const col of columns) {
    if (x >= col.minX && x < col.maxX) {
      return col.name;
    }
  }
  return null;
}

function isSubtotalOrTotalRow(cluster) {
  const rowText = cluster.items.map(it => it.str || '').join('');
  if (rowText.startsWith('*')) return false;
  
  if (rowText.includes('小') && rowText.includes('计')) return true;
  if (rowText.includes('合') && rowText.includes('计')) return true;
  if (rowText.includes('¥')) return true;
  if (rowText.includes('开票人')) return true;
  
  return false;
}

// 提取发票号码（20位数字）
function extractInvoiceNumber(items) {
  const invoiceNum = items.find(i => i.str && /^\d{20}$/.test(i.str.trim()));
  return invoiceNum ? invoiceNum.str.trim() : '';
}

// 提取开票日期
function extractInvoiceDate(items) {
  const dateLabel = items.find(i => 
    i.str && (i.str.includes('开票日期') || 
    (i.str.includes('开') && i.str.includes('票') && i.str.includes('日期')))
  );
  
  if (!dateLabel) return '';
  
  const labelEndX = dateLabel.x + (dateLabel.width || 60);
  const dateItem = items.find(i =>
    i.str && i.str.trim() &&
    Math.abs(i.y - dateLabel.y) < 5 &&
    i.x > labelEndX - 20 &&
    /\d{4}年\d{2}月\d{2}日/.test(i.str)
  );
  
  return dateItem ? dateItem.str.trim() : '';
}

// 提取发票类型
function extractInvoiceType(items) {
  const typeItem = items.find(i => i.str && i.str.includes('电子发票'));
  return typeItem ? typeItem.str.trim() : '';
}

// 提取公司信息
function extractCompanyInfo(items) {
  const nameLabels = items.filter(i => i.str === '名称：' || i.str === '名称:');
  const taxLabels = items.filter(i => 
    i.str && (i.str.includes('统一社会') || i.str.includes('纳税人识别号'))
  );
  
  let buyer = { name: '', taxId: '' };
  let seller = { name: '', taxId: '' };
  
  const columnBoundary = nameLabels.length >= 2 ? 
    (nameLabels[0].x + nameLabels[1].x) / 2 : 200;
  
  for (const label of nameLabels) {
    const isBuyerColumn = label.x < columnBoundary;
    
    const sameRow = items.filter(i => 
      Math.abs(i.y - label.y) < 3 && 
      i.x > label.x &&
      (isBuyerColumn ? i.x < columnBoundary : true)
    ).sort((a, b) => a.x - b.x);
    
    const companyName = sameRow.map(i => i.str).join('').trim();
    
    const columnTaxLabel = taxLabels.find(t => Math.abs(t.x - label.x) < 50);
    
    let taxId = '';
    if (columnTaxLabel) {
      const taxCandidates = items.filter(i => 
        Math.abs(i.y - columnTaxLabel.y) < 5 &&
        i.x > columnTaxLabel.x + 50 &&
        /^[A-Z0-9]{15,18}$/.test(i.str)
      ).sort((a, b) => a.x - b.x);
      
      taxId = taxCandidates.length > 0 ? taxCandidates[0].str : '';
    }
    
    if (isBuyerColumn) {
      buyer.name = companyName;
      buyer.taxId = taxId;
    } else {
      seller.name = companyName;
      seller.taxId = taxId;
    }
  }
  
  return { buyer, seller };
}

// 提取开票人
function extractIssuer(items) {
  const issuerLabel = items.find(i => 
    i.str && (i.str.includes('开') && i.str.includes('票') && i.str.includes('人'))
  );
  
  if (!issuerLabel) return '';
  
  const labelEndX = issuerLabel.x + (issuerLabel.width || 50);
  const issuerValue = items.find(i =>
    i.str && i.str.trim() &&
    Math.abs(i.y - issuerLabel.y) < 5 &&
    i.x > labelEndX - 10 &&
    i.x < 200
  );
  
  return issuerValue ? issuerValue.str.trim() : '';
}

// 提取金额信息
function extractAmountInfo(items) {
  const yenItems = items.filter(i => i.str && i.str.includes('¥'))
    .sort((a, b) => a.y - b.y);
  
  if (yenItems.length === 0) return { amount: 0, tax: 0, totalWithTax: 0 };
  
  // 找价税合计
  const totalLabel = items.find(i => i.str && i.str.includes('价税合计'));
  const xiaoxieLabel = items.find(i => i.str && i.str.includes('小写'));
  
  let totalWithTax = 0;
  let amount = 0;
  let tax = 0;
  
  if (totalLabel && xiaoxieLabel) {
    const xiaoxieEndX = xiaoxieLabel.x + (xiaoxieLabel.width || 40);
    let amountItem = items.find(i =>
      i.str && i.str.includes('¥') &&
      Math.abs(i.y - xiaoxieLabel.y) < 5 &&
      i.x > xiaoxieEndX - 10
    );
    
    if (!amountItem) {
      amountItem = items.find(i =>
        i.str && i.str.includes('¥') &&
        i.y < xiaoxieLabel.y &&
        i.y > xiaoxieLabel.y - 30 &&
        i.x > xiaoxieLabel.x - 50
      );
    }
    
    if (amountItem) {
      const amountStr = amountItem.str.replace('¥', '').replace(',', '').trim();
      totalWithTax = parseFloat(amountStr) || 0;
    }
  }
  
  // 找合计行
  const hejiItems = items.filter(i => i.str === '合' || i.str === '计');
  if (hejiItems.length >= 2) {
    const heY = hejiItems.find(i => i.str === '合')?.y;
    const jiSameRow = hejiItems.find(i => i.str === '计' && Math.abs(i.y - heY) < 5);
    
    if (heY && jiSameRow) {
      const hejiYens = yenItems.filter(i => Math.abs(i.y - heY) < 8)
        .sort((a, b) => a.x - b.x);
      
      if (hejiYens.length >= 2) {
        amount = parseFloat(hejiYens[0].str.replace('¥', '').replace(',', '').trim()) || 0;
        tax = parseFloat(hejiYens[1].str.replace('¥', '').replace(',', '').trim()) || 0;
      }
    }
  }
  
  return { amount, tax, totalWithTax };
}

// 提取商品明细
function parseItems(items) {
  const columns = INVOICE_COLUMNS;
  const clusters = clusterByY(items, 8);
  
  if (clusters.length === 0) return [];
  
  // 找表头行
  let headerIndex = clusters.findIndex(c =>
    c.items.some(item => (item.str || '').includes('项目名称'))
  );
  if (headerIndex === -1) headerIndex = 0;
  
  // 找结束行（合计）
  let endIndex = clusters.findIndex(c =>
    c.items.some(item => {
      const txt = item.str || '';
      return txt.includes('合') && txt.includes('计');
    })
  );
  if (endIndex === -1) endIndex = clusters.length;
  
  const itemRows = [];
  let currentRow = null;
  let foundSubtotal = false;
  
  for (let i = headerIndex + 1; i < endIndex; i++) {
    const cluster = clusters[i];
    
    if (isSubtotalOrTotalRow(cluster)) {
      foundSubtotal = true;
      continue;
    }
    
    const rowText = cluster.items.map(it => it.str || '').join('');
    if (rowText.includes('合') && rowText.includes('计') && !rowText.startsWith('*')) {
      foundSubtotal = true;
      continue;
    }
    
    const firstText = cluster.items[0]?.str || '';
    const isNewItem = firstText.startsWith('*');
    
    if (isNewItem) {
      foundSubtotal = false;
      if (currentRow) {
        itemRows.push(currentRow);
      }
      currentRow = {
        rawName: '',
        specification: '',
        unit: '',
        quantity: '',
        unitPrice: '',
        amount: '',
        taxRate: '',
        taxAmount: ''
      };
    }
    
    if (foundSubtotal || !currentRow) continue;
    
    for (const item of cluster.items) {
      const colName = assignToColumn(item, columns);
      if (colName && currentRow[colName] !== undefined) {
        currentRow[colName] += item.str;
      } else if (colName === 'projectName' || !colName) {
        currentRow.rawName += item.str;
      }
    }
  }
  
  if (currentRow) {
    itemRows.push(currentRow);
  }
  
  return itemRows.map(row => {
    let category = '';
    let name = row.rawName;
    const categoryMatch = row.rawName.match(/\*([^*]+)\*/);
    if (categoryMatch) {
      category = categoryMatch[1];
      name = row.rawName.replace(/\*[^*]+\*/, '').trim();
    }
    
    return {
      category,
      name,
      model: row.specification.trim(),
      unit: row.unit.trim(),
      quantity: parseFloat(row.quantity) || 0,
      price: parseFloat(row.unitPrice) || 0,
      amount: parseFloat(row.amount) || 0,
      taxRate: row.taxRate.trim(),
      taxAmount: parseFloat(row.taxAmount) || 0
    };
  }).filter(item => item.category && item.name);
}

// 提取备注
function extractRemarks(items) {
  const beiItem = items.find(i => i.str === '备');
  const zhuItem = items.find(i => i.str === '注');
  const jiaItem = items.find(i => {
    if (!i.str) return false;
    const s = i.str.replace(/\s+/g, '');
    return s.includes('价') && s.includes('税') && s.includes('合计');
  });
  
  if (beiItem && zhuItem) {
    const remarksMinX = beiItem.x + (beiItem.width || 10);
    let upperBoundY = jiaItem ? jiaItem.y - 5 : 200;
    const remarksMaxY = Math.min(beiItem.y, zhuItem.y) + 20;
    
    const remarksItems = items.filter(i =>
      i.str && i.str.trim() &&
      i.x > remarksMinX &&
      i.y < upperBoundY &&
      i.y > remarksMaxY - 30
    );
    
    remarksItems.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 5) return b.y - a.y;
      return a.x - b.x;
    });
    
    if (remarksItems.length > 0) {
      return remarksItems.map(i => i.str).join(' ');
    }
  }
  
  return '';
}

// ============================================
// 发票数据解析主函数
// ============================================

function parseInvoiceData(text, metadata, pagesWithPositions) {
  const result = {
    invoiceNumber: '',
    invoiceDate: '',
    invoiceType: '',
    seller: { name: '', taxId: '' },
    buyer: { name: '', taxId: '' },
    pages: [],
    totalAmount: 0,
    totalTax: 0,
    totalWithTax: 0,
    currency: 'CNY',
    remarks: ''
  };
  
  // 从第一页提取基本信息
  if (pagesWithPositions.length > 0 && pagesWithPositions[0].items) {
    const items = pagesWithPositions[0].items;
    
    result.invoiceNumber = extractInvoiceNumber(items);
    result.invoiceDate = extractInvoiceDate(items);
    result.invoiceType = extractInvoiceType(items);
    
    const { buyer, seller } = extractCompanyInfo(items);
    result.buyer = buyer;
    result.seller = seller;
  }
  
  // 从最后一页提取金额和备注
  if (pagesWithPositions.length > 0) {
    const lastPage = pagesWithPositions[pagesWithPositions.length - 1];
    const lastPageItems = lastPage.items || [];
    
    const amountData = extractAmountInfo(lastPageItems);
    result.totalAmount = amountData.amount;
    result.totalTax = amountData.tax;
    result.totalWithTax = amountData.totalWithTax;
    
    result.remarks = extractRemarks(lastPageItems);
  }
  
  // 解析每页商品明细
  if (pagesWithPositions.length > 0) {
    for (const page of pagesWithPositions) {
      if (page.items && page.items.length > 0) {
        const items = parseItems(page.items);
        const issuer = extractIssuer(page.items);
        
        if (items.length > 0) {
          result.pages.push({
            pageNumber: page.pageNumber,
            issuer: issuer,
            itemCount: items.length,
            items: items
          });
        }
      }
    }
  }
  
  return result;
}

// ============================================
// 输出格式化
// ============================================

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

function formatMarkdown(data) {
  const { invoice, pageCount } = data;
  
  let md = `# 发票信息\n\n`;
  
  md += `## 基本信息\n\n`;
  md += `| 项目 | 内容 |\n`;
  md += `|------|------|\n`;
  if (invoice.invoiceNumber) md += `| 发票号码 | ${invoice.invoiceNumber} |\n`;
  if (invoice.invoiceDate) md += `| 开票日期 | ${invoice.invoiceDate} |\n`;
  if (invoice.invoiceType) md += `| 发票类型 | ${invoice.invoiceType} |\n`;
  md += `| 页数 | ${pageCount} |\n`;
  md += `\n`;
  
  md += `## 交易方\n\n`;
  md += `### 销售方\n\n`;
  md += `- **名称**: ${invoice.seller.name || '未识别'}\n`;
  if (invoice.seller.taxId) md += `- **税号**: ${invoice.seller.taxId}\n`;
  md += `\n`;
  md += `### 购买方\n\n`;
  md += `- **名称**: ${invoice.buyer.name || '未识别'}\n`;
  if (invoice.buyer.taxId) md += `- **税号**: ${invoice.buyer.taxId}\n`;
  md += `\n`;
  
  md += `## 金额\n\n`;
  md += `| 项目 | 金额 |\n`;
  md += `|------|------|\n`;
  md += `| 合计金额 | ¥${invoice.totalAmount.toLocaleString()} |\n`;
  md += `| 税额 | ¥${invoice.totalTax.toLocaleString()} |\n`;
  md += `| **价税合计** | **¥${invoice.totalWithTax.toLocaleString()}** |\n`;
  md += `\n`;
  
  const totalItems = invoice.pages.reduce((sum, p) => sum + p.itemCount, 0);
  if (totalItems > 0) {
    md += `## 商品明细\n\n`;
    
    if (invoice.pages.length > 1) {
      for (const page of invoice.pages) {
        md += `### 第 ${page.pageNumber} 页`;
        if (page.issuer) md += ` - 开票人: ${page.issuer}`;
        md += `\n\n`;
        
        md += `| 序号 | 分类 | 商品名称 | 规格型号 | 单位 | 数量 | 单价 | 金额 | 税率 | 税额 |\n`;
        md += `|------|------|----------|----------|------|------|------|------|------|------|\n`;
        let idx = 0;
        for (const item of page.items) {
          md += `| ${++idx} | ${item.category} | ${item.name} | ${item.model} | ${item.unit} | ${item.quantity} | ${item.price} | ${item.amount} | ${item.taxRate} | ${item.taxAmount} |\n`;
        }
        md += `\n`;
      }
    } else {
      const page = invoice.pages[0];
      if (page.issuer) {
        md += `**开票人**: ${page.issuer}\n\n`;
      }
      
      md += `| 序号 | 分类 | 商品名称 | 规格型号 | 单位 | 数量 | 单价 | 金额 | 税率 | 税额 |\n`;
      md += `|------|------|----------|----------|------|------|------|------|------|------|\n`;
      let idx = 0;
      for (const item of page.items) {
        md += `| ${++idx} | ${item.category} | ${item.name} | ${item.model} | ${item.unit} | ${item.quantity} | ${item.price} | ${item.amount} | ${item.taxRate} | ${item.taxAmount} |\n`;
      }
      md += `\n`;
    }
  }
  
  if (invoice.remarks) {
    md += `## 备注\n\n`;
    md += `${invoice.remarks}\n\n`;
  }
  
  return md;
}

// ============================================
// 工具实现：extract
// ============================================

async function extract(params) {
  const { path: filePath, format = 'json', output } = params;
  
  // 检查文件
  const resolvedPath = resolvePath(filePath);
  try {
    await fs.access(resolvedPath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }
  
  // 提取PDF内容
  const { text, pages, pagesWithPositions, pageCount, metadata } = await extractPdfText(resolvedPath);
  
  // 解析发票数据
  const invoice = parseInvoiceData(text, metadata, pagesWithPositions);
  
  // 准备输出数据
  const pdfName = path.basename(resolvedPath, '.pdf');
  const data = {
    name: pdfName,
    invoice,
    pageCount,
    metadata
  };
  
  // 格式化输出
  let outputContent;
  let outputFile = null;
  
  switch (format.toLowerCase()) {
    case 'markdown':
    case 'md':
      outputContent = formatMarkdown(data);
      break;
    case 'json':
    default:
      outputContent = formatJson(data);
  }
  
  // 如果指定了输出路径，保存文件
  if (output) {
    const resolvedOutput = resolvePath(output);
    const outputDir = path.dirname(resolvedOutput);
    
    try {
      await fs.access(outputDir);
    } catch {
      await fs.mkdir(outputDir, { recursive: true });
    }
    
    await fs.writeFile(resolvedOutput, outputContent, 'utf-8');
    outputFile = resolvedOutput;
  }
  
  // 计算总商品数
  const itemCount = invoice.pages.reduce((sum, p) => sum + p.itemCount, 0);
  
  return {
    success: true,
    invoice_number: invoice.invoiceNumber,
    invoice_date: invoice.invoiceDate,
    invoice_type: invoice.invoiceType,
    seller: invoice.seller,
    buyer: invoice.buyer,
    total_amount: invoice.totalAmount,
    total_tax: invoice.totalTax,
    total_with_tax: invoice.totalWithTax,
    item_count: itemCount,
    page_count: pageCount,
    remarks: invoice.remarks,
    output_file: outputFile,
    content: outputContent,
    format: format
  };
}

// ============================================
// Skill 入口
// ============================================

async function execute(toolName, params, context = {}) {
  switch (toolName) {
    case 'extract':
      return await extract(params);
    default:
      throw new Error(`Unknown tool: ${toolName}. Supported tools: extract`);
  }
}

module.exports = { execute };
