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

const pdfjsLib = require('pdfjs-dist');

if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

// ============================================
// 结构化异常模型
// ============================================

class InvoiceError extends Error {
  constructor(code, stage, message, cause) {
    super(message);
    this.name = 'InvoiceError';
    this.code = code;
    this.stage = stage;
    this.cause = cause || null;
  }

  toJSON() {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      cause: this.cause,
    };
  }
}

const ERROR_CODES = {
  PATH_NOT_ALLOWED: 'PATH_NOT_ALLOWED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PDF_READ_ERROR: 'PDF_READ_ERROR',
  NO_TEXT_LAYER: 'NO_TEXT_LAYER',
  PARSE_ERROR: 'PARSE_ERROR',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
};

// ============================================
// 路径安全检查
// ============================================

const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const USER_ID = process.env.USER_ID || 'default';
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? process.env.WORKING_DIRECTORY
  : path.join(process.cwd(), 'data', 'work', USER_ID);

const IS_ADMIN = process.env.IS_ADMIN === 'true';

let ALLOWED_BASE_PATHS;
if (IS_ADMIN) {
  ALLOWED_BASE_PATHS = [DATA_BASE_PATH];
} else {
  ALLOWED_BASE_PATHS = [USER_WORK_DIR];
}

async function getRealBasePaths() {
  const result = [];
  for (const basePath of ALLOWED_BASE_PATHS) {
    try {
      const rp = await fs.realpath(basePath);
      result.push(rp);
    } catch {
      result.push(path.resolve(basePath));
    }
  }
  return result;
}

function isPathSafe(targetResolved, realBasePaths) {
  const normalized = path.normalize(targetResolved);
  return realBasePaths.some(basePath => {
    const normalizedBase = path.normalize(basePath);
    const rel = path.relative(normalizedBase, normalized);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

async function resolvePath(filePath) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(ALLOWED_BASE_PATHS[0], filePath);

  const resolved = path.resolve(absolutePath);

  const realBasePaths = await getRealBasePaths();
  if (!isPathSafe(resolved, realBasePaths)) {
    throw new InvoiceError(
      ERROR_CODES.PATH_NOT_ALLOWED,
      'path_resolution',
      `Path not allowed: ${filePath}`
    );
  }

  try {
    const realPath = await fs.realpath(resolved);
    if (!isPathSafe(realPath, realBasePaths)) {
      throw new InvoiceError(
        ERROR_CODES.PATH_NOT_ALLOWED,
        'path_resolution',
        `Path not allowed (symlink): ${filePath}`
      );
    }
    return realPath;
  } catch (err) {
    if (err instanceof InvoiceError) throw err;
    throw new InvoiceError(
      ERROR_CODES.FILE_NOT_FOUND,
      'path_resolution',
      `File not found: ${filePath}`,
      err.message
    );
  }
}

// ============================================
// PDF 文本提取（带坐标）
// ============================================

const SCAN_TEXT_LENGTH_THRESHOLD = 50;

async function extractPdfText(filePath) {
  let dataBuffer;
  try {
    dataBuffer = await fs.readFile(filePath);
  } catch (err) {
    throw new InvoiceError(
      ERROR_CODES.FILE_NOT_FOUND,
      'pdf_read',
      `Cannot read file: ${filePath}`,
      err.message
    );
  }
  const uint8Array = new Uint8Array(dataBuffer);

  let pdfDocument;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    pdfDocument = await loadingTask.promise;
  } catch (err) {
    throw new InvoiceError(
      ERROR_CODES.PDF_READ_ERROR,
      'pdf_read',
      `Failed to parse PDF: ${filePath}`,
      err.message
    );
  }

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
      text: pageText,
    });
    fullText += pageText + '\n';

    pagesWithPositions.push({
      pageNumber: i,
      items: textContent.items
        .filter(item => item.str && item.str.trim())
        .map(item => ({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
        })),
    });
  }

  const totalTextLength = fullText.replace(/\s/g, '').length;
  let extractionStatus = 'SUCCESS';
  if (totalTextLength < SCAN_TEXT_LENGTH_THRESHOLD) {
    extractionStatus = 'NO_TEXT_LAYER';
  }

  return {
    text: fullText,
    pages,
    pagesWithPositions,
    pageCount: pdfDocument.numPages,
    metadata: metadata.info,
    textContentLength: totalTextLength,
    extractionStatus,
  };
}

