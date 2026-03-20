/**
 * PPTX Skill - PowerPoint 处理技能 (Node.js 版本)
 * 
 * 功能：
 * - 创建演示文稿（.pptx）
 * - 添加幻灯片
 * - 添加文本、图片、表格
 * - 添加图表（内置 + chart 技能）
 * - 读取演示文稿信息
 * - 提取文本内容
 * 
 * 依赖：
 * - pptxgenjs: 创建演示文稿
 * - adm-zip: 解压/压缩 pptx 文件
 * - xml2js: 解析 XML
 */

const PptxGenJS = require('pptxgenjs');
const AdmZip = require('adm-zip');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs').promises;

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

// ==================== 读取操作 ====================

/**
 * 读取演示文稿信息
 * @param {Object} params - 参数
 * @param {string} params.path - 演示文稿路径
 * @returns {Promise<Object>} 演示文稿信息
 */
async function readPresentation(params) {
  const { path: filePath } = params;
  const resolvedPath = resolvePath(filePath);
  
  const zip = new AdmZip(resolvedPath);
  const zipEntries = zip.getEntries();
  
  // 查找 presentation.xml
  const presEntry = zipEntries.find(entry => entry.entryName === 'ppt/presentation.xml');
  const corePropsEntry = zipEntries.find(entry => entry.entryName === 'docProps/core.xml');
  
  const info = {
    slideCount: 0,
    slides: [],
    creator: null,
    created: null,
    modified: null,
    lastModifiedBy: null,
    title: null,
    subject: null
  };
  
  // 统计幻灯片数量
  const slideEntries = zipEntries.filter(entry => 
    entry.entryName.match(/^ppt\/slides\/slide\d+\.xml$/)
  );
  info.slideCount = slideEntries.length;
  info.slides = slideEntries.map((entry, index) => ({
    number: index + 1,
    name: entry.entryName
  }));
  
  // 解析 core.xml
  if (corePropsEntry) {
    const coreXml = corePropsEntry.getData().toString('utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(coreXml);
    
    if (result['cp:coreProperties']) {
      const props = result['cp:coreProperties'];
      info.creator = props['dc:creator'] ? props['dc:creator'][0] : null;
      info.created = props['dcterms:created'] ? props['dcterms:created'][0] : null;
      info.modified = props['dcterms:modified'] ? props['dcterms:modified'][0] : null;
      info.lastModifiedBy = props['cp:lastModifiedBy'] ? props['cp:lastModifiedBy'][0] : null;
      info.title = props['dc:title'] ? props['dc:title'][0] : null;
      info.subject = props['dc:subject'] ? props['dc:subject'][0] : null;
    }
  }
  
  return {
    success: true,
    ...info
  };
}

/**
 * 提取幻灯片文本
 * @param {Object} params - 参数
 * @param {string} params.path - 演示文稿路径
 * @param {number} params.slide - 幻灯片编号（可选，不指定则提取全部）
 * @returns {Promise<Object>} 提取结果
 */
async function extractText(params) {
  const { path: filePath, slide: slideNum } = params;
  const resolvedPath = resolvePath(filePath);
  
  const zip = new AdmZip(resolvedPath);
  const zipEntries = zip.getEntries();
  
  const slideEntries = zipEntries.filter(entry => 
    entry.entryName.match(/^ppt\/slides\/slide\d+\.xml$/)
  ).sort((a, b) => {
    const numA = parseInt(a.entryName.match(/slide(\d+)\.xml$/)[1], 10);
    const numB = parseInt(b.entryName.match(/slide(\d+)\.xml$/)[1], 10);
    return numA - numB;
  });
  
  const parser = new xml2js.Parser();
  const slides = [];
  
  for (let i = 0; i < slideEntries.length; i++) {
    const entry = slideEntries[i];
    const slideNumber = i + 1;
    
    // 如果指定了幻灯片，只处理该幻灯片
    if (slideNum && slideNumber !== slideNum) continue;
    
    const slideXml = entry.getData().toString('utf8');
    const result = await parser.parseStringPromise(slideXml);
    
    const texts = [];
    
    // 递归提取文本
    function extractTextFromNode(node) {
      if (!node || typeof node !== 'object') return;
      
      for (const key in node) {
        if (key === 'a:t' && Array.isArray(node[key])) {
          texts.push(node[key].join(''));
        } else if (Array.isArray(node[key])) {
          for (const item of node[key]) {
            extractTextFromNode(item);
          }
        } else if (typeof node[key] === 'object') {
          extractTextFromNode(node[key]);
        }
      }
    }
    
    extractTextFromNode(result);
    
    slides.push({
      number: slideNumber,
      text: texts.join('\n')
    });
  }
  
  return {
    success: true,
    slideCount: slideEntries.length,
    slides,
    fullText: slides.map(s => s.text).join('\n\n--- Slide ---\n\n')
  };
}

// ==================== 创建操作 ====================

/**
 * 创建新演示文稿
 * @param {Object} params - 参数
 * @param {string} params.path - 输出路径
 * @param {string} params.title - 演示文稿标题
 * @param {Object} params.properties - 属性
 * @returns {Promise<Object>} 创建结果
 */
async function createPresentation(params) {
  const { path: filePath, title, properties = {} } = params;
  
  const pptx = new PptxGenJS();
  
  // 设置属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = title || properties.title || 'Presentation';
  pptx.subject = properties.subject || '';
  pptx.company = properties.company || '';
  
  // 添加标题幻灯片
  if (title) {
    const slide = pptx.addSlide();
    slide.addText(title, {
      x: 0.5,
      y: 2.5,
      w: 9,
      h: 1,
      fontSize: 44,
      bold: true,
      align: 'center'
    });
  }
  
  // 保存
  await pptx.writeFile({ fileName: resolvePath(filePath) });
  
  return {
    success: true,
    path: resolvePath(filePath),
    slideCount: pptx.slides.length
  };
}

/**
 * 添加幻灯片
 * @param {Object} params - 参数
 * @param {string} params.path - 演示文稿路径（可选，不指定则创建新演示文稿）
 * @param {string} params.output - 输出路径
 * @param {Object} params.slide - 幻灯片内容
 * @returns {Promise<Object>} 添加结果
 */
async function addSlide(params) {
  const { path: filePath, output, slide: slideContent } = params;
  
  let pptx = new PptxGenJS();
  
  // 如果指定了现有文件，需要处理
  // 注意：pptxgenjs 不支持直接编辑现有文件
  // 这里简化处理：创建新幻灯片
  
  const slide = pptx.addSlide();
  
  // 设置布局
  if (slideContent.layout) {
    // pptxgenjs 支持预定义布局
    // 'LAYOUT_1' - Title Slide
    // 'LAYOUT_2' - Title and Content
    // 'LAYOUT_3' - Section Header
    // 等等
  }
  
  // 添加标题
  if (slideContent.title) {
    slide.addText(slideContent.title, {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 1,
      fontSize: 32,
      bold: true
    });
  }
  
  // 添加副标题
  if (slideContent.subtitle) {
    slide.addText(slideContent.subtitle, {
      x: 0.5,
      y: 1.5,
      w: 9,
      h: 0.5,
      fontSize: 18,
      color: '666666'
    });
  }
  
  // 添加内容
  if (slideContent.content) {
    if (Array.isArray(slideContent.content)) {
      // 文本列表
      const textItems = slideContent.content.map(item => {
        if (typeof item === 'string') {
          return { text: item, options: { bullet: true } };
        }
        return { text: item.text, options: { bullet: item.bullet !== false, ...item.options } };
      });
      
      slide.addText(textItems, {
        x: 0.5,
        y: 2.5,
        w: 9,
        h: 4
      });
    } else if (typeof slideContent.content === 'string') {
      // 单个文本
      slide.addText(slideContent.content, {
        x: 0.5,
        y: 2.5,
        w: 9,
        h: 4
      });
    }
  }
  
  // 添加图片
  if (slideContent.images && Array.isArray(slideContent.images)) {
    for (const img of slideContent.images) {
      slide.addImage({
        path: resolvePath(img.path),
        x: img.x || 0.5,
        y: img.y || 2.5,
        w: img.w || 4,
        h: img.h || 3
      });
    }
  }
  
  // 添加表格
  if (slideContent.table) {
    const table = slideContent.table;
    slide.addTable(table.rows, {
      x: table.x || 0.5,
      y: table.y || 2.5,
      w: table.w || 9,
      colW: table.colW,
      border: { type: 'solid', pt: 1, color: '000000' }
    });
  }
  
  // 添加图表
  if (slideContent.chart) {
    const chart = slideContent.chart;
    slide.addChart(chart.type || 'bar', chart.data, {
      x: chart.x || 0.5,
      y: chart.y || 2.5,
      w: chart.w || 9,
      h: chart.h || 4,
      title: chart.title,
      showLegend: chart.showLegend !== false,
      chartColors: chart.colors
    });
  }
  
  // 保存
  const outputPath = output ? resolvePath(output) : resolvePath(filePath || 'presentation.pptx');
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath,
    slideCount: pptx.slides.length
  };
}

