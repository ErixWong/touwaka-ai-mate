/**
 * 初始化/修复核心技能
 *
 * 功能：
 * - 将核心技能（file-operations、compression、http-client、skill-manager）同步到数据库
 * - 使用硬编码的工具定义，不解析 SKILL.md
 * - 支持增量更新（已存在的技能会更新）
 * - 用于初始化新环境或修复意外删除的核心技能
 *
 * 使用方法：
 *   node scripts/init-core-skills.js              # 同步技能到数据库
 *   node scripts/init-core-skills.js --dry-run    # 预览模式，不写入数据库
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import Utils from '../lib/utils.js';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// 核心技能定义（硬编码，包含完整的工具参数）
const CORE_SKILLS = [
  {
    id: 'file-operations',
    name: 'File Operations',
    description: 'File system operations including read, write, search, and manage files. Use when you need to work with files in the data directory.',
    version: '1.0.0',
    author: 'System',
    tags: ['file', 'system', 'built-in'],
    source_type: 'local',
    source_path: 'skills/file-operations',
    skill_md: `---
name: file-operations
description: File system operations including read, write, search, and manage files. Use when you need to work with files in the data directory.
argument-hint: "[operation] [path]"
user-invocable: true
allowed-tools:
  - Bash(cat *)
  - Bash(ls *)
  - Bash(grep *)
  - Bash(find *)
---

# File Operations

Complete file system operations for reading, writing, searching, and managing files.`,
    argument_hint: '[operation] [path]',
    user_invocable: true,
    allowed_tools: ['Bash(cat *)', 'Bash(ls *)', 'Bash(grep *)', 'Bash(find *)'],
    tools: [
      // New unified tools (recommended)
      { name: 'read_file', description: 'Read file content with mode parameter (lines or bytes)', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, mode: { type: 'string', enum: ['lines', 'bytes'], description: 'Read mode: "lines" (default) or "bytes"' }, from: { type: 'number', description: 'Start line for lines mode (default: 1)' }, lines: { type: 'number', description: 'Number of lines for lines mode (default: 100)' }, offset: { type: 'number', description: 'Start byte for bytes mode (default: 0)' }, bytes: { type: 'number', description: 'Bytes to read for bytes mode (default: 50000)' } }, required: ['path'] } },
      { name: 'transfer', description: 'Copy or move a file', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source path' }, destination: { type: 'string', description: 'Destination path' }, operation: { type: 'string', enum: ['copy', 'move'], description: 'Operation: "copy" (default) or "move"' } }, required: ['source', 'destination'] } },
      // Legacy tools (kept for backward compatibility)
      { name: 'read_lines', description: '[Legacy] Read file content line by line. Use read_file instead.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, from: { type: 'number', description: 'Start line (default: 1)' }, lines: { type: 'number', description: 'Number of lines to read (default: 100)' } }, required: ['path'] } },
      { name: 'read_bytes', description: '[Legacy] Read file content by bytes. Use read_file instead.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, offset: { type: 'number', description: 'Start byte (default: 0)' }, bytes: { type: 'number', description: 'Bytes to read (default: 50000)' } }, required: ['path'] } },
      { name: 'list_files', description: 'List directory contents', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' }, recursive: { type: 'boolean', description: 'List recursively (default: false)' } }, required: ['path'] } },
      { name: 'search_in_file', description: 'Search text in a single file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, pattern: { type: 'string', description: 'Search pattern' }, ignore_case: { type: 'boolean', description: 'Case insensitive (default: true)' } }, required: ['path', 'pattern'] } },
      { name: 'grep', description: 'Search text across multiple files', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Search pattern' }, path: { type: 'string', description: 'Directory path (default: current)' }, file_pattern: { type: 'string', description: 'File pattern (default: "*")' } }, required: ['pattern'] } },
      { name: 'write_file', description: 'Write content to a file (supports append mode)', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Content to write' }, mode: { type: 'string', enum: ['write', 'append'], description: 'Write mode: "write" (default, overwrite) or "append"' } }, required: ['path', 'content'] } },
      { name: 'append_file', description: '[Legacy] Append content to a file. Use write_file with mode: "append" instead.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Content to append' } }, required: ['path', 'content'] } },
      { name: 'replace_in_file', description: 'Replace text in a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, old: { type: 'string', description: 'Text to replace' }, new: { type: 'string', description: 'Replacement text' } }, required: ['path', 'old', 'new'] } },
      { name: 'insert_at_line', description: 'Insert content at a specific line', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, line: { type: 'number', description: 'Line number' }, content: { type: 'string', description: 'Content to insert' } }, required: ['path', 'line', 'content'] } },
      { name: 'delete_lines', description: 'Delete specific lines from a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, from: { type: 'number', description: 'Start line' }, to: { type: 'number', description: 'End line (default: from)' } }, required: ['path', 'from'] } },
      { name: 'copy_file', description: '[Legacy] Copy a file. Use transfer with operation: "copy" instead.', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source path' }, destination: { type: 'string', description: 'Destination path' } }, required: ['source', 'destination'] } },
      { name: 'move_file', description: '[Legacy] Move or rename a file. Use transfer with operation: "move" instead.', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source path' }, destination: { type: 'string', description: 'Destination path' } }, required: ['source', 'destination'] } },
      { name: 'delete_file', description: 'Delete a file or directory', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path to delete' } }, required: ['path'] } },
      { name: 'create_dir', description: 'Create a directory', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] } },
    ],
  },
  {
    id: 'compression',
    name: 'Compression',
    description: 'ZIP file operations for creating and extracting archives.',
    version: '1.0.0',
    author: 'System',
    tags: ['zip', 'archive', 'built-in'],
    source_type: 'local',
    source_path: 'skills/compression',
    skill_md: `---
name: compression
description: ZIP file operations for creating and extracting archives.
argument-hint: "[zip|unzip] [path]"
user-invocable: true
allowed-tools:
  - Bash(zip *)
  - Bash(unzip *)
---

# Compression

Create and extract ZIP archives.`,
    argument_hint: '[zip|unzip] [path]',
    user_invocable: true,
    allowed_tools: ['Bash(zip *)', 'Bash(unzip *)'],
    tools: [
      { name: 'zip', description: 'Create a ZIP archive from files or directories', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source file or directory path' }, destination: { type: 'string', description: 'Output ZIP file path (default: source.zip)' }, compression_level: { type: 'number', description: '0-9 (default: 6)' } }, required: ['source'] } },
      { name: 'unzip', description: 'Extract a ZIP archive', parameters: { type: 'object', properties: { source: { type: 'string', description: 'ZIP file path' }, destination: { type: 'string', description: 'Extract destination (default: current directory)' } }, required: ['source'] } },
    ],
  },
  {
    id: 'http-client',
    name: 'HTTP Client',
    description: 'HTTP client for making GET and POST requests. Use when you need to fetch web content or call APIs.',
    version: '1.0.0',
    author: 'System',
    tags: ['http', 'network', 'api', 'built-in'],
    source_type: 'local',
    source_path: 'skills/http-client',
    skill_md: `---
name: http-client
description: HTTP client for making GET and POST requests. Use when you need to fetch web content or call APIs.
argument-hint: "[get|post] [url]"
user-invocable: true
allowed-tools:
  - Bash(curl *)
---

# HTTP Client

Make HTTP requests to fetch web content or call APIs.`,
    argument_hint: '[get|post] [url]',
    user_invocable: true,
    allowed_tools: ['Bash(curl *)'],
    tools: [
      { name: 'http_get', description: 'Send an HTTP GET request', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Request URL' }, headers: { type: 'object', description: 'Custom headers' }, timeout: { type: 'number', description: 'Timeout in ms (default: 10000)' } }, required: ['url'] } },
      { name: 'http_post', description: 'Send an HTTP POST request', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Request URL' }, body: { type: 'object', description: 'Request body' }, headers: { type: 'object', description: 'Custom headers' }, timeout: { type: 'number', description: 'Timeout in ms (default: 10000)' } }, required: ['url'] } },
    ],
  },
  {
    id: 'skill-manager',
    name: 'Skill Manager',
    description: '技能管理工具，用于注册、删除、分配技能到数据库。技能专家通过文件系统读取 SKILL.md 后，使用此工具将技能注册到数据库。',
    version: '1.0.0',
    author: 'System',
    tags: ['skill', 'management', 'built-in'],
    source_type: 'local',
    source_path: 'skills/skill-manager',
    skill_md: `---
name: skill-manager
description: 技能管理工具，用于注册、删除、分配技能到数据库。
argument-hint: "[register|delete|assign|toggle] [skill_id]"
user-invocable: false
allowed-tools: []
---

# Skill Manager

技能管理核心工具，提供注册、删除、分配技能等功能。`,
    argument_hint: '[register|delete|assign|toggle] [skill_id]',
    user_invocable: false,
    allowed_tools: [],
    tools: [
      {
        name: 'register_skill',
        description: '从本地目录注册或更新技能到数据库。需要先读取 SKILL.md，理解工具定义后调用此工具。',
        parameters: {
          type: 'object',
          properties: {
            source_path: { type: 'string', description: '技能目录的相对路径（相对于 data/skills 目录）' },
            name: { type: 'string', description: '技能名称（可选）' },
            description: { type: 'string', description: '技能描述（可选）' },
            tools: {
              type: 'array',
              description: '工具定义数组',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: '工具名称' },
                  description: { type: 'string', description: '工具功能描述' },
                  parameters: { type: 'object', description: 'JSON Schema 格式的参数定义' }
                },
                required: ['name', 'description', 'parameters']
              }
            }
          },
          required: ['source_path', 'tools']
        }
      },
      {
        name: 'delete_skill',
        description: '从数据库中删除技能（谨慎使用）',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string', description: '技能ID或名称' }
          },
          required: ['skill_id']
        }
      },
      {
        name: 'assign_skill_to_expert',
        description: '将技能分配给指定专家',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string', description: '技能ID或名称' },
            expert_id: { type: 'string', description: '专家ID或名称' }
          },
          required: ['skill_id', 'expert_id']
        }
      },
      {
        name: 'unassign_skill_from_expert',
        description: '取消技能与专家的关联',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string', description: '技能ID或名称' },
            expert_id: { type: 'string', description: '专家ID或名称' }
          },
          required: ['skill_id', 'expert_id']
        }
      },
      {
        name: 'toggle_skill',
        description: '启用或禁用技能',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string', description: '技能ID或名称' },
            is_active: { type: 'boolean', description: '是否启用' }
          },
          required: ['skill_id', 'is_active']
        }
      },
    ],
  },
];

/**
 * 同步技能到数据库
 */
