/**
 * PDF Skill - PDF 处理技能 (Node.js 版本)
 * 
 * 功能：
 * - 读取 PDF 元数据和基本信息
 * - 提取文本内容
 * - 合并多个 PDF
 * - 拆分 PDF
 * - 旋转页面
 * - 创建新 PDF
 * - 加密/解密 PDF
 * - 添加水印
 * - 表单操作（读取、填写）
 * - 提取图片
 * 
 * 依赖：
 * - pdf-lib: PDF 操作核心库
 * - pdf-parse: 文本提取
 */

const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// pdf-parse 是可选依赖，延迟加载
let pdfParse = null;
async function getPdfParse() {
  if (!pdfParse) {
    pdfParse = require('pdf-parse');
  }
  return pdfParse;
}

/**
 * 解析路径（支持相对路径）
 * @param {string} inputPath - 输入路径
 * @returns {string} 绝对路径
 */
function resolvePath(inputPath) {
  if (!inputPath) return inputPath;
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(process.cwd(), inputPath);
}

/**
 * 读取 PDF 文件
 * @param {string} filePath - PDF 文件路径
 * @returns {Promise<Buffer>} 文件内容
 */
async function readPdfFile(filePath) {
  const resolvedPath = resolvePath(filePath);
  return await fs.readFile(resolvedPath);
}

/**
 * 保存 PDF 文件
 * @param {string} filePath - 输出路径
 * @param {Uint8Array} pdfBytes - PDF 数据
 */
