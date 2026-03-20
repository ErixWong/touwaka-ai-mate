/**
 * DOCX Skill - Word 文档处理技能 (Node.js 版本)
 * 
 * 功能：
 * - 读取 Word 文档内容和元数据
 * - 创建新文档
 * - 编辑文档内容
 * - 段落和文本格式化
 * - 表格操作
 * - 图片插入
 * - 页眉页脚
 * - 批注和修订
 * - 文档转换（Markdown、HTML）
 * 
 * 依赖：
 * - docx: 文档创建和编辑
 * - mammoth: 文档读取和转换
 * - adm-zip: ZIP 操作（项目已安装）
 * - xml2js: XML 解析
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// 延迟加载可选依赖
let docxLib = null;
let mammothLib = null;
let xml2js = null;

function getDocx() {
  if (!docxLib) {
    docxLib = require('docx');
  }
  return docxLib;
}

function getMammoth() {
  if (!mammothLib) {
    mammothLib = require('mammoth');
  }
  return mammothLib;
}

function getXml2js() {
  if (!xml2js) {
    xml2js = require('xml2js');
  }
  return xml2js;
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
 * 读取文档信息
 */
async function readDocument(params) {
  const { path: filePath } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  
  const result = await mammoth.extractRawText({ buffer });
  
  const zip = new AdmZip(filePath);
  const docXml = zip.readAsText('word/document.xml');
  const coreXml = zip.readAsText('docProps/core.xml');
  
  const metadata = {};
  
  if (coreXml) {
    const parser = getXml2js().Parser();
    const coreProps = await parser.parseStringPromise(coreXml);
    
    if (coreProps['cp:coreProperties']) {
      const props = coreProps['cp:coreProperties'];
      metadata.title = props['dc:title']?.[0] || null;
      metadata.author = props['dc:creator']?.[0] || null;
      metadata.subject = props['dc:subject']?.[0] || null;
      metadata.keywords = props['cp:keywords']?.[0] || null;
      metadata.created = props['dcterms:created']?.[0] || null;
      metadata.modified = props['dcterms:modified']?.[0] || null;
    }
  }
  
  const paragraphs = result.value.split('\n').filter(p => p.trim());
  
  return {
    success: true,
    metadata,
    paragraphCount: paragraphs.length,
    characterCount: result.value.length,
    wordCount: result.value.split(/\s+/).filter(w => w).length
  };
}

/**
 * 提取文本内容
 */
async function extractText(params) {
  const { path: filePath, includeFormatting = false } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  
  if (includeFormatting) {
    const result = await mammoth.convertToHtml({ buffer });
    return {
      success: true,
      text: result.value,
      format: 'html',
      messages: result.messages
    };
  } else {
    const result = await mammoth.extractRawText({ buffer });
    return {
      success: true,
      text: result.value,
      format: 'plain',
      messages: result.messages
    };
  }
}

/**
 * 提取段落
 */
async function extractParagraphs(params) {
  const { path: filePath, includeStyles = false } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  
  const result = await mammoth.extractRawText({ buffer });
  const paragraphs = result.value.split('\n').filter(p => p.trim());
  
  if (includeStyles) {
    const zip = new AdmZip(filePath);
    const docXml = zip.readAsText('word/document.xml');
    
    return {
      success: true,
      paragraphs: paragraphs.map((text, index) => ({
        index: index + 1,
        text,
        style: 'Normal'
      }))
    };
  }
  
  return {
    success: true,
    paragraphs: paragraphs.map((text, index) => ({
      index: index + 1,
      text
    }))
  };
}

// ==================== 创建操作 ====================

/**
 * 创建新文档
 */
