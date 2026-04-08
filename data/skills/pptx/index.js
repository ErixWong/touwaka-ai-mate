/**
 * PPTX Skill - PowerPoint 演示文稿处理技能 (重构版)
 * 
 * 工具架构（4 个工具）：
 * - pptx_file: 文件级操作 (read, create, extract)
 * - pptx_slide: 幻灯片创建（仅限新建演示文稿）
 * - pptx_object: 内容对象添加（仅限新建演示文稿）
 * - pptx_master: 模板定义（仅限新建演示文稿）
 * 
 * 重要限制：
 * - pptxgenjs 4.0 只能创建新演示文稿，无法编辑现有文件
 * - 编辑操作（update/delete/move）不支持
 * - 读取操作使用 AdmZip 解析现有 PPTX 文件
 * - 如需编辑现有文件，建议：读取内容 → 创建新文件 → 添加修改后的内容
 * 
 * 依赖：
 * - pptxgenjs 4.0+: 演示文稿创建
 * - adm-zip: ZIP 操作（读取现有 PPTX）
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// ==================== 常量定义 ====================

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.emf', '.wmf', '.svg'];
const MEDIA_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mp3', '.wav', '.m4a'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// 延迟加载 pptxgenjs
let pptxgenjs = null;

function getPptxGenJS() {
  if (!pptxgenjs) {
    pptxgenjs = require('pptxgenjs');
  }
  return pptxgenjs;
}

// ==================== 路径与权限管理 ====================

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
  ALLOWED_BASE_PATHS = [DATA_BASE_PATH];
} else if (IS_SKILL_CREATOR) {
  ALLOWED_BASE_PATHS = [
    path.join(DATA_BASE_PATH, 'skills'),
    path.join(DATA_BASE_PATH, 'work', USER_ID)
  ];
} else {
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
 * 确保目录存在
 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ==================== pptx_file ====================

/**
 * 文件级操作
 * @param {object} params
 * @param {string} params.action - 操作: 'read' | 'create' | 'extract'
 * @param {string} params.path - 文件路径
 * @param {string} [params.scope] - 读取范围 (read): 'info' | 'text' | 'structure' | 'media'
 * @param {number[]} [params.slideNumbers] - 幻灯片编号列表
 * @param {string} [params.source] - 创建来源 (create): 'data' | 'markdown'
 * @param {Array} [params.slides] - 幻灯片数据
 * @param {string} [params.markdown] - Markdown 内容
 * @param {object} [params.properties] - 文档属性
 * @param {string} [params.outputDir] - 提取输出目录 (extract)
 * @param {string} [params.extractType] - 提取类型 (extract): 'images' | 'media' | 'all'
 */
async function pptxFile(params) {
  const { action, path: filePath } = params;
  
  switch (action) {
    case 'read':
      return await fileRead(params);
    case 'create':
      return await fileCreate(params);
    case 'extract':
      return await fileExtract(params);
    default:
      throw new Error(`Invalid action: ${action}. Must be 'read', 'create', or 'extract'`);
  }
}

/**
 * 安全打开 ZIP 文件
 * @param {string} resolvedPath - 已解析的文件路径
 * @returns {{ zip: AdmZip, entries: Array, error: string|null }}
 */
function safeOpenZip(resolvedPath) {
  try {
    // 检查文件大小
    const stats = fs.statSync(resolvedPath);
    if (stats.size > MAX_FILE_SIZE) {
      return {
        zip: null,
        entries: null,
        error: `File too large: ${Math.round(stats.size / 1024 / 1024)}MB. Maximum allowed: ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`
      };
    }
    
    const zip = new AdmZip(resolvedPath);
    const entries = zip.getEntries();
    
    // 验证 PPTX 结构
    const hasPptDir = entries.some(e => e.entryName.startsWith('ppt/'));
    if (!hasPptDir) {
      return { zip: null, entries: null, error: 'Invalid PPTX file: missing ppt/ directory' };
    }
    
    return { zip, entries, error: null };
  } catch (e) {
    return { zip: null, entries: null, error: `Failed to open file: ${e.message}` };
  }
}

/**
 * 读取演示文稿
 */