async function savePdfFile(filePath, pdfBytes) {
  const resolvedPath = resolvePath(filePath);
  const dir = path.dirname(resolvedPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(resolvedPath, pdfBytes);
}

// ==================== 基础操作 ====================

/**
 * 读取 PDF 元数据和基本信息
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @returns {Promise<Object>} PDF 信息
 */
async function readPdf(params) {
  const { path: filePath } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  // 获取元数据
  const metadata = {
    title: pdfDoc.getTitle() || null,
    author: pdfDoc.getAuthor() || null,
    subject: pdfDoc.getSubject() || null,
    creator: pdfDoc.getCreator() || null,
    producer: pdfDoc.getProducer() || null,
    creationDate: pdfDoc.getCreationDate()?.toISOString() || null,
    modificationDate: pdfDoc.getModificationDate()?.toISOString() || null,
    keywords: pdfDoc.getKeywords() || null
  };
  
  // 获取页面信息
  const pages = pdfDoc.getPages();
  const pageCount = pages.length;
  
  // 检查是否加密
  const isEncrypted = pdfDoc.isEncrypted;
  
  return {
    success: true,
    pageCount,
    metadata,
    isEncrypted,
    pages: pages.map((page, index) => ({
      number: index + 1,
      width: page.getWidth(),
      height: page.getHeight()
    }))
  };
}

/**
 * 提取文本内容
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {number} params.fromPage - 起始页（1-based）
 * @param {number} params.toPage - 结束页（inclusive）
 * @returns {Promise<Object>} 提取结果
 */
async function extractText(params) {
  const { path: filePath, fromPage, toPage } = params;
  
  const pdfParseLib = await getPdfParse();
  const pdfBytes = await readPdfFile(filePath);
  
  const data = await pdfParseLib(pdfBytes);
  
  let text = data.text;
  const totalPages = data.numpages;
  
  // 如果指定了页面范围，需要更精细的处理
  if (fromPage || toPage) {
    const start = (fromPage || 1) - 1;
    const end = toPage || totalPages;
    
    // pdf-parse 不支持页面范围，需要用 pdf-lib 配合
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    
    // 创建新文档，只包含指定页面
    const newDoc = await PDFDocument.create();
    const indices = [];
    for (let i = start; i < end && i < pages.length; i++) {
      indices.push(i);
    }
    const copiedPages = await newDoc.copyPages(pdfDoc, indices);
    copiedPages.forEach(page => newDoc.addPage(page));
    
    const newBytes = await newDoc.save();
    const newData = await pdfParseLib(newBytes);
    text = newData.text;
  }
  
  return {
    success: true,
    text,
    pageCount: data.numpages,
    info: data.info
  };
}

/**
 * 提取表格（简化版本，Node.js 无成熟方案）
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {number} params.page - 页码（1-based，可选）
 * @returns {Promise<Object>} 提取结果
 */
async function extractTables(params) {
  // Node.js 没有成熟的 PDF 表格提取库
  // 建议使用 VL 模型（如 GPT-4V）进行表格识别
  return {
    success: false,
    error: 'Table extraction is not fully supported in Node.js. Consider using VL models (GPT-4V, Claude Vision) for table recognition.',
    alternative: 'Use convert_to_images to convert PDF to images, then send to VL model for table extraction.'
  };
}

// ==================== 编辑操作 ====================

/**
 * 合并多个 PDF
 * @param {Object} params - 参数
 * @param {string[]} params.paths - PDF 文件路径数组
 * @param {string} params.output - 输出文件路径
 * @returns {Promise<Object>} 合并结果
 */
async function mergePdfs(params) {
  const { paths, output } = params;
  
  if (!paths || paths.length < 2) {
    throw new Error('At least 2 PDF files are required for merging');
  }
  
  const mergedDoc = await PDFDocument.create();
  
  for (const filePath of paths) {
    const pdfBytes = await readPdfFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = await mergedDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
    pages.forEach(page => mergedDoc.addPage(page));
  }
  
  const mergedBytes = await mergedDoc.save();
  await savePdfFile(output, mergedBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    pageCount: mergedDoc.getPageCount()
  };
}

/**
 * 拆分 PDF
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {string} params.outputDir - 输出目录
 * @param {number} params.pagesPerFile - 每个文件的页数
 * @param {string} params.prefix - 文件名前缀
 * @returns {Promise<Object>} 拆分结果
 */
async function splitPdf(params) {
  const { path: filePath, outputDir, pagesPerFile = 1, prefix = 'page' } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();
  
  const resolvedOutputDir = resolvePath(outputDir);
  await fs.mkdir(resolvedOutputDir, { recursive: true });
  
  const outputFiles = [];
  
  for (let i = 0; i < totalPages; i += pagesPerFile) {
    const newDoc = await PDFDocument.create();
    const endPage = Math.min(i + pagesPerFile, totalPages);
    const indices = [];
    for (let j = i; j < endPage; j++) {
      indices.push(j);
    }
    const pages = await newDoc.copyPages(pdfDoc, indices);
    pages.forEach(page => newDoc.addPage(page));
    
    const newBytes = await newDoc.save();
    const outputPath = path.join(resolvedOutputDir, `${prefix}_${i + 1}-${endPage}.pdf`);
    await fs.writeFile(outputPath, newBytes);
    outputFiles.push(outputPath);
  }
  
  return {
    success: true,
    outputDir: resolvedOutputDir,
    files: outputFiles,
    totalPages,
    filesCreated: outputFiles.length
  };
}

/**
 * 旋转页面
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {string} params.output - 输出文件路径
 * @param {number[]} params.pages - 页码数组（1-based，空则全部）
 * @param {number} params.degrees - 旋转角度（90, 180, 270）
 * @returns {Promise<Object>} 旋转结果
 */
async function rotatePages(params) {
  const { path: filePath, output, pages = [], degrees = 90 } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const allPages = pdfDoc.getPages();
  
  const pagesToRotate = pages.length > 0 
    ? pages.map(p => p - 1)  // 转换为 0-based
    : allPages.map((_, i) => i);
  
  for (const pageIndex of pagesToRotate) {
    if (pageIndex >= 0 && pageIndex < allPages.length) {
      const page = allPages[pageIndex];
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees(currentRotation + degrees));
    }
  }
  
  const newBytes = await pdfDoc.save();
  await savePdfFile(output, newBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    rotatedPages: pagesToRotate.map(p => p + 1),
    degrees
  };
}

// ==================== 创建和转换 ====================

/**
 * 创建新 PDF
 * @param {Object} params - 参数
 * @param {string} params.output - 输出文件路径
 * @param {string} params.title - PDF 标题
 * @param {string[]} params.content - 内容数组（每项一页）
 * @param {string} params.pageSize - 页面大小（'a4' 或 'letter'）
 * @returns {Promise<Object>} 创建结果
 */