async function createDocument(params) {
  const {
    output,
    title = '',
    content = [],
    properties = {}
  } = params;
  
  const docx = getDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  
  const children = [];
  
  if (title) {
    children.push(new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1
    }));
    children.push(new Paragraph({ text: '' }));
  }
  
  for (const item of content) {
    if (typeof item === 'string') {
      children.push(new Paragraph({ text: item }));
    } else if (item.type === 'heading') {
      const level = item.level || 1;
      const headingMap = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6
      };
      children.push(new Paragraph({
        text: item.text,
        heading: headingMap[level] || HeadingLevel.HEADING_1
      }));
    } else if (item.type === 'paragraph') {
      const textRuns = [];
      if (item.runs && Array.isArray(item.runs)) {
        for (const run of item.runs) {
          textRuns.push(new TextRun({
            text: run.text || '',
            bold: run.bold,
            italics: run.italics,
            underline: run.underline ? {} : undefined,
            size: run.size,
            color: run.color
          }));
        }
      } else {
        textRuns.push(new TextRun({ text: item.text || '' }));
      }
      children.push(new Paragraph({ children: textRuns }));
    } else if (item.type === 'table') {
      const tableRows = [];
      if (item.headers) {
        tableRows.push(new docx.TableRow({
          children: item.headers.map(h => new docx.TableCell({
            children: [new Paragraph({ text: h })]
          }))
        }));
      }
      if (item.rows) {
        for (const row of item.rows) {
          tableRows.push(new docx.TableRow({
            children: row.map(cell => new docx.TableCell({
              children: [new Paragraph({ text: String(cell) })]
            }))
          }));
        }
      }
      children.push(new docx.Table({
        rows: tableRows
      }));
    } else if (item.type === 'list') {
      const listItems = item.items || [];
      for (const listItem of listItems) {
        children.push(new Paragraph({
          text: listItem,
          bullet: item.ordered ? { level: 0 } : { level: 0 }
        }));
      }
    }
  }
  
  const doc = new Document({
    creator: properties.author || 'Touwaka Mate',
    title: properties.title || title,
    subject: properties.subject,
    keywords: properties.keywords,
    sections: [{
      properties: {},
      children
    }]
  });
  
  const buffer = await Packer.toBuffer(doc);
  saveFile(output, buffer);
  
  return {
    success: true,
    path: resolvePath(output),
    paragraphCount: children.length
  };
}

/**
 * 从 Markdown 创建文档
 */
async function fromMarkdown(params) {
  const { markdown, output, properties = {} } = params;
  
  if (!markdown) {
    throw new Error('markdown content is required');
  }
  
  const docx = getDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  
  const lines = markdown.split('\n');
  const children = [];
  
  for (const line of lines) {
    if (line.startsWith('# ')) {
      children.push(new Paragraph({
        text: line.substring(2),
        heading: HeadingLevel.HEADING_1
      }));
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({
        text: line.substring(3),
        heading: HeadingLevel.HEADING_2
      }));
    } else if (line.startsWith('### ')) {
      children.push(new Paragraph({
        text: line.substring(4),
        heading: HeadingLevel.HEADING_3
      }));
    } else if (line.startsWith('#### ')) {
      children.push(new Paragraph({
        text: line.substring(5),
        heading: HeadingLevel.HEADING_4
      }));
    } else if (line.startsWith('##### ')) {
      children.push(new Paragraph({
        text: line.substring(6),
        heading: HeadingLevel.HEADING_5
      }));
    } else if (line.startsWith('###### ')) {
      children.push(new Paragraph({
        text: line.substring(7),
        heading: HeadingLevel.HEADING_6
      }));
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      children.push(new Paragraph({
        text: line.substring(2),
        bullet: { level: 0 }
      }));
    } else if (/^\d+\. /.test(line)) {
      children.push(new Paragraph({
        text: line.replace(/^\d+\. /, ''),
        bullet: { level: 0 }
      }));
    } else if (line.trim() === '') {
      children.push(new Paragraph({ text: '' }));
    } else {
      const boldRegex = /\*\*(.+?)\*\*/g;
      const italicRegex = /\*(.+?)\*/g;
      
      let processedLine = line;
      const textRuns = [];
      let lastIndex = 0;
      
      const matches = [];
      let match;
      
      while ((match = boldRegex.exec(line)) !== null) {
        matches.push({ start: match.index, end: match.index + match[0].length, text: match[1], bold: true });
      }
      
      while ((match = italicRegex.exec(line)) !== null) {
        matches.push({ start: match.index, end: match.index + match[0].length, text: match[1], italics: true });
      }
      
      if (matches.length === 0) {
        children.push(new Paragraph({ text: line }));
      } else {
        matches.sort((a, b) => a.start - b.start);
        
        let currentPos = 0;
        for (const m of matches) {
          if (m.start > currentPos) {
            textRuns.push(new TextRun({ text: line.substring(currentPos, m.start) }));
          }
          textRuns.push(new TextRun({
            text: m.text,
            bold: m.bold,
            italics: m.italics
          }));
          currentPos = m.end;
        }
        
        if (currentPos < line.length) {
          textRuns.push(new TextRun({ text: line.substring(currentPos) }));
        }
        
        children.push(new Paragraph({ children: textRuns }));
      }
    }
  }
  
  const doc = new Document({
    creator: properties.author || 'Touwaka Mate',
    title: properties.title,
    sections: [{
      children
    }]
  });
  
  const buffer = await Packer.toBuffer(doc);
  saveFile(output, buffer);
  
  return {
    success: true,
    path: resolvePath(output),
    paragraphCount: children.length
  };
}

