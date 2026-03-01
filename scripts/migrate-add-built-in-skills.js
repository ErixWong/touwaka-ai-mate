/**
 * 迁移脚本：添加内置技能到数据库
 * 
 * 用于已有数据库的情况下，添加内置高级技能
 * 不会删除现有数据，只会插入或更新
 * 
 * 使用方法：
 *   node scripts/migrate-add-built-in-skills.js
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

// 内置技能定义
const BUILT_IN_SKILLS = [
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
    allowed_tools: JSON.stringify(['Bash(cat *)', 'Bash(ls *)', 'Bash(grep *)', 'Bash(find *)']),
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
    allowed_tools: JSON.stringify(['Bash(zip *)', 'Bash(unzip *)']),
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
    allowed_tools: JSON.stringify(['Bash(curl *)']),
  },
];

// 内置技能的工具定义
const BUILT_IN_SKILL_TOOLS = {
  'file-operations': [
    { name: 'read_lines', description: 'Read file content line by line', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, from: { type: 'number', description: 'Start line (default: 1)' }, lines: { type: 'number', description: 'Number of lines to read (default: 100)' } }, required: ['path'] } },
    { name: 'read_bytes', description: 'Read file content by bytes', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, offset: { type: 'number', description: 'Start byte (default: 0)' }, bytes: { type: 'number', description: 'Bytes to read (default: 50000)' } }, required: ['path'] } },
    { name: 'list_files', description: 'List directory contents', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' }, recursive: { type: 'boolean', description: 'List recursively (default: false)' } }, required: ['path'] } },
    { name: 'search_in_file', description: 'Search text in a single file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, pattern: { type: 'string', description: 'Search pattern' }, ignore_case: { type: 'boolean', description: 'Case insensitive (default: true)' } }, required: ['path', 'pattern'] } },
    { name: 'grep', description: 'Search text across multiple files', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Search pattern' }, path: { type: 'string', description: 'Directory path (default: current)' }, file_pattern: { type: 'string', description: 'File pattern (default: "*")' } }, required: ['pattern'] } },
    { name: 'write_file', description: 'Write content to a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Content to write' } }, required: ['path', 'content'] } },
    { name: 'append_file', description: 'Append content to a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Content to append' } }, required: ['path', 'content'] } },
    { name: 'replace_in_file', description: 'Replace text in a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, old: { type: 'string', description: 'Text to replace' }, new: { type: 'string', description: 'Replacement text' } }, required: ['path', 'old', 'new'] } },
    { name: 'insert_at_line', description: 'Insert content at a specific line', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, line: { type: 'number', description: 'Line number' }, content: { type: 'string', description: 'Content to insert' } }, required: ['path', 'line', 'content'] } },
    { name: 'delete_lines', description: 'Delete specific lines from a file', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, from: { type: 'number', description: 'Start line' }, to: { type: 'number', description: 'End line (default: from)' } }, required: ['path', 'from'] } },
    { name: 'copy_file', description: 'Copy a file', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source path' }, destination: { type: 'string', description: 'Destination path' } }, required: ['source', 'destination'] } },
    { name: 'move_file', description: 'Move or rename a file', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source path' }, destination: { type: 'string', description: 'Destination path' } }, required: ['source', 'destination'] } },
    { name: 'delete_file', description: 'Delete a file or directory', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path to delete' } }, required: ['path'] } },
    { name: 'create_dir', description: 'Create a directory', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] } },
  ],
  'compression': [
    { name: 'zip', description: 'Create a ZIP archive from files or directories', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source file or directory path' }, destination: { type: 'string', description: 'Output ZIP file path (default: source.zip)' }, compression_level: { type: 'number', description: '0-9 (default: 6)' } }, required: ['source'] } },
    { name: 'unzip', description: 'Extract a ZIP archive', parameters: { type: 'object', properties: { source: { type: 'string', description: 'ZIP file path' }, destination: { type: 'string', description: 'Extract destination (default: current directory)' } }, required: ['source'] } },
  ],
  'http-client': [
    { name: 'http_get', description: 'Send an HTTP GET request', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Request URL' }, headers: { type: 'object', description: 'Custom headers' }, timeout: { type: 'number', description: 'Timeout in ms (default: 10000)' } }, required: ['url'] } },
    { name: 'http_post', description: 'Send an HTTP POST request', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Request URL' }, body: { type: 'object', description: 'Request body' }, headers: { type: 'object', description: 'Custom headers' }, timeout: { type: 'number', description: 'Timeout in ms (default: 10000)' } }, required: ['url'] } },
  ],
};

async function migrate() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(DB_CONFIG);

    console.log('\n📦 Migrating built-in skills...\n');

    // 1. 插入/更新技能
    for (const skill of BUILT_IN_SKILLS) {
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
        console.log(`  ✓ Updated skill: ${skill.id}`);
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
        console.log(`  ✓ Inserted skill: ${skill.id}`);
      }
    }

    // 2. 插入/更新工具定义
    console.log('\n🔧 Migrating skill tools...\n');
    
    for (const [skillId, tools] of Object.entries(BUILT_IN_SKILL_TOOLS)) {
      // 先删除该技能的旧工具
      await connection.execute('DELETE FROM skill_tools WHERE skill_id = ?', [skillId]);
      
      // 插入新工具
      for (const tool of tools) {
        const toolId = Utils.newID(20);
        await connection.execute(
          `INSERT INTO skill_tools (id, skill_id, name, description, parameters)
           VALUES (?, ?, ?, ?, ?)`,
          [toolId, skillId, tool.name, tool.description, JSON.stringify(tool.parameters)]
        );
      }
      console.log(`  ✓ ${tools.length} tools for ${skillId}`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nSummary:');
    console.log(`  - ${BUILT_IN_SKILLS.length} skills migrated`);
    console.log(`  - ${Object.values(BUILT_IN_SKILL_TOOLS).flat().length} tools migrated`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
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

migrate();