/**
 * 检查知识点向量化状态
 */
import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

async function checkEmbeddingStatus() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log('=== 知识点向量化状态检查 ===\n');

  // 1. 检查知识点总数
  const [totalRows] = await connection.execute(
    'SELECT COUNT(*) as total FROM knowledge_points'
  );
  console.log(`知识点总数: ${totalRows[0].total}`);

  // 2. 检查未向量化的知识点数
  const [pendingRows] = await connection.execute(
    'SELECT COUNT(*) as pending FROM knowledge_points WHERE embedding IS NULL'
  );
  console.log(`未向量化知识点: ${pendingRows[0].pending}`);

  // 3. 检查已向量化的知识点数
  const [vectorizedRows] = await connection.execute(
    'SELECT COUNT(*) as vectorized FROM knowledge_points WHERE embedding IS NOT NULL'
  );
  console.log(`已向量化知识点: ${vectorizedRows[0].vectorized}`);

  // 4. 检查内容为空的知识点
  const [emptyContentRows] = await connection.execute(
    "SELECT COUNT(*) as empty FROM knowledge_points WHERE content IS NULL OR content = ''"
  );
  console.log(`内容为空的知识点: ${emptyContentRows[0].empty}`);

  // 5. 检查文章状态分布
  console.log('\n=== 文章状态分布 ===');
  const [statusRows] = await connection.execute(
    'SELECT status, COUNT(*) as count FROM knowledges GROUP BY status'
  );
  for (const row of statusRows) {
    console.log(`${row.status}: ${row.count}`);
  }

  // 6. 显示前 5 个未向量化的知识点
  console.log('\n=== 前 5 个未向量化的知识点 ===');
  const [pendingPoints] = await connection.execute(`
    SELECT kp.id, kp.knowledge_id, k.title as knowledge_title, LEFT(kp.content, 50) as content_preview
    FROM knowledge_points kp
    LEFT JOIN knowledges k ON kp.knowledge_id = k.id
    WHERE kp.embedding IS NULL AND kp.content IS NOT NULL
    LIMIT 5
  `);
  
  if (pendingPoints.length === 0) {
    console.log('没有未向量化的知识点');
  } else {
    for (const p of pendingPoints) {
      console.log(`- ${p.id} | 文章: ${p.knowledge_title || p.knowledge_id} | 内容: ${p.content_preview}...`);
    }
  }

  await connection.end();
}

checkEmbeddingStatus().catch(console.error);