// ============================================
// 坐标聚类算法
// ============================================

function clusterByY(items, yTolerance = 5) {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y);

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

const INVOICE_COLUMNS = [
  { name: 'projectName', minX: 10, maxX: 115 },
  { name: 'specification', minX: 115, maxX: 175 },
  { name: 'unit', minX: 190, maxX: 220 },
  { name: 'quantity', minX: 260, maxX: 300 },
  { name: 'unitPrice', minX: 320, maxX: 370 },
  { name: 'amount', minX: 390, maxX: 440 },
  { name: 'taxRate', minX: 450, maxX: 510 },
  { name: 'taxAmount', minX: 530, maxX: 595 },
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

// 提取发票号码（支持8位、20位 + 标签邻域提取）
function extractInvoiceNumber(items) {
  const digitOnly = items.find(i => i.str && /^\d{20}$/.test(i.str.trim()));
  if (digitOnly) return digitOnly.str.trim();

  const digit8 = items.find(i => i.str && /^\d{8}$/.test(i.str.trim()));
  if (digit8) return digit8.str.trim();

  const numberLabel = items.find(i =>
    i.str && (i.str.includes('发票号码') || i.str.includes('号码'))
  );
  if (numberLabel) {
    const labelEndX = numberLabel.x + (numberLabel.width || 50);
    const nearby = items
      .filter(i =>
        i.str && i.str.trim() &&
        Math.abs(i.y - numberLabel.y) < 10 &&
        i.x > labelEndX - 20 &&
        /^\d{8,20}$/.test(i.str.trim())
      )
      .sort((a, b) => a.x - b.x);

    if (nearby.length > 0) return nearby[0].str.trim();
  }

  const anyDigits = items.find(i => i.str && /^\d{8,20}$/.test(i.str.trim()));
  return anyDigits ? anyDigits.str.trim() : '';
}

// 提取开票日期（支持多格式与 token 拼接）
function extractInvoiceDate(items) {
  const dateLabel = items.find(i =>
    i.str && (i.str.includes('开票日期') ||
      (i.str.includes('开') && i.str.includes('票') && i.str.includes('日期')))
  );

  if (!dateLabel) return '';

  const labelEndX = dateLabel.x + (dateLabel.width || 60);

  const fullDateItem = items.find(i =>
    i.str && i.str.trim() &&
    Math.abs(i.y - dateLabel.y) < 5 &&
    i.x > labelEndX - 20 &&
    /\d{4}/.test(i.str)
  );

  if (!fullDateItem) return '';

  const raw = fullDateItem.str.trim();

  if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(raw)) return raw;

  const cnMatch = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cnMatch) return `${cnMatch[1]}年${cnMatch[2].padStart(2, '0')}月${cnMatch[3].padStart(2, '0')}日`;

  const dashMatch = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dashMatch) return `${dashMatch[1]}年${dashMatch[2].padStart(2, '0')}月${dashMatch[3].padStart(2, '0')}日`;

  const dotMatch = raw.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (dotMatch) return `${dotMatch[1]}年${dotMatch[2].padStart(2, '0')}月${dotMatch[3].padStart(2, '0')}日`;

  const slashMatch = raw.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slashMatch) return `${slashMatch[1]}年${slashMatch[2].padStart(2, '0')}月${slashMatch[3].padStart(2, '0')}日`;

  const yearOnly = raw.match(/^(\d{4})/);
  if (yearOnly) {
    const yearPart = yearOnly[1];
    const nearbyTokens = items
      .filter(i =>
        i.str && i.str.trim() &&
        Math.abs(i.y - dateLabel.y) < 5 &&
        i.x > labelEndX - 20
      )
      .sort((a, b) => a.x - b.x);

    const combined = nearbyTokens.map(i => i.str.trim()).join('');
    const combinedMatch = combined.match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
    if (combinedMatch) {
      return `${combinedMatch[1]}年${combinedMatch[2].padStart(2, '0')}月${combinedMatch[3].padStart(2, '0')}日`;
    }
  }

  return raw;
}

