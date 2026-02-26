# Skills 和 Skill_Tools 字段分析

> 基于 Claude Code Skills 标准和本项目实际需求的分析

## 1. 概述

本文档分析 `skills` 和 `skill_tools` 表的字段设计，对比 Claude Code Skills 官方标准，确定哪些字段是必需的，哪些可以移除。

## 2. Skills 表字段分析

### 2.1 当前字段

| 字段 | 类型 | 说明 | 来源 |
|------|------|------|------|
| `id` | STRING(32) | 主键 | 系统生成 |
| `name` | STRING(128) | 技能名称 | SKILL.md frontmatter |
| `description` | TEXT | 技能描述 | SKILL.md frontmatter |
| `source_type` | ENUM | 来源类型 | 系统管理 |
| `source_path` | STRING(256) | 来源路径 | 系统管理 |
| `skill_md` | TEXT | SKILL.md 内容 | 文件内容 |
| `is_active` | BOOLEAN | 启用状态 | 系统管理 |
| `version` | STRING(32) | 版本号 | SKILL.md body |
| `author` | STRING(128) | 作者 | SKILL.md body |
| `tags` | TEXT | 标签 | SKILL.md body |
| `source_url` | STRING(512) | 来源 URL | 系统管理 |
| `security_score` | INTEGER | 安全评分 | AI 分析 |
| `security_warnings` | TEXT | 安全警告 | AI 分析 |

### 2.2 已移除的字段

| 字段 | 说明 | 移除原因 |
|------|------|---------|
| `index_js` | index.js 内容 | 代码通过 `source_path` 加载 |
| `config` | 配置 JSON | 配置通过 `skill_parameters` 表管理 |

### 2.3 Claude Code 扩展字段（不存储）

这些字段在解析器中支持，但不需要存储到数据库：

| 字段 | 类型 | 官方含义 | 本项目不存储的原因 |
|------|------|---------|-------------------|
| `license` | string | 许可证信息 | 仅用于展示，不需要查询 |
| `argument_hint` | string | 参数提示 | 可从 SKILL.md 实时读取 |
| `disable_model_invocation` | boolean | 禁用 LLM 调用 | 所有技能都由 LLM 调用 |
| `user_invocable` | boolean | 用户可直接调用 | 不支持用户直接调用技能 |
| `allowed_tools` | string[] | 限制可调用的外部工具 | 不需要技能级权限控制 |

**分析**：

1. **`disable_model_invocation`**：Claude Code 中某些技能只执行脚本不生成内容。本项目所有技能都由 LLM 触发，不需要此字段。

2. **`argument_hint`**：用于在 UI 中显示参数提示。如果将来需要，可以从 `skill_md` 中实时解析，不需要单独存储。

3. **`user_invocable`**：Claude Code 支持用户通过 `/skill-name` 直接调用技能。本项目不支持此功能。

4. **`allowed_tools`**：这是**权限控制**字段，限制技能可以调用的外部工具（如 `Bash(curl *)`）。与 `skill_tools` 表（技能**提供**的工具）完全不同。本项目不需要技能级权限控制。

## 3. Skill_Tools 表字段分析

### 3.1 当前字段

| 字段 | 类型 | 说明 | 是否使用 |
|------|------|------|---------|
| `id` | STRING(32) | 主键 | ✅ 使用中 |
| `skill_id` | STRING(32) | 所属技能 | ✅ 使用中 |
| `name` | STRING(64) | 工具名称 | ✅ 使用中 |
| `description` | TEXT | 工具描述 | ✅ 使用中 |
| `type` | ENUM | http/script/builtin | ❌ **未使用** |
| `usage` | TEXT | 使用说明 | ⚠️ 部分使用 |
| `command` | STRING(512) | 命令 | ❌ **未使用** |
| `endpoint` | STRING(512) | API 端点 | ❌ **未使用** |
| `method` | STRING(16) | HTTP 方法 | ❌ **未使用** |

