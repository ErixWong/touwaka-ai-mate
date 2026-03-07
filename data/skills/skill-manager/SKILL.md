---
name: skill-manager
description: 技能管理工具，用于注册、删除、查询技能。技能专家通过文件系统读取 SKILL.md 后，使用此工具将技能注册到数据库。
argument-hint: "[register|delete|toggle|list] [skill_id]"
user-invocable: false
allowed-tools: []
---

# Skill Manager

技能管理核心工具，通过 API 调用后台服务执行操作。

## 配置要求

此技能通过 API 调用后台服务，需要以下环境变量：

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `USER_ACCESS_TOKEN` | 用户的 JWT access token | ✅ |
| `API_BASE` | API 基础地址 | ✅ |
| `NODE_ENV` | 运行环境（production/development） | 可选 |

> 注意：此技能不再需要数据库连接参数，所有操作通过 API 完成。

## 工具清单

### list_skills

列出数据库中所有技能（精简列表，不含工具详情）。

**参数：**
- `is_active`: 过滤启用/禁用状态（可选，不传则返回所有）
- `search`: 按名称搜索（可选，模糊匹配）

**返回示例：**
```json
{
  "success": true,
  "data": {
    "skills": [
      {
        "id": "abc123",
        "name": "searxng",
        "description": "互联网搜索技能",
        "version": "1.0.0",
        "is_active": true,
        "source_path": "skills/searxng"
      }
    ]
  }
}
```

### list_skill_details

获取指定技能的完整详情，包括技能所有字段和工具定义列表。

**参数：**
- `skill_id`: 技能ID或名称（必需）

**返回示例：**
```json
{
  "success": true,
  "data": {
    "skill": {
      "id": "abc123",
      "name": "searxng",
      "description": "互联网搜索技能",
      "version": "1.0.0",
      "author": "Touwaka Team",
      "tags": ["search", "web"],
      "is_active": true,
      "source_path": "skills/searxng",
      "created_at": "2026-03-01T10:00:00Z",
      "updated_at": "2026-03-02T15:30:00Z"
    },
    "tools": [
      {
        "id": "tool1",
        "name": "web_search",
        "description": "搜索互联网",
        "parameters": { "type": "object", "properties": {...} },
        "script_path": "index.js"
      }
    ]
  }
}
```

### register_skill

从本地目录注册或更新技能到数据库。需要先读取 SKILL.md，理解工具定义后调用此工具。

**参数：**
- `source_path`: 技能目录相对于 dataBasePath 的路径。例如：`skills/searxng`（注意：必须包含 `skills/` 前缀）
- `name`: 技能名称（可选，默认从 SKILL.md 的 name 字段提取）
- `description`: 技能描述（可选，默认从 SKILL.md 的 description 字段提取）
- `tools`: 工具定义数组，每个工具包含 name、description、parameters、script_path 字段

### delete_skill

从数据库中删除技能（谨慎使用）。

**参数：**
- `skill_id`: 技能ID或名称

### toggle_skill

启用或禁用技能。

**参数：**
- `skill_id`: 技能ID或名称
- `is_active`: 是否启用（boolean）

### assign_skill

分配技能给专家。

**参数：**
- `skill_id`: 技能ID或名称
- `expert_id`: 专家ID

### unassign_skill

取消技能分配。

**参数：**
- `skill_id`: 技能ID或名称
- `expert_id`: 专家ID

## 使用流程

1. 使用 `list_skills` 浏览已注册的技能精简列表
2. 对感兴趣的技能，使用 `list_skill_details` 获取完整详情（含工具定义）
3. 通过 `list_files` 和 `read_lines` 浏览本地技能目录
4. 读取 SKILL.md 理解技能结构和工具定义
5. 使用 `register_skill` 将技能注册到数据库
6. 使用 `toggle_skill` 启用或禁用技能
7. 使用 `assign_skill` / `unassign_skill` 管理技能与专家的关联

## 架构说明

此技能采用 API 调用模式：

```
skill-manager (沙箱)
    ↓ HTTP API
server/controllers/skill.controller.js
    ↓ Sequelize
MySQL 数据库
```

**优点**：
- 业务逻辑集中在后台服务
- 使用用户 Token 认证，权限由 API 层统一控制
- 无需在 skill 中暴露数据库凭证
- 数据库结构变更不影响 skill 代码

## 注意事项

- 此技能仅供技能管理专家（如 skill-studio）使用
- 注册技能时必须提供完整的 tools 数组
- 删除技能会同时删除关联的工具定义
- 所有操作需要用户已登录（有有效的 USER_ACCESS_TOKEN）

---

*重构时间: 2026-03-07 - 从直接数据库访问改为 API 调用模式*
