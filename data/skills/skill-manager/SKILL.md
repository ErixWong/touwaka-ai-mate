---
name: skill-manager
description: 技能管理工具，用于注册、删除、分配技能到数据库。技能专家通过文件系统读取 SKILL.md 后，使用此工具将技能注册到数据库。
argument-hint: "[register|delete|assign|toggle] [skill_id]"
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
- `tools`: 工具定义数组，每个工具包含 name、description、parameters 字段

### delete_skill
从数据库中删除技能（谨慎使用）。

**参数：**
- `skill_id`: 技能ID或名称

### assign_skill_to_expert
将技能分配给指定专家。

**参数：**
- `skill_id`: 技能ID或名称
- `expert_id`: 专家ID或名称

### unassign_skill_from_expert
取消技能与专家的关联。

**参数：**
- `skill_id`: 技能ID或名称
- `expert_id`: 专家ID或名称

### toggle_skill
启用或禁用技能。

**参数：**
- `skill_id`: 技能ID或名称
- `is_active`: 是否启用

## 使用流程

1. 技能专家通过 `list_files` 和 `read_lines` 浏览技能目录
2. 读取 SKILL.md 理解技能结构和工具定义
3. 使用 `register_skill` 将技能注册到数据库
4. 使用 `assign_skill_to_expert` 将技能分配给专家

## 注意事项

- 此技能仅供技能管理专家（如 skill-studio）使用
- 注册技能时必须提供完整的 tools 数组
- 删除技能会同时删除关联的工具定义
- 此技能运行在沙箱中，使用独立的数据库连接池（最大2个连接）
