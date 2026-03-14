#!/usr/bin/env node
/**
 * 代码行数统计工具
 * 统计项目源代码行数，排除 docs、node_modules 等目录
 * 
 * 使用方法：node tools/count-lines.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目根目录
const ROOT_DIR = path.resolve(__dirname, '..');

// 要统计的目录（相对于项目根目录）
// 注意：只统计项目核心代码，不统计测试/调试工具
const INCLUDE_DIRS = [
  'lib',
  'server',
  'models',
  'scripts',
  'config',
  'frontend/src'
];

// 要排除的目录
const EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  '.git',
  'docs'
];

// 要统计的文件扩展名
const INCLUDE_EXTENSIONS = [
  // JavaScript/TypeScript
  '.js', '.mjs', '.cjs', '.ts', '.vue',
  // Styles
  '.css', '.scss', '.sass', '.less',
  // Config/Data
  '.json', '.sql',
  // Templates
  '.html', '.ejs', '.pug', '.hbs',
  // Other
  '.sh', '.ps1', '.bat'
];

// 排除的文件
const EXCLUDE_FILES = [
  'package-lock.json',
  'package.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  '.eslintrc.json',
  '.oxlintrc.json',
  'vite.config.ts',
  'null' // 项目中的异常文件
];

/**
 * 递归获取目录下所有文件
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      
      try {
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          // 检查是否在排除目录中
          if (!EXCLUDE_DIRS.includes(file)) {
            getAllFiles(fullPath, arrayOfFiles);
          }
        } else {
          arrayOfFiles.push(fullPath);
        }
      } catch (e) {
        // 忽略无法访问的文件
      }
    }
  } catch (e) {
    // 忽略无法访问的目录
  }
  
  return arrayOfFiles;
}

/**
 * 统计文件行数
 */
function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch (e) {
    return 0;
  }
}

/**
 * 获取文件扩展名
 */
function getExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

/**
 * 格式化数字输出
 */
function formatNumber(num) {
  return num.toString().padStart(8, ' ');
}

/**
 * 主函数
 */
function main() {
  console.log('='.repeat(60));
  console.log('  Touwaka Mate v2 - 代码行数统计');
  console.log('='.repeat(60));
  console.log();
  
  const results = {};
  let totalFiles = 0;
  let totalLines = 0;
  
  // 按扩展名统计
  const extStats = {};
  
  for (const dir of INCLUDE_DIRS) {
    const fullDirPath = path.join(ROOT_DIR, dir);
    
    // 检查目录是否存在
    if (!fs.existsSync(fullDirPath)) {
      console.log(`⚠️  目录不存在: ${dir}`);
      continue;
    }
    
    const files = getAllFiles(fullDirPath);
    let dirFiles = 0;
    let dirLines = 0;
    
    for (const file of files) {
      const ext = getExtension(file);
      const fileName = path.basename(file);
      
      // 检查文件扩展名和排除文件
      if (!INCLUDE_EXTENSIONS.includes(ext) || EXCLUDE_FILES.includes(fileName)) {
        continue;
      }
      
      const lines = countLines(file);
      dirFiles++;
      dirLines += lines;
      
      // 按扩展名统计
      if (!extStats[ext]) {
        extStats[ext] = { files: 0, lines: 0 };
      }
      extStats[ext].files++;
      extStats[ext].lines += lines;
    }
    
    if (dirFiles > 0) {
      results[dir] = { files: dirFiles, lines: dirLines };
      totalFiles += dirFiles;
      totalLines += dirLines;
    }
  }
  
  // 输出按目录统计结果
  console.log('📊 按目录统计:');
  console.log('-'.repeat(60));
  console.log(`  ${'目录'.padEnd(30)} ${'文件数'.padStart(8)} ${'行数'.padStart(10)}`);
  console.log('-'.repeat(60));
  
  const sortedDirs = Object.entries(results).sort((a, b) => b[1].lines - a[1].lines);
  
  for (const [dir, stats] of sortedDirs) {
    const displayName = dir.length > 28 ? '...' + dir.slice(-25) : dir;
    console.log(`  ${displayName.padEnd(30)} ${formatNumber(stats.files)} ${formatNumber(stats.lines)}`);
  }
  
  console.log('-'.repeat(60));
  console.log(`  ${'总计'.padEnd(30)} ${formatNumber(totalFiles)} ${formatNumber(totalLines)}`);
  console.log();
  
  // 输出按扩展名统计结果
  console.log('📈 按文件类型统计:');
  console.log('-'.repeat(60));
  console.log(`  ${'扩展名'.padEnd(10)} ${'文件数'.padStart(8)} ${'行数'.padStart(10)} ${'占比'.padStart(8)}`);
  console.log('-'.repeat(60));
  
  const sortedExts = Object.entries(extStats).sort((a, b) => b[1].lines - a[1].lines);
  
  for (const [ext, stats] of sortedExts) {
    const percentage = ((stats.lines / totalLines) * 100).toFixed(1);
    console.log(`  ${ext.padEnd(10)} ${formatNumber(stats.files)} ${formatNumber(stats.lines)} ${percentage.padStart(7)}%`);
  }
  
  console.log();
  console.log('='.repeat(60));
  console.log(`  📁 总文件数: ${totalFiles}`);
  console.log(`  📝 总代码行: ${totalLines.toLocaleString()}`);
  console.log('='.repeat(60));
  
  // 返回结果供程序使用
  return {
    totalFiles,
    totalLines,
    byDirectory: results,
    byExtension: extStats
  };
}

// 执行
main();
