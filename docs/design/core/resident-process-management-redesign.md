# 驻留进程管理页面重构设计方案

**Issue:** 驻留进程管理增强
**日期:** 2026-04-08

## 一、现状分析

### 1.1 当前实现

| 组件 | 文件位置 | 功能 |
|------|---------|------|
| 前端页面 | [`ResidentProcessesTab.vue`](frontend/src/components/settings/ResidentProcessesTab.vue) | 进程状态展示、重启按钮 |
| 后端管理器 | [`resident-skill-manager.js`](lib/resident-skill-manager.js) | 进程生命周期、任务调度 |
| 调试 API | [`debug.controller.js`](server/controllers/debug.controller.js) | 状态查询、重启接口 |

### 1.2 核心问题

| 问题 | 影响 | 优先级 |
|------|------|--------|
| **请求来源不可见** | 管理员不知道谁在调用、调用什么 | 🔴 高 |
| **无法重发失败请求** | 失败的请求需要 LLM 重新发起，管理员无法干预 | 🔴 高 |
| **通信记录信息不足** | 只有摘要，缺少用户名、专家名等关键信息 | 🟡 中 |
| **消息反馈状态不明** | 不知道结果是否成功推送给专家 | 🟡 中 |

---

## 二、设计目标

### 2.1 核心原则

> **极端实用性**：管理员需要一眼看清"谁在什么时候调用了什么，结果如何，出了问题怎么办"

### 2.2 功能目标

1. **请求全景视图**：显示每个请求的完整来源链路（用户→专家→话题→请求）
2. **一键重发机制**：失败的请求可一键重发，无需 LLM 重新发起
3. **实时状态追踪**：请求状态实时更新（pending→processing→completed/failed）
4. **消息反馈确认**：显示结果是否成功推送给专家

---

## 三、数据结构重构

### 3.1 通信记录增强

**当前结构** ([`resident-skill-manager.js:68-84`](lib/resident-skill-manager.js:68)):
```javascript
{
  timestamp, direction, task_id, type, summary, status
}
```

**增强后结构**:
```javascript
{
  // 基础信息
  id: 'comm_xxx',              // 通信记录 ID
  timestamp: '2026-04-08T08:00:00Z',
  direction: 'out',            // 'out' 发送请求, 'in' 收到响应
  task_id: 'task_xxx',
  type: 'invoke',              // 'invoke' | 'response' | 'error'
  status: 'pending',           // 'pending' | 'processing' | 'completed' | 'failed'
  
  // 🆕 来源追踪
  source: {
    user_id: 'user_xxx',
    user_name: '张三',          // 🆕 用户名（查询填充）
    expert_id: 'expert_xxx',
    expert_name: 'AI 助手',     // 🆕 专家名（查询填充）
    topic_id: 'topic_xxx',      // 🆕 话题 ID
  },
  
  // 🆕 请求详情（可展开查看）
  request: {
    tool_name: 'call_llm',
    params: { model_id: 'xxx', prompt: '...' },  // 脱敏后
    timeout: 60000,
  },
  
  // 响应详情
  response: {
    latency_ms: 1234,
    tokens: { prompt: 100, completion: 200 },
    content_preview: '...',     // 前 100 字符
    error: null,                // 错误信息
  },
  
  // 🆕 消息反馈状态
  notification: {
    sent: true,                 // 是否已发送给专家
    sent_at: '2026-04-08T08:00:01Z',
    sse_delivered: true,        // SSE 是否成功推送
  },
  
  // 🆕 重发信息
  retry: {
    count: 0,                   // 重发次数
    last_retry_at: null,
    original_task_id: null,     // 如果是重发，记录原任务 ID
  }
}
```

### 3.2 进程状态增强

```javascript
{
  tool_id: 'tool_xxx',
  tool_name: 'remote-llm',
  skill_name: 'Remote LLM Executor',
  state: 'RUNNING',
  pid: 12345,
  started_at: '2026-04-08T00:00:00Z',
  
  // 统计信息
  stats: {
    total_requests: 100,
    pending_requests: 2,        // 🆕 待处理数量
    processing_requests: 1,     // 🆕 处理中数量
    completed_requests: 95,
    failed_requests: 2,
    avg_latency_ms: 1234,
  },
  
  // 🆕 最近请求列表（分页）
  recent_requests: [...],       // 最近 20 条请求
  
  // 🆕 活跃连接
  active_connections: [
    { user_id, user_name, expert_id, expert_name, connected_at }
  ]
}
```

---

## 四、API 接口设计

### 4.1 获取进程详情（增强）

```
GET /api/debug/resident-processes/:tool_id
```

