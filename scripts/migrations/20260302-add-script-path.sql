-- ============================================================
-- Migration: 为 skill_tools 表添加 script_path 字段
-- Date: 2026-03-02
-- Task: docs/core/tasks/2026-03-02-skill-tool-entry-file/
-- ============================================================

-- ⚠️ 执行前请先备份数据！
-- mysqldump -u root -p touwaka_mate skill_tools > skill_tools_backup.sql

-- 添加 script_path 字段
ALTER TABLE skill_tools 
ADD COLUMN script_path VARCHAR(255) DEFAULT 'index.js' 
COMMENT '工具入口脚本路径（相对于技能目录）' 
AFTER parameters;

-- 验证变更
DESCRIBE skill_tools;

-- 示例：为 pptx 技能的工具配置脚本路径（需要根据实际情况调整）
-- UPDATE skill_tools SET script_path = 'scripts/thumbnail.py' WHERE skill_id = 'pptx' AND name = 'thumbnail';
-- UPDATE skill_tools SET script_path = 'scripts/add_slide.py' WHERE skill_id = 'pptx' AND name = 'add_slide';
