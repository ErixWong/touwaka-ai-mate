# 助理系统架构说明

> **版本**: v1.0
> **创建时间**: 2026-03-11
> **相关任务**: #67 助理系统设计, #87 内部消息链路, #88 Summon 输入优化, #91 前端面板

---

## 1. 概述

### 1.1 设计理念

在 Touwaka Mate 的双心智架构中，**Expert（专家）是主角，Assistant（助理）是专家调度的执行单元**。

```
┌─────────────────────────────────────────────┐
│                  Expert (专家)               │
│                                             │
│  "我是法律专家，遇到图像分析问题时           │
│   我会召唤我的视觉助理来帮忙"               │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │         Assistants (助理团队)        │   │
│  │                                     │   │
│  │  📝 OCR 助理     💻 编程助理         │   │
│  │  🎨 画图助理     🔢 数学助理         │   │
│  │  🖼️ 视觉助理     ...                │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**核心原则**：
- 助理不是用户直接使用的主角色，而是 Expert 的外援
- 用户始终与 Expert 对话，由 Expert 决定何时委托助理
- 委托完成后结果回到 Expert，继续与用户对话

### 1.2 术语定义

| 中文 | 英文 | 说明 |
|------|------|------|
| **委托** | Request | Expert 发起的助理调用 |
| **助理** | Assistant | 执行特定能力的 AI 角色 |
| **结果** | Result | 助理完成委托后返回的内容 |
| **任务** | Task | 用户工作目录中的任务（右侧 TabPage），与委托概念不同 |

---

## 2. 系统架构

### 2.1 与 Skill 系统的关系

助理系统与 Skill 系统是**两套并行的系统**：

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Touwaka Mate (主进程)                            │
│                                                                     │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐   │
│  │     Assistant System        │  │       Skill System          │   │
│  │     (助理系统)              │  │       (技能系统)             │   │
│  │                             │  │                             │   │
│  │  • 核心服务，主进程内执行    │  │  • 可插拔，子进程执行        │   │
│  │  • 异步委托模式             │  │  • 同步调用模式             │   │
│  │  • 状态持久化到数据库        │  │  • 无状态                   │   │
│  │                             │  │                             │   │
│  │  工具：assistant_summon     │  │  工具：kb-search_query      │   │
│  │        assistant_status     │  │        docx_create          │   │
│  │        assistant_roster     │  │        pptx_add_slide       │   │
│  └─────────────────────────────┘  └─────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                     ToolManager                              │    │
│  │                                                              │    │
│  │  统一管理两类工具：                                          │    │
│  │  ├── 核心工具（Assistant）→ 直接在主进程执行                 │    │
│  │  └── 技能工具（Skill）→ 通过 skill-runner 子进程执行         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 两套系统对比

| 维度 | 助理系统 (Assistant) | 技能系统 (Skill) |
|------|---------------------|------------------|
| **定位** | 核心服务 | 可插拔功能 |
| **执行位置** | 主进程内 | 子进程 (skill-runner) |
| **调用模式** | 异步委托 | 同步调用 |
| **流式支持** | ✅ 内部流式执行 | ❌ 同步阻塞 |
| **状态管理** | 数据库持久化 | 无状态 |
| **生命周期** | 随主进程 | 调用期间 |
| **配置方式** | 数据库 | SKILL.md + 数据库 |
| **典型用途** | LLM 调用、图像分析 | 文档处理、知识库搜索 |

### 2.3 核心服务架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Touwaka Mate (主进程)                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   Core Services                               │   │
│  │                                                               │   │
│  │  Database Pool    Logger        ModelClient                  │   │
│  │                                                               │   │
│  │  ┌────────────────────────────────────────────────────────┐  │   │
│  │  │            AssistantManager                             │  │   │
│  │  │                                                        │  │   │
│  │  │  • requests: Map<requestId, Request>  内存委托队列     │  │   │
│  │  │  • assistants: Map<type, Config>     助理配置缓存      │  │   │
│  │  │                                                        │  │   │
│  │  │  Methods:                                              │  │   │
│  │  │  • summon(type, input) → requestId  召唤助理           │  │   │
│  │  │  • status(requestId) → Status       查询状态           │  │   │
│  │  │  • roster() → Assistant[]          列出助理            │  │   │
│  │  │  • executeRequest(requestId)       异步执行            │  │   │
│  │  └────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    HTTP API Layer                             │   │
│  │                                                               │   │
│  │  POST /api/assistants/call              → summon()           │   │
│  │  GET  /api/assistants/requests/:id      → status()           │   │
│  │  GET  /api/assistants                   → roster()           │   │
│  │  GET  /api/assistants/requests/:id/messages → messages()    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 执行流程

### 3.1 整体流程

```
Expert 调用 assistant_summon 工具
        │
        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                     Touwaka Mate 主进程                                │
