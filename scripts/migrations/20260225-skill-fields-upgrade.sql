-- ============================================================================
-- 数据库迁移：Skills 字段升级
-- 日期�?026-02-25
-- 
-- 变更内容�?
-- 1. skills 表添加扩展字段（Claude Code Skills 标准）：
--    - license (TEXT) - 许可证信�?
--    - argument_hint (VARCHAR(128)) - 参数提示
--    - disable_model_invocation (TINYINT(1)) - 禁用模型调用
--    - user_invocable (TINYINT(1)) - 用户可调�?
--    - allowed_tools (TEXT) - 允许的工具列表（JSON 数组�?
-- 
-- 2. skill_tools 表移除未使用字段�?
--    - type
--    - command
--    - endpoint
--    - method
-- ============================================================================

-- ========================================
-- 1. skills 表添加扩展字�?
-- ========================================

-- 添加 license 字段
ALTER TABLE skills ADD COLUMN license TEXT;

-- 添加 argument_hint 字段
ALTER TABLE skills ADD COLUMN argument_hint VARCHAR(128) DEFAULT '';

-- 添加 disable_model_invocation 字段（默�?false�?
ALTER TABLE skills ADD COLUMN disable_model_invocation TINYINT(1) DEFAULT 0;

-- 添加 user_invocable 字段（默�?true�?
ALTER TABLE skills ADD COLUMN user_invocable TINYINT(1) DEFAULT 1;

-- 添加 allowed_tools 字段（JSON 数组�?
ALTER TABLE skills ADD COLUMN allowed_tools TEXT;


-- ========================================
-- 2. skill_tools 表移除未使用字段
-- ========================================

-- 移除 type 字段
ALTER TABLE skill_tools DROP COLUMN type;

-- 移除 command 字段
ALTER TABLE skill_tools DROP COLUMN command;

-- 移除 endpoint 字段
ALTER TABLE skill_tools DROP COLUMN endpoint;

-- 移除 method 字段
ALTER TABLE skill_tools DROP COLUMN method;


-- ========================================
-- 验证结果
-- ========================================

-- 查看 skills 表结�?
DESCRIBE skills;

-- 查看 skill_tools 表结�?
DESCRIBE skill_tools;