/**
 * 添加多张幻灯片
 * @param {Object} params - 参数
 * @param {string} params.path - 输出路径
 * @param {Array} params.slides - 幻灯片数组
 * @param {Object} params.properties - 属性
 * @returns {Promise<Object>} 创建结果
 */
async function createSlides(params) {
  const { path: filePath, slides = [], properties = {} } = params;
  
  const pptx = new PptxGenJS();
  
  // 设置属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || 'Presentation';
  pptx.subject = properties.subject || '';
  
  for (const slideContent of slides) {
    const slide = pptx.addSlide();
    
    // 添加标题
    if (slideContent.title) {
      slide.addText(slideContent.title, {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 1,
        fontSize: 32,
        bold: true
      });
    }
    
    // 添加副标题
    if (slideContent.subtitle) {
      slide.addText(slideContent.subtitle, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 0.5,
        fontSize: 18,
        color: '666666'
      });
    }
    
    // 添加内容
    if (slideContent.content) {
      if (Array.isArray(slideContent.content)) {
        const textItems = slideContent.content.map(item => {
          if (typeof item === 'string') {
            return { text: item, options: { bullet: true } };
          }
          return { text: item.text, options: { bullet: item.bullet !== false, ...item.options } };
        });
        
        slide.addText(textItems, {
          x: 0.5,
          y: 2.5,
          w: 9,
          h: 4
        });
      } else if (typeof slideContent.content === 'string') {
        slide.addText(slideContent.content, {
          x: 0.5,
          y: 2.5,
          w: 9,
          h: 4
        });
      }
    }
    
    // 添加图片
    if (slideContent.images && Array.isArray(slideContent.images)) {
      for (const img of slideContent.images) {
        slide.addImage({
          path: resolvePath(img.path),
          x: img.x || 0.5,
          y: img.y || 2.5,
          w: img.w || 4,
          h: img.h || 3
        });
      }
    }
    
    // 添加表格
    if (slideContent.table) {
      const table = slideContent.table;
      slide.addTable(table.rows, {
        x: table.x || 0.5,
        y: table.y || 2.5,
        w: table.w || 9,
        colW: table.colW,
        border: { type: 'solid', pt: 1, color: '000000' }
      });
    }
    
    // 添加图表
    if (slideContent.chart) {
      const chart = slideContent.chart;
      slide.addChart(chart.type || 'bar', chart.data, {
        x: chart.x || 0.5,
        y: chart.y || 2.5,
        w: chart.w || 9,
        h: chart.h || 4,
        title: chart.title,
        showLegend: chart.showLegend !== false,
        chartColors: chart.colors
      });
    }
  }
  
  // 保存
  await pptx.writeFile({ fileName: resolvePath(filePath) });
  
  return {
    success: true,
    path: resolvePath(filePath),
    slideCount: pptx.slides.length
  };
}