│                                                                       │
│  ToolManager.executeTool('assistant_summon', params)                  │
│      │                                                                │
│      ▼                                                                │
│  AssistantManager.summon(type, input)                                 │
│      │                                                                │
│      ├─► 创建委托记录（DB + 内存）                                     │
│      ├─► 写入 assistant_messages (task)                               │
│      ├─► 启动异步执行 executeRequest(requestId) ◄── 不等待             │
│      └─► 立即返回 request_id                                          │
│                                                                       │
│  [后台执行中...]                                                       │
│      │                                                                │
│      ▼                                                                │
│  executeRequest(requestId)                                            │
│      │                                                                │
│      ├─► 更新状态为 running                                            │
│      ├─► 写入 assistant_messages (status)                             │
│      ├─► 根据执行模式处理                                              │
│      │       ├─► direct: 直接调用 API                                  │
│      │       ├─► llm: 流式调用 LLM                                     │
│      │       └─► hybrid: 先工具，再 LLM                                │
│      ├─► 写入工具调用消息 (tool_call / tool_result)                    │
│      ├─► 存储结果到数据库                                              │
│      ├─► 写入 assistant_messages (final)                              │
│      └─► 更新状态为 completed/failed                                   │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.2 执行模式

| 模式 | 描述 | 示例助理 |
|------|------|----------|
| **direct** | 直接调用 API，无 LLM 推理 | drawing, ocr |
| **llm** | 嵌套 LLM 调用，可选工具 | coding, math |
| **hybrid** | 先工具/推理，再调用 LLM | doc_image_analyzer |

### 3.3 上下文隔离

Assistant 的内部执行过程对 Expert 完全隔离：

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Expert 对话上下文                                │
│                                                                     │
│  ├── Tool: assistant_summon(type="vision", input={image: "..."})   │
│  ├── Result: { request_id: "req_123" }                              │
│  │                                                                  │
│  ├── Tool: assistant_status(request_id="req_123")                   │
│  ├── Result: {                                                      │
│  │     status: "completed",                                         │
│  │     result: "合同关键条款：1. 租期三年..."  ◄── 只有最终结果      │
│  │   }                                                              │
│  └── Expert: "根据识别结果，这份合同需要注意..."                     │
│                                                                     │
│  Expert 只知道：召唤助理 → 获得结果                                  │
└─────────────────────────────────────────────────────────────────────┘

                    ║
                    ║ 完全隔离
                    ║

┌─────────────────────────────────────────────────────────────────────┐
│                     Assistant 内部上下文（独立）                     │
│                                                                     │
│  ├── System: "你是视觉助理，擅长分析图片..."                         │
│  ├── User: { image: "合同扫描件" }                                   │
│  ├── Tool: read_image_for_vision → "已读取图片..."                   │
│  ├── LLM: 调用多模态模型                                             │
│  └── 最终结果: "合同关键条款：1. 租期三年..."                         │
│                                                                     │
│  这个上下文对 Expert 不可见！完成后即销毁。                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. 工具系统

### 4.1 核心工具

AssistantManager 向 ToolManager 注册三个核心工具：

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `assistant_summon` | 召唤助理，立即返回委托ID | `type`, `task`, `background`, `input`, `expected_output`, `workspace` |
| `assistant_status` | 查询委托状态和结果 | `request_id` |
| `assistant_roster` | 列出所有可用助理类型 | 无 |

### 4.2 LLM 可见的工具定义

```json
{
  "tools": [
    {
      "name": "assistant_summon",
      "description": "召唤助理来处理特定任务。助理是异步执行的，会立即返回委托ID。",
      "parameters": {
        "type": { "type": "string", "description": "助理类型" },
        "task": { "type": "string", "description": "任务描述" },
        "input": { "type": "object", "description": "具体输入数据" }
      }
    },
    {
      "name": "assistant_status",
      "description": "查询委托状态和结果",
      "parameters": {
        "request_id": { "type": "string", "description": "委托ID" }
      }
    },
    {
      "name": "assistant_roster",
      "description": "列出所有可用的助理类型",
      "parameters": {}
    }
  ]
}
```

### 4.3 工具继承机制

Assistant 可以继承 Expert 的工具，以便在执行任务时调用：

```json
{
  "assistant_type": "coding",
  "task": "分析代码并生成文档",
  "input": { "file_path": "/src/main.js" },
  "inherited_tools": ["fs-read", "fs-write", "docx-create"],
  "workspace": {
    "expert_id": "expert_dev",
    "workdir": "/workspace/project"
  }
}
```

---

## 5. 输入结构

### 5.1 Summon 请求结构

