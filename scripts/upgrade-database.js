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
 */
const MIGRATIONS = [
  // ==================== 基础表结构 ====================
  
  // 1. ai_models.model_type
  {
    name: 'ai_models.model_type',
    check: async (conn) => await hasColumn(conn, 'ai_models', 'model_type'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE ai_models
        ADD COLUMN model_type ENUM('text', 'multimodal', 'embedding') DEFAULT 'text'
        COMMENT '模型类型: text=文本, multimodal=多模态, embedding=向量化'
        AFTER model_name
      `);
      await safeExecute(conn, `CREATE INDEX idx_model_type ON ai_models(model_type)`);
    }
  },

  // 2. ai_models.embedding_dim (用于向量化模型)
  {
    name: 'ai_models.embedding_dim',
    check: async (conn) => await hasColumn(conn, 'ai_models', 'embedding_dim'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE ai_models
        ADD COLUMN embedding_dim INT NULL
        COMMENT '向量化模型的嵌入维度（仅 embedding 类型模型使用）'
        AFTER max_tokens
      `);
    }
  },

  // 3. experts.knowledge_config
  {
    name: 'experts.knowledge_config',
    check: async (conn) => await hasColumn(conn, 'experts', 'knowledge_config'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE experts
        ADD COLUMN knowledge_config TEXT COMMENT '知识库配置（JSON格式）：{enabled, kb_id, top_k, threshold, max_tokens, style}'
        AFTER presence_penalty
      `);
    }
  },

  // 4. experts.max_tool_rounds
  {
    name: 'experts.max_tool_rounds',
    check: async (conn) => await hasColumn(conn, 'experts', 'max_tool_rounds'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE experts
        ADD COLUMN max_tool_rounds INT DEFAULT NULL
        COMMENT '最大工具调用轮数（NULL表示使用系统默认，范围 1-50）'
      `);
    }
  },

  // 5. experts.context_threshold (上下文压缩阈值)
  {
    name: 'experts.context_threshold',
    check: async (conn) => await hasColumn(conn, 'experts', 'context_threshold'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE experts
        ADD COLUMN context_threshold INT DEFAULT 4000 COMMENT '上下文压缩阈值'
        AFTER knowledge_config
      `);
    }
  },

  // 6. messages.content -> LONGTEXT
  {
    name: 'messages.content LONGTEXT',
    check: async (conn) => {
      const columnType = await getColumnType(conn, 'messages', 'content');
      return columnType === 'longtext';
    },
    migrate: async (conn) => {
      await conn.execute(`ALTER TABLE messages MODIFY COLUMN content LONGTEXT NOT NULL`);
    }
  },

  // 7. messages.prompt_tokens 字段
  {
    name: 'messages.prompt_tokens',
    check: async (conn) => await hasColumn(conn, 'messages', 'prompt_tokens'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE messages
        ADD COLUMN prompt_tokens INT DEFAULT 0 COMMENT '输入 token 数量'
      `);
    }
  },

  // 8. messages.completion_tokens 字段
  {
    name: 'messages.completion_tokens',
    check: async (conn) => await hasColumn(conn, 'messages', 'completion_tokens'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE messages
        ADD COLUMN completion_tokens INT DEFAULT 0 COMMENT '输出 token 数量'
      `);
    }
  },

  // ==================== 知识库表 ====================
  
  // 9. knowledge_bases 表
  {
    name: 'knowledge_bases table',
    check: async (conn) => await hasTable(conn, 'knowledge_bases'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS knowledge_bases (
          id VARCHAR(20) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          owner_id VARCHAR(32) NOT NULL,
          embedding_model_id VARCHAR(50) COMMENT '关联 ai_models 表',
          embedding_dim INT DEFAULT 1536,
          is_public BOOLEAN DEFAULT FALSE COMMENT '预留，暂不使用',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_kb_owner (owner_id),
          INDEX idx_kb_public (is_public)
        ) COMMENT='知识库表'
      `);
    }
  },

  // 10. knowledge_bases 外键 owner_id -> users
  {
    name: 'knowledge_bases.fk_owner_id',
    check: async (conn) => await hasForeignKey(conn, 'knowledge_bases', 'fk_kb_owner'),
    migrate: async (conn) => {
      await safeExecute(conn, `
        ALTER TABLE knowledge_bases
        ADD CONSTRAINT fk_kb_owner
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      `);
    }
  },

  // 11. knowledge_bases 外键 embedding_model_id -> ai_models
  {
    name: 'knowledge_bases.fk_embedding_model_id',
    check: async (conn) => await hasForeignKey(conn, 'knowledge_bases', 'fk_kb_embedding_model'),
    migrate: async (conn) => {
      await safeExecute(conn, `
        ALTER TABLE knowledge_bases
        ADD CONSTRAINT fk_kb_embedding_model
        FOREIGN KEY (embedding_model_id) REFERENCES ai_models(id) ON DELETE SET NULL
      `);
    }
  },

  // 12. knowledges 表
  {
    name: 'knowledges table',
    check: async (conn) => await hasTable(conn, 'knowledges'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS knowledges (
          id VARCHAR(20) PRIMARY KEY,
          kb_id VARCHAR(20) NOT NULL,
          parent_id VARCHAR(20) DEFAULT NULL COMMENT '自关联，形成树状结构',
          title VARCHAR(500) NOT NULL,
          summary TEXT COMMENT 'LLM 生成的摘要',
          source_type ENUM('file', 'web', 'manual') DEFAULT 'manual',
          source_url VARCHAR(1000),
          file_path VARCHAR(500) COMMENT '原始文件存储路径',
          status ENUM('pending', 'processing', 'ready', 'failed') DEFAULT 'pending',
          position INT DEFAULT 0 COMMENT '同级排序',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
          FOREIGN KEY (parent_id) REFERENCES knowledges(id) ON DELETE CASCADE,
          INDEX idx_knowledge_kb (kb_id),
          INDEX idx_knowledge_parent (parent_id),
          INDEX idx_knowledge_status (status)
        ) COMMENT='文章表（树状结构）'
      `);
    }
  },

  // 13. knowledge_points 表
  {
    name: 'knowledge_points table',
    check: async (conn) => await hasTable(conn, 'knowledge_points'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS knowledge_points (
          id VARCHAR(20) PRIMARY KEY,
          knowledge_id VARCHAR(20) NOT NULL,
          title VARCHAR(500),
          content MEDIUMTEXT NOT NULL COMMENT 'Markdown 格式',
          context TEXT COMMENT '上下文信息（用于向量化）',
          embedding VECTOR(1024) COMMENT '向量（1024维）',
          position INT DEFAULT 0,
          token_count INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (knowledge_id) REFERENCES knowledges(id) ON DELETE CASCADE,
          INDEX idx_kp_knowledge (knowledge_id)
        ) COMMENT='知识点表'
      `);
    }
  },

  // 14. knowledge_relations 表
  {
    name: 'knowledge_relations table',
    check: async (conn) => await hasTable(conn, 'knowledge_relations'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS knowledge_relations (
          id VARCHAR(20) PRIMARY KEY,
          source_id VARCHAR(20) NOT NULL,
          target_id VARCHAR(20) NOT NULL,
          relation_type ENUM('depends_on', 'references', 'related_to', 'contradicts', 'extends', 'example_of') NOT NULL,
          confidence DECIMAL(3,2) DEFAULT 1.00 COMMENT 'LLM 置信度 (0-1)',
          created_by ENUM('llm', 'manual') DEFAULT 'llm',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
          UNIQUE KEY unique_relation (source_id, target_id, relation_type),
          INDEX idx_kr_source (source_id),
          INDEX idx_kr_target (target_id),
          INDEX idx_kr_type (relation_type)
        ) COMMENT='知识点关联表'
      `);
    }
  },

  // ==================== 新知识库表结构 (KB Refactor) ====================
  
  // 15. kb_articles 表
  {
    name: 'kb_articles table',
    check: async (conn) => await hasTable(conn, 'kb_articles'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS kb_articles (
          id VARCHAR(20) PRIMARY KEY,
          kb_id VARCHAR(20) NOT NULL COMMENT '所属知识库',
          title VARCHAR(500) NOT NULL COMMENT '文章标题',
          summary TEXT COMMENT '文章摘要',
          source_type ENUM('upload', 'url', 'manual') DEFAULT 'manual' COMMENT '来源类型',
          source_url VARCHAR(1000) COMMENT '来源URL',
          file_path VARCHAR(500) COMMENT '本地文件路径',
          status ENUM('pending', 'processing', 'ready', 'error') DEFAULT 'pending' COMMENT '状态',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
          INDEX idx_article_kb (kb_id),
          INDEX idx_article_status (status)
        ) COMMENT='文章表'
      `);
    }
  },

  // 16. kb_sections 表
  {
    name: 'kb_sections table',
    check: async (conn) => await hasTable(conn, 'kb_sections'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS kb_sections (
          id VARCHAR(20) PRIMARY KEY,
          article_id VARCHAR(20) NOT NULL COMMENT '所属文章',
          parent_id VARCHAR(20) DEFAULT NULL COMMENT '父节ID（自指向，形成无限层级）',
          title VARCHAR(500) NOT NULL COMMENT '节标题',
          level INT DEFAULT 1 COMMENT '层级深度（1=章, 2=节, 3=小节...）',
          position INT DEFAULT 0 COMMENT '排序位置（同级内的顺序）',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE,
          FOREIGN KEY (parent_id) REFERENCES kb_sections(id) ON DELETE CASCADE,
          INDEX idx_section_article (article_id),
          INDEX idx_section_parent (parent_id),
          INDEX idx_section_level (level),
          INDEX idx_section_position (position)
        ) COMMENT='节表（无限层级）'
      `);
    }
  },

  // 17. kb_paragraphs 表
  {
    name: 'kb_paragraphs table',
    check: async (conn) => await hasTable(conn, 'kb_paragraphs'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS kb_paragraphs (
          id VARCHAR(20) PRIMARY KEY,
          section_id VARCHAR(20) NOT NULL COMMENT '所属节',
          title VARCHAR(500) COMMENT '段落标题（可选）',
          content TEXT NOT NULL COMMENT '段落内容',
          is_knowledge_point BOOLEAN DEFAULT FALSE COMMENT '是否是知识点',
          embedding VECTOR(384) COMMENT '向量（只有知识点才向量化）',
          position INT DEFAULT 0 COMMENT '排序位置（同一节内的顺序）',
          token_count INT DEFAULT 0 COMMENT 'Token 数量',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (section_id) REFERENCES kb_sections(id) ON DELETE CASCADE,
          INDEX idx_paragraph_section (section_id),
          INDEX idx_paragraph_kp (is_knowledge_point),
          INDEX idx_paragraph_position (position)
        ) COMMENT='段表'
      `);
    }
  },

  // 18. kb_tags 表
  {
    name: 'kb_tags table',
    check: async (conn) => await hasTable(conn, 'kb_tags'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS kb_tags (
          id VARCHAR(20) PRIMARY KEY,
          kb_id VARCHAR(20) NOT NULL COMMENT '所属知识库',
          name VARCHAR(100) NOT NULL COMMENT '标签名',
          description VARCHAR(500) COMMENT '标签描述',
          article_count INT DEFAULT 0 COMMENT '关联文章数（缓存）',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
          UNIQUE KEY uk_kb_tag (kb_id, name),
          INDEX idx_tag_kb (kb_id)
        ) COMMENT='标签表'
      `);
    }
  },

  // 19. kb_article_tags 表
  {
    name: 'kb_article_tags table',
    check: async (conn) => await hasTable(conn, 'kb_article_tags'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS kb_article_tags (
          id VARCHAR(20) PRIMARY KEY,
          article_id VARCHAR(20) NOT NULL COMMENT '文章ID',
          tag_id VARCHAR(20) NOT NULL COMMENT '标签ID',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES kb_tags(id) ON DELETE CASCADE,
          UNIQUE KEY uk_article_tag (article_id, tag_id),
          INDEX idx_at_article (article_id),
          INDEX idx_at_tag (tag_id)
        ) COMMENT='文章-标签关联表'
      `);
    }
  },

  // ==================== 系统设置表 ====================
  
  // 20. system_settings 表
  {
    name: 'system_settings table',
    check: async (conn) => await hasTable(conn, 'system_settings'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS system_settings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          setting_key VARCHAR(100) UNIQUE NOT NULL,
          setting_value TEXT NOT NULL,
          value_type VARCHAR(20) DEFAULT 'string',
          description VARCHAR(500),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      
      // 插入默认配置数据
      const defaultSettings = [
        { key: 'llm.context_threshold', value: '0.70', type: 'number', desc: '上下文压缩阈值' },
        { key: 'llm.temperature', value: '0.70', type: 'number', desc: '表达温度默认值' },
        { key: 'llm.reflective_temperature', value: '0.30', type: 'number', desc: '反思温度默认值' },
        { key: 'llm.top_p', value: '1.0', type: 'number', desc: 'Top-p 采样默认值' },
        { key: 'llm.frequency_penalty', value: '0.0', type: 'number', desc: '频率惩罚默认值' },
        { key: 'llm.presence_penalty', value: '0.0', type: 'number', desc: '存在惩罚默认值' },
        { key: 'llm.max_tokens', value: '4096', type: 'number', desc: '最大 Token 默认值' },
        { key: 'connection.max_per_user', value: '5', type: 'number', desc: '每用户最大 SSE 连接数' },
        { key: 'connection.max_per_expert', value: '100', type: 'number', desc: '每 Expert 最大 SSE 连接数' },
        { key: 'token.access_expiry', value: '15m', type: 'string', desc: 'Access Token 过期时间' },
        { key: 'token.refresh_expiry', value: '7d', type: 'string', desc: 'Refresh Token 过期时间' },
        { key: 'pagination.default_size', value: '20', type: 'number', desc: '默认分页大小' },
        { key: 'pagination.max_size', value: '100', type: 'number', desc: '最大分页大小' },
      ];
      
      for (const setting of defaultSettings) {
        await conn.execute(
          `INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description)
           VALUES (?, ?, ?, ?)`,
          [setting.key, setting.value, setting.type, setting.desc]
        );
      }
    }
  },

  // ==================== 任务表 ====================
  
  // 21. tasks 表
  {
    name: 'tasks table',
    check: async (conn) => await hasTable(conn, 'tasks'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS tasks (
          id VARCHAR(32) PRIMARY KEY,
          task_id VARCHAR(50) UNIQUE NOT NULL COMMENT '任务ID (12位随机字符)',
          title VARCHAR(200) NOT NULL COMMENT '任务标题',
          description TEXT COMMENT '任务描述',
          workspace_path VARCHAR(500) NOT NULL COMMENT '工作目录路径（相对路径）',
          status ENUM('active', 'archived', 'deleted') DEFAULT 'active',
          created_by VARCHAR(32) NOT NULL COMMENT '创建者 user_id',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_task_id (task_id),
          INDEX idx_user (created_by),
          INDEX idx_status (status)
        ) COMMENT='任务工作空间表'
      `);
    }
  },

  // 22. topics.task_id 字段
  {
    name: 'topics.task_id column',
    check: async (conn) => await hasColumn(conn, 'topics', 'task_id'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE topics ADD COLUMN task_id VARCHAR(32) COMMENT '关联任务ID' AFTER expert_id
      `);
      await safeExecute(conn, `ALTER TABLE topics ADD INDEX idx_task (task_id)`);
      await safeExecute(conn, `
        ALTER TABLE topics ADD CONSTRAINT fk_topic_task 
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
      `);
    }
  },

  // ==================== 助理系统表 ====================
  
  // 23. assistants 表
  {
    name: 'assistants table',
    check: async (conn) => await hasTable(conn, 'assistants'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS assistants (
          assistant_type VARCHAR(32) PRIMARY KEY,
          name VARCHAR(128) NOT NULL COMMENT '显示名称',
          icon VARCHAR(32) COMMENT '图标',
          description TEXT COMMENT '能力描述',
          model_id VARCHAR(32) COMMENT '关联 ai_models.id',
          prompt_template TEXT COMMENT '系统提示词模板',
          max_tokens INT DEFAULT 4096,
          temperature DECIMAL(3,2) DEFAULT 0.7,
          estimated_time INT DEFAULT 30 COMMENT '预估执行时间（秒）',
          timeout INT DEFAULT 120 COMMENT '超时时间（秒）',
          tool_name VARCHAR(64) COMMENT '工具名称，如 ocr_analyze',
          tool_description TEXT COMMENT '工具描述',
          tool_parameters JSON COMMENT 'JSON Schema 格式的参数定义',
          can_use_skills BIT(1) DEFAULT b'0' COMMENT '是否允许助理调用技能',
          execution_mode ENUM('direct', 'llm') DEFAULT 'llm' COMMENT '执行模式',
          is_active BIT(1) DEFAULT b'1' COMMENT '是否启用',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_assistant_active (is_active),
          INDEX idx_assistant_mode (execution_mode)
        ) COMMENT='助理配置表'
      `);
    }
  },

  // 23.1 assistants.is_builtin 字段
  {
    name: 'assistants.is_builtin',
    check: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assistants' AND COLUMN_NAME = 'is_builtin'"
      );
      return rows.length > 0;
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE assistants ADD COLUMN is_builtin BIT(1) DEFAULT b'0' COMMENT '是否为内置助理（不可删除）' AFTER is_active
      `);
    }
  },

  // 24. assistant_requests 表
  {
    name: 'assistant_requests table',
    check: async (conn) => await hasTable(conn, 'assistant_requests'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS assistant_requests (
          request_id VARCHAR(64) PRIMARY KEY,
          assistant_type VARCHAR(32) NOT NULL,
          expert_id VARCHAR(32) COMMENT '调用专家ID',
          contact_id VARCHAR(64) COMMENT '联系人ID',
          user_id VARCHAR(32) COMMENT '用户ID',
          topic_id VARCHAR(32) COMMENT '话题ID',
          status ENUM('pending', 'running', 'completed', 'failed', 'timeout', 'cancelled') DEFAULT 'pending',
          input JSON NOT NULL COMMENT '输入参数',
          result LONGTEXT COMMENT '执行结果',
          error_message TEXT COMMENT '错误信息',
          tokens_input INT DEFAULT 0 COMMENT '输入 Token 数',
          tokens_output INT DEFAULT 0 COMMENT '输出 Token 数',
          model_used VARCHAR(128) COMMENT '实际使用的模型',
          latency_ms INT DEFAULT 0 COMMENT '执行耗时（毫秒）',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME COMMENT '开始执行时间',
          completed_at DATETIME COMMENT '完成时间',
          is_archived BIT(1) DEFAULT b'0' COMMENT '是否已归档',
          INDEX idx_request_expert (expert_id),
          INDEX idx_request_user (user_id),
          INDEX idx_request_status (status),
          INDEX idx_request_created (created_at)
        ) COMMENT='助理委托记录表'
      `);
    }
  },

  // 24.1 assistant_requests.is_archived 字段（兼容旧表）
  {
    name: 'assistant_requests.is_archived',
    check: async (conn) => {
      const [rows] = await conn.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assistant_requests' AND COLUMN_NAME = 'is_archived'"
      );
      return rows.length > 0;
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE assistant_requests ADD COLUMN is_archived BIT(1) DEFAULT b'0' COMMENT '是否已归档' AFTER completed_at
      `);
    }
  },

  // 25. assistant_messages 表
  {
    name: 'assistant_messages table',
    check: async (conn) => await hasTable(conn, 'assistant_messages'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS assistant_messages (
          id BIGINT NOT NULL AUTO_INCREMENT,
          request_id VARCHAR(64) NOT NULL COMMENT '关联 assistant_requests.request_id',
          parent_message_id VARCHAR(64) DEFAULT NULL COMMENT '父消息 ID，用于树状结构',
          role ENUM('expert', 'assistant', 'tool', 'system') NOT NULL COMMENT '消息角色',
          message_type ENUM(
            'task', 'context', 'assistant_response', 'tool_call', 'tool_result',
            'final', 'error', 'retry', 'status', 'note'
          ) NOT NULL COMMENT '消息类型',
          content LONGTEXT DEFAULT NULL COMMENT '文本内容',
          content_preview VARCHAR(512) DEFAULT NULL COMMENT '摘要，用于列表展示',
          tool_name VARCHAR(128) DEFAULT NULL COMMENT '工具名称',
          tool_call_id VARCHAR(64) DEFAULT NULL COMMENT '工具调用链路 ID',
          status ENUM('pending', 'running', 'completed', 'failed', 'skipped') DEFAULT NULL COMMENT '消息状态',
          sequence_no INT NOT NULL COMMENT '同一 request 内顺序号',
          metadata JSON DEFAULT NULL COMMENT '扩展字段',
          tokens_input INT DEFAULT NULL COMMENT '本条消息相关输入 token',
          tokens_output INT DEFAULT NULL COMMENT '本条消息相关输出 token',
          latency_ms INT DEFAULT NULL COMMENT '本步骤耗时',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          PRIMARY KEY (id),
          KEY idx_request_id (request_id),
          KEY idx_request_seq (request_id, sequence_no),
          KEY idx_tool_call_id (tool_call_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='助理内部消息表'
      `);
    }
  },

  // ==================== 组织架构表 ====================
  
  // 26. departments 表
  {
    name: 'departments table',
    check: async (conn) => await hasTable(conn, 'departments'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS departments (
          id VARCHAR(20) PRIMARY KEY,
          name VARCHAR(100) NOT NULL COMMENT '部门名称',
          parent_id VARCHAR(20) NULL COMMENT '父部门ID',
          path VARCHAR(255) NULL COMMENT '层级路径，如 /1/2/3',
          level INT DEFAULT 1 COMMENT '层级深度(1-4)',
          sort_order INT DEFAULT 0 COMMENT '同级排序',
          description TEXT NULL COMMENT '部门描述',
          status ENUM('active', 'inactive') DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_parent (parent_id),
          INDEX idx_path (path),
          INDEX idx_status (status),
          UNIQUE INDEX uk_path (path)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表'
      `);
    }
  },

  // 27. positions 表
  {
    name: 'positions table',
    check: async (conn) => await hasTable(conn, 'positions'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS positions (
          id VARCHAR(20) PRIMARY KEY,
          name VARCHAR(100) NOT NULL COMMENT '职位名称',
          department_id VARCHAR(20) NOT NULL COMMENT '所属部门',
          is_manager BOOLEAN DEFAULT FALSE COMMENT '是否为负责人职位',
          sort_order INT DEFAULT 0 COMMENT '排序',
          description TEXT NULL COMMENT '职位描述',
          status ENUM('active', 'inactive') DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_department (department_id),
          INDEX idx_status (status),
          CONSTRAINT fk_position_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='职位表'
      `);
    }
  },

  // 28. users.department_id 字段
  {
    name: 'users.department_id column',
    check: async (conn) => await hasColumn(conn, 'users', 'department_id'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE users 
        ADD COLUMN department_id VARCHAR(20) NULL COMMENT '所属部门' AFTER status
      `);
      await safeExecute(conn, `ALTER TABLE users ADD INDEX idx_department (department_id)`);
      await safeExecute(conn, `
        ALTER TABLE users ADD CONSTRAINT fk_user_department 
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
      `);
    }
  },

  // 29. users.position_id 字段
  {
    name: 'users.position_id column',
    check: async (conn) => await hasColumn(conn, 'users', 'position_id'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE users 
        ADD COLUMN position_id VARCHAR(20) NULL COMMENT '职位ID' AFTER department_id
      `);
      await safeExecute(conn, `ALTER TABLE users ADD INDEX idx_position (position_id)`);
      await safeExecute(conn, `
        ALTER TABLE users ADD CONSTRAINT fk_user_position 
        FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL
      `);
    }
  },

  // ==================== 技能表扩展 ====================
  
  // 30. skills 扩展字段 (license, argument_hint, etc.)
  {
    name: 'skills extended fields',
    check: async (conn) => await hasColumn(conn, 'skills', 'license'),
    migrate: async (conn) => {
      await conn.execute(`ALTER TABLE skills ADD COLUMN license TEXT COMMENT '许可证信息'`);
      await conn.execute(`ALTER TABLE skills ADD COLUMN argument_hint VARCHAR(128) DEFAULT '' COMMENT '参数提示'`);
      await conn.execute(`ALTER TABLE skills ADD COLUMN disable_model_invocation BIT(1) DEFAULT b'0' COMMENT '禁用模型调用'`);
      await conn.execute(`ALTER TABLE skills ADD COLUMN user_invocable BIT(1) DEFAULT b'1' COMMENT '用户可调用'`);
      await conn.execute(`ALTER TABLE skills ADD COLUMN allowed_tools TEXT COMMENT '允许的工具列表（JSON数组）'`);
    }
  },

  // 31. skills.source_type ENUM 扩展
  {
    name: 'skills.source_type enum extension',
    check: async (conn) => {
      // 检查 source_type 是否支持所有值
      try {
        const [rows] = await conn.execute(`
          SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'skills' AND COLUMN_NAME = 'source_type'
        `, [DB_CONFIG.database]);
        if (rows.length > 0) {
          const type = rows[0].COLUMN_TYPE;
          return type.includes('filesystem') && type.includes('database');
        }
      } catch (e) {}
      return false;
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE skills 
        MODIFY COLUMN source_type ENUM('database','filesystem','url','zip','local') 
        NULL DEFAULT 'filesystem'
      `);
    }
  },

  // 32. skill_tools.is_resident 字段
  {
    name: 'skill_tools.is_resident column',
    check: async (conn) => await hasColumn(conn, 'skill_tools', 'is_resident'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE skill_tools 
        ADD COLUMN is_resident BIT(1) DEFAULT b'0' 
        COMMENT '是否驻留进程：0=普通工具（执行后返回），1=驻留工具（持续运行，stdio通信）'
        AFTER script_path
      `);
    }
  },

  // 33. skill_tools.script_path 字段
  {
    name: 'skill_tools.script_path column',
    check: async (conn) => await hasColumn(conn, 'skill_tools', 'script_path'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE skill_tools
        ADD COLUMN script_path VARCHAR(255) DEFAULT 'index.js'
        COMMENT '工具入口脚本路径（相对于技能目录）'
        AFTER parameters
      `);
    }
  },

  // 34. skill_parameters 表（技能参数配置）
  {
    name: 'skill_parameters table',
    check: async (conn) => await hasTable(conn, 'skill_parameters'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS skill_parameters (
          id VARCHAR(32) PRIMARY KEY,
          skill_id VARCHAR(64) NOT NULL COMMENT '技能ID',
          param_name VARCHAR(64) NOT NULL COMMENT '参数名（如 api_key, base_url）',
          param_value TEXT COMMENT '参数值',
          is_secret BIT(1) DEFAULT b'0' COMMENT '是否敏感参数（前端显示/隐藏）',
          description VARCHAR(500) COMMENT '参数描述',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_skill_param (skill_id, param_name),
          INDEX idx_skill_id (skill_id),
          FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
        ) COMMENT='技能参数表'
      `);
    }
  },

  // 35. skill_parameters.description 字段（为旧表添加）
  {
    name: 'skill_parameters.description column',
    check: async (conn) => await hasColumn(conn, 'skill_parameters', 'description'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE skill_parameters
        ADD COLUMN description VARCHAR(500) COMMENT '参数描述'
        AFTER is_secret
      `);
    }
  },

  // ==================== 角色表扩展 ====================
  
  // 36. roles.level 字段
  {
    name: 'roles.level column',
    check: async (conn) => await hasColumn(conn, 'roles', 'level'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE roles
        ADD COLUMN level ENUM('user', 'power_user', 'admin')
        DEFAULT 'user'
        COMMENT '角色权限等级，用于技能访问控制：user(基础)/power_user(中等)/admin(最高)'
      `);
      await safeExecute(conn, `CREATE INDEX idx_level ON roles(level)`);

      // 检查 mark 字段是否存在，如果存在则更新 level 值
      const hasMark = await hasColumn(conn, 'roles', 'mark');
      if (hasMark) {
        await conn.execute(`UPDATE roles SET level = 'admin' WHERE mark = 'admin' OR name = 'admin'`);
        await conn.execute(`UPDATE roles SET level = 'power_user' WHERE mark = 'creator' OR name = 'creator'`);
        await conn.execute(`UPDATE roles SET level = 'user' WHERE mark = 'user' OR name = 'user'`);
      }
    }
  },

  // 37. roles 表字段重命名 (name -> mark, label -> name)
  {
    name: 'roles field rename',
    check: async (conn) => await hasColumn(conn, 'roles', 'mark'),
    migrate: async (conn) => {
      // 重命名 name → mark
      await conn.execute(`
        ALTER TABLE roles CHANGE COLUMN name mark VARCHAR(50) NOT NULL COMMENT '角色标识（不可编辑）：admin/creator/user'
      `);
      // 重命名 label → name
      await conn.execute(`
        ALTER TABLE roles CHANGE COLUMN label name VARCHAR(100) NOT NULL COMMENT '角色显示名称'
      `);
      // 删除旧索引
      await safeExecute(conn, `ALTER TABLE roles DROP INDEX name`);
      // 创建新索引
      await safeExecute(conn, `ALTER TABLE roles ADD UNIQUE INDEX mark (mark)`);
      // 删除 idx_name 索引（如果存在）
      await safeExecute(conn, `ALTER TABLE roles DROP INDEX idx_name`);
    }
  },

  // ==================== 数据库设计修复 ====================
  
  // 38. 修复 kb_article_tags 表主键结构
  // 问题：有独立 id 主键，应该是复合主键 (article_id, tag_id)
  // 原因：sequelize-auto 只能为复合主键的中间表生成 belongsToMany 关联
  {
    name: 'kb_article_tags composite primary key fix',
    check: async (conn) => {
      // 检查是否有 id 字段，如果有说明需要修复
      const [rows] = await conn.execute(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kb_article_tags' AND COLUMN_NAME = 'id'
      `, [DB_CONFIG.database]);
      return rows.length === 0; // 没有 id 字段说明已修复
    },
    migrate: async (conn) => {
      // 1. 备份数据到临时表
      await conn.execute(`CREATE TABLE IF NOT EXISTS kb_article_tags_backup AS SELECT * FROM kb_article_tags`);
      
      // 2. 删除旧表
      await conn.execute(`DROP TABLE IF EXISTS kb_article_tags`);
      
      // 3. 创建新表（复合主键，无 id 字段）
      await conn.execute(`
        CREATE TABLE kb_article_tags (
          article_id VARCHAR(20) NOT NULL COMMENT '文章ID',
          tag_id VARCHAR(20) NOT NULL COMMENT '标签ID',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (article_id, tag_id),
          FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES kb_tags(id) ON DELETE CASCADE,
          INDEX idx_at_article (article_id),
          INDEX idx_at_tag (tag_id)
        ) COMMENT='文章-标签关联表'
      `);
      
      // 4. 恢复数据
      await conn.execute(`
        INSERT IGNORE INTO kb_article_tags (article_id, tag_id, created_at)
        SELECT article_id, tag_id, created_at FROM kb_article_tags_backup
      `);
      
      // 5. 删除备份表
      await conn.execute(`DROP TABLE IF EXISTS kb_article_tags_backup`);
    }
  },

  // 37. 同样修复 expert_skills 表
  {
    name: 'expert_skills composite primary key fix',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'expert_skills' AND COLUMN_NAME = 'id'
      `, [DB_CONFIG.database]);
      return rows.length === 0;
    },
    migrate: async (conn) => {
      // 备份数据
      await conn.execute(`CREATE TABLE IF NOT EXISTS expert_skills_backup AS SELECT * FROM expert_skills`);
      
      // 删除旧表
      await conn.execute(`DROP TABLE IF EXISTS expert_skills`);
      
      // 创建新表
      await conn.execute(`
        CREATE TABLE expert_skills (
          expert_id VARCHAR(32) NOT NULL COMMENT '专家ID',
          skill_id VARCHAR(32) NOT NULL COMMENT '技能ID',
          is_enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用',
          config TEXT COMMENT '配置JSON',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (expert_id, skill_id),
          FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE CASCADE,
          FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
          INDEX idx_expert (expert_id),
          INDEX idx_skill (skill_id)
        ) COMMENT='专家技能关联表'
      `);
      
      // 恢复数据
      await conn.execute(`
        INSERT IGNORE INTO expert_skills (expert_id, skill_id, is_enabled, config, created_at)
        SELECT expert_id, skill_id, is_enabled, config, created_at FROM expert_skills_backup
      `);
      
      await conn.execute(`DROP TABLE IF EXISTS expert_skills_backup`);
    }
  },

  // ==================== 消息表扩展 ====================
  
  // 38. messages.role 添加 'tool' 类型
  {
    name: 'messages.role add tool',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'role'
      `, [DB_CONFIG.database]);
      return rows[0]?.COLUMN_TYPE?.includes('tool');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE messages 
        MODIFY COLUMN role ENUM('system', 'user', 'assistant', 'tool') NOT NULL
      `);
    }
  },

  // ==================== 任务预览 Token 表 (Issue #140) ====================

  // 40. task_token 表（不包含外键约束，避免建表失败）
  {
    name: 'task_token table',
    check: async (conn) => await hasTable(conn, 'task_token'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS task_token (
          id INT PRIMARY KEY AUTO_INCREMENT,
          token VARCHAR(64) NOT NULL UNIQUE COMMENT 'Token字符串(随机生成，非JWT)',
          task_id VARCHAR(32) NOT NULL COMMENT '关联的任务ID',
          user_id VARCHAR(32) NOT NULL COMMENT '创建Token的用户ID',
          expires_at DATETIME NOT NULL COMMENT '过期时间',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_token (token),
          INDEX idx_task_user (task_id, user_id),
          INDEX idx_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='任务预览Token表'
      `);
    }
  },

  // 40. task_token_access_log 表（不包含外键约束，避免建表失败）
  {
    name: 'task_token_access_log table',
    check: async (conn) => await hasTable(conn, 'task_token_access_log'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS task_token_access_log (
          id INT PRIMARY KEY AUTO_INCREMENT,
          token_id INT NOT NULL COMMENT '关联的Token ID',
          file_path VARCHAR(512) NOT NULL COMMENT '访问的文件路径',
          ip_address VARCHAR(45) NOT NULL COMMENT '访问者IP地址',
          user_agent VARCHAR(512) COMMENT '浏览器User-Agent',
          accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_token_id (token_id),
          INDEX idx_accessed_at (accessed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='Token访问日志表'
      `);
    }
  },

  // ==================== 上下文组织策略 (Issue #154) ====================
  
  // 41. experts.context_strategy 字段
  {
    name: 'experts.context_strategy column',
    check: async (conn) => await hasColumn(conn, 'experts', 'context_strategy'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE experts
        ADD COLUMN context_strategy ENUM('full', 'simple') DEFAULT 'full'
        COMMENT '上下文组织策略：full=完整上下文，simple=简单上下文（近期10条消息+5个Topic）'
        AFTER context_threshold
      `);
    }
  },

  // ==================== 思考内容字段 (Issue #181) ====================
  
  // 42. messages.reasoning_content 字段（用于存储模型的思考过程）
  {
    name: 'messages.reasoning_content column',
    check: async (conn) => await hasColumn(conn, 'messages', 'reasoning_content'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE messages
        ADD COLUMN reasoning_content LONGTEXT NULL
        COMMENT '思考过程内容（DeepSeek reasoning_content 输出）'
        AFTER content
      `);
    }
  },

  // 43. ai_models.supports_reasoning 字段（模型是否支持思考模式）
  {
    name: 'ai_models.supports_reasoning column',
    check: async (conn) => await hasColumn(conn, 'ai_models', 'supports_reasoning'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE ai_models
        ADD COLUMN supports_reasoning BOOLEAN DEFAULT FALSE
        COMMENT '是否支持思考/推理模式（DeepSeek、OpenAI o1/o3、Qwen 等）'
        AFTER embedding_dim
      `);
    }
  },

  // 44. ai_models.thinking_format 字段（思考模式格式类型）
  {
    name: 'ai_models.thinking_format column',
    check: async (conn) => await hasColumn(conn, 'ai_models', 'thinking_format'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE ai_models
        ADD COLUMN thinking_format ENUM('openai', 'deepseek', 'qwen', 'none') DEFAULT 'none'
        COMMENT '思考模式格式：openai(reasoning effort)、deepseek(thinking type)、qwen(enable_thinking)、none(不支持)'
        AFTER supports_reasoning
      `);
    }
  },

  // ==================== 自主任务执行字段 ====================

  // 45. tasks.status 添加 'autonomous' 状态
  {
    name: 'tasks.status add autonomous',
    check: async (conn) => {
      const [rows] = await conn.execute(`
        SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'status'
      `, [DB_CONFIG.database]);
      return rows[0]?.COLUMN_TYPE?.includes('autonomous');
    },
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE tasks
        MODIFY COLUMN status ENUM('active', 'autonomous', 'archived', 'deleted') DEFAULT 'active'
      `);
    }
  },

  // 46. tasks.expert_id 字段（关联专家）
  {
    name: 'tasks.expert_id column',
    check: async (conn) => await hasColumn(conn, 'tasks', 'expert_id'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE tasks
        ADD COLUMN expert_id VARCHAR(32) NULL
        COMMENT '关联的专家ID（自主任务执行时使用）'
        AFTER workspace_path
      `);
      await safeExecute(conn, `ALTER TABLE tasks ADD INDEX idx_expert (expert_id)`);
      await safeExecute(conn, `
        ALTER TABLE tasks ADD CONSTRAINT fk_task_expert
        FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE SET NULL
      `);
    }
  },

  // 47. tasks.topic_id 字段（关联话题）
  {
    name: 'tasks.topic_id column',
    check: async (conn) => await hasColumn(conn, 'tasks', 'topic_id'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE tasks
        ADD COLUMN topic_id VARCHAR(32) NULL
        COMMENT '关联的话题ID（自主任务执行时的对话）'
        AFTER expert_id
      `);
      await safeExecute(conn, `ALTER TABLE tasks ADD INDEX idx_topic (topic_id)`);
      await safeExecute(conn, `
        ALTER TABLE tasks ADD CONSTRAINT fk_task_topic
        FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
      `);
    }
  },

  // 48. tasks.last_executed_at 字段（最后执行时间）
  {
    name: 'tasks.last_executed_at column',
    check: async (conn) => await hasColumn(conn, 'tasks', 'last_executed_at'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE tasks
        ADD COLUMN last_executed_at DATETIME NULL
        COMMENT '最后执行时间（自主任务执行器更新）'
        AFTER topic_id
      `);
    }
  },

  // ==================== 解决方案模块 (Issue #212) ====================

  // 49. solutions 表
  {
    name: 'solutions table',
    check: async (conn) => await hasTable(conn, 'solutions'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS solutions (
          id VARCHAR(32) PRIMARY KEY,
          name VARCHAR(200) NOT NULL COMMENT '解决方案名称',
          slug VARCHAR(100) UNIQUE COMMENT 'URL友好标识',
          description TEXT COMMENT '简要描述（适用场景）',
          guide LONGTEXT COMMENT '执行指南（Markdown）',
          tags JSON COMMENT '标签数组',
          is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_slug (slug),
          INDEX idx_active (is_active)
        ) COMMENT='解决方案表'
      `);
    }
  },

  // 50. tasks.solution_id 字段（关联解决方案）
  {
    name: 'tasks.solution_id column',
    check: async (conn) => await hasColumn(conn, 'tasks', 'solution_id'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE tasks
        ADD COLUMN solution_id VARCHAR(32) NULL
        COMMENT '关联的解决方案ID'
        AFTER last_executed_at
      `);
      await safeExecute(conn, `ALTER TABLE tasks ADD INDEX idx_solution (solution_id)`);
      await safeExecute(conn, `
        ALTER TABLE tasks ADD CONSTRAINT fk_task_solution
        FOREIGN KEY (solution_id) REFERENCES solutions(id) ON DELETE SET NULL
      `);
    }
  },

  // ==================== 邀请注册系统 (Issue #222) ====================

  // 51. users.invitation_quota 字段
  {
    name: 'users.invitation_quota column',
    check: async (conn) => await hasColumn(conn, 'users', 'invitation_quota'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE users
        ADD COLUMN invitation_quota INT DEFAULT 1
        COMMENT '可生成的邀请码数量上限'
        AFTER position_id
      `);
    }
  },

  // 52. users.invited_by 字段
  {
    name: 'users.invited_by column',
    check: async (conn) => await hasColumn(conn, 'users', 'invited_by'),
    migrate: async (conn) => {
      await conn.execute(`
        ALTER TABLE users
        ADD COLUMN invited_by INT DEFAULT NULL
        COMMENT '邀请记录ID（关联 invitation_usage.id）'
        AFTER invitation_quota
      `);
    }
  },

  // 53. invitations 表
  {
    name: 'invitations table',
    check: async (conn) => await hasTable(conn, 'invitations'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS invitations (
          id INT PRIMARY KEY AUTO_INCREMENT,
          code VARCHAR(32) NOT NULL UNIQUE COMMENT '邀请码',
          creator_id VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '创建者用户ID',
          max_uses INT DEFAULT 5 COMMENT '最大使用次数',
          used_count INT DEFAULT 0 COMMENT '已使用次数',
          expires_at DATETIME DEFAULT NULL COMMENT '过期时间，NULL表示永不过期',
          status ENUM('active', 'exhausted', 'expired', 'revoked') DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_code (code),
          INDEX idx_creator (creator_id),
          INDEX idx_status (status),
          FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='邀请码表'
      `);
    }
  },

  // 54. invitation_usages 表
  {
    name: 'invitation_usages table',
    check: async (conn) => await hasTable(conn, 'invitation_usages'),
    migrate: async (conn) => {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS invitation_usages (
          id INT PRIMARY KEY AUTO_INCREMENT,
          invitation_id INT NOT NULL COMMENT '邀请ID',
          user_id VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '注册用户ID',
          used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_invitation (invitation_id),
          INDEX idx_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='邀请使用记录表'
      `);
    }
  },

  // 55. 注册系统配置
  {
    name: 'registration system settings',
    check: async (conn) => {
      const [rows] = await conn.execute(
        `SELECT setting_key FROM system_settings WHERE setting_key = 'registration.allow_self_registration'`
      );
      return rows.length > 0;
    },
    migrate: async (conn) => {
      const settings = [
        { key: 'registration.allow_self_registration', value: 'false', type: 'boolean', desc: '是否允许自主注册（无需邀请码）' },
        { key: 'registration.default_invitation_quota', value: '1', type: 'number', desc: '用户默认可生成的邀请码数量' },
        { key: 'registration.default_invitation_max_uses', value: '5', type: 'number', desc: '每个邀请码默认可邀请人数' },
        { key: 'registration.invitation_expiry_days', value: '0', type: 'number', desc: '邀请码默认有效天数（0=永久）' },
      ];
      for (const s of settings) {
        await conn.execute(
          `INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description) VALUES (?, ?, ?, ?)`,
          [s.key, s.value, s.type, s.desc]
        );
      }
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