/**
 * 测试沙箱 fs 模块路径限制
 * 
 * 运行方式：node tests/test-sandbox-fs-restriction.js
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从 skill-runner.js 复制的函数
const FS_PATH_METHODS = new Set([
  'readFileSync', 'readFileSync', 'openSync', 'open', 'fstatSync', 'fstat',
  'readFile', 'read', 'readdir', 'readdirSync',
  'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'mkdirSync', 'mkdir', 'rmdirSync', 'rmdir', 'mkdtempSync', 'mkdtemp',
  'rmSync', 'rm', 'unlinkSync', 'unlink',
  'statSync', 'stat', 'lstatSync', 'lstat', 'existsSync', 'exists', 'accessSync', 'access',
  'renameSync', 'rename', 'copyFileSync', 'copyFile', 'truncateSync', 'truncate',
  'symlinkSync', 'symlink', 'readlinkSync', 'readlink', 'linkSync', 'link',
  'watch', 'watchFile', 'unwatchFile',
  'createReadStream', 'createWriteStream',
]);

function createRestrictedFs(allowedPaths) {
  const checkPath = (filePath) => {
    const pathStr = Buffer.isBuffer(filePath) ? filePath.toString('utf8') : String(filePath);
    let resolvedPath = pathStr;
    
    const absolutePath = path.resolve(resolvedPath);
    
    const isAllowed = allowedPaths.some(allowedPath => {
      const normalizedAllowed = path.resolve(allowedPath);
      return absolutePath.startsWith(normalizedAllowed + path.sep) || 
             absolutePath === normalizedAllowed;
    });
    
    if (!isAllowed) {
      throw new Error(
        `Path not allowed in sandbox: ${absolutePath}\n` +
        `Allowed paths: ${allowedPaths.map(p => path.resolve(p)).join(', ')}`
      );
    }
    
    return absolutePath;
  };

  return new Proxy(fs, {
    get(target, prop) {
      const originalValue = target[prop];
      
      if (FS_PATH_METHODS.has(prop) && typeof originalValue === 'function') {
        return function(...args) {
          if (args.length > 0 && args[0] !== undefined && args[0] !== null) {
            checkPath(args[0]);
          }
          
          if (['rename', 'renameSync', 'copyFile', 'copyFileSync', 'link', 'linkSync'].includes(prop) && args.length > 1) {
            checkPath(args[1]);
          }
          
          return originalValue.apply(target, args);
        };
      }
      
      return originalValue;
    }
  });
}

// 测试用例
async function runTests() {
  const testDataDir = path.join(__dirname, 'test-sandbox-data');
  const outsideDir = path.join(__dirname, 'outside-sandbox');
  
  // 创建测试目录
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  if (!fs.existsSync(outsideDir)) {
    fs.mkdirSync(outsideDir, { recursive: true });
  }
  
  // 创建测试文件
  const allowedFile = path.join(testDataDir, 'allowed.txt');
  const disallowedFile = path.join(outsideDir, 'disallowed.txt');
  
  fs.writeFileSync(allowedFile, 'This file is in allowed path', 'utf-8');
  fs.writeFileSync(disallowedFile, 'This file is outside allowed path', 'utf-8');
  
  // 创建受限 fs
  const restrictedFs = createRestrictedFs([testDataDir]);
  
  console.log('='.repeat(60));
  console.log('沙箱 fs 路径限制测试');
  console.log('='.repeat(60));
  console.log(`允许的路径: ${testDataDir}`);
  console.log(`禁止的路径: ${outsideDir}`);
  console.log('');
  
  let passed = 0;
  let failed = 0;
  
  // 测试 1: 允许读取允许路径内的文件
  try {
    const content = restrictedFs.readFileSync(allowedFile, 'utf-8');
    console.log(`✅ 测试 1 通过: 可以读取允许路径内的文件`);
    passed++;
  } catch (error) {
    console.log(`❌ 测试 1 失败: ${error.message}`);
    failed++;
  }
  
  // 测试 2: 禁止读取允许路径外的文件
  try {
    restrictedFs.readFileSync(disallowedFile, 'utf-8');
    console.log(`❌ 测试 2 失败: 应该禁止读取允许路径外的文件`);
    failed++;
  } catch (error) {
    if (error.message.includes('Path not allowed')) {
      console.log(`✅ 测试 2 通过: 正确阻止了禁止路径的访问`);
      passed++;
    } else {
      console.log(`❌ 测试 2 失败: 错误类型不正确 - ${error.message}`);
      failed++;
    }
  }
  
  // 测试 3: existsSync 检查
  try {
    restrictedFs.existsSync(disallowedFile);
    console.log(`❌ 测试 3 失败: existsSync 应该被阻止`);
    failed++;
  } catch (error) {
    if (error.message.includes('Path not allowed')) {
      console.log(`✅ 测试 3 通过: existsSync 被正确阻止`);
      passed++;
    } else {
      console.log(`❌ 测试 3 失败: 错误类型不正确 - ${error.message}`);
      failed++;
    }
  }
  
  // 测试 4: 允许写入允许路径内的文件
  try {
    const testWriteFile = path.join(testDataDir, 'test-write.txt');
    restrictedFs.writeFileSync(testWriteFile, 'test content', 'utf-8');
    console.log(`✅ 测试 4 通过: 可以写入允许路径内的文件`);
    passed++;
    // 清理
    fs.unlinkSync(testWriteFile);
  } catch (error) {
    console.log(`❌ 测试 4 失败: ${error.message}`);
    failed++;
  }
  
  // 测试 5: 禁止写入允许路径外的文件
  try {
    restrictedFs.writeFileSync(disallowedFile, 'test content', 'utf-8');
    console.log(`❌ 测试 5 失败: 应该禁止写入允许路径外的文件`);
    failed++;
  } catch (error) {
    if (error.message.includes('Path not allowed')) {
      console.log(`✅ 测试 5 通过: 正确阻止了禁止路径的写入`);
      passed++;
    } else {
      console.log(`❌ 测试 5 失败: 错误类型不正确 - ${error.message}`);
      failed++;
    }
  }
  
  // 测试 6: 管理员权限测试（多个允许路径）
  const adminFs = createRestrictedFs([testDataDir, outsideDir]);
  try {
    adminFs.readFileSync(disallowedFile, 'utf-8');
    console.log(`✅ 测试 6 通过: 管理员可以访问多个路径`);
    passed++;
  } catch (error) {
    console.log(`❌ 测试 6 失败: ${error.message}`);
    failed++;
  }
  
  // 测试 7: 非路径方法不应该被阻止
  try {
    const stats = restrictedFs.statSync(allowedFile);
    console.log(`✅ 测试 7 通过: statSync 在允许路径内正常工作`);
    passed++;
  } catch (error) {
    console.log(`❌ 测试 7 失败: ${error.message}`);
    failed++;
  }
  
  // 清理测试文件
  fs.unlinkSync(allowedFile);
  fs.unlinkSync(disallowedFile);
  fs.rmdirSync(testDataDir);
  fs.rmdirSync(outsideDir);
  
  console.log('');
  console.log('='.repeat(60));
  console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(60));
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});