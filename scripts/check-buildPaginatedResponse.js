#!/usr/bin/env node
/**
 * 检查 buildPaginatedResponse 调用是否正确
 * 
 * 用法: node scripts/check-buildPaginatedResponse.js
 */

import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';

const CONTROLLERS_DIR = './server/controllers';

// 递归读取目录下的所有 .js 文件
function getJsFiles(dir, files = []) {
  const items = readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const path = join(dir, item.name);
    if (item.isDirectory()) {
      getJsFiles(path, files);
    } else if (extname(item.name) === '.js') {
      files.push(path);
    }
  }
  
  return files;
}

// 检查单个文件
function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const errors = [];
  
  lines.forEach((line, index) => {
    // 跳过注释行和 import 语句
    if (line.trim().startsWith('//') || line.trim().startsWith('import')) {
      return;
    }
    
    // 检查 buildPaginatedResponse 调用
    const match = line.match(/buildPaginatedResponse\s*\(\s*(\w+)/);
    if (match) {
      const firstArg = match[1];
      
      // 错误模式：第一个参数是 rows 或 count（解构后的变量）
      if (firstArg === 'rows' || firstArg === 'count') {
        errors.push({
          line: index + 1,
          content: line.trim(),
          message: `错误：第一个参数应该是 "result" 对象，不应该是解构后的 "${firstArg}"`
        });
      }
      
      // 正确模式：第一个参数应该是 result
      if (firstArg !== 'result' && firstArg !== 'rows' && firstArg !== 'count') {
        // 可能是其他变量名，给出警告
        errors.push({
          line: index + 1,
          content: line.trim(),
          message: `警告：第一个参数是 "${firstArg}"，建议命名为 "result" 以提高可读性`
        });
      }
    }
  });
  
  return errors;
}

// 主函数
function main() {
  console.log('🔍 检查 buildPaginatedResponse 调用...\n');
  
  const files = getJsFiles(CONTROLLERS_DIR);
  let totalErrors = 0;
  let totalWarnings = 0;
  
  for (const file of files) {
    const errors = checkFile(file);
    const realErrors = errors.filter(e => e.message.startsWith('错误'));
    const warnings = errors.filter(e => e.message.startsWith('警告'));
    
    if (realErrors.length > 0 || warnings.length > 0) {
      console.log(`📄 ${file}`);
      
      realErrors.forEach(err => {
        console.log(`   ❌ 第 ${err.line} 行: ${err.message}`);
        console.log(`      ${err.content}`);
        totalErrors++;
      });
      
      warnings.forEach(warn => {
        console.log(`   ⚠️  第 ${warn.line} 行: ${warn.message}`);
        console.log(`      ${warn.content}`);
        totalWarnings++;
      });
      
      console.log();
    }
  }
  
  // 输出总结
  console.log('='.repeat(50));
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log('✅ 所有 buildPaginatedResponse 调用都正确！');
    process.exit(0);
  } else {
    console.log(`发现 ${totalErrors} 个错误，${totalWarnings} 个警告`);
    console.log('\n💡 修复建议：');
    console.log('   const result = await Model.findAndCountAll({...});');
    console.log('   ctx.success(buildPaginatedResponse(result, pagination, startTime));');
    process.exit(1);
  }
}

main();
