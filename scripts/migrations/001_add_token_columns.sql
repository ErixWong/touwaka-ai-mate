-- Migration: 分离 prompt_tokens 和 completion_tokens，删除 tokens 字段
-- Date: 2026-02-25
-- Description: 分离存储 prompt_tokens 和 completion_tokens，删除有歧义的 tokens 字段

-- ============================================
-- 第一部分：添加新字段（所有数据库都需执行）
-- ============================================

-- 1. 添加 prompt_tokens 列（如果不存在）
ALTER TABLE messages ADD COLUMN IF NOT EXISTS prompt_tokens INT DEFAULT 0 COMMENT '输入 token 数量';

-- 2. 添加 completion_tokens 列（如果不存在）
ALTER TABLE messages ADD COLUMN IF NOT EXISTS completion_tokens INT DEFAULT 0 COMMENT '输出 token 数量';


-- ============================================
-- 第二部分：迁移现有数据（可选，根据实际情况执行）
-- ============================================

-- 将原有 tokens 值迁移到 completion_tokens（假设历史数据主要是输出 token）
-- 取消下面的注释来执行数据迁移
-- UPDATE messages SET completion_tokens = tokens WHERE completion_tokens = 0 OR completion_tokens IS NULL;


-- ============================================
-- 第三部分：删除旧字段（建议备份数据后执行）
-- ============================================

-- 删除 tokens 列
-- 注意：执行前请确保已备份数据，并且新字段已正确迁移
ALTER TABLE messages DROP COLUMN IF EXISTS tokens;


-- ============================================
-- 完整执行指南
-- ============================================
-- 
-- 方案 A：全新安装 / 可以重建数据库
--   直接运行 init-database.js，它会创建正确的表结构
-- 
-- 方案 B：现有数据库升级（推荐步骤）
--   1. 备份数据库
--   2. 执行第一部分（添加新字段）
--   3. 执行第二部分（迁移数据）- 可选
--   4. 验证新字段数据正确
--   5. 执行第三部分（删除旧字段）
-- 
-- 方案 C：快速升级（一条命令）
--   取消所有注释，一次性执行全部 SQL
