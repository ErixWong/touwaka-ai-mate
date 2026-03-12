/**
 * 更新 kb-editor 技能的工具定义
 * 
 * 功能：
 * - 更新 create_paragraph 和 update_paragraph 工具的描述
 * - 强调"严格保留原文"的核心原则
 * 
 * 使用方法：
 *   node scripts/update-kb-editor-tools.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// 需要更新的工具定义
const TOOL_UPDATES = [
  {
    name: 'create_paragraph',
    description: '创建段落（可标记为知识点）。⚠️核心原则：content必须是原文完整复制，禁止提炼、总结、改写或省略。即使原文很长也要完整录入。',
    parameters: {
      type: 'object',
      properties: {
        kb_id: { type: 'string', description: '知识库 ID' },
        section_id: { type: 'string', description: '所属节 ID' },
        title: { type: 'string', description: '段落标题' },
        content: { type: 'string', description: '段落内容（必须是原文完整复制，禁止提炼、总结、改写、省略或截断）' },
        context: { type: 'string', description: '知识点上下文（可选）。当 is_knowledge_point 为 true 时，使用一两句话总结该知识点及其所在文章（中文），便于语义检索' },
        is_knowledge_point: { type: 'boolean', description: '是否为知识点，默认 false' },
        token_count: { type: 'integer', description: 'Token 数量，默认 0' },
      },
      required: ['kb_id', 'section_id', 'content'],
    },
  },
  {
    name: 'update_paragraph',
    description: '更新段落。⚠️核心原则：content必须是原文完整复制，禁止提炼、总结、改写或省略。',
    parameters: {
      type: 'object',
      properties: {
        kb_id: { type: 'string', description: '知识库 ID' },
        id: { type: 'string', description: '段落 ID' },
        title: { type: 'string', description: '新标题' },
        content: { type: 'string', description: '新内容（必须是原文完整复制，禁止提炼、总结、改写、省略或截断）' },
        context: { type: 'string', description: '知识点上下文（可选）。当 is_knowledge_point 为 true 时，使用一两句话总结该知识点及其所在文章（中文），便于语义检索' },
        is_knowledge_point: { type: 'boolean', description: '是否为知识点' },
        token_count: { type: 'integer', description: 'Token 数量' },
      },
      required: ['kb_id', 'id'],
    },
  },
];

async function updateTools() {
  let connection;

  try {
    console.log('🔗 连接数据库...');
    connection = await mysql.createConnection(DB_CONFIG);

    // 查找 kb-editor 技能（可能是随机 ID 或 'kb-editor'）
    const [skills] = await connection.execute(
      "SELECT id, name FROM skills WHERE id = 'kb-editor' OR name LIKE '%KB Editor%' OR name LIKE '%知识库编辑%'"
    );

    if (skills.length === 0) {
      console.log('⚠️ KB Editor 技能不存在，需要先注册技能');
      return;
    }

    const skillId = skills[0].id;
    console.log(`✅ 找到技能: ${skills[0].name} (ID: ${skillId})`);

    // 更新工具定义
    for (const tool of TOOL_UPDATES) {
      const [result] = await connection.execute(
        `UPDATE skill_tools
         SET description = ?, parameters = ?, updated_at = NOW()
         WHERE skill_id = ? AND name = ?`,
        [tool.description, JSON.stringify(tool.parameters), skillId, tool.name]
      );

      if (result.affectedRows > 0) {
        console.log(`  ✓ 更新工具: ${tool.name}`);
      } else {
        console.log(`  ⚠ 工具不存在: ${tool.name}`);
      }
    }

    console.log('\n✅ 更新完成!');

  } catch (error) {
    console.error('\n❌ 更新失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// 检查环境变量
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

updateTools();