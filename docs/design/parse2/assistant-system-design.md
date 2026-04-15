# 助理系统设计方案

> **状态：已实现** | 实现位置：`server/services/assistant/`
>
> 作为核心服务的助理系统，与 Skill 系统并行，支持异步委托和状态查询

---

## 1. 概述

### 1.1 设计理念

在专家系统中，Expert（专家）是主角，而 Assistants（助理）是专家的辅助团队。

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

### 1.2 术语定义

| 中文 | 英文 | 说明 |
|------|------|------|
| **委托** | Request | Expert 发起的助理调用 |
| **助理** | Assistant | 执行特定能力的 AI 角色 |
| **结果** | Result | 助理完成委托后返回的内容 |
| **任务** | Task | 用户工作目录中的任务（右侧 TabPage），与委托概念不同 |

> **注意**：使用"委托"而非"任务"，避免与现有工作目录任务混淆。

### 1.3 与 Skill 系统的关系

**助理系统与 Skill 系统是两套并行的系统：**

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

### 1.4 两套系统对比

| 维度 | 助理系统 (Assistant) | 技能系统 (Skill) |
|------|---------------------|------------------|
| **定位** | 核心服务 | 可插拔功能 |
| **执行位置** | 主进程内 | 子进程 (skill-runner) |
| **调用模式** | 异步委托 | 同步调用 |
| **流式支持** | ✅ 内部流式执行 | ❌ 同步阻塞 |
| **状态管理** | 数据库持久化 | 无状态 |
| **生命周期** | 随主进程 | 调用期间 |
| **配置方式** | 数据库 | SKILL.md + 数据库 |
| **典型用途** | LLM 调用、图像生成 | 文档处理、知识库搜索 |

---

## 2. 架构设计

### 2.1 整体架构

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
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 执行流程

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
│      ├─► 启动异步执行 executeRequest(requestId) ◄── 不等待             │
│      └─► 立即返回 request_id                                          │
│                                                                       │
│  [后台执行中...]                                                       │
│      │                                                                │
│      ▼                                                                │
│  executeRequest(requestId)                                            │
│      │                                                                │
│      ├─► 更新状态为 running                                            │
│      ├─► 流式调用模型 API ◄── 支持流式                                 │
│      ├─► （可选）流式执行工具调用 ◄── 支持流式                         │
│      ├─► 存储结果到数据库                                              │
│      └─► 更新状态为 completed/failed                                   │
└───────────────────────────────────────────────────────────────────────┘
```

**关键点**：
1. 整个流程都在主进程内完成，不涉及子进程
2. 助理内部调用 LLM 和工具时支持流式执行

### 2.3 流式执行设计

**助理内部支持流式执行**：

| 场景 | 流式支持 | 说明 |
|------|----------|------|
| **LLM 调用** | ✅ 支持 | 助理内部流式获取 LLM 响应，完成后返回最终结果 |
| **工具调用链** | ✅ 支持 | 助理内部流式执行多个工具，逐个处理 |
| **结果推送** | 可选 | 通过 SSE/WebSocket 向前端推送进度 |

**流式执行流程**：

```
AssistantManager.executeRequest(requestId)
        │
        ▼
    执行模式判断
        │
        ├── direct 模式 ──► 直接调用 API，等待结果
        │
        └── llm 模式 ──► 流式调用 LLM
                              │
                              ├── 收到 token → 可选：推送进度
                              │
                              ├── 需要工具调用？ ──► 执行工具 ──► 继续流式调用
                              │
                              └── 完成 → 存储最终结果
```

**注意**：流式执行是助理内部的实现细节，对 Expert 而言仍然是异步委托模式。Expert 只通过 `assistant_status` 获取最终结果。

### 2.4 工具注册

AssistantManager 作为核心服务，直接向 ToolManager 注册工具：

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `assistant_summon` | 召唤助理，立即返回委托ID | `type`, `input` |
| `assistant_status` | 查询委托状态和结果 | `request_id` |
| `assistant_roster` | 列出所有可用助理类型 | 无 |

**ToolManager 执行逻辑**：

```
ToolManager.executeTool(toolId, params)
    │
    ├─► 是核心工具？ ──► 直接调用 handler（主进程内）
    │
    └─► 是技能工具？ ──► 启动 skill-runner 子进程执行
