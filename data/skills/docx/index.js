/**
 * DOCX Skill - Word 文档处理技能 (重构版本)
 * 
 * 功能：
 * - 读取 Word 文档内容和元数据
 * - 创建新文档（支持页眉页脚、分节）
 * - 模板填充（Patcher API，保留原文档样式）
 * - 编辑文档内容（使用 Patcher 保留格式）
 * - 段落和文本格式化
 * - 表格操作
 * - 图片插入
 * - 文档转换（Markdown、HTML）
 * - 超链接支持
 * - 目录生成
 * 
 * 依赖：
 * - docx v9: 文档创建、编辑和 Patcher API
 * - mammoth: 文档读取和转换
 * - adm-zip: ZIP 操作
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
 * @param {string} params.scope - 读取范围: 'info' | 'text' | 'paragraphs' | 'tables' | 'comments' | 'images' | 'headers' | 'footers'
 * @param {boolean} [params.includeFormatting] - 是否包含格式（scope 为 text 时）
 * @param {boolean} [params.includeStyles] - 是否包含样式（scope 为 paragraphs 时）
 */
async function docxRead(params) {
  const { path: filePath, scope = 'info', includeFormatting = false, includeStyles = false } = params;
  
  const resolvedPath = resolvePath(filePath);
  const buffer = fs.readFileSync(resolvedPath);
  const mammoth = getMammoth();
  
  // 读取文档信息
  if (scope === 'info') {
    const result = await mammoth.extractRawText({ buffer });
    
    const zip = new AdmZip(resolvedPath);
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
    
    // 检查是否有页眉页脚
    const entries = zip.getEntries();
    const hasHeader = entries.some(e => e.entryName.startsWith('word/header'));
    const hasFooter = entries.some(e => e.entryName.startsWith('word/footer'));
    
    const paragraphs = result.value.split('\n').filter(p => p.trim());
    
    return {
      success: true,
      metadata,
      paragraphCount: paragraphs.length,
      characterCount: result.value.length,
      wordCount: result.value.split(/\s+/).filter(w => w).length,
      hasHeader,
      hasFooter
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
      const zip = new AdmZip(resolvedPath);
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
    const zip = new AdmZip(resolvedPath);
    
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
  
  // 提取图片信息
  if (scope === 'images') {
    const zip = new AdmZip(resolvedPath);
    const entries = zip.getEntries();
    
    const images = [];
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.emf', '.wmf', '.svg'];
    
    for (const entry of entries) {
      const entryName = entry.entryName;
      const ext = path.extname(entryName).toLowerCase();
      
      if (entryName.startsWith('word/media/') && imageExtensions.includes(ext)) {
        images.push({
          path: entryName,
          fileName: path.basename(entryName),
          extension: ext,
          size: entry.getData().length
        });
      }
    }
    
    return {
      success: true,
      imageCount: images.length,
      images
    };
  }
  
  // 提取页眉内容
  if (scope === 'headers') {
    const zip = new AdmZip(resolvedPath);
    const entries = zip.getEntries();
    
    const headers = [];
    for (const entry of entries) {
      if (entry.entryName.startsWith('word/header') && entry.entryName.endsWith('.xml')) {
        const headerXml = zip.readAsText(entry.entryName);
        // 简化提取文本
        const textMatch = headerXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
        const text = textMatch ? textMatch.map(m => m.replace(/<[^>]+>/g, '')).join('') : '';
        headers.push({
          file: entry.entryName,
          text
        });
      }
    }
    
    return {
      success: true,
      headerCount: headers.length,
      headers
    };
  }
  
  // 提取页脚内容
  if (scope === 'footers') {
    const zip = new AdmZip(resolvedPath);
    const entries = zip.getEntries();
    
    const footers = [];
    for (const entry of entries) {
      if (entry.entryName.startsWith('word/footer') && entry.entryName.endsWith('.xml')) {
        const footerXml = zip.readAsText(entry.entryName);
        // 简化提取文本
        const textMatch = footerXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
        const text = textMatch ? textMatch.map(m => m.replace(/<[^>]+>/g, '')).join('') : '';
        footers.push({
          file: entry.entryName,
          text
        });
      }
    }
    
    return {
      success: true,
      footerCount: footers.length,
      footers
    };
  }
  
  throw new Error(`Invalid scope: ${scope}. Must be 'info', 'text', 'paragraphs', 'tables', 'comments', 'images', 'headers', or 'footers'`);
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
 * @param {object} [params.header] - 页眉配置
 * @param {object} [params.footer] - 页脚配置
 * @param {Array} [params.sections] - 多节配置
 */
async function docxWrite(params) {
  const { 
    path: filePath, 
    source = 'data', 
    title, 
    content = [], 
    markdown, 
    properties = {},
    header,
    footer,
    sections
  } = params;
  
  const docx = getDocx();
  const { 
    Document, 
    Packer, 
    Paragraph, 
    TextRun, 
    HeadingLevel,
    Header,
    Footer,
    PageNumber,
    Table,
    TableRow,
    TableCell,
    AlignmentType,
    BorderStyle
  } = docx;
  
  // 构建节配置
  const buildSection = (sectionContent, sectionConfig = {}) => {
    const children = [];
    
    // 从数据创建
    if (source === 'data' || sectionContent) {
      const items = sectionContent || content;
      
      if (title && !sectionConfig.noTitle) {
        children.push(new Paragraph({
          text: title,
          heading: HeadingLevel.HEADING_1
        }));
        children.push(new Paragraph({ text: '' }));
      }
      
      for (const item of items) {
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
                color: run.color,
                font: run.font
              }));
            }
          } else {
            textRuns.push(new TextRun({ text: item.text || '' }));
          }
          children.push(new Paragraph({ 
            children: textRuns,
            alignment: item.alignment ? AlignmentType[item.alignment] : undefined
          }));
        } else if (item.type === 'table') {
          const tableRows = [];
          if (item.headers) {
            tableRows.push(new TableRow({
              children: item.headers.map(h => new TableCell({
                children: [new Paragraph({ 
                  text: h,
                  alignment: AlignmentType.CENTER
                })],
                shading: item.headerShading ? { fill: item.headerShading } : undefined
              }))
            }));
          }
          if (item.rows) {
            for (const row of item.rows) {
              tableRows.push(new TableRow({
                children: row.map(cell => new TableCell({
                  children: [new Paragraph({ text: String(cell) })]
                }))
              }));
            }
          }
          children.push(new Table({
            rows: tableRows,
            width: item.width ? { size: item.width, type: 'pct' } : undefined
          }));
        } else if (item.type === 'list') {
          const listItems = item.items || [];
          for (const listItem of listItems) {
            children.push(new Paragraph({
              text: listItem,
              bullet: { level: item.level || 0 }
            }));
          }
        } else if (item.type === 'image') {
          // 图片将在后面处理
          children.push(new Paragraph({
            text: `[Image: ${item.path || 'embedded'}]`
          }));
        }
      }
    }
    
    // 从 Markdown 创建
    if (source === 'markdown' && markdown) {
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
    
    return children;
  };
  
  // 构建页眉
  const buildHeader = (headerConfig) => {
    if (!headerConfig) return undefined;
    
    const headerChildren = [];
    if (headerConfig.text) {
      headerChildren.push(new Paragraph({
        text: headerConfig.text,
        alignment: headerConfig.alignment ? AlignmentType[headerConfig.alignment] : AlignmentType.CENTER
      }));
    }
    
    return new Header({
      children: headerChildren
    });
  };
  
  // 构建页脚
  const buildFooter = (footerConfig) => {
    if (!footerConfig) return undefined;
    
    const footerChildren = [];
    if (footerConfig.text) {
      footerChildren.push(new Paragraph({
        text: footerConfig.text,
        alignment: footerConfig.alignment ? AlignmentType[footerConfig.alignment] : AlignmentType.CENTER
      }));
    }
    
    if (footerConfig.pageNumber) {
      footerChildren.push(new Paragraph({
        alignment: footerConfig.pageAlignment ? AlignmentType[footerConfig.pageAlignment] : AlignmentType.CENTER,
        children: [
          new TextRun({ text: footerConfig.pagePrefix || 'Page ' }),
          new TextRun({ children: [PageNumber.CURRENT] }),
          new TextRun({ text: footerConfig.pageSuffix || '' })
        ]
      }));
    }
    
    return new Footer({
      children: footerChildren
    });
  };
  
  // 构建文档节
  const documentSections = [];
  
  if (sections && Array.isArray(sections)) {
    // 多节文档
    for (const section of sections) {
      documentSections.push({
        properties: section.properties || {},
        headers: section.header ? { default: buildHeader(section.header) } : (header ? { default: buildHeader(header) } : undefined),
        footers: section.footer ? { default: buildFooter(section.footer) } : (footer ? { default: buildFooter(footer) } : undefined),
        children: buildSection(section.content, section)
      });
    }
  } else {
    // 单节文档
    documentSections.push({
      properties: {},
      headers: header ? { default: buildHeader(header) } : undefined,
      footers: footer ? { default: buildFooter(footer) } : undefined,
      children: buildSection()
    });
  }
  
  const doc = new Document({
    creator: properties.author || 'Touwaka Mate',
    title: properties.title || title,
    subject: properties.subject,
    keywords: properties.keywords,
    sections: documentSections
  });
  
  const buffer = await Packer.toBuffer(doc);
  saveFile(filePath, buffer);
  
  return {
    success: true,
    path: resolvePath(filePath),
    paragraphCount: documentSections.reduce((sum, s) => sum + s.children.length, 0),
    sectionCount: documentSections.length,
    hasHeader: !!header || (sections && sections.some(s => s.header)),
    hasFooter: !!footer || (sections && sections.some(s => s.footer))
  };
}

