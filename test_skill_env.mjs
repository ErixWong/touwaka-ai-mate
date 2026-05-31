/**
 * 模拟 skill-runner 环境测试 fapiao skill
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 模拟 skill-runner 的环境变量
const DATA_BASE_PATH = path.join(__dirname, 'data');
process.env.DATA_BASE_PATH = DATA_BASE_PATH;

// 模拟 skill-runner 设置的 cwd
const originalCwd = process.cwd;
process.cwd = () => DATA_BASE_PATH;

console.log('=== 模拟 skill-runner 环境 ===');
console.log('DATA_BASE_PATH:', DATA_BASE_PATH);
console.log('process.cwd():', process.cwd());

// 测试路径
const testPath = 'attachments/2026/05/29/test_fapiao.pdf';
const fullPath = path.join(DATA_BASE_PATH, testPath);
console.log('完整路径:', fullPath);
console.log('文件存在:', fs.existsSync(fullPath));

// 直接用相对路径读取（模拟 fapiao 的行为）
async function testFapiaoLike() {
  try {
    console.log('\n=== 测试直接用相对路径读取 ===');
    const data = await fs.promises.readFile(testPath);
    console.log('读取成功! 文件大小:', data.length);
  } catch (error) {
    console.error('读取失败:', error.message);
  }
  
  // 测试用完整路径读取
  try {
    console.log('\n=== 测试用完整路径读取 ===');
    const data = await fs.promises.readFile(fullPath);
    console.log('读取成功! 文件大小:', data.length);
  } catch (error) {
    console.error('读取失败:', error.message);
  }
}

testFapiaoLike();