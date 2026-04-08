# 助理系统失败处理改进方案

> 创建时间：2026-04-08
> 状态：设计方案
> 关联文档：assistant-system-design.md, expert-orchestration.md

---

## 1. 问题概述

当前架构存在以下问题：

1. **助理执行失败**：Expert 无法及时感知助理失败，缺乏主动通知机制
2. **内部专家失败**：失败结果只通知用户，没有传递给调用方专家
3. **缺乏重试/降级机制**：失败后没有自动恢复策略

---

## 2. 改进目标

1. **及时感知**：调用方专家能够及时获知被调用方的失败状态
2. **结果传递**：失败信息（错误类型、原因、上下文）完整传递回调用方
3. **智能恢复**：支持重试、降级、转人工等恢复策略
4. **上下文保留**：失败时的上下文状态可被调用方用于决策

---

## 3. 架构改进设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Expert (调用方专家)                              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   Failure Handler 组件                      │   │
│  │                                                              │   │
│  │  • 接收失败通知 (onAssistantFailed / onExpertFailed)        │   │
│  │  • 决策：重试 / 降级 / 转人工 / 终止                         │   │
│  │  • 执行恢复策略                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              调用助理/专家                                    │   │
│  │  • assistant_summon(type, input, onFailure?)                │   │
│  │  • delegateToExpert(role, task, onFailure?)                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 失败通知
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Failure Notification System                      │
│                                                                     │
│  ┌─────────────────────────┐  ┌─────────────────────────────────┐   │
│  │   Assistant Failure     │  │     Expert Failure              │   │
│  │                         │  │                                 │   │
│  │  • 状态：failed         │  │  • 状态：failed                 │   │
│  │  • 错误类型分类         │  │  • 错误类型分类                 │   │
│  │  • 上下文快照           │  │  • 上下文快照                   │   │
│  │  • 自动/手动通知        │  │  • 自动/手动通知                │   │
│  └─────────────────────────┘  └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 失败类型分类

```typescript
// 失败类型枚举
enum FailureType {
  // 可恢复错误
  TIMEOUT = 'timeout',           // 执行超时
  RATE_LIMIT = 'rate_limit',   // 限流
  TEMPORARY_ERROR = 'temporary', // 临时错误
  
  // 需要降级
  CAPABILITY_LIMIT = 'capability', // 能力限制
  RESOURCE_EXHAUSTED = 'resource', // 资源耗尽
  
  // 需要人工介入
  INVALID_INPUT = 'invalid_input', // 输入无效
  AMBIGUOUS_REQUIREMENT = 'ambiguous', // 需求不明确
  SAFETY_VIOLATION = 'safety',   // 安全违规
  
  // 不可恢复
  SYSTEM_ERROR = 'system',       // 系统错误
  UNKNOWN = 'unknown'            // 未知错误
}

// 失败信息结构
interface FailureInfo {
  type: FailureType;
  code: string;                 // 错误代码
  message: string;              // 错误消息
  detail?: any;               // 详细错误信息
  context?: {                 // 失败时的上下文
    input: any;               // 输入参数
    partialResult?: any;      // 部分结果
    executionTime: number;    // 执行时长
    retryCount: number;       // 已重试次数
  };
  timestamp: string;
  recoverable: boolean;       // 是否可恢复
  suggestedAction: 'retry' | 'fallback' | 'escalate' | 'abort';
}
```

---

## 4. 助理系统改进

### 4.1 增强 assistant_status 响应

```json
{
  "request_id": "req_abc123",
  "assistant_type": "ocr",
  "status": "failed",
  "failure": {
    "type": "capability",
    "code": "OCR_IMAGE_TOO_LARGE",
    "message": "图片尺寸超过处理能力 (8MB > 5MB限制)",
    "detail": {
      "image_size": 8388608,
      "max_size": 5242880
    },
    "context": {
      "input": { "image_url": "..." },
      "execution_time": 2300,
      "retry_count": 0
    },
    "recoverable": true,
    "suggested_action": "fallback"
  },
  "created_at": "2024-01-01T10:00:00Z",
  "failed_at": "2024-01-01T10:00:03Z"
}
```

### 4.2 新增 assistant_wait 工具

**用途**：Expert 调用助理后等待完成，失败时自动返回错误信息

```javascript
// 工具定义
{
  name: 'assistant_wait',
  description: '召唤助理并等待完成，失败时返回详细错误信息',
  parameters: {
    type: 'object',
    properties: {
      assistant_type: { type: 'string' },
      input: { type: 'object' },
      timeout: { type: 'number', default: 120 },
      poll_interval: { type: 'number', default: 5 }
    }
  }
}

// 返回结果
{
  "success": false,
  "failure": {
    "type": "timeout",
    "code": "ASSISTANT_TIMEOUT",
    "message": "助理执行超时 (120s)",
    "context": { ... },
    "recoverable": true,
    "suggested_action": "retry"
  }
}
```

