# 后台任务调度器设计

> 最后更新：2026-02-23

## 背景

对话主流程完成后，需要执行一些后台任务（反思心智、历史归档等），但不能阻塞用户响应。

## 当前实现分析

### 当前调用流程

```
用户发送消息
    │
    ▼
checkAndHandleTopicShift()  ← 话题检测（同步，阻塞！）
    │   └─ 消息数 >= 6 时调用 LLM
    │
    ▼
对话主流程（LLM 调用）
    │
    ▼
SSE 流结束，返回给前端
    │
    ├─► performReflection()      ← 反思心智（异步，不阻塞）
    │       └─ 每次对话后都调用 LLM
    │
    └─► processHistoryIfNeeded() ← 历史归档（异步，不阻塞）
            └─ 消息数 >= 6 时调用 2 次 LLM
```

### 当前问题

| 问题 | 说明 |
|------|------|
| **话题检测阻塞** | `checkAndHandleTopicShift` 在对话前同步执行，会阻塞用户 |
| **并发 LLM 调用** | 反思和归档并行执行，可能同时 3 个 LLM 调用 |
| **无任务间隔** | 连续调用 LLM，对本地 Ollama 造成压力 |

### 当前 LLM 调用频次

| 任务 | 触发条件 | LLM 调用 | 频次 |
|------|---------|---------|------|
| 话题检测 | 消息数 >= 6 | 1 次 | 每次发消息前 |
| 对话主流程 | 每次对话 | 1+ 次 | 每次发消息 |
| 反思心智 | 每次对话后 | 1 次 | 每次发消息后 |
| 历史归档-总结 | 消息数 >= 6 | 1 次 | 满足条件时 |
| 历史归档-匹配 | 消息数 >= 6 | 1 次 | 满足条件时 |

**最坏情况**：一次对话触发 **5 次 LLM 调用**（话题检测 + 对话 + 反思 + 归档总结 + 归档匹配）

---

## 设计目标

1. **不阻塞主流程** - 对话完成后立即返回给前端
2. **串行执行** - 避免并发 LLM 调用造成压力
3. **条件触发** - 根据消息计数决定执行哪些任务
4. **任务间隔** - 每个任务之间有足够间隔
5. **容错** - 后台任务失败不影响主流程

---

## 新设计方案

### 调用流程

```
用户发送消息
    │
    ▼
对话主流程（LLM 调用）
    │
    ▼
SSE 流结束，返回给前端 ─────────────────► 前端显示完成
    │
    ▼ (setImmediate，不阻塞)
┌─────────────────────────────────────────────┐
│ 后台任务调度器（串行执行）                    │
│                                             │
│ [0s] 反思心智（每次）                        │
│      └─ LLM 调用: 1 次                      │
│                                             │
│ [~10s] 历史归档（消息数 >= 6）               │
│        ├─ summarizeConversation()           │
│        │  └─ 同时完成：标题/描述/用户信息     │
│        │  └─ LLM 调用: 1 次                 │
│        ├─ 等待 10s                          │
│        └─ matchOrCreateTopic()              │
│           └─ LLM 调用: 1 次                 │
│                                             │
│ [~40s] 话题检测（下次对话开始时跳过）         │
│        └─ 移到后台，不再阻塞                 │
└─────────────────────────────────────────────┘
```

### 任务策略

| 任务 | 触发条件 | 优先级 | LLM 调用 | 间隔 |
|------|---------|--------|---------|------|
| 反思心智 | 每次对话后 | 10（高） | 1 次 | - |
| 历史归档-总结 | 消息数 >= 6 | 5（中） | 1 次 | 10s |
| 历史归档-匹配 | 消息数 >= 6 | 4（中） | 1 次 | 10s |
| 话题检测 | 消息数 >= 6 | 3（低） | 1 次 | 10s |

### 消息数 >= 6 的判定

```javascript
// 在 memory-system.js 中
async shouldProcessHistory(userId, maxMessages = 6, ...) {
  const count = await this.db.getMessageCount(this.expertId, userId);
  
  if (count >= maxMessages) {
    return true;  // 触发归档
  }
  // ...
}
```

**判定逻辑**：
- 统计当前专家 + 用户的所有消息数量
- 当消息数 >= 6 时，触发历史归档
- 归档后保留最新 10 条，其余移到 Topic

### 标题更新、用户信息提取、Topic 匹配的处理

这些都在 **历史归档** 流程中完成：

