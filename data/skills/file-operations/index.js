/**
 * File Operations Skill - Node.js Implementation
 * 
 * File system operations including read, write, search, and manage files.
 * All operations are restricted to allowed directories for security.
 * 
 * @module file-operations-skill
 */

const fs = require('fs');
const path = require('path');

// 用户角色检查（管理员有特殊权限）
const IS_ADMIN = process.env.IS_ADMIN === 'true';

// Allowed base directories (from environment or default)
// 统一使用 DATA_BASE_PATH，技能路径为 DATA_BASE_PATH/skills
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');

// 技能目录（普通用户禁止访问）
const SKILLS_DIR = path.join(DATA_BASE_PATH, 'skills');

// 用户工作目录
const USER_ID = process.env.USER_ID || 'default';
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? path.join(DATA_BASE_PATH, process.env.WORKING_DIRECTORY)
  : path.join(DATA_BASE_PATH, 'work', USER_ID);

// 权限控制：
// - 普通用户：仅当前工作目录
// - 管理员：当前工作目录 + skills 目录
const ALLOWED_BASE_PATHS = IS_ADMIN
  ? [USER_WORK_DIR, SKILLS_DIR]  // 管理员：工作目录 + skills 目录
  : [USER_WORK_DIR];  // 普通用户：仅用户工作目录

// 调试输出
console.error('[file-operations] 环境变量诊断:');
console.error(`  IS_ADMIN: ${IS_ADMIN}`);
console.error(`  DATA_BASE_PATH: ${DATA_BASE_PATH}`);
console.error(`  SKILLS_DIR: ${SKILLS_DIR}`);
console.error(`  USER_WORK_DIR: ${USER_WORK_DIR}`);
console.error(`  WORKING_DIRECTORY: ${process.env.WORKING_DIRECTORY || '(未设置)'}`);
console.error(`  ALLOWED_BASE_PATHS: ${JSON.stringify(ALLOWED_BASE_PATHS)}`);

// Maximum file size to read (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Check if path is within allowed directories
 * 防护：路径遍历攻击和符号链接攻击
 */
function isPathAllowed(targetPath) {
  // 使用 path.resolve 规范化路径（处理 .. 等）
  let resolved = path.resolve(targetPath);
  
  // 使用 fs.realpathSync 解析符号链接（防止符号链接逃逸）
  try {
    if (fs.existsSync(resolved)) {
      resolved = fs.realpathSync(resolved);
    }
  } catch (e) {
    // 路径不存在时，继续使用 path.resolve 的结果
  }
  
  // Windows 路径不区分大小写，统一转换为小写进行比较
  const resolvedLower = resolved.toLowerCase();
  
  // 调试输出
  console.error(`[file-operations] isPathAllowed: checking "${resolved}"`);
  
  const result = ALLOWED_BASE_PATHS.some(basePath => {
    let resolvedBase = path.resolve(basePath);
    try {
      if (fs.existsSync(resolvedBase)) {
        resolvedBase = fs.realpathSync(resolvedBase);
      }
    } catch (e) {
      // 基础路径不存在时，继续使用 path.resolve 的结果
    }
    
    // Windows 路径不区分大小写，统一转换为小写进行比较
    const resolvedBaseLower = resolvedBase.toLowerCase();
    
    // 正确的路径边界检查：
    // 1. 路径必须以 basePath + path.sep 开头（子目录/文件）
    // 2. 或者路径完全等于 basePath（目录本身）
    const isAllowed = resolvedLower.startsWith(resolvedBaseLower + path.sep) || resolvedLower === resolvedBaseLower;
    console.error(`[file-operations]   vs "${resolvedBase}": ${isAllowed}`);
    return isAllowed;
  });
  
  console.error(`[file-operations] isPathAllowed result: ${result}`);
  return result;
}

/**
 * Resolve path relative to allowed base directories
 * 防护：确保所有返回的路径都在允许的目录内
 *
 * 权限规则：
 * - 普通用户：只能使用相对路径（相对于工作目录）
 * - 管理员：可以使用绝对路径和相对路径
 */
