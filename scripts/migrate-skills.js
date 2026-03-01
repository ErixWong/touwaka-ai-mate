/**
 * 迁移脚本：扫描并注册 skills 目录下的所有技能
 * 
 * 功能：
 * - 自动扫描 skills/ 目录
 * - 解析 SKILL.md 文件提取元数据
 * - 注册到 skills 表和 skill_tools 表
 * - 支持增量更新（已存在的技能会更新）
 * 
 * 使用方法：
 *   node scripts/migrate-skills.js              # 扫描并注册所有技能
 *   node scripts/migrate-skills.js --dry-run    # 预览模式，不写入数据库
 *   node scripts/migrate-skills.js --skill xxx  # 只注册指定技能
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import Utils from '../lib/utils.js';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// skills 目录路径
const SKILLS_DIR = path.join(process.cwd(), 'skills');

/**
 * 解析 SKILL.md 文件
 * 提取 YAML front matter 和工具定义
 */
function parseSkillMd(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // 解析 YAML front matter
  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const frontMatter = {};
  
  if (frontMatterMatch) {
    const yaml = frontMatterMatch[1];
    // 简单的 YAML 解析（支持基本格式）
    yaml.split('\n').forEach(line => {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        let value = match[2].trim();
        // 处理数组格式
        if (value.startsWith('[') || value.startsWith('-')) {
          try {
            // 尝试解析 JSON 格式数组
            if (value.startsWith('[')) {
              value = JSON.parse(value);
            } else {
              // YAML 列表格式，取第一个值
              value = [value.replace(/^-\s*/, '')];
            }
          } catch {
            value = [value];
          }
        } else if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        }
        frontMatter[match[1]] = value;
      }
    });
  }
  
  // 解析工具定义（### tool_name 格式）
  const tools = [];
  const toolMatches = content.matchAll(/###\s+(\w+)\s*\n([\s\S]*?)(?=###|$)/g);
  
  for (const match of toolMatches) {
    const toolName = match[1];
    const toolDesc = match[2].trim();
    
    // 解析参数
    const parameters = parseParameters(toolDesc);
    
    tools.push({
      name: toolName,
      description: extractFirstSentence(toolDesc),
      parameters,
    });
  }
  
  return { frontMatter, content, tools };
}

/**
 * 从工具描述中解析参数
 */
function parseParameters(description) {
  const properties = {};
  const required = [];
  
  // 匹配参数行：- `param` (type, required): description
  const paramMatches = description.matchAll(/[-*]\s+`(\w+)`\s*\(([^)]+)\):\s*(.+)/g);
  
  for (const match of paramMatches) {
    const name = match[1];
    const typeInfo = match[2].split(',').map(s => s.trim());
    const desc = match[3];
    
    const paramType = typeInfo[0] || 'string';
    const isRequired = typeInfo.includes('required');
    
    properties[name] = {
      type: paramType.toLowerCase(),
      description: desc,
    };
    
    if (isRequired) {
      required.push(name);
    }
  }
  
  return {
    type: 'object',
    properties,
    required,
  };
}

/**
 * 提取第一句话作为描述
 */
function extractFirstSentence(text) {
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 200 ? firstLine.substring(0, 200) + '...' : firstLine;
}

/**
 * 扫描 skills 目录
 */
function scanSkillsDirectory(targetSkill = null) {
  const skills = [];
  
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`Skills directory not found: ${SKILLS_DIR}`);
    return skills;
  }
  
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const skillId = entry.name;
    
    // 如果指定了技能，只处理该技能
    if (targetSkill && skillId !== targetSkill) continue;
    
    const skillPath = path.join(SKILLS_DIR, entry.name);
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    
    if (!fs.existsSync(skillMdPath)) {
      console.warn(`  ⚠ SKILL.md not found for: ${skillId}`);
      continue;
    }
    
    const { frontMatter, content, tools } = parseSkillMd(skillMdPath);
    
    skills.push({
      id: skillId,
      name: frontMatter.name || skillId,
      description: frontMatter.description || '',
      version: frontMatter.version || '1.0.0',
      author: frontMatter.author || 'System',
      tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : [],
      source_type: 'local',
      source_path: `skills/${skillId}`,
      skill_md: content,
      argument_hint: frontMatter['argument-hint'] || '',
      user_invocable: frontMatter['user-invocable'] !== false,
      allowed_tools: Array.isArray(frontMatter['allowed-tools']) 
        ? JSON.stringify(frontMatter['allowed-tools']) 
        : '[]',
      tools,
    });
  }
  
  return skills;
}

