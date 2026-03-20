/**
 * DOCX Skill - Word 文档处理技能 (Node.js 版本)
 * 
 * 功能：
 * - 读取 Word 文档（.docx）
 * - 创建新文档
 * - 编辑现有文档
 * - 提取文本和样式
 * - 插入图片
 * - 插入表格
 * - 插入图表（通过 chart 技能）
 * 
 * 依赖：
 * - docx: 创建和编辑文档
 * - mammoth: 读取文档内容
 * - adm-zip: 解压/压缩 docx 文件
 * - xml2js: 解析 XML
 */

const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun, BorderStyle } = require('docx');
const mammoth = require('mammoth');
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
 * 读取文档文本内容
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @returns {Promise<Object>} 读取结果
 */
async function readDocument(params) {
  const { path: filePath } = params;
  
  const result = await mammoth.extractRawText({ path: resolvePath(filePath) });
  
  return {
    success: true,
    text: result.value,
    messages: result.messages
  };
}

/**
 * 读取文档为 HTML
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @returns {Promise<Object>} 读取结果
 */
async function readAsHtml(params) {
  const { path: filePath } = params;
  
  const result = await mammoth.convertToHtml({ path: resolvePath(filePath) });
  
  return {
    success: true,
    html: result.value,
    messages: result.messages
  };
}

/**
 * 读取文档为 Markdown
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @returns {Promise<Object>} 读取结果
 */
async function readAsMarkdown(params) {
  const { path: filePath } = params;
  
  const result = await mammoth.convertToMarkdown({ path: resolvePath(filePath) });
  
  return {
    success: true,
    markdown: result.value,
    messages: result.messages
  };
}

/**
 * 提取文档样式信息
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @returns {Promise<Object>} 样式信息
 */
async function extractStyles(params) {
  const { path: filePath } = params;
  const resolvedPath = resolvePath(filePath);
  
  // 读取 docx 文件（实际上是 zip 文件）
  const zip = new AdmZip(resolvedPath);
  const zipEntries = zip.getEntries();
  
  // 查找 styles.xml
  const stylesEntry = zipEntries.find(entry => entry.entryName === 'word/styles.xml');
  
  if (!stylesEntry) {
    return {
      success: true,
      styles: [],
      message: 'No styles.xml found in document'
    };
  }
  
  const stylesXml = stylesEntry.getData().toString('utf8');
  
  // 解析 XML
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(stylesXml);
  
  const styles = [];
  const wStyles = result['w:styles'];
  if (wStyles && wStyles['w:style']) {
    for (const style of wStyles['w:style']) {
      styles.push({
        styleId: style.$ ? style.$['w:styleId'] : null,
        type: style.$ ? style.$['w:type'] : null,
        name: style['w:name'] && style['w:name'][0] ? style['w:name'][0].$['w:val'] : null
      });
    }
  }
  
  return {
    success: true,
    styles
  };
}

/**
 * 读取文档元数据
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @returns {Promise<Object>} 元数据
 */
