/**
 * KB 数据回填脚本
 * 将 knowledge_bases / kb_articles / kb_sections / kb_paragraphs 迁移到统一文档平台
 * 
 * 映射策略（每篇文章一文档一版本）：
 * - kb_articles → doc_documents
 * - 每个 document 创建一个初始 version
 * - kb_sections → doc_chunks (chunk_type='section')
 * - kb_paragraphs → doc_chunks (chunk_type='paragraph')
 * - kb_paragraphs.embedding → doc_chunks.embedding_vector
 * - kb_tags → doc_tags
 * - kb_article_tags → doc_document_tags
 * 
 * 使用方法：
 * node scripts/migrate-kb-to-doc-platform.js
 * 
 * 环境变量：
 * - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD: 数据库连接信息
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFile();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'touwaka_mate',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

const BATCH_SIZE = 100;
const SOURCE_SYSTEM = 'kb';

const report = {
  timestamp: new Date().toISOString(),
  documents: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  versions: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  content_units: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  embeddings: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  tags: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  document_tags: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  errors: [],
};

async function main() {
  console.log('🔄 KB 数据回填脚本');
  console.log('='.repeat(60));
  console.log(`📌 数据库: ${dbConfig.database}@${dbConfig.host}:${dbConfig.port}`);
  console.log(`📌 策略: 每篇文章一文档一版本`);
  console.log('='.repeat(60));

  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功\n');

    await migrateArticles(connection);
    await migrateSections(connection);
    await migrateParagraphs(connection);
    await migrateTags(connection);
    await migrateArticleTags(connection);

    console.log('\n' + '='.repeat(60));
    console.log('📊 回填统计');
    console.log('='.repeat(60));
    console.log(`  文档: ${report.documents.migrated}/${report.documents.total} (跳过 ${report.documents.skipped}, 失败 ${report.documents.failed})`);
    console.log(`  版本: ${report.versions.migrated}/${report.versions.total}`);
    console.log(`  内容单元: ${report.content_units.migrated}/${report.content_units.total}`);
    console.log(`  向量: ${report.embeddings.migrated}/${report.embeddings.total}`);
    console.log(`  标签: ${report.tags.migrated}/${report.tags.total}`);
    console.log(`  文档标签: ${report.document_tags.migrated}/${report.document_tags.total}`);

    if (report.errors.length > 0) {
      console.log('\n❌ 错误详情:');
      report.errors.forEach(err => console.log(`  - ${err}`));
    }

    const outputPath = path.join(process.cwd(), 'temp', 'kb-migration-report.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\n📁 详细报告: ${outputPath}`);

  } catch (error) {
    console.error('\n❌ 回填失败:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

async function migrateArticles(connection) {
  console.log('\n📝 1. 迁移文章 → 文档+版本');

  const [articles] = await connection.query(`
    SELECT a.*, kb.owner_id, kb.visibility, kb.embedding_model_id, kb.embedding_dim
    FROM kb_articles a
    JOIN knowledge_bases kb ON a.kb_id = kb.id
  `);

  report.documents.total = articles.length;
  report.versions.total = articles.length;

  for (const article of articles) {
    try {
      const existing = await checkExisting(connection, 'doc_documents', article.id);
      if (existing) {
        report.documents.skipped++;
        report.versions.skipped++;
        continue;
      }

      const visibility = kbVisibilityToDoc(article.visibility);

      await connection.execute(`
        INSERT INTO doc_documents (
          id, doc_type, source_system, source_ref_id, title,
          owner_id, org_id, visibility, current_version_id, lifecycle_status,
          metadata, created_at, updated_at
        ) VALUES (
          ?, 'knowledge', ?, ?, ?, ?, ?, ?, ?, 'active',
          ?, ?, ?
        )
      `, [
        article.id,
        SOURCE_SYSTEM,
        article.id,
        article.title,
        article.owner_id,
        article.owner_id,
        visibility,
        article.id,
        JSON.stringify({
          kb_id: article.kb_id,
          source_type: article.source_type,
          source_url: article.source_url,
          file_path: article.file_path,
          original_status: article.status,
          summary: article.summary,
          embedding_model_id: article.embedding_model_id,
          embedding_dim: article.embedding_dim,
        }),
        article.created_at,
        article.updated_at,
      ]);

      report.documents.migrated++;

      await connection.execute(`
        INSERT INTO doc_versions (
          id, document_id, version_no, version_label, version_status,
          is_current, created_by, effective_from, published_at,
          metadata, created_at, updated_at
        ) VALUES (
          ?, ?, 1, 'v1', 'effective', 1, ?, ?, ?, ?, ?, ?
        )
      `, [
        article.id,
        article.id,
        article.owner_id,
        article.created_at,
        article.created_at,
        JSON.stringify({ original_article_id: article.id }),
        article.created_at,
        article.updated_at,
      ]);

      report.versions.migrated++;
      console.log(`  ✓ ${article.id}: ${article.title}`);

    } catch (e) {
      report.documents.failed++;
      report.versions.failed++;
      report.errors.push(`文档 ${article.id}: ${e.message}`);
      console.log(`  ❌ ${article.id}: ${e.message}`);
    }
  }
}

function kbVisibilityToDoc(kbVisibility) {
  const map = {
    'owner': 'private',
    'department': 'org',
    'all': 'public',
  };
  return map[kbVisibility] || 'private';
}

async function migrateSections(connection) {
  console.log('\n📚 2. 迁移章节 → 内容单元');

  const [sections] = await connection.query(`
    SELECT s.*, a.kb_id
    FROM kb_sections s
    JOIN kb_articles a ON s.article_id = a.id
  `);

  report.content_units.total += sections.length;

  const sectionIdMap = new Map();

  for (const section of sections) {
    try {
      const existing = await checkExisting(connection, 'doc_chunks', section.id);
      if (existing) {
        report.content_units.skipped++;
        sectionIdMap.set(section.id, section.id);
        continue;
      }

      await connection.execute(`
        INSERT INTO doc_chunks (
          id, version_id, parent_id, unit_type, title,
          content, position, level, path, is_knowledge_point,
          metadata, created_at, updated_at
        ) VALUES (
          ?, ?, NULL, 'section', ?, NULL, ?, ?, NULL, 0,
          ?, ?, ?
        )
      `, [
        section.id,
        section.article_id,
        section.title,
        section.position,
        section.level,
        JSON.stringify({ kb_id: section.kb_id, original_section_id: section.id }),
        section.created_at,
        section.updated_at,
      ]);

      sectionIdMap.set(section.id, section.id);
      report.content_units.migrated++;
      console.log(`  ✓ 章节 ${section.id}: ${section.title}`);

    } catch (e) {
      report.content_units.failed++;
      report.errors.push(`章节 ${section.id}: ${e.message}`);
    }
  }

  return sectionIdMap;
}

async function migrateParagraphs(connection) {
  console.log('\n📄 3. 迁移段落 → 内容单元');

  const [paragraphs] = await connection.query(`
    SELECT p.id, p.section_id, p.title, p.content, p.is_knowledge_point, 
           p.position, p.token_count, p.created_at, p.updated_at,
           s.article_id, a.kb_id, p.embedding
    FROM kb_paragraphs p
    JOIN kb_sections s ON p.section_id = s.id
    JOIN kb_articles a ON s.article_id = a.id
  `);

  report.content_units.total += paragraphs.length;
  report.embeddings.total = paragraphs.length;

  for (const paragraph of paragraphs) {
    try {
      const existing = await checkExisting(connection, 'doc_chunks', paragraph.id);
      if (existing) {
        report.content_units.skipped++;
      } else {
        const isKnowledgePoint = paragraph.is_knowledge_point ? 
          (typeof paragraph.is_knowledge_point === 'object' && paragraph.is_knowledge_point.data ? 
            paragraph.is_knowledge_point.data[0] : 1) : 0;

        await connection.execute(`
          INSERT INTO doc_chunks (
            id, version_id, parent_id, unit_type, title,
            content, position, level, path, token_count, is_knowledge_point,
            metadata, created_at, updated_at
          ) VALUES (
            ?, ?, ?, 'paragraph', ?, ?, ?, 2, NULL, ?, ?,
            ?, ?, ?
          )
        `, [
          paragraph.id,
          paragraph.article_id,
          paragraph.section_id,
          paragraph.title,
          paragraph.content,
          paragraph.position,
          paragraph.token_count,
          isKnowledgePoint,
          JSON.stringify({ kb_id: paragraph.kb_id, original_paragraph_id: paragraph.id }),
          paragraph.created_at,
          paragraph.updated_at,
        ]);

        report.content_units.migrated++;
      }

      const hasEmbedding = paragraph.embedding && 
        ((paragraph.embedding.type === 'Buffer' && paragraph.embedding.data) ||
         Buffer.isBuffer(paragraph.embedding));
      
      if (hasEmbedding) {
        await migrateSingleEmbedding(connection, paragraph);
      }

      console.log(`  ✓ 段落 ${paragraph.id}: ${paragraph.title?.substring(0, 20) || '(无标题)'}`);

    } catch (e) {
      report.content_units.failed++;
      report.errors.push(`段落 ${paragraph.id}: ${e.message}`);
    }
  }
}

async function migrateSingleEmbedding(connection, paragraph) {
  try {
    const existing = await checkExisting(connection, 'doc_chunks', paragraph.id);
    if (existing) {
      report.embeddings.skipped++;
      return;
    }

    let embeddingBuffer;
    if (paragraph.embedding && paragraph.embedding.type === 'Buffer' && paragraph.embedding.data) {
      embeddingBuffer = Buffer.from(paragraph.embedding.data);
    } else if (Buffer.isBuffer(paragraph.embedding)) {
      embeddingBuffer = paragraph.embedding;
    } else {
      console.log(`  ⚠️ 向量 ${paragraph.id}: 无法识别的 embedding 格式`);
      report.embeddings.failed++;
      return;
    }

    const embeddingArray = [];
    for (let i = 0; i < embeddingBuffer.length; i += 4) {
      const value = embeddingBuffer.readFloatLE(i);
      embeddingArray.push(value);
    }

    const embeddingJson = JSON.stringify(embeddingArray);

    const [kbInfo] = await connection.query(`
      SELECT kb.embedding_model_id, kb.embedding_dim
      FROM kb_paragraphs p
      JOIN kb_sections s ON p.section_id = s.id
      JOIN kb_articles a ON s.article_id = a.id
      JOIN knowledge_bases kb ON a.kb_id = kb.id
      WHERE p.id = ?
    `, [paragraph.id]);

    const embeddingModelId = kbInfo[0]?.embedding_model_id || null;
    const originalDim = kbInfo[0]?.embedding_dim || embeddingArray.length;

    await connection.execute(`
      INSERT INTO doc_chunks (
        id, content_unit_id, version_id, document_id,
        embedding_model_id, embedding_dim, embedding_vector, embedding_status,
        embedded_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, VEC_FromText(?), 'ready', ?, ?, ?
      )
    `, [
      paragraph.id,
      paragraph.id,
      paragraph.article_id,
      paragraph.article_id,
      embeddingModelId,
      originalDim,
      embeddingJson,
      paragraph.updated_at,
      paragraph.created_at,
      paragraph.updated_at,
    ]);

    report.embeddings.migrated++;
    console.log(`    ✓ 向量 ${paragraph.id} 已迁移 (${embeddingArray.length}维)`);

  } catch (e) {
    report.embeddings.failed++;
    report.errors.push(`向量 ${paragraph.id}: ${e.message}`);
  }
}

async function migrateTags(connection) {
  console.log('\n🏷️ 4. 迁移标签 → 统一标签体系');

  const [tags] = await connection.query(`
    SELECT t.*, kb.owner_id
    FROM kb_tags t
    JOIN knowledge_bases kb ON t.kb_id = kb.id
  `);

  report.tags.total = tags.length;

  for (const tag of tags) {
    try {
      const existing = await checkExisting(connection, 'doc_tags', tag.id);
      if (existing) {
        report.tags.skipped++;
        continue;
      }

      await connection.execute(`
        INSERT INTO doc_tags (
          id, org_id, name, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        tag.id,
        tag.owner_id,
        tag.name,
        tag.description || null,
        tag.created_at,
        tag.created_at,
      ]);

      report.tags.migrated++;
      console.log(`  ✓ 标签 ${tag.id}: ${tag.name}`);

    } catch (e) {
      report.tags.failed++;
      report.errors.push(`标签 ${tag.id}: ${e.message}`);
    }
  }
}

async function migrateArticleTags(connection) {
  console.log('\n🔗 5. 迁移文章标签关联 → 文档标签关联');

  const [articleTags] = await connection.query('SELECT * FROM kb_article_tags');

  report.document_tags.total = articleTags.length;

  for (const at of articleTags) {
    try {
      const id = crypto.randomUUID().replace(/-/g, '').substring(0, 32);
      const existing = await checkExisting(connection, 'doc_document_tags', id);
      if (existing) {
        report.document_tags.skipped++;
        continue;
      }

      await connection.execute(`
        INSERT INTO doc_document_tags (
          id, document_id, tag_id, created_at
        ) VALUES (?, ?, ?, ?)
      `, [
        id,
        at.article_id,
        at.tag_id,
        at.created_at,
      ]);

      report.document_tags.migrated++;

    } catch (e) {
      report.document_tags.failed++;
      report.errors.push(`文档标签 ${at.article_id}-${at.tag_id}: ${e.message}`);
    }
  }

  console.log(`  ✓ 关联 ${report.document_tags.migrated} 条`);
}

async function checkExisting(connection, table, id) {
  const [rows] = await connection.query(
    `SELECT id FROM ${table} WHERE id = ?`,
    [id]
  );
  return rows.length > 0;
}

main();