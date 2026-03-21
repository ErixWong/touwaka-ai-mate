/**
 * PPTX Skill - PowerPoint 演示文稿处理技能 (Node.js 版本)
 * 
 * 功能：
 * - 读取演示文稿信息和结构
 * - 创建新演示文稿
 * - 添加/删除/编辑幻灯片
 * - 文本和形状操作
 * - 图片插入
 * - 表格操作
 * - 幻灯片布局
 * - 导出为图片
 * 
 * 依赖：
 * - pptxgenjs: 演示文稿创建
 * - adm-zip: ZIP 操作（项目已安装）
 * - sharp: 图片处理（项目已安装）
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// 延迟加载可选依赖
let pptxgenjs = null;
let sharp = null;

function getPptxGenJS() {
  if (!pptxgenjs) {
    pptxgenjs = require('pptxgenjs');
  }
  return pptxgenjs;
}

function getSharp() {
  if (!sharp) {
    sharp = require('sharp');
  }
  return sharp;
}

// 用户角色检查
const IS_ADMIN = process.env.IS_ADMIN === 'true';

// 允许的基础路径
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const USER_ID = process.env.USER_ID || 'default';
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? path.join(DATA_BASE_PATH, process.env.WORKING_DIRECTORY)
  : path.join(DATA_BASE_PATH, 'work', USER_ID);

const PROJECT_ROOT = process.cwd();
const ALLOWED_BASE_PATHS = IS_ADMIN
  ? [PROJECT_ROOT, DATA_BASE_PATH]
  : [USER_WORK_DIR];

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
 * 读取文件
 */
function readFile(filePath) {
  const resolvedPath = resolvePath(filePath);
  return fs.readFileSync(resolvedPath);
}

/**
 * 保存文件
 */
function saveFile(filePath, data) {
  const resolvedPath = resolvePath(filePath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolvedPath, data);
}

// ==================== 基础操作 ====================

/**
 * 读取演示文稿信息
 */
async function readPresentation(params) {
  const { path: filePath } = params;
  
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  
  let slideCount = 0;
  const slides = [];
  
  for (const entry of entries) {
    if (entry.entryName.match(/ppt\/slides\/slide\d+\.xml/)) {
      slideCount++;
      const slideXml = zip.readAsText(entry.entryName);
      
      const textMatches = slideXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      const texts = textMatches.map(m => m.replace(/<a:t>|<\/a:t>/g, ''));
      
      slides.push({
        number: slideCount,
        textCount: texts.length,
        preview: texts.slice(0, 5).join(' ').substring(0, 100)
      });
    }
  }
  
  const appXml = zip.readAsText('docProps/app.xml');
  const coreXml = zip.readAsText('docProps/core.xml');
  
  const metadata = {};
  
  if (coreXml) {
    const titleMatch = coreXml.match(/<dc:title>([^<]*)<\/dc:title>/);
    const authorMatch = coreXml.match(/<dc:creator>([^<]*)<\/dc:creator>/);
    const createdMatch = coreXml.match(/<dcterms:created>([^<]*)<\/dcterms:created>/);
    const modifiedMatch = coreXml.match(/<dcterms:modified>([^<]*)<\/dcterms:modified>/);
    
    metadata.title = titleMatch ? titleMatch[1] : null;
    metadata.author = authorMatch ? authorMatch[1] : null;
    metadata.created = createdMatch ? createdMatch[1] : null;
    metadata.modified = modifiedMatch ? modifiedMatch[1] : null;
  }
  
  return {
    success: true,
    slideCount,
    slides,
    metadata
  };
}

/**
 * 提取文本内容
 */
async function extractText(params) {
  const { path: filePath, slideNumbers } = params;
  
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  
  const allTexts = [];
  
  for (const entry of entries) {
    const match = entry.entryName.match(/ppt\/slides\/slide(\d+)\.xml/);
    if (match) {
      const slideNum = parseInt(match[1]);
      
      if (slideNumbers && !slideNumbers.includes(slideNum)) {
        continue;
      }
      
      const slideXml = zip.readAsText(entry.entryName);
      const textMatches = slideXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      const texts = textMatches.map(m => m.replace(/<a:t>|<\/a:t>/g, ''));
      
      allTexts.push({
        slide: slideNum,
        texts
      });
    }
  }
  
  return {
    success: true,
    slides: allTexts,
    totalTexts: allTexts.reduce((sum, s) => sum + s.texts.length, 0)
  };
}

