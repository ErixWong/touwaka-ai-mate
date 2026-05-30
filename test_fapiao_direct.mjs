/**
 * 直接测试 fapiao skill 的脚本
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_BASE_PATH = path.join(__dirname, 'data');

console.log('=== 测试 fapiao skill ===');
console.log('DATA_BASE_PATH:', DATA_BASE_PATH);

// 测试路径格式
const testPath = 'attachments/2026/05/29/test_fapiao.pdf';
const fullPath = path.join(DATA_BASE_PATH, testPath);
console.log('测试文件路径:', fullPath);
console.log('文件存在:', fs.existsSync(fullPath));

// 直接加载 fapiao skill 并调用
async function testFapiao() {
  try {
    // 动态导入 fapiao skill
    const fapiaoModule = await import('./data/skills/fapiao/index.js');
    
    // 获取 extract 工具
    const tools = fapiaoModule.getTools();
    const extractTool = tools.find(t => t.name === 'extract');
    
    if (!extractTool) {
      console.error('未找到 extract 工具');
      return;
    }
    
    console.log('找到 extract 工具，调用...');
    
    // 调用 extract
    const result = await extractTool.func({
      path: testPath,
      format: 'json'
    });
    
    console.log('=== fapiao 返回结果 ===');
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('=== fapiao 执行失败 ===');
    console.error('错误:', error.message);
    console.error('堆栈:', error.stack);
  }
}

testFapiao();