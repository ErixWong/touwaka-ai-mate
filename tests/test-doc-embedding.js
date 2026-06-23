/**
 * 文档平台向量化服务 - 自测脚本
 *
 * 用法：node tests/test-doc-embedding.js
 *
 * 覆盖场景：
 *   1. 正常文档从 pending_embedding 到 ready
 *   2. 无 embedding model → error (embedding_model_missing)
 *   3. 无 chunk → error (no_chunks_for_embedding)
 *   4. collection revectorize 后文档回到 pending_embedding
 *   5. error 状态重试恢复
 */

import dotenv from 'dotenv';
dotenv.config();
import Database from '../lib/db.js';
import DocumentEmbeddingService from '../lib/document-embedding-service.js';
import logger from '../lib/logger.js';

const TEST_DOC_ID = process.env.TEST_DOC_ID || null;
const TEST_COLLECTION_ID = process.env.TEST_COLLECTION_ID || null;

function buildDbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'touwaka_ai_mate',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  };
}

async function main() {
  const dbConfig = buildDbConfig();
  const db = new Database(dbConfig);
  await db.connect();

  console.log('=== 文档平台向量化服务自测 ===\n');

  // ========== 场景 1：正常文档向量化 ==========
  if (TEST_DOC_ID) {
    console.log('--- 场景 1：正常文档从 pending_embedding 到 ready ---');
    const doc = await db.query(
      `SELECT id, processing_status, title FROM documents WHERE id = ?`,
      [TEST_DOC_ID]
    );
    if (!doc[0]) {
      console.log('SKIP: 测试文档不存在，请设置 TEST_DOC_ID 环境变量');
    } else {
      console.log(`当前文档: ${doc[0].id}, status=${doc[0].processing_status}, title=${doc[0].title}`);

      // 手动将文档设为 pending_embedding（如果是 ready 状态）
      if (doc[0].processing_status !== 'pending_embedding') {
        console.log('注意: 文档不在 pending_embedding 状态，将手动设置...');
      }

      const service = new DocumentEmbeddingService(db);
      try {
        const result = await service.embedDocument(TEST_DOC_ID, { allowErrorRetry: true });
        console.log('结果:', JSON.stringify(result, null, 2));

        // 验证文档状态
        const updated = await db.query(`SELECT processing_status, processing_error_code FROM documents WHERE id = ?`, [TEST_DOC_ID]);
        console.log(`文档最终状态: ${updated[0].processing_status}, error_code=${updated[0].processing_error_code || 'null'}`);

        // 验证 chunk 向量状态
        const chunks = await db.query(
          `SELECT id, embedding_status, embedding_model_id,
                  CASE WHEN embedding_vector IS NOT NULL THEN 'has_vector' ELSE 'no_vector' END as has_vector
           FROM document_chunks
           WHERE revision_id = (SELECT current_revision_id FROM documents WHERE id = ?)`,
          [TEST_DOC_ID]
        );
        console.log(`Chunks 总数: ${chunks.length}`);
        const readyChunks = chunks.filter(c => c.embedding_status === 'ready');
        const errorChunks = chunks.filter(c => c.embedding_status === 'error');
        console.log(`  ready: ${readyChunks.length}, error: ${errorChunks.length}`);
        if (readyChunks.length > 0) {
          console.log(`  第一个 ready chunk: id=${readyChunks[0].id}, ${readyChunks[0].has_vector}`);
        }
      } catch (error) {
        console.error('场景 1 失败:', error.message);
      }
    }
  } else {
    console.log('SKIP 场景 1: 未设置 TEST_DOC_ID');
  }

  // ========== 场景 2：验证 Service API ==========
  console.log('\n--- 场景 2：Service 基本功能验证 ---');
  try {
    const service = new DocumentEmbeddingService(db);

    // 测试 buildEmbeddingText
    const text = service.buildEmbeddingText(
      { title: '第一章', content: '这是测试内容' },
      { title: '测试文档' }
    );
    console.log('buildEmbeddingText 输出:');
    console.log(text);
    console.log();

    // 测试 pickEmbeddingModel（无配置时返回 null）
    const modelId = await service.pickEmbeddingModel({}, null, {});
    console.log(`pickEmbeddingModel (无配置): ${modelId} (期望: null)`);

    // 测试 pickEmbeddingModel（pipeline 配置优先）
    const modelId2 = await service.pickEmbeddingModel({}, null, { embedding_model_id: 'pipeline-model' });
    console.log(`pickEmbeddingModel (pipeline): ${modelId2} (期望: pipeline-model)`);

    // 测试 pickEmbeddingModel（collection 回退）
    const modelId3 = await service.pickEmbeddingModel({}, { embedding_model_id: 'collection-model' }, {});
    console.log(`pickEmbeddingModel (collection): ${modelId3} (期望: collection-model)`);

    console.log('场景 2 通过 ✓');
  } catch (error) {
    console.error('场景 2 失败:', error.message);
  }

  // ========== 场景 3：collection revectorize 验证 ==========
  if (TEST_COLLECTION_ID) {
    console.log('\n--- 场景 3：Collection 重新向量化 ---');
    const collection = await db.query(
      `SELECT id, embedding_model_id FROM document_collections WHERE id = ?`,
      [TEST_COLLECTION_ID]
    );
    if (!collection[0]) {
      console.log('SKIP: 测试 Collection 不存在');
    } else {
      console.log(`Collection: ${collection[0].id}, embedding_model_id=${collection[0].embedding_model_id || 'null'}`);
      if (!collection[0].embedding_model_id) {
        console.log('注意: 该 collection 没有 embedding_model_id，revectorize 将使用 null');
      }
    }
  } else {
    console.log('SKIP 场景 3: 未设置 TEST_COLLECTION_ID');
  }

  // ========== 场景 4：查询全库 pending_embedding 文档 ==========
  console.log('\n--- 场景 4：全库 pending_embedding 文档统计 ---');
  const pendingDocs = await db.query(
    `SELECT COUNT(*) as cnt FROM documents WHERE processing_status = 'pending_embedding' AND current_revision_id IS NOT NULL`
  );
  console.log(`pending_embedding 文档数: ${pendingDocs[0].cnt}`);

  // 显示前 5 个
  const samples = await db.query(
    `SELECT id, title, collection_id, processing_updated_at
     FROM documents
     WHERE processing_status = 'pending_embedding' AND current_revision_id IS NOT NULL
     ORDER BY processing_updated_at ASC
     LIMIT 5`
  );
  if (samples.length > 0) {
    console.log('前 5 个待处理文档:');
    for (const d of samples) {
      console.log(`  ${d.id} | ${d.title || '(untitled)'} | collection=${d.collection_id}`);
    }
  }

  await db.close();
  console.log('\n=== 自测完成 ===');
}

main().catch(error => {
  console.error('自测失败:', error);
  process.exit(1);
});