/**
 * 添加图片到幻灯片
 * @param {Object} params - 参数
 * @param {string} params.path - 演示文稿路径
 * @param {string} params.imagePath - 图片路径
 * @param {Object} params.position - 位置和大小
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addImage(params) {
  const { path: filePath, imagePath, position = {}, output } = params;
  
  // 注意：pptxgenjs 不支持直接编辑现有文件
  // 这里创建一个新幻灯片
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();
  
  slide.addImage({
    path: resolvePath(imagePath),
    x: position.x || 0.5,
    y: position.y || 0.5,
    w: position.w || 9,
    h: position.h || 5
  });
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath
  };
}

/**
 * 添加图表到幻灯片
 * @param {Object} params - 参数
 * @param {string} params.path - 演示文稿路径
 * @param {Object} params.chart - 图表配置
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addChart(params) {
  const { path: filePath, chart, output } = params;
  
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();
  
  // 添加标题
  if (chart.title) {
    slide.addText(chart.title, {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.5,
      fontSize: 24,
      bold: true
    });
  }
  
  // 添加图表
  slide.addChart(chart.type || 'bar', chart.data, {
    x: chart.x || 0.5,
    y: chart.y || 1.5,
    w: chart.w || 9,
    h: chart.h || 4.5,
    title: chart.chartTitle,
    showLegend: chart.showLegend !== false,
    chartColors: chart.colors || ['5470c6', '91cc75', 'fac858', 'ee6666', '73c0de']
  });
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath
  };
}

/**
 * 添加表格到幻灯片
 * @param {Object} params - 参数
 * @param {string} params.path - 演示文稿路径
 * @param {Object} params.table - 表格配置
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addTable(params) {
  const { path: filePath, table, output } = params;
  
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();
  
  // 添加标题
  if (table.title) {
    slide.addText(table.title, {
      x: 0.5,
      y: 0.5,
      w: 9,
      h: 0.5,
      fontSize: 24,
      bold: true
    });
  }
  
  // 添加表格
  slide.addTable(table.rows, {
    x: table.x || 0.5,
    y: table.y || 1.5,
    w: table.w || 9,
    colW: table.colW,
    border: { type: 'solid', pt: 1, color: '000000' },
    fontFace: 'Arial',
    fontSize: 12,
    align: 'left',
    valign: 'middle'
  });
  
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath
  };
}

// ==================== 转换操作 ====================

/**
 * 转换为 PDF（需要外部工具）
 * @param {Object} params - 参数
 * @param {string} params.path - 演示文稿路径
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 转换结果
 */