```

### 2.5 执行模式

| 模式 | 描述 | 示例助理 |
|------|------|----------|
| **direct** | 直接调用 API，无 LLM 推理 | drawing, ocr |
| **llm** | 嵌套 LLM 调用，可选工具 | coding, math |
| **hybrid** | 先 LLM 推理，再调用 API | image_analysis |

### 2.6 上下文隔离

**问题**：如果 Assistant 的工具调用细节暴露给 Expert，会造成上下文爆炸、Token 浪费。

**解决方案**：完全隔离

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Expert 对话上下文                                │
│                                                                     │
│  ├── Tool: assistant_summon(type="ocr", input={image: "..."})       │
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
│  ├── System: "你是 OCR 助理，擅长识别文档..."                        │
│  ├── User: { image: "合同扫描件" }                                   │
│  ├── Tool: ocr_detect → "识别到文字..."                              │
│  └── 最终结果: "合同关键条款：1. 租期三年..."                         │
│                                                                     │
│  这个上下文对 Expert 不可见！完成后即销毁。                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 前端设计

### 3.1 用户交互流程

```
用户输入："帮我分析这张图片"
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Chat Interface                                                     │
│                                                                     │
│  User: 帮我分析这张图片                                              │
│                                                                     │
│  Expert: 我来召唤视觉助理处理...                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  🖼️ 视觉助理工作中...                              [查看详情] │   │
│  │                                                              │   │
│  │  🔄 处理中...                                                │   │
│  │  已运行: 5 秒 / 预计 30 秒                                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [用户可以继续输入其他内容，不阻塞]                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 组件清单

| 组件 | 文件 | 职责 |
|------|------|------|
| **AssistantRequestCard** | `AssistantRequestCard.vue` | 委托卡片，显示状态、时间、结果 |
| **AssistantResult** | `AssistantResult.vue` | 结果展示组件 |
| **AssistantRoster** | `AssistantRoster.vue` | 助理列表（管理界面） |

### 3.3 状态展示

| 状态 | 展示内容 |
|------|----------|
| **pending** | ⏳ 等待处理... 预计等待: ~30 秒 |
| **running** | 🔄 处理中... 已运行: 15 秒 / 预计 30 秒 [取消] |
| **completed** | ✅ 12秒完成 [查看详情] |
| **failed** | ❌ 失败 错误: 图片格式不支持 [重试] |

---

## 4. 数据库设计

### 4.1 assistants 表（助理配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `assistant_type` | VARCHAR(32) | 主键，助理类型 |
| `name` | VARCHAR(128) | 显示名称 |
| `icon` | VARCHAR(32) | 图标 |
| `description` | TEXT | 能力描述 |
| `model_id` | VARCHAR(32) | 关联 ai_models.id |
| `prompt_template` | TEXT | 系统提示词模板 |
| `max_tokens` | INT | 默认 4096 |
| `temperature` | DECIMAL(3,2) | 默认 0.7 |
| `estimated_time` | INT | 预估执行时间（秒），默认 30 |
| `timeout` | INT | 超时时间（秒），默认 120 |
| `tool_name` | VARCHAR(64) | 工具名称，如 ocr_analyze |
| `tool_description` | TEXT | 工具描述 |
| `tool_parameters` | JSON | JSON Schema 格式的参数定义 |
| `can_use_skills` | BIT | 是否允许助理调用 Expert 的技能，默认 0 |
| `execution_mode` | ENUM | 执行模式：direct/llm/hybrid |
| `is_active` | BIT | 是否启用 |