// 提取发票类型（增加专票/普票关键词集）
const INVOICE_TYPE_KEYWORDS = [
  '增值税专用发票',
  '增值税普通发票',
  '电子发票',
  '电子专票',
  '电子普票',
  '机动车销售统一发票',
  '二手车销售统一发票',
  '货物运输业增值税专用发票',
  '农产品收购发票',
  '农产品销售发票',
  '通行费发票',
];

function extractInvoiceType(items) {
  const allText = items.map(i => (i.str || '')).join('');

  for (const keyword of INVOICE_TYPE_KEYWORDS) {
    if (allText.includes(keyword)) {
      const typeItem = items.find(i => i.str && i.str.includes(keyword));
      if (typeItem) return typeItem.str.trim();
    }
  }

  const typeItem = items.find(i => i.str && i.str.includes('发票'));
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
        /^[A-Z0-9]{15,20}$/.test(i.str)
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

// ============================================
// 金额解析（统一清洗 + 一致性校验）
// ============================================

function cleanAmount(raw) {
  if (!raw) return 0;
  const s = String(raw)
    .replace(/[¥￥\s,，]/g, '')
    .replace(/[（(]/g, '-')
    .replace(/[）)]/g, '')
    .trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function extractNumbersFromText(raw) {
  if (!raw) return [];
  const text = String(raw).replace(/[¥￥,，\s]/g, '');
  const matches = text.match(/-?\d+(?:\.\d+)?/g) || [];
  return matches
    .map(v => Number(v))
    .filter(v => Number.isFinite(v));
}

function extractAmountInfo(items) {
  const yenItems = items.filter(i => i.str && (i.str.includes('¥') || i.str.includes('￥')))
    .sort((a, b) => a.y - b.y);

  let totalWithTax = 0;
  let amount = 0;
  let tax = 0;

  const totalLabel = items.find(i => i.str && i.str.includes('价税合计'));
  const xiaoxieLabel = items.find(i => i.str && i.str.includes('小写'));

  if (totalLabel && xiaoxieLabel) {
    const xiaoxieEndX = xiaoxieLabel.x + (xiaoxieLabel.width || 40);
    let amountItem = items.find(i =>
      (i.str && (i.str.includes('¥') || i.str.includes('￥'))) &&
      Math.abs(i.y - xiaoxieLabel.y) < 5 &&
      i.x > xiaoxieEndX - 10
    );

    if (!amountItem) {
      amountItem = items.find(i =>
        (i.str && (i.str.includes('¥') || i.str.includes('￥'))) &&
        i.y < xiaoxieLabel.y &&
        i.y > xiaoxieLabel.y - 30 &&
        i.x > xiaoxieLabel.x - 50
      );
    }

    if (amountItem) {
      totalWithTax = cleanAmount(amountItem.str);
    }
  }

  const hejiItems = items.filter(i => i.str === '合' || i.str === '计');
  if (hejiItems.length >= 2) {
    const heY = hejiItems.find(i => i.str === '合')?.y;
    const jiSameRow = hejiItems.find(i => i.str === '计' && Math.abs(i.y - heY) < 5);

    if (heY && jiSameRow) {
      const hejiYens = yenItems.filter(i => Math.abs(i.y - heY) < 8)
        .sort((a, b) => a.x - b.x);

      if (hejiYens.length >= 2) {
        amount = cleanAmount(hejiYens[0].str);
        tax = cleanAmount(hejiYens[1].str);
      }
    }
  }

  // 合计一致性校验
  if (totalWithTax > 0 && amount > 0 && tax > 0) {
    const expected = Math.round((amount + tax) * 100) / 100;
    if (Math.abs(totalWithTax - expected) > 0.02) {
      // totalWithTax 优先取价税合计标签旁的值
    }
  } else if (totalWithTax === 0 && amount > 0 && tax > 0) {
    totalWithTax = Math.round((amount + tax) * 100) / 100;
  }

  // 兜底：兼容电子发票中“¥”与数字分离、标签被拆词等情况
  if (totalWithTax === 0 || amount === 0 || tax === 0) {
    const clusters = clusterByY(items, 6);

    // 1) 通过“小写”行提取价税合计
    if (totalWithTax === 0) {
      for (const cluster of clusters) {
        const rowText = cluster.items.map(it => (it.str || '')).join('');
        if (!rowText) continue;

        const compact = rowText.replace(/\s+/g, '');
        const hasXiaoXie = compact.includes('小写') || (compact.includes('小') && compact.includes('写'));
        if (!hasXiaoXie) continue;

        const nums = extractNumbersFromText(compact);
        if (nums.length > 0) {
          totalWithTax = nums[nums.length - 1];
          break;
        }
      }
    }

    // 2) 通过“合计”行提取金额与税额
    if (amount === 0 || tax === 0) {
      for (const cluster of clusters) {
        const rowText = cluster.items.map(it => (it.str || '')).join('');
        if (!rowText) continue;

        const compact = rowText.replace(/\s+/g, '');
        if (!compact.includes('合') || !compact.includes('计')) continue;
        if (compact.includes('价税合计')) continue;

        const nums = extractNumbersFromText(compact);
        if (nums.length >= 2) {
          amount = amount || nums[nums.length - 2];
          tax = tax || nums[nums.length - 1];
          break;
        }
      }
    }

    // 3) 若仍无价税合计，按 金额+税额 回填
    if (totalWithTax === 0 && amount > 0 && tax > 0) {
      totalWithTax = Math.round((amount + tax) * 100) / 100;
    }
  }

  return { amount, tax, totalWithTax };
}

// ============================================
// 商品明细解析（列覆盖率 + 允许 category 为空）
// ============================================

function parseItems(items) {
  const columns = INVOICE_COLUMNS;
  const clusters = clusterByY(items, 8);

  if (clusters.length === 0) return [];

  let headerIndex = clusters.findIndex(c =>
    c.items.some(item => (item.str || '').includes('项目名称'))
  );
  if (headerIndex === -1) headerIndex = 0;

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
    const startsWithAsterisk = firstText.startsWith('*');

    const hasDataColumns = cluster.items.some(item => {
      const col = assignToColumn(item, columns);
      return col && col !== 'projectName';
    });

    const isNewItem = startsWithAsterisk || (!foundSubtotal && hasDataColumns && !currentRow);

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
        taxAmount: '',
      };
    }

    if (foundSubtotal || !currentRow) continue;

    for (const item of cluster.items) {
      const colName = assignToColumn(item, columns);
      if (colName && currentRow[colName] !== undefined) {
        currentRow[colName] += item.str;
      } else if (colName === 'projectName' || !colName) {
        // 跳过看起来像金额的 token（负数或纯数字，避免负值金额混入商品名称）
        const txt = (item.str || '').trim();
        if (/^-?\d+(?:\.\d+)?$/.test(txt)) {
          // 可能是被错位的金额列文本，尝试放入 amount 或 taxAmount
          if (item.x >= columns.find(c => c.name === 'amount').minX - 20) {
            currentRow.amount += item.str;
          } else if (item.x >= columns.find(c => c.name === 'taxAmount').minX - 20) {
            currentRow.taxAmount += item.str;
          }
          // 如果 x 坐标也不在金额区域，则丢弃（不混入名称）
          continue;
        }
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
      name: name || row.rawName.trim(),
      model: row.specification.trim(),
      unit: row.unit.trim(),
      quantity: parseFloat(row.quantity) || 0,
      price: parseFloat(row.unitPrice) || 0,
      amount: cleanAmount(row.amount),
      taxRate: row.taxRate.trim(),
      taxAmount: cleanAmount(row.taxAmount),
    };
  }).filter(item => item.name || item.amount > 0);
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
// 发票数据解析主函数（全页候选打分策略）
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
    remarks: '',
    fieldSources: {},
  };

  const candidates = {
    invoiceNumber: [],
    invoiceDate: [],
    invoiceType: [],
    buyer: [],
    seller: [],
    amount: [],
    remarks: [],
  };

  for (const page of pagesWithPositions) {
    const items = page.items || [];
    if (items.length === 0) continue;

    const num = extractInvoiceNumber(items);
    if (num) candidates.invoiceNumber.push({ value: num, page: page.pageNumber, score: num.length });

    const date = extractInvoiceDate(items);
    if (date) candidates.invoiceDate.push({ value: date, page: page.pageNumber, score: date.length });

    const type = extractInvoiceType(items);
    if (type) candidates.invoiceType.push({ value: type, page: page.pageNumber, score: type.length });

    const { buyer, seller } = extractCompanyInfo(items);
    if (buyer.name) candidates.buyer.push({ value: buyer, page: page.pageNumber, score: buyer.name.length });
    if (seller.name) candidates.seller.push({ value: seller, page: page.pageNumber, score: seller.name.length });

    const amountData = extractAmountInfo(items);
    if (amountData.totalWithTax > 0 || amountData.amount > 0) {
      candidates.amount.push({ value: amountData, page: page.pageNumber, score: amountData.totalWithTax });
    }

    const remarks = extractRemarks(items);
    if (remarks) candidates.remarks.push({ value: remarks, page: page.pageNumber, score: remarks.length });
  }

  const pickBest = (arr) => arr.sort((a, b) => b.score - a.score)[0] || null;

  const bestNum = pickBest(candidates.invoiceNumber);
  if (bestNum) { result.invoiceNumber = bestNum.value; result.fieldSources.invoiceNumber = bestNum.page; }

  const bestDate = pickBest(candidates.invoiceDate);
  if (bestDate) { result.invoiceDate = bestDate.value; result.fieldSources.invoiceDate = bestDate.page; }

  const bestType = pickBest(candidates.invoiceType);
  if (bestType) { result.invoiceType = bestType.value; result.fieldSources.invoiceType = bestType.page; }

  const bestBuyer = pickBest(candidates.buyer);
  if (bestBuyer) { result.buyer = bestBuyer.value; result.fieldSources.buyer = bestBuyer.page; }

  const bestSeller = pickBest(candidates.seller);
  if (bestSeller) { result.seller = bestSeller.value; result.fieldSources.seller = bestSeller.page; }

  const bestAmount = pickBest(candidates.amount);
  if (bestAmount) {
    result.totalAmount = bestAmount.value.amount;
    result.totalTax = bestAmount.value.tax;
    result.totalWithTax = bestAmount.value.totalWithTax;
    result.fieldSources.amount = bestAmount.page;
  }

  const bestRemarks = pickBest(candidates.remarks);
  if (bestRemarks) { result.remarks = bestRemarks.value; result.fieldSources.remarks = bestRemarks.page; }

  // 解析每页商品明细
  for (const page of pagesWithPositions) {
    if (page.items && page.items.length > 0) {
      const items = parseItems(page.items);
      const issuer = extractIssuer(page.items);

      if (items.length > 0) {
        result.pages.push({
          pageNumber: page.pageNumber,
          issuer: issuer,
          itemCount: items.length,
          items: items,
        });
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
          md += `| ${++idx} | ${item.category || '-'} | ${item.name} | ${item.model} | ${item.unit} | ${item.quantity} | ${item.price} | ${item.amount} | ${item.taxRate} | ${item.taxAmount} |\n`;
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
        md += `| ${++idx} | ${item.category || '-'} | ${item.name} | ${item.model} | ${item.unit} | ${item.quantity} | ${item.price} | ${item.amount} | ${item.taxRate} | ${item.taxAmount} |\n`;
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

  const resolvedPath = await resolvePath(filePath);

  const { text, pages, pagesWithPositions, pageCount, metadata, textContentLength, extractionStatus } =
    await extractPdfText(resolvedPath);

  if (extractionStatus === 'NO_TEXT_LAYER') {
    return {
      success: false,
      failure_reason: 'NO_TEXT_LAYER',
      message: 'PDF has no text layer (scanned image). Use OCR or VL model first.',
      text_content_length: textContentLength,
      extraction_status: extractionStatus,
      invoice_number: '',
      invoice_date: '',
      invoice_type: '',
      seller: { name: '', taxId: '' },
      buyer: { name: '', taxId: '' },
      total_amount: 0,
      total_tax: 0,
      total_with_tax: 0,
      item_count: 0,
      page_count: pageCount,
      remarks: '',
      output_file: null,
      content: '',
      format: format,
    };
  }

  const invoice = parseInvoiceData(text, metadata, pagesWithPositions);

  const pdfName = path.basename(resolvedPath, '.pdf');
  const data = {
    name: pdfName,
    invoice,
    pageCount,
    metadata,
  };

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

  if (output) {
    const resolvedOutput = await resolvePath(output);
    const outputDir = path.dirname(resolvedOutput);

    try {
      await fs.access(outputDir);
    } catch {
      await fs.mkdir(outputDir, { recursive: true });
    }

    await fs.writeFile(resolvedOutput, outputContent, 'utf-8');
    outputFile = resolvedOutput;
  }

  const itemCount = invoice.pages.reduce((sum, p) => sum + p.itemCount, 0);

  const hasCriticalField = invoice.invoiceNumber || invoice.invoiceDate || invoice.totalWithTax > 0;

  return {
    success: hasCriticalField,
    failure_reason: hasCriticalField ? null : 'PARSE_INCOMPLETE',
    message: hasCriticalField ? null : 'Failed to extract critical invoice fields',
    text_content_length: textContentLength,
    extraction_status: extractionStatus,
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
    pages: invoice.pages,
    invoice: invoice,
    field_sources: invoice.fieldSources,
    output_file: outputFile,
    content: outputContent,
    format: format,
  };
}

// ============================================
// 工具定义
// ============================================

function getTools() {
  return [
    {
      name: 'extract',
      description: '提取发票结构化数据（支持增值税发票、普通发票、电子发票）。可提取发票号码、日期、买卖双方信息、商品明细、金额等字段。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'PDF发票文件路径（必需）',
          },
          format: {
            type: 'string',
            enum: ['json', 'markdown'],
            description: '输出格式，默认 json',
            default: 'json',
          },
          output: {
            type: 'string',
            description: '输出文件路径（可选，不指定则只返回内容）',
          },
        },
        required: ['path'],
      },
    },
  ];
}

// ============================================
// Skill 入口
// ============================================

async function execute(toolName, params, context = {}) {
  try {
    switch (toolName) {
      case 'extract':
        return await extract(params);
      default:
        throw new InvoiceError(
          ERROR_CODES.UNKNOWN_TOOL,
          'execute',
          `Unknown tool: ${toolName}. Supported tools: extract`
        );
    }
  } catch (err) {
    if (err instanceof InvoiceError) {
      return {
        success: false,
        failure_reason: err.code,
        message: err.message,
        error: err.toJSON(),
      };
    }
    return {
      success: false,
      failure_reason: 'UNEXPECTED_ERROR',
      message: err.message || 'Unexpected error',
      error: {
        code: 'UNEXPECTED_ERROR',
        stage: 'execute',
        message: err.message || 'Unexpected error',
        cause: null,
      },
    };
  }
}

module.exports = { execute, getTools };