```typescript
interface AssistantSummonRequest {
  // 必填：助理类型
  assistant_type: string

  // 必填：任务描述（一句话说明要做什么）
  task: string

  // 可选：任务背景（为什么需要这个任务）
  background?: string

  // 必填：具体输入数据
  input: Record<string, any>

  // 可选：期望输出格式
  expected_output?: {
    format?: string          // "markdown" | "json" | "text"
    focus?: string[]         // 关注点列表
    max_length?: number      // 最大输出长度
  }

  // 可选：工作空间上下文
  workspace?: {
    topic_id?: string        // 话题ID
    expert_id?: string       // 调用专家ID
    workdir?: string         // 工作目录
  }

  // 可选：继承的工具列表
  inherited_tools?: string[]
}
```

### 5.2 完整示例

```json
{
  "assistant_type": "doc_image_analyzer",
  "task": "识别图片中的合同关键条款",
  "background": "这是用户上传的租赁合同截图，需要后续做法律风险分析",
  "input": {
    "file_path": "/workspace/topic_123/contract.png"
  },
  "expected_output": {
    "format": "markdown",
    "focus": ["租期", "付款方式", "违约责任"]
  },
  "workspace": {
    "topic_id": "topic_123",
    "expert_id": "expert_lawyer",
    "workdir": "/workspace/topic_123"
  }
}
```

---

## 6. 数据模型

### 6.1 表结构关系

```
assistants (1) ──────── (N) assistant_requests
                              │
                              └── (1) ──────── (N) assistant_messages
```

### 6.2 assistants 表（助理配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `assistant_type` | VARCHAR(32) | 主键，助理类型 |
| `name` | VARCHAR(128) | 显示名称 |
| `icon` | VARCHAR(32) | 图标 |
| `description` | TEXT | 能力描述 |
| `model_id` | VARCHAR(32) | 关联 ai_models.id |
| `prompt_template` | TEXT | 系统提示词模板 |
| `execution_mode` | ENUM | 执行模式：direct/llm/hybrid |
| `can_use_skills` | BIT | 是否允许调用 Expert 的技能 |
| `is_active` | BIT | 是否启用 |

### 6.3 assistant_requests 表（委托记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| `request_id` | VARCHAR(64) | 主键，委托ID |
| `assistant_type` | VARCHAR(32) | 助理类型 |
| `expert_id` | VARCHAR(32) | 调用专家ID |
| `user_id` | VARCHAR(32) | 用户ID |
| `topic_id` | VARCHAR(32) | 话题ID |
| `status` | ENUM | pending/running/completed/failed/timeout |
| `input` | JSON | 输入参数（完整请求结构） |
| `result` | LONGTEXT | 执行结果 |
| `error_message` | TEXT | 错误信息 |
| `latency_ms` | INT | 执行耗时（毫秒） |

### 6.4 assistant_messages 表（内部消息）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | BIGINT | 主键 |
| `request_id` | VARCHAR(64) | 关联委托ID |
| `role` | ENUM | expert/assistant/tool/system |
| `message_type` | ENUM | task/tool_call/tool_result/final/error/status |
| `content` | LONGTEXT | 文本内容 |
| `tool_name` | VARCHAR(128) | 工具名称 |
| `sequence_no` | INT | 顺序号 |

---

## 7. 内部消息链路

### 7.1 消息类型

| message_type | 说明 | MVP |
|--------------|------|:---:|
| `task` | Expert 委托任务包 | ✅ |
| `tool_call` | Assistant 发起工具调用 | ✅ |
| `tool_result` | 工具返回结果摘要 | ✅ |
| `final` | Assistant 最终结果 | ✅ |
| `error` | 错误消息 | ✅ |
| `status` | 状态变更记录 | ✅ |

### 7.2 执行时间线示例

```
T0 ── Expert 委托
T1 ── 系统状态变更 (running)
T2 ── 工具调用 (read_image_for_vision)
T3 ── 工具返回 (图片已读取)
T4 ── 调用视觉模型
T5 ── 最终结果
```

| seq | role | message_type | content_preview |
|:---:|------|--------------|-----------------|
| 1 | expert | task | 任务：识别图片中的合同关键条款 |
| 2 | system | status | Assistant 开始执行 |
| 3 | tool | tool_call | 调用 read_image_for_vision |
| 4 | tool | tool_result | 已读取图片 (image/png, 120KB) |
| 5 | assistant | final | 合同关键条款如下：1. 租期三年... |

### 7.3 消息服务

```javascript
// 便捷写入方法
await messageService.appendTaskMessage(requestId, { task, background, input })
await messageService.appendStatusMessage(requestId, 'running', 'Assistant 开始执行')
await messageService.appendToolCallMessage(requestId, toolName, argsSummary, toolCallId)
await messageService.appendToolResultMessage(requestId, toolName, resultSummary, toolCallId)
await messageService.appendFinalMessage(requestId, content, tokens, latency)
await messageService.appendErrorMessage(requestId, error)
```

