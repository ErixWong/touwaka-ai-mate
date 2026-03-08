/**
 * 导入知识库文章脚本
 * 将MD文件内容导入到知识库中
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const API_BASE = 'http://localhost:3000';
const KB_ID = 'mmhjlqhpmr81p7tgx8kp';
const ARTICLE_ID = 'mmi42fcpdlm7m75dylfs';

// 生成JWT token（管理员）
function generateAdminToken() {
  const adminUserId = 'c464d6d1e06b5d5d05c4';
  const adminRole = 'admin';
  const JWT_SECRET = 'your-secret-key-change-in-production';
  return jwt.sign({ userId: adminUserId, role: adminRole }, JWT_SECRET, { expiresIn: '1h' });
}

// HTTP请求
async function httpRequest(method, path, data) {
  const token = generateAdminToken();
  const url = new URL(path, API_BASE);
  
  const response = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }
  
  return await response.json();
}

// 创建节
async function createSection(title, articleId, parentId = null) {
  const result = await httpRequest('POST', `/api/kb/${KB_ID}/sections`, {
    article_id: articleId,
    parent_id: parentId,
    title,
  });
  return result.data || result;
}

// 创建段落
async function createParagraph(sectionId, content, title = null, isKnowledgePoint = false) {
  const result = await httpRequest('POST', `/api/kb/${KB_ID}/paragraphs`, {
    section_id: sectionId,
    title,
    content,
    is_knowledge_point: isKnowledgePoint,
  });
  return result.data || result;
}

// 主函数
async function main() {
  try {
    console.log('🚀 开始导入文章内容...\n');
    
    // 读取MD文件
    const mdPath = path.join(process.cwd(), 'data', 'work', 'c464d6d1e06b5d5d05c4', '16vzgof2fr', 'output', 'guide_new.md', 'skill构建指南_cn.md');
    const content = fs.readFileSync(mdPath, 'utf-8');
    
    // 解析内容（按页分割）
    const pages = content.split(/\n## 第 \d+ 页\n/).filter(p => p.trim());
    
    console.log(`📄 共找到 ${pages.length} 页内容\n`);
    
    // 创建主要章节
    const chapters = [
      { title: '引言', pageIndex: 0 },
      { title: '第一章 基础', pageIndex: 1 },
      { title: '第二章 规划与设计', pageIndex: 2 },
      { title: '第三章 测试与迭代', pageIndex: 3 },
      { title: '第四章 分发与共享', pageIndex: 4 },
      { title: '第五章 模式与故障排除', pageIndex: 5 },
      { title: '第六章 资源与参考文献', pageIndex: 6 },
    ];
    
    // 创建章节和段落
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      console.log(`📚 创建章节: ${chapter.title}`);
      
      // 创建节
      const section = await createSection(chapter.title, ARTICLE_ID);
      console.log(`   ✅ 节ID: ${section.id}`);
      
      // 获取对应页面内容
      const pageContent = pages[chapter.pageIndex] || '';
      
      // 将内容分段（每段不超过2000字符）
      const paragraphs = pageContent.split('\n\n').filter(p => p.trim());
      
      for (let j = 0; j < paragraphs.length; j++) {
        const para = paragraphs[j].trim();
        if (para.length > 10) { // 只添加有意义的段落
          // 判断是否为知识点（包含关键信息的段落）
          const isKnowledgePoint = para.includes('•') || para.includes('：') || para.length > 100;
          
          await createParagraph(
            section.id,
            para.substring(0, 5000), // 限制长度
            null,
            isKnowledgePoint
          );
        }
      }
      
      console.log(`   ✅ 添加了 ${paragraphs.length} 个段落\n`);
    }
    
    console.log('✅ 文章导入完成！');
    
  } catch (error) {
    console.error('❌ 导入失败:', error.message);
    process.exit(1);
  }
}

main();