async function createPdf(params) {
  const { output, title, content = [], pageSize = 'a4' } = params;
  
  const pdfDoc = await PDFDocument.create();
  
  // 设置元数据
  if (title) {
    pdfDoc.setTitle(title);
  }
  
  // 页面尺寸
  const sizes = {
    a4: [595.28, 841.89],
    letter: [612, 792]
  };
  const [width, height] = sizes[pageSize] || sizes.a4;
  
  // 嵌入字体
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  // 添加内容
  for (const pageContent of content) {
    const page = pdfDoc.addPage([width, height]);
    
    // 设置边距
    const margin = 50;
    const maxWidth = width - margin * 2;
    
    // 绘制文本
    const fontSize = 12;
    const lineHeight = fontSize * 1.5;
    
    // 简单的文本换行
    const lines = wrapText(pageContent, maxWidth, font, fontSize);
    
    let y = height - margin;
    for (const line of lines) {
      if (y < margin) break;  // 超出页面底部
      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
      y -= lineHeight;
    }
  }
  
  const pdfBytes = await pdfDoc.save();
  await savePdfFile(output, pdfBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    pageCount: pdfDoc.getPageCount()
  };
}

/**
 * 文本换行辅助函数
 * @param {string} text - 文本
 * @param {number} maxWidth - 最大宽度
 * @param {PDFFont} font - 字体
 * @param {number} fontSize - 字体大小
 * @returns {string[]} 换行后的文本行
 */
function wrapText(text, maxWidth, font, fontSize) {
  const lines = [];
  const paragraphs = text.split('\n');
  
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    
    let currentLine = '';
    const words = paragraph.split(' ');
    
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
  }
  
  return lines;
}

/**
 * 转换 PDF 为图片（需要外部工具）
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {string} params.outputDir - 输出目录
 * @param {number} params.dpi - 分辨率
 * @param {string} params.format - 图片格式
 * @param {number} params.fromPage - 起始页
 * @param {number} params.toPage - 结束页
 * @returns {Promise<Object>} 转换结果
 */
async function convertToImages(params) {
  // Node.js 纯 JavaScript 无法直接将 PDF 转换为图片
  // 需要使用外部工具（如 poppler-utils 的 pdftoppm）或 canvas 库
  return {
    success: false,
    error: 'PDF to image conversion requires external tools.',
    alternatives: [
      'Use poppler-utils: pdftoppm -png input.pdf output',
      'Use pdf2pic (requires GraphicsMagick or ImageMagick)',
      'Use canvas + pdf.js for rendering'
    ]
  };
}

/**
 * PDF 转 Markdown（简化版本）
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {string} params.output - 输出文件路径
 * @param {number} params.fromPage - 起始页
 * @param {number} params.toPage - 结束页
 * @returns {Promise<Object>} 转换结果
 */
async function pdfToMarkdown(params) {
  const { path: filePath, output, fromPage, toPage } = params;
  
  // 提取文本
  const textResult = await extractText({ path: filePath, fromPage, toPage });
  
  // 简单的 Markdown 转换
  let markdown = textResult.text;
  
  // 尝试识别标题（大写字母开头的短行）
  const lines = markdown.split('\n');
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length < 50) {
      // 可能是标题
      if (/^[A-Z\u4e00-\u9fa5]/.test(trimmed)) {
        return `## ${trimmed}`;
      }
    }
    return line;
  });
  
  markdown = processedLines.join('\n');
  
  // 保存到文件
  if (output) {
    const resolvedPath = resolvePath(output);
    await fs.writeFile(resolvedPath, markdown, 'utf-8');
    return {
      success: true,
      path: resolvedPath,
      markdown
    };
  }
  
  return {
    success: true,
    markdown
  };
}

// ==================== 安全操作 ====================

/**
 * 加密 PDF
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {string} params.output - 输出文件路径
 * @param {string} params.userPassword - 用户密码
 * @param {string} params.ownerPassword - 所有者密码
 * @returns {Promise<Object>} 加密结果
 */
