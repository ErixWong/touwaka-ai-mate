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
        "SELECT COUNT(*) as cnt FROM system_settings WHERE setting_key = 'app_market.registry_url'"
      );
      return rows[0].cnt > 0;
    },
    migrate: async (conn) => {
      await conn.execute(`
        INSERT INTO system_settings (setting_key, setting_value, value_type, description) VALUES
        ('app_market.registry_url', 'https://raw.githubusercontent.com/ErixWong/touwaka-ai-mate/main/apps', 'string', 'App Market Registry URL'),
        ('app_market.registry_branch', 'main', 'string', 'Registry 分支'),
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
    check: async (conn) => await hasColumn(conn, 'app_contract_mgr_content', 'sections'),
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
    check: async (conn) => await hasColumn(conn, 'app_contract_mgr_rows', 'party_b'),
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