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
 * Search text in a single file
 */
async function searchInFile(params) {
  const { path: filePath, pattern, ignore_case = true } = params;
  const resolvedPath = resolvePath(filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  
  const stats = fs.statSync(resolvedPath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes`);
  }
  
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const lines = content.split('\n');
  const matches = [];
  
  const regex = new RegExp(pattern, ignore_case ? 'gi' : 'g');
  
  lines.forEach((line, index) => {
    const lineMatches = [...line.matchAll(new RegExp(pattern, ignore_case ? 'gi' : 'g'))];
    if (lineMatches.length > 0) {
      matches.push({
        line: index + 1,
        content: line,
        matches: lineMatches.map(m => m[0]),
      });
    }
  });
  
  return {
    path: resolvedPath,
    pattern: pattern,
    ignoreCase: ignore_case,
    matchCount: matches.length,
    matches: matches,
  };
}

/**
 * Search text across multiple files (grep)
 */
async function grep(params) {
  const { pattern, path: dirPath = '.', file_pattern = '*' } = params;
  const resolvedPath = resolvePath(dirPath);
  
  const results = [];
  const regex = new RegExp(pattern, 'gi');
  const fileRegex = new RegExp('^' + file_pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  
  function searchFile(filePath) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_FILE_SIZE) return;
      
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        if (regex.test(line)) {
          results.push({
            file: filePath,
            line: index + 1,
            content: line.trim().substring(0, 200),
          });
        }
        regex.lastIndex = 0; // Reset regex
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
 * Insert content at a specific line
 */
async function insertAtLine(params) {
  const { path: filePath, line, content } = params;
  const resolvedPath = resolvePath(filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  
  const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
  const lines = fileContent.split('\n');
  
  const insertIndex = Math.max(0, Math.min(line - 1, lines.length));
  lines.splice(insertIndex, 0, content);
  
  fs.writeFileSync(resolvedPath, lines.join('\n'), 'utf-8');
  
  return {
    success: true,
    path: resolvedPath,
    insertedAtLine: insertIndex + 1,
  };
}

/**
 * Delete specific lines from a file
 */
async function deleteLines(params) {
  const { path: filePath, from, to } = params;
  const resolvedPath = resolvePath(filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const lines = content.split('\n');
  
  const startLine = Math.max(0, from - 1);
  const endLine = to !== undefined ? Math.min(lines.length, to) : startLine + 1;
  
  const deletedCount = endLine - startLine;
  lines.splice(startLine, deletedCount);
  
  fs.writeFileSync(resolvedPath, lines.join('\n'), 'utf-8');
  
  return {
    success: true,
    path: resolvedPath,
    deletedLines: deletedCount,
  };
}

/**
 * Transfer a file - unified function for copy and move operations
 * 
 * @param {object} params - Parameters
 * @param {string} params.source - Source file path
 * @param {string} params.destination - Destination file path
 * @param {string} params.operation - Operation: "copy" (default) or "move"
 */
async function transferFile(params) {
  const { source, destination, operation = 'copy' } = params;
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

/**
 * Delete a file or directory
 */
async function deleteFile(params) {
  const { path: filePath } = params;
  const resolvedPath = resolvePath(filePath);
  
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
    path: resolvedPath,
    type: stats.isDirectory() ? 'directory' : 'file',
  };
}

/**
 * Create a directory
 */
async function createDir(params) {
  const { path: dirPath } = params;
  const resolvedPath = resolvePath(dirPath);
  
  if (fs.existsSync(resolvedPath)) {
    return {
      success: true,
      path: resolvedPath,
      created: false,
      message: 'Directory already exists',
    };
  }
  
  fs.mkdirSync(resolvedPath, { recursive: true });
  
  return {
    success: true,
    path: resolvedPath,
    created: true,
  };
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
    case 'readFile':
      return await readFile(params);
      
    case 'list_files':
    case 'listFiles':
      return await listFiles(params);
      
    case 'search_in_file':
    case 'searchInFile':
      return await searchInFile(params);
      
    case 'grep':
      return await grep(params);
      
    case 'write_file':
    case 'writeFile':
      return await writeFileUnified(params);
      
    case 'replace_in_file':
    case 'replaceInFile':
      return await replaceInFile(params);
      
    case 'insert_at_line':
    case 'insertAtLine':
      return await insertAtLine(params);
      
    case 'delete_lines':
    case 'deleteLines':
      return await deleteLines(params);
      
    case 'transfer':
    case 'transfer_file':
    case 'transferFile':
      return await transferFile(params);
      
    case 'delete_file':
    case 'deleteFile':
      return await deleteFile(params);
      
    case 'create_dir':
    case 'createDir':
      return await createDir(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { execute };