/**
 * i18n 检查脚本
 * 检测 Vue/TS 文件中使用的 $t() key 是否在 locale 文件中定义
 * 
 * 使用方法: node scripts/check-i18n.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目根目录
const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = ROOT_DIR;
const LOCALES_DIR = path.join(FRONTEND_DIR, 'src', 'i18n', 'locales');

// 需要扫描的目录
const SCAN_DIRS = [
  path.join(FRONTEND_DIR, 'src', 'views'),
  path.join(FRONTEND_DIR, 'src', 'components'),
];

// 需要扫描的文件扩展名
const SCAN_EXTENSIONS = ['.vue', '.ts', '.tsx'];

// 需要排除的目录
const EXCLUDE_DIRS = ['node_modules', 'dist', 'dist-ssr', 'coverage'];

/**
 * 递归获取所有文件
 */
function getAllFiles(dir, files = []) {
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(item)) {
        getAllFiles(fullPath, files);
      }
    } else if (SCAN_EXTENSIONS.includes(path.extname(item))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * 从文件内容中提取 $t() 调用的 key
 */
function extractI18nKeys(content) {
  const keys = new Set();
  
  // 匹配 $t('key') 或 $t("key")
  const tRegex = /\$t\(['"]([^'"]+)['"]\)/g;
  let match;
  while ((match = tRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  
  // 匹配 t('key') 或 t("key") - 在 setup 中使用
  const tFuncRegex = /\bt\(['"]([^'"]+)['"]\)/g;
  while ((match = tFuncRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  
  return keys;
}

/**
 * 检查 key 是否存在于 locale 对象中
 */
function checkKeyExists(key, localeObj) {
  const parts = key.split('.');
  let current = localeObj;
  
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return false;
    }
    current = current[part];
  }
  
  return current !== undefined;
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 开始检查 i18n 翻译键...\n');
  
  // 1. 收集所有文件中的 i18n key
  console.log('📁 扫描文件中的 $t() 调用...');
  const allKeys = new Set();
  const fileKeysMap = new Map(); // 记录每个文件使用的 key
  
  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(dir)) {
      console.log(`  ⚠️ 目录不存在: ${dir}`);
      continue;
    }
    
    const files = getAllFiles(dir);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const keys = extractI18nKeys(content);
      
      if (keys.size > 0) {
        const relativePath = path.relative(ROOT_DIR, file);
        fileKeysMap.set(relativePath, keys);
        keys.forEach(k => allKeys.add(k));
      }
    }
  }
  
  console.log(`  ✅ 找到 ${allKeys.size} 个唯一的翻译键\n`);
  
  // 2. 加载 locale 文件
  console.log('📚 加载 locale 文件...');
  const zhCNPath = path.join(LOCALES_DIR, 'zh-CN.ts');
  const enUSPath = path.join(LOCALES_DIR, 'en-US.ts');
  
  if (!fs.existsSync(zhCNPath) || !fs.existsSync(enUSPath)) {
    console.error('❌ 找不到 locale 文件');
    process.exit(1);
  }
  
  // 动态导入 locale 文件
  const zhCNModule = await import(`file://${zhCNPath}`);
  const enUSModule = await import(`file://${enUSPath}`);
  
  const zhCN = zhCNModule.default || zhCNModule;
  const enUS = enUSModule.default || enUSModule;
  
  console.log('  ✅ 已加载 zh-CN.ts 和 en-US.ts\n');
  
  // 3. 检查缺失的 key
  console.log('🔎 检查缺失的翻译键...\n');
  
  const missingInZhCN = [];
  const missingInEnUS = [];
  
  for (const key of allKeys) {
    if (!checkKeyExists(key, zhCN)) {
      missingInZhCN.push(key);
    }
    if (!checkKeyExists(key, enUS)) {
      missingInEnUS.push(key);
    }
  }
  
  // 4. 输出结果
  let hasError = false;
  
  if (missingInZhCN.length > 0) {
    console.log(`❌ 在 zh-CN.ts 中缺失 ${missingInZhCN.length} 个键:`);
    missingInZhCN.forEach(key => {
      // 找出哪些文件使用了这个 key
      const files = [];
      for (const [file, keys] of fileKeysMap) {
        if (keys.has(key)) {
          files.push(file);
        }
      }
      console.log(`   - ${key}`);
      if (files.length > 0) {
        console.log(`     使用位置: ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`);
      }
    });
    console.log('');
    hasError = true;
  }
  
  if (missingInEnUS.length > 0) {
    console.log(`❌ 在 en-US.ts 中缺失 ${missingInEnUS.length} 个键:`);
    missingInEnUS.forEach(key => {
      const files = [];
      for (const [file, keys] of fileKeysMap) {
        if (keys.has(key)) {
          files.push(file);
        }
      }
      console.log(`   - ${key}`);
      if (files.length > 0) {
        console.log(`     使用位置: ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`);
      }
    });
    console.log('');
    hasError = true;
  }
  
  if (!hasError) {
    console.log('✅ 所有翻译键都已正确定义！\n');
    process.exit(0);
  } else {
    console.log('⚠️ 请补充缺失的翻译键到对应的 locale 文件中\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ 检查失败:', err);
  process.exit(1);
});
