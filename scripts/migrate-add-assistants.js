/**
 * Database Migration: Add Assistant System Tables
 *
 * 创建助理系统相关表：
 * - assistants: 助理配置表
 * - assistant_requests: 委托记录表
 *
 * 运行方式：node scripts/migrate-add-assistants.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

/**
 * 创建 assistants 表（助理配置）
 * 注意：外键在表创建后单独添加
 */
const CREATE_ASSISTANTS_TABLE = `
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
  is_builtin BIT(1) DEFAULT b'0' COMMENT '是否为内置助理（不可删除）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_assistant_active (is_active),
  INDEX idx_assistant_mode (execution_mode),
  INDEX idx_assistant_builtin (is_builtin)
) COMMENT='助理配置表';
`;

/**
 * 创建 assistant_requests 表（委托记录）
 * 注意：外键在表创建后单独添加
 */
const CREATE_ASSISTANT_REQUESTS_TABLE = `
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
  INDEX idx_request_expert (expert_id),
  INDEX idx_request_user (user_id),
  INDEX idx_request_status (status),
  INDEX idx_request_created (created_at)
) COMMENT='助理委托记录表';
`;

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
 * 迁移主函数
 */
async function migrate() {
  let connection;

  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('Connected to database:', DB_CONFIG.database);

    // 1. 创建 assistants 表
    console.log('Checking assistants table...');
    if (await hasTable(connection, 'assistants')) {
      console.log('  ⏭️ assistants table already exists, skipping');
    } else {
      await connection.execute(CREATE_ASSISTANTS_TABLE);
      console.log('  ✅ assistants table created');
    }

    // 2. 创建 assistant_requests 表
    console.log('Checking assistant_requests table...');
    if (await hasTable(connection, 'assistant_requests')) {
      console.log('  ⏭️ assistant_requests table already exists, skipping');
    } else {
      await connection.execute(CREATE_ASSISTANT_REQUESTS_TABLE);
      console.log('  ✅ assistant_requests table created');
    }

    // 3. 添加内置助理数据
    console.log('Seeding built-in assistants...');
    const builtInAssistants = [
      {
        assistant_type: 'doc_image_analyzer',
        name: '文档图片分析助理',
        icon: 'image',
        description: '上传图片（文档、照片、截图等），自动识别图片中的文字内容并进行结构化分析。支持中文、英文等多种语言识别。',
        execution_mode: 'llm',
        is_active: true,
        is_builtin: true,
        estimated_time: 30,
        timeout: 120,
        prompt_template: '你是一个专业的文档图片分析助手。用户上传图片后，你需要：\n1. 识别图片中的所有文字内容\n2. 分析文档结构（标题、段落、表格等）\n3. 提取关键信息\n4. 以结构化的方式输出分析结果',
      },
    ];

    for (const assistant of builtInAssistants) {
      try {
        await connection.execute(
          `INSERT INTO assistants (assistant_type, name, icon, description, execution_mode, is_active, is_builtin, estimated_time, timeout, prompt_template)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name)`,
          [
            assistant.assistant_type,
            assistant.name,
            assistant.icon,
            assistant.description,
            assistant.execution_mode,
            assistant.is_active ? 1 : 0,
            assistant.is_builtin ? 1 : 0,
            assistant.estimated_time,
            assistant.timeout,
            assistant.prompt_template,
          ]
        );
        console.log(`  ✅ Seeded built-in assistant: ${assistant.assistant_type}`);
      } catch (insertError) {
        if (insertError.code === 'ER_DUP_ENTRY') {
          console.log(`  ⏭️ Assistant ${assistant.assistant_type} already exists, skipping`);
        } else {
          console.error(`  ❌ Failed to seed ${assistant.assistant_type}:`, insertError.message);
        }
      }
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n表结构:');
    console.log('  assistants (助理配置)');
    console.log('    └── assistant_requests (委托记录)');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// 检查必需的环境变量
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

migrate();