### 3.2 未使用字段分析

| 字段 | 设计初衷 | 为什么未使用 | 建议 |
|------|---------|-------------|------|
| `type` | 区分工具类型 | 所有工具都通过 `index.js` 执行，类型无意义 | **移除** |
| `command` | 存储 shell 命令 | 工具逻辑在 `index.js` 中实现 | **移除** |
| `endpoint` | 存储 API 端点 | 工具逻辑在 `index.js` 中实现 | **移除** |
| `method` | 存储 HTTP 方法 | 工具逻辑在 `index.js` 中实现 | **移除** |

### 3.3 本项目的工具执行流程

```
LLM 调用工具 (tool_name = skill_tools.id)
    ↓
ToolManager 查找 skill_tools 记录
    ↓
SkillRunner 执行 source_path/index.js
    ↓
index.js 的 execute(toolName, params, context)
    ↓
返回结果
```

**关键点**：
- 工具的执行逻辑在 `index.js` 中实现
- `skill_tools` 表只存储工具的**元数据**（名称、描述、参数）
- 不需要 `type`/`command`/`endpoint`/`method` 因为执行逻辑在代码中

### 3.4 官方标准的工具定义

官方 Claude Code Skills 中，工具定义在 SKILL.md 的 `## Tools` 部分：

```markdown
## Tools

### web_search

Search the web using SearXNG.

**Parameters:**
- `query` (string, required): The search query
- `n` (number, optional): Number of results
```

官方标准**没有** `type`/`command`/`endpoint`/`method` 这些字段。工具的执行逻辑在 `scripts/` 目录或 `index.js` 中实现。

## 4. 建议的改进

### 4.1 Skills 表

**保持现状**，字段已经精简且符合需求。

### 4.2 Skill_Tools 表

**移除以下字段**：
- `type`
- `command`
- `endpoint`
- `method`

**保留字段**：
- `id` - 工具唯一标识
- `skill_id` - 所属技能
- `name` - 工具名称
- `description` - 工具描述
- `usage` - 使用说明（可选）

### 4.3 简化后的 Skill_Tools 结构

```sql
CREATE TABLE skill_tools (
  id VARCHAR(32) PRIMARY KEY,
  skill_id VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  usage TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (skill_id) REFERENCES skills(id),
  UNIQUE INDEX idx_skill_name (skill_id, name)
);
```

## 5. 对比总结

| 维度 | Claude Code 标准 | 本项目当前 | 建议 |
|------|-----------------|-----------|------|
| 技能元数据 | name + description | ✅ 符合 | 保持 |
| 技能内容 | SKILL.md + scripts/ | ✅ 符合 | 保持 |
| 工具定义 | SKILL.md ## Tools | skill_tools 表 | 保持 |
| 工具执行 | scripts/*.py | index.js | 保持 |
| 工具类型 | 无 | type 字段 | **移除** |
| HTTP 配置 | 无 | endpoint/method | **移除** |
| 命令配置 | 无 | command | **移除** |

## 6. 迁移计划

如果决定移除这些字段，需要：

1. 更新 `models/skill_tool.js` - 移除字段定义
2. 更新 `scripts/init-database.js` - 修改 CREATE TABLE
3. 更新 `lib/skill-analyzer.js` - 移除字段解析
4. 创建数据库迁移脚本 - ALTER TABLE

## 7. 附录：字段使用情况代码搜索

### 7.1 type/command/endpoint/method 使用情况

```bash
# 搜索结果：这些字段只在以下地方被引用
lib/skill-analyzer.js:245-248  # AI 分析时的默认值设置（可移除）
```

没有其他代码使用这些字段。

### 7.2 skill-runner.js 执行逻辑

```javascript
// skill-runner.js 不使用 type/command/endpoint/method
// 它直接执行 index.js 的 execute 函数
const result = await scriptExports.execute(toolName, params, context);
```

这证明了这些字段在当前架构中确实没有用处。