### 4.3 数据库表增强

```sql
-- 增强 assistant_requests 表
ALTER TABLE assistant_requests ADD COLUMN (
    failure_type VARCHAR(32) NULL COMMENT '失败类型',
    failure_code VARCHAR(64) NULL COMMENT '错误代码',
    failure_detail JSON NULL COMMENT '详细错误信息',
    recoverable BIT DEFAULT 1 COMMENT '是否可恢复',
    suggested_action VARCHAR(20) NULL COMMENT '建议动作',
    retry_count INT DEFAULT 0 COMMENT '重试次数',
    max_retries INT DEFAULT 3 COMMENT '最大重试次数'
);
```

---

## 5. 专家编排系统改进

### 5.1 失败回调机制

```javascript
// ExpertWorker 基类增强
class ExpertWorker {
  constructor(config) {
    this.taskId = config.taskId;
    this.phase = config.phase;
    this.workDir = config.workDir;
    this.parentExpertId = config.parentExpertId; // 调用方专家ID
    this.statusFile = path.join(this.workDir, '.expert-status.json');
    this.failureHandler = config.failureHandler; // 失败处理器
  }

  async run() {
    try {
      await this.execute();
      await this.updateStatus({ state: 'completed' });
    } catch (error) {
      const failureInfo = this.classifyFailure(error);
      
      // 更新状态文件
      await this.updateStatus({
        state: 'failed',
        failure: failureInfo
      });
      
      // 如果有调用方，通知调用方
      if (this.parentExpertId) {
        await this.notifyParentFailure(failureInfo);
      }
      
      throw error;
    }
  }

  // 失败分类
  classifyFailure(error) {
    const failureMap = {
      TimeoutError: { type: 'timeout', recoverable: true, action: 'retry' },
      RateLimitError: { type: 'rate_limit', recoverable: true, action: 'retry' },
      ResourceExhaustedError: { type: 'resource', recoverable: false, action: 'fallback' },
      // ...
    };
    
    const classification = failureMap[error.constructor.name] || 
                         { type: 'unknown', recoverable: false, action: 'abort' };
    
    return {
      type: classification.type,
      code: error.code || 'UNKNOWN',
      message: error.message,
      detail: error.detail,
      context: {
        phase: this.phase,
        executionTime: Date.now() - this.startTime,
        retryCount: this.retryCount
      },
      recoverable: classification.recoverable,
      suggested_action: classification.action
    };
  }

  // 通知调用方失败
  async notifyParentFailure(failureInfo) {
    const notificationPath = path.join(
      WORK_ROOT, 
      this.taskId, 
      '.parent-notifications.json'
    );
    
    const notifications = await this.readNotifications(notificationPath);
    notifications.push({
      type: 'child_failure',
      from: this.expertRole,
      to: this.parentExpertId,
      failure: failureInfo,
      timestamp: new Date().toISOString()
    });
    
    await fs.writeFile(notificationPath, JSON.stringify(notifications, null, 2));
  }
}
```

### 5.2 父专家接收失败通知

```javascript
// TaskOrchestrator 增强 - 处理子专家失败
async queryExecution(execution) {
  const status = await this.readStatusFile(execution.task_id);
  
  if (status.state === 'failed') {
    // 检查是否有父专家
    if (execution.parent_expert_id) {
      // 将失败传递给父专家处理
      await this.handleChildFailure(execution, status.failure);
    } else {
      // 没有父专家，按原流程处理
      await this.handleFailed(execution, status);
    }
  }
}

// 处理子专家失败
async handleChildFailure(childExecution, failureInfo) {
  const parentExecution = await this.db.ExpertExecution.findOne({
    where: {
      expert_id: childExecution.parent_expert_id,
      task_id: childExecution.task_id,
      status: ['running', 'waiting_input']
    }
  });
  
  if (!parentExecution) {
    // 父专家已结束，按原流程处理
    await this.handleFailed(childExecution, { error: failureInfo.message });
    return;
  }
  
  // 更新父专家状态为 waiting_input，等待父专家决策
  await parentExecution.update({
    status: 'waiting_input',
    waiting_for: {
      type: 'child_failure',
      child_execution_id: childExecution.id,
      child_role: childExecution.expert_role,
      failure: failureInfo
    }
  });
  
  // 子专家进入 suspended 状态，等待父专家决策
  await childExecution.update({
    status: 'suspended',
    suspended_reason: 'awaiting_parent_decision'
  });
}
```

