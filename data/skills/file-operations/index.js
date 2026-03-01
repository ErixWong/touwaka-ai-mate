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

// Allowed base directories (from environment or default)
// 统一使用 DATA_BASE_PATH，技能路径为 DATA_BASE_PATH/skills
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const ALLOWED_BASE_PATHS = [
  DATA_BASE_PATH,
  path.join(DATA_BASE_PATH, 'skills'),
];

// Maximum file size to read (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Check if path is within allowed directories
 */
function isPathAllowed(targetPath) {
  const resolved = path.resolve(targetPath);
  return ALLOWED_BASE_PATHS.some(basePath => {
    const resolvedBase = path.resolve(basePath);
    return resolved.startsWith(resolvedBase);
  });
}

/**
 * Resolve path relative to allowed base directories
 */
function resolvePath(relativePath) {
  // If absolute path, check if it's allowed
  if (path.isAbsolute(relativePath)) {
    if (!isPathAllowed(relativePath)) {
      throw new Error(`Path not allowed: ${relativePath}`);
    }
    return relativePath;
  }
  
  // Try each allowed base path
  for (const basePath of ALLOWED_BASE_PATHS) {
    const resolved = path.join(basePath, relativePath);
    if (fs.existsSync(resolved) || isPathAllowed(resolved)) {
      return resolved;
    }
  }
  
  // Default to first base path
  return path.join(ALLOWED_BASE_PATHS[0], relativePath);
}

/**
 * Read file content line by line
 */
async function readLines(params) {
  const { path: filePath, from = 1, lines = 100 } = params;
  const resolvedPath = resolvePath(filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  
  const stats = fs.statSync(resolvedPath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})`);
  }
  
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const allLines = content.split('\n');
  
  const startLine = Math.max(1, from) - 1;
  const endLine = Math.min(allLines.length, startLine + lines);
  
  const selectedLines = allLines.slice(startLine, endLine);
  
  return {
    path: resolvedPath,
    totalLines: allLines.length,
    startLine: startLine + 1,
    endLine: endLine,
    lines: selectedLines,
    content: selectedLines.join('\n'),
  };
}

/**
 * Read file content by bytes
 */
async function readBytes(params) {
  const { path: filePath, offset = 0, bytes = 50000 } = params;
  const resolvedPath = resolvePath(filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  
  const stats = fs.statSync(resolvedPath);
  const maxBytes = Math.min(bytes, MAX_FILE_SIZE);
  
  const fd = fs.openSync(resolvedPath, 'r');
  const buffer = Buffer.alloc(maxBytes);
  const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, offset);
  fs.closeSync(fd);
  
  return {
    path: resolvedPath,
    totalSize: stats.size,
    offset: offset,
    bytesRead: bytesRead,
    content: buffer.toString('utf-8', 0, bytesRead),
  };
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
 * Write content to a file
 */
async function writeFile(params) {
  const { path: filePath, content } = params;
  const resolvedPath = resolvePath(filePath);
  
  // Ensure directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(resolvedPath, content, 'utf-8');
  
  return {
    success: true,
    path: resolvedPath,
    bytesWritten: Buffer.byteLength(content, 'utf-8'),
  };
}

/**
 * Append content to a file
 */
async function appendFile(params) {
  const { path: filePath, content } = params;
  const resolvedPath = resolvePath(filePath);
  
  // Check if file exists, if not create it
  if (!fs.existsSync(resolvedPath)) {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  fs.appendFileSync(resolvedPath, content, 'utf-8');
  
  return {
    success: true,
    path: resolvedPath,
    appendedBytes: Buffer.byteLength(content, 'utf-8'),
  };
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
 * Copy a file
 */
async function copyFile(params) {
  const { source, destination } = params;
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
  
  fs.copyFileSync(resolvedSource, resolvedDest);
  
  return {
    success: true,
    source: resolvedSource,
    destination: resolvedDest,
  };
}

/**
 * Move or rename a file
 */
async function moveFile(params) {
  const { source, destination } = params;
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
  
  fs.renameSync(resolvedSource, resolvedDest);
  
  return {
    success: true,
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
    case 'read_lines':
    case 'readLines':
      return await readLines(params);
      
    case 'read_bytes':
    case 'readBytes':
      return await readBytes(params);
      
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
      return await writeFile(params);
      
    case 'append_file':
    case 'appendFile':
      return await appendFile(params);
      
    case 'replace_in_file':
    case 'replaceInFile':
      return await replaceInFile(params);
      
    case 'insert_at_line':
    case 'insertAtLine':
      return await insertAtLine(params);
      
    case 'delete_lines':
    case 'deleteLines':
      return await deleteLines(params);
      
    case 'copy_file':
    case 'copyFile':
      return await copyFile(params);
      
    case 'move_file':
    case 'moveFile':
      return await moveFile(params);
      
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