/**
 * Migration: Add assistant_messages table
 *
 * 用于记录 Expert 与 Assistant 之间内部协作过程的消息表
 *
 * @created 2026-03-11
 */

import mysql from 'mysql2/promise';
import 'dotenv/config';

const SQL_CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS \`assistant_messages\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`request_id\` VARCHAR(64) NOT NULL COMMENT '关联 assistant_requests.request_id',
  \`parent_message_id\` VARCHAR(64) DEFAULT NULL COMMENT '父消息 ID，用于树状结构',
  \`role\` ENUM('expert', 'assistant', 'tool', 'system') NOT NULL COMMENT '消息角色',
  \`message_type\` ENUM(
    'task',
    'context',
    'assistant_response',
    'tool_call',
    'tool_result',
    'final',
    'error',
    'retry',
    'status',
    'note'
  ) NOT NULL COMMENT '消息类型',
  \`content\` LONGTEXT DEFAULT NULL COMMENT '文本内容',
  \`content_preview\` VARCHAR(512) DEFAULT NULL COMMENT '摘要，用于列表展示',
  \`tool_name\` VARCHAR(128) DEFAULT NULL COMMENT '工具名称',
  \`tool_call_id\` VARCHAR(64) DEFAULT NULL COMMENT '工具调用链路 ID',
  \`status\` ENUM('pending', 'running', 'completed', 'failed', 'skipped') DEFAULT NULL COMMENT '消息状态',
  \`sequence_no\` INT NOT NULL COMMENT '同一 request 内顺序号',
  \`metadata\` JSON DEFAULT NULL COMMENT '扩展字段',
  \`tokens_input\` INT DEFAULT NULL COMMENT '本条消息相关输入 token',
  \`tokens_output\` INT DEFAULT NULL COMMENT '本条消息相关输出 token',
  \`latency_ms\` INT DEFAULT NULL COMMENT '本步骤耗时',
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (\`id\`),
  KEY \`idx_request_id\` (\`request_id\`),
  KEY \`idx_request_seq\` (\`request_id\`, \`sequence_no\`),
  KEY \`idx_tool_call_id\` (\`tool_call_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='助理内部消息表';
`;

async function migrate() {
  console.log('🔄 开始迁移: 添加 assistant_messages 表...');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    // 检查表是否已存在
    const [rows] = await connection.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = ?
      AND table_name = 'assistant_messages'
    `, [process.env.DB_NAME]);

    if (rows[0].count > 0) {
      console.log('✅ 表 assistant_messages 已存在，跳过创建');
      return;
    }

    // 创建表
    await connection.query(SQL_CREATE_TABLE);
    console.log('✅ 表 assistant_messages 创建成功');

  } catch (error) {
    console.error('❌ 迁移失败:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

// 执行迁移
migrate()
  .then(() => {
    console.log('🎉 迁移完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('迁移失败:', error);
    process.exit(1);
  });