function resolvePath(relativePath) {
  // 如果是绝对路径
  if (path.isAbsolute(relativePath)) {
    // 只有管理员可以使用绝对路径
    if (!IS_ADMIN) {
      throw new Error(`Absolute path not allowed for non-admin users: ${relativePath}`);
    }
    // 检查绝对路径是否在允许范围内
    if (!isPathAllowed(relativePath)) {
      throw new Error(`Path not allowed: ${relativePath}`);
    }
    return relativePath;
  }
  
  // 相对路径：尝试每个允许的基础路径
  for (const basePath of ALLOWED_BASE_PATHS) {
    const resolved = path.join(basePath, relativePath);
    if (fs.existsSync(resolved) || isPathAllowed(resolved)) {
      // 再次检查解析后的路径是否被允许（防止路径遍历）
      if (!isPathAllowed(resolved)) {
        throw new Error(`Path not allowed: ${resolved}`);
      }
      return resolved;
    }
  }
  
  // 默认使用第一个基础路径，但必须检查权限
  const defaultPath = path.join(ALLOWED_BASE_PATHS[0], relativePath);
  if (!isPathAllowed(defaultPath)) {
    throw new Error(`Path not allowed: ${defaultPath}`);
  }
  return defaultPath;
}

/**
 * Read file content - unified function with mode parameter
 * 
 * @param {object} params - Parameters
 * @param {string} params.path - File path
 * @param {string} params.mode - Read mode: "lines" (default) or "bytes"
 * @param {number} params.from - Start line (for lines mode, 1-based)
 * @param {number} params.lines - Number of lines to read (for lines mode)
 * @param {number} params.offset - Byte offset (for bytes mode)
 * @param {number} params.bytes - Number of bytes to read (for bytes mode)
 */