async function encryptPdf(params) {
  const { path: filePath, output, userPassword, ownerPassword } = params;
  
  if (!userPassword) {
    throw new Error('userPassword is required');
  }
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  // 加密文档
  pdfDoc.encrypt({
    userPassword,
    ownerPassword: ownerPassword || userPassword,
    permissions: {
      printing: 'lowResolution',
      modifying: false,
      copying: false,
      annotating: false,
      fillingForms: false,
      contentAccessibility: true,
      documentAssembly: false
    }
  });
  
  const encryptedBytes = await pdfDoc.save();
  await savePdfFile(output, encryptedBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    encrypted: true
  };
}

/**
 * 解密 PDF
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {string} params.output - 输出文件路径
 * @param {string} params.password - 密码
 * @returns {Promise<Object>} 解密结果
 */
async function decryptPdf(params) {
  const { path: filePath, output, password } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes, {
    password
  });
  
  // 保存解密后的文档
  const decryptedBytes = await pdfDoc.save();
  await savePdfFile(output, decryptedBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    decrypted: true
  };
}

/**
 * 添加水印
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {string} params.output - 输出文件路径
 * @param {string} params.watermark - 水印文本或 PDF 路径
 * @param {boolean} params.isText - 是否为文本水印
 * @returns {Promise<Object>} 添加结果
 */
async function addWatermark(params) {
  const { path: filePath, output, watermark, isText = true } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  
  if (isText) {
    // 文本水印
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    for (const page of pages) {
      const { width, height } = page.getSize();
      
      // 绘制对角线水印
      page.drawText(watermark, {
        x: width / 4,
        y: height / 2,
        size: 50,
        font,
        color: rgb(0.8, 0.8, 0.8),
        opacity: 0.3,
        rotate: degrees(45)
      });
    }
  } else {
    // PDF 水印
    const watermarkBytes = await readPdfFile(watermark);
    const watermarkDoc = await PDFDocument.load(watermarkBytes);
    const [watermarkPage] = await pdfDoc.copyPages(watermarkDoc, [0]);
    
    for (const page of pages) {
      // 将水印页面作为背景合并
      // 注意：pdf-lib 不直接支持页面合并，需要手动绘制
      const { width, height } = page.getSize();
      page.drawPage(watermarkPage, {
        x: 0,
        y: 0,
        width,
        height
      });
    }
  }
  
  const newBytes = await pdfDoc.save();
  await savePdfFile(output, newBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    watermarkAdded: true
  };
}

// ==================== 表单操作 ====================

/**
 * 检查可填写字段
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @returns {Promise<Object>} 检查结果
 */
async function checkFillableFields(params) {
  const { path: filePath } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  
  const fields = form.getFields();
  
  return {
    success: true,
    hasFillableFields: fields.length > 0,
    fieldCount: fields.length,
    fields: fields.map(field => ({
      name: field.getName(),
      type: field.constructor.name
    }))
  };
}

/**
 * 提取表单字段信息
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {string} params.output - 输出 JSON 文件路径
 * @returns {Promise<Object>} 提取结果
 */
async function extractFormFieldInfo(params) {
  const { path: filePath, output } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  
  const fields = form.getFields();
  
  const fieldInfo = fields.map(field => {
    const info = {
      name: field.getName(),
      type: field.constructor.name
    };
    
    // 获取当前值
    try {
      if (field.getText) {
        info.value = field.getText();
      } else if (field.isChecked) {
        info.value = field.isChecked();
      } else if (field.getSelected) {
        info.value = field.getSelected();
      }
    } catch (e) {
      info.value = null;
    }
    
    return info;
  });
  
  const result = {
    success: true,
    fieldCount: fields.length,
    fields: fieldInfo
  };
  
  if (output) {
    const resolvedPath = resolvePath(output);
    await fs.writeFile(resolvedPath, JSON.stringify(result, null, 2), 'utf-8');
    result.path = resolvedPath;
  }
  
  return result;
}

/**
 * 填写表单字段
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {Object} params.fieldValues - 字段值对象
 * @param {string} params.output - 输出文件路径
 * @returns {Promise<Object>} 填写结果
 */