```
processHistory()
    │
    ├─► summarizeConversation()     ← 第 1 次 LLM 调用
    │   └─ 同时返回：
    │       - topicName（话题标题）     → 更新 Topic 标题
    │       - topicDescription（描述）  → 更新 Topic 描述
    │       - userProfile（用户画像）   → 更新用户档案
    │       - userInfo（用户信息）      → 更新性别/年龄/称呼等
    │       - keywords / category
    │
    └─► matchOrCreateTopic()        ← 第 2 次 LLM 调用
        └─ 判断是否匹配现有 Topic
```

### 话题检测的改进

**当前问题**：话题检测在对话前同步执行，阻塞用户

**改进方案**：将话题检测移到后台，下次对话时使用上次检测结果

```javascript
// 方案 A：后台检测，结果存入数据库
// 下次对话开始时，检查是否有待处理的检测结果

// 方案 B（更简单）：直接移除话题检测
// 让用户手动切换话题，或通过历史归档自动创建新 Topic
```

---

## 代码实现

### 1. 后台任务调度器

**文件：** `lib/background-tasks.js`

```javascript
import logger from './logger.js';

class BackgroundTaskScheduler {
  constructor(options = {}) {
    this.tasks = new Map();
    this.isRunning = false;
    this.minDelay = options.minDelay || 10000;  // 任务间隔 10s
    this.maxRetries = options.maxRetries || 1;  // 后台任务只重试 1 次
  }

  register(name, condition, handler, options = {}) {
    this.tasks.set(name, {
      name,
      condition,
      handler,
      priority: options.priority || 0,
    });
  }

  trigger(context) {
    setImmediate(() => this.runTasks(context));
  }

  async runTasks(context) {
    if (this.isRunning) {
      logger.info('[BackgroundTasks] 已有任务在执行，跳过');
      return;
    }

    this.isRunning = true;
    const sortedTasks = [...this.tasks.values()].sort((a, b) => b.priority - a.priority);

    for (const task of sortedTasks) {
      try {
        const shouldRun = await task.condition(context);
        if (!shouldRun) continue;

        logger.info(`[BackgroundTasks] 执行: ${task.name}`);
        await task.handler(context);
        
        await this.delay(this.minDelay);  // 任务间隔
      } catch (error) {
        logger.error(`[BackgroundTasks] 失败: ${task.name}`, error.message);
      }
    }

    this.isRunning = false;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const backgroundScheduler = new BackgroundTaskScheduler();
```

### 2. 在 chat-service.js 中使用

```javascript
import { backgroundScheduler } from './background-tasks.js';

// 在 streamChat 完成后
onComplete?.({ ... });

// 触发后台任务（不阻塞）
backgroundScheduler.trigger({
  expertService,
  userId: user_id,
  topicId: topic_id,
  messageCount,  // 需要获取当前消息数
  triggerMessage: content,
  myResponse: fullContent,
});
```

### 3. 注册任务

```javascript
// 反思心智 - 每次都执行
backgroundScheduler.register(
  'reflective-mind',
  () => true,
  async (ctx) => {
    await ctx.expertService.performReflection(
      ctx.userId, ctx.triggerMessage, ctx.myResponse, ctx.topicId
    );
  },
  { priority: 10 }
);

// 历史归档 - 消息数 >= 6
backgroundScheduler.register(
  'history-archive',
  async (ctx) => {
    return await ctx.expertService.memorySystem.shouldProcessHistory(ctx.userId);
  },
  async (ctx) => {
    await ctx.expertService.processHistoryIfNeeded(ctx.userId, ctx.topicId);
  },
  { priority: 5 }
);
```

---

## LLM 调用次数对比

| 场景 | 当前 | 优化后 |
|------|------|--------|
| 每次对话（消息数 < 6） | 2 次（对话 + 反思） | 2 次（对话 + 反思） |
| 每次对话（消息数 >= 6） | 5 次（检测 + 对话 + 反思 + 归档×2） | 4 次（对话 + 反思 + 归档×2） |
| 话题检测 | 阻塞对话前 | 移到后台或移除 |

**优化效果**：
- 话题检测不再阻塞
- 后台任务串行执行，间隔 10s+
- 减少 LLM 并发压力

---

## 相关文档

- [LLM 调用场景汇总](../v1/llm-call-scenarios.md)
- [双心智架构](../v1/architecture-analysis-report.md)