async function fileRead(params) {
  const { path: filePath, scope = 'info', slideNumbers } = params;
  
  const resolvedPath = resolvePath(filePath);
  const { zip, entries, error } = safeOpenZip(resolvedPath);
  
  if (error) {
    return { success: false, error };
  }
  
  // 读取基本信息
  if (scope === 'info') {
    const slides = [];
    
    for (const entry of entries) {
      const match = entry.entryName.match(/ppt\/slides\/slide(\d+)\.xml/);
      if (match) {
        const slideNum = parseInt(match[1]);
        const slideXml = zip.readAsText(entry.entryName);
        
        const textMatches = slideXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
        const texts = textMatches.map(m => m.replace(/<a:t>|<\/a:t>/g, ''));
        
        slides.push({
          number: slideNum,
          textCount: texts.length,
          preview: texts.slice(0, 5).join(' ').substring(0, 100)
        });
      }
    }
    
    // 按幻灯片编号排序
    slides.sort((a, b) => a.number - b.number);
    
    // 读取元数据
    let metadata = {};
    try {
      const coreXml = zip.readAsText('docProps/core.xml');
      if (coreXml) {
        const titleMatch = coreXml.match(/<dc:title>([^<]*)<\/dc:title>/);
        const authorMatch = coreXml.match(/<dc:creator>([^<]*)<\/dc:creator>/);
        const createdMatch = coreXml.match(/<dcterms:created>([^<]*)<\/dcterms:created>/);
        const modifiedMatch = coreXml.match(/<dcterms:modified>([^<]*)<\/dcterms:modified>/);
        
        metadata = {
          title: titleMatch ? titleMatch[1] : null,
          author: authorMatch ? authorMatch[1] : null,
          created: createdMatch ? createdMatch[1] : null,
          modified: modifiedMatch ? modifiedMatch[1] : null
        };
      }
    } catch (e) {
      // 元数据读取失败，忽略
    }
    
    return {
      success: true,
      path: resolvedPath,
      slideCount: slides.length,
      slides,
      metadata
    };
  }
  
  // 提取文本
  if (scope === 'text') {
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
    
    // 按幻灯片编号排序
    allTexts.sort((a, b) => a.slide - b.slide);
    
    return {
      success: true,
      path: resolvedPath,
      slides: allTexts,
      totalTexts: allTexts.reduce((sum, s) => sum + s.texts.length, 0)
    };
  }
  
  // 提取结构
  if (scope === 'structure') {
    const slides = [];
    
    for (const entry of entries) {
      const match = entry.entryName.match(/ppt\/slides\/slide(\d+)\.xml/);
      if (match) {
        const slideNum = parseInt(match[1]);
        const slideXml = zip.readAsText(entry.entryName);
        
        const shapes = [];
        const shapeMatches = slideXml.match(/<p:sp[^>]*>[\s\S]*?<\/p:sp>/g) || [];
        
        for (const shapeXml of shapeMatches) {
          const textMatches = shapeXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
          const texts = textMatches.map(m => m.replace(/<a:t>|<\/a:t>/g, ''));
          
          if (texts.length > 0) {
            shapes.push({ type: 'text', text: texts.join(' ') });
          }
        }
        
        const picMatches = slideXml.match(/<p:pic[^>]*>[\s\S]*?<\/p:pic>/g) || [];
        for (const picXml of picMatches) {
          const embedMatch = picXml.match(/r:embed="([^"]+)"/);
          if (embedMatch) {
            shapes.push({ type: 'image', embedId: embedMatch[1] });
          }
        }
        
        slides.push({
          number: slideNum,
          shapeCount: shapes.length,
          shapes
        });
      }
    }
    
    // 按幻灯片编号排序
    slides.sort((a, b) => a.number - b.number);
    
    return {
      success: true,
      path: resolvedPath,
      slideCount: slides.length,
      slides
    };
  }
  
  // 提取媒体信息
  if (scope === 'media') {
    const images = [];
    const media = [];
    
    for (const entry of entries) {
      const entryName = entry.entryName;
      const ext = path.extname(entryName).toLowerCase();
      
      if (entryName.startsWith('ppt/media/')) {
        const fileName = path.basename(entryName);
        
        if (IMAGE_EXTENSIONS.includes(ext)) {
          images.push({ originalPath: entryName, fileName, size: entry.header.size });
        } else if (MEDIA_EXTENSIONS.includes(ext)) {
          media.push({ originalPath: entryName, fileName, size: entry.header.size });
        }
      }
    }
    
    return {
      success: true,
      path: resolvedPath,
      imageCount: images.length,
      mediaCount: media.length,
      images,
      media
    };
  }
  
  throw new Error(`Invalid scope: ${scope}. Must be 'info', 'text', 'structure', or 'media'`);
}