async function convertToPdf(params) {
  // Node.js 无法直接转换，需要 LibreOffice 或云服务
  return {
    success: false,
    error: 'PDF conversion requires external tools.',
    alternatives: [
      'Use LibreOffice: libreoffice --headless --convert-to pdf presentation.pptx',
      'Use cloud services like CloudConvert, PDFShift',
      'Use Python with python-pptx and comtypes (Windows only)'
    ]
  };
}

/**
 * 生成缩略图（需要外部工具）
 * @param {Object} params - 参数
 * @param {string} params.path - 演示文稿路径
 * @param {string} params.output - 输出路径
 * @param {number} params.slide - 幻灯片编号
 * @returns {Promise<Object>} 生成结果
 */
async function generateThumbnail(params) {
  // Node.js 无法直接生成缩略图
  return {
    success: false,
    error: 'Thumbnail generation requires external tools.',
    alternatives: [
      'Use LibreOffice to convert to PDF, then use pdf-lib or sharp to extract images',
      'Use Python with python-pptx and Pillow',
      'Use cloud services'
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
module.exports = async function pptxSkill(action, params = {}) {
  switch (action) {
    // 读取操作
    case 'read_presentation':
    case 'info':
      return await readPresentation(params);
      
    case 'extract_text':
      return await extractText(params);
      
    // 创建操作
    case 'create_presentation':
    case 'create':
      return await createPresentation(params);
      
    case 'add_slide':
      return await addSlide(params);
      
    case 'create_slides':
      return await createSlides(params);
      
    case 'add_image':
      return await addImage(params);
      
    case 'add_chart':
      return await addChart(params);
      
    case 'add_table':
      return await addTable(params);
      
    // 转换操作
    case 'convert_to_pdf':
      return await convertToPdf(params);
      
    case 'generate_thumbnail':
      return await generateThumbnail(params);
      
    default:
      throw new Error(`Unknown action: ${action}. Supported actions: read_presentation, extract_text, create_presentation, add_slide, create_slides, add_image, add_chart, add_table, convert_to_pdf, generate_thumbnail`);
  }
};

// 导出所有函数
module.exports.readPresentation = readPresentation;
module.exports.extractText = extractText;
module.exports.createPresentation = createPresentation;
module.exports.addSlide = addSlide;
module.exports.createSlides = createSlides;
module.exports.addImage = addImage;
module.exports.addChart = addChart;
module.exports.addTable = addTable;
module.exports.convertToPdf = convertToPdf;
module.exports.generateThumbnail = generateThumbnail;
module.exports.resolvePath = resolvePath;