---

## 8. 前端集成

### 8.1 位置：专家页右侧面板

```
┌─────────────────────────────────────────────────────┐
│ 专家页                                              │
├─────────────────────┬───────────────────────────────┤
│                     │  [专家] [话题] [任务] [助理] [调试] │
│    主聊天区          ├───────────────────────────────┤
│                     │                               │
│  用户: 帮我看看     │   助理面板                    │
│  这张合同...        │                               │
│                     │   ┌─────────────────────────┐ │
│  专家: 我来调用     │   │ 可用助理列表            │ │
│  视觉助理...        │   │ ├─ 视觉助理  ✅ 可用    │ │
│                     │   │ └─ OCR助理   ✅ 可用    │ │
│                     │   └─────────────────────────┘ │
│                     │                               │
│                     │   ┌─────────────────────────┐ │
│                     │   │ 当前委托列表            │ │
│                     │   │ ├─ 视觉助理  处理中 3s  │ │
│                     │   │ └─ OCR助理   ✅ 已完成  │ │
│                     │   └─────────────────────────┘ │
└─────────────────────┴───────────────────────────────┘
```

### 8.2 面板内容

1. **可用助理列表** - 显示所有 `is_active = true` 的助理
2. **当前委托列表** - 显示当前专家最近发起的委托
3. **委托详情** - 点击后展开消息时间线

### 8.3 数据流

```
┌──────────────────────────────────────────────────────────────┐
│                        专家页                                 │
│  ┌────────────────────┐    ┌────────────────────────────┐   │
│  │                    │    │  助理 Tab                   │   │
│  │    主聊天区         │    │                            │   │
│  │                    │    │  GET /assistants           │   │
│  │  Expert 调用        │    │  GET /requests?expert_id= │   │
│  │  assistant_summon  │    │  GET /requests/:id/messages│   │
│  │        │           │    │                            │   │
│  │        ▼           │    │  轮询更新处理中的委托       │   │
│  │  [助理已完成]       │    │                            │   │
│  │  显示结果          │    │                            │   │
│  └────────────────────┘    └────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. API 参考

### 9.1 端点列表

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/assistants` | GET | 列出可用助理 |
| `/api/assistants/call` | POST | 召唤助理 |
| `/api/assistants/requests` | GET | 查询委托列表 |
| `/api/assistants/requests/:request_id` | GET | 查询委托状态 |
| `/api/assistants/requests/:request_id/messages` | GET | 查询委托内部消息 |

### 9.2 召唤助理

**请求**: `POST /api/assistants/call`

```json
{
  "assistant_type": "doc_image_analyzer",
  "task": "识别图片中的合同关键条款",
  "background": "这是用户上传的租赁合同截图",
  "input": {
    "file_path": "/workspace/contract.png"
  },
  "expected_output": {
    "format": "markdown",
    "focus": ["租期", "违约责任"]
  }
}
```

**响应**:

```json
{
  "request_id": "req_abc123",
  "assistant_type": "doc_image_analyzer",
  "status": "pending",
  "estimated_time": 20
}
```

### 9.3 查询委托状态

**请求**: `GET /api/assistants/requests/:request_id`

**响应**:

```json
{
  "request_id": "req_abc123",
  "status": "completed",
  "result": "合同关键条款：\n1. 租期三年\n2. 月租金...",
  "latency_ms": 5200,
  "tokens_input": 150,
  "tokens_output": 500
}
```

---

## 10. 实现文件

### 10.1 后端

| 文件 | 说明 |
|------|------|
| `server/services/assistant-manager.js` | 核心服务，管理助理生命周期 |
| `server/controllers/assistant.controller.js` | HTTP API 控制器 |
| `models/assistant.js` | 助理配置模型 |
| `models/assistant_request.js` | 委托记录模型 |
| `models/assistant_message.js` | 内部消息模型 |
| `lib/tool-manager.js` | 工具注册与执行 |

### 10.2 前端

| 文件 | 说明 |
|------|------|
| `frontend/src/stores/assistant.ts` | 状态管理 |
| `frontend/src/components/panel/AssistantTab.vue` | 助理面板主组件 |
| `frontend/src/api/services.ts` | API 调用 |

---

## 11. 后续扩展

1. **多轮追问** - 通过 `parent_request_id` 串联关联委托
2. **子委托链路** - 助理召唤助理
3. **手动召唤** - 用户手动点击助理卡片发起委托
4. **统计面板** - 助理调用频率、成功率、耗时统计
5. **Expert Prompt 增强** - 在 Expert 提示词中引导 LLM 调用助理

---

*创建时间: 2026-03-11*