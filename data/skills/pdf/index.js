/**
 * PDF Skill - PDF 处理技能 (Node.js 版本)
 * 
 * 功能：
 * - 读取 PDF 元数据和基本信息
 * - 提取文本内容
 * - 提取图片
 * - 提取表格
 * - 渲染页面为图片
 * - 合并多个 PDF
 * - 拆分 PDF
 * - 旋转页面
 * - 创建新 PDF
 * - 加密/解密 PDF
 * - 添加水印
 * - 表单操作（读取、填写）
 * 
 * 依赖：
 * - pdf-lib: PDF 操作核心库
 * - pdf-parse v2.4+: 文本提取、图片提取、表格提取、页面渲染
 */

const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// pdf-parse v2 延迟加载
let PDFParse = null;
let VerbosityLevel = null;

function getPdfParse() {
  if (!PDFParse) {
    const pdfParseModule = require('pdf-parse');
    PDFParse = pdfParseModule.PDFParse;
    VerbosityLevel = pdfParseModule.VerbosityLevel;
  }
  return { PDFParse, VerbosityLevel };
}

// 用户角色检查
const IS_ADMIN = process.env.IS_ADMIN === 'true';
const IS_SKILL_CREATOR = process.env.IS_SKILL_CREATOR === 'true';

// 允许的基础路径
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const USER_ID = process.env.USER_ID || 'default';
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? path.join(DATA_BASE_PATH, process.env.WORKING_DIRECTORY)
  : path.join(DATA_BASE_PATH, 'work', USER_ID);

// 根据用户角色设置允许的路径
let ALLOWED_BASE_PATHS;
if (IS_ADMIN) {
  // 管理员：可以访问整个 data/ 目录
  ALLOWED_BASE_PATHS = [DATA_BASE_PATH];
} else if (IS_SKILL_CREATOR) {
  // 技能创建者：可以访问 skills/ 和自己的工作目录
  ALLOWED_BASE_PATHS = [
    path.join(DATA_BASE_PATH, 'skills'),
    path.join(DATA_BASE_PATH, 'work', USER_ID)
  ];
} else {
  // 普通用户：只能访问自己的工作目录
  ALLOWED_BASE_PATHS = [USER_WORK_DIR];
}

/**
 * 检查路径是否被允许
 */
function isPathAllowed(targetPath) {
  let resolved = path.resolve(targetPath);
  
  try {
    if (fs.existsSync(resolved)) {
      resolved = fs.realpathSync(resolved);
    }
  } catch (e) {}
  
  return ALLOWED_BASE_PATHS.some(basePath => {
    let resolvedBase = path.resolve(basePath);
    try {
      if (fs.existsSync(resolvedBase)) {
        resolvedBase = fs.realpathSync(resolvedBase);
      }
    } catch (e) {}
    return resolved.startsWith(resolvedBase);
  });
}

/**
 * 解析路径（支持相对路径）
 */
function resolvePath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    if (!isPathAllowed(relativePath)) {
      throw new Error(`Path not allowed: ${relativePath}`);
    }
    return relativePath;
  }
  
  for (const basePath of ALLOWED_BASE_PATHS) {
    const resolved = path.join(basePath, relativePath);
    if (fs.existsSync(resolved) || isPathAllowed(resolved)) {
      if (!isPathAllowed(resolved)) {
        throw new Error(`Path not allowed: ${resolved}`);
      }
      return resolved;
    }
  }
  
  const defaultPath = path.join(ALLOWED_BASE_PATHS[0], relativePath);
  if (!isPathAllowed(defaultPath)) {
    throw new Error(`Path not allowed: ${defaultPath}`);
  }
  return defaultPath;
}

/**
 * 读取 PDF 文件
 */
async function readPdfFile(filePath) {
  const resolvedPath = resolvePath(filePath);
  return fs.readFileSync(resolvedPath);
}

/**
 * 保存 PDF 文件
 */
function savePdfFile(filePath, pdfBytes) {
  const resolvedPath = resolvePath(filePath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolvedPath, pdfBytes);
}

// ==================== 基础操作 ====================

/**
 * 读取 PDF 元数据和基本信息
 * 使用 pdf-parse v2 的 getInfo() 方法获取更丰富的信息
 */
