/**
 * Compression Skill - Node.js Implementation
 * 
 * ZIP file operations for creating and extracting archives.
 * Uses PowerShell (Windows) or zip/unzip commands (Unix).
 * 
 * @module compression-skill
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Allowed base directories
const ALLOWED_BASE_PATHS = [
  process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data'),
];

// Maximum file size for compression (500MB)
const MAX_FILE_SIZE = 500 * 1024 * 1024;

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
  if (path.isAbsolute(relativePath)) {
    if (!isPathAllowed(relativePath)) {
      throw new Error(`Path not allowed: ${relativePath}`);
    }
    return relativePath;
  }
  
  for (const basePath of ALLOWED_BASE_PATHS) {
    const resolved = path.join(basePath, relativePath);
    if (fs.existsSync(resolved) || isPathAllowed(resolved)) {
      return resolved;
    }
  }
  
  return path.join(ALLOWED_BASE_PATHS[0], relativePath);
}

/**
 * Create a ZIP archive from files or directories
 */
async function zip(params) {
  const { source, destination, compression_level = 6 } = params;
  const resolvedSource = resolvePath(source);
  
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Source not found: ${resolvedSource}`);
  }
  
  // Determine destination path
  let resolvedDest;
  if (destination) {
    resolvedDest = resolvePath(destination);
  } else {
    resolvedDest = resolvedSource + '.zip';
  }
  
  // Ensure destination directory exists
  const destDir = path.dirname(resolvedDest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  // Check source size
  const stats = fs.statSync(resolvedSource);
  if (stats.isFile() && stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})`);
  }
  
  try {
    // Use PowerShell on Windows, zip command on Linux/Mac
    if (process.platform === 'win32') {
      // PowerShell Compress-Archive - 使用 execFileSync 防止命令注入
      execFileSync('powershell', [
        '-Command',
        'Compress-Archive',
        '-Path', resolvedSource,
        '-DestinationPath', resolvedDest,
        '-CompressionLevel', getCompressionLevel(compression_level),
        '-Force'
      ], { timeout: 60000 });
    } else {
      // zip command on Unix - 使用 execFileSync 防止命令注入
      const sourceName = path.basename(resolvedSource);
      const destName = path.basename(resolvedDest);
      execFileSync('zip', [
        `-${compression_level}`,
        '-r',
        destName,
        sourceName
      ], { cwd: destDir, timeout: 60000 });
    }
    
    const destStats = fs.statSync(resolvedDest);
    
    return {
      success: true,
      source: resolvedSource,
      destination: resolvedDest,
      compressedSize: destStats.size,
      originalSize: getTotalSize(resolvedSource),
    };
  } catch (error) {
    throw new Error(`ZIP creation failed: ${error.message}`);
  }
}

/**
 * Extract a ZIP archive
 */
async function unzip(params) {
  const { source, destination } = params;
  const resolvedSource = resolvePath(source);
  
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`ZIP file not found: ${resolvedSource}`);
  }
  
  // Determine destination path
  let resolvedDest;
  if (destination) {
    resolvedDest = resolvePath(destination);
  } else {
    // Extract to same directory as the ZIP file
    resolvedDest = path.dirname(resolvedSource);
  }
  
  // Ensure destination directory exists
  if (!fs.existsSync(resolvedDest)) {
    fs.mkdirSync(resolvedDest, { recursive: true });
  }
  
  try {
    // Use PowerShell on Windows, unzip command on Linux/Mac
    if (process.platform === 'win32') {
      // PowerShell Expand-Archive - 使用 execFileSync 防止命令注入
      execFileSync('powershell', [
        '-Command',
        'Expand-Archive',
        '-Path', resolvedSource,
        '-DestinationPath', resolvedDest,
        '-Force'
      ], { timeout: 60000 });
    } else {
      // unzip command on Unix - 使用 execFileSync 防止命令注入
      execFileSync('unzip', [
        '-o',
        resolvedSource,
        '-d', resolvedDest
      ], { timeout: 60000 });
    }
    
    // List extracted files
    const extractedFiles = listExtractedFiles(resolvedDest);
    
    return {
      success: true,
      source: resolvedSource,
      destination: resolvedDest,
      extractedCount: extractedFiles.length,
      extractedFiles: extractedFiles.slice(0, 50), // Limit output
    };
  } catch (error) {
    throw new Error(`ZIP extraction failed: ${error.message}`);
  }
}

/**
 * Get compression level string for PowerShell
 */
function getCompressionLevel(level) {
  if (level <= 3) return 'Fastest';
  if (level <= 6) return 'Optimal';
  return 'NoCompression';
}

/**
 * Get total size of file or directory
 */
function getTotalSize(targetPath) {
  const stats = fs.statSync(targetPath);
  
  if (stats.isFile()) {
    return stats.size;
  }
  
  let totalSize = 0;
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      totalSize += getTotalSize(entryPath);
    } else {
      totalSize += fs.statSync(entryPath).size;
    }
  }
  
  return totalSize;
}

/**
 * List extracted files recursively
 */
function listExtractedFiles(dir, prefix = '') {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const displayPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    
    if (entry.isDirectory()) {
      files.push(...listExtractedFiles(entryPath, displayPath));
    } else {
      files.push({
        path: displayPath,
        size: fs.statSync(entryPath).size,
      });
    }
  }
  
  return files;
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
    case 'zip':
      return await zip(params);
      
    case 'unzip':
      return await unzip(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { execute, zip, unzip };