### 5.3 父专家决策流程

```javascript
// 父专家收到子专家失败通知后的处理
async provideInput(execution, waitingFor) {
  if (waitingFor.type === 'child_failure') {
    // 父专家需要决策如何处理子专家失败
    const decision = await this.requestParentDecision(execution, waitingFor);
    
    switch (decision.action) {
      case 'retry':
        await this.retryChildExpert(waitingFor.child_execution_id);
        break;
      case 'fallback':
        await this.fallbackChildExpert(execution, waitingFor);
        break;
      case 'escalate':
        await this.escalateToUser(execution, waitingFor.failure);
        break;
      case 'abort':
        await this.abortTask(execution.task_id, waitingFor.failure);
        break;
    }
  }
}

// 请求父专家决策（通过 LLM 调用）
async requestParentDecision(parentExecution, childFailure) {
  const prompt = `
子专家执行失败，请决策如何处理：

失败信息：
- 子专家角色：${childFailure.child_role}
- 失败类型：${childFailure.failure.type}
- 错误代码：${childFailure.failure.code}
- 错误消息：${childFailure.failure.message}
- 是否可恢复：${childFailure.failure.recoverable}
- 建议动作：${childFailure.failure.suggested_action}

可选动作：
1. retry - 重试子专家（适用于临时错误）
2. fallback - 降级处理（使用替代方案）
3. escalate - 转人工处理
4. abort - 终止任务

请输出决策（JSON格式）：
{
  "action": "retry|fallback|escalate|abort",
  "reason": "决策理由",
  "fallback_plan": "如果选fallback，描述替代方案"
}
`;

  const response = await this.llmClient.complete(prompt);
  return JSON.parse(response);
}
```

---

## 6. 恢复策略实现

### 6.1 重试策略

```javascript
class RetryStrategy {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.initialDelay = options.initialDelay || 5000;
  }

  async execute(task, failureInfo) {
    const retryCount = failureInfo.context?.retryCount || 0;
    
    if (retryCount >= this.maxRetries) {
      throw new Error('Max retries exceeded');
    }
    
    // 计算退避延迟
    const delay = this.initialDelay * Math.pow(this.backoffMultiplier, retryCount);
    
    // 更新重试计数
    await task.update({ retry_count: retryCount + 1 });
    
    // 延迟后重试
    await sleep(delay);
    
    // 重新启动专家
    return await this.restartExpert(task);
  }
}
```

### 6.2 降级策略

```javascript
class FallbackStrategy {
  constructor(fallbackMap) {
    // 降级映射：原始专家 -> 降级专家
    this.fallbackMap = fallbackMap || {
      'vision_analyst': 'basic_ocr',      // 视觉分析失败 -> 基础OCR
      'code_generator': 'code_reviewer',    // 代码生成失败 -> 代码审查
      'complex_math': 'basic_calculator', // 复杂数学失败 -> 基础计算
    };
  }

  async execute(originalTask, failureInfo) {
    const originalRole = originalTask.expert_role;
    const fallbackRole = this.fallbackMap[originalRole];
    
    if (!fallbackRole) {
      throw new Error(`No fallback defined for ${originalRole}`);
    }
    
    // 创建降级执行记录
    const fallbackExecution = await this.db.ExpertExecution.create({
      id: generateId(),
      task_id: originalTask.task_id,
      expert_role: fallbackRole,
      parent_expert_id: originalTask.parent_expert_id,
      status: 'pending',
      is_fallback: true,
      original_execution_id: originalTask.id,
      fallback_reason: failureInfo.message
    });
    
    // 启动降级专家
    return await this.startExpert(fallbackExecution);
  }
}
```

### 6.3 转人工策略

```javascript
class EscalationStrategy {
  async execute(task, failureInfo) {
    // 创建人工介入请求
    const escalation = await this.db.EscalationRequest.create({
      id: generateId(),
      task_id: task.task_id,
      execution_id: task.id,
      failure_type: failureInfo.type,
      failure_message: failureInfo.message,
      context: failureInfo.context,
      status: 'pending',
      created_at: new Date()
    });
    
    // 通知用户
    await this.notifyUser(task.created_by, {
      type: 'escalation_required',
      escalation_id: escalation.id,
      task_id: task.task_id,
      message: `任务需要人工介入：${failureInfo.message}`,
      options: [
        { id: 'retry', label: '重试', description: '重新执行失败步骤' },
        { id: 'skip', label: '跳过', description: '跳过此步骤继续' },
        { id: 'abort', label: '终止', description: '终止整个任务' }
      ]
    });
    
    // 暂停任务等待用户响应
    await task.update({ status: 'WAITING_USER' });
    
    return escalation;
  }
}
```

