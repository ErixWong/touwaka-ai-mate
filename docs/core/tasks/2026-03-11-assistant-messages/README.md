# Assistant Messages 内部消息链路设计

> **关联任务**: #87 助理系统内部通信
> **创建时间**: 2026-03-11
> **状态**: ✅ 已实现

---

## 1. 设计背景

### 1.1 当前状态

助理系统已具备：
- `assistants` - 助理配置表
- `assistant_requests` - 委托主表
- `assistant_summon / assistant_status / assistant_roster` - 核心工具
- `direct / llm / hybrid` 三种执行模式

### 1.2 问题分析

缺少**内部过程消息链**导致以下问题：

| 问题 | 影响 |
|------|------|
| 无法追踪 Expert 如何向 Assistant 委托任务 | 审计困难 |
| 无法查看 Assistant 中间过程（工具调用、错误、重试） | 调试困难 |
| 无法支持"对同一委托继续追问"的多轮协作 | 功能受限 |
| 仅靠 `assistant_requests.result` 不利于调试与审计 | 信息不足 |
| 把所有中间过程写入主 `messages` 会污染用户对话上下文 | 用户体验差 |

---

## 2. 设计目标

`assistant_messages` 需要满足：

- **过程可追踪** - 记录委托、思考、工具调用、结果、错误等关键节点
- **上下文隔离** - 不默认暴露给用户主对话
- **便于调试** - 查看失败步骤、重试行为、工具返回摘要
- **支持审计** - 保留关键执行痕迹
- **支持扩展** - 后续支持多轮追问、子委托、多助理协作
- **分层展示** - 普通模式只看摘要，调试模式可展开细节

---

## 3. 核心定位

### 3.1 表职责分工

```
┌─────────────────────────────────────────────────────────────────┐
│                        messages                                  │
│  用户 ↔ Expert 主对话；系统回注到主对话的通知消息                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    assistant_requests                            │
│  委托主表，记录一次助理调用的生命周期                              │
│  - 谁发起的                                                       │
│  - 调用哪个助理                                                   │
│  - 当前状态                                                       │
│  - 最终结果                                                       │
│  - 开始/完成时间、token、耗时统计                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    assistant_messages (新增)                     │
│  Expert ↔ Assistant 内部过程消息表                                │
│  - Expert 发给 Assistant 的任务包                                 │
│  - Assistant 的中间响应                                           │
│  - 工具调用摘要                                                   │
│  - 工具结果摘要                                                   │
│  - 错误与重试                                                     │
│  - 最终结果消息                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 表关系

```
assistant_requests (1) ──────── (N) assistant_messages
        │
        └── 一条委托主记录
                    │
                    └── 该委托下的多条过程消息