async function readFile(params) {
  const { path: filePath, mode = 'lines', from = 1, lines = 100, offset = 0, bytes = 50000 } = params;
  const resolvedPath = resolvePath(filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  
  const stats = fs.statSync(resolvedPath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})`);
  }
  
  if (mode === 'bytes') {
    // Bytes mode
    const maxBytes = Math.min(bytes, MAX_FILE_SIZE);
    const fd = fs.openSync(resolvedPath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, offset);
    fs.closeSync(fd);
    
    return {
      path: resolvedPath,
      mode: 'bytes',
      totalSize: stats.size,
      offset: offset,
      bytesRead: bytesRead,
      content: buffer.toString('utf-8', 0, bytesRead),
    };
  } else {
    // Lines mode (default)
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const allLines = content.split('\n');
    
    const startLine = Math.max(1, from) - 1;
    const endLine = Math.min(allLines.length, startLine + lines);
    
    const selectedLines = allLines.slice(startLine, endLine);
    
    return {
      path: resolvedPath,
      mode: 'lines',
      totalLines: allLines.length,
      startLine: startLine + 1,
      endLine: endLine,
      lines: selectedLines,
      content: selectedLines.join('\n'),
    };
  }
}

/**
 * List directory contents
 */
async function listFiles(params) {
  const { path: dirPath, recursive = false } = params;
  const resolvedPath = resolvePath(dirPath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Directory not found: ${resolvedPath}`);
  }
  
  const stats = fs.statSync(resolvedPath);
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${resolvedPath}`);
  }
  
  function listDirectory(dir, prefix = '') {
    const items = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const itemPath = path.join(dir, entry.name);
      const displayPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      
      const item = {
        name: entry.name,
        path: displayPath,
        type: entry.isDirectory() ? 'directory' : 'file',
      };
      
      if (entry.isFile()) {
        try {
          const stats = fs.statSync(itemPath);
          item.size = stats.size;
          item.modified = stats.mtime;
        } catch (e) {
          item.error = e.message;
        }
      }
      
      items.push(item);
      
      if (recursive && entry.isDirectory()) {
        const subItems = listDirectory(itemPath, displayPath);
        items.push(...subItems);
      }
    }
    
    return items;
  }
  
  const items = listDirectory(resolvedPath);
  
  return {
    path: resolvedPath,
    recursive: recursive,
    totalItems: items.length,
    items: items,
  };
}

/**
 * Search text across files (grep)
 * 支持单文件和多文件搜索，支持正则和简单字符串匹配
 *
 * @param {object} params - Parameters
 * @param {string} params.pattern - Search pattern
 * @param {string} params.path - File or directory path (default: current)
 * @param {string} params.file_pattern - File pattern filter (default: "*")
 * @param {boolean} params.use_regex - Use regex mode (default: false, use literal string match)
 * @param {boolean} params.ignore_case - Case insensitive search (default: true)
 * @returns {Promise<object>} Search results
 */
async function grep(params) {
  const {
    pattern,
    path: dirPath = '.',
    file_pattern = '*',
    use_regex = false,
    ignore_case = true
  } = params;
  const resolvedPath = resolvePath(dirPath);
  
  const results = [];
  
  // 创建匹配函数
  let matchFunction;
  if (use_regex) {
    // 正则模式
    const regex = new RegExp(pattern, ignore_case ? 'gi' : 'g');
    matchFunction = (line) => {
      const matches = [...line.matchAll(new RegExp(pattern, ignore_case ? 'gi' : 'g'))];
      return matches.length > 0 ? matches.map(m => m[0]) : null;
    };
  } else {
    // 简单字符串匹配模式（默认）
    const searchStr = ignore_case ? pattern.toLowerCase() : pattern;
    matchFunction = (line) => {
      const lineToCheck = ignore_case ? line.toLowerCase() : line;
      if (lineToCheck.includes(searchStr)) {
        return [pattern]; // 返回匹配的模式
      }
      return null;
    };
  }
  
  const fileRegex = new RegExp('^' + file_pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  
  function searchFile(filePath) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_FILE_SIZE) return;
      
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        const matches = matchFunction(line);
        if (matches) {
          results.push({
            file: filePath,
            line: index + 1,
            content: line.trim().substring(0, 200),
            matches: matches,
          });
        }
      });
    } catch (e) {
      // Skip files that can't be read
    }
  }
  
  function walkDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const itemPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        walkDirectory(itemPath);
      } else if (entry.isFile() && fileRegex.test(entry.name)) {
        searchFile(itemPath);
      }
    }
  }
  
  if (fs.statSync(resolvedPath).isDirectory()) {
    walkDirectory(resolvedPath);
  } else {
    searchFile(resolvedPath);
  }
  
  return {
    path: resolvedPath,
    pattern: pattern,
    useRegex: use_regex,
    ignoreCase: ignore_case,
    filePattern: file_pattern,
    matchCount: results.length,
    matches: results.slice(0, 100), // Limit results
  };
}

/**
 * Write content to a file - unified function with mode parameter
 * 
 * @param {object} params - Parameters
 * @param {string} params.path - File path
 * @param {string} params.content - Content to write
 * @param {string} params.mode - Write mode: "write" (default, overwrite) or "append"
 */
async function writeFileUnified(params) {
  const { path: filePath, content, mode = 'write' } = params;
  const resolvedPath = resolvePath(filePath);
  
  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  if (mode === 'append') {
    fs.appendFileSync(resolvedPath, content, 'utf-8');
    return {
      success: true,
      path: resolvedPath,
      mode: 'append',
      appendedBytes: Buffer.byteLength(content, 'utf-8'),
    };
  } else {
    fs.writeFileSync(resolvedPath, content, 'utf-8');
    return {
      success: true,
      path: resolvedPath,
      mode: 'write',
      bytesWritten: Buffer.byteLength(content, 'utf-8'),
    };
  }
}

/**
 * Replace text in a file
 */
async function replaceInFile(params) {
  const { path: filePath, old, new: newText } = params;
  const resolvedPath = resolvePath(filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const newContent = content.split(old).join(newText);
  
  fs.writeFileSync(resolvedPath, newContent, 'utf-8');
  
  const count = (content.match(new RegExp(escapeRegex(old), 'g')) || []).length;
  
  return {
    success: true,
    path: resolvedPath,
    replacements: count,
  };
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Edit lines in a file - unified function for insert and delete operations
 * 统一的行编辑工具，支持插入和删除操作
 *
 * @param {object} params - Parameters
 * @param {string} params.path - File path
 * @param {string} params.operation - Operation: "insert" (default) or "delete"
 * @param {number} params.line - Line number (1-based)
 * @param {number} params.end_line - End line number for delete (optional, defaults to line)
 * @param {string} params.content - Content to insert (required for insert operation)
 * @returns {Promise<object>} Operation result
 */
async function editLines(params) {
  const { path: filePath, operation = 'insert', line, end_line, content } = params;
  const resolvedPath = resolvePath(filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  
  const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
  const lines = fileContent.split('\n');
  
  // 验证行号
  const startLineIndex = Math.max(0, Math.min(line - 1, lines.length));
  const endLineIndex = end_line !== undefined
    ? Math.max(0, Math.min(end_line - 1, lines.length - 1))
    : startLineIndex;
  
  // 确保起始行不大于结束行
  const actualStart = Math.min(startLineIndex, endLineIndex);
  const actualEnd = Math.max(startLineIndex, endLineIndex);
  
  let result = {
    success: true,
    path: resolvedPath,
    operation: operation,
  };
  
  switch (operation) {
    case 'insert':
      // 在指定行之前插入内容
      if (content === undefined) {
        throw new Error('Content is required for insert operation');
      }
      lines.splice(actualStart, 0, content);
      result.insertedAtLine = actualStart + 1;
      result.totalLines = lines.length;
      break;
      
    case 'delete':
      // 删除指定行范围
      const deleteCount = actualEnd - actualStart + 1;
      const deletedLines = lines.splice(actualStart, deleteCount);
      result.deletedLines = deleteCount;
      result.deletedContent = deletedLines.join('\n');
      result.totalLines = lines.length;
      break;
      
    default:
      throw new Error(`Unknown operation: ${operation}. Use "insert" or "delete". For content replacement, use replace_in_file tool.`);
  }
  
  fs.writeFileSync(resolvedPath, lines.join('\n'), 'utf-8');
  
  return result;
}

/**
 * FS action - unified file system operations
 * 统一的文件系统操作工具，支持复制、移动、删除和创建目录
 *
 * @param {object} params - Parameters
 * @param {string} params.operation - Operation: "copy" (default), "move", "delete", or "create_dir"
 * @param {string} params.source - Source path (for copy/move)
 * @param {string} params.destination - Destination path (for copy/move)
 * @param {string} params.path - Path to delete or directory to create (for delete/create_dir)
 * @returns {Promise<object>} Operation result
 */
async function fsAction(params) {
  const { operation = 'copy', source, destination, path: targetPath } = params;
  
  switch (operation) {
    case 'copy':
    case 'move': {
      if (!source || !destination) {
        throw new Error(`Source and destination are required for ${operation} operation`);
      }
      const resolvedSource = resolvePath(source);
      const resolvedDest = resolvePath(destination);
      
      if (!fs.existsSync(resolvedSource)) {
        throw new Error(`Source not found: ${resolvedSource}`);
      }
      
      // Ensure destination directory exists
      const dir = path.dirname(resolvedDest);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      if (operation === 'move') {
        fs.renameSync(resolvedSource, resolvedDest);
      } else {
        fs.copyFileSync(resolvedSource, resolvedDest);
      }
      
      return {
        success: true,
        operation: operation,
        source: resolvedSource,
        destination: resolvedDest,
      };
    }
    
    case 'delete': {
      const deletePath = targetPath || source;
      if (!deletePath) {
        throw new Error('Path is required for delete operation');
      }
      const resolvedPath = resolvePath(deletePath);
      
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Path not found: ${resolvedPath}`);
      }
      
      const stats = fs.statSync(resolvedPath);
      
      if (stats.isDirectory()) {
        fs.rmSync(resolvedPath, { recursive: true });
      } else {
        fs.unlinkSync(resolvedPath);
      }
      
      return {
        success: true,
        operation: 'delete',
        path: resolvedPath,
        type: stats.isDirectory() ? 'directory' : 'file',
      };
    }
    
    case 'create_dir': {
      const dirPath = targetPath || source;
      if (!dirPath) {
        throw new Error('Path is required for create_dir operation');
      }
      const resolvedPath = resolvePath(dirPath);
      
      if (fs.existsSync(resolvedPath)) {
        return {
          success: true,
          operation: 'create_dir',
          path: resolvedPath,
          created: false,
          message: 'Directory already exists',
        };
      }
      
      fs.mkdirSync(resolvedPath, { recursive: true });
      
      return {
        success: true,
        operation: 'create_dir',
        path: resolvedPath,
        created: true,
      };
    }
    
    default:
      throw new Error(`Unknown operation: ${operation}. Use "copy", "move", "delete", or "create_dir".`);
  }
}

