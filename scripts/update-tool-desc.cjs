/**
 * 更新 skill_tools 表中 create_point 和 update_point 的参数描述
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'touwaka_mate',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });

  try {
    // 1. 先查看当前状态
    console.log('=== 当前 create_point 工具定义 ===\n');
    const [before] = await pool.query(`
      SELECT name, description, parameters 
      FROM skill_tools 
      WHERE name = 'create_point' 
      AND skill_id = (SELECT id FROM skills WHERE name = 'KB Editor')
    `);
    
    if (before.length > 0) {
      console.log('描述:', before[0].description);
      const params = JSON.parse(before[0].parameters);
      console.log('content 参数:', params.properties.content?.description);
      console.log('context 参数:', params.properties.context?.description);
    }

    // 2. 更新 create_point
    const createPointParams = JSON.stringify({
      type: 'object',
      properties: {
        kb_id: { type: 'string', description: '知识库 ID' },
        knowledge_id: { type: 'string', description: '文章 ID' },
        content: { type: 'string', description: '知识点原文内容（完整保留原文，不要提炼或总结）' },
        title: { type: 'string', description: '知识点标题（可选，用于概括这段内容）' },
        context: { type: 'string', description: '背景总结（可选，提炼这段内容的背景、所属领域、关键概念，用于增强检索）' }
      },
      required: ['kb_id', 'knowledge_id', 'content']
    });

    const [result1] = await pool.query(`
      UPDATE skill_tools 
      SET parameters = ?, description = ? 
      WHERE name = 'create_point' 
      AND skill_id = (SELECT id FROM skills WHERE name = 'KB Editor')
    `, [createPointParams, '创建知识点（原文存content，提炼总结存context）']);

    console.log('\n更新 create_point:', result1.affectedRows, '行');

    // 3. 更新 update_point
    const updatePointParams = JSON.stringify({
      type: 'object',
      properties: {
        kb_id: { type: 'string', description: '知识库 ID' },
        knowledge_id: { type: 'string', description: '文章 ID' },
        id: { type: 'string', description: '知识点 ID' },
        title: { type: 'string', description: '知识点标题' },
        content: { type: 'string', description: '知识点原文内容（完整保留原文）' },
        context: { type: 'string', description: '背景总结（提炼的背景、所属领域、关键概念）' },
        position: { type: 'integer', description: '排序位置' }
      },
      required: ['kb_id', 'knowledge_id', 'id']
    });

    const [result2] = await pool.query(`
      UPDATE skill_tools 
      SET parameters = ? 
      WHERE name = 'update_point' 
      AND skill_id = (SELECT id FROM skills WHERE name = 'KB Editor')
    `, [updatePointParams]);

    console.log('更新 update_point:', result2.affectedRows, '行');

    // 4. 验证更新
    console.log('\n=== 更新后的工具定义 ===\n');
    const [after] = await pool.query(`
      SELECT name, description, parameters 
      FROM skill_tools 
      WHERE name IN ('create_point', 'update_point') 
      AND skill_id = (SELECT id FROM skills WHERE name = 'KB Editor')
    `);

    after.forEach(row => {
      console.log('---', row.name, '---');
      console.log('描述:', row.description);
      const params = JSON.parse(row.parameters);
      console.log('content 参数:', params.properties.content?.description);
      console.log('context 参数:', params.properties.context?.description);
      console.log('');
    });

  } catch (error) {
    console.error('操作失败:', error.message);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);