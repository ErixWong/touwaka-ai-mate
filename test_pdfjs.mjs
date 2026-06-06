/**
 * 简单测试 pdfjs-dist 能否读取 PDF 文件
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfPath = path.join(__dirname, 'data/attachments/2026/05/29/test_fapiao.pdf');

console.log('=== 测试 pdfjs-dist 读取 PDF ===');
console.log('PDF 路径:', pdfPath);
console.log('文件存在:', fs.existsSync(pdfPath));

async function testPdfJs() {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    
    // 禁用 worker
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }
    
    const dataBuffer = await fs.promises.readFile(pdfPath);
    const uint8Array = new Uint8Array(dataBuffer);
    
    console.log('PDF 文件大小:', dataBuffer.length);
    
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    
    const pdfDocument = await loadingTask.promise;
    console.log('PDF 页数:', pdfDocument.numPages);
    
    // 提取第一页文本
    const page = await pdfDocument.getPage(1);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(' ');
    
    console.log('=== 第一页文本 (前500字符) ===');
    console.log(text.substring(0, 500));
    
    console.log('\n=== 测试成功 ===');
    
  } catch (error) {
    console.error('=== 测试失败 ===');
    console.error('错误:', error.message);
    console.error('堆栈:', error.stack);
  }
}

testPdfJs();