/**
 * Get file/directory information (metadata)
 * 获取文件或目录的详细信息，便于 LLM 决策
 *
 * @param {object} params - Parameters
 * @param {string} params.path - File or directory path
 * @param {boolean} params.include_content_preview - Include content preview for text files (default: false)
 * @returns {Promise<object>} File information
 */
async function getFileInfo(params) {
  const { path: targetPath, include_content_preview = false } = params;
  const resolvedPath = resolvePath(targetPath);
  
  // 基础信息：是否存在
  const exists = fs.existsSync(resolvedPath);
  
  if (!exists) {
    return {
      exists: false,
      path: resolvedPath,
      message: 'File or directory does not exist',
    };
  }
  
  // 获取文件统计信息
  const stats = fs.statSync(resolvedPath);
  const isDirectory = stats.isDirectory();
  const isFile = stats.isFile();
  
  // 解析路径组件
  const pathInfo = {
    fullPath: resolvedPath,
    directory: path.dirname(resolvedPath),
    baseName: path.basename(resolvedPath),
    extension: '',
    fileNameWithoutExt: '',
  };
  
  if (isFile) {
    const ext = path.extname(resolvedPath);
    pathInfo.extension = ext ? ext.slice(1).toLowerCase() : ''; // 去掉点号，小写
    pathInfo.fileNameWithoutExt = path.basename(resolvedPath, ext);
  }
  
  // 基础结果
  const result = {
    exists: true,
    path: resolvedPath,
    type: isDirectory ? 'directory' : (isFile ? 'file' : 'unknown'),
    size: stats.size,
    sizeHuman: formatBytes(stats.size),
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    isReadOnly: !(stats.mode & 0o200), // 检查写权限
    pathInfo: pathInfo,
  };
  
  // 目录特有信息
  if (isDirectory) {
    try {
      const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      const fileCount = entries.filter(e => e.isFile()).length;
      const dirCount = entries.filter(e => e.isDirectory()).length;
      
      result.directoryInfo = {
        totalItems: entries.length,
        fileCount: fileCount,
        directoryCount: dirCount,
        items: entries.slice(0, 20).map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        })),
        truncated: entries.length > 20,
      };
    } catch (e) {
      result.directoryInfo = {
        error: e.message,
      };
    }
  }
  
  // 文件特有信息
  if (isFile) {
    // MIME 类型推断
    result.mimeType = getMimeType(pathInfo.extension);
    
    // 文本文件检测
    const isText = isTextFile(pathInfo.extension, stats.size);
    result.isTextFile = isText;
    
    // 内容预览（仅文本文件且请求时）
    if (include_content_preview && isText && stats.size <= 10000) {
      try {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        const lines = content.split('\n');
        result.contentPreview = {
          totalLines: lines.length,
          totalChars: content.length,
          firstLines: lines.slice(0, 10),
          truncated: lines.length > 10,
        };
      } catch (e) {
        result.contentPreview = {
          error: e.message,
        };
      }
    }
    
    // 大文件警告
    if (stats.size > MAX_FILE_SIZE) {
      result.warning = `File is larger than ${formatBytes(MAX_FILE_SIZE)}, may not be readable`;
    }
  }
  
  return result;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get MIME type from file extension
 */
