# Assistant Summon 输入结构优化

> **任务编号**: #88
> **创建时间**: 2026-03-11
> **关联**: #67 助理系统设计

---

## 1. 问题分析

### 当前输入结构

```json
{
  "assistant_type": "ocr",
  "input": {
    "image": "https://example.com/image.png"
  }
}
```

**问题**：
- 输入过于简单，只传递类型和原始输入
- 缺少任务描述和背景上下文
- Assistant 无法理解"为什么要执行这个任务"
- Expert 需要在调用前自行整理上下文，但接口不支持传递
- **Assistant 无法使用 Expert 已配置的工具**

### 设计原则

> **Assistant 不应该继承 Expert 全量上下文，而应该由 Expert 整理后传入一个"最小必要任务包"**
>
> **但 Assistant 需要继承 Expert 的所有工具**，以便在执行任务时能够调用这些工具

---

## 2. 升级方案

### 2.1 新输入结构

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
}
```

### 2.2 示例请求

```json
{
  "assistant_type": "vision",
  "task": "识别图片中的合同关键条款",
  "background": "这是用户上传的租赁合同扫描件，需要给出风险提示",
  "input": {
    "image_url": "https://example.com/contract.png",
    "file_path": "/uploads/contracts/2026/001.png"
  },
  "expected_output": {
    "format": "markdown",
    "focus": ["租期", "违约责任", "付款方式"]
  },
  "workspace": {
    "topic_id": "topic_abc123",
    "expert_id": "expert_lawyer",
    "workdir": "/workspace/topic_abc123"
  }
}
```

### 2.3 工具继承机制

Assistant 需要继承 Expert 的所有工具，以便在执行任务时调用。

**实现方式**：

```typescript
interface AssistantSummonRequest {
  // ... 其他字段

  // 可选：继承 Expert 的工具列表
  inherited_tools?: string[]  // 工具ID列表，如 ["kb-search", "docx-create"]

  // 或传递完整的工具配置
  tools?: Array<{
    name: string
    description: string
    parameters: object
  }>
}
```

**工具继承流程**：

```
Expert 调用 assistant_summon
        │
        ├─► 获取 Expert 已配置的工具列表
        │
        ├─► 过滤/选择需要传递给 Assistant 的工具
        │
        └─► 将工具列表作为 inherited_tools 传递
                    │
                    ▼
            Assistant 执行时
                    │
                    └─► 可调用 inherited_tools 中的工具
```

**示例**：

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

## 3. 实现计划

### 3.1 后端修改

| 文件 | 修改内容 |
|------|----------|
| `server/controllers/assistant.controller.js` | 扩展 `call` 方法参数解析 |
| `server/services/assistant-manager.js` | `summon` 方法支持新参数 |
| `models/assistant_request.js` | `input` 字段存储完整请求结构 |

### 3.2 API 变更

**POST /api/assistants/call**

```javascript
// 旧版（兼容）
{
  "assistant_type": "ocr",
  "input": { "image": "..." }
}

// 新版（推荐）
{
  "assistant_type": "vision",
  "task": "识别图片中的合同关键条款",
  "background": "...",
  "input": { ... },
  "expected_output": { ... },
  "workspace": { ... }
}
```

**响应保持不变**

```json
{
  "request_id": "req_abc123",
  "assistant_type": "vision",
  "status": "pending",
  "estimated_time": 30
}
```

### 3.3 向后兼容

- 如果只传 `assistant_type` 和 `input`，系统自动生成默认 `task`
- `background`、`expected_output`、`workspace` 均为可选字段

---

## 4. 数据库影响

`assistant_requests.input` 字段已为 JSON 类型，可直接存储新结构，无需迁移。

---

## 5. 前端影响

`frontend/src/types/index.ts` 需更新类型定义：

```typescript
export interface AssistantSummonRequest {
  assistant_type: string
  task: string
  background?: string
  input: Record<string, any>
  expected_output?: {
    format?: string
    focus?: string[]
    max_length?: number
  }
  workspace?: {
    topic_id?: string
    expert_id?: string
    workdir?: string
  }
}
```

---

## 6. 预计工作量

| 任务 | 时间 |
|------|------|
| 后端参数解析升级 | 1h |
| 类型定义更新 | 0.5h |
| 测试验证 | 0.5h |
| **总计** | **2h** |

---

## 7. 后续扩展

此方案为后续功能预留空间：

1. **多轮对话** - `workspace.topic_id` 支持同一话题内连续追问
2. **审计追溯** - 完整记录任务背景和期望
3. **结果校验** - `expected_output.format` 可用于验证输出格式