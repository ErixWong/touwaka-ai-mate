/**
 * 导入 Markdown 文件到知识库的脚本
 * 
 * 使用方法：
 * node scripts/import-md-to-kb.js <md文件或目录路径> [知识库ID]
 * 
 * 示例：
 * node scripts/import-md-to-kb.js ./data/work/xxx/output/guide_new.md
 * node scripts/import-md-to-kb.js ./data/work/xxx/output/guide_new.md kb_123456
 * 
 * 环境变量：
 * - API_BASE: API 地址，默认 http://localhost:3000
 * - USER_ACCESS_TOKEN: 用户访问令牌（可选，脚本会自动生成管理员 token）
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API 配置
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
let USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN || '';

// 从命令行参数获取路径
const targetPath = process.argv[2];
const providedKbId = process.argv[3];

if (!targetPath) {
  console.error('❌ 请提供 MD 文件或目录路径');
  console.log('使用方法: node scripts/import-md-to-kb.js <md文件或目录路径> [知识库ID]');
  process.exit(1);
}

/**
 * 生成管理员访问令牌
 */
function generateAdminToken() {
  // 使用默认管理员 ID 和角色
  const adminUserId = 'admin_00000000000000000000';
  const adminRole = 'admin';
  return jwt.sign({ userId: adminUserId, role: adminRole }, JWT_SECRET, { expiresIn: '1h' });
}

/**
 * 发起 HTTP 请求
 */