async function fillFillableFields(params) {
  const { path: filePath, fieldValues, output } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  
  const filledFields = [];
  const errors = [];
  
  for (const [fieldName, value] of Object.entries(fieldValues)) {
    try {
      const field = form.getField(fieldName);
      
      if (field.setText) {
        field.setText(String(value));
      } else if (field.check && value === true) {
        field.check();
      } else if (field.uncheck && value === false) {
        field.uncheck();
      } else if (field.select) {
        field.select(Array.isArray(value) ? value : [value]);
      }
      
      filledFields.push(fieldName);
    } catch (e) {
      errors.push({ field: fieldName, error: e.message });
    }
  }
  
  // 如果需要，可以扁平化表单
  // form.flatten();
  
  const newBytes = await pdfDoc.save();
  await savePdfFile(output, newBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    filledFields,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * 提取图片
 * @param {Object} params - 参数
 * @param {string} params.path - PDF 文件路径
 * @param {string} params.outputDir - 输出目录
 * @returns {Promise<Object>} 提取结果
 */
async function extractImages(params) {
  // pdf-lib 不直接支持图片提取
  // 需要解析 PDF 内部结构或使用其他工具
  return {
    success: false,
    error: 'Image extraction is not directly supported by pdf-lib.',
    alternatives: [
      'Use pdfimages from poppler-utils: pdfimages -j input.pdf output',
      'Use pdf.js for image extraction',
      'Use Python pypdf or pdfplumber for image extraction'
    ]
  };
}

// ==================== 技能入口 ====================

/**
 * 技能入口函数
 * @param {string} action - 操作类型
 * @param {Object} params - 参数
 * @returns {Promise<Object>} 执行结果
 */
module.exports = async function pdfSkill(action, params = {}) {
  switch (action) {
    // 基础操作
    case 'read_pdf':
    case 'read':
      return await readPdf(params);
      
    case 'extract_text':
      return await extractText(params);
      
    case 'extract_tables':
      return await extractTables(params);
      
    // 编辑操作
    case 'merge_pdfs':
    case 'merge':
      return await mergePdfs(params);
      
    case 'split_pdf':
    case 'split':
      return await splitPdf(params);
      
    case 'rotate_pages':
    case 'rotate':
      return await rotatePages(params);
      
    // 创建和转换
    case 'create_pdf':
    case 'create':
      return await createPdf(params);
      
    case 'convert_to_images':
      return await convertToImages(params);
      
    case 'pdf_to_markdown':
      return await pdfToMarkdown(params);
      
    // 安全操作
    case 'encrypt_pdf':
    case 'encrypt':
      return await encryptPdf(params);
      
    case 'decrypt_pdf':
    case 'decrypt':
      return await decryptPdf(params);
      
    case 'add_watermark':
    case 'watermark':
      return await addWatermark(params);
      
    // 表单操作
    case 'check_fillable_fields':
      return await checkFillableFields(params);
      
    case 'extract_form_field_info':
      return await extractFormFieldInfo(params);
      
    case 'fill_fillable_fields':
      return await fillFillableFields(params);
      
    // 其他操作
    case 'extract_images':
      return await extractImages(params);
      
    default:
      throw new Error(`Unknown action: ${action}. Supported actions: read_pdf, extract_text, extract_tables, merge_pdfs, split_pdf, rotate_pages, create_pdf, convert_to_images, pdf_to_markdown, encrypt_pdf, decrypt_pdf, add_watermark, check_fillable_fields, extract_form_field_info, fill_fillable_fields, extract_images`);
  }
};

// 导出所有函数
module.exports.readPdf = readPdf;
module.exports.extractText = extractText;
module.exports.extractTables = extractTables;
module.exports.mergePdfs = mergePdfs;
module.exports.splitPdf = splitPdf;
module.exports.rotatePages = rotatePages;
module.exports.createPdf = createPdf;
module.exports.convertToImages = convertToImages;
module.exports.pdfToMarkdown = pdfToMarkdown;
module.exports.encryptPdf = encryptPdf;
module.exports.decryptPdf = decryptPdf;
module.exports.addWatermark = addWatermark;
module.exports.checkFillableFields = checkFillableFields;
module.exports.extractFormFieldInfo = extractFormFieldInfo;
module.exports.fillFillableFields = fillFillableFields;
module.exports.extractImages = extractImages;
module.exports.resolvePath = resolvePath;