// ==================== 编辑操作 ====================

/**
 * 添加段落
 */
async function addParagraph(params) {
  const { path: filePath, text, style, position, output } = params;
  
  const docx = getDocx();
  const { Document, Packer, Paragraph, TextRun } = docx;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  const result = await mammoth.extractRawText({ buffer });
  
  const paragraphs = result.value.split('\n');
  
  const newParagraph = text;
  
  if (position === 'start') {
    paragraphs.unshift(newParagraph);
  } else if (position === 'end' || !position) {
    paragraphs.push(newParagraph);
  } else if (typeof position === 'number') {
    paragraphs.splice(position, 0, newParagraph);
  }
  
  const outputPath = output || filePath;
  await createDocument({
    output: outputPath,
    content: paragraphs.filter(p => p.trim()).map(p => ({ type: 'paragraph', text: p }))
  });
  
  return {
    success: true,
    path: resolvePath(outputPath),
    addedText: text
  };
}

/**
 * 替换文本
 */
async function replaceText(params) {
  const { path: filePath, search, replace, output } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  const result = await mammoth.extractRawText({ buffer });
  
  const originalText = result.value;
  const newText = originalText.split(search).join(replace);
  
  const outputPath = output || filePath;
  await createDocument({
    output: outputPath,
    content: newText.split('\n').filter(p => p.trim()).map(p => ({ type: 'paragraph', text: p }))
  });
  
  return {
    success: true,
    path: resolvePath(outputPath),
    replacements: (originalText.match(new RegExp(search, 'g')) || []).length
  };
}

/**
 * 添加表格
 */
async function addTable(params) {
  const { path: filePath, headers, rows, position, output } = params;
  
  const docx = getDocx();
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel } = docx;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  const result = await mammoth.extractRawText({ buffer });
  
  const existingParagraphs = result.value.split('\n').filter(p => p.trim());
  
  const tableContent = {
    type: 'table',
    headers: headers || [],
    rows: rows || []
  };
  
  const content = [];
  for (let i = 0; i < existingParagraphs.length; i++) {
    content.push({ type: 'paragraph', text: existingParagraphs[i] });
    if (position !== undefined && i === position - 1) {
      content.push(tableContent);
    }
  }
  
  if (position === undefined || position >= existingParagraphs.length) {
    content.push(tableContent);
  }
  
  const outputPath = output || filePath;
  await createDocument({ output: outputPath, content });
  
  return {
    success: true,
    path: resolvePath(outputPath),
    tableAdded: true
  };
}

// ==================== 表格操作 ====================

/**
 * 提取表格
 */
async function extractTables(params) {
  const { path: filePath } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;
  
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  
  const tables = [];
  let tableMatch;
  
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    const rows = [];
    let rowMatch;
    
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cells = [];
      let cellMatch;
      
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const cellText = cellMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&/g, '&')
          .replace(/</g, '<')
          .replace(/>/g, '>')
          .trim();
        cells.push(cellText);
      }
      
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
    
    if (rows.length > 0) {
      tables.push(rows);
    }
  }
  
  return {
    success: true,
    tableCount: tables.length,
    tables
  };
}

// ==================== 转换操作 ====================

/**
 * 转换为 Markdown
 */
async function toMarkdown(params) {
  const { path: filePath, output } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;
  
  let markdown = html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  if (output) {
    const resolvedPath = resolvePath(output);
    fs.writeFileSync(resolvedPath, markdown, 'utf-8');
    return { success: true, path: resolvedPath, markdown };
  }
  
  return {
    success: true,
    markdown
  };
}

/**
 * 转换为 HTML
 */