function httpRequest(method, reqPath, data) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(reqPath, API_BASE);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 3000),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${USER_ACCESS_TOKEN}`,
      },
      timeout: 30000,
    };

    const req = httpModule.request(requestOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 204) {
          resolve({ success: true });
          return;
        }
        try {
          const json = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json.data || json);
          } else {
            reject(new Error(json.message || json.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Request failed: ${e.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * 获取知识库列表
 */
async function getKnowledgeBases() {
  return await httpRequest('GET', '/api/kb?page=1&pageSize=10');
}

/**
 * 创建文章
 */
async function createArticle(kbId, title, summary, sourcePath) {
  return await httpRequest('POST', `/api/kb/${kbId}/articles`, {
    title,
    summary,
    source_type: 'upload',
    file_path: sourcePath,
    status: 'processing',
  });
}

/**
 * 创建节
 */
async function createSection(kbId, articleId, parentId, title) {
  return await httpRequest('POST', `/api/kb/${kbId}/sections`, {
    article_id: articleId,
    parent_id: parentId,
    title,
  });
}

/**
 * 创建段落
 */
async function createParagraph(kbId, sectionId, title, content, isKnowledgePoint = false) {
  return await httpRequest('POST', `/api/kb/${kbId}/paragraphs`, {
    section_id: sectionId,
    title,
    content,
    is_knowledge_point: isKnowledgePoint,
    token_count: 0,
  });
}

/**
 * 解析 Markdown 文件内容为结构化数据
 * 基于观察到的格式：## 第 X 页，### 标题 等
 */
function parseMarkdownContent(content, filename) {
  const lines = content.split('\n');
  const sections = [];
  let currentSection = null;
  let currentContent = [];
  let sectionLevel = 1;

  // 从文件名提取文章标题
  const articleTitle = path.basename(filename, '.md').replace(/_cn$/, '');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 检测顶级标题 (# 开头)
    if (trimmedLine.startsWith('# ') && !trimmedLine.startsWith('## ')) {
      // 如果有当前节，先保存
      if (currentSection && currentContent.length > 0) {
        currentSection.content = currentContent.join('\n').trim();
        sections.push(currentSection);
      }
      currentSection = {
        level: 1,
        title: trimmedLine.substring(2).trim(),
        content: '',
        children: [],
      };
      currentContent = [];
      sectionLevel = 1;
    }
    // 检测 "## 第 X 页" 格式 - 作为顶级节
    else if (trimmedLine.match(/^##\s+第\s*\d+\s*页/)) {
      if (currentSection && currentContent.length > 0) {
        currentSection.content = currentContent.join('\n').trim();
        sections.push(currentSection);
      }
      currentSection = {
        level: 1,
        title: trimmedLine.substring(3).trim(),
        content: '',
        children: [],
      };
      currentContent = [];
      sectionLevel = 1;
    }
    // 检测 "## 第X章" 格式 - 作为顶级节
    else if (trimmedLine.match(/^##\s+第\s*\d+\s*章/)) {
      if (currentSection && currentContent.length > 0) {
        currentSection.content = currentContent.join('\n').trim();
        sections.push(currentSection);
      }
      currentSection = {
        level: 1,
        title: trimmedLine.substring(3).trim(),
        content: '',
        children: [],
      };
      currentContent = [];
      sectionLevel = 1;
    }
    // 检测二级标题 (## 开头，但不是"第 X 页/章")
    else if (trimmedLine.startsWith('## ') && !trimmedLine.match(/^##\s+第\s*\d+\s*[页章]/)) {
      if (currentSection && currentContent.length > 0) {
        currentSection.content = currentContent.join('\n').trim();
        sections.push(currentSection);
      }
      currentSection = {
        level: 2,
        title: trimmedLine.substring(3).trim(),
        content: '',
        children: [],
      };
      currentContent = [];
      sectionLevel = 2;
    }
    // 检测三级标题 (### 开头)
    else if (trimmedLine.startsWith('### ')) {
      if (currentSection && currentContent.length > 0) {
        currentSection.content = currentContent.join('\n').trim();
        sections.push(currentSection);
      }
      currentSection = {
        level: 3,
        title: trimmedLine.substring(4).trim(),
        content: '',
        children: [],
      };
      currentContent = [];
      sectionLevel = 3;
    }
    // 检测分隔线
    else if (trimmedLine === '---') {
      // 分隔线不处理，继续
    }
    // 普通内容
    else if (currentSection) {
      // 跳过空行太多的情况
      if (trimmedLine || currentContent.length > 0) {
        currentContent.push(line);
      }
    }
  }

  // 保存最后一个节
  if (currentSection) {
    currentSection.content = currentContent.join('\n').trim();
    sections.push(currentSection);
  }

  return {
    articleTitle,
    sections,
  };
}

/**
 * 导入单个 MD 文件到知识库
 */
async function importMarkdownFile(filePath, kbId) {
  console.log(`\n📄 处理文件: ${filePath}`);

  // 读取文件内容
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);

  // 解析 Markdown 结构
  const { articleTitle, sections } = parseMarkdownContent(content, filename);

  console.log(`   文章标题: ${articleTitle}`);
  console.log(`   解析出 ${sections.length} 个节`);

  // 创建文章
  const article = await createArticle(kbId, articleTitle, `导入自文件: ${filename}`, filePath);
  const articleId = article.id;
  console.log(`   ✅ 创建文章: ${articleId}`);

  // 用于跟踪父节 ID（按层级）
  const parentMap = { 0: null, 1: null, 2: null, 3: null };
  let paragraphCount = 0;

  // 创建节和段落
  for (const section of sections) {
    const level = section.level;
    const parentId = parentMap[level - 1] || null;

    // 创建节
    const sectionResult = await createSection(kbId, articleId, parentId, section.title);
    const sectionId = sectionResult.id;
    console.log(`   📁 创建节 [L${level}]: ${section.title} (${sectionId})`);

    // 更新父节映射
    parentMap[level] = sectionId;

    // 如果有内容，创建段落
    if (section.content && section.content.trim()) {
      // 将内容拆分为多个段落（如果太长）
      const maxChunkSize = 2000;
      const contentChunks = [];
      let remaining = section.content.trim();

      while (remaining.length > 0) {
        if (remaining.length <= maxChunkSize) {
          contentChunks.push(remaining);
          break;
        }

        // 尝试在句子或段落边界切分
        let splitPos = maxChunkSize;
        const searchStart = Math.max(maxChunkSize - 500, 0);

        // 查找合适的分割点
        const breakPoints = ['\n\n', '\n', '。', '！', '？', '.', '!', '?'];
        for (const bp of breakPoints) {
          const idx = remaining.lastIndexOf(bp, maxChunkSize);
          if (idx > searchStart) {
            splitPos = idx + bp.length;
            break;
          }
        }

        contentChunks.push(remaining.substring(0, splitPos).trim());
        remaining = remaining.substring(splitPos).trim();
      }

      // 创建段落
      for (let i = 0; i < contentChunks.length; i++) {
        const chunk = contentChunks[i];
        if (!chunk || chunk.length < 10) continue;

        const paragraphTitle = contentChunks.length > 1 
          ? `${section.title} (${i + 1}/${contentChunks.length})`
          : section.title;

        // 判断是否为知识点（内容较长的段落视为知识点）
        const isKnowledgePoint = chunk.length > 100;

        await createParagraph(kbId, sectionId, paragraphTitle, chunk, isKnowledgePoint);
        paragraphCount++;
      }
    }
  }

  console.log(`   ✅ 创建了 ${paragraphCount} 个段落`);
  return { articleId, sectionCount: sections.length, paragraphCount };
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('🚀 开始导入 Markdown 文件到知识库');
    console.log(`📁 目标路径: ${targetPath}`);
    console.log(`🌐 API 地址: ${API_BASE}`);

    // 如果没有提供 token，生成管理员 token
    if (!USER_ACCESS_TOKEN) {
      console.log('\n🔑 未提供 USER_ACCESS_TOKEN，生成管理员令牌...');
      USER_ACCESS_TOKEN = generateAdminToken();
      console.log('   ✅ 已生成管理员令牌');
    }

    // 获取知识库
    let kbId = providedKbId;
    if (!kbId) {
      console.log('\n📋 获取知识库列表...');
      const kbList = await getKnowledgeBases();

      if (!kbList.items || kbList.items.length === 0) {
        console.error('❌ 没有可用的知识库');
        process.exit(1);
      }

      kbId = kbList.items[0].id;
      console.log(`   使用第一个知识库: ${kbList.items[0].name} (${kbId})`);
    } else {
      console.log(`\n📋 使用指定的知识库: ${kbId}`);
    }

    // 检查目标路径
    const resolvedPath = path.resolve(targetPath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`❌ 路径不存在: ${resolvedPath}`);
      process.exit(1);
    }

    // 收集 MD 文件
    const mdFiles = [];
    if (fs.statSync(resolvedPath).isFile()) {
      if (resolvedPath.endsWith('.md')) {
        mdFiles.push(resolvedPath);
      } else {
        console.error(`❌ 不是 Markdown 文件: ${resolvedPath}`);
        process.exit(1);
      }
    } else {
      // 目录，扫描 MD 文件
      const files = fs.readdirSync(resolvedPath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          mdFiles.push(path.join(resolvedPath, file));
        }
      }
    }

    if (mdFiles.length === 0) {
      console.error('❌ 没有找到 Markdown 文件');
      process.exit(1);
    }

    console.log(`\n📚 找到 ${mdFiles.length} 个 Markdown 文件`);

    // 导入每个文件
    const results = [];
    for (const mdFile of mdFiles) {
      try {
        const result = await importMarkdownFile(mdFile, kbId);
        results.push({ file: mdFile, ...result, success: true });
      } catch (error) {
        console.error(`   ❌ 导入失败: ${error.message}`);
        results.push({ file: mdFile, success: false, error: error.message });
      }
    }

    // 输出总结
    console.log('\n' + '='.repeat(50));
    console.log('📊 导入总结:');
    console.log('='.repeat(50));

    let totalSections = 0;
    let totalParagraphs = 0;
    let successCount = 0;

    for (const result of results) {
      if (result.success) {
        console.log(`✅ ${path.basename(result.file)}: ${result.sectionCount} 节, ${result.paragraphCount} 段落`);
        totalSections += result.sectionCount;
        totalParagraphs += result.paragraphCount;
        successCount++;
      } else {
        console.log(`❌ ${path.basename(result.file)}: ${result.error}`);
      }
    }

    console.log('='.repeat(50));
    console.log(`总计: ${successCount}/${mdFiles.length} 文件成功`);
    console.log(`      ${totalSections} 节, ${totalParagraphs} 段落`);
    console.log('🎉 导入完成!');

  } catch (error) {
    console.error('❌ 导入失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();