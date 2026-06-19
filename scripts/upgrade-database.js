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
    `ALTER TABLE ${tableName} DROP FOREIGN KEY ${constraintName}`
  );
  return true;
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
    check: async (conn) => await hasColumn(conn, 'assistant_requests', 'notification_status'),
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
    check: async (conn) => await hasColumn(conn, 'assistant_requests', 'notification_error'),
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
    check: async (conn) => await hasColumn(conn, 'assistant_requests', 'notification_sent_at'),
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
          created_by VARCHAR(20) DEFAULT NULL COMMENT '上传者ID',
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
    check: async (conn) => await hasTable(conn, 'app_row_handlers'),
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
    check: async (conn) => await hasTable(conn, 'app_state'),
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
          FOREIGN KEY (handler_id) REFERENCES app_row_handlers(id) ON DELETE CASCADE,
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
    check: async (conn) => await hasColumn(conn, 'app_state', 'description'),
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
    name: 'register doc-ocr-pipeline to app_clock_registry',
    check: async (conn) => {
      const [rows] = await conn.execute(
        `SELECT id FROM app_clock_registry WHERE app_id = 'doc-ocr-pipeline'`
      );
      return rows.length > 0;
    },
    migrate: async (conn) => {
      const [miniAppRows] = await conn.execute(
        `SELECT id FROM mini_apps WHERE id = 'doc-ocr-pipeline'`
      );
      if (miniAppRows.length === 0) {
        const ownerId = await getAnyExistingUserId(conn);
        if (!ownerId) {
          throw new Error('Cannot register doc-ocr-pipeline: no user found for mini_apps.owner_id/creator_id');
        }
        await conn.execute(
          `INSERT INTO mini_apps (id, name, description, icon, type, component, fields, views, config, visibility, owner_id, creator_id, sort_order, is_active, revision, created_at, updated_at)
           VALUES ('doc-ocr-pipeline', '文档 OCR 调度器', '统一调度文档平台 OCR submit/sync', '⚙️', 'utility', NULL, '[]', NULL, NULL, 'owner', ?, ?, 0, 1, 1, NOW(), NOW())`,
          [ownerId, ownerId]
        );
      }
      const id = crypto.randomBytes(10).toString('hex').slice(0, 20);
      await conn.execute(
        `INSERT INTO app_clock_registry (id, app_id, tick_script, is_active)
         VALUES (?, 'doc-ocr-pipeline', NULL, 1)`,
        [id]
      );
      console.log('  ✓ Registered doc-ocr-pipeline to app_clock_registry');
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
          row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
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
      await safeExecute(conn, `
        ALTER TABLE app_contract_mgr_v2_rows
        ADD CONSTRAINT fk_app_contract_mgr_v2_rows_row_id
        FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
      `);
      console.log('  ✓ Ensured app_contract_mgr_v2_rows table');
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
      const [states] = await conn.execute(`SELECT id FROM app_state WHERE app_id = 'contract-mgr-v2' LIMIT 1`);
      return states.length > 0;
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

      await conn.execute(`DELETE FROM app_state WHERE app_id = 'contract-mgr-v2'`);
      const states = [
        ['pending_ocr', '等待OCR', '提交OCR任务', 1, 1, 0, 0, 'ocr_submitted', 'ocr_failed'],
        ['ocr_submitted', 'OCR处理中', '检查OCR状态并持久化OCR文本到扩展表', 2, 0, 0, 0, 'pending_filter', 'ocr_failed'],
        ['pending_filter', '等待过滤', 'LLM文本过滤并持久化到扩展表', 3, 0, 0, 0, 'pending_extract', 'filter_failed'],
        ['pending_extract', '等待提取', 'LLM提取结构化字段', 4, 0, 0, 0, 'pending_section', 'extract_failed'],
        ['pending_section', '等待分章', '分析章节结构', 5, 0, 0, 0, 'pending_classify', 'section_failed'],
        ['pending_classify', '等待分类', '做版本归类建议', 6, 0, 0, 0, 'pending_review', 'classify_failed'],
        ['pending_review', '待人工确认', '等待人工确认分类结果', 7, 0, 0, 0, null, null],
        ['ocr_failed', 'OCR失败', 'OCR阶段失败', 90, 0, 1, 1, null, null],
        ['filter_failed', '过滤失败', '文本过滤失败', 91, 0, 1, 1, null, null],
        ['extract_failed', '提取失败', '结构化提取失败', 92, 0, 1, 1, null, null],
        ['section_failed', '分章失败', '章节分析失败', 93, 0, 1, 1, null, null],
        ['classify_failed', '分类失败', '版本建议失败', 94, 0, 1, 1, null, null]
  // 41. contract-mgr-v2 解除 row_id 绑定：content 表加 content_id
  {
    name: 'app_contract_mgr_v2_content add content_id',
    check: async (conn) =>
      await hasColumn(conn, 'app_contract_mgr_v2_content', 'content_id'),
    migrate: async (conn) => {
      await conn.execute(
        `ALTER TABLE app_contract_mgr_v2_content
         ADD COLUMN content_id VARCHAR(32) NOT NULL DEFAULT '' AFTER row_id`
      );
      const [rows] = await conn.execute(
        `SELECT row_id FROM app_contract_mgr_v2_content WHERE content_id = ''`
      );
      for (const row of rows) {
        const newId = crypto.randomUUID().replace(/-/g, '').substring(0, 32);
        await conn.execute(
          `UPDATE app_contract_mgr_v2_content SET content_id = ? WHERE row_id = ?`,
          [newId, row.row_id]
        );
      }
      await conn.execute(
        `ALTER TABLE app_contract_mgr_v2_content
         ADD UNIQUE KEY uk_content_id (content_id)`
      );
      console.log('  ✓ Added content_id to app_contract_mgr_v2_content and populated existing rows');
    },
  },

];
      for (const [name, label, description, sortOrder, isInitial, isTerminal, isError, successNext, failureNext] of states) {
        await conn.execute(
          `INSERT INTO app_state (id, app_id, name, label, description, sort_order, is_initial, is_terminal, is_error, handler_id, success_next_state, failure_next_state)
           VALUES (?, 'contract-mgr-v2', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          [crypto.randomBytes(10).toString('hex').slice(0, 20), name, label, description, sortOrder, isInitial, isTerminal, isError, successNext, failureNext]
        );
      }

      console.log('  ✓ Ensured contract-mgr-v2 installation metadata/states');
    }
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
      const [rows] = await conn.execute(`
        SELECT COUNT(*) AS cnt FROM attachments WHERE access_level = 'public'
      `);
      return rows[0].cnt > 0;
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

  // 40. current-feature-analyzer 规则集持久化表
  {
    name: 'app_current_feature_rule_sets & app_current_feature_rule_stages tables',
    check: async (conn) =>
      await hasTable(conn, 'app_current_feature_rule_sets') &&
      await hasTable(conn, 'app_current_feature_rule_stages'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE app_current_feature_rule_sets (
          id VARCHAR(32) NOT NULL COMMENT '主键ID，使用 Utils.newID()',
          rule_set_name VARCHAR(128) NOT NULL COMMENT '规则集名称',
          description TEXT NULL COMMENT '规则集描述',
          business_context TEXT NULL COMMENT '业务背景说明',
          prompt_template LONGTEXT NOT NULL COMMENT '阶段识别 Prompt 模板',
          output_json_schema LONGTEXT NULL COMMENT '期望输出 JSON Schema 文本',
          llm_instructions LONGTEXT NULL COMMENT '对 LLM 的额外约束说明',
          is_default BIT(1) NOT NULL DEFAULT b'0' COMMENT '是否默认规则集',
          is_enabled BIT(1) NOT NULL DEFAULT b'1' COMMENT '是否启用',
          created_by VARCHAR(32) NULL COMMENT '创建人ID',
          updated_by VARCHAR(32) NULL COMMENT '更新人ID',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          PRIMARY KEY (id),
          KEY idx_app_current_feature_rule_sets_default (is_default),
          KEY idx_app_current_feature_rule_sets_enabled (is_enabled)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='电流采样特征分析-规则集主表'
      `);
      console.log('  ✓ Created app_current_feature_rule_sets table');

      await conn.execute(`
        CREATE TABLE app_current_feature_rule_stages (
          id VARCHAR(32) NOT NULL COMMENT '主键ID，使用 Utils.newID()',
          rule_set_id VARCHAR(32) NOT NULL COMMENT '所属规则集ID',
          stage_code VARCHAR(64) NOT NULL COMMENT '阶段编码',
          stage_name VARCHAR(128) NOT NULL COMMENT '阶段名称',
          stage_order INT NOT NULL COMMENT '阶段顺序',
          semantic_definition TEXT NOT NULL COMMENT '语义定义',
          expected_signal_features LONGTEXT NULL COMMENT '期望信号特征，可为 JSON 文本',
          required BIT(1) NOT NULL DEFAULT b'1' COMMENT '是否必选阶段',
          allow_repeat BIT(1) NOT NULL DEFAULT b'0' COMMENT '是否允许重复',
          allow_overlap BIT(1) NOT NULL DEFAULT b'0' COMMENT '是否允许与其他阶段重叠',
          min_duration_ms INT NULL COMMENT '最小时长毫秒',
          max_duration_ms INT NULL COMMENT '最大时长毫秒',
          notes TEXT NULL COMMENT '备注',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          PRIMARY KEY (id),
          KEY idx_app_current_feature_rule_stages_rule_set_id (rule_set_id),
          KEY idx_app_current_feature_rule_stages_stage_order (rule_set_id, stage_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='电流采样特征分析-规则集阶段定义表'
      `);
      console.log('  ✓ Created app_current_feature_rule_stages table');
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