async function toHtml(params) {
  const { path: filePath, output, includeStyles = true } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  
  const options = includeStyles
    ? { buffer, styleMap: 'p[style-name="Heading 1"] => h1:fresh' }
    : { buffer };
  
  const result = await mammoth.convertToHtml(options);
  
  let html = result.value;
  
  if (includeStyles) {
    html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #ddd; padding: 8px; }
th { background-color: #f2f2f2; }
</style>
</head>
<body>
${html}
</body>
</html>`;
  }
  
  if (output) {
    const resolvedPath = resolvePath(output);
    fs.writeFileSync(resolvedPath, html, 'utf-8');
    return { success: true, path: resolvedPath };
  }
  
  return {
    success: true,
    html,
    messages: result.messages
  };
}

// ==================== 批注操作 ====================

/**
 * 提取批注
 */
async function extractComments(params) {
  const { path: filePath } = params;
  
  const zip = new AdmZip(filePath);
  
  let commentsXml;
  try {
    commentsXml = zip.readAsText('word/comments.xml');
  } catch (e) {
    return {
      success: true,
      commentCount: 0,
      comments: []
    };
  }
  
  if (!commentsXml) {
    return {
      success: true,
      commentCount: 0,
      comments: []
    };
  }
  
  const parser = getXml2js().Parser();
  const commentsObj = await parser.parseStringPromise(commentsXml);
  
  const comments = [];
  if (commentsObj['w:comments'] && commentsObj['w:comments']['w:comment']) {
    for (const comment of commentsObj['w:comments']['w:comment']) {
      const attrs = comment.$ || {};
      const author = attrs['w:author'] || 'Unknown';
      const date = attrs['w:date'] || null;
      const id = attrs['w:id'] || null;
      
      let text = '';
      if (comment['w:p']) {
        for (const p of comment['w:p']) {
          if (p['w:r']) {
            for (const r of p['w:r']) {
              if (r['w:t']) {
                text += r['w:t'].join('');
              }
            }
          }
        }
      }
      
      comments.push({
        id,
        author,
        date,
        text
      });
    }
  }
  
  return {
    success: true,
    commentCount: comments.length,
    comments
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
    
    if (entryName.startsWith('word/media/') && imageExtensions.includes(ext)) {
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
 * 插入图片
 */
async function insertImage(params) {
  const { path: filePath, imagePath, output, width = 400, height = 300 } = params;
  
  const docx = getDocx();
  const { Document, Packer, Paragraph, ImageRun } = docx;
  
  const imageBuffer = readFile(imagePath);
  const imageExt = path.extname(imagePath).toLowerCase();
  
  const docBuffer = readFile(filePath);
  const mammoth = getMammoth();
  const result = await mammoth.extractRawText({ buffer: docBuffer });
  
  const existingParagraphs = result.value.split('\n').filter(p => p.trim());
  
  const children = [];
  for (const p of existingParagraphs) {
    children.push(new Paragraph({ text: p }));
  }
  
  children.push(new Paragraph({
    children: [
      new ImageRun({
        data: imageBuffer,
        transformation: { width, height }
      })
    ]
  }));
  
  const doc = new Document({
    sections: [{
      children
    }]
  });
  
  const outputPath = output || filePath;
  const buffer = await Packer.toBuffer(doc);
  saveFile(outputPath, buffer);
  
  return {
    success: true,
    path: resolvePath(outputPath),
    imageInserted: true
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
    case 'read_document':
    case 'read':
      return await readDocument(params);
      
    case 'extract_text':
      return await extractText(params);
      
    case 'extract_paragraphs':
      return await extractParagraphs(params);
      
    // 创建操作
    case 'create_document':
    case 'create':
      return await createDocument(params);
      
    case 'from_markdown':
      return await fromMarkdown(params);
      
    // 编辑操作
    case 'add_paragraph':
      return await addParagraph(params);
      
    case 'replace_text':
      return await replaceText(params);
      
    case 'add_table':
      return await addTable(params);
      
    // 表格操作
    case 'extract_tables':
      return await extractTables(params);
      
    // 转换操作
    case 'to_markdown':
      return await toMarkdown(params);
      
    case 'to_html':
      return await toHtml(params);
      
    // 批注操作
    case 'extract_comments':
      return await extractComments(params);
      
    // 图片操作
    case 'extract_images':
      return await extractImages(params);
      
    case 'insert_image':
      return await insertImage(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}. Supported tools: read_document, extract_text, extract_paragraphs, create_document, from_markdown, add_paragraph, replace_text, add_table, extract_tables, to_markdown, to_html, extract_comments, extract_images, insert_image`);
  }
}

module.exports = { execute };