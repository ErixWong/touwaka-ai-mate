# 工具 ID 重构：使用 skill_tools.id 作为 tool_name

> 创建日期：2026-02-24
> 状态：⏳ 待开始
> 优先级：高

---

## 背景

当前实现使用 `skillId_toolName` 作为 LLM 调用的工具名称，例如 `mm0o9un9nbdcy31jfsxr_web_search`。这种方式：
- 在日志和 UI 中显示不友好
- 用户看到的是随机 ID 而非有意义的名称

## 解决方案

使用 `skill_tools` 表的独立 `id` 字段作为 LLM 调用的 `tool_name`，在显示层转换为友好名称。

---

## 数据结构

### skill_tools 表

```sql
CREATE TABLE skill_tools (
  id VARCHAR(32) PRIMARY KEY,           -- 工具唯一 ID（作为 LLM 调用的 tool_name）
  skill_id VARCHAR(64) NOT NULL,        -- 所属技能 ID
  name VARCHAR(64) NOT NULL,            -- 工具名称（如 web_search）
  description TEXT,                     -- 工具描述
  type ENUM('http', 'script', 'builtin'),
  usage TEXT,                           -- 参数定义 JSON
  command VARCHAR(512),                 -- 执行命令
  endpoint VARCHAR(512),                -- HTTP 端点
  method VARCHAR(16),                   -- HTTP 方法
  UNIQUE KEY idx_skill_name (skill_id, name)
);
```

### 示例数据

```
┌──────────────────────┬──────────────────────┬─────────────┬─────────────┐
│ id (PK)              │ skill_id (FK)        │ name        │ description │
├──────────────────────┼──────────────────────┼─────────────┼─────────────┤
│ abc123tool456        │ mm0o9un9nbdcy31jfsxr │ web_search  │ 搜索网络    │
│ def789tool012        │ mm0o9un9nbdcy31jfsxr │ image_search│ 搜索图片    │
│ xyz789tool345        │ weather456           │ get_weather │ 查询天气    │
└──────────────────────┴──────────────────────┴─────────────┴─────────────┘
```

---

## 工具调用完整流程

### 1. 初始化阶段（专家服务创建时）

```
ToolManager.initialize()
    ↓
SkillLoader.loadSkillsForExpert(expertId)
    ↓
数据库查询: SELECT * FROM skills JOIN expert_skills ...
    ↓
SkillLoader.loadSkillTools(skill)
    ↓
数据库查询: SELECT * FROM skill_tools WHERE skill_id = ?
    ↓
convertToolToOpenAIFormat() → 生成工具定义:
{
  type: 'function',
  function: {
    name: 'abc123tool456',  ← 使用 skill_tools.id 作为 tool_name
    description: '搜索网络...',
    parameters: { ... }
  },
  _meta: {
    toolId: 'abc123tool456',        ← 工具 ID
    skillId: 'mm0o9un9nbdcy31jfsxr', ← 所属技能 ID
    skillName: 'SearXNG Search',     ← 技能名称（用于显示）
    toolName: 'web_search',          ← 工具名称（用于执行）
    toolDisplayName: '网页搜索',      ← 工具显示名称
    sourcePath: 'data/skills/searxng',
    command: 'node index.js',
  }
}
    ↓
toolRegistry.set('abc123tool456', { skillId, skillName, toolName, ... })
toolToSkill.set('abc123tool456', 'mm0o9un9nbdcy31jfsxr')
```

### 2. 注入上下文阶段（发送消息时）

```
chat-service.js:
    ↓
const tools = toolManager.getToolDefinitions()
    ↓
llmClient.callStream(modelConfig, messages, { tools })
    ↓
发送给 LLM:
{
  "messages": [...],
  "tools": [
    { "type": "function", "function": {
        "name": "abc123tool456",        ← 使用 skill_tools.id
        "description": "搜索网络...",
        "parameters": { ... }
    }}
  ]
}
```

### 3. LLM 决定调用工具

```
LLM 返回（流式）:
{
  "choices": [{
    "delta": {
      "tool_calls": [{
        "id": "call_xyz789",
        "function": {
          "name": "abc123tool456",  ← LLM 原样返回 tool_name
          "arguments": "{\"query\":\"上海天气\"}"
        }
      }]
    }
  }]
}
```

### 4. 程序处理工具调用