/**
 * 创建演示文稿
 */
async function fileCreate(params) {
  const { path: filePath, source = 'data', slides = [], markdown, properties = {} } = params;
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  // 设置文档属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || '';
  pptx.subject = properties.subject || '';
  pptx.company = properties.company || '';
  
  // 设置布局
  if (properties.layout) {
    pptx.layout = properties.layout; // 'LAYOUT_16x9', 'LAYOUT_4x3', etc.
  }
  
  // 从数据创建
  if (source === 'data') {
    for (const slideData of slides) {
      addSlideFromData(pptx, slideData);
    }
    
    // 如果没有幻灯片，创建空白
    if (pptx.slides.length === 0) {
      pptx.addSlide();
    }
  }
  
  // 从 Markdown 创建
  if (source === 'markdown') {
    if (!markdown) {
      throw new Error('markdown content is required when source is "markdown"');
    }
    createFromMarkdown(pptx, markdown);
  }
  
  const outputPath = resolvePath(filePath);
  ensureDir(outputPath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath,
    slideCount: pptx.slides.length,
    note: 'Created with pptxgenjs 4.0. Editing existing files is not supported.'
  };
}

/**
 * 提取文件内容
 */
async function fileExtract(params) {
  const { path: filePath, outputDir, extractType = 'all' } = params;
  
  const resolvedPath = resolvePath(filePath);
  const { zip, entries, error } = safeOpenZip(resolvedPath);
  
  if (error) {
    return { success: false, error };
  }
  
  const outputPath = outputDir ? resolvePath(outputDir) : path.dirname(resolvedPath);
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }
  
  const results = {
    images: [],
    media: [],
    charts: [],
    other: []
  };
  
  for (const entry of entries) {
    if (!entry.isDirectory && entry.entryName.startsWith('ppt/media/')) {
      const fileName = path.basename(entry.entryName);
      const ext = path.extname(fileName).toLowerCase();
      
      const shouldExtract =
        extractType === 'all' ||
        (extractType === 'images' && IMAGE_EXTENSIONS.includes(ext)) ||
        (extractType === 'media' && MEDIA_EXTENSIONS.includes(ext));
      
      if (shouldExtract) {
        const outFile = path.join(outputPath, fileName);
        fs.writeFileSync(outFile, entry.getData());
        
        if (IMAGE_EXTENSIONS.includes(ext)) {
          results.images.push({ fileName, outputPath: outFile, size: entry.header.size });
        } else if (MEDIA_EXTENSIONS.includes(ext)) {
          results.media.push({ fileName, outputPath: outFile, size: entry.header.size });
        } else {
          results.other.push({ fileName, outputPath: outFile, size: entry.header.size });
        }
      }
    }
  }
  
  return {
    success: true,
    sourcePath: resolvedPath,
    outputDir: outputPath,
    extractType,
    imageCount: results.images.length,
    mediaCount: results.media.length,
    results
  };
}

// ==================== pptx_slide ====================

/**
 * 幻灯片创建（仅限新建演示文稿）
 * 
 * 注意：此工具用于在创建新演示文稿时添加幻灯片
 * 无法编辑现有 PPTX 文件
 * 
 * @param {object} params
 * @param {string} params.action - 操作: 'add' (仅支持添加到新演示文稿)
 * @param {string} params.output - 输出文件路径
 * @param {string} [params.master] - 母版名称
 * @param {string} [params.title] - 标题
 * @param {string|string[]} [params.content] - 内容
 * @param {object} [params.background] - 背景
 * @param {object} [params.properties] - 文档属性
 * @param {Array} [params.slides] - 多个幻灯片数据（批量添加）
 */
async function pptxSlide(params) {
  const { action } = params;
  
  if (action !== 'add') {
    throw new Error(`Invalid action: ${action}. Only 'add' is supported for new presentations. Editing existing files is not supported by pptxgenjs 4.0.`);
  }
  
  return await slideCreate(params);
}

/**
 * 创建包含幻灯片的演示文稿
 */