**响应**:
```json
{
  "code": 200,
  "data": {
    "tool_id": "tool_xxx",
    "tool_name": "remote-llm",
    "state": "RUNNING",
    "pid": 12345,
    "stats": { ... },
    "recent_requests": [
      {
        "id": "comm_xxx",
        "timestamp": "2026-04-08T08:00:00Z",
        "status": "completed",
        "source": {
          "user_name": "张三",
          "expert_name": "AI 助手"
        },
        "request": { "tool_name": "call_llm" },
        "response": { "latency_ms": 1234 }
      }
    ]
  }
}
```

### 4.2 获取请求详情

```
GET /api/debug/resident-requests/:request_id
```

**响应**:
```json
{
  "code": 200,
  "data": {
    "id": "comm_xxx",
    "task_id": "task_xxx",
    "timestamp": "2026-04-08T08:00:00Z",
    "status": "failed",
    "source": {
      "user_id": "user_xxx",
      "user_name": "张三",
      "expert_id": "expert_xxx",
      "expert_name": "AI 助手",
      "topic_id": "topic_xxx"
    },
    "request": {
      "tool_name": "call_llm",
      "params": { "model_id": "gpt-4", "prompt": "..." },
      "timeout": 60000
    },
    "response": {
      "latency_ms": 0,
      "error": "Connection timeout after 60000ms"
    },
    "notification": {
      "sent": false,
      "sent_at": null
    },
    "retry": {
      "count": 0,
      "can_retry": true
    }
  }
}
```

### 4.3 重发请求 🆕

```
POST /api/debug/resident-requests/:request_id/retry
```

**请求体**:
```json
{
  "override_params": {          // 可选：覆盖参数
    "timeout": 120000
  }
}
```

**响应**:
```json
{
  "code": 200,
  "data": {
    "original_request_id": "comm_xxx",
    "new_request_id": "comm_yyy",
    "new_task_id": "task_yyy",
    "message": "请求已重新发送"
  }
}
```

### 4.4 获取请求列表（分页）

```
GET /api/debug/resident-requests?tool_id=xxx&status=failed&page=1&size=20
```

**查询参数**:
| 参数 | 说明 |
|------|------|
| tool_id | 按工具筛选 |
| status | 按状态筛选 (pending/processing/completed/failed) |
| user_id | 按用户筛选 |
| expert_id | 按专家筛选 |
| page | 页码 |
| size | 每页数量 |

---

## 五、前端页面重构

### 5.1 页面布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 驻留进程管理                                                    [刷新] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ ┌─ 进程卡片 ──────────────────────────────────────────────────────────┐ │
│ │ remote-llm (Remote LLM Executor)                    ● 运行中 PID:123│ │
│ │ 启动: 2026-04-08 00:00                                              │ │
│ │                                                                     │ │
│ │ 统计: 总请求 100 | 待处理 2 | 处理中 1 | 成功 95 | 失败 2           │ │
│ │                                                           [重启进程]│ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─ 请求列表 ──────────────────────────────────────────────────────────┐ │
│ │ 筛选: [全部状态 ▼] [全部用户 ▼] [全部专家 ▼]        搜索: [____]   │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │                                                                     │ │
│ │ ┌─ 请求行 (失败) ─────────────────────────────────────────────────┐ │ │
│ │ │ 🔴 08:00:00  张三 → AI助手  call_llm  失败  0ms                 │ │ │
│ │ │    错误: Connection timeout after 60000ms        [查看] [重发]  │ │ │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │
│ │                                                                     │ │
│ │ ┌─ 请求行 (处理中) ───────────────────────────────────────────────┐ │ │
│ │ │ 🟡 08:01:00  李四 → 代码专家  call_llm  处理中  5s...           │ │ │
│ │ │    参数: model=gpt-4, prompt=...                [查看] [取消]   │ │ │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │
│ │                                                                     │ │
│ │ ┌─ 请求行 (成功) ─────────────────────────────────────────────────┐ │ │
│ │ │ 🟢 08:02:00  王五 → 翻译专家  call_llm  成功  1234ms            │ │ │
│ │ │    返回: 200 tokens, 已推送 ✓                   [查看]         │ │ │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │
│ │                                                                     │ │
│ │ ─────────────────────────────────────────────────────────────────── │ │
│ │ 第 1/5 页                                          [<] [1] [2] [>] │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 请求详情弹窗

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 请求详情                                                        [×]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 状态: 🔴 失败                              任务ID: task_xxx            │
│ 时间: 2026-04-08 08:00:00                                               │
│                                                                         │
│ ┌─ 来源信息 ──────────────────────────────────────────────────────────┐ │
│ │ 用户: 张三 (user_xxx)                                               │ │
│ │ 专家: AI 助手 (expert_xxx)                                          │ │
│ │ 话题: topic_xxx                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─ 请求参数 ──────────────────────────────────────────────────────────┐ │
│ │ 工具: call_llm                                                      │ │
│ │ 超时: 60000ms                                                       │ │
│ │ 参数:                                                               │ │
│ │ {                                                                   │ │
│ │   "model_id": "gpt-4",                                              │ │
│ │   "prompt": "请帮我写一段代码...",                                   │ │
│ │   "temperature": 0.7                                                │ │
│ │ }                                                                   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─ 响应信息 ──────────────────────────────────────────────────────────┐ │
│ │ 耗时: 60000ms                                                       │ │
│ │ 错误: Connection timeout after 60000ms                              │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─ 消息反馈 ──────────────────────────────────────────────────────────┐ │
│ │ 推送状态: ❌ 未发送                                                  │ │
│ │ 原因: 请求失败，未触发专家通知                                       │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─ 重发选项 ──────────────────────────────────────────────────────────┐ │
│ │ ☑ 使用原始参数重发                                                   │ │
│ │ ☐ 覆盖超时时间: [120000] ms                                         │ │
│ │                                                                     │ │
│ │ [取消]                                              [确认重发]      │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.3 组件结构

