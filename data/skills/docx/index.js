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

// ==================== docx_read ====================

/**
 * 读取 Word 文档
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.scope - 读取范围: 'info' | 'text' | 'paragraphs' | 'tables' | 'comments'
 * @param {boolean} [params.includeFormatting] - 是否包含格式（scope 为 text 时）
 * @param {boolean} [params.includeStyles] - 是否包含样式（scope 为 paragraphs 时）
 */
async function docxRead(params) {
  const { path: filePath, scope = 'info', includeFormatting = false, includeStyles = false } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  
  // 读取文档信息
  if (scope === 'info') {
    const result = await mammoth.extractRawText({ buffer });
    
    const zip = new AdmZip(filePath);
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
  
  // 提取文本
  if (scope === 'text') {
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
  
  // 提取段落
  if (scope === 'paragraphs') {
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
  
  // 提取表格
  if (scope === 'tables') {
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
  
  // 提取批注
  if (scope === 'comments') {
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
  
  throw new Error(`Invalid scope: ${scope}. Must be 'info', 'text', 'paragraphs', 'tables', or 'comments'`);
}

// ==================== docx_write ====================

/**
 * 写入 Word 文档
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.source - 数据来源: 'data' | 'markdown'
 * @param {string} [params.title] - 标题
 * @param {Array} [params.content] - 内容数据（source 为 data 时）
 * @param {string} [params.markdown] - Markdown 内容（source 为 markdown 时）
 * @param {object} [params.properties] - 文档属性
 */
async function docxWrite(params) {
  const { path: filePath, source = 'data', title, content = [], markdown, properties = {} } = params;
  
  const docx = getDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  
  const children = [];
  
  // 从数据创建
  if (source === 'data') {
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
  }
  
  // 从 Markdown 创建
  if (source === 'markdown') {
    if (!markdown) {
      throw new Error('markdown content is required when source is "markdown"');
    }
    
    const lines = markdown.split('\n');
    
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
          
          const textRuns = [];
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
  saveFile(filePath, buffer);
  
  return {
    success: true,
    path: resolvePath(filePath),
    paragraphCount: children.length
  };
}

// ==================== docx_edit ====================

/**
 * 编辑文档
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.action - 操作: 'add_paragraph' | 'replace_text' | 'add_table'
 * @param {string} [params.text] - 文本内容（add_paragraph 时）
 * @param {string} [params.search] - 搜索文本（replace_text 时）
 * @param {string} [params.replace] - 替换文本（replace_text 时）
 * @param {string} [params.position] - 位置（add_paragraph 时: 'start' | 'end' | 数字）
 * @param {string[]} [params.headers] - 表头（add_table 时）
 * @param {Array} [params.rows] - 表格行（add_table 时）
 * @param {string} [params.output] - 输出路径
 */
async function docxEdit(params) {
  const { path: filePath, action, text, search, replace, position, headers, rows, output } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  const result = await mammoth.extractRawText({ buffer });
  
  const paragraphs = result.value.split('\n').filter(p => p.trim());
  
  // 添加段落
  if (action === 'add_paragraph') {
    if (!text) {
      throw new Error('text is required for add_paragraph action');
    }
    
    if (position === 'start') {
      paragraphs.unshift(text);
    } else if (position === 'end' || !position) {
      paragraphs.push(text);
    } else if (typeof position === 'number') {
      paragraphs.splice(position, 0, text);
    }
    
    const outputPath = output || filePath;
    await docxWrite({
      path: outputPath,
      source: 'data',
      content: paragraphs.map(p => ({ type: 'paragraph', text: p }))
    });
    
    return {
      success: true,
      path: resolvePath(outputPath),
      addedText: text
    };
  }
  
  // 替换文本
  if (action === 'replace_text') {
    if (!search) {
      throw new Error('search is required for replace_text action');
    }
    
    const originalText = result.value;
    const newText = originalText.split(search).join(replace || '');
    
    const outputPath = output || filePath;
    await docxWrite({
      path: outputPath,
      source: 'data',
      content: newText.split('\n').filter(p => p.trim()).map(p => ({ type: 'paragraph', text: p }))
    });
    
    return {
      success: true,
      path: resolvePath(outputPath),
      replacements: (originalText.match(new RegExp(search, 'g')) || []).length
    };
  }
  
  // 添加表格
  if (action === 'add_table') {
    const docx = getDocx();
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel } = docx;
    
    const existingParagraphs = paragraphs;
    
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
    await docxWrite({ path: outputPath, source: 'data', content });
    
    return {
      success: true,
      path: resolvePath(outputPath),
      tableAdded: true
    };
  }
  
  throw new Error(`Invalid action: ${action}. Must be 'add_paragraph', 'replace_text', or 'add_table'`);
}

// ==================== docx_convert ====================

/**
 * 格式转换
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.format - 目标格式: 'markdown' | 'html'
 * @param {string} [params.output] - 输出文件路径
 * @param {boolean} [params.includeStyles] - 是否包含样式（format 为 html 时）
 */
async function docxConvert(params) {
  const { path: filePath, format, output, includeStyles = true } = params;
  
  const buffer = readFile(filePath);
  const mammoth = getMammoth();
  
  // 转换为 Markdown
  if (format === 'markdown') {
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
  
  // 转换为 HTML
  if (format === 'html') {
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
  
  throw new Error(`Invalid format: ${format}. Must be 'markdown' or 'html'`);
}

// ==================== docx_image ====================

/**
 * 图片操作
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.action - 操作: 'extract' | 'insert'
 * @param {string} [params.outputDir] - 输出目录（extract 时）
 * @param {string} [params.imagePath] - 图片路径（insert 时）
 * @param {number} [params.width] - 图片宽度（insert 时）
 * @param {number} [params.height] - 图片高度（insert 时）
 * @param {string} [params.output] - 输出路径（insert 时）
 */
async function docxImage(params) {
  const { path: filePath, action, outputDir, imagePath, width = 400, height = 300, output } = params;
  
  // 提取图片
  if (action === 'extract') {
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
  
  // 插入图片
  if (action === 'insert') {
    const docx = getDocx();
    const { Document, Packer, Paragraph, ImageRun } = docx;
    
    const imageBuffer = readFile(imagePath);
    
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
  
  throw new Error(`Invalid action: ${action}. Must be 'extract' or 'insert'`);
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
    case 'docx_read':
      return await docxRead(params);
      
    case 'docx_write':
      return await docxWrite(params);
      
    case 'docx_edit':
      return await docxEdit(params);
      
    case 'docx_convert':
      return await docxConvert(params);
      
    case 'docx_image':
      return await docxImage(params);
      
    // 兼容旧工具名
    case 'read_document':
    case 'read':
      return await docxRead({ ...params, scope: 'info' });
      
    case 'extract_text':
      return await docxRead({ ...params, scope: 'text' });
      
    case 'extract_paragraphs':
      return await docxRead({ ...params, scope: 'paragraphs' });
      
    case 'extract_tables':
      return await docxRead({ ...params, scope: 'tables' });
      
    case 'extract_comments':
      return await docxRead({ ...params, scope: 'comments' });
      
    case 'create_document':
    case 'create':
      return await docxWrite({ ...params, source: 'data' });
      
    case 'from_markdown':
      return await docxWrite({ ...params, source: 'markdown' });
      
    case 'add_paragraph':
      return await docxEdit({ ...params, action: 'add_paragraph' });
      
    case 'replace_text':
      return await docxEdit({ ...params, action: 'replace_text' });
      
    case 'add_table':
      return await docxEdit({ ...params, action: 'add_table' });
      
    case 'to_markdown':
      return await docxConvert({ ...params, format: 'markdown' });
      
    case 'to_html':
      return await docxConvert({ ...params, format: 'html' });
      
    case 'extract_images':
      return await docxImage({ ...params, action: 'extract' });
      
    case 'insert_image':
      return await docxImage({ ...params, action: 'insert' });
      
    default:
      throw new Error(`Unknown tool: ${toolName}. Supported tools: docx_read, docx_write, docx_edit, docx_convert, docx_image`);
  }
}

module.exports = { execute };