async function readPdf(params) {
  const { path: filePath, parsePageInfo = false, suppressWarnings = true } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  // 使用 pdf-lib 获取基础信息
  const basicMetadata = {
    title: pdfDoc.getTitle() || null,
    author: pdfDoc.getAuthor() || null,
    subject: pdfDoc.getSubject() || null,
    creator: pdfDoc.getCreator() || null,
    producer: pdfDoc.getProducer() || null,
    creationDate: pdfDoc.getCreationDate()?.toISOString() || null,
    modificationDate: pdfDoc.getModificationDate()?.toISOString() || null,
    keywords: pdfDoc.getKeywords() || null
  };
  
  const pages = pdfDoc.getPages();
  const pageCount = pages.length;
  const isEncrypted = pdfDoc.isEncrypted;
  
  // 使用 pdf-parse v2 获取更丰富的信息
  let extendedInfo = null;
  let parser;
  
  try {
    const { PDFParse, VerbosityLevel } = getPdfParse();
    const loadParams = {
      data: pdfBytes,
      verbosity: suppressWarnings ? VerbosityLevel.ERRORS : VerbosityLevel.WARNINGS
    };
    
    parser = new PDFParse(loadParams);
    const infoResult = await parser.getInfo({ parsePageInfo });
    
    extendedInfo = {
      total: infoResult.total,
      infoData: infoResult.infoData,
      dates: infoResult.getDateNode ? infoResult.getDateNode() : null,
      pages: parsePageInfo ? infoResult.pages : undefined
    };
  } catch (e) {
    // 如果 pdf-parse 失败，仍然返回基础信息
    console.error('pdf-parse getInfo failed:', e.message);
  } finally {
    // 确保释放内存
    if (parser) {
      await parser.destroy();
    }
  }
  
  return {
    success: true,
    pageCount,
    metadata: extendedInfo?.infoData || basicMetadata,
    basicMetadata,
    extendedInfo,
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
 * 使用 pdf-parse v2 API，支持 verbosity 参数抑制警告输出
 */
async function extractText(params) {
  const { path: filePath, fromPage, toPage, suppressWarnings = true } = params;
  
  const { PDFParse, VerbosityLevel } = getPdfParse();
  const pdfBytes = await readPdfFile(filePath);
  
  // 创建解析器实例，设置 verbosity 抑制警告
  const loadParams = {
    data: pdfBytes,
    // 设置 verbosity 为 ERRORS 只显示错误，抑制 WARNING 输出
    verbosity: suppressWarnings ? VerbosityLevel.ERRORS : VerbosityLevel.WARNINGS
  };
  
  const parser = new PDFParse(loadParams);
  
  try {
    // 处理分页提取
    if (fromPage || toPage) {
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const totalPages = pdfDoc.getPageCount();
      const start = (fromPage || 1);
      const end = toPage || totalPages;
      
      // 构建 partial 数组（页码从 1 开始）
      const partial = [];
      for (let i = start; i <= end && i <= totalPages; i++) {
        partial.push(i);
      }
      
      const result = await parser.getText({ partial });
      return {
        success: true,
        text: result.text,
        pageCount: totalPages,
        extractedPages: partial,
        info: result.info
      };
    }
    
    // 提取全部文本
    const result = await parser.getText();
    
    return {
      success: true,
      text: result.text,
      pageCount: result.total || result.numpages,
      info: result.info
    };
  } finally {
    // 始终释放内存
    await parser.destroy();
  }
}

/**
 * 提取表格
 * 使用 pdf-parse v2 的 getTable() 方法
 */
async function extractTables(params) {
  const { path: filePath, fromPage, toPage, suppressWarnings = true } = params;
  
  const { PDFParse, VerbosityLevel } = getPdfParse();
  const pdfBytes = await readPdfFile(filePath);
  
  const loadParams = {
    data: pdfBytes,
    verbosity: suppressWarnings ? VerbosityLevel.ERRORS : VerbosityLevel.WARNINGS
  };
  
  const parser = new PDFParse(loadParams);
  
  try {
    // 构建分页参数
    const parseParams = {};
    if (fromPage || toPage) {
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const totalPages = pdfDoc.getPageCount();
      const start = fromPage || 1;
      const end = toPage || totalPages;
      
      const partial = [];
      for (let i = start; i <= end && i <= totalPages; i++) {
        partial.push(i);
      }
      parseParams.partial = partial;
    }
    
    const result = await parser.getTable(parseParams);
    
    // 格式化表格数据
    const tables = result.pages.map((page, pageIndex) => ({
      pageNumber: pageIndex + 1,
      tables: page.tables || []
    }));
    
    return {
      success: true,
      tables,
      totalTables: tables.reduce((sum, p) => sum + p.tables.length, 0)
    };
  } finally {
    await parser.destroy();
  }
}

// ==================== 编辑操作 ====================

/**
 * 合并多个 PDF
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
  savePdfFile(output, mergedBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    pageCount: mergedDoc.getPageCount()
  };
}

/**
 * 拆分 PDF
 */
async function splitPdf(params) {
  const { path: filePath, outputDir, pagesPerFile = 1, prefix = 'page' } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const totalPages = pdfDoc.getPageCount();
  
  const resolvedOutputDir = resolvePath(outputDir);
  if (!fs.existsSync(resolvedOutputDir)) {
    fs.mkdirSync(resolvedOutputDir, { recursive: true });
  }
  
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
    fs.writeFileSync(outputPath, newBytes);
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
 */
async function rotatePages(params) {
  const { path: filePath, output, pages = [], degrees = 90 } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const allPages = pdfDoc.getPages();
  
  const pagesToRotate = pages.length > 0
    ? pages.map(p => p - 1)
    : allPages.map((_, i) => i);
  
  for (const pageIndex of pagesToRotate) {
    if (pageIndex >= 0 && pageIndex < allPages.length) {
      const page = allPages[pageIndex];
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees(currentRotation + degrees));
    }
  }
  
  const newBytes = await pdfDoc.save();
  savePdfFile(output, newBytes);
  
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
 */
async function createPdf(params) {
  const { output, title, content = [], pageSize = 'a4' } = params;
  
  const pdfDoc = await PDFDocument.create();
  
  if (title) {
    pdfDoc.setTitle(title);
  }
  
  const sizes = {
    a4: [595.28, 841.89],
    letter: [612, 792]
  };
  const [width, height] = sizes[pageSize] || sizes.a4;
  
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  for (const pageContent of content) {
    const page = pdfDoc.addPage([width, height]);
    const margin = 50;
    const maxWidth = width - margin * 2;
    const fontSize = 12;
    const lineHeight = fontSize * 1.5;
    
    const lines = wrapText(pageContent, maxWidth, font, fontSize);
    
    let y = height - margin;
    for (const line of lines) {
      if (y < margin) break;
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
  savePdfFile(output, pdfBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    pageCount: pdfDoc.getPageCount()
  };
}

/**
 * 文本换行辅助函数
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
 * 转换 PDF 为图片
 * 使用 pdf-parse v2 的 getScreenshot() 方法
 */
async function convertToImages(params) {
  const { 
    path: filePath, 
    outputDir, 
    fromPage, 
    toPage, 
    scale = 1.5, 
    desiredWidth,
    prefix = 'page',
    suppressWarnings = true 
  } = params;
  
  const { PDFParse, VerbosityLevel } = getPdfParse();
  const pdfBytes = await readPdfFile(filePath);
  
  const loadParams = {
    data: pdfBytes,
    verbosity: suppressWarnings ? VerbosityLevel.ERRORS : VerbosityLevel.WARNINGS
  };
  
  const parser = new PDFParse(loadParams);
  
  try {
    // 构建分页参数
    const parseParams = { scale };
    if (desiredWidth) {
      parseParams.desiredWidth = desiredWidth;
    }
    
    if (fromPage || toPage) {
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const totalPages = pdfDoc.getPageCount();
      const start = fromPage || 1;
      const end = toPage || totalPages;
      
      const partial = [];
      for (let i = start; i <= end && i <= totalPages; i++) {
        partial.push(i);
      }
      parseParams.partial = partial;
    }
    
    const result = await parser.getScreenshot(parseParams);
    
    // 保存图片
    const resolvedOutputDir = outputDir ? resolvePath(outputDir) : null;
    const savedFiles = [];
    
    if (resolvedOutputDir) {
      if (!fs.existsSync(resolvedOutputDir)) {
        fs.mkdirSync(resolvedOutputDir, { recursive: true });
      }
      
      for (let i = 0; i < result.pages.length; i++) {
        const page = result.pages[i];
        const outputPath = path.join(resolvedOutputDir, `${prefix}_${i + 1}.png`);
        fs.writeFileSync(outputPath, page.data);
        savedFiles.push(outputPath);
      }
    }
    
    return {
      success: true,
      pages: result.pages.map((page, index) => ({
        pageNumber: index + 1,
        width: page.width,
        height: page.height,
        dataUrl: page.dataUrl,
        savedPath: savedFiles[index] || null
      })),
      savedFiles: savedFiles.length > 0 ? savedFiles : undefined,
      outputDir: resolvedOutputDir
    };
  } finally {
    await parser.destroy();
  }
}

/**
 * PDF 转 Markdown
 */
async function pdfToMarkdown(params) {
  const { path: filePath, output, fromPage, toPage } = params;
  
  const textResult = await extractText({ path: filePath, fromPage, toPage });
  
  let markdown = textResult.text;
  
  const lines = markdown.split('\n');
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length < 50) {
      if (/^[A-Z\u4e00-\u9fa5]/.test(trimmed)) {
        return `## ${trimmed}`;
      }
    }
    return line;
  });
  
  markdown = processedLines.join('\n');
  
  if (output) {
    const resolvedPath = resolvePath(output);
    fs.writeFileSync(resolvedPath, markdown, 'utf-8');
    return { success: true, path: resolvedPath, markdown };
  }
  
  return { success: true, markdown };
}

// ==================== 安全操作 ====================

/**
 * 加密 PDF
 */
async function encryptPdf(params) {
  const { path: filePath, output, userPassword, ownerPassword } = params;
  
  if (!userPassword) {
    throw new Error('userPassword is required');
  }
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
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
  savePdfFile(output, encryptedBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    encrypted: true
  };
}

/**
 * 解密 PDF
 */
async function decryptPdf(params) {
  const { path: filePath, output, password } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { password });
  
  const decryptedBytes = await pdfDoc.save();
  savePdfFile(output, decryptedBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    decrypted: true
  };
}

/**
 * 添加水印
 */
async function addWatermark(params) {
  const { path: filePath, output, watermark, isText = true } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  
  if (isText) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    for (const page of pages) {
      const { width, height } = page.getSize();
      
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
    const watermarkBytes = await readPdfFile(watermark);
    const watermarkDoc = await PDFDocument.load(watermarkBytes);
    const [watermarkPage] = await pdfDoc.copyPages(watermarkDoc, [0]);
    
    for (const page of pages) {
      const { width, height } = page.getSize();
      page.drawPage(watermarkPage, { x: 0, y: 0, width, height });
    }
  }
  
  const newBytes = await pdfDoc.save();
  savePdfFile(output, newBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    watermarkAdded: true
  };
}

// ==================== 表单操作 ====================

/**
 * 检查可填写字段
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
    fs.writeFileSync(resolvedPath, JSON.stringify(result, null, 2), 'utf-8');
    result.path = resolvedPath;
  }
  
  return result;
}

/**
 * 填写表单字段
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
  
  const newBytes = await pdfDoc.save();
  savePdfFile(output, newBytes);
  
  return {
    success: true,
    path: resolvePath(output),
    filledFields,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * 提取图片
 * 使用 pdf-parse v2 的 getImage() 方法
 */
async function extractImages(params) {
  const { path: filePath, fromPage, toPage, imageThreshold = 80, suppressWarnings = true } = params;
  
  const { PDFParse, VerbosityLevel } = getPdfParse();
  const pdfBytes = await readPdfFile(filePath);
  
  const loadParams = {
    data: pdfBytes,
    verbosity: suppressWarnings ? VerbosityLevel.ERRORS : VerbosityLevel.WARNINGS
  };
  
  const parser = new PDFParse(loadParams);
  
  try {
    // 构建分页参数
    const parseParams = { imageThreshold };
    if (fromPage || toPage) {
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const totalPages = pdfDoc.getPageCount();
      const start = fromPage || 1;
      const end = toPage || totalPages;
      
      const partial = [];
      for (let i = start; i <= end && i <= totalPages; i++) {
        partial.push(i);
      }
      parseParams.partial = partial;
    }
    
    const result = await parser.getImage(parseParams);
    
    // 格式化图片数据
    const images = result.pages.map((page, pageIndex) => ({
      pageNumber: pageIndex + 1,
      images: (page.images || []).map((img, imgIndex) => ({
        index: imgIndex + 1,
        width: img.width,
        height: img.height,
        // 图片数据为 Buffer
        data: img.data,
        dataUrl: img.dataUrl
      }))
    }));
    
    return {
      success: true,
      images,
      totalImages: images.reduce((sum, p) => sum + p.images.length, 0)
    };
  } finally {
    await parser.destroy();
  }
}

// ==================== 技能入口 ====================

/**
 * Skill execute function - called by skill-runner
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {object} params - Tool parameters
 * @param {object} context - Execution context
 * @returns {Promise<object>} Execution result
 */
async function execute(toolName, params, context = {}) {
  switch (toolName) {
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
      throw new Error(`Unknown tool: ${toolName}. Supported tools: read_pdf, extract_text, extract_tables, merge_pdfs, split_pdf, rotate_pages, create_pdf, convert_to_images, pdf_to_markdown, encrypt_pdf, decrypt_pdf, add_watermark, check_fillable_fields, extract_form_field_info, fill_fillable_fields, extract_images`);
  }
}

module.exports = { execute };