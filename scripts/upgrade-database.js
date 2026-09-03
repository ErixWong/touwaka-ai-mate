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
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import Utils from '../lib/utils.js';
import { SYSTEM_USER_USERNAME } from '../lib/system-account.js';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// 知识库图片存储目录
const KB_IMAGES_ROOT = process.env.KB_IMAGES_ROOT || './data/kb-images';
// 工作空间根目录 - 从 DATA_BASE_PATH 派生
const DATA_BASE_PATH = process.env.DATA_BASE_PATH
  ? (path.isAbsolute(process.env.DATA_BASE_PATH)
      ? process.env.DATA_BASE_PATH
      : path.join(process.cwd(), process.env.DATA_BASE_PATH))
  : path.join(process.cwd(), 'data');
const WORKSPACE_ROOT = path.join(DATA_BASE_PATH, 'work');

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

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}

/**
 * 仅在外键存在时删除，兼容历史库中约束缺失的情况
 */
async function dropForeignKeyIfExists(connection, tableName, constraintName) {
  if (!await hasTable(connection, tableName)) {
    return false;
  }

  if (!await hasForeignKey(connection, tableName, constraintName)) {
    return false;
  }

  await connection.execute(
    `ALTER TABLE ${quoteIdentifier(tableName)} DROP FOREIGN KEY ${quoteIdentifier(constraintName)}`
  );
  return true;
}

// Find foreign keys by column name, including legacy unnamed constraints.
async function getForeignKeyNamesForColumn(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT DISTINCT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
       AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [DB_CONFIG.database, tableName, columnName]
  );
  return rows.map(row => row.CONSTRAINT_NAME);
}