---

## 7. 数据库表设计

### 7.1 增强 expert_executions 表

```sql
-- 增强专家执行表
ALTER TABLE expert_executions ADD COLUMN (
    parent_expert_id VARCHAR(32) NULL COMMENT '调用方专家ID',
    is_fallback BIT DEFAULT 0 COMMENT '是否为降级执行',
    original_execution_id VARCHAR(64) NULL COMMENT '原始执行ID（降级时）',
    fallback_reason TEXT NULL COMMENT '降级原因',
    
    failure_type VARCHAR(32) NULL COMMENT '失败类型',
    failure_code VARCHAR(64) NULL COMMENT '错误代码',
    failure_detail TEXT NULL COMMENT '详细错误信息',
    
    recoverable BIT DEFAULT 1 COMMENT '是否可恢复',
    suggested_action VARCHAR(20) NULL COMMENT '建议动作',
    retry_count INT DEFAULT 0 COMMENT '重试次数',
    max_retries INT DEFAULT 3 COMMENT '最大重试次数',
    
    suspended_reason VARCHAR(50) NULL COMMENT '暂停原因',
    
    INDEX idx_parent (parent_expert_id),
    INDEX idx_fallback (original_execution_id)
);
```

### 7.2 新增 escalation_requests 表

```sql
CREATE TABLE escalation_requests (
    id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(100) NOT NULL,
    execution_id VARCHAR(64) NOT NULL,
    
    failure_type VARCHAR(32) NOT NULL,
    failure_message TEXT NOT NULL,
    context TEXT COMMENT '失败上下文JSON',
    
    status ENUM('pending', 'resolved', 'rejected') DEFAULT 'pending',
    user_decision VARCHAR(20) NULL COMMENT '用户决策',
    user_comment TEXT NULL COMMENT '用户备注',
    resolved_at TIMESTAMP NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (execution_id) REFERENCES expert_executions(id),
    INDEX idx_task (task_id),
    INDEX idx_status (status)
) COMMENT '人工介入请求表';
```

---

## 8. API 设计

### 8.1 查询失败详情

```http
GET /api/assistants/requests/:request_id/failure

Response:
{
  "request_id": "req_abc123",
  "status": "failed",
  "failure": {
    "type": "timeout",
    "code": "ASSISTANT_TIMEOUT",
    "message": "执行超时",
    "recoverable": true,
    "suggested_action": "retry"
  },
  "retry_options": {
    "can_retry": true,
    "max_retries": 3,
    "current_retries": 1,
    "next_retry_delay": 10000
  }
}
```

### 8.2 重试失败委托

```http
POST /api/assistants/requests/:request_id/retry

Request:
{
  "reason": "临时网络问题，尝试重试"
}

Response:
{
  "request_id": "req_abc123",
  "new_request_id": "req_abc124",
  "status": "pending",
  "message": "已创建重试委托"
}
```

### 8.3 处理人工介入

```http
POST /api/escalations/:escalation_id/resolve

Request:
{
  "decision": "retry",  // retry | skip | abort
  "comment": "同意重试"
}

Response:
{
  "escalation_id": "esc_123",
  "status": "resolved",
  "action_taken": "retry",
  "new_execution_id": "exec_456"
}
```

---

## 9. 实施步骤

| 步骤 | 任务 | 文件 | 优先级 |
|------|------|------|--------|
| 1 | 数据库迁移 | `scripts/migrate-failure-handling.js` | P0 |
| 2 | 失败分类器 | `lib/failure-classifier.js` | P0 |
| 3 | 增强 AssistantManager | `services/assistant-manager.js` | P0 |
| 4 | 增强 ExpertWorker | `lib/expert-worker.js` | P0 |
| 5 | 增强 TaskOrchestrator | `services/task-orchestrator.js` | P0 |
| 6 | 实现恢复策略 | `strategies/retry.js`, `fallback.js`, `escalation.js` | P1 |
| 7 | API 路由 | `routes/assistants.js`, `routes/escalations.js` | P1 |
| 8 | 前端组件 | `AssistantFailureCard.vue`, `EscalationDialog.vue` | P2 |
| 9 | 测试验证 | `tests/failure-handling/` | P1 |

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 无限重试循环 | 资源耗尽 | 设置最大重试次数，指数退避 |
| 级联失败 | 整个任务链失败 | 父专家决策超时机制，默认降级 |
| 上下文爆炸 | Token 超限 | 失败信息摘要化，详细日志存文件 |
| 用户等待过长 | 体验差 | 异步通知，支持后台处理 |

---

*创建时间: 2026-04-08*
*状态: 设计方案 v1*