async function syncSkills(dryRun = false) {
  let connection;

  try {
    console.log(`📦 准备同步 ${CORE_SKILLS.length} 个核心技能...\n`);

    if (dryRun) {
      console.log('🔍 Dry run 模式 - 仅显示将要执行的操作:\n');
      for (const skill of CORE_SKILLS) {
        console.log(`[${skill.id}]`);
        console.log(`  name: ${skill.name}`);
        console.log(`  description: ${skill.description.substring(0, 60)}...`);
        console.log(`  tools: ${skill.tools.map(t => t.name).join(', ')}`);
        console.log('');
      }
      console.log('✅ Dry run 完成');
      return;
    }

    console.log('🔗 连接数据库...');
    connection = await mysql.createConnection(DB_CONFIG);

    console.log('\n📦 同步技能...\n');

    let insertedCount = 0;
    let updatedCount = 0;
    let toolsCount = 0;

    for (const skill of CORE_SKILLS) {
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
            JSON.stringify(skill.allowed_tools), skill.id
          ]
        );
        console.log(`  ✓ 更新: ${skill.id}`);
        updatedCount++;
      } else {
        // 插入
        await connection.execute(
          `INSERT INTO skills (id, name, description, version, author, tags, source_type, source_path, skill_md, argument_hint, user_invocable, allowed_tools, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            skill.id, skill.name, skill.description, skill.version, skill.author,
            JSON.stringify(skill.tags), skill.source_type, skill.source_path,
            skill.skill_md, skill.argument_hint, skill.user_invocable ? 1 : 0,
            JSON.stringify(skill.allowed_tools)
          ]
        );
        console.log(`  ✓ 插入: ${skill.id}`);
        insertedCount++;
      }

      // 删除该技能的旧工具
      await connection.execute('DELETE FROM skill_tools WHERE skill_id = ?', [skill.id]);
      
      // 插入工具定义
      for (const tool of skill.tools) {
        const toolId = Utils.newID(20);
        await connection.execute(
          `INSERT INTO skill_tools (id, skill_id, name, description, parameters)
           VALUES (?, ?, ?, ?, ?)`,
          [toolId, skill.id, tool.name, tool.description, JSON.stringify(tool.parameters)]
        );
        toolsCount++;
      }
      
      console.log(`    └─ ${skill.tools.length} 个工具已注册`);
    }

    console.log('\n✅ 同步完成!');
    console.log(`\n统计:`);
    console.log(`  - 插入: ${insertedCount} 个技能`);
    console.log(`  - 更新: ${updatedCount} 个技能`);
    console.log(`  - 工具: ${toolsCount} 个`);

  } catch (error) {
    console.error('\n❌ 同步失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// 解析命令行参数
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');

// 检查环境变量
if (!dryRun && (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database)) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

// 显示帮助
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/init-core-skills.js [options]

Options:
  --dry-run, -n     预览模式，不写入数据库
  --help, -h        显示帮助信息

Examples:
  node scripts/init-core-skills.js
  node scripts/init-core-skills.js --dry-run
`);
  process.exit(0);
}

syncSkills(dryRun);
