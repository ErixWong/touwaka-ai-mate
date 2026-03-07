/**
 * 重新注册 KB Editor 技能
 * 
 * 运行方式：node scripts/reload-skill.cjs
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
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
    // 读取 SKILL.md 文件
    const skillMdPath = path.join(__dirname, '..', 'data', 'skills', 'kb-editor', 'SKILL.md');
    const skillMd = fs.readFileSync(skillMdPath, 'utf8');

    console.log('=== 重新注册 KB Editor 技能 ===\n');
    console.log('SKILL.md 内容长度:', skillMd.length, '字符\n');

    // 解析 YAML frontmatter
    const frontmatterMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
    let name = 'KB Editor';
    let description = '知识库编辑技能，用于创建和管理知识库、文章、知识点';
    let argumentHint = '';

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const nameMatch = frontmatter.match(/name:\s*(.+)/);
      const descMatch = frontmatter.match(/description:\s*(.+)/);
      const argHintMatch = frontmatter.match(/argument-hint:\s*(.+)/);

      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
      if (argHintMatch) argumentHint = argHintMatch[1].trim();
    }

    console.log('技能名称:', name);
    console.log('技能描述:', description);
    console.log('参数提示:', argumentHint);
    console.log('');

    // 更新数据库中的技能
    const [result] = await pool.query(`
      UPDATE skills 
      SET skill_md = ?, 
          description = ?,
          argument_hint = ?,
          updated_at = NOW()
      WHERE name = ?
    `, [skillMd, description, argumentHint, name]);

    console.log(`更新了 ${result.affectedRows} 条记录\n`);

    // 验证更新
    const [skills] = await pool.query(`
      SELECT id, name, description, LEFT(skill_md, 500) as skill_md_preview
      FROM skills 
      WHERE name = ?
    `, [name]);

    if (skills.length > 0) {
      console.log('=== 更新后的技能 ===');
      console.log('ID:', skills[0].id);
      console.log('名称:', skills[0].name);
      console.log('描述:', skills[0].description);
      console.log('\nskill_md 前500字符:');
      console.log(skills[0].skill_md_preview);
    }

  } catch (error) {
    console.error('操作失败:', error.message);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);