async function readMetadata(params) {
  const { path: filePath } = params;
  const resolvedPath = resolvePath(filePath);
  
  const zip = new AdmZip(resolvedPath);
  const zipEntries = zip.getEntries();
  
  // 查找 document.xml
  const docEntry = zipEntries.find(entry => entry.entryName === 'word/document.xml');
  const corePropsEntry = zipEntries.find(entry => entry.entryName === 'docProps/core.xml');
  
  const metadata = {
    pageCount: null,
    wordCount: null,
    characterCount: null,
    creator: null,
    created: null,
    modified: null,
    lastModifiedBy: null
  };
  
  // 解析 core.xml
  if (corePropsEntry) {
    const coreXml = corePropsEntry.getData().toString('utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(coreXml);
    
    if (result['cp:coreProperties']) {
      const props = result['cp:coreProperties'];
      metadata.creator = props['dc:creator'] ? props['dc:creator'][0] : null;
      metadata.created = props['dcterms:created'] ? props['dcterms:created'][0] : null;
      metadata.modified = props['dcterms:modified'] ? props['dcterms:modified'][0] : null;
      metadata.lastModifiedBy = props['cp:lastModifiedBy'] ? props['cp:lastModifiedBy'][0] : null;
    }
  }
  
  // 统计段落数
  if (docEntry) {
    const docXml = docEntry.getData().toString('utf8');
    const paragraphCount = (docXml.match(/<w:p[^>]*>/g) || []).length;
    metadata.paragraphCount = paragraphCount;
  }
  
  return {
    success: true,
    metadata
  };
}

// ==================== 创建操作 ====================

/**
 * 创建新文档
 * @param {Object} params - 参数
 * @param {string} params.path - 输出路径
 * @param {string} params.title - 文档标题
 * @param {Array} params.content - 文档内容
 * @param {Object} params.properties - 文档属性
 * @returns {Promise<Object>} 创建结果
 */
async function createDocument(params) {
  const { path: filePath, title, content = [], properties = {} } = params;
  
  const children = [];
  
  // 添加标题
  if (title) {
    children.push(
      new Paragraph({
        text: title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER
      })
    );
  }
  
  // 添加内容
  for (const item of content) {
    if (typeof item === 'string') {
      // 简单文本段落
      children.push(new Paragraph({ text: item }));
    } else if (item.type === 'heading') {
      // 标题
      const headingLevel = item.level || 1;
      const headingMap = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6
      };
      children.push(
        new Paragraph({
          text: item.text,
          heading: headingMap[headingLevel] || HeadingLevel.HEADING_1
        })
      );
    } else if (item.type === 'paragraph') {
      // 段落
      const paragraphChildren = [];
      if (item.runs && Array.isArray(item.runs)) {
        for (const run of item.runs) {
          paragraphChildren.push(
            new TextRun({
              text: run.text || '',
              bold: run.bold,
              italics: run.italics,
              underline: run.underline ? {} : undefined,
              size: run.size,
              color: run.color
            })
          );
        }
      } else {
        paragraphChildren.push(new TextRun({ text: item.text || '' }));
      }
      children.push(
        new Paragraph({
          children: paragraphChildren,
          alignment: item.alignment
        })
      );
    } else if (item.type === 'table') {
      // 表格
      const tableRows = [];
      if (item.rows && Array.isArray(item.rows)) {
        for (const row of item.rows) {
          const cells = [];
          if (row.cells && Array.isArray(row.cells)) {
            for (const cell of row.cells) {
              cells.push(
                new TableCell({
                  children: [new Paragraph({ text: cell.text || cell || '' })],
                  width: cell.width ? { size: cell.width, type: WidthType.DXA } : undefined
                })
              );
            }
          }
          tableRows.push(new TableRow({ children: cells }));
        }
      }
      children.push(
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE }
        })
      );
    } else if (item.type === 'image') {
      // 图片（需要异步处理）
      // 这里先跳过，在后面单独处理
      children.push(
        new Paragraph({
          text: `[Image: ${item.path || 'embedded'}]`,
          alignment: AlignmentType.CENTER
        })
      );
    }
  }
  
  // 创建文档
  const doc = new Document({
    creator: properties.creator || 'Touwaka Mate',
    title: properties.title || title,
    subject: properties.subject,
    keywords: properties.keywords,
    sections: [
      {
        properties: {},
        children
      }
    ]
  });
  
  // 保存文档
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(resolvePath(filePath), buffer);
  
  return {
    success: true,
    path: resolvePath(filePath),
    paragraphCount: children.filter(c => c instanceof Paragraph).length
  };
}