```
frontend/src/components/settings/
├── ResidentProcessesTab.vue          # 主页面（重构）
├── resident/
│   ├── ProcessCard.vue               # 进程卡片组件
│   ├── RequestList.vue               # 请求列表组件
│   ├── RequestRow.vue                # 请求行组件
│   ├── RequestDetailModal.vue        # 请求详情弹窗
│   ├── RetryDialog.vue               # 重发确认对话框
│   └── types.ts                      # TypeScript 类型定义
```

---

## 六、后端实现方案

### 6.1 通信记录存储增强

修改 [`lib/resident-skill-manager.js`](lib/resident-skill-manager.js):

```javascript
/**
 * 添加通信记录（增强版）
 */
addCommunication(direction, taskId, type, data, userContext = {}) {
  const record = {
    id: `comm_${Utils.newID(12)}`,
    timestamp: new Date().toISOString(),
    direction,
    task_id: taskId,
    type,
    status: data.status || 'pending',
    
    // 来源追踪
    source: {
      user_id: userContext.userId || null,
      user_name: null,  // 延迟填充
      expert_id: userContext.expertId || null,
      expert_name: null,  // 延迟填充
      topic_id: userContext.topicId || null,
    },
    
    // 请求详情
    request: {
      tool_name: this.tool.name,
      params: this.sanitizeParams(data.params),
      timeout: data.timeout || 60000,
    },
    
    // 响应详情
    response: {
      latency_ms: data.latency_ms || 0,
      tokens: data.tokens || null,
      content_preview: data.content_preview || null,
      error: data.error || null,
    },
    
    // 消息反馈
    notification: {
      sent: false,
      sent_at: null,
      sse_delivered: false,
    },
    
    // 重发信息
    retry: {
      count: 0,
      last_retry_at: null,
      original_task_id: null,
    }
  };
  
  this.communications.push(record);
  this.persistCommunication(record);  // 🆕 持久化到数据库
  
  return record;
}

/**
 * 持久化通信记录到数据库
 */
async persistCommunication(record) {
  try {
    const ResidentRequest = this.db.getModel('resident_request');
    await ResidentRequest.create({
      id: record.id,
      tool_id: this.tool.id,
      task_id: record.task_id,
      direction: record.direction,
      type: record.type,
      status: record.status,
      source_user_id: record.source.user_id,
      source_expert_id: record.source.expert_id,
      source_topic_id: record.source.topic_id,
      request_params: JSON.stringify(record.request),
      response_data: JSON.stringify(record.response),
      notification_status: JSON.stringify(record.notification),
      retry_count: record.retry.count,
      created_at: record.timestamp,
    });
  } catch (err) {
    logger.warn(`Failed to persist communication: ${err.message}`);
  }
}
```

### 6.2 重发机制实现

新增 API 控制器方法:

```javascript
/**
 * 重发请求
 * POST /api/debug/resident-requests/:request_id/retry
 */
async retryRequest(ctx) {
  const { request_id } = ctx.params;
  const { override_params } = ctx.request.body;
  
  // 1. 查询原始请求
  const ResidentRequest = this.db.getModel('resident_request');
  const original = await ResidentRequest.findByPk(request_id);
  
  if (!original) {
    ctx.error('请求不存在', 404);
    return;
  }
  
  // 2. 检查是否可重发
  if (original.status === 'processing') {
    ctx.error('请求正在处理中，无法重发', 400);
    return;
  }
  
  // 3. 获取用户上下文
  const User = this.db.getModel('user');
  const user = await User.findByPk(original.source_user_id);
  
  if (!user) {
    ctx.error('原始用户不存在', 404);
    return;
  }
  
  // 4. 构建新的请求参数
  const originalParams = JSON.parse(original.request_params);
  const newParams = {
    ...originalParams.params,
    ...override_params,
  };
  
  // 5. 调用驻留进程
  const result = await this.residentSkillManager.invoke(
    original.tool_id,
    newParams,
    {
      userId: original.source_user_id,
      expertId: original.source_expert_id,
      topicId: original.source_topic_id,
      accessToken: this.generateSystemToken(),  // 系统级 token
      isAdmin: true,
    }
  );
  
  // 6. 更新重发计数
  await original.update({
    retry_count: original.retry_count + 1,
    last_retry_at: new Date(),
  });
  
  ctx.success({
    original_request_id: request_id,
    new_request_id: result.request_id,
    new_task_id: result.task_id,
    message: '请求已重新发送',
  });
}
```

