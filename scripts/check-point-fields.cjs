/**
 * 检查知识点 content 和 context 字段使用情况
 * 以及 skill 表中的技能定义
 * 
 * 运行方式：node scripts/check-point-fields.cjs
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'touwaka_mate',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: 5,
  });

  try {
    // ========== 1. 检查 skills 表 ==========
    console.log('=== Skills 表中的技能定义 ===\n');
    
    // 先查看 skills 表结构
    const [columns] = await pool.query(`DESCRIBE skills`);
    console.log('skills 表结构:');
    columns.forEach(col => {
      console.log(`  ${col.Field} (${col.Type})`);
    });
    console.log('');

    // 查看 skill_tools 表结构
    const [toolColumns] = await pool.query(`DESCRIBE skill_tools`);
    console.log('skill_tools 表结构:');
    toolColumns.forEach(col => {
      console.log(`  ${col.Field} (${col.Type})`);
    });
    console.log('');
    
    const [skills] = await pool.query(`
      SELECT * FROM skills ORDER BY created_at DESC
    `);
    
    if (skills.length === 0) {
      console.log('skills 表为空，技能定义可能来自文件系统（data/skills/）\n');
    } else {
      console.log(`找到 ${skills.length} 个技能：\n`);
      skills.forEach((skill, index) => {
        console.log(`--- 技能 ${index + 1} ---`);
        console.log(`ID: ${skill.id}`);
        console.log(`名称: ${skill.name}`);
        console.log(`描述: ${skill.description}`);
        console.log(`创建时间: ${skill.created_at}`);
        console.log('');
      });
      
      // 详细查看 KB Editor 技能的 skill_md 内容
      const kbEditor = skills.find(s => s.name === 'KB Editor');
      if (kbEditor && kbEditor.skill_md) {
        console.log('=== KB Editor 技能的 create_point 部分 ===\n');
        // 查找 create_point 部分
        const lines = kbEditor.skill_md.split('\n');
        let inCreatePoint = false;
        let createPointLines = [];
        for (const line of lines) {
          if (line.startsWith('### create_point')) {
            inCreatePoint = true;
          } else if (inCreatePoint && line.startsWith('### ')) {
            break;
          } else if (inCreatePoint) {
            createPointLines.push(line);
          }
        }
        console.log(createPointLines.join('\n'));
        console.log('\n');
      }
    }

    // ========== 2. 检查知识点表 ==========
    console.log('=== 知识点字段使用情况检查 ===\n');

    // 统计总数
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM knowledge_points');
    console.log(`知识点总数: ${countResult[0].total}\n`);

    // 检查 context 字段为空的情况
    const [nullContextResult] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM knowledge_points 
      WHERE context IS NULL OR context = ''
    `);
    console.log(`context 为空的知识点: ${nullContextResult[0].count}\n`);

    // 检查 content 字段长度分布
    const [contentLengthResult] = await pool.query(`
      SELECT 
        CASE 
          WHEN LENGTH(content) < 100 THEN '0-100'
          WHEN LENGTH(content) < 300 THEN '100-300'
          WHEN LENGTH(content) < 500 THEN '300-500'
          WHEN LENGTH(content) < 1000 THEN '500-1000'
          ELSE '1000+'
        END as length_range,
        COUNT(*) as count
      FROM knowledge_points
      GROUP BY length_range
      ORDER BY 
        CASE length_range
          WHEN '0-100' THEN 1
          WHEN '100-300' THEN 2
          WHEN '300-500' THEN 3
          WHEN '500-1000' THEN 4
          WHEN '1000+' THEN 5
        END
    `);
    console.log('content 字段长度分布:');
    contentLengthResult.forEach(row => {
      console.log(`  ${row.length_range} 字符: ${row.count} 条`);
    });
    console.log('');

    // 抽样检查最近的 5 条知识点
    console.log('=== 最近 5 条知识点示例 ===\n');
    const [recentPoints] = await pool.query(`
      SELECT 
        id, 
        title, 
        LEFT(content, 150) as content_preview,
        LENGTH(content) as content_length,
        LEFT(context, 100) as context_preview,
        LENGTH(context) as context_length
      FROM knowledge_points 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    recentPoints.forEach((point, index) => {
      console.log(`--- 知识点 ${index + 1} ---`);
      console.log(`ID: ${point.id}`);
      console.log(`标题: ${point.title || '(无标题)'}`);
      console.log(`内容 (长度: ${point.content_length}): ${point.content_preview}...`);
      console.log(`上下文 (长度: ${point.context_length || 0}): ${point.context_preview || '(空)'}`);
      console.log('');
    });

    // ========== 3. 分析问题 ==========
    console.log('=== 问题分析 ===\n');
    
    // 检查是否有 content 很短但应该是原文的情况
    const [shortContentResult] = await pool.query(`
      SELECT id, title, content
      FROM knowledge_points 
      WHERE LENGTH(content) < 200
      LIMIT 5
    `);
    
    if (shortContentResult.length > 0) {
      console.log('发现内容较短的知识点（可能是提炼后的摘要，应该是 context）:');
      shortContentResult.forEach(p => {
        console.log(`  [${p.id}] ${p.title || '(无标题)'}: ${p.content.substring(0, 100)}...`);
      });
    }

    // ========== 4. 建议修复方案 ==========
    console.log('\n=== 建议修复方案 ===\n');
    console.log('根据设计文档，知识点字段应该如下使用：');
    console.log('- content: 原文内容（完整的知识点原文）');
    console.log('- context: 上下文/提炼总结（用于向量化增强检索精度）');
    console.log('');
    console.log('问题可能是：');
    console.log('1. AI 创建知识点时，把提炼的内容放到了 content，原文丢失');
    console.log('2. context 字段没有被使用');
    console.log('');
    console.log('建议：');
    console.log('1. 修改 AI 创建知识点的 prompt，明确区分 content 和 context');
    console.log('2. 在 kb-editor 和 knowledge-base 技能文档中明确字段语义');
    console.log('3. 考虑在创建知识点时，将原始内容保存到 content，AI 提炼的总结保存到 context');

  } catch (error) {
    console.error('查询失败:', error.message);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);