async function slideCreate(params) {
  const { output, master, slides, properties = {} } = params;
  
  if (!output) {
    throw new Error('output path is required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  // 设置文档属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || '';
  pptx.subject = properties.subject || '';
  pptx.company = properties.company || '';
  
  if (properties.layout) {
    pptx.layout = properties.layout;
  }
  
  // 定义母版（如果提供）
  if (master) {
    pptx.defineSlideMaster({
      title: master.name || 'CustomMaster',
      background: master.background || { color: 'FFFFFF' },
      objects: master.objects || [],
      slideNumber: master.slideNumber || { x: 9, y: 5, fontSize: 12 }
    });
  }
  
  // 添加幻灯片
  if (slides && Array.isArray(slides)) {
    for (const slideData of slides) {
      addSlideFromData(pptx, slideData, master?.name);
    }
  } else {
    // 单个幻灯片参数
    const slideOptions = master?.name ? { masterName: master.name } : {};
    const slide = pptx.addSlide(slideOptions);
    
    if (params.background) {
      slide.background = params.background;
    }
    
    if (params.title) {
      slide.addText(params.title, {
        x: 0.5,
        y: 0.5,
        w: '90%',
        h: 1,
        fontSize: 36,
        bold: true,
        color: '363636'
      });
    }
    
    if (params.content) {
      if (Array.isArray(params.content)) {
        slide.addText(params.content.map(t => ({ text: t, options: { bullet: true } })), {
          x: 0.5,
          y: 1.5,
          w: '90%',
          h: 4,
          fontSize: 18
        });
      } else {
        slide.addText(params.content, {
          x: 0.5,
          y: 1.5,
          w: '90%',
          h: 4,
          fontSize: 18
        });
      }
    }
  }
  
  // 如果没有幻灯片，创建空白
  if (pptx.slides.length === 0) {
    pptx.addSlide();
  }
  
  const outputPath = resolvePath(output);
  ensureDir(outputPath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath,
    slideCount: pptx.slides.length,
    note: 'Created new presentation. Editing existing files is not supported.'
  };
}

// ==================== pptx_object ====================

/**
 * 内容对象添加（仅限新建演示文稿）
 * 
 * 注意：此工具用于在创建新演示文稿时添加内容对象
 * 无法编辑现有 PPTX 文件
 * 
 * @param {object} params
 * @param {string} params.action - 操作: 'add' | 'extract'
 * @param {string} [params.output] - 输出文件路径 (add)
 * @param {string} [params.path] - 现有文件路径 (extract)
 * @param {number} [params.slideNumber] - 幻灯片编号 (add)
 * @param {string} params.type - 对象类型: 'text' | 'image' | 'table' | 'chart' | 'shape' | 'media' | 'notes'
 * @param {string} [params.text] - 文本内容
 * @param {object} [params.options] - 文本选项
 * @param {object} [params.image] - 图片配置
 * @param {object} [params.table] - 表格配置
 * @param {object} [params.chart] - 图表配置
 * @param {object} [params.shape] - 形状配置
 * @param {object} [params.media] - 媒体配置
 * @param {string} [params.notes] - 演讲者备注
 * @param {object} [params.properties] - 文档属性
 * @param {string} [params.outputDir] - 提取输出目录 (extract)
 */
async function pptxObject(params) {
  const { action } = params;
  
  switch (action) {
    case 'add':
      return await objectAdd(params);
    case 'extract':
      return await objectExtract(params);
    default:
      throw new Error(`Invalid action: ${action}. Must be 'add' or 'extract'. Editing existing files is not supported.`);
  }
}

/**
 * 添加对象到新演示文稿
 */
async function objectAdd(params) {
  const { output, slideNumber = 1, type, properties = {} } = params;
  
  if (!output) {
    throw new Error('output path is required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  // 设置文档属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || '';
  
  if (properties.layout) {
    pptx.layout = properties.layout;
  }
  
  // 创建幻灯片
  const slide = pptx.addSlide();
  
  // 添加对象
  switch (type) {
    case 'text':
      addObjectText(slide, params);
      break;
    case 'image':
      addObjectImage(slide, params);
      break;
    case 'table':
      addObjectTable(slide, params);
      break;
    case 'chart':
      addObjectChart(slide, params);
      break;
    case 'shape':
      addObjectShape(slide, params);
      break;
    case 'media':
      addObjectMedia(slide, params);
      break;
    case 'notes':
      addObjectNotes(slide, params);
      break;
    default:
      throw new Error(`Invalid type: ${type}. Must be 'text', 'image', 'table', 'chart', 'shape', 'media', or 'notes'`);
  }
  
  const outputPath = resolvePath(output);
  ensureDir(outputPath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath,
    objectAdded: type,
    slideNumber,
    note: 'Created new presentation with object. Editing existing files is not supported.'
  };
}

/**
 * 添加文本
 */
function addObjectText(slide, params) {
  const { text, options = {} } = params;
  
  if (!text) {
    throw new Error('text is required for type "text"');
  }
  
  const defaultOptions = {
    x: 0.5,
    y: 0.5,
    w: '90%',
    h: 0.5,
    fontSize: 18,
    color: '363636'
  };
  
  slide.addText(text, { ...defaultOptions, ...options });
}

/**
 * 添加图片
 */
function addObjectImage(slide, params) {
  const { image } = params;
  
  if (!image) {
    throw new Error('image config is required for type "image"');
  }
  
  // 支持路径或 base64
  const imageConfig = {
    x: image.x || 0.5,
    y: image.y || 1,
    w: image.w || 4,
    h: image.h || 3,
    sizing: image.sizing
  };
  
  if (image.path) {
    const imgPath = resolvePath(image.path);
    imageConfig.path = imgPath;
  } else if (image.data) {
    imageConfig.data = image.data;
  } else {
    throw new Error('image.path or image.data is required');
  }
  
  slide.addImage(imageConfig);
}

/**
 * 添加表格
 */
function addObjectTable(slide, params) {
  const { table } = params;
  
  if (!table || !table.rows) {
    throw new Error('table.rows is required for type "table"');
  }
  
  slide.addTable(table.rows, {
    x: table.x || 0.5,
    y: table.y || 1,
    w: table.w || 9,
    colW: table.colW,
    border: table.border || { pt: 1, color: 'CFCFCF' },
    fontFace: table.fontFace || 'Arial',
    fontSize: table.fontSize || 12,
    align: table.align || 'left'
  });
}

/**
 * 添加图表
 */
function addObjectChart(slide, params) {
  const { chart } = params;
  
  if (!chart || !chart.type || !chart.data) {
    throw new Error('chart.type and chart.data are required for type "chart"');
  }
  
  // 支持的图表类型
  const validTypes = [
    'bar', 'bar3D', 'line', 'line3D', 'pie', 'pie3D', 
    'doughnut', 'area', 'area3D', 'scatter', 'bubble', 
    'radar', 'radar3D', 'bubble3D'
  ];
  
  if (!validTypes.includes(chart.type)) {
    throw new Error(`Invalid chart type: ${chart.type}. Valid types: ${validTypes.join(', ')}`);
  }
  
  // 转换数据格式
  const chartData = chart.data.map(series => ({
    name: series.name,
    labels: series.labels,
    values: series.values
  }));
  
  slide.addChart(chart.type, chartData, {
    x: chart.x || 1,
    y: chart.y || 1,
    w: chart.w || 8,
    h: chart.h || 5,
    title: chart.title,
    showLegend: chart.showLegend !== false,
    legendPos: chart.legendPos || 'r',
    chartColors: chart.colors
  });
}

/**
 * 添加形状
 */
function addObjectShape(slide, params) {
  const { shape } = params;
  
  if (!shape) {
    throw new Error('shape config is required for type "shape"');
  }
  
  slide.addShape(shape.type || 'rect', {
    x: shape.x || 0,
    y: shape.y || 0,
    w: shape.w || 1,
    h: shape.h || 1,
    fill: shape.fill || { color: 'CCCCCC' },
    line: shape.line || { color: '000000', width: 1 }
  });
}

/**
 * 添加媒体
 */
function addObjectMedia(slide, params) {
  const { media } = params;
  
  if (!media) {
    throw new Error('media config is required for type "media"');
  }
  
  const mediaConfig = {
    type: media.type || 'video',
    x: media.x || 1,
    y: media.y || 1,
    w: media.w || 6,
    h: media.h || 4
  };
  
  if (media.path) {
    const mediaPath = resolvePath(media.path);
    mediaConfig.path = mediaPath;
  } else if (media.data) {
    mediaConfig.data = media.data;
  } else {
    throw new Error('media.path or media.data is required');
  }
  
  slide.addMedia(mediaConfig);
}

/**
 * 添加演讲者备注
 */
function addObjectNotes(slide, params) {
  const { notes } = params;
  
  if (!notes) {
    throw new Error('notes is required for type "notes"');
  }
  
  slide.addNotes(notes);
}

/**
 * 提取对象
 */
async function objectExtract(params) {
  const { path: filePath, type, outputDir } = params;
  
  const resolvedPath = resolvePath(filePath);
  const { zip, entries, error } = safeOpenZip(resolvedPath);
  
  if (error) {
    return { success: false, error };
  }
  
  const outputPath = outputDir ? resolvePath(outputDir) : null;
  if (outputPath && !fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }
  
  const results = [];
  
  if (type === 'image' || type === 'images') {
    for (const entry of entries) {
      const entryName = entry.entryName;
      const ext = path.extname(entryName).toLowerCase();
      
      if (entryName.startsWith('ppt/media/') && IMAGE_EXTENSIONS.includes(ext)) {
        const fileName = path.basename(entryName);
        
        if (outputPath) {
          const outFile = path.join(outputPath, fileName);
          fs.writeFileSync(outFile, entry.getData());
        }
        
        results.push({
          originalPath: entryName,
          fileName,
          extracted: outputPath ? true : false
        });
      }
    }
  }
  
  if (type === 'media') {
    for (const entry of entries) {
      const entryName = entry.entryName;
      const ext = path.extname(entryName).toLowerCase();
      
      if (entryName.startsWith('ppt/media/') && MEDIA_EXTENSIONS.includes(ext)) {
        const fileName = path.basename(entryName);
        
        if (outputPath) {
          const outFile = path.join(outputPath, fileName);
          fs.writeFileSync(outFile, entry.getData());
        }
        
        results.push({
          originalPath: entryName,
          fileName,
          extracted: outputPath ? true : false
        });
      }
    }
  }
  
  if (type === 'text') {
    for (const entry of entries) {
      const match = entry.entryName.match(/ppt\/slides\/slide(\d+)\.xml/);
      if (match) {
        const slideNum = parseInt(match[1]);
        const slideXml = zip.readAsText(entry.entryName);
        const textMatches = slideXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
        const texts = textMatches.map(m => m.replace(/<a:t>|<\/a:t>/g, ''));
        
        results.push({
          slide: slideNum,
          texts
        });
      }
    }
    
    // 按幻灯片编号排序
    results.sort((a, b) => a.slide - b.slide);
  }
  
  return {
    success: true,
    path: resolvedPath,
    type,
    count: results.length,
    outputDir: outputPath,
    items: results
  };
}

// ==================== pptx_master ====================

/**
 * 模板定义（仅限新建演示文稿）
 * 
 * 注意：此工具用于在创建新演示文稿时定义母版
 * 无法编辑现有 PPTX 文件
 * 
 * @param {object} params
 * @param {string} params.action - 操作: 'define' | 'list'
 * @param {string} [params.path] - 现有文件路径 (list)
 * @param {string} [params.output] - 输出文件路径 (define)
 * @param {string} [params.name] - 母版名称
 * @param {object} [params.background] - 背景
 * @param {Array} [params.objects] - 母版对象
 * @param {object} [params.slideNumber] - 幻灯片编号配置
 * @param {object} [params.margin] - 边距
 * @param {object} [params.properties] - 文档属性
 */
async function pptxMaster(params) {
  const { action } = params;
  
  switch (action) {
    case 'define':
      return await masterDefine(params);
    case 'list':
      return await masterList(params);
    default:
      throw new Error(`Invalid action: ${action}. Must be 'define' or 'list'. Editing existing files is not supported.`);
  }
}

/**
 * 定义母版并创建演示文稿
 */
async function masterDefine(params) {
  const { output, name, background, objects, slideNumber, margin, properties = {} } = params;
  
  if (!name) {
    throw new Error('name is required for master definition');
  }
  
  if (!output) {
    throw new Error('output path is required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  // 设置文档属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || name;
  
  if (properties.layout) {
    pptx.layout = properties.layout;
  }
  
  // 定义母版
  const masterDef = {
    title: name,
    background: background || { color: 'FFFFFF' },
    objects: objects || [],
    slideNumber: slideNumber || { x: 9, y: 5, fontSize: 12 }
  };
  
  if (margin) {
    masterDef.margin = margin;
  }
  
  pptx.defineSlideMaster(masterDef);
  
  // 创建一个使用该母版的示例幻灯片
  pptx.addSlide({ masterName: name });
  
  const outputPath = resolvePath(output);
  ensureDir(outputPath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath,
    masterName: name,
    slideCount: pptx.slides.length,
    note: 'Created new presentation with master. Editing existing files is not supported.'
  };
}

/**
 * 列出母版
 */
async function masterList(params) {
  const { path: filePath } = params;
  
  if (!filePath) {
    throw new Error('path is required for listing masters');
  }
  
  const resolvedPath = resolvePath(filePath);
  const { zip, entries, error } = safeOpenZip(resolvedPath);
  
  if (error) {
    return { success: false, error };
  }
  
  const masters = [];
  
  for (const entry of entries) {
    if (entry.entryName.match(/ppt\/slideLayouts\/slideLayout\d+\.xml/)) {
      const layoutXml = zip.readAsText(entry.entryName);
      
      // 提取布局名称
      const nameMatch = layoutXml.match(/<p:cSld name="([^"]*)"/);
      const name = nameMatch ? nameMatch[1] : path.basename(entry.entryName, '.xml');
      
      masters.push({
        name,
        path: entry.entryName
      });
    }
  }
  
  return {
    success: true,
    path: resolvedPath,
    masterCount: masters.length,
    masters
  };
}

// ==================== 辅助函数 ====================

/**
 * 从数据添加幻灯片
 */
function addSlideFromData(pptx, slideData, masterName) {
  const slideOptions = masterName ? { masterName } : {};
  const slide = pptx.addSlide(slideOptions);
  
  // 背景
  if (slideData.background) {
    slide.background = slideData.background;
  }
  
  // 标题
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
  
  // 内容
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
  
  // 文本列表
  if (slideData.texts && Array.isArray(slideData.texts)) {
    let yPos = slideData.title ? 1.5 : 0.5;
    for (const textItem of slideData.texts) {
      if (typeof textItem === 'string') {
        slide.addText(textItem, { x: 0.5, y: yPos, w: '90%', fontSize: 18 });
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
  
  // 图片
  if (slideData.images && Array.isArray(slideData.images)) {
    for (const img of slideData.images) {
      try {
        const imgConfig = {
          x: img.x || 0.5,
          y: img.y || 1,
          w: img.w || 4,
          h: img.h || 3
        };
        
        if (img.path) {
          imgConfig.path = resolvePath(img.path);
        } else if (img.data) {
          imgConfig.data = img.data;
        }
        
        slide.addImage(imgConfig);
      } catch (e) {}
    }
  }
  
  // 表格
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
  
  // 形状
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
  
  // 图表
  if (slideData.charts && Array.isArray(slideData.charts)) {
    for (const chartData of slideData.charts) {
      const chartDataFormatted = chartData.data.map(series => ({
        name: series.name,
        labels: series.labels,
        values: series.values
      }));
      
      slide.addChart(chartData.type, chartDataFormatted, {
        x: chartData.x || 1,
        y: chartData.y || 1,
        w: chartData.w || 8,
        h: chartData.h || 5,
        title: chartData.title,
        showLegend: chartData.showLegend !== false
      });
    }
  }
  
  // 演讲者备注
  if (slideData.notes) {
    slide.addNotes(slideData.notes);
  }
}

/**
 * 从 Markdown 创建演示文稿
 */
function createFromMarkdown(pptx, markdown) {
  const lines = markdown.split('\n');
  let currentSlide = null;
  let slideContent = [];
  
  for (const line of lines) {
    // 一级标题 = 新幻灯片
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      if (currentSlide) {
        finalizeMarkdownSlide(pptx, currentSlide, slideContent);
      }
      
      currentSlide = { title: line.substring(2) };
      slideContent = [];
    }
    // 二级标题 = 内容标题
    else if (line.startsWith('## ')) {
      if (currentSlide) {
        slideContent.push({ type: 'heading', text: line.substring(3) });
      }
    }
    // 列表项
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      slideContent.push({ type: 'bullet', text: line.substring(2) });
    }
    // 普通文本
    else if (line.trim() && currentSlide) {
      slideContent.push({ type: 'text', text: line });
    }
  }
  
  // 处理最后一个幻灯片
  if (currentSlide) {
    finalizeMarkdownSlide(pptx, currentSlide, slideContent);
  }
  
  // 如果没有幻灯片，创建空白
  if (pptx.slides.length === 0) {
    pptx.addSlide();
  }
}

/**
 * 完成 Markdown 幻灯片
 */
function finalizeMarkdownSlide(pptx, slideInfo, content) {
  const slide = pptx.addSlide();
  
  // 标题
  if (slideInfo.title) {
    slide.addText(slideInfo.title, {
      x: 0.5,
      y: 0.5,
      w: '90%',
      h: 1,
      fontSize: 36,
      bold: true
    });
  }
  
  // 内容
  if (content.length > 0) {
    const bulletItems = content
      .filter(c => c.type === 'bullet')
      .map(c => ({ text: c.text, options: { bullet: true } }));
    
    if (bulletItems.length > 0) {
      slide.addText(bulletItems, {
        x: 0.5,
        y: 1.5,
        w: '90%',
        h: 4,
        fontSize: 18
      });
    }
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
    case 'file':
      return await pptxFile(params);
      
    case 'slide':
      return await pptxSlide(params);
      
    case 'object':
      return await pptxObject(params);
      
    case 'master':
      return await pptxMaster(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}. Supported tools: file, slide, object, master`);
  }
}

// ============================================
// 工具定义
// ============================================

function getTools() {
  return [
    {
      name: 'file',
      description: '文件级操作，支持read、create、extract',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'create', 'extract'], description: '操作类型' },
          path: { type: 'string', description: '文件路径' },
          scope: { type: 'string', enum: ['info', 'text', 'structure', 'media'], description: '读取范围（read操作）' },
          slideNumbers: { type: 'array', items: { type: 'number' }, description: '幻灯片编号列表（read操作）' },
          source: { type: 'string', enum: ['data', 'markdown'], description: '创建来源（create操作）' },
          slides: { type: 'array', description: '幻灯片数据（create操作）' },
          markdown: { type: 'string', description: 'Markdown内容（create操作）' },
          properties: { type: 'object', description: '文档属性' },
          outputDir: { type: 'string', description: '提取输出目录（extract操作）' },
          extractType: { type: 'string', enum: ['images', 'media', 'all'], description: '提取类型（extract操作）' }
        },
        required: ['action', 'path']
      }
    },
    {
      name: 'slide',
      description: '幻灯片创建（仅限新建演示文稿），支持add操作',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add'], description: '操作类型' },
          output: { type: 'string', description: '输出文件路径' },
          master: { type: 'object', description: '母版配置' },
          slides: { type: 'array', description: '多个幻灯片数据（批量添加）' },
          title: { type: 'string', description: '标题' },
          content: { type: 'string', description: '内容' },
          background: { type: 'object', description: '背景配置' },
          properties: { type: 'object', description: '文档属性' }
        },
        required: ['action', 'output']
      }
    },
    {
      name: 'object',
      description: '内容对象添加（仅限新建演示文稿），支持add、extract',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'extract'], description: '操作类型' },
          output: { type: 'string', description: '输出文件路径（add操作）' },
          path: { type: 'string', description: '现有文件路径（extract操作）' },
          slideNumber: { type: 'number', description: '幻灯片编号（add操作）' },
          type: { type: 'string', enum: ['text', 'image', 'table', 'chart', 'shape', 'media', 'notes'], description: '对象类型（add操作）' },
          text: { type: 'string', description: '文本内容（text类型）' },
          options: { type: 'object', description: '文本选项（text类型）' },
          image: { type: 'object', description: '图片配置（image类型）' },
          table: { type: 'object', description: '表格配置（table类型）' },
          chart: { type: 'object', description: '图表配置（chart类型）' },
          shape: { type: 'object', description: '形状配置（shape类型）' },
          media: { type: 'object', description: '媒体配置（media类型）' },
          notes: { type: 'string', description: '演讲者备注（notes类型）' },
          properties: { type: 'object', description: '文档属性' },
          outputDir: { type: 'string', description: '提取输出目录（extract操作）' }
        },
        required: ['action']
      }
    },
    {
      name: 'master',
      description: '模板定义（仅限新建演示文稿），支持define、list',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['define', 'list'], description: '操作类型' },
          path: { type: 'string', description: '现有文件路径（list操作）' },
          output: { type: 'string', description: '输出文件路径（define操作）' },
          name: { type: 'string', description: '母版名称' },
          background: { type: 'object', description: '背景配置' },
          objects: { type: 'array', description: '母版对象' },
          slideNumber: { type: 'object', description: '幻灯片编号配置' },
          margin: { type: 'object', description: '边距' },
          properties: { type: 'object', description: '文档属性' }
        },
        required: ['action']
      }
    }
  ];
}

module.exports = { execute, getTools };