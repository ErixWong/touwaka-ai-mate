# Skill Manager 查询工具优化

## 任务概述

为 skill-manager 技能添加 `list_skills` 和 `list_skill_details` 工具，提供技能和工具的查询能力。

## 背景

当前 skill-manager 只提供以下操作工具：
- `register_skill` - 注册技能
- `delete_skill` - 删除技能
- `assign_skill_to_expert` - 分配技能给专家 ❌ 已移除
- `unassign_skill_from_expert` - 取消分配 ❌ 已移除
- `toggle_skill` - 启用/禁用技能

**缺失能力**：无法查询数据库中已有的技能和工具列表，导致：
1. 技能专家不知道当前有哪些技能
2. 无法查看技能包含哪些工具
3. 难以进行技能管理决策

## 需求分析

### list_skills 工具

列出数据库中所有技能的精简列表（不含工具详情）。

**参数：**
- `is_active` (可选): 过滤启用/禁用状态
- `search` (可选): 按名称搜索

**返回：**
```json
{
  "success": true,
  "total": 5,
  "skills": [
    {
      "id": "xxx",
      "name": "searxng",
      "description": "搜索技能",
      "version": "1.0.0",
      "is_active": true,
      "source_path": "skills/searxng"
    }
  ]
}
```

### list_skill_details 工具

获取指定技能的完整详情，包括技能所有字段和工具定义列表。

**参数：**
- `skill_id` (必需): 技能ID或名称

**返回：**
```json
{
  "success": true,
  "skill": {
    "id": "xxx",
    "name": "searxng",
    "description": "搜索技能",
    "version": "1.0.0",
    "author": "Touwaka Team",
    "tags": ["search", "web"],
    "is_active": true,
    "source_path": "skills/searxng",
    "created_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-02T15:30:00Z"
  },
  "total": 2,
  "tools": [
    {
      "id": "xxx",
      "name": "web_search",
      "description": "搜索互联网",
      "parameters": { ... },
      "script_path": "index.js"
    }
  ]
}
```

## 设计决策

### 为什么 list_skills 不返回工具详情？

1. **职责分离**：`list_skills` 用于浏览，`list_skill_details` 用于获取详情
2. **性能优化**：避免不必要的 JOIN 查询
3. **LLM 友好**：先拿精简清单，对感兴趣的再用 id 获取详情

### 为什么移除 tool_count？

1. 既然有 `list_skill_details` 可以获取完整工具列表，`tool_count` 就多余了
2. 避免 LEFT JOIN + GROUP BY 带来的 SQL 复杂度和兼容性问题

## 实现计划

1. [x] 创建任务文档
2. [x] 移除 `assign_skill_to_expert` 和 `unassign_skill_from_expert` 工具
3. [x] 在 index.js 中添加 `list_skills` 工具实现（简化版，无 JOIN）
4. [x] 在 index.js 中添加 `list_skill_details` 工具实现（完整详情）
5. [x] 更新 `getTools()` 添加工具定义
6. [x] 更新 SKILL.md 文档
7. [x] 更新 TODO.md

## 验收标准

- [x] `list_skills` 能返回所有技能列表
- [x] `list_skills` 支持 `is_active` 过滤
- [x] `list_skills` 支持 `search` 模糊搜索
- [x] `list_skills` 不再返回 `tool_count`（简化）
- [x] `list_skill_details` 能返回技能完整字段 + 工具列表
- [x] 工具定义符合 JSON Schema 规范
- [x] SKILL.md 文档已更新
- [x] 移除了 assign/unassign 工具（技能分配需在网页端操作）

## 技术要点

- 复用现有的数据库连接池
- `list_skills` 简化为纯 skills 表查询（无 JOIN）
- `list_skill_details` 返回完整双层结构（skill + tools）
- 添加 `safeParseJson` 函数安全解析 JSON 字段

## 最终工具清单

| 工具名 | 功能 |
|--------|------|
| `register_skill` | 注册/更新技能 |
| `delete_skill` | 删除技能 |
| `toggle_skill` | 启用/禁用技能 |
| `list_skills` | 列出所有技能（精简列表） |
| `list_skill_details` | 获取技能完整详情（含工具） |