// ==================== docx_patch ====================

/**
 * 模板填充 - 使用 Patcher API 保留原文档样式
 * @param {object} params
 * @param {string} params.path - 模板文件路径
 * @param {object} params.patches - 替换数据 { placeholder: value }
 * @param {string} [params.output] - 输出文件路径
 * @param {boolean} [params.keepOriginalStyles] - 是否保留原文档样式（默认 true）
 * @param {object} [params.delimiters] - 占位符分隔符 { start: '{{', end: '}}' }
 */
async function docxPatch(params) {
  const { 
    path: filePath, 
    patches, 
    output, 
    keepOriginalStyles = true,
    delimiters = { start: '{{', end: '}}' }
  } = params;
  
  if (!patches || typeof patches !== 'object') {
    throw new Error('patches is required and must be an object');
  }
  
  const docx = getDocx();
  const { patchDocument, PatchType, TextRun, Paragraph } = docx;
  
  const buffer = readFile(filePath);
  
  // 构建 patch 对象
  const patchObject = {};
  for (const [key, value] of Object.entries(patches)) {
    if (typeof value === 'string' || typeof value === 'number') {
      // 简单文本替换
      patchObject[key] = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: String(value) })]
      };
    } else if (value.type === 'paragraph') {
      // 段落替换
      patchObject[key] = {
        type: PatchType.PARAGRAPH,
        children: value.children || [new TextRun({ text: value.text || '' })]
      };
    } else if (value.type === 'document') {
      // 文档级替换
      patchObject[key] = {
        type: PatchType.DOCUMENT,
        children: value.children || []
      };
    } else if (Array.isArray(value)) {
      // 数组替换（多个段落）
      patchObject[key] = {
        type: PatchType.PARAGRAPH,
        children: value.map(v => new TextRun({ text: String(v) }))
      };
    } else {
      // 对象替换
      patchObject[key] = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: JSON.stringify(value) })]
      };
    }
  }
  
  const resultBuffer = await patchDocument({
    outputType: 'buffer',
    data: buffer,
    patches: patchObject,
    keepOriginalStyles,
    placeholderDelimiters: delimiters
  });
  
  const outputPath = output || filePath;
  saveFile(outputPath, resultBuffer);
  
  return {
    success: true,
    path: resolvePath(outputPath),
    patchCount: Object.keys(patches).length,
    placeholders: Object.keys(patches)
  };
}