function getMimeType(ext) {
  const mimeTypes = {
    // 文本
    'txt': 'text/plain',
    'md': 'text/markdown',
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'css': 'text/css',
    'csv': 'text/csv',
    // 代码
    'js': 'application/javascript',
    'ts': 'application/typescript',
    'py': 'text/x-python',
    'java': 'text/x-java-source',
    'c': 'text/x-c',
    'cpp': 'text/x-c++src',
    'h': 'text/x-c',
    'hpp': 'text/x-c++hdr',
    'cs': 'text/x-csharp',
    'go': 'text/x-go',
    'rs': 'text/x-rust',
    'rb': 'text/x-ruby',
    'php': 'text/x-php',
    'sh': 'text/x-sh',
    'bat': 'text/x-bat',
    'ps1': 'text/x-powershell',
    // 配置
    'yaml': 'application/x-yaml',
    'yml': 'application/x-yaml',
    'toml': 'application/x-toml',
    'ini': 'text/x-ini',
    'env': 'text/x-env',
    // 文档
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // 图片
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'bmp': 'image/bmp',
    // 音视频
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'avi': 'video/x-msvideo',
    // 压缩
    'zip': 'application/zip',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    // 数据
    'sql': 'application/x-sql',
    'db': 'application/x-sqlite3',
    'sqlite': 'application/x-sqlite3',
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Check if file is likely a text file
 */
function isTextFile(ext, size) {
  // 已知文本文件扩展名
  const textExtensions = [
    'txt', 'md', 'json', 'xml', 'html', 'htm', 'css', 'csv',
    'js', 'ts', 'jsx', 'tsx', 'vue', 'svelte',
    'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php',
    'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'psm1',
    'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'gitignore',
    'sql', 'prisma', 'graphql', 'gql',
    'log', 'lock', 'sum', 'mod',
    'markdown', 'rst', 'adoc', 'tex',
    'svg', 'mmd', 'mermaid',
    'dockerfile', 'makefile', 'rakefile', 'gemfile',
    'license', 'readme', 'changelog', 'authors', 'contributors',
  ];
  
  if (textExtensions.includes(ext)) {
    return true;
  }
  
  // 无扩展名的小文件可能是文本
  if (!ext && size < 10000) {
    return true;
  }
  
  return false;
}

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
    case 'read_file':
      return await readFile(params);
      
    case 'list_files':
      return await listFiles(params);
      
    case 'fs_grep':
      return await grep(params);
      
    case 'write_file':
      return await writeFileUnified(params);
      
    case 'replace_in_file':
      return await replaceInFile(params);
      
    case 'edit_lines':
      return await editLines(params);
      
    case 'fs_action':
      return await fsAction(params);
      
    case 'fs_info':
      return await getFileInfo(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { execute };