async function dropForeignKeysForColumn(connection, tableName, columnName) {
  if (!await hasTable(connection, tableName)) {
    return 0;
  }

  const constraintNames = await getForeignKeyNamesForColumn(connection, tableName, columnName);
  for (const constraintName of constraintNames) {
    await connection.execute(
      `ALTER TABLE ${quoteIdentifier(tableName)} DROP FOREIGN KEY ${quoteIdentifier(constraintName)}`
    );
  }
  return constraintNames.length;
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

async function getAnyExistingUserId(connection) {
  const [rows] = await connection.execute(
    `SELECT id FROM users ORDER BY created_at ASC LIMIT 1`
  );
  return rows.length > 0 ? rows[0].id : null;
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
  // ==================== 退役 remote-llm 技能 ====================
  {
    name: 'retire-remote-llm-skill',
    check: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT 1 FROM skills WHERE id = 'remote-llm'"
      );
      return rows.length === 0;
    },
    migrate: async (conn) => {
      console.log('  ⚠ Retiring remote-llm skill...');
      await conn.execute("DELETE FROM skill_parameters WHERE skill_id = 'remote-llm'");
      console.log('    - Deleted skill_parameters entries');
      await conn.execute("DELETE FROM skill_tools WHERE skill_id = 'remote-llm'");
      console.log('    - Deleted skill_tools entries');
      await conn.execute("DELETE FROM skills WHERE id = 'remote-llm'");
      console.log('    - Deleted skills entry');
      console.log('  ✓ Retired remote-llm skill');
    }
  },
  // ==================== 专家聊天请求持久化 ====================
  {
    name: 'create chat_requests table',
    check: async (conn) => await hasTable(conn, 'chat_requests'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE chat_requests (
          request_id VARCHAR(64) NOT NULL,
          original_request_id VARCHAR(64) NULL,
          topic_id VARCHAR(32) NULL,
          user_id VARCHAR(32) NOT NULL,
          expert_id VARCHAR(32) NOT NULL,
          model_id VARCHAR(32) NULL,
          task_id VARCHAR(32) NULL,
          user_message_id VARCHAR(32) NULL,
          assistant_message_id VARCHAR(32) NULL,
          status ENUM('accepted','running','completed','failed','stopped','timeout') NOT NULL DEFAULT 'accepted',
          content TEXT NOT NULL,
          working_path TEXT NULL,
          error_message TEXT NULL,
          created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          started_at DATETIME NULL,
          completed_at DATETIME NULL,
          PRIMARY KEY (request_id),
          KEY idx_chat_request_user (user_id),
          KEY idx_chat_request_expert (expert_id),
          KEY idx_chat_request_topic (topic_id),
          KEY idx_chat_request_status (status),
          KEY idx_chat_request_created (created_at),
          KEY idx_chat_request_original (original_request_id),
          KEY idx_chat_request_user_message (user_message_id),
          KEY idx_chat_request_assistant_message (assistant_message_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('  ✓ Created chat_requests table');
    }
  },
  {
    name: 'messages.request_id add request mapping',
    check: async (conn) => await hasColumn(conn, 'messages', 'request_id'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE messages
        ADD COLUMN request_id VARCHAR(64) NULL COMMENT '所属聊天请求ID' AFTER id
      `);
      console.log('  ✓ Added messages.request_id column');
    }
  },
  {
    name: 'messages.request_id add index',
    check: async (conn) => await hasIndex(conn, 'messages', 'idx_request'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE messages
        ADD INDEX idx_request (request_id)
      `);
      console.log('  ✓ Added messages.idx_request index');
    }
  },
  // ==================== 助理表 ID 字段重命名 ====================
  // 将 assistant_type 重命名为 id
  {
    name: 'assistants.id column rename from assistant_type',
    check: async (conn) => {
      if (!await hasTable(conn, 'assistants') || !await hasTable(conn, 'assistant_requests')) {
        return true;
      }
      return await hasColumn(conn, 'assistants', 'id');
    },
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

  // ==================== user_skill_parameters 表创建 ====================
  // 用户技能参数表（只存储用户覆盖的参数）
  {
    name: 'user_skill_parameters table create',
    check: async (conn) => await hasTable(conn, 'user_skill_parameters'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS user_skill_parameters (
          id VARCHAR(32) PRIMARY KEY,
          user_id VARCHAR(32) NOT NULL COMMENT '用户ID',
          skill_id VARCHAR(64) NOT NULL COMMENT '技能ID',
          param_name VARCHAR(100) NOT NULL COMMENT '参数名',
          param_value TEXT COMMENT '参数值',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_skill_param (user_id, skill_id, param_name),
          INDEX idx_user_id (user_id),
          INDEX idx_skill_id (skill_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户技能参数表（只存储用户覆盖的参数）'
      `);
      console.log('  ✓ Created user_skill_parameters table');
    }
  },

  // ==================== knowledge_bases 表添加 embedding 相关字段 ====================
  // 修复：低版本数据库缺少 embedding_model_id 和 embedding_dim 字段
  {
    name: 'knowledge_bases.embedding_model_id and embedding_dim columns add',
    check: async (conn) => await hasColumn(conn, 'knowledge_bases', 'embedding_model_id'),
    migrate: async (conn) => {
      // 1. 添加 embedding_model_id 字段
      await conn.execute(`
        ALTER TABLE knowledge_bases
        ADD COLUMN embedding_model_id VARCHAR(50) NULL COMMENT '关联 ai_models 表'
      `);
      console.log('  ✓ Added embedding_model_id column to knowledge_bases table');

      // 2. 添加 embedding_dim 字段
      await conn.execute(`
        ALTER TABLE knowledge_bases
        ADD COLUMN embedding_dim INT DEFAULT 1536
      `);
      console.log('  ✓ Added embedding_dim column to knowledge_bases table');

      // 3. 添加索引
      await safeExecute(conn, `
        CREATE INDEX embedding_model_id ON knowledge_bases(embedding_model_id)
      `);
      console.log('  ✓ Added embedding_model_id index');
    }
  },

  // ==================== users 表添加 position_id 外键 ====================
  // 修复：sequelize-auto 需要外键才能生成 user-position 关联
  {
    name: 'users.position_id foreign key add',
    check: async (conn) => await hasForeignKey(conn, 'users', 'fk_user_position'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE users
        ADD CONSTRAINT fk_user_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL
      `);
      console.log('  ✓ Added fk_user_position foreign key to users table');
    }
  },

  // ==================== assistant_requests 表添加 notification_status 字段 ====================
  // Issue #493: 助理通知状态跟踪
  {
    name: 'assistant_requests.notification_status column add',
    check: async (conn) => {
      if (!await hasTable(conn, 'assistant_requests')) {
        return true;
      }
      return await hasColumn(conn, 'assistant_requests', 'notification_status');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE assistant_requests
        ADD COLUMN notification_status VARCHAR(20) DEFAULT 'pending' COMMENT '通知状态: pending/sent/failed/skipped'
      `);
      console.log('  ✓ Added notification_status column to assistant_requests table');
    }
  },

  // ==================== assistant_requests 表添加 notification_error 字段 ====================
  // Issue #493: 助理通知错误信息
  {
    name: 'assistant_requests.notification_error column add',
    check: async (conn) => {
      if (!await hasTable(conn, 'assistant_requests')) {
        return true;
      }
      return await hasColumn(conn, 'assistant_requests', 'notification_error');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE assistant_requests
        ADD COLUMN notification_error TEXT COMMENT '通知失败时的错误信息'
      `);
      console.log('  ✓ Added notification_error column to assistant_requests table');
    }
  },

  // ==================== assistant_requests 表添加 notification_sent_at 字段 ====================
  // Issue #493: 助理通知发送时间
  {
    name: 'assistant_requests.notification_sent_at column add',
    check: async (conn) => {
      if (!await hasTable(conn, 'assistant_requests')) {
        return true;
      }
      return await hasColumn(conn, 'assistant_requests', 'notification_sent_at');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE assistant_requests
        ADD COLUMN notification_sent_at DATETIME COMMENT '通知发送时间'
      `);
      console.log('  ✓ Added notification_sent_at column to assistant_requests table');
    }
  },

  // ==================== experts 表 context_strategy 添加 minimal 选项 ====================
  // Issue #437: Psyche 上下文管理机制
  {
    name: 'experts.context_strategy add minimal option',
    check: async (conn) => {
      const columnType = await getColumnType(conn, 'experts', 'context_strategy');
      return columnType && columnType.includes('minimal');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE experts
        MODIFY COLUMN context_strategy ENUM('full','simple','minimal')
          DEFAULT 'full'
          COMMENT '上下文组织策略：full=完整上下文，simple=简单上下文，minimal=Psyche精简上下文'
      `);
      console.log('  ✓ Added minimal option to experts.context_strategy ENUM');
    }
  },

  // ==================== experts 表添加 psyche_config 字段 ====================
  // Issue #437: Psyche 上下文管理机制配置
  {
    name: 'experts.psyche_config column add',
    check: async (conn) => await hasColumn(conn, 'experts', 'psyche_config'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE experts
        ADD COLUMN psyche_config TEXT COMMENT 'Psyche配置（JSON格式）：{max_tokens_ratio, reflection_lookback, enable_notes}'
      `);
      console.log('  ✓ Added psyche_config column to experts table');
    }
  },

  // ==================== attachments 表创建 ====================
  // Issue #557: 通用附件服务
  {
    name: 'attachments table create',
    check: async (conn) => await hasTable(conn, 'attachments'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS attachments (
          id VARCHAR(20) PRIMARY KEY COMMENT '附件唯一ID（Utils.newID生成）',
          source_tag VARCHAR(50) NOT NULL COMMENT '业务标识：kb_article_image, user_avatar, task_export 等',
          source_id VARCHAR(20) NOT NULL COMMENT '关联资源ID',
          file_name VARCHAR(255) DEFAULT NULL COMMENT '原始文件名',
          ext_name VARCHAR(20) DEFAULT NULL COMMENT '扩展名（png, jpg, pdf等）',
          mime_type VARCHAR(100) NOT NULL COMMENT 'MIME类型',
          file_size INT DEFAULT 0 COMMENT '文件大小（字节）',
          file_path VARCHAR(500) NOT NULL COMMENT '相对路径：2026/04/05/abc123.png',
          width INT DEFAULT NULL COMMENT '图片宽度（仅图片类型）',
          height INT DEFAULT NULL COMMENT '图片高度',
          alt_text VARCHAR(500) DEFAULT NULL COMMENT '替代文本',
          description TEXT DEFAULT NULL COMMENT '文件描述（VL模型生成）',
          created_by VARCHAR(32) DEFAULT NULL COMMENT '上传者ID',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_source (source_tag, source_id),
          INDEX idx_created_at (created_at),
          INDEX idx_created_by (created_by),
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用附件表'
      `);
      console.log('  ✓ Created attachments table');
    }
  },

  // ==================== attachment_token 表创建 ====================
  // Issue #557: 附件访问 Token 表
  {
    name: 'attachment_token table create',
    check: async (conn) => await hasTable(conn, 'attachment_token'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS attachment_token (
          id INT PRIMARY KEY AUTO_INCREMENT,
          token VARCHAR(64) NOT NULL UNIQUE COMMENT 'Token字符串(随机生成，非JWT)',
          source_tag VARCHAR(50) NOT NULL COMMENT '资源类型：kb_article_image, task_export 等',
          source_id VARCHAR(20) NOT NULL COMMENT '资源ID：article_id, task_id 等',
          user_id VARCHAR(32) NOT NULL COMMENT '创建Token的用户ID',
          expires_at DATETIME NOT NULL COMMENT '过期时间',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_access_at DATETIME DEFAULT NULL COMMENT '最后访问时间（用于续期追踪）',
          INDEX idx_token (token),
          INDEX idx_source (source_tag, source_id),
          INDEX idx_user_source (user_id, source_tag, source_id),
          INDEX idx_expires_at (expires_at),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='附件访问Token表'
      `);
      console.log('  ✓ Created attachment_token table');
    }
  },

  {
    name: 'attachments source_id length upgrade',
    check: async (conn) => {
      const [rows] = await conn.execute(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS len
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attachments' AND COLUMN_NAME = 'source_id'`,
        [DB_CONFIG.database]
      );
      return rows.length > 0 && Number(rows[0].len) >= 64;
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE attachments MODIFY COLUMN source_id VARCHAR(64) NOT NULL COMMENT '关联资源ID'`);
      console.log('  ✓ Upgraded attachments.source_id to VARCHAR(64)');
    }
  },

  {
    name: 'attachment_token source_id length upgrade',
    check: async (conn) => {
      const [rows] = await conn.execute(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS len
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attachment_token' AND COLUMN_NAME = 'source_id'`,
        [DB_CONFIG.database]
      );
      return rows.length > 0 && Number(rows[0].len) >= 64;
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE attachment_token MODIFY COLUMN source_id VARCHAR(64) NOT NULL COMMENT '资源ID：article_id, task_id 等'`);
      console.log('  ✓ Upgraded attachment_token.source_id to VARCHAR(64)');
    }
  },

  // ==================== App 平台表 ====================
  // Issue #603: App 平台基础架构与合同管理小程序
  // 参见 docs/design/parse3/database-schema.md

  {
    name: 'mini_apps table',
    check: async (conn) => await hasTable(conn, 'mini_apps'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE mini_apps (
          id VARCHAR(32) PRIMARY KEY,
          name VARCHAR(128) NOT NULL COMMENT '小程序/表名称',
          description TEXT COMMENT '描述',
          icon VARCHAR(16) DEFAULT '📱' COMMENT '图标（emoji）',
          type ENUM('document', 'workflow', 'data', 'utility') NOT NULL COMMENT '类型',
          component VARCHAR(128) COMMENT '前端组件名，NULL=使用GenericMiniApp',
          fields JSON NOT NULL COMMENT '字段定义列表',
          views JSON COMMENT '视图配置',
          config JSON COMMENT '功能配置',
          visibility ENUM('owner', 'department', 'all', 'role') DEFAULT 'all' COMMENT '可见范围',
          owner_id VARCHAR(32) NOT NULL COMMENT 'App管理员',
          creator_id VARCHAR(32) NOT NULL COMMENT '创建者',
          sort_order INT DEFAULT 0 COMMENT '排序',
          is_active BIT(1) DEFAULT 1 COMMENT '是否启用',
          revision INT DEFAULT 1 COMMENT '版本号',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
          FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小程序注册表（多维表格定义）'
      `);
      console.log('  ✓ Created mini_apps table');
    }
  },

  {
    name: 'mini_app_rows table',
    check: async (conn) => await hasTable(conn, 'mini_app_rows'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE mini_app_rows (
          id VARCHAR(32) PRIMARY KEY,
          app_id VARCHAR(32) NOT NULL COMMENT '小程序ID',
          user_id VARCHAR(32) NOT NULL COMMENT '创建用户ID',
          data JSON NOT NULL COMMENT '行数据（字段名→值的映射）',
          title VARCHAR(255) COMMENT '记录标题（冗余，便于列表展示）',
          ai_extracted BIT(1) DEFAULT 0 COMMENT '是否由AI提取',
          ai_confidence JSON COMMENT '各字段的AI置信度',
          version VARCHAR(32) COMMENT '版本号',
          previous_version_id VARCHAR(32) COMMENT '上一版本ID',
          revision INT DEFAULT 1 COMMENT '数据版本号（乐观锁）',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_app_user (app_id, user_id),
          INDEX idx_created_at (created_at),
          FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小程序数据记录（多维表格行）'
      `);
      await conn.execute(`
        ALTER TABLE mini_app_rows
        ADD COLUMN _status VARCHAR(64)
          GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$._status'))) STORED,
        ADD INDEX idx_app_status (app_id, _status)
      `);
      console.log('  ✓ Created mini_app_rows table with _status virtual column');
    }
  },

  {
    name: 'mini_app_files table',
    check: async (conn) => await hasTable(conn, 'mini_app_files'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE mini_app_files (
          id VARCHAR(32) PRIMARY KEY,
          record_id VARCHAR(32) NOT NULL COMMENT '关联记录ID',
          app_id VARCHAR(32) NOT NULL COMMENT '小程序ID（冗余）',
          attachment_id VARCHAR(20) NOT NULL COMMENT '附件ID（关联attachments表）',
          field_name VARCHAR(64) COMMENT '对应的字段名',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_app (app_id),
          INDEX idx_attachment (attachment_id),
          FOREIGN KEY (record_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE,
          FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小程序文件关联表'
      `);
      console.log('  ✓ Created mini_app_files table');
    }
  },

  {
    name: 'app_row_handlers table',
    // Phase 6: table retired. If missing, do not recreate it.
    check: async () => true,
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_row_handlers (
          id VARCHAR(32) PRIMARY KEY,
          name VARCHAR(128) NOT NULL COMMENT '脚本名称',
          description TEXT COMMENT '描述',
          handler VARCHAR(255) NOT NULL COMMENT '处理函数路径',
          handler_function VARCHAR(128) DEFAULT 'process' COMMENT '处理函数名',
          concurrency INT DEFAULT 3 COMMENT '最大并发数',
          timeout INT DEFAULT 60 COMMENT '超时时间（秒）',
          max_retries INT DEFAULT 2 COMMENT '最大重试次数',
          is_active BIT(1) DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='App 行处理器'
      `);
      console.log('  ✓ Created app_row_handlers table');
    }
  },

  {
    name: 'app_state table',
    // Phase 6: table retired. If missing, do not recreate it.
    check: async () => true,
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_state (
          id VARCHAR(32) PRIMARY KEY,
          app_id VARCHAR(32) NOT NULL COMMENT '小程序ID',
          name VARCHAR(64) NOT NULL COMMENT '状态名（如pending_ocr）',
          label VARCHAR(128) NOT NULL COMMENT '显示名（如待OCR）',
          sort_order INT DEFAULT 0 COMMENT '流转顺序（0=初始）',
          is_initial BIT(1) DEFAULT 0 COMMENT '是否初始状态',
          is_terminal BIT(1) DEFAULT 0 COMMENT '是否终态',
          is_error BIT(1) DEFAULT 0 COMMENT '是否错误状态',
          handler_id VARCHAR(32) COMMENT '处理脚本ID',
          success_next_state VARCHAR(64) COMMENT '成功后转到什么状态',
          failure_next_state VARCHAR(64) COMMENT '失败后转到什么状态',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_app_name (app_id, name),
          INDEX idx_app_sort (app_id, sort_order),
          FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE,
          FOREIGN KEY (handler_id) REFERENCES app_row_handlers(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='App 状态定义表'
      `);
      console.log('  ✓ Created app_state table');
    }
  },

  {
    name: 'app_action_logs table',
    check: async (conn) => await hasTable(conn, 'app_action_logs'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_action_logs (
          id VARCHAR(32) PRIMARY KEY,
          handler_id VARCHAR(32) NOT NULL COMMENT '处理器ID',
          record_id VARCHAR(32) NOT NULL COMMENT '行ID',
          app_id VARCHAR(32) NOT NULL COMMENT '小程序ID',
          trigger_status VARCHAR(64) NOT NULL COMMENT '触发时的状态',
          result_status VARCHAR(64) COMMENT '执行后的状态',
          success BIT(1) NOT NULL COMMENT '是否成功',
          output_data JSON COMMENT '处理器输出的数据',
          error_message TEXT COMMENT '错误信息',
          duration INT COMMENT '执行耗时（毫秒）',
          retry_count INT DEFAULT 0 COMMENT '重试次数',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_handler (handler_id),
          INDEX idx_record (record_id),
          INDEX idx_app_created (app_id, created_at),
          FOREIGN KEY (record_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE,
          FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='App 动作日志'
      `);
      console.log('  ✓ Created app_action_logs table');
    }
  },

  {
    name: 'mini_app_role_access table',
    check: async (conn) => await hasTable(conn, 'mini_app_role_access'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE mini_app_role_access (
          id VARCHAR(32) PRIMARY KEY,
          app_id VARCHAR(32) NOT NULL COMMENT '小程序ID',
          role_id VARCHAR(32) NOT NULL COMMENT '角色ID',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_app_role (app_id, role_id),
          FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小程序角色访问控制'
      `);
      console.log('  ✓ Created mini_app_role_access table');
    }
  },

  // ==================== mcp_servers 表创建 ====================
  // Issue #601: MCP Client 驻留技能实现
  {
    name: 'mcp_servers table create',
    check: async (conn) => await hasTable(conn, 'mcp_servers'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS mcp_servers (
          id VARCHAR(32) PRIMARY KEY,
          name VARCHAR(64) NOT NULL UNIQUE COMMENT 'MCP Server 名称',
          display_name VARCHAR(128) COMMENT '显示名称',
          description TEXT COMMENT '描述',
          command VARCHAR(256) NOT NULL COMMENT '启动命令',
          args JSON COMMENT '命令参数',
          env_template JSON COMMENT '环境变量模板，支持 \${user.xxx} 占位符',
          is_public BIT(1) DEFAULT b'0' COMMENT '是否公共（无需用户凭证）',
          is_enabled BIT(1) DEFAULT b'1' COMMENT '是否启用',
          requires_credentials BIT(1) DEFAULT b'0' COMMENT '是否需要用户凭证',
          credential_fields JSON COMMENT '凭证字段定义',
          icon VARCHAR(50) COMMENT '图标标识',
          category VARCHAR(50) COMMENT '分类：search, storage, dev-tools, etc.',
          created_by VARCHAR(32) COMMENT '创建者',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_name (name),
          INDEX idx_is_enabled (is_enabled),
          INDEX idx_category (category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='MCP Server 定义表'
      `);
      console.log('  ✓ Created mcp_servers table');
    }
  },

  // ==================== mcp_credentials 表创建 ====================
  // Issue #601: MCP 系统默认凭证表
  {
    name: 'mcp_credentials table create',
    check: async (conn) => await hasTable(conn, 'mcp_credentials'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS mcp_credentials (
          id VARCHAR(32) PRIMARY KEY,
          mcp_server_id VARCHAR(32) NOT NULL COMMENT 'MCP Server ID',
          credentials JSON NOT NULL COMMENT '系统默认凭证（加密存储）',
          is_enabled BIT(1) DEFAULT b'1' COMMENT '是否启用',
          created_by VARCHAR(32) COMMENT '创建者（管理员）',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_server (mcp_server_id),
          INDEX idx_is_enabled (is_enabled),
          FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='MCP 系统默认凭证表'
      `);
      console.log('  ✓ Created mcp_credentials table');
    }
  },

  // ==================== mcp_user_credentials 表创建 ====================
  // Issue #601: MCP 用户私有凭证表
  {
    name: 'mcp_user_credentials table create',
    check: async (conn) => await hasTable(conn, 'mcp_user_credentials'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS mcp_user_credentials (
          id VARCHAR(32) PRIMARY KEY,
          user_id VARCHAR(32) NOT NULL COMMENT '用户ID',
          mcp_server_id VARCHAR(32) NOT NULL COMMENT 'MCP Server ID',
          credentials JSON NOT NULL COMMENT '用户凭证（加密存储）',
          is_enabled BIT(1) DEFAULT b'1' COMMENT '是否启用',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_server (user_id, mcp_server_id),
          INDEX idx_user_id (user_id),
          INDEX idx_mcp_server_id (mcp_server_id),
          INDEX idx_is_enabled (is_enabled),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='MCP 用户私有凭证表'
      `);
      console.log('  ✓ Created mcp_user_credentials table');
    }
  },

  // ==================== mcp_tools_cache 表创建 ====================
  // Issue #601: MCP 工具定义缓存表
  {
    name: 'mcp_tools_cache table create',
    check: async (conn) => await hasTable(conn, 'mcp_tools_cache'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS mcp_tools_cache (
          id VARCHAR(32) PRIMARY KEY,
          mcp_server_id VARCHAR(32) NOT NULL COMMENT 'MCP Server ID',
          tool_name VARCHAR(64) NOT NULL COMMENT '工具名称',
          description TEXT COMMENT '工具描述',
          input_schema JSON COMMENT '输入参数定义',
          cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_server_tool (mcp_server_id, tool_name),
          INDEX idx_mcp_server_id (mcp_server_id),
          FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='MCP 工具定义缓存表'
      `);
      console.log('  ✓ Created mcp_tools_cache table');
    }
  },

  // ==================== App Market 配置初始化 ====================

  {
    name: 'app_market system_settings seed',
    check: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'app_market.registry_url'"
      );
      if (rows.length === 0) return false;
      const correctUrl = 'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/master/apps';
      return rows[0].setting_value === correctUrl;
    },
    migrate: async (conn) => {
      await conn.execute(`
        INSERT INTO system_settings (setting_key, setting_value, value_type, description) VALUES
        ('app_market.registry_url', 'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/master/apps', 'string', 'App Market Registry URL'),
        ('app_market.registry_branch', 'master', 'string', 'Registry 分支'),
        ('app_market.auto_check_updates', 'true', 'boolean', '是否自动检查更新'),
        ('app_market.check_interval_hours', '24', 'number', '自动检查间隔（小时）'),
        ('app_market.offline_mode', 'false', 'boolean', '离线模式'),
        ('app_market.cache_ttl_hours', '168', 'number', '缓存有效期（小时）'),
        ('app_market.last_check_at', '', 'string', '上次检查时间')
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
      `);
      console.log('  ✓ Seeded app_market system_settings');
    }
  },

  // ==================== MCP HTTP 传输支持 ====================
  {
    name: 'mcp_servers.add_transport_type_and_http_fields',
    check: async (conn) => await hasColumn(conn, 'mcp_servers', 'transport_type'),
    migrate: async (conn) => {
      // 添加 transport_type 字段
      await conn.execute(`
        ALTER TABLE mcp_servers 
        ADD COLUMN transport_type ENUM('stdio', 'http', 'sse') DEFAULT 'stdio' COMMENT 'MCP 传输类型：stdio=标准输入输出, http=HTTP Stream, sse=Server-Sent Events'
      `);
      console.log('  ✓ Added transport_type column to mcp_servers');

      // 添加 url 字段（HTTP MCP Server 地址）
      await conn.execute(`
        ALTER TABLE mcp_servers 
        ADD COLUMN url VARCHAR(512) NULL COMMENT 'HTTP MCP Server URL（transport_type=http 时使用）'
      `);
      console.log('  ✓ Added url column to mcp_servers');

      // 添加 headers 字段（HTTP 请求头）
      await conn.execute(`
        ALTER TABLE mcp_servers 
        ADD COLUMN headers TEXT NULL COMMENT 'HTTP Headers，JSON 格式（transport_type=http 时使用）'
      `);
      console.log('  ✓ Added headers column to mcp_servers');

      // 为已有数据设置默认值
      await conn.execute(`
        UPDATE mcp_servers 
        SET transport_type = 'stdio' 
        WHERE transport_type IS NULL
      `);
      console.log('  ✓ Set default transport_type for existing records');
    }
  },

  // ==================== MCP Client 驻留技能注册 ====================
  {
    name: 'mcp-client.skill_registration',
    check: async (conn) => {
      const [rows] = await conn.execute(`SELECT id FROM skills WHERE id = 'mcp-client'`);
      return rows.length > 0;
    },
    migrate: async (conn) => {
      // 注册技能
      await conn.execute(`
        INSERT INTO skills (id, name, description, source_type, source_path, is_active, created_at, updated_at)
        VALUES ('mcp-client', 'MCP Client', 'MCP 客户端驻留进程 - 管理多 MCP Server 连接（STDIO/HTTP Stream）', 'local', 'skills/mcp-client', 1, NOW(), NOW())
      `);
      console.log('  ✓ Registered mcp-client skill');

      // 注册驻留工具
      await conn.execute(`
        INSERT INTO skill_tools (id, skill_id, name, description, parameters, script_path, is_resident, created_at, updated_at)
        VALUES ('mcp-client-invoke', 'mcp-client', 'invoke', 'MCP Client 驻留进程入口工具', '{"type":"object","properties":{"action":{"type":"string","description":"操作类型"}}}', 'index.js', 1, NOW(), NOW())
      `);
      console.log('  ✓ Registered mcp-client invoke tool (is_resident=1)');
    }
  },

  // ==================== Agent Child Runner 驻留技能注册 ====================
  {
    name: 'agent-child-runner.skill_registration',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT t.id
        FROM skill_tools t
        JOIN skills s ON s.id = t.skill_id
        WHERE s.id = 'agent-child-runner'
          AND t.id = 'agent-child-runner-invoke'
          AND t.name = 'invoke'
          AND t.script_path = 'index.js'
          AND t.is_resident = 1
      `);
      return rows.length > 0;
    },
    migrate: async (conn) => {
      await conn.execute(`
        INSERT INTO skills (id, name, description, source_type, source_path, is_active, created_at, updated_at)
        VALUES ('agent-child-runner', 'Agent Child Runner', 'Agent 子任务驻留执行器 - 管理 Child Agent 异步运行状态并回调主服务执行', 'local', 'skills/agent-child-runner', 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          description = VALUES(description),
          source_type = VALUES(source_type),
          source_path = VALUES(source_path),
          is_active = VALUES(is_active),
          updated_at = NOW()
      `);
      console.log('  ✓ Registered agent-child-runner skill');

      await conn.execute(`
        INSERT INTO skill_tools (id, skill_id, name, description, parameters, script_path, is_resident, created_at, updated_at)
        VALUES (
          'agent-child-runner-invoke',
          'agent-child-runner',
          'invoke',
          'Agent Child Runner 驻留进程入口工具',
          '{"type":"object","properties":{"action":{"type":"string","enum":["start","status","result","events","cancel"],"description":"操作类型"},"delegation":{"type":"object","description":"已接受的 delegation envelope，用于 start"},"child_run_id":{"type":"string","description":"Child run ID，用于 status/result/events/cancel"},"options":{"type":"object","description":"运行选项，例如 session"}},"required":["action"]}',
          'index.js',
          1,
          NOW(),
          NOW()
        )
        ON DUPLICATE KEY UPDATE
          skill_id = VALUES(skill_id),
          name = VALUES(name),
          description = VALUES(description),
          parameters = VALUES(parameters),
          script_path = VALUES(script_path),
          is_resident = VALUES(is_resident),
          updated_at = NOW()
      `);
      console.log('  ✓ Registered agent-child-runner invoke tool (is_resident=1)');
    }
  },

  // ==================== MCP Stateless HTTP 传输支持 ====================
  {
    name: 'mcp_servers.add_stateless_http_transport',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mcp_servers' AND COLUMN_NAME = 'transport_type'
      `);
      const enumStr = rows[0]?.COLUMN_TYPE || '';
      return enumStr.includes('statelessHttp');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE mcp_servers 
        MODIFY COLUMN transport_type ENUM('stdio', 'http', 'sse', 'statelessHttp') DEFAULT 'stdio' 
        COMMENT 'MCP 传输类型：stdio=标准输入输出, http=HTTP Stream, sse=Server-Sent Events, statelessHttp=无状态HTTP'
      `);
      console.log('  ✓ Added statelessHttp to transport_type ENUM');
    }
  },

  // ==================== app_state 表添加 description 字段 ====================
  {
    name: 'app_state.add_description',
    // Phase 6: table retired. If missing, do not recreate/alter it.
    check: async () => true,
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_state
        ADD COLUMN description VARCHAR(255) NULL COMMENT '状态描述'
      `);
      console.log('  ✓ Added description column to app_state');
    }
  },

  // ==================== mini_app_rows status 字段统一迁移 ====================
  // Issue #654: 将 GENERATED _status 或实体 _status 统一改为实体 status
  {
    name: 'mini_app_rows.status_unified_migration',
    check: async (conn) => {
      // 检查是否已有 status 字段
      const [statusRows] = await conn.execute(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'mini_app_rows' AND COLUMN_NAME = 'status'
      `, [DB_CONFIG.database]);
      return statusRows.length > 0; // 已有 status 则跳过
    },
    migrate: async (conn) => {
      // 检查当前字段状态
      const [rows] = await conn.execute(`
        SELECT COLUMN_NAME, EXTRA FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'mini_app_rows' AND COLUMN_NAME IN ('_status', 'status')
      `, [DB_CONFIG.database]);

      const hasStatus = rows.some(r => r.COLUMN_NAME === 'status');
      const hasUnderscoreStatus = rows.some(r => r.COLUMN_NAME === '_status');
      const isGenerated = rows.some(r => r.COLUMN_NAME === '_status' && r.EXTRA?.includes('GENERATED'));

      if (hasStatus) {
        console.log('  ✓ status column already exists, skipping');
        return;
      }

      if (hasUnderscoreStatus) {
        if (isGenerated) {
          // GENERATED 列：先删除后创建
          console.log('  ⚠️ Found GENERATED _status, removing and creating entity status');
          await conn.execute(`ALTER TABLE mini_app_rows DROP COLUMN _status`);
          await conn.execute(`ALTER TABLE mini_app_rows ADD COLUMN status VARCHAR(64) DEFAULT 'pending_ocr'`);
        } else {
          // 实体列：直接重命名
          console.log('  ✓ Renaming entity _status to status');
          await conn.execute(`ALTER TABLE mini_app_rows CHANGE COLUMN _status status VARCHAR(64) DEFAULT 'pending_ocr'`);
        }
      } else {
        // 都不存在：直接创建
        console.log('  ✓ Creating new status column');
        await conn.execute(`ALTER TABLE mini_app_rows ADD COLUMN status VARCHAR(64) DEFAULT 'pending_ocr'`);
      }

      // 添加索引（如果不存在）
      await conn.execute(`ALTER TABLE mini_app_rows ADD INDEX IF NOT EXISTS idx_app_status (app_id, status)`);
      console.log('  ✓ Added idx_app_status index');
    }
  },

  // ==================== app_contract_mgr_content 添加 sections 字段 ====================
  // Issue #654: 章节结构存储
  {
    name: 'app_contract_mgr_content add sections column',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_content')) return true;
      return await hasColumn(conn, 'app_contract_mgr_content', 'sections');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_contract_mgr_content
        ADD COLUMN sections JSON COMMENT '章节结构数组'
      `);
      console.log('  ✓ Added sections JSON column to app_contract_mgr_content');
    }
  },

  // ==================== app_contract_mgr_content 添加 file_id 字段 ====================
  {
    name: 'app_contract_mgr_content add file_id column',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_content')) return true;
      return await hasColumn(conn, 'app_contract_mgr_content', 'file_id');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_contract_mgr_content
        ADD COLUMN file_id VARCHAR(32) NULL COMMENT '关联文件ID' AFTER row_id
      `);
      console.log('  ✓ Added file_id column to app_contract_mgr_content');
    }
  },

  // ==================== app_contract_mgr_rows 添加 party_b 字段 ====================
  // Issue #665: 合同管理乙方字段持久化
  {
    name: 'app_contract_mgr_rows add party_b column',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_rows')) return true;
      return await hasColumn(conn, 'app_contract_mgr_rows', 'party_b');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_contract_mgr_rows
        ADD COLUMN party_b VARCHAR(128) COMMENT '乙方'
      `);
      await conn.execute(`
        ALTER TABLE app_contract_mgr_rows
        ADD INDEX idx_party_b (party_b)
      `);
      console.log('  ✓ Added party_b column and index to app_contract_mgr_rows');
    }
  },

  // ==================== 合同比对结果表 ====================
  // Issue #671: 合同比对结果存储与Excel导出
  {
    name: 'app_contract_mgr_compares create table',
    check: async (conn) => await hasTable(conn, 'app_contract_mgr_compares'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_contract_mgr_compares (
          row_id VARCHAR(32) PRIMARY KEY COMMENT 'A合同 mini_app_rows.id',
          target_row_id VARCHAR(32) NOT NULL COMMENT 'B合同 mini_app_rows.id',
          compare_result JSON COMMENT '完整比对结果（results数组）',
          summary_identical INT DEFAULT 0 COMMENT '一致章节数',
          summary_modified INT DEFAULT 0 COMMENT '修改章节数',
          summary_added INT DEFAULT 0 COMMENT '新增章节数',
          summary_removed INT DEFAULT 0 COMMENT '删除章节数',
          model_name VARCHAR(64) COMMENT '使用的模型名称',
          duration_ms INT COMMENT '比对耗时（毫秒）',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_target (target_row_id),
          INDEX idx_modified (summary_modified),
          FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE,
          FOREIGN KEY (target_row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同比对结果表'
      `);
      console.log('  ✓ Created app_contract_mgr_compares table');
    }
  },

  // ==================== AppClock 回调模式表 ====================
  // Issue #693: AppClock 回调模式升级
  {
    name: 'app_clock_registry create table',
    check: async (conn) => await hasTable(conn, 'app_clock_registry'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_clock_registry (
          id VARCHAR(32) PRIMARY KEY,
          app_id VARCHAR(32) NOT NULL COMMENT '关联 mini_apps.id',
          tick_script VARCHAR(64) NULL COMMENT '自定义脚本名，空则用默认 tick',
          is_active BIT(1) DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE,
          INDEX idx_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='App调度注册表'
      `);
      console.log('  ✓ Created app_clock_registry table');
    }
  },

  {
    name: 'app_tick_log create table',
    check: async (conn) => await hasTable(conn, 'app_tick_log'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_tick_log (
          id VARCHAR(32) PRIMARY KEY,
          registry_id VARCHAR(32) NOT NULL,
          app_id VARCHAR(32) NOT NULL,
          success BIT(1) DEFAULT 1,
          output_data TEXT COMMENT 'JSON 输出',
          error_message TEXT,
          duration INT DEFAULT 0 COMMENT '耗时(ms)',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (registry_id) REFERENCES app_clock_registry(id) ON DELETE CASCADE,
          INDEX idx_registry (registry_id),
          INDEX idx_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='App执行日志'
      `);
      console.log('  ✓ Created app_tick_log table');
    }
  },

  // ==================== 注册现有 App 到 app_clock_registry ====================
  // Issue #693: 现有 contract-mgr-v2 注册
  {
    name: 'register contract-mgr-v2 to app_clock_registry',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT id FROM app_clock_registry WHERE app_id = 'contract-mgr-v2'
      `);
      return rows.length > 0;
    },
    migrate: async (conn) => {
      const [apps] = await conn.execute(`
        SELECT id FROM mini_apps WHERE id = 'contract-mgr-v2'
      `);
      
      if (apps.length > 0) {
        const id = crypto.randomBytes(10).toString('hex').slice(0, 20);
        await conn.execute(`
          INSERT INTO app_clock_registry (id, app_id, tick_script, is_active)
          VALUES (?, 'contract-mgr-v2', NULL, 1)
        `, [id]);
        console.log('  ✓ Registered contract-mgr-v2 to app_clock_registry');
      } else {
        console.log('  ⏭️  Skipped: contract-mgr-v2 not found in mini_apps');
      }
    }
  },
  {
    name: 'retire doc-ocr-pipeline app metadata',
    check: async (conn) => {
      const [registryRows] = await conn.execute(
        `SELECT id FROM app_clock_registry WHERE app_id = 'doc-ocr-pipeline' LIMIT 1`
      );
      const [miniAppRows] = await conn.execute(
        `SELECT id FROM mini_apps WHERE id = 'doc-ocr-pipeline' LIMIT 1`
      );
      return registryRows.length === 0 && miniAppRows.length === 0;
    },
    migrate: async (conn) => {
      await conn.execute(
        `DELETE FROM app_clock_registry WHERE app_id = 'doc-ocr-pipeline'`
      );
      await conn.execute(
        `DELETE FROM mini_apps WHERE id = 'doc-ocr-pipeline'`
      );
      console.log('  ✓ Retired doc-ocr-pipeline app metadata');
    }
  },

  // ==================== contract-mgr-v2 状态自主管理 ====================
  // Issue #693: content 表新增状态字段，移除 mini_app_rows 依赖
  {
    name: 'app_contract_mgr_v2_content add process_step',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_v2_content')) return true;
      return await hasColumn(conn, 'app_contract_mgr_v2_content', 'process_step');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_contract_mgr_v2_content
        ADD COLUMN process_step VARCHAR(32) DEFAULT 'pending_ocr' COMMENT '处理步骤',
        ADD COLUMN ocr_task_id VARCHAR(255) NULL COMMENT 'OCR任务ID',
        ADD COLUMN filter_carried_over LONGTEXT NULL COMMENT '滑动窗口中间状态',
        ADD COLUMN filter_chunk_index INT DEFAULT 0 COMMENT '当前处理chunk索引',
        ADD COLUMN file_id VARCHAR(32) NULL COMMENT '关联文件ID',
        ADD INDEX idx_process_step (process_step)
      `);
      
      // 根据现有数据推断状态
      await conn.execute(`
        UPDATE app_contract_mgr_v2_content 
        SET process_step = 'done' 
        WHERE sections IS NOT NULL AND filtered_text IS NOT NULL
      `);
      await conn.execute(`
        UPDATE app_contract_mgr_v2_content 
        SET process_step = 'pending_section' 
        WHERE filtered_text IS NOT NULL AND sections IS NULL AND extract_json IS NOT NULL
      `);
      await conn.execute(`
        UPDATE app_contract_mgr_v2_content 
        SET process_step = 'pending_extract' 
        WHERE filtered_text IS NOT NULL AND extract_json IS NULL
      `);
      await conn.execute(`
        UPDATE app_contract_mgr_v2_content 
        SET process_step = 'pending_filter' 
        WHERE ocr_text IS NOT NULL AND filtered_text IS NULL
      `);
      
      console.log('  ✓ Added process_step and related columns to app_contract_mgr_v2_content');
    }
  },

  // 移除 content 表的外键约束，允许独立存在
  {
    name: 'app_contract_mgr_v2_content drop foreign key',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'app_contract_mgr_v2_content'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
      `);
      return rows.length === 0;
    },
    migrate: async (conn) => {
      await dropForeignKeyIfExists(conn, 'app_contract_mgr_v2_content', 'fk_app_contract_mgr_v2_content_row_id');
      console.log('  ✓ Removed foreign key from app_contract_mgr_v2_content');
    }
  },

  // 扩展 ocr_task_id 字段长度（适配长 task_id）
  {
    name: 'app_contract_mgr_v2_content extend ocr_task_id',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_v2_content')) return true;
      const [rows] = await conn.execute(`
        SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'app_contract_mgr_v2_content'
        AND COLUMN_NAME = 'ocr_task_id'
      `);
      return rows.length > 0 && rows[0].CHARACTER_MAXIMUM_LENGTH >= 128;
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_contract_mgr_v2_content
        MODIFY COLUMN ocr_task_id VARCHAR(255) NULL COMMENT 'OCR任务ID'
      `);
      console.log('  ✓ Extended ocr_task_id to VARCHAR(255)');
    }
  },

  // 补录 contract-mgr-v2 的 component 字段（安装时未写入）
  {
    name: 'mini_apps contract-mgr-v2 set component',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT component FROM mini_apps WHERE id = 'contract-mgr-v2'
      `);
      return rows.length > 0 && rows[0].component === 'ContractV2View';
    },
    migrate: async (conn) => {
      await conn.execute(`
        UPDATE mini_apps SET component = 'ContractV2View' WHERE id = 'contract-mgr-v2'
      `);
      console.log('  ✓ Set contract-mgr-v2 component to ContractV2View');
    }
  },

  // 补录 ocr-tool 的 component 字段（安装时未写入）
  {
    name: 'mini_apps ocr-tool set component',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT component FROM mini_apps WHERE id = 'ocr-tool'
      `);
      return rows.length > 0 && rows[0].component === 'OcrToolView';
    },
    migrate: async (conn) => {
      await conn.execute(`
        UPDATE mini_apps SET component = 'OcrToolView' WHERE id = 'ocr-tool'
      `);
      console.log('  ✓ Set ocr-tool component to OcrToolView');
    }
  },

  // ==================== 文档平台辅助表（基于 document_*） ====================

  // 1. doc_tags - 标签主表
  {
    name: 'doc_tags table create',
    check: async (conn) => await hasTable(conn, 'doc_tags'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE doc_tags (
          id VARCHAR(32) NOT NULL COMMENT '标签ID',
          org_id VARCHAR(32) NOT NULL COMMENT '组织ID',
          name VARCHAR(100) NOT NULL COMMENT '标签名称',
          description TEXT NULL COMMENT '标签描述',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE INDEX idx_org_name (org_id, name),
          INDEX idx_org (org_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标签主表'
      `);
      console.log('  ✓ Created doc_tags table');
    }
  },

  // 2. doc_document_tags - 文档标签关联表
  {
    name: 'doc_document_tags table create',
    check: async (conn) => await hasTable(conn, 'doc_document_tags'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE doc_document_tags (
          id VARCHAR(32) NOT NULL COMMENT '关联ID',
          document_id VARCHAR(32) NOT NULL COMMENT '文档ID',
          tag_id VARCHAR(32) NOT NULL COMMENT '标签ID',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE INDEX idx_doc_tag (document_id, tag_id),
          INDEX idx_doc_document (document_id),
          INDEX idx_doc_tag_id (tag_id),
          CONSTRAINT fk_doctag_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          CONSTRAINT fk_doctag_tag FOREIGN KEY (tag_id) REFERENCES doc_tags(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档标签关联表'
      `);
      console.log('  ✓ Created doc_document_tags table');
    }
  },

  // 3. doc_compare_runs - 比对任务表
  {
    name: 'doc_compare_runs table create',
    check: async (conn) => await hasTable(conn, 'doc_compare_runs'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE doc_compare_runs (
          id VARCHAR(32) NOT NULL COMMENT '比对任务ID',
          document_id VARCHAR(32) NOT NULL COMMENT '文档ID',
          base_version_id VARCHAR(32) NOT NULL COMMENT '基准版本ID',
          target_version_id VARCHAR(32) NOT NULL COMMENT '目标版本ID',
          status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending' COMMENT '任务状态',
          summary_json JSON NULL COMMENT '比对摘要',
          model_info JSON NULL COMMENT '使用的模型信息',
          duration_ms INT NULL COMMENT '执行时长(ms)',
          created_by VARCHAR(32) NOT NULL COMMENT '创建者ID',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_doc_status (document_id, status),
          INDEX idx_versions (base_version_id, target_version_id),
          CONSTRAINT fk_comp_runs_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          CONSTRAINT fk_comp_runs_base_rev FOREIGN KEY (base_version_id) REFERENCES document_revisions(id) ON DELETE CASCADE,
          CONSTRAINT fk_comp_runs_target_rev FOREIGN KEY (target_version_id) REFERENCES document_revisions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='比对任务表'
      `);
      console.log('  ✓ Created doc_compare_runs table');
    }
  },

  // 4. doc_compare_items - 比对结果明细表
  {
    name: 'doc_compare_items table create',
    check: async (conn) => await hasTable(conn, 'doc_compare_items'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE doc_compare_items (
          id VARCHAR(32) NOT NULL COMMENT '比对明细ID',
          run_id VARCHAR(32) NOT NULL COMMENT '比对任务ID',
          base_unit_id VARCHAR(32) NULL COMMENT '基准内容单元ID',
          target_unit_id VARCHAR(32) NULL COMMENT '目标内容单元ID',
          change_type ENUM('identical', 'modified', 'semantic_change', 'added', 'removed') NOT NULL COMMENT '变更类型',
          summary TEXT NULL COMMENT '变更摘要',
          risk_level ENUM('none', 'low', 'medium', 'high') NULL COMMENT '风险等级',
          key_changes_json JSON NULL COMMENT '关键变更',
          evidence_unit_ids_json JSON NULL COMMENT '依据内容单元IDs',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_run (run_id),
          INDEX idx_change_type (run_id, change_type),
          INDEX idx_base_unit (base_unit_id),
          INDEX idx_target_unit (target_unit_id),
          CONSTRAINT fk_comp_items_run FOREIGN KEY (run_id) REFERENCES doc_compare_runs(id) ON DELETE CASCADE,
          CONSTRAINT fk_comp_items_base_chunk FOREIGN KEY (base_unit_id) REFERENCES document_chunks(id) ON DELETE SET NULL,
          CONSTRAINT fk_comp_items_target_chunk FOREIGN KEY (target_unit_id) REFERENCES document_chunks(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='比对结果明细表'
      `);
      console.log('  ✓ Created doc_compare_items table');
    }
  },
  // 5. topics 新增 start_time / end_time（Phase 2 WP-1）
  {
    name: 'topics add start_time and end_time',
    check: async (conn) => {
      if (!await hasTable(conn, 'topics')) return true;
      return await hasColumn(conn, 'topics', 'end_time');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE topics ADD COLUMN start_time DATETIME NULL COMMENT '话题起始时间' AFTER message_count`);
      await safeExecute(conn, `ALTER TABLE topics ADD COLUMN end_time DATETIME NULL COMMENT '话题结束时间（归档时写入）' AFTER start_time`);
      console.log('  ✓ Added start_time, end_time to topics');
    }
  },

  // ==================== 文档平台重构 V1: document_* 新表 ====================
  // Task: task-20260605-document-platform-refactor - 统一文档平台

  // 27. document_collections - 文档集合主表
  {
    name: 'document_collections table create',
    check: async (conn) => await hasTable(conn, 'document_collections'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE document_collections (
          id VARCHAR(32) NOT NULL COMMENT '集合ID',
          name VARCHAR(100) NOT NULL COMMENT '集合名称',
          description TEXT NULL COMMENT '集合描述',
          owner_id VARCHAR(32) NOT NULL COMMENT '所有者ID',
          created_by VARCHAR(32) NOT NULL COMMENT '创建者ID',
          department_id VARCHAR(20) NOT NULL COMMENT '所属部门ID',
          visibility ENUM('private','department','public') NOT NULL DEFAULT 'private' COMMENT '可见范围',
          department_scope ENUM('self','self_and_descendants') NULL DEFAULT 'self' COMMENT '部门范围',
          embedding_model_id VARCHAR(32) NOT NULL COMMENT '默认向量模型ID',
          metadata JSON NULL COMMENT '扩展字段',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_coll_owner (owner_id),
          INDEX idx_coll_dept_vis (department_id, visibility),
          INDEX idx_coll_created_by (created_by),
          INDEX idx_coll_emb_model (embedding_model_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档集合'
      `);
      console.log('  ✓ Created document_collections table');
    }
  },

  // 28. documents - 文档主表 (承载 processing_status)
  {
    name: 'documents table create',
    check: async (conn) => await hasTable(conn, 'documents'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE documents (
          id VARCHAR(32) NOT NULL COMMENT '文档ID',
          collection_id VARCHAR(32) NOT NULL COMMENT '所属文档集合ID',
          current_revision_id VARCHAR(32) NULL COMMENT '当前版本ID',
          doc_type ENUM('knowledge','contract','department_doc','standard') NOT NULL COMMENT '文档类型',
          source_system VARCHAR(50) NOT NULL COMMENT '来源系统',
          source_ref_id VARCHAR(32) NOT NULL COMMENT '来源主键',
          title VARCHAR(500) NOT NULL COMMENT '文档标题',
          processing_status ENUM('pending_ocr','ocr_processing','pending_clean','pending_outline','pending_chunk','pending_embedding','ready','error') NOT NULL DEFAULT 'pending_ocr' COMMENT '处理状态',
          processing_error_code VARCHAR(64) NULL COMMENT '错误码',
          processing_error_message TEXT NULL COMMENT '错误信息',
          processing_retry_count INT NOT NULL DEFAULT 0 COMMENT '重试次数',
          processing_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '处理状态更新时间',
          metadata JSON NULL COMMENT '扩展字段',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_document_source (source_system, source_ref_id),
          INDEX idx_document_collection (collection_id),
          INDEX idx_document_current_revision (current_revision_id),
          INDEX idx_document_processing (processing_status, processing_updated_at),
          INDEX idx_document_type_status (doc_type, processing_status),
          CONSTRAINT fk_document_collection FOREIGN KEY (collection_id) REFERENCES document_collections(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档主表'
      `);
      console.log('  ✓ Created documents table');
    }
  },

  // 29. document_revisions - 文档历史版本表
  {
    name: 'document_revisions table create',
    check: async (conn) => await hasTable(conn, 'document_revisions'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE document_revisions (
          id VARCHAR(32) NOT NULL COMMENT '版本ID',
          document_id VARCHAR(32) NOT NULL COMMENT '所属文档ID',
          revision_no INT NOT NULL COMMENT '机器版号',
          revision_label VARCHAR(20) NULL COMMENT '展示版号(v1.0)',
          revision_status ENUM('draft','review','approved','effective','expired','archived') NOT NULL DEFAULT 'draft' COMMENT '版本状态',
          is_current TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否当前版本',
          effective_from DATE NULL COMMENT '生效日期',
          effective_to DATE NULL COMMENT '废止日期(NULL=长期有效)',
          change_summary TEXT NULL COMMENT '变更摘要',
          created_by VARCHAR(32) NOT NULL COMMENT '创建者ID',
          approved_by VARCHAR(32) NULL COMMENT '审批者ID',
          approved_at DATETIME NULL COMMENT '审批时间',
          diff_status ENUM('pending','processing','ready','error') NOT NULL DEFAULT 'pending' COMMENT '版本差异状态(旁路)',
          metadata JSON NULL COMMENT '扩展字段',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_revision_document_id (document_id, id),
          UNIQUE KEY uk_document_revision_no (document_id, revision_no),
          INDEX idx_revision_document_current (document_id, is_current),
          INDEX idx_revision_status (revision_status),
          INDEX idx_revision_diff_status (diff_status),
          CONSTRAINT fk_revision_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          CONSTRAINT ck_revision_effective_date CHECK (effective_to IS NULL OR effective_to >= effective_from)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档历史版本'
      `);
      console.log('  ✓ Created document_revisions table');
    }
  },

  // 31. doc_ocr_results - OCR阶段结果表
  {
    name: 'doc_ocr_results table create',
    check: async (conn) => await hasTable(conn, 'doc_ocr_results'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE doc_ocr_results (
          id VARCHAR(32) NOT NULL COMMENT 'OCR结果ID',
          document_id VARCHAR(32) NOT NULL COMMENT '文档ID',
          revision_id VARCHAR(32) NOT NULL COMMENT '文档版本ID',
          provider VARCHAR(64) NOT NULL DEFAULT 'mineru' COMMENT 'OCR供应方标识',
          task_id VARCHAR(128) NULL COMMENT '上游任务ID',
          status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending' COMMENT 'OCR阶段归一化状态',
          progress INT NOT NULL DEFAULT 0 COMMENT 'OCR进度百分比',
          main_markdown_attachment_id VARCHAR(20) NULL COMMENT '平台主markdown附件ID',
          raw_result_attachment_id VARCHAR(20) NULL COMMENT 'OCR原始结果附件ID',
          deliverables_manifest_attachment_id VARCHAR(20) NULL COMMENT '交付物清单附件ID',
          middle_json_attachment_id VARCHAR(20) NULL COMMENT 'middle_json附件ID',
          content_list_attachment_id VARCHAR(20) NULL COMMENT 'content_list附件ID',
          content_list_v2_attachment_id VARCHAR(20) NULL COMMENT 'content_list_v2附件ID',
          model_json_attachment_id VARCHAR(20) NULL COMMENT 'model_json附件ID',
          image_manifest_attachment_id VARCHAR(20) NULL COMMENT '图片清单附件ID',
          image_count INT NOT NULL DEFAULT 0 COMMENT '图片数量',
          line_count INT NOT NULL DEFAULT 0 COMMENT '主markdown行数',
          error_code VARCHAR(64) NULL COMMENT '错误码',
          error_message TEXT NULL COMMENT '错误信息',
          started_at DATETIME NULL COMMENT '开始时间',
          completed_at DATETIME NULL COMMENT '完成时间',
          metadata JSON NULL COMMENT '轻量追溯信息',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_doc_ocr_result_document (document_id, revision_id),
          INDEX idx_doc_ocr_result_status (status, updated_at),
          INDEX idx_doc_ocr_result_task (provider, task_id),
          CONSTRAINT fk_doc_ocr_result_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          CONSTRAINT fk_doc_ocr_result_revision FOREIGN KEY (revision_id) REFERENCES document_revisions(id) ON DELETE CASCADE,
          CONSTRAINT fk_doc_ocr_result_main_markdown_attachment FOREIGN KEY (main_markdown_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
          CONSTRAINT fk_doc_ocr_result_raw_result_attachment FOREIGN KEY (raw_result_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
          CONSTRAINT fk_doc_ocr_result_deliverables_manifest_attachment FOREIGN KEY (deliverables_manifest_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
          CONSTRAINT fk_doc_ocr_result_middle_json_attachment FOREIGN KEY (middle_json_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
          CONSTRAINT fk_doc_ocr_result_content_list_attachment FOREIGN KEY (content_list_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
          CONSTRAINT fk_doc_ocr_result_content_list_v2_attachment FOREIGN KEY (content_list_v2_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
          CONSTRAINT fk_doc_ocr_result_model_json_attachment FOREIGN KEY (model_json_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
          CONSTRAINT fk_doc_ocr_result_image_manifest_attachment FOREIGN KEY (image_manifest_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OCR阶段结果表'
      `);
      console.log('  ✓ Created doc_ocr_results table');
    }
  },

  // 32. doc_ocr_images - OCR图片关系表
  {
    name: 'doc_ocr_images table create',
    check: async (conn) => await hasTable(conn, 'doc_ocr_images'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE doc_ocr_images (
          id VARCHAR(32) NOT NULL COMMENT 'OCR图片关系ID',
          ocr_result_id VARCHAR(32) NOT NULL COMMENT 'OCR结果ID',
          attachment_id VARCHAR(20) NOT NULL COMMENT '图片附件ID',
          filename VARCHAR(255) NULL COMMENT '原始文件名',
          media_type VARCHAR(100) NOT NULL COMMENT 'MIME类型',
          sort_order INT NOT NULL DEFAULT 0 COMMENT '排序',
          referenced_in_markdown TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否在markdown中被引用',
          markdown_path VARCHAR(500) NULL COMMENT 'markdown中的原始引用路径',
          line_number INT NULL COMMENT '引用所在行号',
          start_offset INT NULL COMMENT '起始偏移',
          end_offset INT NULL COMMENT '结束偏移',
          alt_text VARCHAR(500) NULL COMMENT 'alt文本',
          description TEXT NULL COMMENT '图片描述',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_doc_ocr_image_result (ocr_result_id, sort_order),
          INDEX idx_doc_ocr_image_attachment (attachment_id),
          CONSTRAINT fk_doc_ocr_image_result FOREIGN KEY (ocr_result_id) REFERENCES doc_ocr_results(id) ON DELETE CASCADE,
          CONSTRAINT fk_doc_ocr_image_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OCR图片关系表'
      `);
      console.log('  ✓ Created doc_ocr_images table');
    }
  },

  // 30. document_revisions 复合外键 → documents.current_revision_id
  {
    name: 'documents current_revision_id fk to document_revisions',
    check: async (conn) => {
      if (!await hasTable(conn, 'documents')) return true;
      return await hasForeignKey(conn, 'documents', 'fk_document_current_revision');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE documents ADD CONSTRAINT fk_document_current_revision FOREIGN KEY (id, current_revision_id) REFERENCES document_revisions(document_id, id) ON DELETE RESTRICT`);
      console.log('  ✓ Added FK documents.(id, current_revision_id) → document_revisions(document_id, id)');
    }
  },

  // 31. document_chunks - 文档分段表 (两层: paragraph / chunk)
  {
    name: 'document_chunks table create',
    check: async (conn) => await hasTable(conn, 'document_chunks'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE document_chunks (
          id VARCHAR(32) NOT NULL COMMENT '分段ID',
          revision_id VARCHAR(32) NOT NULL COMMENT '所属版本ID',
          chunk_type ENUM('paragraph','chunk') NOT NULL COMMENT '分段类型(两层结构)',
          title VARCHAR(500) NULL COMMENT '标题',
          content TEXT NULL COMMENT '内容',
          seq INT NOT NULL DEFAULT 0 COMMENT '顺序号',
          embedding_vector VECTOR(1536) NULL COMMENT '向量数据',
          embedding_status ENUM('pending','processing','ready','error') NOT NULL DEFAULT 'pending' COMMENT '向量状态',
          embedding_model_id VARCHAR(32) NULL COMMENT '向量模型ID',
          embedded_at DATETIME NULL COMMENT '向量生成时间',
          token_count INT NULL COMMENT 'Token数',
          metadata JSON NULL COMMENT '扩展字段',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_revision_seq (revision_id, seq),
          INDEX idx_chunk_revision (revision_id),
          INDEX idx_chunk_emb_status (embedding_status),
          CONSTRAINT fk_chunk_revision FOREIGN KEY (revision_id) REFERENCES document_revisions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档分段'
      `);
      console.log('  ✓ Created document_chunks table');
    }
  },

  // 31. app_doc_bindings - App 到 Doc 平台映射表
  {
    name: 'app_doc_bindings table create',
    check: async (conn) => await hasTable(conn, 'app_doc_bindings'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_doc_bindings (
          id VARCHAR(32) NOT NULL COMMENT '绑定ID',
          app_id VARCHAR(32) NOT NULL COMMENT 'App ID',
          row_id VARCHAR(32) NOT NULL COMMENT 'App行ID',
          document_id VARCHAR(32) NOT NULL COMMENT '文档ID',
          current_revision_id VARCHAR(32) NULL COMMENT '当前版本ID',
          binding_status ENUM('active','archived') NOT NULL DEFAULT 'active' COMMENT '绑定状态',
          metadata JSON NULL COMMENT '扩展字段',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_app_row (app_id, row_id),
          INDEX idx_document (document_id),
          INDEX idx_revision (current_revision_id),
          INDEX idx_status (binding_status),
          CONSTRAINT fk_binding_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='App文档绑定表'
      `);
      console.log('  ✓ Created app_doc_bindings table');
    }
  },

  // 32. app_contract_mgr_v2_content 添加 document_id 列
  {
    name: 'app_contract_mgr_v2_content add document_id',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_v2_content')) return true;
      return await hasColumn(conn, 'app_contract_mgr_v2_content', 'document_id');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE app_contract_mgr_v2_content ADD COLUMN document_id VARCHAR(32) NULL COMMENT 'Doc平台文档ID' AFTER process_step`);
      await safeExecute(conn, `ALTER TABLE app_contract_mgr_v2_content ADD INDEX idx_document_id (document_id)`);
      console.log('  ✓ Added document_id column to app_contract_mgr_v2_content');
    }
  },

  // 33. app_contract_mgr_v2_content 添加 classification_json 列
  {
    name: 'app_contract_mgr_v2_content add classification_json',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_v2_content')) return true;
      return await hasColumn(conn, 'app_contract_mgr_v2_content', 'classification_json');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE app_contract_mgr_v2_content ADD COLUMN classification_json JSON NULL COMMENT '版本识别建议' AFTER sections`);
      console.log('  ✓ Added classification_json column to app_contract_mgr_v2_content');
    }
  },

  // 33.05 app_contract_mgr_v2_content 补齐 filter 中间态列（修复旧半安装/早期升级只补 process_step 的情况）
  {
    name: 'app_contract_mgr_v2_content ensure filter state columns',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_v2_content')) return true;
      const hasCarry = await hasColumn(conn, 'app_contract_mgr_v2_content', 'filter_carried_over');
      const hasChunkIndex = await hasColumn(conn, 'app_contract_mgr_v2_content', 'filter_chunk_index');
      return hasCarry && hasChunkIndex;
    },
    migrate: async (conn) => {
      if (!await hasColumn(conn, 'app_contract_mgr_v2_content', 'filter_carried_over')) {
        await safeExecute(conn, `ALTER TABLE app_contract_mgr_v2_content ADD COLUMN filter_carried_over LONGTEXT NULL COMMENT '滑动窗口中间状态' AFTER filter_at`);
      }
      if (!await hasColumn(conn, 'app_contract_mgr_v2_content', 'filter_chunk_index')) {
        await safeExecute(conn, `ALTER TABLE app_contract_mgr_v2_content ADD COLUMN filter_chunk_index INT DEFAULT 0 COMMENT '当前处理chunk索引' AFTER filter_carried_over`);
      }
      console.log('  ✓ Ensured filter_carried_over/filter_chunk_index on app_contract_mgr_v2_content');
    }
  },

  // 33.1 contract-mgr-v2 补齐 app_contract_mgr_v2_rows 表（处理历史半安装状态）
  {
    name: 'contract-mgr-v2 ensure rows table',
    check: async (conn) => {
      const hasContent = await hasTable(conn, 'app_contract_mgr_v2_content');
      if (!hasContent) return true;
      return await hasTable(conn, 'app_contract_mgr_v2_rows');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `
        CREATE TABLE IF NOT EXISTS app_contract_mgr_v2_rows (
          row_id VARCHAR(32) PRIMARY KEY COMMENT '业务内容表主键（独立生成）',
          contract_number VARCHAR(64) NULL COMMENT '合同编号',
          party_a VARCHAR(128) NULL COMMENT '甲方',
          parent_company VARCHAR(128) NULL COMMENT '上级公司',
          contract_amount DECIMAL(15,2) NULL COMMENT '合同金额',
          contract_date DATE NULL COMMENT '签订日期',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_contract_number (contract_number),
          INDEX idx_party_a (party_a),
          INDEX idx_contract_amount (contract_amount),
          INDEX idx_contract_date (contract_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同元数据扩展表'
      `);
      console.log('  ✓ Ensured app_contract_mgr_v2_rows table');
    }
  },

  {
    name: 'contract-mgr-v2 remove mini_app_rows foreign keys',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT TABLE_NAME, CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('contract_v2_versions', 'app_contract_mgr_v2_rows')
          AND COLUMN_NAME = 'row_id'
          AND REFERENCED_TABLE_NAME = 'mini_app_rows'
      `);
      return rows.length === 0;
    },
    migrate: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT TABLE_NAME, CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('contract_v2_versions', 'app_contract_mgr_v2_rows')
          AND COLUMN_NAME = 'row_id'
          AND REFERENCED_TABLE_NAME = 'mini_app_rows'
      `);
      for (const row of rows) {
        await conn.execute(
          `ALTER TABLE ${quoteIdentifier(row.TABLE_NAME)} DROP FOREIGN KEY ${quoteIdentifier(row.CONSTRAINT_NAME)}`
        );
      }
      console.log('  ✓ Removed contract-mgr-v2 row_id foreign keys to mini_app_rows');
    }
  },

  {
    name: 'contract-mgr-v2 versions add document_id',
    check: async (conn) => {
      if (!await hasTable(conn, 'contract_v2_versions')) return true;
      return await hasColumn(conn, 'contract_v2_versions', 'document_id');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE contract_v2_versions ADD COLUMN document_id VARCHAR(32) NULL COMMENT '文档平台 document_id' AFTER file_id`);
      console.log('  ✓ Added document_id to contract_v2_versions');
    }
  },

  {
    name: 'contract-mgr-v2 versions add revision_id',
    check: async (conn) => {
      if (!await hasTable(conn, 'contract_v2_versions')) return true;
      return await hasColumn(conn, 'contract_v2_versions', 'revision_id');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE contract_v2_versions ADD COLUMN revision_id VARCHAR(32) NULL COMMENT '文档平台当前 revision_id' AFTER document_id`);
      console.log('  ✓ Added revision_id to contract_v2_versions');
    }
  },

  {
    name: 'contract-mgr-v2 main_records contract_type add sales',
    check: async (conn) => {
      if (!await hasTable(conn, 'contract_v2_main_records')) return true;
      const columnType = await getColumnType(conn, 'contract_v2_main_records', 'contract_type');
      return !!columnType && columnType.includes('sales');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE contract_v2_main_records
        MODIFY COLUMN contract_type ENUM('strategy','framework','development','sales','supply','purchase','quality','nda','technical','other') COMMENT '合同类型'
      `);
      console.log('  ✓ Added sales to contract_v2_main_records.contract_type');
    }
  },

  // 33.15 contract-mgr-v2 rows 表补齐 party_b 字段（提取流程会写入乙方）
  {
    name: 'app_contract_mgr_v2_rows add party_b column',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_v2_rows')) return true;
      return await hasColumn(conn, 'app_contract_mgr_v2_rows', 'party_b');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE app_contract_mgr_v2_rows ADD COLUMN party_b VARCHAR(128) NULL COMMENT '乙方' AFTER party_a`);
      await safeExecute(conn, `ALTER TABLE app_contract_mgr_v2_rows ADD INDEX idx_party_b (party_b)`);
      console.log('  ✓ Added party_b column to app_contract_mgr_v2_rows');
    }
  },

  // 33.2 contract-mgr-v2 content 模型缺口：extract_prompt
  {
    name: 'app_contract_mgr_v2_content add extract_prompt',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_v2_content')) return true;
      return await hasColumn(conn, 'app_contract_mgr_v2_content', 'extract_prompt');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE app_contract_mgr_v2_content ADD COLUMN extract_prompt TEXT NULL COMMENT '提取提示词' AFTER sections`);
      console.log('  ✓ Added extract_prompt column to app_contract_mgr_v2_content');
    }
  },

  // 33.3 contract-mgr-v2 半安装兜底：补 mini_apps/config 与状态注册
  {
    name: 'contract-mgr-v2 ensure installation metadata',
    check: async (conn) => {
      const [miniApps] = await conn.execute(`SELECT id, config FROM mini_apps WHERE id = 'contract-mgr-v2' LIMIT 1`);
      if (!miniApps.length) return true;
      const [clockRows] = await conn.execute(`SELECT id FROM app_clock_registry WHERE app_id = 'contract-mgr-v2' LIMIT 1`);
      return clockRows.length > 0 && !!miniApps[0].config;
    },
    migrate: async (conn) => {
      const [miniApps] = await conn.execute(`SELECT id, owner_id, creator_id FROM mini_apps WHERE id = 'contract-mgr-v2' LIMIT 1`);
      if (!miniApps.length) return;

      const configJson = JSON.stringify({
        features: ['upload', 'list', 'detail', 'org_tree', 'versions', 'dashboard'],
        supported_formats: ['.pdf', '.docx', '.doc', '.jpg', '.png'],
        max_file_size: 52428800,
        batch_enabled: true,
        batch_limit: 50,
        extension_tables: [
          {
            name: 'app_contract_mgr_v2_rows',
            type: 'primary',
            fields: [
              { name: 'contract_number', type: 'VARCHAR(64)', label: '合同编号', source: 'contract_number' },
              { name: 'party_a', type: 'VARCHAR(128)', label: '甲方', source: 'party_a' },
              { name: 'parent_company', type: 'VARCHAR(128)', label: '上级公司', source: 'parent_company' },
              { name: 'contract_amount', type: 'DECIMAL(15,2)', label: '合同金额', source: 'contract_amount' },
              { name: 'contract_date', type: 'DATE', label: '签订日期', source: 'contract_date' }
            ]
          },
          {
            name: 'app_contract_mgr_v2_content',
            type: 'content',
            fields: [
              { name: 'process_step', type: 'VARCHAR(32)' },
              { name: 'document_id', type: 'VARCHAR(32)' },
              { name: 'file_id', type: 'VARCHAR(32)' },
              { name: 'ocr_task_id', type: 'VARCHAR(255)' },
              { name: 'ocr_text', type: 'LONGTEXT' },
              { name: 'ocr_service', type: 'VARCHAR(64)' },
              { name: 'ocr_at', type: 'DATETIME' },
              { name: 'filtered_text', type: 'LONGTEXT' },
              { name: 'filter_at', type: 'DATETIME' },
              { name: 'filter_carried_over', type: 'LONGTEXT' },
              { name: 'filter_chunk_index', type: 'INT' },
              { name: 'sections', type: 'JSON' },
              { name: 'extract_prompt', type: 'TEXT' },
              { name: 'extract_json', type: 'LONGTEXT' },
              { name: 'extract_model', type: 'VARCHAR(64)' },
              { name: 'extract_temperature', type: 'DECIMAL(3,2)' },
              { name: 'extract_at', type: 'DATETIME' },
              { name: 'classification_json', type: 'JSON' }
            ]
          }
        ],
        step_resources: {
          pending_ocr: { type: 'mcp', mcp: { server: 'markitdown', tool: 'submit_conversion_task', params_mapping: { content: 'file.base64', filename: 'file.name' } } },
          ocr_submitted: { type: 'mcp', mcp: { server: 'markitdown', tool: 'get_task', hide_params_mapping: true }, judge_model_id: null, judge_temperature: 0.1 },
          pending_filter: { type: 'internal_llm', model_id: null, temperature: 0.3 },
          pending_extract: { type: 'internal_llm', model_id: null, temperature: 0.3 },
          pending_section: { type: 'internal_llm', model_id: null, temperature: 0.3 }
        }
      });

      await conn.execute(
        `UPDATE mini_apps
         SET name = '销售合同管理 v2',
             description = '支持组织层级、多版本管理、AI问答的销售合同管理系统',
             icon = '📋',
             type = 'document',
             component = 'ContractV2View',
             config = ?,
             updated_at = NOW()
         WHERE id = 'contract-mgr-v2'`,
        [configJson]
      );

      const [clockRows] = await conn.execute(`SELECT id FROM app_clock_registry WHERE app_id = 'contract-mgr-v2' LIMIT 1`);
      if (!clockRows.length) {
        const clockId = crypto.randomBytes(10).toString('hex').slice(0, 20);
        await conn.execute(`INSERT INTO app_clock_registry (id, app_id, tick_script, is_active) VALUES (?, 'contract-mgr-v2', NULL, 1)`, [clockId]);
      }

      console.log('  ✓ Ensured contract-mgr-v2 installation metadata/clock registry');
    }
  },

  // 41. contract-mgr-v2 content_id 迁移铺路
  {
    name: 'app_contract_mgr_v2_content add content_id',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_v2_content')) return true;
      const hasCol = await hasColumn(conn, 'app_contract_mgr_v2_content', 'content_id');
      if (!hasCol) return false;
      const [rows] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM app_contract_mgr_v2_content WHERE content_id = ''`
      );
      if (rows[0].cnt > 0) return false;
      return await hasIndex(conn, 'app_contract_mgr_v2_content', 'uk_content_id');
    },
    migrate: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_v2_content')) return;
      const hasCol = await hasColumn(conn, 'app_contract_mgr_v2_content', 'content_id');
      if (!hasCol) {
        await conn.execute(
          `ALTER TABLE app_contract_mgr_v2_content
           ADD COLUMN content_id VARCHAR(32) NOT NULL DEFAULT '' AFTER row_id`
        );
      }
      const [emptyRows] = await conn.execute(
        `SELECT row_id FROM app_contract_mgr_v2_content WHERE content_id = ''`
      );
      for (const row of emptyRows) {
        const newId = crypto.randomUUID().replace(/-/g, '').substring(0, 32);
        await conn.execute(
          `UPDATE app_contract_mgr_v2_content SET content_id = ? WHERE row_id = ?`,
          [newId, row.row_id]
        );
      }
      if (!(await hasIndex(conn, 'app_contract_mgr_v2_content', 'uk_content_id'))) {
        await conn.execute(
          `ALTER TABLE app_contract_mgr_v2_content
           ADD UNIQUE KEY uk_content_id (content_id)`
        );
      }
      console.log('  ✓ Added content_id to app_contract_mgr_v2_content and populated existing rows');
    },
  },

  // 42. invoice-mgr 自治主表
  {
    name: 'app_invoice_mgr_records table',
    check: async (conn) => await hasTable(conn, 'app_invoice_mgr_records'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS app_invoice_mgr_records (
          id VARCHAR(32) NOT NULL,
          user_id VARCHAR(32) NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'pending_process',
          data LONGTEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_status (status),
          KEY idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        INSERT IGNORE INTO app_invoice_mgr_records (id, user_id, status, data, created_at, updated_at)
        SELECT id, user_id, status, data, created_at, updated_at
        FROM mini_app_rows
        WHERE app_id = 'invoice-mgr'
      `);
      console.log('  ✓ Created app_invoice_mgr_records and seeded from mini_app_rows');
    },
  },

  {
    name: 'app_invoice_mgr_records add user_id',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_invoice_mgr_records')) return true;
      return await hasColumn(conn, 'app_invoice_mgr_records', 'user_id');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_invoice_mgr_records
        ADD COLUMN user_id VARCHAR(32) NULL AFTER id
      `);
      try {
        await conn.execute(`ALTER TABLE app_invoice_mgr_records ADD INDEX idx_user_id (user_id)`);
      } catch {}
      await conn.execute(`
        UPDATE app_invoice_mgr_records r
        JOIN mini_app_rows m ON m.id = r.id
        SET r.user_id = m.user_id
        WHERE r.user_id IS NULL
      `);
      console.log('  ✓ Added user_id to app_invoice_mgr_records and backfilled from mini_app_rows');
    },
  },

  // 42b. invoice-mgr 自治表添加 attachment_id（Phase 6 R10 去 mini_app_file 依赖）
  {
    name: 'app_invoice_mgr_records add attachment_id',
    check: async (conn) => await hasColumn(conn, 'app_invoice_mgr_records', 'attachment_id'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_invoice_mgr_records
        ADD COLUMN attachment_id VARCHAR(20) NULL COMMENT '附件ID' AFTER data,
        ADD INDEX idx_attachment_id (attachment_id)
      `);
      console.log('  ✓ Added attachment_id to app_invoice_mgr_records');
    },
  },

  // 42c. invoice-mgr 扩展表 rows（增量升级：新建 + 逐列补齐 + 补索引 + 补 FK）
  {
    name: 'app_invoice_mgr_rows table (incremental)',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_invoice_mgr_rows')) return false;
      // 哨兵：同时验证 user_id 列和 uk_user_invoice_number 索引
      // 避免"列已补但旧 uk_invoice_number 索引未被替换"时迁移整体被跳过
      const hasUserCol = await hasColumn(conn, 'app_invoice_mgr_rows', 'user_id');
      const hasNewIndex = await hasIndex(conn, 'app_invoice_mgr_rows', 'uk_user_invoice_number');
      return hasUserCol && hasNewIndex;
    },
    migrate: async (conn) => {
      if (!await hasTable(conn, 'app_invoice_mgr_rows')) {
        await conn.execute(`
          CREATE TABLE app_invoice_mgr_rows (
            row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 app_invoice_mgr_records.id',
            user_id VARCHAR(32) COMMENT '用户ID，关联 app_invoice_mgr_records.user_id',
            invoice_number VARCHAR(20) COMMENT '发票号码（20位），用于去重',
            invoice_date DATE COMMENT '开票日期',
            invoice_type VARCHAR(64) COMMENT '发票类型',
            seller_name VARCHAR(128) COMMENT '销售方名称',
            seller_tax_id VARCHAR(20) COMMENT '销售方税号',
            buyer_name VARCHAR(128) COMMENT '购买方名称',
            buyer_tax_id VARCHAR(20) COMMENT '购买方税号',
            total_amount DECIMAL(12,2) DEFAULT 0 COMMENT '合计金额',
            total_tax DECIMAL(12,2) DEFAULT 0 COMMENT '税额',
            total_with_tax DECIMAL(12,2) DEFAULT 0 COMMENT '价税合计',
            item_count INT DEFAULT 0 COMMENT '商品明细总数',
            page_count INT DEFAULT 0 COMMENT 'PDF页数',
            remarks TEXT COMMENT '备注',
            issuer VARCHAR(32) COMMENT '开票人',
            ocr_method VARCHAR(32) COMMENT '识别方法：fapiao/markitdown',
            ocr_raw LONGTEXT COMMENT 'OCR原始输出JSON',
            extraction_status VARCHAR(16) DEFAULT 'success' COMMENT '提取状态',
            text_items_count INT DEFAULT 0 COMMENT 'PDF文本项总数',
            keyword_count INT DEFAULT 0 COMMENT '发票关键词匹配数',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_user_invoice_number (user_id, invoice_number),
            INDEX idx_user_id (user_id),
            INDEX idx_seller (seller_name),
            INDEX idx_buyer (buyer_name),
            INDEX idx_date (invoice_date),
            INDEX idx_amount (total_with_tax)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='发票元数据扩展表'
        `);
        if (!await hasForeignKey(conn, 'app_invoice_mgr_rows', 'fk_app_invoice_mgr_rows_row_id')) {
          await conn.execute(`
            ALTER TABLE app_invoice_mgr_rows
            ADD CONSTRAINT fk_app_invoice_mgr_rows_row_id
            FOREIGN KEY (row_id) REFERENCES app_invoice_mgr_records(id) ON DELETE CASCADE
          `);
        }
        console.log('  ✓ Created app_invoice_mgr_rows table with full schema');
        return;
      }

      const missingCols = [
        { col: 'issuer', def: "VARCHAR(32) COMMENT '开票人'", after: 'remarks' },
        { col: 'ocr_method', def: "VARCHAR(32) COMMENT '识别方法：fapiao/markitdown'", after: 'issuer' },
        { col: 'ocr_raw', def: "LONGTEXT COMMENT 'OCR原始输出JSON'", after: 'ocr_method' },
        { col: 'extraction_status', def: "VARCHAR(16) DEFAULT 'success' COMMENT '提取状态'", after: 'ocr_raw' },
        { col: 'text_items_count', def: "INT DEFAULT 0 COMMENT 'PDF文本项总数'", after: 'extraction_status' },
        { col: 'keyword_count', def: "INT DEFAULT 0 COMMENT '发票关键词匹配数'", after: 'text_items_count' },
        { col: 'user_id', def: "VARCHAR(32) COMMENT '用户ID'", after: 'keyword_count' },
      ];
      for (const c of missingCols) {
        if (!await hasColumn(conn, 'app_invoice_mgr_rows', c.col)) {
          await conn.execute(`ALTER TABLE app_invoice_mgr_rows ADD COLUMN ${c.col} ${c.def} AFTER ${c.after}`);
          console.log(`  ✓ Added column ${c.col} to app_invoice_mgr_rows`);

          // user_id 列新增后立即回填历史数据
          if (c.col === 'user_id') {
            const [backfillResult] = await conn.execute(`
              UPDATE app_invoice_mgr_rows r
              JOIN app_invoice_mgr_records m ON m.id = r.row_id
              SET r.user_id = m.user_id
              WHERE r.user_id IS NULL
            `);
            const backfillCount = backfillResult?.affectedRows ?? backfillResult?.changedRows ?? '?';
            console.log(`  ✓ Backfilled user_id for ${backfillCount} rows`);
          }
        }
      }

      // 索引迁移：删除旧 uk_invoice_number，新建 uk_user_invoice_number
      if (await hasIndex(conn, 'app_invoice_mgr_rows', 'uk_invoice_number')) {
        try {
          await conn.execute('ALTER TABLE app_invoice_mgr_rows DROP INDEX uk_invoice_number');
          console.log('  ✓ Dropped old index uk_invoice_number');
        } catch (e) {
          console.log(`  ⚠ Failed to drop uk_invoice_number: ${e.message}`);
        }
      }

      const missingIndexes = [
        { name: 'uk_user_invoice_number', def: 'UNIQUE KEY uk_user_invoice_number (user_id, invoice_number)' },
        { name: 'idx_user_id', def: 'INDEX idx_user_id (user_id)' },
        { name: 'idx_seller', def: 'INDEX idx_seller (seller_name)' },
        { name: 'idx_buyer', def: 'INDEX idx_buyer (buyer_name)' },
        { name: 'idx_date', def: 'INDEX idx_date (invoice_date)' },
        { name: 'idx_amount', def: 'INDEX idx_amount (total_with_tax)' },
      ];
      for (const idx of missingIndexes) {
        if (!await hasIndex(conn, 'app_invoice_mgr_rows', idx.name)) {
          try {
            await conn.execute(`ALTER TABLE app_invoice_mgr_rows ADD ${idx.def}`);
            console.log(`  ✓ Added index ${idx.name} to app_invoice_mgr_rows`);
          } catch (e) {
            console.log(`  ⚠ Skipped index ${idx.name}: ${e.message}`);
          }
        }
      }

      if (!await hasForeignKey(conn, 'app_invoice_mgr_rows', 'fk_app_invoice_mgr_rows_row_id')) {
        try {
          await conn.execute(`
            ALTER TABLE app_invoice_mgr_rows
            ADD CONSTRAINT fk_app_invoice_mgr_rows_row_id
            FOREIGN KEY (row_id) REFERENCES app_invoice_mgr_records(id) ON DELETE CASCADE
          `);
          console.log('  ✓ Added FK fk_app_invoice_mgr_rows_row_id');
        } catch (e) {
          console.log(`  ⚠ Skipped FK: ${e.message}`);
        }
      }

      console.log('  ✓ Incrementally upgraded app_invoice_mgr_rows');
    },
  },

  // 42d. invoice-mgr 商品明细表 items（增量升级：新建 + 逐列补齐 + 补索引 + 补 FK）
  {
    name: 'app_invoice_mgr_items table (incremental)',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_invoice_mgr_items')) return false;
      // 哨兵列：使用最新加入的列作为迁移完成标记
      // ⚠️ 若在 missingCols 中新增列，必须同步更新此哨兵列为最新列名
      return await hasColumn(conn, 'app_invoice_mgr_items', 'created_at');
    },
    migrate: async (conn) => {
      if (!await hasTable(conn, 'app_invoice_mgr_items')) {
        await conn.execute(`
          CREATE TABLE app_invoice_mgr_items (
            id VARCHAR(32) PRIMARY KEY,
            row_id VARCHAR(32) NOT NULL COMMENT '关联 app_invoice_mgr_records.id',
            page_number INT DEFAULT 1 COMMENT '所在页码',
            sort_order INT DEFAULT 0 COMMENT '行内排序',
            category VARCHAR(64) COMMENT '商品分类',
            name VARCHAR(128) COMMENT '商品名称',
            model VARCHAR(64) COMMENT '规格型号',
            unit VARCHAR(16) COMMENT '单位',
            quantity DECIMAL(12,4) COMMENT '数量',
            price DECIMAL(12,4) COMMENT '单价',
            amount DECIMAL(12,2) COMMENT '金额',
            tax_rate VARCHAR(8) COMMENT '税率',
            tax_amount DECIMAL(12,2) COMMENT '税额',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_row_id (row_id),
            FOREIGN KEY (row_id) REFERENCES app_invoice_mgr_records(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='发票商品明细表'
        `);
        console.log('  ✓ Created app_invoice_mgr_items table');
        return;
      }

      const missingCols = [
        { col: 'page_number', def: "INT DEFAULT 1 COMMENT '所在页码'", after: 'row_id' },
        { col: 'sort_order', def: "INT DEFAULT 0 COMMENT '行内排序'", after: 'page_number' },
        { col: 'category', def: "VARCHAR(64) COMMENT '商品分类'", after: 'sort_order' },
        { col: 'name', def: "VARCHAR(128) COMMENT '商品名称'", after: 'category' },
        { col: 'model', def: "VARCHAR(64) COMMENT '规格型号'", after: 'name' },
        { col: 'unit', def: "VARCHAR(16) COMMENT '单位'", after: 'model' },
        { col: 'quantity', def: "DECIMAL(12,4) COMMENT '数量'", after: 'unit' },
        { col: 'price', def: "DECIMAL(12,4) COMMENT '单价'", after: 'quantity' },
        { col: 'amount', def: "DECIMAL(12,2) COMMENT '金额'", after: 'price' },
        { col: 'tax_rate', def: "VARCHAR(8) COMMENT '税率'", after: 'amount' },
        { col: 'tax_amount', def: "DECIMAL(12,2) COMMENT '税额'", after: 'tax_rate' },
        { col: 'created_at', def: "DATETIME DEFAULT CURRENT_TIMESTAMP", after: 'tax_amount' },
      ];
      for (const c of missingCols) {
        if (!await hasColumn(conn, 'app_invoice_mgr_items', c.col)) {
          await conn.execute(`ALTER TABLE app_invoice_mgr_items ADD COLUMN ${c.col} ${c.def} AFTER ${c.after}`);
          console.log(`  ✓ Added column ${c.col} to app_invoice_mgr_items`);
        }
      }

      if (!await hasIndex(conn, 'app_invoice_mgr_items', 'idx_row_id')) {
        try {
          await conn.execute(`ALTER TABLE app_invoice_mgr_items ADD INDEX idx_row_id (row_id)`);
          console.log('  ✓ Added index idx_row_id to app_invoice_mgr_items');
        } catch (e) {
          console.log(`  ⚠ Skipped index idx_row_id: ${e.message}`);
        }
      }

      const [fkRows] = await conn.execute(
        `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'app_invoice_mgr_items' AND COLUMN_NAME = 'row_id' AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [DB_CONFIG.database]
      );
      if (fkRows.length === 0) {
        try {
          await conn.execute(`
            ALTER TABLE app_invoice_mgr_items
            ADD CONSTRAINT fk_app_invoice_mgr_items_row_id
            FOREIGN KEY (row_id) REFERENCES app_invoice_mgr_records(id) ON DELETE CASCADE
          `);
          console.log('  ✓ Added FK fk_app_invoice_mgr_items_row_id');
        } catch (e) {
          console.log(`  ⚠ Skipped FK: ${e.message}`);
        }
      }

      console.log('  ✓ Incrementally upgraded app_invoice_mgr_items');
    },
  },

  // 42e. invoice-mgr 同步 mini_apps.config 中的 user_id 扩展字段
  {
    name: 'invoice-mgr sync user_id field to mini_apps.config',
    check: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT config FROM mini_apps WHERE id = 'invoice-mgr'"
      );
      if (!rows || rows.length === 0) return true;
      const config = typeof rows[0].config === 'string'
        ? JSON.parse(rows[0].config)
        : rows[0].config;
      const rowsTable = (config.extension_tables || []).find(t => t.name === 'app_invoice_mgr_rows');
      if (!rowsTable) return true;
      return rowsTable.fields.some(f => f.name === 'user_id');
    },
    migrate: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT config FROM mini_apps WHERE id = 'invoice-mgr'"
      );
      if (!rows || rows.length === 0) {
        console.log('  ⚠ invoice-mgr not found in mini_apps');
        return;
      }
      const config = typeof rows[0].config === 'string'
        ? JSON.parse(rows[0].config)
        : rows[0].config;
      const rowsTable = (config.extension_tables || []).find(t => t.name === 'app_invoice_mgr_rows');
      if (!rowsTable) {
        console.log('  ⚠ app_invoice_mgr_rows not found in config');
        return;
      }
      if (rowsTable.fields.some(f => f.name === 'user_id')) {
        console.log('  ✓ user_id already in config fields');
        return;
      }
      // 在 fields 最前面插入 user_id
      rowsTable.fields.unshift({
        name: 'user_id',
        type: 'VARCHAR(32)',
        label: '用户ID（系统内部字段）',
        source: 'user_id',
      });
      await conn.execute(
        "UPDATE mini_apps SET config = ? WHERE id = 'invoice-mgr'",
        [JSON.stringify(config)]
      );
      console.log('  ✓ Synced user_id field to mini_apps.config');
    },
  },

  // 43. contract-mgr 自治主表
  {
    name: 'app_contract_mgr_records table',
    check: async (conn) => await hasTable(conn, 'app_contract_mgr_records'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS app_contract_mgr_records (
          id VARCHAR(32) NOT NULL,
          app_id VARCHAR(32) NOT NULL DEFAULT 'contract-mgr',
          user_id VARCHAR(32) NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'ocr_pending',
          data LONGTEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_app_id_status (app_id, status),
          KEY idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await conn.execute(`
        INSERT IGNORE INTO app_contract_mgr_records (id, app_id, user_id, status, data, created_at, updated_at)
        SELECT id, app_id, user_id, status, data, created_at, updated_at
        FROM mini_app_rows
        WHERE app_id = 'contract-mgr'
      `);
      console.log('  ✓ Created app_contract_mgr_records and seeded from mini_app_rows');
    },
  },

  {
    name: 'app_contract_mgr_records add user_id',
    check: async (conn) => {
      if (!await hasTable(conn, 'app_contract_mgr_records')) return true;
      return await hasColumn(conn, 'app_contract_mgr_records', 'user_id');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_contract_mgr_records
        ADD COLUMN user_id VARCHAR(32) NULL AFTER app_id
      `);
      try {
        await conn.execute(`ALTER TABLE app_contract_mgr_records ADD INDEX idx_user_id (user_id)`);
      } catch {}
      await conn.execute(`
        UPDATE app_contract_mgr_records r
        JOIN mini_app_rows m ON m.id = r.id
        SET r.user_id = m.user_id
        WHERE r.user_id IS NULL
      `);
      console.log('  ✓ Added user_id to app_contract_mgr_records and backfilled from mini_app_rows');
    },
  },

  // 44. invoice-mgr + contract-mgr extension 表 FK 迁移到自治表
  {
    name: 'app_invoice/contract extension tables FK migrate to autonomous tables',
    check: async (conn) => {
      const fks = [
        { table: 'app_invoice_mgr_rows', col: 'row_id', expectDb: 'touwaka_mate' },
        { table: 'app_invoice_mgr_items', col: 'row_id', expectDb: 'touwaka_mate' },
        { table: 'app_contract_mgr_content', col: 'row_id', expectDb: 'touwaka_mate' },
        { table: 'app_contract_mgr_rows', col: 'row_id', expectDb: 'touwaka_mate' },
        { table: 'app_contract_mgr_compares', col: 'row_id', expectDb: 'touwaka_mate' },
        { table: 'app_contract_mgr_compares', col: 'target_row_id', expectDb: 'touwaka_mate' },
      ];
      for (const fk of fks) {
        const [rows] = await conn.execute(`
          SELECT REFERENCED_TABLE_NAME
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
        `, [fk.expectDb, fk.table, fk.col]);
        if (rows.length > 0 && rows[0].REFERENCED_TABLE_NAME === 'mini_app_rows') {
          return false;
        }
      }
      return true;
    },
    migrate: async (conn) => {
      const updates = [
        { table: 'app_invoice_mgr_rows', col: 'row_id', ref: 'app_invoice_mgr_records', refCol: 'id' },
        { table: 'app_invoice_mgr_items', col: 'row_id', ref: 'app_invoice_mgr_records', refCol: 'id' },
        { table: 'app_contract_mgr_content', col: 'row_id', ref: 'app_contract_mgr_records', refCol: 'id' },
        { table: 'app_contract_mgr_rows', col: 'row_id', ref: 'app_contract_mgr_records', refCol: 'id' },
        { table: 'app_contract_mgr_compares', col: 'row_id', ref: 'app_contract_mgr_records', refCol: 'id' },
        { table: 'app_contract_mgr_compares', col: 'target_row_id', ref: 'app_contract_mgr_records', refCol: 'id' },
      ];
      for (const u of updates) {
        try {
          const [fkRows] = await conn.execute(
            `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = 'mini_app_rows'`,
            [process.env.DB_NAME || 'touwaka_mate', u.table, u.col]
          );
          for (const fk of fkRows) {
            try { await conn.execute(`ALTER TABLE \`${u.table}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``); }
            catch {}
          }
          try {
            const fkName = `fk_${u.table}_${u.col}`;
            await conn.execute(`ALTER TABLE \`${u.table}\` ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (\`${u.col}\`) REFERENCES \`${u.ref}\`(\`${u.refCol}\`) ON DELETE CASCADE`);
          } catch (e) {
            console.log(`  ⚠ Skipped FK on ${u.table}.${u.col}: ${e.message}`);
          }
        } catch (e) {
          console.log(`  ⚠ Skipped table ${u.table}: ${e.message}`);
        }
      }
      console.log('  ✓ Migrated extension table FKs from mini_app_rows to autonomous tables (best effort)');
    },
  },

  // 45. 退役 app_state 和 app_row_handlers 表
  // Phase 6 Round 7: 按表+列动态查出真实 FK 约束名，替代硬编码猜测
  // DROP 顺序：先删 app_state（解除其 FK→app_row_handlers），
  // 再动态查出并删除 app_action_logs→app_row_handlers 的 FK，最后删 app_row_handlers
  {
    name: 'drop app_state and app_row_handlers tables',
    check: async (conn) => {
      const hasAppState = await hasTable(conn, 'app_state');
      const hasAppRowHandler = await hasTable(conn, 'app_row_handlers');
      return !hasAppState && !hasAppRowHandler;
    },
    migrate: async (conn) => {
      if (await hasTable(conn, 'app_state')) {
        await conn.execute('DROP TABLE IF EXISTS app_state');
        console.log('  ✓ Dropped app_state table');
      }
      if (await hasTable(conn, 'app_row_handlers')) {
        const [fkRows] = await conn.execute(
          `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'app_action_logs' AND COLUMN_NAME = 'handler_id' AND REFERENCED_TABLE_NAME = 'app_row_handlers'`,
          [DB_CONFIG.database]
        );
        for (const fk of fkRows) {
          try {
            await conn.execute(`ALTER TABLE app_action_logs DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
            console.log(`  ✓ Dropped FK ${fk.CONSTRAINT_NAME} from app_action_logs`);
          } catch { /* FK may have been dropped by prior run */ }
        }
        await conn.execute('DROP TABLE IF EXISTS app_row_handlers');
        console.log('  ✓ Dropped app_row_handlers table');
      }
    },
  },

// ==================== 清理旧 doc_* 表（彻底替换） ====================

  // 34. 删除旧 doc_chunks 表
  {
    name: 'doc_chunks table drop',
    check: async (conn) => !(await hasTable(conn, 'doc_chunks')),
    migrate: async (conn) => {
      await safeExecute(conn, `DROP TABLE IF EXISTS doc_chunks`);
      console.log('  ✓ Dropped doc_chunks table');
    }
  },

  // 35. 删除旧 doc_versions 表
  {
    name: 'doc_versions table drop',
    check: async (conn) => !(await hasTable(conn, 'doc_versions')),
    migrate: async (conn) => {
      await safeExecute(conn, `DROP TABLE IF EXISTS doc_versions`);
      console.log('  ✓ Dropped doc_versions table');
    }
  },

  // 36. 删除旧 doc_documents 表
  {
    name: 'doc_documents table drop',
    check: async (conn) => !(await hasTable(conn, 'doc_documents')),
    migrate: async (conn) => {
      await safeExecute(conn, `DROP TABLE IF EXISTS doc_documents`);
      console.log('  ✓ Dropped doc_documents table');
    }
  },

  // 37. 删除旧 doc_collections 表
  {
    name: 'doc_collections table drop',
    check: async (conn) => !(await hasTable(conn, 'doc_collections')),
    migrate: async (conn) => {
      await safeExecute(conn, `DROP TABLE IF EXISTS doc_collections`);
      console.log('  ✓ Dropped doc_collections table');
    }
  },

  // 26. topics 新增 start_time / end_time（Phase 2 WP-1）
  {
    name: 'topics add start_time and end_time',
    check: async (conn) => {
      if (!await hasTable(conn, 'topics')) return true;
      return await hasColumn(conn, 'topics', 'end_time');
    },
    migrate: async (conn) => {
      await safeExecute(conn, `ALTER TABLE topics ADD COLUMN start_time DATETIME NULL COMMENT '话题起始时间' AFTER message_count`);
      await safeExecute(conn, `ALTER TABLE topics ADD COLUMN end_time DATETIME NULL COMMENT '话题结束时间（归档时写入）' AFTER start_time`);
      console.log('  ✓ Added start_time, end_time to topics');
    }
  },

  // ==================== attachments 表添加 access_level 字段 ====================
  // Issue #001: Attachment 访问级别与统一接入改造
  // NOTE: For production with large tables, consider using online schema migration tools
  // like pt-online-schema-change or gh-ost to avoid blocking reads/writes.
  {
    name: 'attachments.access_level column add',
    check: async (conn) => await hasColumn(conn, 'attachments', 'access_level'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE attachments
        ADD COLUMN access_level ENUM('public', 'private') NOT NULL DEFAULT 'private'
          COMMENT '访问级别：public=公开访问，private=私有受控访问'
          AFTER description
      `);
      console.log('  ✓ Added access_level column to attachments table');

      await safeExecute(conn, `
        CREATE INDEX idx_access_level ON attachments(access_level)
      `);
      console.log('  ✓ Added idx_access_level index');
    }
  },

  // ==================== attachments 表 access_level 老数据回填 ====================
  // Issue #001: 根据 source_tag 回填历史数据的 access_level
  // NOTE: Batches by source_tag to limit lock scope. For very large tables,
  // consider further batching by id ranges: WHERE source_tag=? AND id BETWEEN ? AND ?
  {
    name: 'attachments.access_level backfill by source_tag',
    check: async (conn) => {
      const publicTags = ['user_avatar', 'expert_avatar', 'site_logo', 'site_background'];
      const privateTags = ['doc-platform', 'task_export', 'admin_upload', 'mini_app', 'mini_app_file'];
      const [rows] = await conn.execute(`
        SELECT COUNT(*) AS cnt
        FROM attachments
        WHERE (source_tag IN (${publicTags.map(() => '?').join(',')}) AND access_level <> 'public')
           OR (source_tag IN (${privateTags.map(() => '?').join(',')}) AND access_level <> 'private')
      `, [...publicTags, ...privateTags]);
      return rows[0].cnt === 0;
    },
    migrate: async (conn) => {
      const publicTags = ['user_avatar', 'expert_avatar', 'site_logo', 'site_background'];
      for (const tag of publicTags) {
        await conn.execute(`
          UPDATE attachments SET access_level = 'public' WHERE source_tag = ?
        `, [tag]);
        console.log(`  ✓ Backfilled public for ${tag}`);
      }
      
      const privateTags = ['doc-platform', 'task_export', 'admin_upload', 'mini_app', 'mini_app_file'];
      for (const tag of privateTags) {
        await conn.execute(`
          UPDATE attachments SET access_level = 'private' WHERE source_tag = ? AND access_level = 'public'
        `, [tag]);
        console.log(`  ✓ Ensured private for ${tag}`);
      }
      
      const [result] = await conn.execute(`
        SELECT COUNT(*) AS cnt FROM attachments WHERE access_level = 'public'
      `);
      console.log(`  ✓ Total ${result[0].cnt} attachments now marked as public`);
    }
  },

  // ==================== attachments.created_by 字段扩容 ====================
  {
    name: 'attachments.created_by length upgrade',
    check: async (conn) => {
      if (!await hasTable(conn, 'attachments') || !await hasColumn(conn, 'attachments', 'created_by')) {
        return true;
      }
      const [rows] = await conn.execute(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS len
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attachments' AND COLUMN_NAME = 'created_by'`,
        [DB_CONFIG.database]
      );
      return rows.length > 0 && Number(rows[0].len) >= 32;
    },
    migrate: async (conn) => {
      await dropForeignKeysForColumn(conn, 'attachments', 'created_by');
      await conn.execute(`ALTER TABLE attachments MODIFY COLUMN created_by VARCHAR(32) DEFAULT NULL COMMENT '上传者ID'`);
      if (await hasTable(conn, 'users')) {
        await safeExecute(
          conn,
          `ALTER TABLE attachments ADD CONSTRAINT fk_attachments_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL`,
          ['Duplicate', 'already exists']
        );
      }
      console.log('  ✓ Upgraded attachments.created_by to VARCHAR(32)');
    }
  },

  // ==================== 文档平台核心链路 V2 重建 ====================
  {
    name: 'doc platform core tables rebuild v2',
    check: async (conn) => {
      const hasOutlineTable = await hasTable(conn, 'document_outlines');
      const hasRunTable = await hasTable(conn, 'doc_process_runs');
      const hasOutlineId = await hasColumn(conn, 'document_chunks', 'outline_id');
      const hasFromLine = await hasColumn(conn, 'document_chunks', 'from_line');
      return hasOutlineTable && hasRunTable && hasOutlineId && hasFromLine;
    },
    migrate: async (conn) => {
      await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await dropForeignKeyIfExists(conn, 'doc_compare_items', 'fk_comp_items_base_chunk');
        await dropForeignKeyIfExists(conn, 'doc_compare_items', 'fk_comp_items_target_chunk');
        await dropForeignKeyIfExists(conn, 'doc_compare_runs', 'fk_comp_runs_document');
        await dropForeignKeyIfExists(conn, 'doc_compare_runs', 'fk_comp_runs_base_rev');
        await dropForeignKeyIfExists(conn, 'doc_compare_runs', 'fk_comp_runs_target_rev');
        await dropForeignKeyIfExists(conn, 'doc_document_tags', 'fk_doctag_document');
        await dropForeignKeyIfExists(conn, 'app_doc_bindings', 'fk_binding_document');
        await dropForeignKeyIfExists(conn, 'app_doc_bindings', 'fk_binding_revision');

        await safeExecute(conn, `DROP TABLE IF EXISTS doc_process_runs`);
        await safeExecute(conn, `DROP TABLE IF EXISTS document_outlines`);
        await safeExecute(conn, `DROP TABLE IF EXISTS doc_ocr_images`);
        await safeExecute(conn, `DROP TABLE IF EXISTS doc_ocr_results`);
        await safeExecute(conn, `DROP TABLE IF EXISTS document_chunks`);
        await safeExecute(conn, `DROP TABLE IF EXISTS document_revisions`);
        await safeExecute(conn, `DROP TABLE IF EXISTS documents`);

        await conn.execute(`
          CREATE TABLE documents (
            id VARCHAR(32) NOT NULL COMMENT '文档ID',
            collection_id VARCHAR(32) NOT NULL COMMENT '所属文档集合ID',
            current_revision_id VARCHAR(32) NULL COMMENT '当前版本ID',
            doc_type ENUM('knowledge','contract','department_doc','standard') NOT NULL COMMENT '文档类型',
            source_system VARCHAR(50) NOT NULL COMMENT '来源系统',
            source_ref_id VARCHAR(32) NOT NULL COMMENT '来源主键',
            title VARCHAR(500) NOT NULL COMMENT '文档标题',
            processing_status ENUM('pending_ocr','ocr_processing','pending_clean','pending_outline','pending_chunk','pending_embedding','ready','error') NOT NULL DEFAULT 'pending_ocr' COMMENT '处理状态',
            processing_error_code VARCHAR(64) NULL COMMENT '错误码',
            processing_error_message TEXT NULL COMMENT '错误信息',
            processing_retry_count INT NOT NULL DEFAULT 0 COMMENT '重试次数',
            processing_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '处理状态更新时间',
            metadata JSON NULL COMMENT '扩展字段',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_document_source (source_system, source_ref_id),
            INDEX idx_document_collection (collection_id),
            INDEX idx_document_current_revision (current_revision_id),
            INDEX idx_document_processing (processing_status, processing_updated_at),
            INDEX idx_document_type_status (doc_type, processing_status),
            CONSTRAINT fk_document_collection FOREIGN KEY (collection_id) REFERENCES document_collections(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档主表'
        `);

        await conn.execute(`
          CREATE TABLE document_revisions (
            id VARCHAR(32) NOT NULL COMMENT '版本ID',
            document_id VARCHAR(32) NOT NULL COMMENT '所属文档ID',
            revision_no INT NOT NULL COMMENT '机器版号',
            revision_label VARCHAR(20) NULL COMMENT '展示版号(v1.0)',
            revision_status ENUM('draft','review','approved','effective','expired','archived') NOT NULL DEFAULT 'draft' COMMENT '版本状态',
            is_current TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否当前版本',
            effective_from DATE NULL COMMENT '生效日期',
            effective_to DATE NULL COMMENT '废止日期(NULL=长期有效)',
            change_summary TEXT NULL COMMENT '变更摘要',
            created_by VARCHAR(32) NOT NULL COMMENT '创建者ID',
            approved_by VARCHAR(32) NULL COMMENT '审批者ID',
            approved_at DATETIME NULL COMMENT '审批时间',
            diff_status ENUM('pending','processing','ready','error') NOT NULL DEFAULT 'pending' COMMENT '版本差异状态(旁路)',
            metadata JSON NULL COMMENT '扩展字段',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_revision_document_id (document_id, id),
            UNIQUE KEY uk_document_revision_no (document_id, revision_no),
            INDEX idx_revision_document_current (document_id, is_current),
            INDEX idx_revision_status (revision_status),
            INDEX idx_revision_diff_status (diff_status),
            CONSTRAINT fk_revision_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
            CONSTRAINT ck_revision_effective_date CHECK (effective_to IS NULL OR effective_to >= effective_from)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档历史版本'
        `);

        await safeExecute(conn, `ALTER TABLE documents ADD CONSTRAINT fk_document_current_revision FOREIGN KEY (id, current_revision_id) REFERENCES document_revisions(document_id, id) ON DELETE RESTRICT`);

        await conn.execute(`
          CREATE TABLE document_outlines (
            id VARCHAR(32) NOT NULL COMMENT '章节提取结果ID',
            revision_id VARCHAR(32) NOT NULL COMMENT '所属版本ID',
            title VARCHAR(500) NOT NULL COMMENT '章节标题',
            description TEXT NULL COMMENT '章节摘要说明',
            seq INT NOT NULL DEFAULT 0 COMMENT '顺序号',
            from_line INT NOT NULL COMMENT '起始行号',
            to_line INT NOT NULL COMMENT '结束行号',
            original_text LONGTEXT NULL COMMENT '对应原文片段',
            text_hash VARCHAR(128) NULL COMMENT '文本哈希',
            byte_count INT NULL COMMENT '字节数',
            token_count INT NULL COMMENT 'Token数',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_outline_revision_seq (revision_id, seq),
            INDEX idx_outline_revision (revision_id),
            CONSTRAINT fk_outline_revision FOREIGN KEY (revision_id) REFERENCES document_revisions(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='章节提取结果表'
        `);

        await conn.execute(`
          CREATE TABLE document_chunks (
            id VARCHAR(32) NOT NULL COMMENT '分块ID',
            revision_id VARCHAR(32) NOT NULL COMMENT '所属版本ID',
            outline_id VARCHAR(32) NULL COMMENT '所属章节提取结果ID',
            title VARCHAR(500) NULL COMMENT '分块标题',
            content LONGTEXT NULL COMMENT '分块内容',
            seq INT NOT NULL DEFAULT 0 COMMENT '顺序号',
            from_line INT NULL COMMENT '起始行号',
            to_line INT NULL COMMENT '结束行号',
            text_hash VARCHAR(128) NULL COMMENT '文本哈希',
            byte_count INT NULL COMMENT '字节数',
            token_count INT NULL COMMENT 'Token数',
            embedding_vector VECTOR(1536) NULL COMMENT '向量数据',
            embedding_status ENUM('pending','processing','ready','error') NOT NULL DEFAULT 'pending' COMMENT '向量状态',
            embedding_model_id VARCHAR(32) NULL COMMENT '向量模型ID',
            embedded_at DATETIME NULL COMMENT '向量生成时间',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_revision_seq (revision_id, seq),
            INDEX idx_chunk_revision (revision_id),
            INDEX idx_chunk_outline (outline_id),
            INDEX idx_chunk_emb_status (embedding_status),
            CONSTRAINT fk_chunk_revision FOREIGN KEY (revision_id) REFERENCES document_revisions(id) ON DELETE CASCADE,
            CONSTRAINT fk_chunk_outline FOREIGN KEY (outline_id) REFERENCES document_outlines(id) ON DELETE SET NULL
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档最终召回分块表'
        `);

        await conn.execute(`
          CREATE TABLE doc_process_runs (
            id VARCHAR(32) NOT NULL COMMENT '处理运行记录ID',
            revision_id VARCHAR(32) NOT NULL COMMENT '所属版本ID',
            subject_type VARCHAR(64) NOT NULL COMMENT '处理对象表名',
            subject_id VARCHAR(32) NOT NULL COMMENT '处理对象ID',
            pipeline_step VARCHAR(32) NOT NULL COMMENT '处理步骤',
            operation VARCHAR(32) NOT NULL COMMENT '执行动作',
            initiated_by_type VARCHAR(32) NOT NULL COMMENT '触发来源类型',
            initiated_by_id VARCHAR(32) NULL COMMENT '触发主体ID',
            result_status VARCHAR(16) NOT NULL COMMENT '运行结果状态',
            attempt_no INT NOT NULL DEFAULT 1 COMMENT '第几次尝试',
            message TEXT NULL COMMENT '结果说明',
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始处理时间',
            finished_at DATETIME NULL COMMENT '结束处理时间',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_revision_started (revision_id, started_at),
            INDEX idx_step_result (pipeline_step, result_status, started_at),
            INDEX idx_subject_started (subject_type, subject_id, started_at),
            CONSTRAINT fk_doc_process_run_revision FOREIGN KEY (revision_id) REFERENCES document_revisions(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档处理运行记录表'
        `);

        await conn.execute(`
          CREATE TABLE doc_ocr_results (
            id VARCHAR(32) NOT NULL COMMENT 'OCR结果ID',
            document_id VARCHAR(32) NOT NULL COMMENT '文档ID',
            revision_id VARCHAR(32) NOT NULL COMMENT '文档版本ID',
            provider VARCHAR(64) NOT NULL DEFAULT 'mineru' COMMENT 'OCR供应方标识',
            task_id VARCHAR(128) NULL COMMENT '上游任务ID',
            status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending' COMMENT 'OCR阶段归一化状态',
            progress INT NOT NULL DEFAULT 0 COMMENT 'OCR进度百分比',
            main_markdown_attachment_id VARCHAR(20) NULL COMMENT '平台主markdown附件ID',
            raw_result_attachment_id VARCHAR(20) NULL COMMENT 'OCR原始结果附件ID',
            deliverables_manifest_attachment_id VARCHAR(20) NULL COMMENT '交付物清单附件ID',
            middle_json_attachment_id VARCHAR(20) NULL COMMENT 'middle_json附件ID',
            content_list_attachment_id VARCHAR(20) NULL COMMENT 'content_list附件ID',
            content_list_v2_attachment_id VARCHAR(20) NULL COMMENT 'content_list_v2附件ID',
            model_json_attachment_id VARCHAR(20) NULL COMMENT 'model_json附件ID',
            image_manifest_attachment_id VARCHAR(20) NULL COMMENT '图片清单附件ID',
            image_count INT NOT NULL DEFAULT 0 COMMENT '图片数量',
            line_count INT NOT NULL DEFAULT 0 COMMENT '主markdown行数',
            error_code VARCHAR(64) NULL COMMENT '错误码',
            error_message TEXT NULL COMMENT '错误信息',
            started_at DATETIME NULL COMMENT '开始时间',
            completed_at DATETIME NULL COMMENT '完成时间',
            metadata JSON NULL COMMENT '轻量追溯信息',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_doc_ocr_result_document (document_id, revision_id),
            INDEX idx_doc_ocr_result_status (status, updated_at),
            INDEX idx_doc_ocr_result_task (provider, task_id),
            CONSTRAINT fk_doc_ocr_result_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
            CONSTRAINT fk_doc_ocr_result_revision FOREIGN KEY (revision_id) REFERENCES document_revisions(id) ON DELETE CASCADE,
            CONSTRAINT fk_doc_ocr_result_main_markdown_attachment FOREIGN KEY (main_markdown_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
            CONSTRAINT fk_doc_ocr_result_raw_result_attachment FOREIGN KEY (raw_result_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
            CONSTRAINT fk_doc_ocr_result_deliverables_manifest_attachment FOREIGN KEY (deliverables_manifest_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
            CONSTRAINT fk_doc_ocr_result_middle_json_attachment FOREIGN KEY (middle_json_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
            CONSTRAINT fk_doc_ocr_result_content_list_attachment FOREIGN KEY (content_list_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
            CONSTRAINT fk_doc_ocr_result_content_list_v2_attachment FOREIGN KEY (content_list_v2_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
            CONSTRAINT fk_doc_ocr_result_model_json_attachment FOREIGN KEY (model_json_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
            CONSTRAINT fk_doc_ocr_result_image_manifest_attachment FOREIGN KEY (image_manifest_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OCR阶段结果表'
        `);

        await conn.execute(`
          CREATE TABLE doc_ocr_images (
            id VARCHAR(32) NOT NULL COMMENT 'OCR图片关系ID',
            ocr_result_id VARCHAR(32) NOT NULL COMMENT 'OCR结果ID',
            attachment_id VARCHAR(20) NOT NULL COMMENT '图片附件ID',
            filename VARCHAR(255) NULL COMMENT '原始文件名',
            media_type VARCHAR(100) NOT NULL COMMENT 'MIME类型',
            sort_order INT NOT NULL DEFAULT 0 COMMENT '排序',
            referenced_in_markdown TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否在markdown中被引用',
            markdown_path VARCHAR(500) NULL COMMENT 'markdown中的原始引用路径',
            line_number INT NULL COMMENT '引用所在行号',
            start_offset INT NULL COMMENT '起始偏移',
            end_offset INT NULL COMMENT '结束偏移',
            alt_text VARCHAR(500) NULL COMMENT 'alt文本',
            description TEXT NULL COMMENT '图片描述',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_doc_ocr_image_result (ocr_result_id, sort_order),
            INDEX idx_doc_ocr_image_attachment (attachment_id),
            CONSTRAINT fk_doc_ocr_image_result FOREIGN KEY (ocr_result_id) REFERENCES doc_ocr_results(id) ON DELETE CASCADE,
            CONSTRAINT fk_doc_ocr_image_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OCR图片关系表'
        `);

        if (await hasTable(conn, 'app_doc_bindings')) {
          await safeExecute(conn, `ALTER TABLE app_doc_bindings ADD CONSTRAINT fk_binding_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE`);
          await safeExecute(conn, `ALTER TABLE app_doc_bindings ADD CONSTRAINT fk_binding_revision FOREIGN KEY (current_revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL`);
        }

        if (await hasTable(conn, 'doc_document_tags')) {
          await safeExecute(conn, `ALTER TABLE doc_document_tags ADD CONSTRAINT fk_doctag_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE`);
        }

        if (await hasTable(conn, 'doc_compare_runs')) {
          await safeExecute(conn, `ALTER TABLE doc_compare_runs ADD CONSTRAINT fk_comp_runs_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE`);
          await safeExecute(conn, `ALTER TABLE doc_compare_runs ADD CONSTRAINT fk_comp_runs_base_rev FOREIGN KEY (base_version_id) REFERENCES document_revisions(id) ON DELETE CASCADE`);
          await safeExecute(conn, `ALTER TABLE doc_compare_runs ADD CONSTRAINT fk_comp_runs_target_rev FOREIGN KEY (target_version_id) REFERENCES document_revisions(id) ON DELETE CASCADE`);
        }

        if (await hasTable(conn, 'doc_compare_items')) {
          await safeExecute(conn, `ALTER TABLE doc_compare_items ADD CONSTRAINT fk_comp_items_base_chunk FOREIGN KEY (base_unit_id) REFERENCES document_chunks(id) ON DELETE SET NULL`);
          await safeExecute(conn, `ALTER TABLE doc_compare_items ADD CONSTRAINT fk_comp_items_target_chunk FOREIGN KEY (target_unit_id) REFERENCES document_chunks(id) ON DELETE SET NULL`);
        }
      } finally {
        await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
      }
      console.log('  ✓ Rebuilt doc platform core tables to V2 design');
    },
  },
  // 38. app_tick_run 表 — Tick 运行实例表
  // PR #860 复盘: 统一运行态事实源，替代内存 runningApps/timedOutApps/runStatus
  {
    name: 'app_tick_run table create',
    check: async (conn) => await hasTable(conn, 'app_tick_run'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_tick_run (
          id CHAR(20) NOT NULL COMMENT '运行记录ID，使用 Utils.newID()',
          app_id VARCHAR(100) NOT NULL COMMENT 'app标识，如 doc-ocr-pipeline',
          started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本轮tick开始时间',
          finished_at DATETIME NULL DEFAULT NULL COMMENT '本轮tick结束时间，NULL表示仍未闭合',
          status ENUM(
            'running',
            'success',
            'failed',
            'interrupted_by_restart',
            'terminated_by_admin'
          ) NOT NULL DEFAULT 'running' COMMENT '运行状态',
          final_message TEXT NULL COMMENT '最终说明/遗言：成功摘要、失败错误、重启中断说明等',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_app_tick_run_app_id_started_at (app_id, started_at DESC),
          KEY idx_app_tick_run_finished_at (finished_at),
          KEY idx_app_tick_run_status (status),
          KEY idx_app_tick_run_open (app_id, finished_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AppClock tick运行实例表'
      `);
      console.log('  ✓ Created app_tick_run table');
    }
  },

  // 26. providers 表新增 provider_type 字段 + ai_models 表扩展 model_type 枚举
  {
    name: 'providers.ai_models.add_provider_type_and_tts_model_type',
    async check(conn) {
      const [cols1] = await conn.execute(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'providers' AND COLUMN_NAME = 'provider_type'
      `);
      const [cols2] = await conn.execute(`
        SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_models' AND COLUMN_NAME = 'model_type'
      `);
      const hasProviderType = cols1.length > 0;
      const hasTTSType = cols2.length > 0 && cols2[0].COLUMN_TYPE.includes("'tts'");
      return hasProviderType && hasTTSType;
    },
    async migrate(conn) {
      const [cols1] = await conn.execute(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'providers' AND COLUMN_NAME = 'provider_type'
      `);
      if (cols1.length === 0) {
        await conn.execute(`
          ALTER TABLE providers
          ADD COLUMN provider_type ENUM('llm', 'tts', 'embedding') DEFAULT 'llm'
          AFTER user_agent
        `);
        console.log('  ✓ Added provider_type column to providers');
      }
      const [cols2] = await conn.execute(`
        SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_models' AND COLUMN_NAME = 'model_type'
      `);
      if (cols2.length > 0 && !cols2[0].COLUMN_TYPE.includes("'tts'")) {
        await conn.execute(`
          ALTER TABLE ai_models
          MODIFY COLUMN model_type ENUM('text','multimodal','embedding','tts') DEFAULT 'text'
        `);
        console.log('  ✓ Extended ai_models.model_type to include tts');
      }
      await conn.execute(`
        UPDATE providers SET provider_type = 'llm' WHERE provider_type IS NULL
      `);
    },
  },
  {
    name: 'ai_models.thinking_format add glm enum',
    check: async (conn) => {
      const columnType = await getColumnType(conn, 'ai_models', 'thinking_format');
      return columnType && columnType.includes("'glm'");
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE ai_models
        MODIFY COLUMN thinking_format ENUM('openai','deepseek','glm','qwen','none') DEFAULT 'none' COMMENT '思考模式格式'
      `);
      console.log('  ✓ Extended ai_models.thinking_format to include glm');
    },
  },

  // 39. 迁移旧 timeout.remote_llm → timeout.internal_llm
  // PR #860 复盘: 系统级 timeout 分类收口，存量数据需搬迁
  {
    name: 'timeout.remote_llm migrate to timeout.internal_llm',
    check: async (conn) => {
      const [newRows] = await conn.execute(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'timeout.internal_llm'`
      );
      if (newRows.length === 0) return false;
      const [oldRows] = await conn.execute(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'timeout.remote_llm'`
      );
      return oldRows.length === 0;
    },
    migrate: async (conn) => {
      const [oldRows] = await conn.execute(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'timeout.remote_llm'`
      );
      if (oldRows.length > 0) {
        const oldValue = oldRows[0].setting_value;
        await conn.execute(
          `INSERT INTO system_settings (setting_key, setting_value, value_type, description)
           VALUES ('timeout.internal_llm', ?, 'number', 'Internal LLM 请求超时（秒）')
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [oldValue]
        );
        console.log(`  ✓ Migrated timeout.remote_llm (${oldValue}s) → timeout.internal_llm`);
        await conn.execute(
          `DELETE FROM system_settings WHERE setting_key = 'timeout.remote_llm'`
        );
        console.log(`  ✓ Cleaned up deprecated timeout.remote_llm key`);
      } else {
        console.log('  ⏭️  No timeout.remote_llm to migrate');
      }
    },
  },
  {
    name: 'documents.processing_status enum simplify',
    check: async (conn) => {
      const columnType = await getColumnType(conn, 'documents', 'processing_status');
      if (!columnType) return false;
      return columnType === "enum('pending_ocr','ocr_processing','pending_clean','pending_outline','pending_chunk','pending_embedding','ready','error')";
    },
    migrate: async (conn) => {
      await conn.execute(
        `UPDATE documents
         SET processing_status = CASE
           WHEN processing_status = 'pending_metadata' THEN 'pending_outline'
           WHEN processing_status = 'pending_relocate' THEN 'ready'
           ELSE processing_status
         END
         WHERE processing_status IN ('pending_metadata', 'pending_relocate')`
      );

      await conn.execute(
        `ALTER TABLE documents
         MODIFY COLUMN processing_status ENUM('pending_ocr','ocr_processing','pending_clean','pending_outline','pending_chunk','pending_embedding','ready','error')
         NOT NULL DEFAULT 'pending_ocr' COMMENT '处理状态'`
      );
      console.log('  ✓ Simplified documents.processing_status enum and migrated legacy states');
    },
  },
  {
    name: 'remove timeout.external_http setting',
    check: async (conn) => {
      const [rows] = await conn.execute(
        `SELECT setting_key FROM system_settings WHERE setting_key = 'timeout.external_http'`
      );
      return rows.length === 0;
    },
    migrate: async (conn) => {
      await conn.execute(
        `DELETE FROM system_settings WHERE setting_key = 'timeout.external_http'`
      );
      console.log('  ✓ Removed deprecated timeout.external_http setting');
    },
  },


  // ==================== 文档流水线阶段事实模型 ====================
  // 审计 AUDIT-ROUND01: 为 documents 增加 current_stage_started_at 字段
  // 语义：记录进入当前阶段的时间点，与 processing_updated_at（最近变化时间）解耦
  {
    name: 'documents.current_stage_started_at column add',
    check: async (conn) => await hasColumn(conn, 'documents', 'current_stage_started_at'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE documents
        ADD COLUMN current_stage_started_at DATETIME NULL COMMENT '进入当前处理阶段的时间点'
        AFTER processing_updated_at
      `);
      console.log('  ✓ Added documents.current_stage_started_at column');
    }
  },

  // 审计 AUDIT-ROUND01: 为 doc_process_runs 增加 metadata JSON 字段
  // 用于结构化存储 timeout / cancel reason / upstream task summary 等上下文
  {
    name: 'doc_process_runs.metadata column add',
    check: async (conn) => await hasColumn(conn, 'doc_process_runs', 'metadata'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE doc_process_runs
        ADD COLUMN metadata JSON NULL COMMENT '结构化上下文（timeout/cancel/retry/upstream summary）'
        AFTER message
      `);
      console.log('  ✓ Added doc_process_runs.metadata column');
    }
  },




  // 44. doc_content_units.version_id 外键重绑到 document_revisions
  {
    name: 'rebind doc_content_units.version_id foreign key to document_revisions',
    check: async (conn) => {
      const hasTableDocContentUnits = await hasTable(conn, 'doc_content_units');
      const hasTableDocumentRevisions = await hasTable(conn, 'document_revisions');
      if (!hasTableDocContentUnits || !hasTableDocumentRevisions) return false;

      const [rows] = await conn.execute(`
        SELECT REFERENCED_TABLE_NAME, CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'doc_content_units'
          AND COLUMN_NAME = 'version_id'
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `);

      if (rows.length === 0) return false;
      return rows[0].REFERENCED_TABLE_NAME === 'document_revisions';
    },
    migrate: async (conn) => {
      const hasTableDocContentUnits = await hasTable(conn, 'doc_content_units');
      const hasTableDocumentRevisions = await hasTable(conn, 'document_revisions');
      if (!hasTableDocContentUnits || !hasTableDocumentRevisions) {
        console.log('  ⏭️  Skipping FK rebind: doc_content_units or document_revisions table does not exist');
        return;
      }

      const [rows] = await conn.execute(`
        SELECT REFERENCED_TABLE_NAME, CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'doc_content_units'
          AND COLUMN_NAME = 'version_id'
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `);

      for (const row of rows) {
        await safeExecute(conn, `ALTER TABLE doc_content_units DROP FOREIGN KEY ${row.CONSTRAINT_NAME}`);
      }

      const [indexes] = await conn.execute(`SHOW INDEX FROM doc_content_units WHERE Key_name = 'fk_unit_version'`);
      if (indexes.length > 0) {
        await safeExecute(conn, `ALTER TABLE doc_content_units DROP INDEX fk_unit_version`);
      }
      await safeExecute(conn, `ALTER TABLE doc_content_units ADD INDEX idx_doc_content_units_version_id (version_id)`);
      await conn.execute(`
        ALTER TABLE doc_content_units
        ADD CONSTRAINT fk_doc_content_units_revision
        FOREIGN KEY (version_id) REFERENCES document_revisions(id)
        ON DELETE CASCADE
      `);

      console.log('  ✓ Rebound doc_content_units.version_id → document_revisions.id');
    }
  },

  // ==================== standard-mgr 扩展表 ====================
  // DDL 定稿 v1.0（2026-07-31，docs/tasks/active/task-20260731-standard-anchor-tools/DDL-DRAFT.md）
  // 与 apps/standard-mgr/migrations/install.js 保持一致
  {
    name: 'app_standard create table',
    check: async (conn) => await hasTable(conn, 'app_standard'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_standard (
          id VARCHAR(32) PRIMARY KEY,
          document_id VARCHAR(32) NOT NULL COMMENT '文档平台 documents.id，一份文档只纳管一次',
          standard_type VARCHAR(20) NOT NULL COMMENT '标准类型，当前取值 national/industry/enterprise/international，应用层校验，可扩展',
          standard_code VARCHAR(100) NOT NULL COMMENT '标准编号，如 GB/T 19001-2016',
          standard_name VARCHAR(500) NOT NULL COMMENT '标准名称',
          enterprise_id VARCHAR(32) NULL COMMENT '归属企业；NULL=公共标准库（承接国家/行业/国际标准），企业表建立后迁移为企业记录',
          current_revision_id VARCHAR(32) NULL COMMENT '当前采用版本 document_revisions.id',
          is_active BIT(1) DEFAULT 1 COMMENT '是否启用',
          anchor_build_status ENUM('pending','processing','done','error') DEFAULT 'pending' COMMENT '引用清洗状态',
          last_anchor_build_at DATETIME NULL COMMENT '最近一次清洗完成时间',
          last_anchor_build_error TEXT NULL COMMENT '最近一次清洗错误信息',
          needs_review BIT(1) DEFAULT 0 COMMENT '是否存在待人工处理的存疑/gap/无效引用',
          reference_count INT DEFAULT 0 COMMENT '引用总数',
          valid_reference_count INT DEFAULT 0 COMMENT '有效引用数',
          suspected_reference_count INT DEFAULT 0 COMMENT '存疑引用数',
          gap_reference_count INT DEFAULT 0 COMMENT '待回填缺口数',
          invalid_reference_count INT DEFAULT 0 COMMENT '无效引用数',
          has_manual_fix BIT(1) DEFAULT 0 COMMENT '是否存在人工修正',
          manual_fix_count INT DEFAULT 0 COMMENT '人工修正次数',
          last_manual_fix_at DATETIME NULL COMMENT '最近人工修正时间',
          last_manual_fix_by VARCHAR(32) NULL COMMENT '最近人工修正人 users.id',
          created_by VARCHAR(32) NULL COMMENT '创建人',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_app_standard_document_revision (document_id, current_revision_id),
          INDEX idx_document_id (document_id),
          INDEX idx_standard_code (standard_code),
          INDEX idx_enterprise (enterprise_id),
          INDEX idx_build_status (anchor_build_status),
          INDEX idx_current_revision (current_revision_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标准纳管主对象表'
      `);
      console.log('  ✓ Created app_standard table');
    }
  },

  {
    // R17-3（一文档多版本）：document_id 唯一索引 → (document_id, current_revision_id) 联合唯一
    // 背景：与文档平台对齐——同一文档可对应多个版本（revision），每个版本一条标准记录。
    // 唯一约束改为「同文档 + 同版本」粒度：同文档不同版本可共存，同版本不重复纳管。
    // current_revision_id 为 NULL 时 MySQL 联合唯一不生效，与文档平台 NULL=版本未定 语义一致。
    name: 'app_standard unique index to document+revision',
    // check 目标：新联合唯一索引不存在时才需要迁移
    check: async (conn) => await hasIndex(conn, 'app_standard', 'uk_app_standard_document_revision'),
    migrate: async (conn) => {
      await safeExecute(conn, 'ALTER TABLE app_standard DROP INDEX uk_app_standard_document');
      await conn.execute('ALTER TABLE app_standard ADD UNIQUE KEY uk_app_standard_document_revision (document_id, current_revision_id)');
      await safeExecute(conn, 'ALTER TABLE app_standard ADD INDEX idx_document_id (document_id)');
      console.log('  ✓ Dropped uk_app_standard_document → added uk_app_standard_document_revision (document_id, current_revision_id)');
    }
  },

  {
    name: 'app_standard_ref_anchor create table',
    check: async (conn) => await hasTable(conn, 'app_standard_ref_anchor'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_standard_ref_anchor (
          id VARCHAR(32) PRIMARY KEY,
          standard_id VARCHAR(32) NOT NULL COMMENT '所属标准 app_standard.id',
          source_revision_id VARCHAR(32) NOT NULL COMMENT '引用所在版本 document_revisions.id',
          source_outline_id VARCHAR(32) NOT NULL COMMENT '引用所在 section document_outlines.id',
          occurrence_index INT NOT NULL DEFAULT 0 COMMENT '同一引用片段在该 section 内第几次出现，从 0 起',
          source_text VARCHAR(500) NOT NULL COMMENT '原文引用片段（如 GB/T 2001），兼作 gap 回填预筛线索',
          context_text TEXT NULL COMMENT '引用片段上下文快照，供人工修正界面展示',
          ref_type ENUM('explicit','implicit') NOT NULL COMMENT '显式/隐式引用',
          status ENUM('valid','suspected','gap','invalid') NOT NULL COMMENT '有效/存疑/待回填/无效',
          source ENUM('auto','user_confirmed','manual','auto_backfill') NOT NULL DEFAULT 'auto' COMMENT '来源：自动识别/用户确认候选/人工新建/自动回填',
          target_document_id VARCHAR(32) NULL COMMENT '目标文档 documents.id，未定目标为 NULL',
          target_revision_id VARCHAR(32) NULL COMMENT '目标版本 document_revisions.id',
          target_outline_id VARCHAR(32) NULL COMMENT '目标 section document_outlines.id',
          candidates_json JSON NULL COMMENT '存疑候选列表 [{document_id,revision_id,outline_id,reason,score}]',
          status_reason VARCHAR(500) NULL COMMENT '状态原因元数据',
          retry_count INT DEFAULT 0 COMMENT 'gap 回填已重试次数',
          last_retry_at DATETIME NULL COMMENT '最近回填重试时间',
          created_by VARCHAR(32) NULL COMMENT '写入入口标识（清洗运行ID/用户ID/回填任务ID）',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_ref_anchor_occurrence (source_revision_id, source_outline_id, occurrence_index),
          INDEX idx_standard_status (standard_id, status),
          INDEX idx_target_document (target_document_id),
          INDEX idx_source_outline (source_outline_id),
          FOREIGN KEY (standard_id) REFERENCES app_standard(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标准引用锚点记录表'
      `);
      console.log('  ✓ Created app_standard_ref_anchor table');
    }
  },

  {
    name: 'app_standard_anchored_section create table',
    check: async (conn) => await hasTable(conn, 'app_standard_anchored_section'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_standard_anchored_section (
          id VARCHAR(32) PRIMARY KEY,
          standard_id VARCHAR(32) NOT NULL COMMENT '所属标准 app_standard.id',
          revision_id VARCHAR(32) NOT NULL COMMENT '来源版本 document_revisions.id',
          outline_id VARCHAR(32) NOT NULL COMMENT '来源 section document_outlines.id',
          anchored_text LONGTEXT NULL COMMENT '插入 <document_id+revision_id(+outline_id)> 锚点后的文本',
          source_text_hash VARCHAR(64) NOT NULL COMMENT '对齐 document_outlines.text_hash，不符则副本失效',
          anchor_count INT DEFAULT 0 COMMENT '本 section 内锚点数量',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_anchored_section (revision_id, outline_id),
          INDEX idx_standard (standard_id),
          FOREIGN KEY (standard_id) REFERENCES app_standard(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标准带锚点文本副本表'
      `);
      console.log('  ✓ Created app_standard_anchored_section table');
    }
  },

  // ==================== R3-2：注册 standard-mgr 到 mini_apps ====================
  {
    name: 'register standard-mgr in mini_apps',
    check: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT 1 FROM mini_apps WHERE id = 'standard-mgr'"
      );
      return rows.length > 0;
    },
    migrate: async (conn) => {
      const userId = await getAnyExistingUserId(conn);
      await conn.execute(
        `INSERT INTO mini_apps (id, name, description, icon, type, component, fields, views, config,
           visibility, owner_id, creator_id, sort_order, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'standard-mgr',
          '标准管理',
          '标准文档纳管、引用清洗与锚点定位',
          '📐',
          'document',
          null,
          '[]',
          '{}',
          '{"extension_tables":["app_standard","app_standard_ref_anchor","app_standard_anchored_section"]}',
          'all',
          userId,
          userId,
          50,
          1,
          1,
        ]
      );
      console.log('  ✓ Registered standard-mgr in mini_apps');
    }
  },

  // ==================== R3-2：注册 standard-anchor 技能 ====================
  {
    name: 'register standard-anchor skill',
    check: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT 1 FROM skills WHERE name = 'standard-anchor'"
      );
      return rows.length > 0;
    },
    migrate: async (conn) => {
      const skillId = 'skill-standard-anchor';
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

      // 1. 插入技能记录
      await conn.execute(
        `INSERT INTO skills (id, name, mark, description, version, author, tags, source_type, source_path,
           skill_md, security_score, security_warnings, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          skillId,
          'standard-anchor',
          'standard-anchor',
          '标准锚点识别工具集：解析锚点、读取文档章节/全文、定位引用目标。',
          '1.0.0',
          'Touwaka Team',
          '["标准","锚点","引用","文档"]',
          'local',
          'skills/standard-anchor',
          '',  // skill_md — SKILL.md 内容按需通过 API 同步
          50,
          '[]',
          1,
          now,
          now,
        ]
      );
      console.log('  ✓ Registered standard-anchor skill');

      // 2. 插入 12 个工具定义（与 data/skills/standard-anchor/index.js getTools() 同步）
      // R4-2：完整参数，不可手写子集；如变更工具定义，请通过 API POST /api/skills/register 重新注册
      const tools = [
        ['st-anchor-parse', skillId, 'parse_anchor', '解析锚点字符串 <document_id+revision_id(+outline_id)> 为结构化对象', '{"type":"object","properties":{"anchor":{"type":"string","description":"锚点字符串，格式 <document_id+revision_id> 或 <document_id+revision_id+outline_id>"}},"required":["anchor"]}', 'index.js', now, now],
        ['st-anchor-list-sec', skillId, 'list_revision_sections', '按 revision_id 列出所有章节（outline），返回 title/seq/from_line/to_line/outline_id', '{"type":"object","properties":{"revision_id":{"type":"string","description":"版本 ID（document_revisions.id）"}},"required":["revision_id"]}', 'index.js', now, now],
        ['st-anchor-read-sec', skillId, 'read_section_context', '读取指定 section 正文，可附带前后相邻 section 的上下文', '{"type":"object","properties":{"outline_id":{"type":"string","description":"章节 ID（document_outlines.id）"},"context_window":{"type":"number","description":"上下文窗口大小，前后各取几个相邻 section（默认 0）"}},"required":["outline_id"]}', 'index.js', now, now],
        ['st-anchor-read-rev', skillId, 'read_revision_content', '读取指定 revision 的全文文本内容', '{"type":"object","properties":{"revision_id":{"type":"string","description":"版本 ID（document_revisions.id）"}},"required":["revision_id"]}', 'index.js', now, now],
        ['st-anchor-locator', skillId, 'get_section_locator', '通过 outline_id 反查所属的 document_id 和 revision_id', '{"type":"object","properties":{"outline_id":{"type":"string","description":"章节 ID（document_outlines.id）"}},"required":["outline_id"]}', 'index.js', now, now],
        ['st-anchor-find-code', skillId, 'find_documents_by_standard_code', '按标准编号查找已纳管的标准（查 app_standard 表）', '{"type":"object","properties":{"standard_code":{"type":"string","description":"标准编号，如 GB/T 19001-2016"}},"required":["standard_code"]}', 'index.js', now, now],
        ['st-anchor-find-name', skillId, 'find_documents_by_standard_name', '按标准名称查找已纳管的标准（查 app_standard 表），支持模糊匹配', '{"type":"object","properties":{"standard_name":{"type":"string","description":"标准名称，支持模糊匹配"}},"required":["standard_name"]}', 'index.js', now, now],
        ['st-anchor-get-revs', skillId, 'get_document_revisions', '获取指定文档的所有版本列表', '{"type":"object","properties":{"document_id":{"type":"string","description":"文档 ID（documents.id）"}},"required":["document_id"]}', 'index.js', now, now],
        ['st-anchor-sel-rev', skillId, 'select_revision_candidate', '按版本线索从候选 revision 中筛选最匹配的版本（纯函数，不发 IO）', '{"type":"object","properties":{"revisions":{"type":"array","items":{"type":"object"},"description":"版本列表（含 revision_label、revision_no）"},"hints":{"type":"object","properties":{"year":{"type":"string","description":"年份线索，如 \\"2016\\""},"revision_label":{"type":"string","description":"精确 label 匹配"}}}},"required":["revisions"]}', 'index.js', now, now],
        ['st-anchor-find-sec', skillId, 'find_section_candidates', '按节号/标题等线索查找候选 section（outline）', '{"type":"object","properties":{"document_id":{"type":"string","description":"文档 ID"},"revision_id":{"type":"string","description":"版本 ID（优先于 document_id）"},"title_hint":{"type":"string","description":"章节标题线索"},"seq_hint":{"type":"number","description":"章节序号线索"},"query_text":{"type":"string","description":"语义搜索文本（用于向量召回辅助）"}},"required":[]}', 'index.js', now, now],
        ['st-anchor-list-gap', skillId, 'list_reference_gaps', '列出指定标准中待回填的引用缺口（status=gap）', '{"type":"object","properties":{"standard_id":{"type":"string","description":"标准 ID（app_standard.id）"},"limit":{"type":"number","description":"返回数量上限（默认 100）"},"offset":{"type":"number","description":"偏移量（默认 0）"}},"required":["standard_id"]}', 'index.js', now, now],
        // R4-2：write_anchor_result 必须含全部 16 个参数（含 target 三字段），否则 agent schema 层面无法写入 valid 锚点
        ['st-anchor-write', skillId, 'write_anchor_result', '写入一个引用的完整判断结果（幂等），同时更新带锚点副本和汇总计数', '{"type":"object","properties":{"standard_id":{"type":"string","description":"标准 ID"},"source_revision_id":{"type":"string","description":"来源 revision ID"},"source_outline_id":{"type":"string","description":"来源 outline ID"},"occurrence_index":{"type":"number","description":"同 section 内出现序号（从 0 开始）"},"source_text":{"type":"string","description":"原始引用文本（必须是被引章节原文的逐字连续子串，禁止改写、合并、补字或转述）"},"context_text":{"type":"string","description":"引用上下文"},"ref_type":{"type":"string","enum":["explicit","implicit"],"description":"引用类型"},"status":{"type":"string","enum":["valid","suspected","gap","invalid"],"description":"引用状态"},"source":{"type":"string","enum":["auto","user_confirmed","manual","auto_backfill"],"description":"来源"},"target_document_id":{"type":"string","description":"目标文档 ID"},"target_revision_id":{"type":"string","description":"目标 revision ID"},"target_outline_id":{"type":"string","description":"目标 outline ID"},"candidates_json":{"type":"object","description":"候选列表"},"status_reason":{"type":"string","description":"状态原因"},"anchored_text":{"type":"string","description":"带锚点副本的文本"},"source_text_hash":{"type":"string","description":"来源文本 hash"}},"required":["standard_id","source_revision_id","source_outline_id","occurrence_index","source_text","ref_type","status","source"]}', 'index.js', now, now],
      ];

      for (const t of tools) {
        await conn.execute(
          `INSERT INTO skill_tools (id, skill_id, name, description, parameters, script_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          t
        );
      }
      console.log('  ✓ Registered 12 standard-anchor tools');
    }
  },

  // ==================== R4-2：修复已注册的 standard-anchor 工具参数完整性 ====================
  // R3-2 迁移中的 write_anchor_result 参数只有 8 个字段（缺 target 三字段等），
  // 已运行过的实例需要此迁移补充完整。新安装不受影响（上面迁移已包含完整参数）。
  {
    name: 'fix standard-anchor tool params (R4-2)',
    check: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT parameters FROM skill_tools WHERE name = 'write_anchor_result' AND skill_id IN (SELECT id FROM skills WHERE name = 'standard-anchor')"
      );
      if (rows.length === 0) return true; // 无记录，跳过
      try {
        const params = typeof rows[0].parameters === 'string' ? JSON.parse(rows[0].parameters) : rows[0].parameters;
        // 检查是否缺 target_outline_id（说明是 R3-2 旧版手写参数）
        return params?.properties?.target_outline_id !== undefined;
      } catch {
        return false; // JSON 解析失败，需要修复
      }
    },
    migrate: async (conn) => {
      const [skillRows] = await conn.execute(
        "SELECT id FROM skills WHERE name = 'standard-anchor'"
      );
      if (skillRows.length === 0) return;
      const skillId = skillRows[0].id;
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

      // 删除旧工具，重新插入完整参数
      await conn.execute('DELETE FROM skill_tools WHERE skill_id = ?', [skillId]);
      console.log('  ✓ Cleared stale standard-anchor tools');

      const tools = [
        ['st-anchor-parse', skillId, 'parse_anchor', '解析锚点字符串 <document_id+revision_id(+outline_id)> 为结构化对象', '{"type":"object","properties":{"anchor":{"type":"string","description":"锚点字符串，格式 <document_id+revision_id> 或 <document_id+revision_id+outline_id>"}},"required":["anchor"]}', 'index.js', now, now],
        ['st-anchor-list-sec', skillId, 'list_revision_sections', '按 revision_id 列出所有章节（outline），返回 title/seq/from_line/to_line/outline_id', '{"type":"object","properties":{"revision_id":{"type":"string","description":"版本 ID（document_revisions.id）"}},"required":["revision_id"]}', 'index.js', now, now],
        ['st-anchor-read-sec', skillId, 'read_section_context', '读取指定 section 正文，可附带前后相邻 section 的上下文', '{"type":"object","properties":{"outline_id":{"type":"string","description":"章节 ID（document_outlines.id）"},"context_window":{"type":"number","description":"上下文窗口大小，前后各取几个相邻 section（默认 0）"}},"required":["outline_id"]}', 'index.js', now, now],
        ['st-anchor-read-rev', skillId, 'read_revision_content', '读取指定 revision 的全文文本内容', '{"type":"object","properties":{"revision_id":{"type":"string","description":"版本 ID（document_revisions.id）"}},"required":["revision_id"]}', 'index.js', now, now],
        ['st-anchor-locator', skillId, 'get_section_locator', '通过 outline_id 反查所属的 document_id 和 revision_id', '{"type":"object","properties":{"outline_id":{"type":"string","description":"章节 ID（document_outlines.id）"}},"required":["outline_id"]}', 'index.js', now, now],
        ['st-anchor-find-code', skillId, 'find_documents_by_standard_code', '按标准编号查找已纳管的标准（查 app_standard 表）', '{"type":"object","properties":{"standard_code":{"type":"string","description":"标准编号，如 GB/T 19001-2016"}},"required":["standard_code"]}', 'index.js', now, now],
        ['st-anchor-find-name', skillId, 'find_documents_by_standard_name', '按标准名称查找已纳管的标准（查 app_standard 表），支持模糊匹配', '{"type":"object","properties":{"standard_name":{"type":"string","description":"标准名称，支持模糊匹配"}},"required":["standard_name"]}', 'index.js', now, now],
        ['st-anchor-get-revs', skillId, 'get_document_revisions', '获取指定文档的所有版本列表', '{"type":"object","properties":{"document_id":{"type":"string","description":"文档 ID（documents.id）"}},"required":["document_id"]}', 'index.js', now, now],
        ['st-anchor-sel-rev', skillId, 'select_revision_candidate', '按版本线索筛选最匹配 revision（纯函数，不发 IO）', '{"type":"object","properties":{"revisions":{"type":"array","items":{"type":"object"},"description":"版本列表（含 revision_label、revision_no）"},"hints":{"type":"object","properties":{"year":{"type":"string","description":"年份线索"},"revision_label":{"type":"string","description":"精确 label 匹配"}}}},"required":["revisions"]}', 'index.js', now, now],
        ['st-anchor-find-sec', skillId, 'find_section_candidates', '按节号/标题查找候选 section（outline）', '{"type":"object","properties":{"document_id":{"type":"string","description":"文档 ID"},"revision_id":{"type":"string","description":"版本 ID（优先于 document_id）"},"title_hint":{"type":"string","description":"章节标题线索"},"seq_hint":{"type":"number","description":"章节序号线索"},"query_text":{"type":"string","description":"语义搜索文本（用于向量召回辅助）"}},"required":[]}', 'index.js', now, now],
        ['st-anchor-list-gap', skillId, 'list_reference_gaps', '列出指定标准中待回填的引用缺口（status=gap）', '{"type":"object","properties":{"standard_id":{"type":"string","description":"标准 ID（app_standard.id）"},"limit":{"type":"number","description":"返回数量上限（默认 100）"},"offset":{"type":"number","description":"偏移量（默认 0）"}},"required":["standard_id"]}', 'index.js', now, now],
        ['st-anchor-write', skillId, 'write_anchor_result', '写入一个引用的完整判断结果（幂等），同时更新带锚点副本和汇总计数', '{"type":"object","properties":{"standard_id":{"type":"string","description":"标准 ID"},"source_revision_id":{"type":"string","description":"来源 revision ID"},"source_outline_id":{"type":"string","description":"来源 outline ID"},"occurrence_index":{"type":"number","description":"同 section 内出现序号（从 0 开始）"},"source_text":{"type":"string","description":"原始引用文本（必须是被引章节原文的逐字连续子串，禁止改写、合并、补字或转述）"},"context_text":{"type":"string","description":"引用上下文"},"ref_type":{"type":"string","enum":["explicit","implicit"],"description":"引用类型"},"status":{"type":"string","enum":["valid","suspected","gap","invalid"],"description":"引用状态"},"source":{"type":"string","enum":["auto","user_confirmed","manual","auto_backfill"],"description":"来源"},"target_document_id":{"type":"string","description":"目标文档 ID"},"target_revision_id":{"type":"string","description":"目标 revision ID"},"target_outline_id":{"type":"string","description":"目标 outline ID"},"candidates_json":{"type":"object","description":"候选列表"},"status_reason":{"type":"string","description":"状态原因"},"anchored_text":{"type":"string","description":"带锚点副本的文本"},"source_text_hash":{"type":"string","description":"来源文本 hash"}},"required":["standard_id","source_revision_id","source_outline_id","occurrence_index","source_text","ref_type","status","source"]}', 'index.js', now, now],
      ];

      for (const t of tools) {
        await conn.execute(
          `INSERT INTO skill_tools (id, skill_id, name, description, parameters, script_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          t
        );
      }
      console.log('  ✓ Re-registered 12 standard-anchor tools with full params');
    }
  },

  // ==================== R5-3：source_text 描述加入"逐字"约束 ====================
  // R4-2 迁移基于 target_outline_id 存在性做 check，第一次运行就写入了旧版 source_text
  // 描述（不含"逐字"），后续编辑代码不会触发重跑。本迁移专门检查 source_text 描述
  // 是否含"逐字"，若不含则就地 UPDATE parameters JSON。
  {
    name: 'add verbatim constraint to write_anchor_result source_text (R5-3)',
    check: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT parameters FROM skill_tools WHERE name = 'write_anchor_result' AND skill_id IN (SELECT id FROM skills WHERE name = 'standard-anchor')"
      );
      if (rows.length === 0) return true; // 无记录，跳过
      try {
        const params = typeof rows[0].parameters === 'string' ? JSON.parse(rows[0].parameters) : rows[0].parameters;
        const desc = params?.properties?.source_text?.description || '';
        return desc.includes('逐字');
      } catch {
        return false; // JSON 解析失败，需要修复
      }
    },
    migrate: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT parameters FROM skill_tools WHERE name = 'write_anchor_result' AND skill_id IN (SELECT id FROM skills WHERE name = 'standard-anchor')"
      );
      if (rows.length === 0) return;

      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const params = typeof rows[0].parameters === 'string' ? JSON.parse(rows[0].parameters) : rows[0].parameters;

      params.properties.source_text.description =
        '原始引用文本（必须是被引章节原文的逐字连续子串，禁止改写、合并、补字或转述）';

      await conn.execute(
        `UPDATE skill_tools
         SET parameters = ?, updated_at = ?
         WHERE name = 'write_anchor_result'
           AND skill_id IN (SELECT id FROM skills WHERE name = 'standard-anchor')`,
        [JSON.stringify(params), now]
      );
      console.log('  ✓ Updated write_anchor_result source_text description → verbatim constraint');
    }
  },

  // ==================== revision_label 唯一性约束 ====================
  // 文档平台版本管理 P0 收敛：为 revision_label 添加 NOT NULL + UNIQUE 约束
  // 审计: audit-round02 §7.2 / audit-round03 §7.1
  {
    name: 'revision_label fill NULL and add UNIQUE constraint',
    check: async (conn) => {
      if (!await hasTable(conn, 'document_revisions')) return true;

      // 检查是否还有 NULL revision_label
      const [nullRows] = await conn.execute(
        `SELECT 1 FROM document_revisions WHERE revision_label IS NULL LIMIT 1`
      );
      if (nullRows.length > 0) return false;

      // 检查唯一索引是否存在
      return await hasIndex(conn, 'document_revisions', 'uk_document_revision_label');
    },
    migrate: async (conn) => {
      console.log('  ⚠ Adding revision_label UNIQUE constraint...');

      // Step 1: 回填 NULL label → 'v{revision_no}'
      const [nullResult] = await conn.execute(
        `UPDATE document_revisions SET revision_label = CONCAT('v', revision_no) WHERE revision_label IS NULL`
      );
      console.log(`    - Filled NULL revision_labels: ${nullResult.affectedRows} rows`);

      // Step 2: 处理重复 label（同一 doc 下 label 相同的情况）
      const [dupRows] = await conn.execute(
        `SELECT id, document_id, revision_label, revision_no
         FROM document_revisions dr1
         WHERE revision_label IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM document_revisions dr2
             WHERE dr2.document_id = dr1.document_id
               AND dr2.revision_label = dr1.revision_label
               AND dr2.id != dr1.id
           )
         ORDER BY document_id, revision_label, revision_no ASC`
      );

      if (dupRows.length > 0) {
        console.log(`    - Found ${dupRows.length} duplicate revision_labels, fixing...`);
        // 对重复项追加后缀，保留 revision_no 较小的原值不变
        // 注意：revision_label 为 VARCHAR(20)，拼接 _dup_{revision_no} 前必须截断原 label，
        // 否则超长 label 会在后续 MODIFY NOT NULL / UNIQUE 索引阶段失败
        const seen = new Map(); // key: `${document_id}:${revision_label}` -> boolean
        const MAX_LABEL_LENGTH = 20;
        for (const row of dupRows) {
          const key = `${row.document_id}:${row.revision_label}`;
          if (seen.has(key)) {
            const suffix = `_dup_${row.revision_no}`;
            const baseLabel = row.revision_label.slice(0, MAX_LABEL_LENGTH - suffix.length);
            const newLabel = `${baseLabel}${suffix}`;
            await conn.execute(
              `UPDATE document_revisions SET revision_label = ? WHERE id = ?`,
              [newLabel, row.id]
            );
            console.log(`      - Renamed ${row.id}: "${row.revision_label}" → "${newLabel}"`);
          } else {
            seen.set(key, true);
          }
        }
      }

      // Step 3: 将 revision_label 改为 NOT NULL
      await safeExecute(conn,
        `ALTER TABLE document_revisions
         MODIFY COLUMN revision_label VARCHAR(20) NOT NULL
         COMMENT '展示版号(v1.0)'`
      );
      console.log('    - Changed revision_label to NOT NULL');

      // Step 4: 添加唯一索引
      await safeExecute(conn,
        `ALTER TABLE document_revisions
         ADD UNIQUE INDEX uk_document_revision_label (document_id, revision_label)`
      );
      console.log('    - Added UNIQUE index uk_document_revision_label');

      console.log('  ✓ revision_label UNIQUE constraint added');
      console.log('  ⚠ IMPORTANT: After this migration, run "node scripts/generate-models.js" to regenerate models/');
      console.log('    This will update models/document_revision.js with allowNull:false and the unique index.');
    }
  },

  // ==================== Legacy Assistant runtime retirement ====================
  {
    name: 'drop legacy assistant tables',
    check: async (conn) => {
      const tables = await Promise.all([
        hasTable(conn, 'assistant_messages'),
        hasTable(conn, 'assistant_requests'),
        hasTable(conn, 'assistants'),
      ]);
      return tables.every(exists => !exists);
    },
    migrate: async (conn) => {
      await conn.execute('DROP TABLE IF EXISTS assistant_messages');
      await conn.execute('DROP TABLE IF EXISTS assistant_requests');
      await conn.execute('DROP TABLE IF EXISTS assistants');
      console.log('  ✓ Dropped legacy assistant tables');
    }
  },

  // ==================== standard-mgr: revision publish_date ====================
  {
    name: 'add publish_date to document_revisions',
    check: async (conn) => await hasColumn(conn, 'document_revisions', 'publish_date'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE document_revisions
          ADD COLUMN publish_date DATE NULL COMMENT '发布日期（标准等文档的正式发布日，用于引用版本判定）'
      `);
      console.log('  ✓ Added publish_date to document_revisions');
    }
  },

  // ==================== standard-mgr: app_enterprise 建表兜底 ====================
  // app_enterprise 建表已归入 app 自治迁移（apps/standard-mgr/migrations/install.js，commit 3f0ebd8）。
  // 此处保留幂等兜底：旧库/备份恢复/半安装场景下表缺失时自动补齐（结构须与 install.js 保持一致），
  // 否则下方 FK 兜底迁移会因引用不存在的表而失败。
  {
    name: 'app_enterprise create table (fallback)',
    check: async (conn) => await hasTable(conn, 'app_enterprise'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS app_enterprise (
          id VARCHAR(32) PRIMARY KEY COMMENT '主键，Utils.newID(32)',
          name VARCHAR(100) NOT NULL COMMENT '企业名称（如：吉利、小鹏、比亚迪）',
          name_en VARCHAR(200) NULL COMMENT '企业英文名',
          description TEXT NULL COMMENT '备注',
          code_prefixes TEXT NULL COMMENT '标准编号前缀（逗号分隔，如 Q-JL,Q-JLY；用于企业标准识别与归属推断）',
          is_active BIT(1) DEFAULT b'1' COMMENT '是否启用',
          created_by VARCHAR(32) NULL COMMENT '创建人 users.id',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_app_enterprise_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业花名册（标准归属）'
      `);
      console.log('  ✓ Created app_enterprise table (fallback)');
    }
  },

  // ==================== standard-mgr: app_standard.enterprise_id FK（兜底） ====================

  {
    name: 'app_standard enterprise FK to app_enterprise',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_standard'
          AND CONSTRAINT_NAME = 'fk_standard_enterprise'
      `);
      return rows.length > 0;
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE app_standard
          ADD CONSTRAINT fk_standard_enterprise
          FOREIGN KEY (enterprise_id) REFERENCES app_enterprise(id)
      `);
      console.log('  ✓ Added FK app_standard.enterprise_id -> app_enterprise.id');
    }
  },

  // ==================== 平台系统账户 ====================
  // system-bot 是所有应用可复用的平台后台任务身份，不属于 standard-mgr。
  // 设为 inactive 可阻止正常登录；随机密码用于避免任何可猜测的登录凭据。
  // 清洗链路只需认证身份，不需要角色，因此不分配 admin/creator/user 角色。
  {
    name: 'create platform system user',
    check: async (conn) => {
      const [rows] = await conn.execute(
        'SELECT 1 FROM users WHERE username = ? LIMIT 1',
        [SYSTEM_USER_USERNAME],
      );
      return rows.length > 0;
    },
    migrate: async (conn) => {
      const randomPassword = crypto.randomBytes(48).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 12);
      await conn.execute(
        `INSERT INTO users (id, username, email, password_hash, nickname, status)
         VALUES (?, ?, NULL, ?, ?, 'inactive')
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [
          Utils.newID(20),
          SYSTEM_USER_USERNAME,
          passwordHash,
          '系统机器人',
        ],
      );
      console.log(`  ✓ Created platform system user: ${SYSTEM_USER_USERNAME}`);
    }
  },

  // ==================== erix-agent TranscriptStore run state ====================
  {
    name: 'llm_kit_run_state table create',
    check: async (conn) => await hasTable(conn, 'llm_kit_run_state'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS llm_kit_run_state (
          run_id VARCHAR(128) NOT NULL,
          state VARCHAR(32) NULL,
          checkpoint JSON NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (run_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('  ✓ Created llm_kit_run_state table');
    }
  },

  // ==================== erix-agent TranscriptStore transcripts ====================
  {
    name: 'llm_kit_transcripts table create',
    check: async (conn) => await hasTable(conn, 'llm_kit_transcripts'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS llm_kit_transcripts (
          run_id VARCHAR(128) NOT NULL,
          round INT NOT NULL,
          ts VARCHAR(32) NOT NULL,
          folded TINYINT(1) NOT NULL DEFAULT 0,
          messages JSON NOT NULL,
          folded_payload JSON NULL,
          topic_id VARCHAR(64) NULL,
          user_id VARCHAR(64) NULL,
          expert_id VARCHAR(64) NULL,
          model_name VARCHAR(128) NULL,
          provider_name VARCHAR(128) NULL,
          \`usage\` JSON NULL,
          latency_ms INT NULL,
          error_info JSON NULL,
          is_deleted TINYINT(1) NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (run_id, round),
          KEY idx_llm_kit_transcripts_topic_id (topic_id),
          KEY idx_llm_kit_transcripts_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('  ✓ Created llm_kit_transcripts table');
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
