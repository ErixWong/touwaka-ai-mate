/**
 * Database Migration: Add Tasks Table and task_id to Topics
 * 
 * 创建 tasks 表（如果不存在）
 * 为 topics 表添加 task_id 字段（如果不存在）
 * 
 * 关系：messages → topics → tasks
 * 
 * 运行方式：node scripts/migrate-add-tasks.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// 工作空间根目录
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';

/**
 * 创建 tasks 表（如果不存在）
 */
const CREATE_TASKS_TABLE = `
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
) COMMENT='任务工作空间表';
`;

/**
 * 检查 tasks 表是否存在
 */
async function hasTasksTable(connection) {
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks'`,
    [DB_CONFIG.database]
  );
  return rows.length > 0;
}

/**
 * 检查 topics 表是否已有 task_id 字段
 */
async function hasTaskIdColumn(connection) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'topics' AND COLUMN_NAME = 'task_id'`,
    [DB_CONFIG.database]
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

    // 1. 检查并创建 tasks 表
    console.log('Checking tasks table...');
    if (await hasTasksTable(connection)) {
      console.log('  ⏭️ tasks table already exists, skipping');
    } else {
      await connection.execute(CREATE_TASKS_TABLE);
      console.log('  ✅ tasks table created');
    }

    // 2. 检查并添加 topics.task_id 字段
    console.log('Checking topics.task_id column...');
    if (await hasTaskIdColumn(connection)) {
      console.log('  ⏭️ topics.task_id already exists, skipping');
    } else {
      await connection.execute(
        `ALTER TABLE topics ADD COLUMN task_id VARCHAR(32) COMMENT '关联任务ID' AFTER expert_id`
      );
      await connection.execute(
        `ALTER TABLE topics ADD INDEX idx_task (task_id)`
      );
      await connection.execute(
        `ALTER TABLE topics ADD CONSTRAINT fk_topic_task 
         FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL`
      );
      console.log('  ✅ topics.task_id column added');
    }

    // 3. 确保工作空间根目录存在
    const workspaceDir = path.resolve(WORKSPACE_ROOT);
    try {
      await fs.mkdir(workspaceDir, { recursive: true });
      console.log(`  ✅ Workspace root directory: ${workspaceDir}`);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      console.log(`  ✅ Workspace root directory exists: ${workspaceDir}`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n关系: messages → topics → tasks');

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
