-- 为 skill-manager 技能添加数据库连接参数
-- 这些参数会被 skill-loader.js 读取并注入到环境变量中
-- 环境变量格式：SKILL_{PARAM_NAME_UPPERCASE}，如 SKILL_DB_HOST

-- 首先获取 skill-manager 的 skill_id（假设技能已注册）
-- 如果技能未注册，需要先注册技能

-- 插入数据库连接参数
-- 注意：param_value 使用环境变量占位符格式，实际值从 .env 读取

INSERT INTO skill_parameters (id, skill_id, param_name, param_value, is_secret) VALUES
('sm_param_db_host', 'skill-manager', 'db_host', '${DB_HOST}', 0),
('sm_param_db_port', 'skill-manager', 'db_port', '${DB_PORT}', 0),
('sm_param_db_name', 'skill-manager', 'db_name', '${DB_NAME}', 0),
('sm_param_db_user', 'skill-manager', 'db_user', '${DB_USER}', 0),
('sm_param_db_password', 'skill-manager', 'db_password', '${DB_PASSWORD}', 1)
ON DUPLICATE KEY UPDATE
  param_value = VALUES(param_value),
  is_secret = VALUES(is_secret);

-- 验证插入结果
SELECT sp.*, s.name as skill_name 
FROM skill_parameters sp
JOIN skills s ON s.id = sp.skill_id
WHERE sp.skill_id = 'skill-manager';