### 6.3 数据库表设计

```sql
-- 驻留进程请求记录表
CREATE TABLE resident_requests (
  id VARCHAR(32) PRIMARY KEY COMMENT '请求ID',
  tool_id VARCHAR(32) NOT NULL COMMENT '工具ID',
  task_id VARCHAR(32) NOT NULL COMMENT '任务ID',
  direction ENUM('out', 'in') NOT NULL COMMENT '方向',
  type ENUM('invoke', 'response', 'error') NOT NULL COMMENT '类型',
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL COMMENT '状态',
  
  -- 来源
  source_user_id VARCHAR(32) COMMENT '用户ID',
  source_expert_id VARCHAR(32) COMMENT '专家ID',
  source_topic_id VARCHAR(32) COMMENT '话题ID',
  
  -- 请求/响应
  request_params JSON COMMENT '请求参数',
  response_data JSON COMMENT '响应数据',
  
  -- 通知
  notification_status JSON COMMENT '通知状态',
  
  -- 重发
  retry_count INT DEFAULT 0 COMMENT '重发次数',
  last_retry_at DATETIME COMMENT '最后重发时间',
  original_request_id VARCHAR(32) COMMENT '原始请求ID',
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_tool_id (tool_id),
  INDEX idx_status (status),
  INDEX idx_user_id (source_user_id),
  INDEX idx_expert_id (source_expert_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='驻留进程请求记录';
```

---

## 七、多语言支持

### 7.1 新增翻译 Key

```typescript
// zh-CN.ts
settings: {
  resident: {
    // ... 现有翻译 ...
    
    // 🆕 请求相关
    requestList: '请求列表',
    requestDetail: '请求详情',
    filterByStatus: '按状态筛选',
    filterByUser: '按用户筛选',
    filterByExpert: '按专家筛选',
    searchRequest: '搜索请求...',
    
    // 🆕 状态
    statusPending: '待处理',
    statusProcessing: '处理中',
    statusCompleted: '已完成',
    statusFailed: '失败',
    
    // 🆕 来源信息
    sourceInfo: '来源信息',
    sourceUser: '来源用户',
    sourceExpert: '来源专家',
    sourceTopic: '来源话题',
    
    // 🆕 请求信息
    requestParams: '请求参数',
    responseInfo: '响应信息',
    latency: '耗时',
    tokens: 'Token',
    
    // 🆕 消息反馈
    notificationStatus: '消息反馈',
    notificationSent: '已推送',
    notificationNotSent: '未推送',
    sseDelivered: 'SSE 已送达',
    
    // 🆕 重发
    retry: '重发',
    retryConfirm: '确认重发',
    retrySuccess: '重发成功',
    retryFailed: '重发失败',
    retryParams: '重发参数',
    useOriginalParams: '使用原始参数',
    overrideTimeout: '覆盖超时时间',
    
    // 🆕 统计
    pendingRequests: '待处理',
    processingRequests: '处理中',
    avgLatency: '平均耗时',
  }
}
```

---

## 八、实现步骤

### Phase 1: 数据库与后端基础 (1-2天)

1. 创建 `resident_requests` 表
2. 修改 `ResidentSkillManager` 增强通信记录
3. 新增请求详情 API
4. 新增重发 API

### Phase 2: 前端重构 (2-3天)

1. 重构 `ResidentProcessesTab.vue`
2. 创建子组件 (`ProcessCard`, `RequestList`, `RequestRow`)
3. 实现请求详情弹窗
4. 实现重发功能

### Phase 3: 测试与优化 (1天)

1. 单元测试
2. 集成测试
3. 性能优化

---

## 九、风险与注意事项

### 9.1 安全考虑

| 风险 | 缓解措施 |
|------|---------|
| 敏感参数泄露 | 参数脱敏处理，仅显示关键字段 |
| 未授权重发 | 仅管理员可重发，记录审计日志 |
| Token 泄露 | 使用系统级 Token，短期有效 |

### 9.2 性能考虑

| 问题 | 解决方案 |
|------|---------|
| 请求记录过多 | 分页查询，定期归档 |
| 实时更新压力 | WebSocket 推送，而非轮询 |

---

✌Bazinga！