```

### 3.3 为什么不能只用 assistant_requests.result

| 需求 | assistant_requests.result | assistant_messages |
|------|---------------------------|-------------------|
| 最终输出 | ✅ 适合 | ❌ 不需要 |
| 工具调用链 | ❌ 不适合 | ✅ 适合 |
| 重试过程 | ❌ 不适合 | ✅ 适合 |
| 错误路径 | ❌ 不适合 | ✅ 适合 |
| 多轮追问 | ❌ 不适合 | ✅ 适合 |
| 审计痕迹 | ❌ 不适合 | ✅ 适合 |

---

## 4. 数据模型设计

### 4.1 表结构

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|:----:|------|
| `id` | BIGINT AUTO_INCREMENT | 是 | 主键 |
| `request_id` | VARCHAR(64) | 是 | 关联 `assistant_requests.request_id` |
| `parent_message_id` | VARCHAR(64) | 否 | 父消息 ID，用于树状结构/子步骤 |
| `role` | ENUM | 是 | `expert` / `assistant` / `tool` / `system` |
| `message_type` | ENUM | 是 | 消息类型，见下文 |
| `content` | LONGTEXT | 否 | 文本内容 |
| `content_preview` | VARCHAR(512) | 否 | 摘要，用于列表展示 |
| `tool_name` | VARCHAR(128) | 否 | 工具名称（仅工具相关消息） |
| `tool_call_id` | VARCHAR(64) | 否 | 工具调用链路 ID |
| `status` | ENUM | 否 | `pending` / `running` / `completed` / `failed` / `skipped` |
| `sequence_no` | INT | 是 | 同一 request 内顺序号 |
| `metadata` | JSON | 否 | 扩展字段 |
| `tokens_input` | INT | 否 | 本条消息相关输入 token |
| `tokens_output` | INT | 否 | 本条消息相关输出 token |
| `latency_ms` | INT | 否 | 本步骤耗时 |
| `created_at` | DATETIME | 是 | 创建时间 |

### 4.2 role 取值

| 值 | 说明 |
|----|------|
| `expert` | Expert 发给 Assistant 的消息 |
| `assistant` | Assistant 内部输出或最终回答 |
| `tool` | Assistant 调用工具的记录 |
| `system` | 系统生成的控制/状态消息 |

### 4.3 message_type 取值

| 值 | 说明 | MVP |
|----|------|:---:|
| `task` | Expert 委托任务包 | ✅ |
| `context` | 补充背景上下文 | |
| `assistant_response` | Assistant 的普通过程响应 | |
| `tool_call` | Assistant 发起工具调用 | ✅ |
| `tool_result` | 工具返回结果摘要 | ✅ |
| `final` | Assistant 最终结果 | ✅ |
| `error` | 错误消息 | ✅ |
| `retry` | 重试记录 | |
| `status` | 状态变更记录 | ✅ |
| `note` | 备注/系统说明 | |

> **MVP 阶段最少支持**: `task / tool_call / tool_result / final / error / status`

### 4.4 建表 SQL

```sql
CREATE TABLE `assistant_messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `request_id` VARCHAR(64) NOT NULL,
  `parent_message_id` VARCHAR(64) DEFAULT NULL,
  `role` ENUM('expert', 'assistant', 'tool', 'system') NOT NULL,
  `message_type` ENUM(
    'task',
    'context',
    'assistant_response',
    'tool_call',
    'tool_result',
    'final',
    'error',
    'retry',
    'status',
    'note'
  ) NOT NULL,
  `content` LONGTEXT DEFAULT NULL,
  `content_preview` VARCHAR(512) DEFAULT NULL,
  `tool_name` VARCHAR(128) DEFAULT NULL,
  `tool_call_id` VARCHAR(64) DEFAULT NULL,
  `status` ENUM('pending', 'running', 'completed', 'failed', 'skipped') DEFAULT NULL,
  `sequence_no` INT NOT NULL,
  `metadata` JSON DEFAULT NULL,
  `tokens_input` INT DEFAULT NULL,
  `tokens_output` INT DEFAULT NULL,
  `latency_ms` INT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_request_id` (`request_id`),
  KEY `idx_request_seq` (`request_id`, `sequence_no`),
  KEY `idx_tool_call_id` (`tool_call_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 5. 写入时机

### 5.1 发起委托时

Expert 调用 `assistant_summon`：

```json
{
  "assistant_type": "vision",
  "task": "识别图片中的合同关键条款",
  "background": "这是用户上传的租赁合同扫描件，需要给出风险提示",
  "input": {
    "image_url": "https://example.com/contract.png"
  }
}
```

写入 `assistant_messages`：

```json
{
  "request_id": "req_123",
  "role": "expert",
  "message_type": "task",
  "sequence_no": 1,
  "content": "任务：识别图片中的合同关键条款\n背景：这是用户上传的租赁合同扫描件，需要给出风险提示\n输入：image_url=https://example.com/contract.png"
}
```

### 5.2 Assistant 进入执行时

```json
{
  "request_id": "req_123",
  "role": "system",
  "message_type": "status",
  "sequence_no": 2,
  "status": "running",
  "content": "Assistant 开始执行"
}
```

### 5.3 Assistant 调用工具时

**工具调用前**：

```json
{
  "request_id": "req_123",
  "role": "tool",
  "message_type": "tool_call",
  "sequence_no": 3,
  "tool_name": "ocr_detect",
  "tool_call_id": "call_001",
  "content": "调用 OCR 工具，输入图片 URL"
}
```

**工具调用后**：

```json
{
  "request_id": "req_123",
  "role": "tool",
  "message_type": "tool_result",
  "sequence_no": 4,
  "tool_name": "ocr_detect",
  "tool_call_id": "call_001",
  "content": "识别成功，共提取 1240 字"
}
```

> **注意**: 不建议直接存大段原始结果，尽量存摘要，原始结果放 `metadata`

### 5.4 Assistant 得到最终结果时

```json
{
  "request_id": "req_123",
  "role": "assistant",
  "message_type": "final",
  "sequence_no": 5,
  "content": "合同关键条款如下：\n1. 租期三年\n2. 月租金..."
}
```

同时更新 `assistant_requests.result`

### 5.5 出错时

```json
{
  "request_id": "req_123",
  "role": "system",
  "message_type": "error",
  "sequence_no": 3,
  "status": "failed",
  "content": "OCR 识别失败：图片格式不支持"
}
```

同时更新 `assistant_requests.error_message`

---

## 6. 完整写入示例

### OCR 助理一次完整调用

```
时间线：
T0 ── Expert 委托
T1 ── 系统状态变更
T2 ── 工具调用
T3 ── 工具返回
T4 ── 最终结果
```

| seq | role | message_type | content_preview |
|:---:|------|--------------|-----------------|
| 1 | expert | task | 任务：识别图片中的合同关键条款 |
| 2 | system | status | Assistant 开始执行 |
| 3 | tool | tool_call | 调用 OCR 工具 |
| 4 | tool | tool_result | 识别成功，共提取 1240 字 |
| 5 | assistant | final | 合同关键条款如下：1. 租期三年... |

---

## 7. 服务层设计

### 7.1 AssistantMessageService

```javascript
// server/services/assistant-message-service.js

class AssistantMessageService {
  constructor(db) {
    this.db = db
  }

  // 基础方法
  async createMessage(data) {
    const { requestId, role, messageType, content, ...rest } = data
    // 获取当前 sequence_no
    const maxSeq = await this.getMaxSequenceNo(requestId)
    const sequenceNo = (maxSeq || 0) + 1

    // 生成 content_preview
    const contentPreview = content ? content.substring(0, 512) : null

    return await this.db.insert('assistant_messages', {
      request_id: requestId,
      role,
      message_type: messageType,
      content,
      content_preview: contentPreview,
      sequence_no: sequenceNo,
      ...rest,
      created_at: new Date()
    })
  }

  // 便捷方法
  async appendTaskMessage(requestId, { task, background, input, expectedOutput, workspace }) {
    const content = this.formatTaskContent({ task, background, input, expectedOutput, workspace })
    return await this.createMessage({
      requestId,
      role: 'expert',
      messageType: 'task',
      content
    })
  }

  async appendStatusMessage(requestId, status, content) {
    return await this.createMessage({
      requestId,
      role: 'system',
      messageType: 'status',
      status,
      content
    })
  }

  async appendToolCallMessage(requestId, toolName, argsSummary, toolCallId) {
    return await this.createMessage({
      requestId,
      role: 'tool',
      messageType: 'tool_call',
      toolName,
      toolCallId,
      content: typeof argsSummary === 'string' ? argsSummary : JSON.stringify(argsSummary)
    })
  }

  async appendToolResultMessage(requestId, toolName, resultSummary, toolCallId, metadata = null) {
    return await this.createMessage({
      requestId,
      role: 'tool',
      messageType: 'tool_result',
      toolName,
      toolCallId,
      content: typeof resultSummary === 'string' ? resultSummary : JSON.stringify(resultSummary),
      metadata
    })
  }

  async appendFinalMessage(requestId, content, tokensInput = null, tokensOutput = null, latencyMs = null) {
    return await this.createMessage({
      requestId,
      role: 'assistant',
      messageType: 'final',
      content,
      tokensInput,
      tokensOutput,
      latencyMs
    })
  }

  async appendErrorMessage(requestId, error) {
    return await this.createMessage({
      requestId,
      role: 'system',
      messageType: 'error',
      status: 'failed',
      content: typeof error === 'string' ? error : error.message
    })
  }

  // 查询方法
  async getMessagesByRequestId(requestId, debugMode = false) {
    const fields = debugMode
      ? '*'
      : 'id, request_id, role, message_type, content_preview, tool_name, tool_call_id, status, sequence_no, created_at'

    return await this.db.query(
      `SELECT ${fields} FROM assistant_messages WHERE request_id = ? ORDER BY sequence_no`,
      [requestId]
    )
  }

  async getMaxSequenceNo(requestId) {
    const result = await this.db.queryOne(
      'SELECT MAX(sequence_no) as max_seq FROM assistant_messages WHERE request_id = ?',
      [requestId]
    )
    return result?.max_seq || 0
  }
}
```

### 7.2 在 AssistantManager 中使用

```javascript
// server/services/assistant-manager.js

class AssistantManager {
  constructor(options) {
    // ...
    this.messageService = new AssistantMessageService(options.db)
  }

  async summon(params) {
    const requestId = this.generateRequestId()

    // 创建委托记录
    await this.createRequest(requestId, params)

    // 写入任务消息
    await this.messageService.appendTaskMessage(requestId, {
      task: params.task,
      background: params.background,
      input: params.input,
      expectedOutput: params.expected_output,
      workspace: params.workspace
    })

    // 异步执行
    this.executeRequest(requestId).catch(err => {
      logger.error(`Request ${requestId} failed:`, err)
    })

    return { requestId, status: 'pending' }
  }

  async executeRequest(requestId) {
    const request = await this.getRequest(requestId)

    // 写入状态消息
    await this.messageService.appendStatusMessage(requestId, 'running', 'Assistant 开始执行')

    try {
      // 根据执行模式处理...
      const result = await this.executeByMode(request)

      // 写入最终结果
      await this.messageService.appendFinalMessage(
        requestId,
        result.content,
        result.tokensInput,
        result.tokensOutput,
        result.latencyMs
      )

      // 更新委托状态
      await this.updateRequestStatus(requestId, 'completed', result)

    } catch (error) {
      // 写入错误消息
      await this.messageService.appendErrorMessage(requestId, error)
      await this.updateRequestStatus(requestId, 'failed', null, error.message)
    }
  }
}
```

---

## 8. API 设计

### 8.1 查询委托内部消息

**端点**: `GET /api/assistants/requests/:request_id/messages`

**查询参数**:
- `debug` - 是否返回完整内容（默认 false）

**响应示例（普通模式）**:

```json
{
  "request_id": "req_123",
  "messages": [
    {
      "id": 1,
      "role": "expert",
      "message_type": "task",
      "content_preview": "任务：识别图片中的合同关键条款",
      "sequence_no": 1,
      "created_at": "2026-03-11T10:00:00Z"
    },
    {
      "id": 2,
      "role": "system",
      "message_type": "status",
      "status": "running",
      "content_preview": "Assistant 开始执行",
      "sequence_no": 2,
      "created_at": "2026-03-11T10:00:01Z"
    },
    {
      "id": 3,
      "role": "tool",
      "message_type": "tool_call",
      "tool_name": "ocr_detect",
      "content_preview": "调用 OCR 工具",
      "sequence_no": 3,
      "created_at": "2026-03-11T10:00:02Z"
    }
  ]
}
```

**响应示例（调试模式 `?debug=true`）**:

```json
{
  "request_id": "req_123",
  "messages": [
    {
      "id": 1,
      "role": "expert",
      "message_type": "task",
      "content": "任务：识别图片中的合同关键条款\n背景：这是用户上传的租赁合同扫描件...",
      "metadata": null,
      "sequence_no": 1,
      "created_at": "2026-03-11T10:00:00Z"
    }
  ]
}
```

---

## 9. 前端展示设计

### 9.1 展示位置

**不直接展示在主聊天区**，放在详情抽屉 / 调试面板。

主聊天区只展示：
- 助理委托卡片
- 助理完成通知
- 最终结果摘要

### 9.2 详情面板

点击 `AssistantRequestCard` 的"查看详情"后展示：

```
┌─────────────────────────────────────────────────────────────────┐
│  🖼️ 视觉助理                                    [关闭]         │
├─────────────────────────────────────────────────────────────────┤
│  基本信息                                                        │
│  ├── 状态: ✅ 已完成                                              │
│  ├── 开始: 2026-03-11 10:00:00                                   │
│  ├── 结束: 2026-03-11 10:00:05                                   │
│  └── 耗时: 5.2s                                                  │
├─────────────────────────────────────────────────────────────────┤
│  执行过程                                         [展开全部]    │
│                                                                  │
│  10:00:00  📝 Expert 委托                                        │
│            任务：识别图片中的合同关键条款                         │
│                                                                  │
│  10:00:01  🔄 开始执行                                           │
│                                                                  │
│  10:00:02  🔧 调用工具 ocr_detect                                │
│                                                                  │
│  10:00:04  ✅ 工具返回                                           │
│            识别成功，共提取 1240 字                               │
│                                                                  │
│  10:00:05  ✅ 完成                                               │
│            合同关键条款如下...                                    │
├─────────────────────────────────────────────────────────────────┤
│  最终结果                                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 合同关键条款如下：                                           ││
│  │ 1. 租期三年                                                  ││
│  │ 2. 月租金                                                    ││
│  │ ...                                                          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 9.3 调试模式开关

在详情面板顶部提供"调试模式"开关：

| 模式 | 显示内容 |
|------|----------|
| 普通模式 | `content_preview`、摘要信息 |
| 调试模式 | 完整 `content`、`metadata`、token 统计、耗时详情 |

---

## 10. 与主消息表的关系

### 10.1 不直接写入主 messages

Assistant 内部过程默认不写入用户主对话，因为：

- 污染上下文
- 增加 token 消耗
- 暴露内部执行细节
- 影响用户阅读体验

### 10.2 可选：最终结果通过系统消息回注

当 Assistant 完成时，可通过单独的系统消息注入 API，往主聊天窗口插入摘要通知：

```
〖视觉助理已完成〗已提取合同关键条款，可查看详情
```

此时：
- 主 `messages`：只显示摘要通知
- `assistant_messages`：保留完整过程

---

## 11. 多轮追问扩展

### 11.1 方案对比

| 方案 | 描述 | 适用场景 |
|------|------|----------|
| **方案 A** | 同一个 `request_id` 下继续追加消息 | 真正的连续对话型助理 |
| **方案 B** | 新建 `request_id`，通过 `parent_request_id` 串联 | 一次次独立委托 |

### 11.2 MVP 推荐

**推荐方案 B**，理由：
- 更简单、边界更清晰
- 每次委托独立记录，便于审计和统计
- 后续可通过 `parent_request_id` 实现关联

---

## 12. MVP 范围

### 12.1 首版必须做

- [x] `assistant_messages` 表
- [x] `task / tool_call / tool_result / final / error / status` 六类消息
- [x] 查询接口 `GET /requests/:id/messages`
- [x] 详情页时间线展示

### 12.2 首版可以不做

- [ ] 树状消息结构（`parent_message_id`）
- [ ] 子委托链路
- [ ] 全量 token 级流式记录
- [ ] 多轮连续会话

---

## 13. 实施步骤

| 步骤 | 任务 | 预计时间 |
|:----:|------|----------|
| 1 | 新增 migration：创建 `assistant_messages` 表 | 0.5h |
| 2 | 新增 `models/assistant_message.js` | 0.5h |
| 3 | 新增 `assistant-message-service.js` | 1h |
| 4 | 在 `AssistantManager` 各关键节点补写消息 | 1.5h |
| 5 | 新增查询接口 `/requests/:id/messages` | 0.5h |
| 6 | 前端详情面板接入消息时间线 | 1.5h |
| 7 | 测试 `direct / llm / hybrid` 三种模式 | 1h |

**总计：约 6.5h**

---

## 14. 一句话结论

> `assistant_messages` 是用于记录 Expert 与 Assistant 之间内部协作过程的消息表，作为 `assistant_requests` 的从表存在，服务于审计、调试、追溯和后续扩展，**不直接替代主对话 `messages`**。

---

*创建时间: 2026-03-11*