// ==================== docx_edit ====================

/**
 * 编辑文档 - 使用 Patcher API 保留格式
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.action - 操作: 'replace' | 'append' | 'insert' | 'delete'
 * @param {object} [params.replacements] - 替换数据（action 为 replace 时）
 * @param {string} [params.text] - 文本内容（action 为 append/insert 时）
 * @param {number} [params.position] - 位置（action 为 insert 时）
 * @param {string} [params.placeholder] - 占位符（action 为 insert/delete 时）
 * @param {string} [params.output] - 输出路径
 */
async function docxEdit(params) {
  const { 
    path: filePath, 
    action, 
    replacements,
    text,
    position,
    placeholder,
    output
  } = params;
  
  const docx = getDocx();
  const { patchDocument, PatchType, TextRun, Paragraph } = docx;
  
  // 替换操作 - 使用 Patcher
  if (action === 'replace') {
    if (!replacements || typeof replacements !== 'object') {
      throw new Error('replacements is required for replace action');
    }
    
    const buffer = readFile(filePath);
    
    const patchObject = {};
    for (const [key, value] of Object.entries(replacements)) {
      patchObject[key] = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: String(value) })]
      };
    }
    
    const resultBuffer = await patchDocument({
      outputType: 'buffer',
      data: buffer,
      patches: patchObject,
      keepOriginalStyles: true
    });
    
    const outputPath = output || filePath;
    saveFile(outputPath, resultBuffer);
    
    return {
      success: true,
      path: resolvePath(outputPath),
      replacements: Object.keys(replacements)
    };
  }
  
  // 添加/插入操作 - 需要有占位符
  if (action === 'append' || action === 'insert') {
    if (!text) {
      throw new Error('text is required for append/insert action');
    }
    
    // 如果有占位符，使用 Patcher
    if (placeholder) {
      const buffer = readFile(filePath);
      
      const patchObject = {
        [placeholder]: {
          type: PatchType.PARAGRAPH,
          children: [new TextRun({ text: text })]
        }
      };
      
      const resultBuffer = await patchDocument({
        outputType: 'buffer',
        data: buffer,
        patches: patchObject,
        keepOriginalStyles: true
      });
      
      const outputPath = output || filePath;
      saveFile(outputPath, resultBuffer);
      
      return {
        success: true,
        path: resolvePath(outputPath),
        insertedAt: placeholder
      };
    }
    
    // 没有占位符，使用传统方式（会丢失部分格式）
    const mammoth = getMammoth();
    const buffer = readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    
    const paragraphs = result.value.split('\n').filter(p => p.trim());
    
    if (action === 'append') {
      paragraphs.push(text);
    } else if (action === 'insert' && typeof position === 'number') {
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
      warning: 'Format may be lost. Use placeholder for better results.'
    };
  }
  
  // 删除操作 - 替换为空
  if (action === 'delete') {
    if (!placeholder) {
      throw new Error('placeholder is required for delete action');
    }
    
    const buffer = readFile(filePath);
    
    const patchObject = {
      [placeholder]: {
        type: PatchType.PARAGRAPH,
        children: [new TextRun({ text: '' })]
      }
    };
    
    const resultBuffer = await patchDocument({
      outputType: 'buffer',
      data: buffer,
      patches: patchObject,
      keepOriginalStyles: true
    });
    
    const outputPath = output || filePath;
    saveFile(outputPath, resultBuffer);
    
    return {
      success: true,
      path: resolvePath(outputPath),
      deleted: placeholder
    };
  }
  
  throw new Error(`Invalid action: ${action}. Must be 'replace', 'append', 'insert', or 'delete'`);
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
 * @param {string} params.action - 操作: 'extract' | 'insert' | 'list'
 * @param {string} [params.outputDir] - 输出目录（extract 时）
 * @param {string} [params.imagePath] - 图片路径（insert 时）
 * @param {number} [params.width] - 图片宽度（insert 时）
 * @param {number} [params.height] - 图片高度（insert 时）
 * @param {string} [params.placeholder] - 占位符（insert 时）
 * @param {string} [params.output] - 输出路径（insert 时）
 */