```
chat-service.js:
    ↓
onToolCall(toolCalls)  // 收集工具调用
    ↓
toolManager.executeToolCalls(toolCalls, context)
    ↓
for (call of toolCalls):
    toolId = call.function.name  // 'abc123tool456'
    params = JSON.parse(call.function.arguments)
    ↓
executeTool(toolId, params, context)
    ↓
toolInfo = toolRegistry.get(toolId)  // 查映射表
// toolInfo = {
//   skillId: 'mm0o9un9nbdcy31jfsxr',
//   skillName: 'SearXNG Search',
//   toolName: 'web_search',
//   sourcePath: 'data/skills/searxng',
//   ...
// }
    ↓
// 日志显示友好名称
logger.info(`[ToolManager] 执行工具: ${toolInfo.skillName}/${toolInfo.toolName}`)
// 输出: [ToolManager] 执行工具: SearXNG Search/web_search
    ↓
skillLoader.executeSkillTool(toolInfo.skillId, toolInfo.toolName, params, context)
    ↓
启动子进程执行技能代码...
```

### 5. 返回结果给 LLM

```
formatToolResultsForLLM(results)
    ↓
返回给 LLM:
{
  role: 'tool',
  tool_call_id: 'call_xyz789',
  name: 'abc123tool456',  ← 使用原始 tool_name
  content: '{"success": true, "data": {...}}'
}
```

---

## 内存数据结构

### toolRegistry（工具注册表）

```javascript
toolRegistry = Map {
  "abc123tool456" => {
    toolId: "abc123tool456",
    skillId: "mm0o9un9nbdcy31jfsxr",
    skillName: "SearXNG Search",
    toolName: "web_search",
    toolDisplayName: "网页搜索",
    sourcePath: "data/skills/searxng",
    command: "node index.js",
    type: "script",
  },
  "def789tool012" => {
    toolId: "def789tool012",
    skillId: "mm0o9un9nbdcy31jfsxr",
    skillName: "SearXNG Search",
    toolName: "image_search",
    toolDisplayName: "图片搜索",
    sourcePath: "data/skills/searxng",
    command: "node index.js",
    type: "script",
  }
}
```

### skills（技能对象）

```javascript
skills = Map {
  "mm0o9un9nbdcy31jfsxr" => {
    id: "mm0o9un9nbdcy31jfsxr",
    name: "SearXNG Search",
    description: "搜索互联网获取信息",
    tools: [
      { function: { name: "abc123tool456" }, _meta: { toolName: "web_search" } },
      { function: { name: "def789tool012" }, _meta: { toolName: "image_search" } },
    ]
  }
}
```

---

## 显示层转换

### 日志

```javascript
function formatToolDisplay(toolId, toolRegistry) {
  const info = toolRegistry.get(toolId);
  if (!info) return toolId;
  return `${info.skillName}/${info.toolName}`;
}

// 使用
logger.info(`[ToolManager] 执行工具: ${formatToolDisplay(toolId)}`);
// 输出: [ToolManager] 执行工具: SearXNG Search/web_search
```

### 前端 API

```javascript
// 返回格式
{
  toolId: "abc123tool456",
  displayName: "SearXNG Search/网页搜索",
  skillName: "SearXNG Search",
  toolName: "web_search",
  // ...
}
```

### 前端 UI

- 显示 `displayName`（如 "SearXNG Search/网页搜索"）
- Hover 时显示完整 `toolId`

---

## 修改清单

### 后端

| 文件 | 修改内容 |
|------|----------|
| `lib/skill-loader.js` | 1. `convertToolToOpenAIFormat()` 使用 `toolRow.id` 作为 `function.name`<br>2. `_meta` 添加 `toolId`、`skillName`、`toolDisplayName` |
| `lib/tool-manager.js` | 1. 新增 `toolRegistry` Map<br>2. `registerSkill()` 填充 `toolRegistry`<br>3. `executeTool()` 从 `toolRegistry` 获取信息<br>4. 新增 `formatToolDisplay()` 方法 |
| `lib/chat-service.js` | 工具调用日志使用 `formatToolDisplay()` |

### 前端

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/components/panel/DebugTab.vue` | 显示友好工具名称 |
| `frontend/src/views/ChatView.vue` | 工具调用显示友好名称 |

---

## 优点

1. **唯一性**：`skill_tools.id` 是主键，绝对唯一
2. **精确性**：直接定位到具体工具，无需解析
3. **显示友好**：日志和 UI 显示有意义的名称
4. **可追溯**：需要时可以显示完整 ID
5. **无需改数据库**：`skill_tools` 表已有 `id` 字段

---

## 注意事项

1. **skill_tools.id 生成**：确保创建工具时生成唯一 ID（使用 `Utils.newID()`）
2. **内置工具**：内置工具没有数据库记录，需要特殊处理（使用 `builtin_toolName` 格式）
3. **缓存清理**：技能更新时需要清理 `toolRegistry` 缓存
