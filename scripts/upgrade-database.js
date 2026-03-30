/**
 * Database Upgrade Script
 * 统一的数据库升级脚本，整合所有迁移功能
 * 
 * 特性：
 * - 幂等性：可以重复执行，不会重复应用已完成的迁移
 * - 自动检测：通过检查表/字段/索引/外键是否存在来决定是否需要迁移
 * 
 * 运行方式：node scripts/upgrade-database.js
 * 也可以在服务器启动时自动调用
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// 知识库图片存储目录
const KB_IMAGES_ROOT = process.env.KB_IMAGES_ROOT || './data/kb-images';
// 工作空间根目录
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';

/**
 * 检查表是否存在
 */
async function hasTable(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [DB_CONFIG.database, tableName]
  );
  return rows.length > 0;
}

/**
 * 检查字段是否存在
 */
async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_CONFIG.database, tableName, columnName]
  );
  return rows.length > 0;
}

/**
 * 检查字段类型是否为指定类型
 */
async function getColumnType(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_CONFIG.database, tableName, columnName]
  );
  return rows.length > 0 ? rows[0].COLUMN_TYPE : null;
}

/**
 * 检查外键是否存在
 */
async function hasForeignKey(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [DB_CONFIG.database, tableName, constraintName]
  );
  return rows.length > 0;
}

/**
 * 检查索引是否存在
 */
async function hasIndex(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [DB_CONFIG.database, tableName, indexName]
  );
  return rows.length > 0;
}

/**
 * 安全执行 SQL（忽略重复/已存在错误）
 */
async function safeExecute(connection, sql, errorMessages = ['Duplicate', 'already exists', 'foreign key constraint']) {
  try {
    await connection.execute(sql);
    return true;
  } catch (e) {
    const msg = e.message.toLowerCase();
    for (const ignoreMsg of errorMessages) {
      if (msg.includes(ignoreMsg.toLowerCase())) {
        return false;
      }
    }
    throw e;
  }
}

/**
 * 迁移定义
 * 每个迁移包含检查函数和执行函数
 * 所有迁移都是幂等的：check 返回 true 表示已存在，跳过迁移
 * 
 * 使用方法：
 * 1. 在 MIGRATIONS 数组末尾添加新的迁移项
 * 2. 每个迁移项包含：
 *    - name: 迁移名称（用于日志显示）
 *    - check: 检查函数，返回 true 表示已存在，跳过迁移
 *    - migrate: 迁移函数，执行实际的数据库变更
 */