async function docxImage(params) {
  const { 
    path: filePath, 
    action, 
    outputDir, 
    imagePath, 
    width = 400, 
    height = 300, 
    placeholder,
    output
  } = params;
  
  // 列出图片
  if (action === 'list') {
    return await docxRead({ path: filePath, scope: 'images' });
  }
  
  // 提取图片
  if (action === 'extract') {
    const resolvedPath = resolvePath(filePath);
    const zip = new AdmZip(resolvedPath);
    const entries = zip.getEntries();
    
    const images = [];
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.emf', '.wmf', '.svg'];
    
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
    const { patchDocument, PatchType, ImageRun } = docx;
    
    const imageBuffer = readFile(imagePath);
    
    // 如果有占位符，使用 Patcher
    if (placeholder) {
      const docBuffer = readFile(filePath);
      
      const patchObject = {
        [placeholder]: {
          type: PatchType.PARAGRAPH,
          children: [
            new ImageRun({
              data: imageBuffer,
              transformation: { width, height }
            })
          ]
        }
      };
      
      const resultBuffer = await patchDocument({
        outputType: 'buffer',
        data: docBuffer,
        patches: patchObject,
        keepOriginalStyles: true
      });
      
      const outputPath = output || filePath;
      saveFile(outputPath, resultBuffer);
      
      return {
        success: true,
        path: resolvePath(outputPath),
        imageInserted: true,
        insertedAt: placeholder
      };
    }
    
    // 没有占位符，使用传统方式
    const mammoth = getMammoth();
    const docBuffer = readFile(filePath);
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
    
    const doc = new docx.Document({
      sections: [{
        children
      }]
    });
    
    const outputPath = output || filePath;
    const buffer = await docx.Packer.toBuffer(doc);
    saveFile(outputPath, buffer);
    
    return {
      success: true,
      path: resolvePath(outputPath),
      imageInserted: true,
      warning: 'Format may be lost. Use placeholder for better results.'
    };
  }
  
  throw new Error(`Invalid action: ${action}. Must be 'extract', 'insert', or 'list'`);
}