/**
 * 添加段落
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @param {string|Object} params.paragraph - 段落内容
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addParagraph(params) {
  const { path: filePath, paragraph, output } = params;
  
  // 读取现有文档
  const existingBuffer = await fs.readFile(resolvePath(filePath));
  
  // 使用 mammoth 读取内容
  const textResult = await mammoth.extractRawText({ buffer: existingBuffer });
  
  // 创建新文档（简化处理：重新创建）
  const content = textResult.value.split('\n').filter(line => line.trim()).map(line => ({
    type: 'paragraph',
    text: line
  }));
  
  // 添加新段落
  if (typeof paragraph === 'string') {
    content.push({ type: 'paragraph', text: paragraph });
  } else {
    content.push(paragraph);
  }
  
  // 创建新文档
  const result = await createDocument({
    path: output || filePath,
    content
  });
  
  return {
    success: true,
    path: result.path
  };
}

/**
 * 添加表格
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @param {Object} params.table - 表格数据
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addTable(params) {
  const { path: filePath, table, output } = params;
  
  // 读取现有文档
  const existingBuffer = await fs.readFile(resolvePath(filePath));
  const textResult = await mammoth.extractRawText({ buffer: existingBuffer });
  
  // 创建内容
  const content = textResult.value.split('\n').filter(line => line.trim()).map(line => ({
    type: 'paragraph',
    text: line
  }));
  
  // 添加表格
  content.push({
    type: 'table',
    rows: table.rows || []
  });
  
  // 创建新文档
  const result = await createDocument({
    path: output || filePath,
    content
  });
  
  return {
    success: true,
    path: result.path
  };
}

/**
 * 添加图片
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @param {string} params.imagePath - 图片路径
 * @param {number} params.width - 图片宽度
 * @param {number} params.height - 图片高度
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addImage(params) {
  const { path: filePath, imagePath, width = 400, height = 300, output } = params;
  
  // 读取图片
  const imageBuffer = await fs.readFile(resolvePath(imagePath));
  
  // 读取现有文档
  const existingBuffer = await fs.readFile(resolvePath(filePath));
  const textResult = await mammoth.extractRawText({ buffer: existingBuffer });
  
  // 创建内容
  const content = textResult.value.split('\n').filter(line => line.trim()).map(line => ({
    type: 'paragraph',
    text: line
  }));
  
  // 创建文档
  const children = [];
  
  for (const item of content) {
    children.push(new Paragraph({ text: item.text }));
  }
  
  // 添加图片
  children.push(
    new Paragraph({
      children: [
        new ImageRun({
          data: imageBuffer,
          transformation: {
            width,
            height
          }
        })
      ],
      alignment: AlignmentType.CENTER
    })
  );
  
  const doc = new Document({
    sections: [
      {
        children
      }
    ]
  });
  
  const buffer = await Packer.toBuffer(doc);
  const outputPath = output ? resolvePath(output) : resolvePath(filePath);
  await fs.writeFile(outputPath, buffer);
  
  return {
    success: true,
    path: outputPath
  };
}

/**
 * 添加图表（通过 chart 技能）
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @param {Object} params.chart - 图表配置
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 添加结果
 */
async function addChart(params) {
  const { path: filePath, chart, output } = params;
  
  // 需要调用 chart 技能生成图片
  return {
    success: false,
    error: 'Chart insertion requires chart skill. Generate chart image first, then use addImage.',
    alternative: 'Use chart skill to generate image, then use addImage to insert.'
  };
}

// ==================== 编辑操作 ====================

/**
 * 替换文本
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @param {string} params.search - 搜索文本
 * @param {string} params.replace - 替换文本
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 替换结果
 */
async function replaceText(params) {
  const { path: filePath, search, replace, output } = params;
  
  // 读取文档
  const result = await mammoth.extractRawText({ path: resolvePath(filePath) });
  
  // 替换文本
  const newText = result.value.split(search).join(replace);
  const replaceCount = (result.value.match(new RegExp(search, 'g')) || []).length;
  
  // 创建新文档
  const content = newText.split('\n').map(line => ({
    type: 'paragraph',
    text: line
  }));
  
  await createDocument({
    path: output || filePath,
    content
  });
  
  return {
    success: true,
    path: resolvePath(output || filePath),
    replaceCount
  };
}

/**
 * 合并文档
 * @param {Object} params - 参数
 * @param {string[]} params.paths - 文档路径数组
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 合并结果
 */
async function mergeDocuments(params) {
  const { paths, output } = params;
  
  const allContent = [];
  
  for (const filePath of paths) {
    const result = await mammoth.extractRawText({ path: resolvePath(filePath) });
    const paragraphs = result.value.split('\n').filter(line => line.trim());
    
    for (const para of paragraphs) {
      allContent.push({ type: 'paragraph', text: para });
    }
    
    // 添加分隔符
    allContent.push({ type: 'paragraph', text: '' });
    allContent.push({ type: 'paragraph', text: '---' });
    allContent.push({ type: 'paragraph', text: '' });
  }
  
  await createDocument({
    path: output,
    content: allContent
  });
  
  return {
    success: true,
    path: resolvePath(output),
    documentCount: paths.length
  };
}

