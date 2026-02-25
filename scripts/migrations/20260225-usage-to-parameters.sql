-- ============================================================
-- Migration: 将 skill_tools.usage 改名为 skill_tools.parameters
-- Date: 2026-02-25
-- Description: 语义更清晰，与 OpenAI function calling 一致
-- ============================================================

-- ⚠️ 执行前请先备份数据！
-- mysqldump -u root -p touwaka_mate skill_tools > skill_tools_backup.sql

-- 重命名字段
ALTER TABLE skill_tools CHANGE COLUMN `usage` `parameters` TEXT;

-- 验证
SELECT 'Migration completed: usage -> parameters' AS status;