// ==================== docx_link ====================

/**
 * 超链接操作
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.action - 操作: 'add' | 'list'
 * @param {string} [params.placeholder] - 占位符（add 时）
 * @param {string} [params.url] - 链接 URL（add 时）
 * @param {string} [params.text] - 链接文本（add 时）
 * @param {string} [params.output] - 输出路径（add 时）
 */
async function docxLink(params) {
  const { path: filePath, action, placeholder, url, text, output } = params;
  
  const docx = getDocx();
  const { patchDocument, PatchType, ExternalHyperlink, TextRun } = docx;
  
  // 列出超链接
  if (action === 'list') {
    const resolvedPath = resolvePath(filePath);
    const zip = new AdmZip(resolvedPath);
    const docXml = zip.readAsText('word/document.xml');
    
    const links = [];
    const hyperlinkRegex = /<w:hyperlink[^>]*r:id="([^"]*)"[^>]*>/g;
    let match;
    
    while ((match = hyperlinkRegex.exec(docXml)) !== null) {
      links.push({ rId: match[1] });
    }
    
    // 从 relationships 获取实际 URL
    const relsXml = zip.readAsText('word/_rels/document.xml.rels');
    if (relsXml) {
      const parser = getXml2js().Parser();
      const relsObj = await parser.parseStringPromise(relsXml);
      
      if (relsObj['Relationships'] && relsObj['Relationships']['Relationship']) {
        for (const rel of relsObj['Relationships']['Relationship']) {
          const attrs = rel.$ || {};
          const id = attrs['Id'];
          const target = attrs['Target'];
          const type = attrs['Type'];
          
          if (type && type.includes('hyperlink')) {
            const linkInfo = links.find(l => l.rId === id);
            if (linkInfo) {
              linkInfo.url = target;
            }
          }
        }
      }
    }
    
    return {
      success: true,
      linkCount: links.length,
      links
    };
  }
  
  // 添加超链接
  if (action === 'add') {
    if (!placeholder) {
      throw new Error('placeholder is required for add action');
    }
    if (!url) {
      throw new Error('url is required for add action');
    }
    
    const buffer = readFile(filePath);
    
    const hyperlink = new ExternalHyperlink({
      children: [
        new TextRun({ 
          text: text || url,
          style: 'Hyperlink'
        })
      ],
      link: url
    });
    
    const patchObject = {
      [placeholder]: {
        type: PatchType.PARAGRAPH,
        children: [hyperlink]
      }
    };
    
    const resultBuffer = await patchDocument({
      outputType: 'buffer',
      data: buffer,
      patches: patchObject,
      keepOriginalStyles: true
    });
    
    const outputPath = output || filePath;
    saveFile(outputPath, resultBuffer);
    
    return {
      success: true,
      path: resolvePath(outputPath),
      linkAdded: true,
      url,
      insertedAt: placeholder
    };
  }
  
  throw new Error(`Invalid action: ${action}. Must be 'add' or 'list'`);
}