### 4.2 assistant_requests 表（委托记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| `request_id` | VARCHAR(64) | 主键，委托ID |
| `assistant_type` | VARCHAR(32) | 助理类型 |
| `expert_id` | VARCHAR(32) | 调用专家ID |
| `contact_id` | VARCHAR(64) | 联系人ID |
| `user_id` | VARCHAR(32) | 用户ID |
| `topic_id` | VARCHAR(32) | 话题ID |
| `status` | ENUM | pending/running/completed/failed/timeout |
| `input` | JSON | 输入参数 |
| `result` | LONGTEXT | 执行结果 |
| `error_message` | TEXT | 错误信息 |
| `tokens_input` | INT | 输入 Token 数 |
| `tokens_output` | INT | 输出 Token 数 |
| `model_used` | VARCHAR(128) | 实际使用的模型 |
| `latency_ms` | INT | 执行耗时（毫秒） |
| `created_at` | DATETIME | 创建时间 |
| `started_at` | DATETIME | 开始执行时间 |
| `completed_at` | DATETIME | 完成时间 |

---

## 5. API 设计

### 5.1 端点列表

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/assistants` | GET | 列出可用助理 |
| `/api/assistants/call` | POST | 召唤助理 |
| `/api/assistants/requests/:request_id` | GET | 查询委托状态 |
| `/api/assistants/requests` | GET | 查询委托列表 |

### 5.2 召唤助理

**请求**：`POST /api/assistants/call`

```json
{
  "assistant_type": "ocr",
  "input": {
    "image": "https://example.com/image.png"
  }
}
```

**响应**：

```json
{
  "request_id": "req_abc123",
  "assistant_type": "ocr",
  "status": "pending",
  "estimated_time": 30,
  "message": "助理已召唤，预计 30 秒完成"
}
```

### 5.3 查询委托状态

**请求**：`GET /api/assistants/requests/:request_id`

**响应**：

```json
{
  "request_id": "req_abc123",
  "assistant_type": "ocr",
  "status": "completed",
  "result": "识别到的文字内容...",
  "tokens_input": 150,
  "tokens_output": 500,
  "latency_ms": 3200,
  "created_at": "2024-01-01T10:00:00Z",
  "completed_at": "2024-01-01T10:00:03Z"
}
```

---

## 6. 实施步骤

| 步骤 | 任务 | 文件 | 时间 |
|------|------|------|------|
| 1 | 创建数据库表 | `scripts/migrate-assistants.js` | 0.5h |
| 2 | 实现 AssistantManager 服务 | `services/assistant-manager.js` | 2h |
| 3 | 实现 HTTP API 路由 | `routes/assistants.js` | 1h |
| 4 | 注册核心工具到 ToolManager | `lib/tool-manager.js` | 0.5h |
| 5 | 前端组件实现 | `src/components/` | 2h |
| 6 | 测试验证 | - | 1h |
| **总计** | | | **7h** |

> **注意**：助理由管理员通过后台界面创建，使用 `ai_models` 表中已配置的模型。

---

## 7. 风险与缓解

### 8.1 主进程崩溃风险

**风险**：Assistant Manager 在主进程中，崩溃可能影响整个服务。

**缓解措施**：

1. **单任务隔离**：每个任务独立 try-catch
2. **模型调用超时**：防止模型 API 阻塞
3. **数据库持久化**：任务状态实时写入，主进程重启后可恢复

### 8.2 内存占用

**风险**：大量并发任务占用内存。

**缓解措施**：

1. **任务队列限制**：最大并发数（如 10 个）
2. **任务完成后清理**：释放内存

---

## 术语对照表

| 中文 | 英文 | 说明 |
|------|------|------|
| **委托** | Request | Expert 发起的助理调用 |
| **助理** | Assistant | 执行特定能力的 AI 角色 |
| **结果** | Result | 助理返回的内容 |
| **任务** | Task | 用户工作目录中的任务（右侧 TabPage）|

---

*创建时间: 2026-03-10*
*更新时间: 2026-03-10*
*状态: 设计方案 v7（精简：移除初始数据，说明助理由管理员创建）*