/**
 * 提取幻灯片结构
 */
async function extractStructure(params) {
  const { path: filePath } = params;
  
  const zip = new AdmZip(filePath);
  
  let slideLayouts = [];
  const layoutEntries = zip.getEntries().filter(e => 
    e.entryName.match(/ppt\/slideLayouts\/slideLayout\d+\.xml/)
  );
  
  for (const entry of layoutEntries) {
    const layoutXml = zip.readAsText(entry.entryName);
    const nameMatch = layoutXml.match(/p:spDef[^>]*<a:pPr[^>]*\/>/);
    slideLayouts.push({
      name: path.basename(entry.entryName, '.xml')
    });
  }
  
  const slideEntries = zip.getEntries().filter(e => 
    e.entryName.match(/ppt\/slides\/slide\d+\.xml/)
  );
  
  const slides = [];
  for (const entry of slideEntries) {
    const match = entry.entryName.match(/slide(\d+)\.xml/);
    const slideNum = match ? parseInt(match[1]) : 0;
    
    const slideXml = zip.readAsText(entry.entryName);
    
    const shapes = [];
    const shapeMatches = slideXml.match(/<p:sp[^>]*>[\s\S]*?<\/p:sp>/g) || [];
    
    for (const shapeXml of shapeMatches) {
      const textMatches = shapeXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      const texts = textMatches.map(m => m.replace(/<a:t>|<\/a:t>/g, ''));
      
      if (texts.length > 0) {
        shapes.push({
          type: 'text',
          text: texts.join(' ')
        });
      }
    }
    
    const picMatches = slideXml.match(/<p:pic[^>]*>[\s\S]*?<\/p:pic>/g) || [];
    for (const picXml of picMatches) {
      const embedMatch = picXml.match(/r:embed="([^"]+)"/);
      if (embedMatch) {
        shapes.push({
          type: 'image',
          embedId: embedMatch[1]
        });
      }
    }
    
    slides.push({
      number: slideNum,
      shapeCount: shapes.length,
      shapes
    });
  }
  
  return {
    success: true,
    slideCount: slides.length,
    layoutCount: slideLayouts.length,
    slides
  };
}

// ==================== 创建操作 ====================

/**
 * 创建新演示文稿
 */
async function createPresentation(params) {
  const {
    output,
    title = '',
    slides = [],
    properties = {}
  } = params;
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || title;
  pptx.subject = properties.subject || '';
  pptx.company = properties.company || '';
  
  for (const slideData of slides) {
    const slide = pptx.addSlide();
    
    if (slideData.layout) {
      // Apply layout if specified
    }
    
    if (slideData.background) {
      slide.background = slideData.background;
    }
    
    if (slideData.title) {
      slide.addText(slideData.title, {
        x: 0.5,
        y: 0.5,
        w: '90%',
        h: 1,
        fontSize: 36,
        bold: true,
        color: '363636'
      });
    }
    
    if (slideData.content) {
      slide.addText(slideData.content, {
        x: 0.5,
        y: 1.5,
        w: '90%',
        h: 4,
        fontSize: 18,
        color: '666666'
      });
    }
    
    if (slideData.texts && Array.isArray(slideData.texts)) {
      let yPos = slideData.title ? 1.5 : 0.5;
      for (const textItem of slideData.texts) {
        if (typeof textItem === 'string') {
          slide.addText(textItem, {
            x: 0.5,
            y: yPos,
            w: '90%',
            fontSize: 18
          });
          yPos += 0.8;
        } else {
          slide.addText(textItem.text || '', {
            x: textItem.x || 0.5,
            y: textItem.y || yPos,
            w: textItem.w || '90%',
            h: textItem.h || 0.5,
            fontSize: textItem.fontSize || 18,
            bold: textItem.bold,
            italic: textItem.italic,
            color: textItem.color,
            align: textItem.align
          });
        }
      }
    }
    
    if (slideData.images && Array.isArray(slideData.images)) {
      for (const img of slideData.images) {
        try {
          const imgPath = resolvePath(img.path);
          slide.addImage({
            path: imgPath,
            x: img.x || 0.5,
            y: img.y || 1,
            w: img.w || 4,
            h: img.h || 3
          });
        } catch (e) {
          // Skip invalid image paths
        }
      }
    }
    
    if (slideData.tables && Array.isArray(slideData.tables)) {
      for (const tableData of slideData.tables) {
        slide.addTable(tableData.rows || [], {
          x: tableData.x || 0.5,
          y: tableData.y || 1,
          w: tableData.w || 9,
          colW: tableData.colW,
          border: tableData.border || { pt: 1, color: 'CFCFCF' },
          fontFace: tableData.fontFace || 'Arial',
          fontSize: tableData.fontSize || 12
        });
      }
    }
    
    if (slideData.shapes && Array.isArray(slideData.shapes)) {
      for (const shape of slideData.shapes) {
        slide.addShape(shape.type || 'rect', {
          x: shape.x || 0,
          y: shape.y || 0,
          w: shape.w || 1,
          h: shape.h || 1,
          fill: shape.fill || { color: 'CCCCCC' },
          line: shape.line
        });
      }
    }
  }
  
  if (slides.length === 0) {
    const slide = pptx.addSlide();
    if (title) {
      slide.addText(title, {
        x: 0.5,
        y: 2.5,
        w: '90%',
        h: 1,
        fontSize: 44,
        bold: true,
        align: 'center'
      });
    }
  }
  
  await pptx.writeFile({ fileName: resolvePath(output) });
  
  return {
    success: true,
    path: resolvePath(output),
    slideCount: pptx.slides.length
  };
}