const MIGRATIONS = [
  // ==================== 助理表 ID 字段重命名 ====================
  // 将 assistant_type 重命名为 id
  {
    name: 'assistants.id column rename from assistant_type',
    check: async (conn) => await hasColumn(conn, 'assistants', 'id'),
    migrate: async (conn) => {
      // 1. 重命名主键字段
      await conn.execute(`
        ALTER TABLE assistants
        CHANGE COLUMN assistant_type id VARCHAR(32) NOT NULL COMMENT '助理ID'
      `);
      // 2. 更新 assistant_requests 表的外键字段名
      // 注意：外键约束名称可能需要先删除再重建
      await conn.execute(`
        ALTER TABLE assistant_requests
        CHANGE COLUMN assistant_type assistant_id VARCHAR(32) NOT NULL COMMENT '助理ID'
      `);
      console.log('  ✓ Renamed assistants.assistant_type -> id');
      console.log('  ✓ Renamed assistant_requests.assistant_type -> assistant_id');
    }
  },

  // ==================== 任务状态扩展 ====================
  // 添加 autonomous_wait 和 autonomous_working 状态
  // Issue #386: 自主任务状态优化
  {
    name: 'tasks.status add autonomous_wait and autonomous_working',
    check: async (conn) => {
      const columnType = await getColumnType(conn, 'tasks', 'status');
      // 检查是否已包含 autonomous_wait
      return columnType && columnType.includes('autonomous_wait');
    },
    migrate: async (conn) => {
      // 修改 ENUM 类型，添加新状态值
      // 保留原有的 autonomous 以兼容旧数据
      await conn.execute(`
        ALTER TABLE tasks
        MODIFY COLUMN status ENUM(
          'active',
          'autonomous',
          'autonomous_wait',
          'autonomous_working',
          'archived',
          'deleted'
        ) NOT NULL DEFAULT 'active' COMMENT '任务状态'
      `);
      console.log('  ✓ Added autonomous_wait and autonomous_working to tasks.status ENUM');
    }
  },

  // ==================== 移除废弃的 autonomous 状态 ====================
  // Issue #405: 清理已废弃的 autonomous 状态
  {
    name: 'tasks.status remove deprecated autonomous',
    check: async (conn) => {
      const columnType = await getColumnType(conn, 'tasks', 'status');
      // 检查是否已移除 autonomous（只包含 autonomous_wait）
      return columnType && columnType.includes('autonomous_wait') && !columnType.includes("'autonomous'");
    },
    migrate: async (conn) => {
      // 1. 将现有的 autonomous 状态数据迁移为 autonomous_wait
      await conn.execute(`
        UPDATE tasks SET status = 'autonomous_wait' WHERE status = 'autonomous'
      `);
      console.log('  ✓ Migrated autonomous -> autonomous_wait');

      // 2. 修改 ENUM 类型，移除 autonomous
      await conn.execute(`
        ALTER TABLE tasks
        MODIFY COLUMN status ENUM(
          'active',
          'autonomous_wait',
          'autonomous_working',
          'archived',
          'deleted'
        ) NOT NULL DEFAULT 'active' COMMENT '任务状态'
      `);
      console.log('  ✓ Removed deprecated autonomous from tasks.status ENUM');
    }
  },

  // ==================== 添加 error 状态 ====================
  // Issue #410: 自主任务错误处理增强
  // 当 LLM 连续无响应或 PM 判断失败时，将任务标记为 error 状态
  {
    name: 'tasks.status add error state',
    check: async (conn) => {
      const columnType = await getColumnType(conn, 'tasks', 'status');
      // 检查是否已包含 error
      return columnType && columnType.includes('error');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE tasks
        MODIFY COLUMN status ENUM(
          'active',
          'autonomous_wait',
          'autonomous_working',
          'error',
          'archived',
          'deleted'
        ) NOT NULL DEFAULT 'active' COMMENT '任务状态'
      `);
      console.log('  ✓ Added error to tasks.status ENUM');
    }
  },

  // ==================== skills 表添加 mark 字段 ====================
  // Issue #417: 技能工具名称统一方案
  // mark 字段作为技能的语义标识，用于生成稳定的 tool_name
  {
    name: 'skills.mark column add',
    check: async (conn) => await hasColumn(conn, 'skills', 'mark'),
    migrate: async (conn) => {
      // 1. 添加 mark 字段（允许 NULL，后续填充数据后改为 NOT NULL）
      await conn.execute(`
        ALTER TABLE skills
        ADD COLUMN mark VARCHAR(50) NULL COMMENT '技能标识（不可编辑，唯一），用于生成 tool_name'
      `);
      console.log('  ✓ Added mark column to skills table');

      // 2. 添加唯一索引
      await conn.execute(`
        ALTER TABLE skills
        ADD UNIQUE INDEX idx_mark (mark)
      `);
      console.log('  ✓ Added unique index on skills.mark');

      // 3. 为现有技能生成 mark 值
      // 规则：基于 name 字段 slugify，或使用已有的语义化 id
      const [skills] = await conn.execute('SELECT id, name FROM skills WHERE mark IS NULL');
      
      for (const skill of skills) {
        // 如果 id 已经是语义化的（不含大写字母和数字），直接使用 id 作为 mark
        const isSemanticId = /^[a-z-]+$/.test(skill.id);
        let mark;
        
        if (isSemanticId) {
          mark = skill.id;  // 如 'compression', 'searxng', 'skill-manager'
        } else {
          // 基于 name 生成 mark（slugify）
          mark = skill.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')  // 非字母数字替换为连字符
            .replace(/^-|-$/g, '');       // 去掉首尾连字符
          
          // 确保唯一性（如果已存在，添加后缀）
          const [existing] = await conn.execute(
            'SELECT id FROM skills WHERE mark = ? AND id != ?',
            [mark, skill.id]
          );
          if (existing.length > 0) {
            // 使用 id 的后 4 位作为后缀
            mark = `${mark}-${skill.id.slice(-4)}`;
          }
        }
        
        await conn.execute(
          'UPDATE skills SET mark = ? WHERE id = ?',
          [mark, skill.id]
        );
        console.log(`  ✓ Set mark for ${skill.name}: ${mark}`);
      }
      
      console.log(`  ✓ Generated mark values for ${skills.length} skills`);
    }
  },

  // ==================== 知识库权限控制 ====================
  // Issue #426: 知识库权限控制
  // 添加 visibility、creator_id 字段，实现三级可见性
  {
    name: 'knowledge_bases.visibility and creator_id columns add',
    check: async (conn) => await hasColumn(conn, 'knowledge_bases', 'visibility'),
    migrate: async (conn) => {
      // 1. 添加 visibility 字段
      await conn.execute(`
        ALTER TABLE knowledge_bases
        ADD COLUMN visibility ENUM('owner', 'department', 'all') DEFAULT 'owner'
          COMMENT '公开级别：owner=仅管理员, department=部门可见, all=全员可见'
          AFTER description
      `);
      console.log('  ✓ Added visibility column to knowledge_bases table');

      // 2. 添加 creator_id 字段
      await conn.execute(`
        ALTER TABLE knowledge_bases
        ADD COLUMN creator_id VARCHAR(32) NOT NULL DEFAULT ''
          COMMENT '创建者ID'
          AFTER owner_id
      `);
      console.log('  ✓ Added creator_id column to knowledge_bases table');

      // 3. 修改 owner_id 字段注释
      await conn.execute(`
        ALTER TABLE knowledge_bases
        MODIFY COLUMN owner_id VARCHAR(32) NOT NULL COMMENT '知识库管理员ID'
      `);
      console.log('  ✓ Updated owner_id column comment');

      // 4. 添加索引
      await safeExecute(conn, `
        CREATE INDEX idx_kb_visibility ON knowledge_bases(visibility)
      `);
      console.log('  ✓ Added idx_kb_visibility index');

      await safeExecute(conn, `
        CREATE INDEX idx_kb_creator ON knowledge_bases(creator_id)
      `);
      console.log('  ✓ Added idx_kb_creator index');

      // 5. 添加外键约束
      await safeExecute(conn, `
        ALTER TABLE knowledge_bases
        ADD CONSTRAINT fk_kb_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('  ✓ Added fk_kb_creator foreign key');

      // 6. 数据迁移：现有数据 creator_id = owner_id
      await conn.execute(`
        UPDATE knowledge_bases SET creator_id = owner_id WHERE creator_id = ''
      `);
      console.log('  ✓ Migrated existing data: creator_id = owner_id');
    }
  },

  // ==================== skill_parameters 表添加 allow_user_override 字段 ====================
  // 修复：导出/导入脚本缺失该字段，且数据库升级脚本缺少该迁移
  {
    name: 'skill_parameters.allow_user_override column add',
    check: async (conn) => await hasColumn(conn, 'skill_parameters', 'allow_user_override'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE skill_parameters
        ADD COLUMN allow_user_override BIT(1) DEFAULT b'1' COMMENT '是否允许用户覆盖'
      `);
      console.log('  ✓ Added allow_user_override column to skill_parameters table');
    }
  },
];

/**
 * 升级主函数
 */
async function upgrade() {
  let connection;
  const results = {
    applied: [],
    skipped: [],
    failed: []
  };

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database:', DB_CONFIG.database);
    console.log('\n🔍 Checking database schema...\n');

    for (const migration of MIGRATIONS) {
      try {
        const needsMigration = !(await migration.check(connection));
        
        if (needsMigration) {
          console.log(`⏳ Applying: ${migration.name}...`);
          await migration.migrate(connection);
          console.log(`  ✅ Applied: ${migration.name}`);
          results.applied.push(migration.name);
        } else {
          console.log(`  ⏭️  Skipped: ${migration.name} (already exists)`);
          results.skipped.push(migration.name);
        }
      } catch (error) {
        console.error(`  ❌ Failed: ${migration.name} - ${error.message}`);
        results.failed.push({ name: migration.name, error: error.message });
      }
    }

    // 创建图片存储目录
    const imagesDir = path.resolve(KB_IMAGES_ROOT);
    try {
      await fs.mkdir(imagesDir, { recursive: true });
      console.log(`\n📁 KB images directory: ${imagesDir}`);
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error(`  ⚠️  Could not create KB images directory: ${err.message}`);
      }
    }

    // 创建工作空间目录
    const workspaceDir = path.resolve(WORKSPACE_ROOT);
    try {
      await fs.mkdir(workspaceDir, { recursive: true });
      console.log(`📁 Workspace directory: ${workspaceDir}`);
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error(`  ⚠️  Could not create workspace directory: ${err.message}`);
      }
    }

    // 打印摘要
    console.log('\n' + '='.repeat(50));
    console.log('📊 Upgrade Summary:');
    console.log(`  ✅ Applied: ${results.applied.length}`);
    console.log(`  ⏭️  Skipped: ${results.skipped.length}`);
    console.log(`  ❌ Failed:  ${results.failed.length}`);
    
    if (results.applied.length > 0) {
      console.log('\nApplied migrations:');
      results.applied.forEach(name => console.log(`  - ${name}`));
    }
    
    if (results.failed.length > 0) {
      console.log('\nFailed migrations:');
      results.failed.forEach(({ name, error }) => console.log(`  - ${name}: ${error}`));
    }

    console.log('\n✅ Database upgrade completed!\n');

  } catch (error) {
    console.error('❌ Upgrade failed:', error.message);
    throw error;
  } finally {
    if (connection) await connection.end();
  }

  return results;
}

/**
 * 检查是否需要升级（用于服务器启动时自动检查）
 */
async function needsUpgrade() {
  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    
    for (const migration of MIGRATIONS) {
      const needsMigration = !(await migration.check(connection));
      if (needsMigration) {
        return true;
      }
    }
    return false;
  } finally {
    if (connection) await connection.end();
  }
}

// 检查必需的环境变量
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

// 如果直接运行此脚本，执行升级
// 使用 import.meta.url 检测是否为主模块
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  upgrade().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export { upgrade, needsUpgrade, MIGRATIONS };