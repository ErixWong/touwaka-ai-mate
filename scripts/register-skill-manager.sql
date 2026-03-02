-- ============================================
-- Skill Manager 技能注册脚本
-- 删除旧数据并重新注册
-- ============================================

-- 1. 删除旧的 skill-manager 数据（级联删除 skill_tools 和 skill_parameters）
DELETE FROM skill_parameters WHERE skill_id = 'skill-manager';
DELETE FROM skill_tools WHERE skill_id = 'skill-manager';
DELETE FROM expert_skills WHERE skill_id = 'skill-manager';
DELETE FROM skills WHERE id = 'skill-manager';

-- 2. 插入技能基本信息
INSERT INTO skills (id, name, description, version, author, tags, source_type, source_path, is_active, skill_md) VALUES
('skill-manager', 'skill-manager', '技能管理工具，用于注册、删除、查询技能。技能专家通过文件系统读取 SKILL.md 后，使用此工具将技能注册到数据库。', '1.1.0', 'Touwaka Team', '["management", "database"]', 'local', 'skills/skill-manager', 1,
'---
name: skill-manager
description: 技能管理工具，用于注册、删除、查询技能。技能专家通过文件系统读取 SKILL.md 后，使用此工具将技能注册到数据库。
argument-hint: "[register|delete|toggle|list] [skill_id]"
user-invocable: false
allowed-tools: []
---

# Skill Manager

技能管理核心工具，提供以下功能：

## 配置要求

此技能需要数据库连接参数，通过 `skill_parameters` 表配置：

| 参数名 | 说明 | 示例值 |
|--------|------|--------|
| `db_host` | 数据库主机 | `${DB_HOST}` |
| `db_port` | 数据库端口 | `${DB_PORT}` |
| `db_name` | 数据库名称 | `${DB_NAME}` |
| `db_user` | 数据库用户 | `${DB_USER}` |
| `db_password` | 数据库密码 | `${DB_PASSWORD}` |

> 使用 `${ENV_VAR}` 格式会自动从环境变量读取值，避免敏感信息存储在数据库中。

## 工具清单

### register_skill
从本地目录注册或更新技能到数据库。需要先读取 SKILL.md，理解工具定义后调用此工具。

**参数：**
- `source_path`: 技能目录相对于 dataBasePath 的路径。例如：`skills/searxng`（注意：必须包含 `skills/` 前缀）
- `name`: 技能名称（可选）
- `description`: 技能描述（可选）
- `tools`: 工具定义数组，每个工具包含 name、description、parameters、script_path 字段

### delete_skill
从数据库中删除技能（谨慎使用）。

**参数：**
- `skill_id`: 技能ID或名称

### toggle_skill
启用或禁用技能。

**参数：**
- `skill_id`: 技能ID或名称
- `is_active`: 是否启用

### list_skills
列出数据库中所有技能（精简列表，不含工具详情）。

**参数：**
- `is_active`: 过滤启用/禁用状态（可选，不传则返回所有）
- `search`: 按名称搜索（可选，模糊匹配）

### list_skill_details
获取指定技能的完整详情，包括技能所有字段和工具定义列表。

**参数：**
- `skill_id`: 技能ID或名称

## 使用流程

1. 使用 `list_skills` 浏览已注册的技能精简列表
2. 对感兴趣的技能，使用 `list_skill_details` 获取完整详情（含工具定义）
3. 通过 `list_files` 和 `read_lines` 浏览本地技能目录
4. 读取 SKILL.md 理解技能结构和工具定义
5. 使用 `register_skill` 将技能注册到数据库
6. 使用 `toggle_skill` 启用或禁用技能

## 注意事项

- 此技能仅供技能管理专家（如 skill-studio）使用
- 注册技能时必须提供完整的 tools 数组
- 删除技能会同时删除关联的工具定义
- 技能分配给专家的操作需要在网页端手动完成
- 此技能运行在沙箱中，使用独立的数据库连接池（最大2个连接）
');

-- 3. 插入工具定义
INSERT INTO skill_tools (id, skill_id, name, description, parameters, script_path) VALUES
-- register_skill
('sm_tool_register', 'skill-manager', 'register_skill', 
 '从本地目录注册或更新技能到数据库。需要先读取 SKILL.md，理解工具定义后调用此工具。同名技能会覆盖更新。',
 '{"type":"object","properties":{"source_path":{"type":"string","description":"技能目录相对于 dataBasePath 的路径。例如：skills/searxng（注意：包含 skills/ 前缀）"},"name":{"type":"string","description":"技能名称（可选，默认从 SKILL.md 的 name 字段提取）"},"description":{"type":"string","description":"技能描述（可选，默认从 SKILL.md 的 description 字段提取）"},"tools":{"type":"array","description":"工具定义数组。每个工具包含 name、description、parameters、script_path 字段。parameters 是 JSON Schema 格式。","items":{"type":"object","properties":{"name":{"type":"string","description":"工具名称，如 web_search、read_lines"},"description":{"type":"string","description":"工具功能描述"},"parameters":{"type":"object","description":"JSON Schema 格式的参数定义，包含 type、properties、required 字段"},"script_path":{"type":"string","description":"工具入口脚本路径（相对于技能目录，默认 index.js）。例如：scripts/thumbnail.py"}},"required":["name","description","parameters"]}}},"required":["source_path","tools"]}',
 'index.js'),

-- delete_skill
('sm_tool_delete', 'skill-manager', 'delete_skill',
 '从数据库中删除技能（谨慎使用，会同时删除关联的工具定义）',
 '{"type":"object","properties":{"skill_id":{"type":"string","description":"技能ID或名称"}},"required":["skill_id"]}',
 'index.js'),

-- toggle_skill
('sm_tool_toggle', 'skill-manager', 'toggle_skill',
 '启用或禁用技能（下次对话生效）',
 '{"type":"object","properties":{"skill_id":{"type":"string","description":"技能ID或名称"},"is_active":{"type":"boolean","description":"是否启用"}},"required":["skill_id","is_active"]}',
 'index.js'),

-- list_skills
('sm_tool_list', 'skill-manager', 'list_skills',
 '列出数据库中所有技能。可按启用状态过滤或按名称搜索。',
 '{"type":"object","properties":{"is_active":{"type":"boolean","description":"过滤启用/禁用状态（可选，不传则返回所有）"},"search":{"type":"string","description":"按名称搜索（可选，模糊匹配）"}},"required":[]}',
 'index.js'),

-- list_skill_details
('sm_tool_details', 'skill-manager', 'list_skill_details',
 '获取指定技能的完整详情，包括技能所有字段和工具定义列表。',
 '{"type":"object","properties":{"skill_id":{"type":"string","description":"技能ID或名称"}},"required":["skill_id"]}',
 'index.js');

-- 4. 插入数据库连接参数
INSERT INTO skill_parameters (id, skill_id, param_name, param_value, is_secret) VALUES
('sm_param_db_host', 'skill-manager', 'db_host', '${DB_HOST}', 0),
('sm_param_db_port', 'skill-manager', 'db_port', '${DB_PORT}', 0),
('sm_param_db_name', 'skill-manager', 'db_name', '${DB_NAME}', 0),
('sm_param_db_user', 'skill-manager', 'db_user', '${DB_USER}', 0),
('sm_param_db_password', 'skill-manager', 'db_password', '${DB_PASSWORD}', 1);

-- 5. 验证结果
SELECT '=== Skill Manager 注册完成 ===' AS status;
SELECT id, name, version, is_active, source_path FROM skills WHERE id = 'skill-manager';
SELECT id, name, description FROM skill_tools WHERE skill_id = 'skill-manager';
SELECT id, param_name, param_value, is_secret FROM skill_parameters WHERE skill_id = 'skill-manager';