// ==================== docx_toc ====================

/**
 * 目录操作
 * @param {object} params
 * @param {string} params.path - 文件路径
 * @param {string} params.action - 操作: 'insert' | 'update'
 * @param {string} [params.placeholder] - 占位符（insert 时）
 * @param {string} [params.output] - 输出路径
 */
async function docxToc(params) {
  const { path: filePath, action, placeholder, output } = params;
  
  const docx = getDocx();
  const { patchDocument, PatchType, TableOfContents, Paragraph } = docx;
  
  // 插入目录
  if (action === 'insert') {
    if (!placeholder) {
      throw new Error('placeholder is required for insert action');
    }
    
    const buffer = readFile(filePath);
    
    const toc = new TableOfContents('Table of Contents', {
      hyperlink: true,
      styles: [
        { level: 1, name: 'Heading 1' },
        { level: 2, name: 'Heading 2' },
        { level: 3, name: 'Heading 3' }
      ]
    });
    
    const patchObject = {
      [placeholder]: {
        type: PatchType.DOCUMENT,
        children: [toc]
      }
    };
    
    const resultBuffer = await patchDocument({
      outputType: 'buffer',
      data: buffer,
      patches: patchObject,
      keepOriginalStyles: true
    });
    
    const outputPath = output || filePath;
    saveFile(outputPath, resultBuffer);
    
    return {
      success: true,
      path: resolvePath(outputPath),
      tocInserted: true,
      insertedAt: placeholder
    };
  }
  
  // 更新目录 - Word 需要用户手动更新
  if (action === 'update') {
    return {
      success: true,
      message: 'TOC update requires user to open document in Word and press F9 or right-click TOC and select "Update Field"'
    };
  }
  
  throw new Error(`Invalid action: ${action}. Must be 'insert' or 'update'`);
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
    case 'read':
      return await docxRead(params);
      
    case 'write':
      return await docxWrite(params);
      
    case 'patch':
      return await docxPatch(params);
      
    case 'edit':
      return await docxEdit(params);
      
    case 'convert':
      return await docxConvert(params);
      
    case 'image':
      return await docxImage(params);
      
    case 'link':
      return await docxLink(params);
      
    case 'toc':
      return await docxToc(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}. Supported tools: read, write, patch, edit, convert, image, link, toc`);
  }
}

// ============================================
// 工具定义
// ============================================

function getTools() {
  return [
    {
      name: 'read',
      description: '读取Word文档，支持info、text、paragraphs、tables、comments、images、headers、footers',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          scope: { type: 'string', enum: ['info', 'text', 'paragraphs', 'tables', 'comments', 'images', 'headers', 'footers'], description: '读取范围' },
          includeFormatting: { type: 'boolean', description: '是否包含格式（text模式）' },
          includeStyles: { type: 'boolean', description: '是否包含样式（paragraphs模式）' }
        },
        required: ['path']
      }
    },
    {
      name: 'write',
      description: '写入Word文档，支持从data或markdown创建',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          source: { type: 'string', enum: ['data', 'markdown'], description: '数据来源' },
          title: { type: 'string', description: '文档标题' },
          content: { type: 'array', description: '内容数据（source为data时）' },
          markdown: { type: 'string', description: 'Markdown内容（source为markdown时）' },
          properties: { type: 'object', description: '文档属性' },
          header: { type: 'object', description: '页眉配置' },
          footer: { type: 'object', description: '页脚配置' },
          sections: { type: 'array', description: '多节配置' }
        },
        required: ['path']
      }
    },
    {
      name: 'patch',
      description: '模板填充，使用Patcher API保留原文档样式',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '模板文件路径' },
          patches: { type: 'object', description: '替换数据 { placeholder: value }' },
          output: { type: 'string', description: '输出文件路径' },
          keepOriginalStyles: { type: 'boolean', description: '是否保留原文档样式' },
          delimiters: { type: 'object', description: '占位符分隔符 { start, end }' }
        },
        required: ['path', 'patches']
      }
    },
    {
      name: 'edit',
      description: '编辑文档，支持replace、append、insert、delete操作',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          action: { type: 'string', enum: ['replace', 'append', 'insert', 'delete'], description: '操作类型' },
          replacements: { type: 'object', description: '替换数据（replace操作）' },
          text: { type: 'string', description: '文本内容（append/insert操作）' },
          position: { type: 'number', description: '位置（insert操作）' },
          placeholder: { type: 'string', description: '占位符（insert/delete操作）' },
          output: { type: 'string', description: '输出路径' }
        },
        required: ['path', 'action']
      }
    },
    {
      name: 'convert',
      description: '格式转换，支持markdown和html',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          format: { type: 'string', enum: ['markdown', 'html'], description: '目标格式' },
          output: { type: 'string', description: '输出文件路径' },
          includeStyles: { type: 'boolean', description: '是否包含样式（html格式）' }
        },
        required: ['path', 'format']
      }
    },
    {
      name: 'image',
      description: '图片操作，支持extract、insert、list',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          action: { type: 'string', enum: ['extract', 'insert', 'list'], description: '操作类型' },
          outputDir: { type: 'string', description: '输出目录（extract操作）' },
          imagePath: { type: 'string', description: '图片路径（insert操作）' },
          width: { type: 'number', description: '图片宽度（insert操作）' },
          height: { type: 'number', description: '图片高度（insert操作）' },
          placeholder: { type: 'string', description: '占位符（insert操作）' },
          output: { type: 'string', description: '输出路径（insert操作）' }
        },
        required: ['path', 'action']
      }
    },
    {
      name: 'link',
      description: '超链接操作，支持add、list',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          action: { type: 'string', enum: ['add', 'list'], description: '操作类型' },
          placeholder: { type: 'string', description: '占位符（add操作）' },
          url: { type: 'string', description: '链接URL（add操作）' },
          text: { type: 'string', description: '链接文本（add操作）' },
          output: { type: 'string', description: '输出路径（add操作）' }
        },
        required: ['path', 'action']
      }
    },
    {
      name: 'toc',
      description: '目录操作，支持insert、update',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          action: { type: 'string', enum: ['insert', 'update'], description: '操作类型' },
          placeholder: { type: 'string', description: '占位符（insert操作）' },
          output: { type: 'string', description: '输出路径' }
        },
        required: ['path', 'action']
      }
    }
  ];
}

module.exports = { execute, getTools };