/**
 * 从 Markdown 创建演示文稿
 */
async function fromMarkdown(params) {
  const { markdown, output, properties = {} } = params;
  
  if (!markdown) {
    throw new Error('markdown content is required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || '';
  
  const lines = markdown.split('\n');
  let currentSlide = null;
  let slideContent = [];
  
  for (const line of lines) {
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      if (currentSlide) {
        pptx.addSlide();
        const slide = pptx.slides[pptx.slides.length - 1];
        
        if (currentSlide.title) {
          slide.addText(currentSlide.title, {
            x: 0.5,
            y: 0.5,
            w: '90%',
            h: 1,
            fontSize: 36,
            bold: true
          });
        }
        
        if (slideContent.length > 0) {
          slide.addText(slideContent.map(t => ({ text: t, options: { bullet: true } })), {
            x: 0.5,
            y: 1.5,
            w: '90%',
            h: 4
          });
        }
      }
      
      currentSlide = { title: line.substring(2) };
      slideContent = [];
    } else if (line.startsWith('## ')) {
      if (currentSlide) {
        slideContent.push(line.substring(3));
      }
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      slideContent.push(line.substring(2));
    } else if (line.trim() && currentSlide) {
      slideContent.push(line);
    }
  }
  
  if (currentSlide) {
    pptx.addSlide();
    const slide = pptx.slides[pptx.slides.length - 1];
    
    if (currentSlide.title) {
      slide.addText(currentSlide.title, {
        x: 0.5,
        y: 0.5,
        w: '90%',
        h: 1,
        fontSize: 36,
        bold: true
      });
    }
    
    if (slideContent.length > 0) {
      slide.addText(slideContent.map(t => ({ text: t, options: { bullet: true } })), {
        x: 0.5,
        y: 1.5,
        w: '90%',
        h: 4
      });
    }
  }
  
  if (pptx.slides.length === 0) {
    pptx.addSlide();
  }
  
  await pptx.writeFile({ fileName: resolvePath(output) });
  
  return {
    success: true,
    path: resolvePath(output),
    slideCount: pptx.slides.length
  };
}

// ==================== 幻灯片操作 ====================

/**
 * 添加幻灯片
 */
async function addSlide(params) {
  const { path: filePath, output, title, content, layout, position } = params;
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  const buffer = readFile(filePath);
  const tempPath = resolvePath(filePath);
  
  await pptx.loadFile(tempPath);
  
  const slide = pptx.addSlide();
  
  if (title) {
    slide.addText(title, {
      x: 0.5,
      y: 0.5,
      w: '90%',
      h: 1,
      fontSize: 36,
      bold: true
    });
  }
  
  if (content) {
    if (Array.isArray(content)) {
      slide.addText(content.map(t => ({ text: t, options: { bullet: true } })), {
        x: 0.5,
        y: 1.5,
        w: '90%',
        h: 4
      });
    } else {
      slide.addText(content, {
        x: 0.5,
        y: 1.5,
        w: '90%',
        h: 4
      });
    }
  }
  
  const outputPath = output || filePath;
  await pptx.writeFile({ fileName: resolvePath(outputPath) });
  
  return {
    success: true,
    path: resolvePath(outputPath),
    slideAdded: true,
    totalSlides: pptx.slides.length
  };
}

/**
 * 删除幻灯片
 */
async function deleteSlide(params) {
  const { path: filePath, output, slideNumber } = params;
  
  if (!slideNumber || slideNumber < 1) {
    throw new Error('Valid slideNumber is required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  const tempPath = resolvePath(filePath);
  await pptx.loadFile(tempPath);
  
  if (slideNumber > pptx.slides.length) {
    throw new Error(`Slide ${slideNumber} does not exist. Total slides: ${pptx.slides.length}`);
  }
  
  pptx.deleteSlide(slideNumber);
  
  const outputPath = output || filePath;
  await pptx.writeFile({ fileName: resolvePath(outputPath) });
  
  return {
    success: true,
    path: resolvePath(outputPath),
    deletedSlide: slideNumber,
    remainingSlides: pptx.slides.length
  };
}

/**
 * 更新幻灯片
 */
async function updateSlide(params) {
  const { path: filePath, output, slideNumber, title, content } = params;
  
  if (!slideNumber || slideNumber < 1) {
    throw new Error('Valid slideNumber is required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  const tempPath = resolvePath(filePath);
  await pptx.loadFile(tempPath);
  
  if (slideNumber > pptx.slides.length) {
    throw new Error(`Slide ${slideNumber} does not exist. Total slides: ${pptx.slides.length}`);
  }
  
  const slide = pptx.getSlide(slideNumber);
  
  if (title) {
    slide.addText(title, {
      x: 0.5,
      y: 0.5,
      w: '90%',
      h: 1,
      fontSize: 36,
      bold: true
    });
  }
  
  if (content) {
    if (Array.isArray(content)) {
      slide.addText(content.map(t => ({ text: t, options: { bullet: true } })), {
        x: 0.5,
        y: 1.5,
        w: '90%',
        h: 4
      });
    } else {
      slide.addText(content, {
        x: 0.5,
        y: 1.5,
        w: '90%',
        h: 4
      });
    }
  }
  
  const outputPath = output || filePath;
  await pptx.writeFile({ fileName: resolvePath(outputPath) });
  
  return {
    success: true,
    path: resolvePath(outputPath),
    updatedSlide: slideNumber
  };
}

// ==================== 图片操作 ====================

/**
 * 提取图片
 */
async function extractImages(params) {
  const { path: filePath, outputDir } = params;
  
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  
  const images = [];
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.emf', '.wmf'];
  
  const resolvedOutputDir = outputDir ? resolvePath(outputDir) : null;
  if (resolvedOutputDir && !fs.existsSync(resolvedOutputDir)) {
    fs.mkdirSync(resolvedOutputDir, { recursive: true });
  }
  
  for (const entry of entries) {
    const entryName = entry.entryName;
    const ext = path.extname(entryName).toLowerCase();
    
    if (entryName.startsWith('ppt/media/') && imageExtensions.includes(ext)) {
      const fileName = path.basename(entryName);
      
      if (resolvedOutputDir) {
        const outputPath = path.join(resolvedOutputDir, fileName);
        fs.writeFileSync(outputPath, entry.getData());
      }
      
      images.push({
        originalPath: entryName,
        fileName
      });
    }
  }
  
  return {
    success: true,
    imageCount: images.length,
    images,
    outputDir: resolvedOutputDir
  };
}

/**
 * 添加图片到幻灯片
 */
async function addImage(params) {
  const { path: filePath, output, slideNumber, imagePath, x, y, width, height } = params;
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  const tempPath = resolvePath(filePath);
  await pptx.loadFile(tempPath);
  
  const slideNum = slideNumber || 1;
  
  if (slideNum > pptx.slides.length) {
    throw new Error(`Slide ${slideNum} does not exist`);
  }
  
  const slide = pptx.getSlide(slideNum);
  
  const imgPath = resolvePath(imagePath);
  
  slide.addImage({
    path: imgPath,
    x: x || 0.5,
    y: y || 1,
    w: width || 4,
    h: height || 3
  });
  
  const outputPath = output || filePath;
  await pptx.writeFile({ fileName: resolvePath(outputPath) });
  
  return {
    success: true,
    path: resolvePath(outputPath),
    imageAdded: true
  };
}

// ==================== 表格操作 ====================

/**
 * 添加表格到幻灯片
 */
async function addTable(params) {
  const { path: filePath, output, slideNumber, rows, x, y, width, colWidths, options = {} } = params;
  
  if (!rows || !Array.isArray(rows)) {
    throw new Error('rows array is required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  const tempPath = resolvePath(filePath);
  await pptx.loadFile(tempPath);
  
  const slideNum = slideNumber || 1;
  
  if (slideNum > pptx.slides.length) {
    throw new Error(`Slide ${slideNum} does not exist`);
  }
  
  const slide = pptx.getSlide(slideNum);
  
  slide.addTable(rows, {
    x: x || 0.5,
    y: y || 1,
    w: width || 9,
    colW: colWidths,
    border: options.border || { pt: 1, color: 'CFCFCF' },
    fontFace: options.fontFace || 'Arial',
    fontSize: options.fontSize || 12,
    align: options.align || 'left'
  });
  
  const outputPath = output || filePath;
  await pptx.writeFile({ fileName: resolvePath(outputPath) });
  
  return {
    success: true,
    path: resolvePath(outputPath),
    tableAdded: true
  };
}

// ==================== 导出操作 ====================

/**
 * 导出幻灯片为图片
 */
async function exportToImages(params) {
  const { path: filePath, outputDir, slideNumbers, format = 'png' } = params;
  
  return {
    success: false,
    error: 'Direct PPTX to image export is not supported in Node.js.',
    alternatives: [
      'Use LibreOffice: libreoffice --headless --convert-to pdf input.pptx',
      'Use pdf2pptx or similar tools',
      'Use Python python-pptx with comtypes (Windows only)',
      'Use cloud services like CloudConvert or Aspose'
    ]
  };
}

/**
 * 生成缩略图
 */
async function generateThumbnail(params) {
  const { path: filePath, output, slideNumber = 1, width = 200, height = 150 } = params;
  
  return {
    success: false,
    error: 'Direct thumbnail generation is not supported in Node.js.',
    alternatives: [
      'Use LibreOffice to convert to PDF first, then use pdf2pic',
      'Use cloud services for thumbnail generation'
    ]
  };
}

// ==================== 合并操作 ====================

/**
 * 合并多个演示文稿
 */
async function mergePresentations(params) {
  const { paths, output } = params;
  
  if (!paths || paths.length < 2) {
    throw new Error('At least 2 presentation files are required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const mergedPptx = new PptxGenJS();
  
  for (const filePath of paths) {
    const tempPath = resolvePath(filePath);
    const tempPptx = new PptxGenJS();
    await tempPptx.loadFile(tempPath);
    
    for (const slide of tempPptx.slides) {
      const newSlide = mergedPptx.addSlide();
      // Copy slide content - limited support
    }
  }
  
  await mergedPptx.writeFile({ fileName: resolvePath(output) });
  
  return {
    success: true,
    path: resolvePath(output),
    mergedFrom: paths.length,
    totalSlides: mergedPptx.slides.length
  };
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
    case 'read_presentation':
    case 'read':
      return await readPresentation(params);
      
    case 'extract_text':
      return await extractText(params);
      
    case 'extract_structure':
      return await extractStructure(params);
      
    // 创建操作
    case 'create_presentation':
    case 'create':
      return await createPresentation(params);
      
    case 'from_markdown':
      return await fromMarkdown(params);
      
    // 幻灯片操作
    case 'add_slide':
      return await addSlide(params);
      
    case 'delete_slide':
      return await deleteSlide(params);
      
    case 'update_slide':
      return await updateSlide(params);
      
    // 图片操作
    case 'extract_images':
      return await extractImages(params);
      
    case 'add_image':
      return await addImage(params);
      
    // 表格操作
    case 'add_table':
      return await addTable(params);
      
    // 导出操作
    case 'export_to_images':
      return await exportToImages(params);
      
    case 'generate_thumbnail':
      return await generateThumbnail(params);
      
    // 合并操作
    case 'merge_presentations':
    case 'merge':
      return await mergePresentations(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}. Supported tools: read_presentation, extract_text, extract_structure, create_presentation, from_markdown, add_slide, delete_slide, update_slide, extract_images, add_image, add_table, export_to_images, generate_thumbnail, merge_presentations`);
  }
}

module.exports = { execute };