/**
 * 执行迁移
 */
async function migrate(dryRun = false, targetSkill = null) {
  let connection;

  try {
    console.log('📁 Scanning skills directory...');
    const skills = scanSkillsDirectory(targetSkill);
    
    if (skills.length === 0) {
      console.log('No skills found to migrate.');
      return;
    }
    
    console.log(`\nFound ${skills.length} skill(s):\n`);
    skills.forEach(s => {
      console.log(`  - ${s.id}: ${s.name} (${s.tools.length} tools)`);
    });
    
    if (dryRun) {
      console.log('\n🔍 Dry run mode - showing what would be done:\n');
      skills.forEach(s => {
        console.log(`\n[${s.id}]`);
        console.log(`  name: ${s.name}`);
        console.log(`  description: ${s.description.substring(0, 80)}...`);
        console.log(`  tools: ${s.tools.map(t => t.name).join(', ')}`);
      });
      console.log('\n✅ Dry run completed.');
      return;
    }

    console.log('\n🔗 Connecting to database...');
    connection = await mysql.createConnection(DB_CONFIG);

    console.log('\n📦 Migrating skills...\n');

    let insertedCount = 0;
    let updatedCount = 0;
    let toolsCount = 0;

    for (const skill of skills) {
      // 检查是否已存在
      const [existing] = await connection.execute(
        'SELECT id FROM skills WHERE id = ?',
        [skill.id]
      );

      if (existing.length > 0) {
        // 更新
        await connection.execute(
          `UPDATE skills SET 
            name = ?, description = ?, version = ?, author = ?, tags = ?,
            source_type = ?, source_path = ?, skill_md = ?,
            argument_hint = ?, user_invocable = ?, allowed_tools = ?,
            updated_at = NOW()
          WHERE id = ?`,
          [
            skill.name, skill.description, skill.version, skill.author,
            JSON.stringify(skill.tags), skill.source_type, skill.source_path,
            skill.skill_md, skill.argument_hint, skill.user_invocable ? 1 : 0,
            skill.allowed_tools, skill.id
          ]
        );
        console.log(`  ✓ Updated: ${skill.id}`);
        updatedCount++;
      } else {
        // 插入
        await connection.execute(
          `INSERT INTO skills (id, name, description, version, author, tags, source_type, source_path, skill_md, argument_hint, user_invocable, allowed_tools)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            skill.id, skill.name, skill.description, skill.version, skill.author,
            JSON.stringify(skill.tags), skill.source_type, skill.source_path,
            skill.skill_md, skill.argument_hint, skill.user_invocable ? 1 : 0,
            skill.allowed_tools
          ]
        );
        console.log(`  ✓ Inserted: ${skill.id}`);
        insertedCount++;
      }

      // 删除该技能的旧工具
      await connection.execute('DELETE FROM skill_tools WHERE skill_id = ?', [skill.id]);
      
      // 插入新工具
      for (const tool of skill.tools) {
        const toolId = Utils.newID(20);
        await connection.execute(
          `INSERT INTO skill_tools (id, skill_id, name, description, parameters)
           VALUES (?, ?, ?, ?, ?)`,
          [toolId, skill.id, tool.name, tool.description, JSON.stringify(tool.parameters)]
        );
        toolsCount++;
      }
      
      if (skill.tools.length > 0) {
        console.log(`    └─ ${skill.tools.length} tools registered`);
      }
    }

    console.log('\n✅ Migration completed!');
    console.log(`\nSummary:`);
    console.log(`  - Inserted: ${insertedCount} skills`);
    console.log(`  - Updated: ${updatedCount} skills`);
    console.log(`  - Tools: ${toolsCount} total`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// 解析命令行参数
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skillIndex = args.indexOf('--skill');
const targetSkill = skillIndex !== -1 && args[skillIndex + 1] ? args[skillIndex + 1] : null;

// 检查环境变量
if (!dryRun && (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database)) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

// 显示帮助
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/migrate-skills.js [options]

Options:
  --dry-run         Preview mode, don't write to database
  --skill <id>      Only migrate the specified skill
  --help, -h        Show this help message

Examples:
  node scripts/migrate-skills.js
  node scripts/migrate-skills.js --dry-run
  node scripts/migrate-skills.js --skill file-operations
`);
  process.exit(0);
}

migrate(dryRun, targetSkill);