// ==================== 转换操作 ====================

/**
 * 转换为 PDF（需要外部工具）
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 转换结果
 */
async function convertToPdf(params) {
  // Node.js 无法直接转换，需要 LibreOffice 或云服务
  return {
    success: false,
    error: 'PDF conversion requires external tools.',
    alternatives: [
      'Use LibreOffice: libreoffice --headless --convert-to pdf document.docx',
      'Use cloud services like CloudConvert, PDFShift',
      'Use Python with python-docx2pdf'
    ]
  };
}

/**
 * 转换为 HTML
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 转换结果
 */
async function convertToHtml(params) {
  const { path: filePath, output } = params;
  
  const result = await mammoth.convertToHtml({ path: resolvePath(filePath) });
  
  // 添加 HTML 包装
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Converted Document</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ddd; padding: 8px; }
    img { max-width: 100%; }
  </style>
</head>
<body>
${result.value}
</body>
</html>`;
  
  if (output) {
    await fs.writeFile(resolvePath(output), html, 'utf-8');
  }
  
  return {
    success: true,
    html: result.value,
    path: output ? resolvePath(output) : null,
    messages: result.messages
  };
}

/**
 * 转换为 Markdown
 * @param {Object} params - 参数
 * @param {string} params.path - 文档路径
 * @param {string} params.output - 输出路径
 * @returns {Promise<Object>} 转换结果
 */
async function convertToMarkdown(params) {
  const { path: filePath, output } = params;
  
  const result = await mammoth.convertToMarkdown({ path: resolvePath(filePath) });
  
  if (output) {
    await fs.writeFile(resolvePath(output), result.value, 'utf-8');
  }
  
  return {
    success: true,
    markdown: result.value,
    path: output ? resolvePath(output) : null,
    messages: result.messages
  };
}

// ==================== 技能入口 ====================

/**
 * 技能入口函数
 * @param {string} action - 操作类型
 * @param {Object} params - 参数
 * @returns {Promise<Object>} 执行结果
 */
module.exports = async function docxSkill(action, params = {}) {
  switch (action) {
    // 读取操作
    case 'read_document':
    case 'read':
      return await readDocument(params);
      
    case 'read_as_html':
      return await readAsHtml(params);
      
    case 'read_as_markdown':
      return await readAsMarkdown(params);
      
    case 'extract_styles':
      return await extractStyles(params);
      
    case 'read_metadata':
      return await readMetadata(params);
      
    // 创建操作
    case 'create_document':
    case 'create':
      return await createDocument(params);
      
    case 'add_paragraph':
      return await addParagraph(params);
      
    case 'add_table':
      return await addTable(params);
      
    case 'add_image':
      return await addImage(params);
      
    case 'add_chart':
      return await addChart(params);
      
    // 编辑操作
    case 'replace_text':
      return await replaceText(params);
      
    case 'merge_documents':
    case 'merge':
      return await mergeDocuments(params);
      
    // 转换操作
    case 'convert_to_pdf':
      return await convertToPdf(params);
      
    case 'convert_to_html':
      return await convertToHtml(params);
      
    case 'convert_to_markdown':
      return await convertToMarkdown(params);
      
    default:
      throw new Error(`Unknown action: ${action}. Supported actions: read_document, read_as_html, read_as_markdown, extract_styles, read_metadata, create_document, add_paragraph, add_table, add_image, add_chart, replace_text, merge_documents, convert_to_pdf, convert_to_html, convert_to_markdown`);
  }
};

// 导出所有函数
module.exports.readDocument = readDocument;
module.exports.readAsHtml = readAsHtml;
module.exports.readAsMarkdown = readAsMarkdown;
module.exports.extractStyles = extractStyles;
module.exports.readMetadata = readMetadata;
module.exports.createDocument = createDocument;
module.exports.addParagraph = addParagraph;
module.exports.addTable = addTable;
module.exports.addImage = addImage;
module.exports.addChart = addChart;
module.exports.replaceText = replaceText;
module.exports.mergeDocuments = mergeDocuments;
module.exports.convertToPdf = convertToPdf;
module.exports.convertToHtml = convertToHtml;
module.exports.convertToMarkdown = convertToMarkdown;
module.exports.resolvePath = resolvePath;