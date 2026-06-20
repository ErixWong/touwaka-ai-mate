# 后端消息流转架构分析

✌Bazinga！

## 概述

本文档分析 Touwaka Mate v2 后端的消息流转机制，重点关注四种消息类型：
1. 用户发出的消息
2. 专家调用 LLM 的消息
3. 专家调用助理的消息
4. 驻留 skill 发出的消息

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (Vue 3)                                │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│   │ Chat Panel  │    │Assistant Pnl│    │  Debug Pnl  │                    │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                    │
└──────────┼──────────────────┼──────────────────┼───────────────────────────┘
           │ SSE              │ REST             │ REST
           ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API Server (Koa)                                   │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│   │StreamController │    │AssistantCtrl    │    │ InternalCtrl    │        │
│   │  (SSE 推送)      │    │  (异步委托)      │    │  (内部 API)     │        │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘        │
│            │                      │                      │                  │
│   ┌────────▼────────┐    ┌────────▼────────┐    ┌────────▼────────┐        │
│   │  ChatService    │    │AssistantManager │    │ResidentSkillMgr │        │
│   │  (对话服务)      │    │  (助理管理)      │    │  (驻留进程)     │        │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘        │
│            │                      │                      │                  │
│   ┌────────▼────────┐             │             ┌────────▼────────┐        │
│   │ExpertChatService│             │             │ ResidentProcess │        │
│   │  (专家实例)      │             │             │   (子进程)      │        │
│   └────────┬────────┘             │             └─────────────────┘        │
│            │                      │                                        │
│   ┌────────▼────────┐    ┌────────▼────────┐                              │
│   │   ToolManager   │◄───┤  (继承工具)     │                              │
│   │   (工具管理)     │    └─────────────────┘                              │
│   └────────┬────────┘                                                      │
│            │                                                               │
│   ┌────────▼────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│   │   LLMClient     │    │   SkillLoader   │    │   RAGService    │        │
│   │  (LLM 调用)     │    │  (技能加载)      │    │  (知识检索)     │        │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                           ┌─────────────────┐
                           │     MySQL       │
                           │  (数据持久化)    │
                           └─────────────────┘
```

---

## 二、消息流转详解

### 2.1 用户发出的消息

**入口**: `POST /api/chat` → [`StreamController.sendMessage()`](server/controllers/stream.controller.js:33)

**流程**:

```
1. 前端建立 SSE 连接
   GET /api/chat/stream?expert_id=xxx
   └─→ StreamController.subscribe()
       └─→ 创建 SSE 连接，存入 expertConnections Map

2. 前端发送消息
   POST /api/chat { content, expert_id, model_id, task_id, task_path }
   └─→ StreamController.sendMessage()
       ├─→ 检查 SSE 连接是否存在
       ├─→ 获取或创建活跃 Topic
       └─→ 异步调用 processMessageAsync()

3. 消息处理（异步）
   processMessageAsync()
   └─→ ChatService.streamChat()
       ├─→ 获取专家服务 (getExpertService)
       ├─→ 获取任务上下文 (getTaskContext) - 如果有 task_id
       ├─→ 保存用户消息 (saveUserMessage)
       │   └─→ topic_id = NULL（未归档状态）
       ├─→ 检查上下文压缩 (shouldCompressContext)
       ├─→ 构建上下文 (buildContext)
       │   ├─→ 获取话题历史消息
       │   ├─→ 获取技能列表
       │   ├─→ RAG 检索知识库
       │   └─→ ContextManager.buildContext()
       ├─→ 调用 LLM（流式）
       │   └─→ LLMClient.callStream()
       │       ├─→ 处理多模态消息
       │       ├─→ 发送 HTTP 请求
       │       └─→ 流式返回 delta
       ├─→ 处理工具调用（多轮）
       │   └─→ ToolManager.executeToolCalls()
       ├─→ 保存助手消息 (saveAssistantMessage)
       ├─→ 异步执行反思 (performReflection)
       └─→ 更新话题时间戳
```

**关键数据结构**:

```javascript
// SSE 连接池
expertConnections: Map<expertId, Set<{user_id, res}>>

// 消息存储
{
  id: string,
  topic_id: null,  // 新消息不分配 topic_id，压缩时再分配
  user_id: string,
  expert_id: string,
  role: 'user' | 'assistant',
  content: string,
  tool_calls: JSON,  // 工具调用记录
  inner_voice: JSON, // 反思心智输出
}
```

**SSE 事件类型**:

| 事件 | 说明 |
|------|------|
| `connected` | SSE 连接建立成功 |
| `start` | 开始处理消息 |
| `delta` | 流式内容增量 |
| `tool_call` | 工具调用开始 |
| `tool_results` | 工具执行结果 |
| `topic_updated` | 上下文压缩创建了新 Topic |
| `complete` | 消息处理完成 |
| `error` | 处理错误 |
| `heartbeat` | 心跳保活（5秒间隔）|

---

### 2.2 专家调用 LLM 的消息

**核心类**: [`LLMClient`](lib/llm-client.js)

**双心智架构**:

```
┌─────────────────────────────────────────────────────────────┐
│                      Expert Instance                         │
│  ┌─────────────────────┐    ┌─────────────────────┐        │
│  │  Expressive Mind    │    │  Reflective Mind    │        │
│  │  (表达心智)          │    │  (反思心智)          │        │
│  │  - 生成对话回复      │    │  - 生成内心独白      │        │
│  │  - 调用工具          │    │  - 自我评估          │        │
│  │  - temperature: 0.7 │    │  - temperature: 0.3 │        │
│  └──────────┬──────────┘    └──────────┬──────────┘        │
│             │                          │                    │
│             ▼                          ▼                    │
│  ┌─────────────────────────────────────────────────┐       │
│  │              LLMClient.callStream()              │       │
│  │  - 处理多模态消息                                 │       │
│  │  - 流式 HTTP 请求                                 │       │
│  │  - 工具调用累积                                   │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

**调用流程**:

```javascript
// 1. 表达心智调用（生成对话）
await llmClient.callStream(modelConfig, messages, {
  tools,           // 工具定义
  onDelta,         // 流式内容回调
  onToolCall,      // 工具调用回调
  onUsage,         // Token 使用回调
});

// 2. 反思心智调用（生成内心独白）
await llmClient.callReflective(messages, {
  temperature: 0.3,  // 更低的温度，更稳定的输出
  timeout: 90000,    // 更长的超时
});
```

**多轮工具调用**:

```
┌──────────────────────────────────────────────────────────────┐
│                    Tool Call Loop                             │
│                                                               │
│  ┌─────────┐    ┌─────────────┐    ┌─────────────────┐      │
│  │  LLM    │───►│ ToolManager │───►│ Skill Execution │      │
│  │ Request │    │.executeTool │    │ (子进程隔离)     │      │
│  └─────────┘    └──────┬──────┘    └────────┬────────┘      │
│       ▲                │                    │                │
│       │                ▼                    ▼                │
│       │         ┌─────────────┐    ┌─────────────────┐      │
│       └─────────│ Tool Result │◄───│ JSON Response   │      │
│                 └─────────────┘    └─────────────────┘      │
│                                                               │
│  最多 20 轮，防止无限循环                                      │
└──────────────────────────────────────────────────────────────┘
```

---

### 2.3 专家调用助理的消息

**核心类**: [`AssistantManager`](server/services/assistant-manager.js)

**助理类型**:

| 执行模式 | 说明 | 示例 |
|---------|------|------|
| `direct` | 直接调用工具，无 LLM | 文件操作 |
| `llm` | 纯 LLM 推理 | 文本分析 |
| `hybrid` | LLM + 工具组合 | 图片分析 |

**调用流程**:

```
1. LLM 返回工具调用
   tool_calls: [{ function: { name: 'assistant_summon', arguments: {...} } }]

2. ToolManager 识别助理工具
   ToolManager.executeTool('assistant_summon', params, context)
   └─→ AssistantManager.executeTool()
       └─→ AssistantManager.summon()

3. 创建异步委托
   summon()
   ├─→ 生成 request_id
   ├─→ 创建数据库记录 (status: 'pending')
   ├─→ 写入任务消息
   └─→ 异步执行 executeRequest()

4. 异步执行
   executeRequest()
   ├─→ 更新状态为 'running'
   ├─→ 根据执行模式执行：
   │   ├─→ direct: executeDirect()
   │   ├─→ llm: executeLLM()
   │   └─→ hybrid: executeHybrid()
   └─→ 更新状态为 'completed' 或 'failed'

5. 前端获取结果
   - 轮询: GET /api/assistant/requests/:request_id
   - SSE 推送: 通过 expertConnections 推送状态更新
```

**继承工具机制**:

```javascript
// 助理可以继承专家的工具
const summonParams = {
  type: 'doc_image_analyzer',
  input: { file_path: '...' },
  inherited_tools: ['kb-search_search', 'file-operations_read'],  // 继承的工具
};

// 助理执行时可调用继承的工具
AssistantManager.executeInheritedTool(toolId, params, context)
└─→ ToolManager.executeTool()
```

---

### 2.4 驻留 Skill 发出的消息

**核心类**: [`ResidentSkillManager`](lib/resident-skill-manager.js)

**驻留进程生命周期**:

```
┌─────────────────────────────────────────────────────────────┐
│                   Server Lifecycle                           │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Startup   │───►│  Initialize │───►│   Running   │     │
│  └─────────────┘    └─────────────┘    └──────┬──────┘     │
│                                               │              │
│  ┌─────────────┐    ┌─────────────┐          │              │
│  │  Shutdown   │◄───│  Stopping   │◄─────────┘              │
│  └─────────────┘    └─────────────┘                         │
└─────────────────────────────────────────────────────────────┘

启动时：
ResidentSkillManager.initialize()
└─→ 查询 is_resident = true 的工具
    └─→ 为每个工具启动子进程
        └─→ ResidentProcess.start()
            └─→ spawn('node', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })

关闭时：
ResidentSkillManager.shutdown()
└─→ 发送 'exit' 命令
    └─→ 等待进程退出或 5 秒后 SIGTERM
```

**通信协议**:

```javascript
// 主进程 → 子进程（stdin）
{ "command": "invoke", "task_id": "xxx", "params": {...} }
{ "command": "exit" }

// 子进程 → 主进程（stdout）
{ "type": "log", "message": "..." }
{ "task_id": "xxx", "result": {...} }
{ "task_id": "xxx", "error": "..." }
```

**调用入口**:

```
POST /internal/resident/invoke
{
  "skill_id": "xxx",
  "tool_name": "yyy",
  "params": {...},
  "timeout": 60000
}

InternalController.invokeResidentTool()
└─→ ResidentSkillManager.invokeByName()
    └─→ ResidentProcess.invoke()
        └─→ 发送命令到子进程 stdin
            └─→ 等待 stdout 响应（带超时）
```

**插入消息触发专家响应**:

```
POST /internal/messages/insert
{
  "user_id": "xxx",
  "expert_id": "yyy",
  "content": "消息内容",
  "role": "user",           // 或 "assistant"
  "trigger_expert": true    // 是否触发专家响应
}

InternalController.insertMessage()
├─→ 验证内部调用权限
├─→ 获取或创建 Topic
├─→ 创建消息记录
├─→ SSE 推送通知 (event: 'new_context')
└─→ 如果 trigger_expert = true:
    └─→ triggerExpertResponse()
        └─→ ChatService.streamChat()
```

---

## 三、数据流向图

### 3.1 用户消息完整流程

```
┌──────────┐    POST /api/chat     ┌────────────────┐
│  Frontend│──────────────────────►│StreamController│
│  Chat.vue│                       │  .sendMessage()│
└──────────┘                       └───────┬────────┘
    ▲                                      │
    │ SSE                                  ▼
    │                             ┌────────────────┐
    │                             │  ChatService   │
    │                             │  .streamChat() │
    │                             └───────┬────────┘
    │                                     │
    │              ┌──────────────────────┼──────────────────────┐
    │              │                      │                      │
    │              ▼                      ▼                      ▼
    │     ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
    │     │ExpertChatService│   │  ToolManager   │    │  LLMClient     │
    │     │  .buildContext()│   │.executeTool()  │    │  .callStream() │
    │     └────────────────┘    └───────┬────────┘    └───────┬────────┘
    │                                   │                      │
    │                                   ▼                      ▼
    │                          ┌────────────────┐    ┌────────────────┐
    │                          │  SkillLoader   │    │  LLM Provider  │
    │                          │.executeSkill() │    │  (OpenAI etc)  │
    │                          └───────┬────────┘    └────────────────┘
    │                                   │
    │                                   ▼
    │                          ┌────────────────┐
    │                          │ skill-runner.js│
    │                          │  (子进程隔离)   │
    │                          └────────────────┘
    │
    └──────────── SSE Events (delta, tool_call, complete) ────────────►
```

### 3.2 助理调用流程

```
┌────────────────┐    tool_call: assistant_summon    ┌────────────────┐
│   LLMClient    │──────────────────────────────────►│  ToolManager   │
│  (LLM 响应)    │                                   │  .executeTool()│
└────────────────┘                                   └───────┬────────┘
                                                             │
                                                             ▼
                                                    ┌────────────────┐
                                                    │AssistantManager│
                                                    │   .summon()    │
                                                    └───────┬────────┘
                                                            │
                         ┌──────────────────────────────────┼──────────────────────────┐
                         │                                  │                          │
                         ▼                                  ▼                          ▼
                ┌────────────────┐                 ┌────────────────┐        ┌────────────────┐
                │ executeDirect()│                 │ executeLLM()   │        │executeHybrid() │
                │   (直接调用)    │                 │  (LLM 推理)    │        │  (混合模式)    │
                └───────┬────────┘                 └───────┬────────┘        └───────┬────────┘
                        │                                  │                          │
                        ▼                                  ▼                          ▼
                ┌────────────────┐                 ┌────────────────┐        ┌────────────────┐
                │  ToolManager   │                 │    LLM API     │        │ LLM + ToolManager│
                │.executeTool()  │                 │                │        │                 │
                └────────────────┘                 └────────────────┘        └────────────────┘
                                                            │
                                                            ▼
                                                   ┌────────────────┐
                                                   │ assistant_    │
                                                   │ requests (DB)  │
                                                   │ status:       │
                                                   │ pending→running│
                                                   │ →completed    │
                                                   └────────────────┘
```

---

## 四、优化建议

### 4.1 架构层面优化

#### 4.1.1 消息队列解耦

**问题**: 当前消息处理是直接异步调用，缺乏队列管理，可能导致：
- 高并发时资源竞争
- 无法实现优先级调度
- 失败重试机制不完善

**建议**: 引入轻量级消息队列

```javascript
// 使用 BullMQ 或类似库
import { Queue, Worker } from 'bullmq';

const chatQueue = new Queue('chat-processing');

// 添加任务
await chatQueue.add('process-message', {
  topic_id, user_id, expert_id, content
}, {
  priority: userPriority,
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
});

// Worker 处理
const worker = new Worker('chat-processing', async job => {
  return await chatService.streamChat(job.data);
});
```

#### 4.1.2 SSE 连接管理优化

**问题**: 当前 SSE 连接存储在内存 Map 中：
- 服务重启时连接丢失
- 无法支持多实例部署

**建议**: 使用 Redis 存储连接状态

```javascript
// 使用 Redis Pub/Sub 实现跨实例推送
const redis = new Redis();
const publisher = new Redis();

// 订阅消息
redis.subscribe(`user:${userId}:expert:${expertId}`);

// 发布消息
publisher.publish(`user:${userId}:expert:${expertId}`, JSON.stringify({
  event: 'delta',
  data: { content }
}));
```

### 4.2 性能优化

#### 4.2.1 上下文构建优化

**问题**: 每次对话都重新构建完整上下文，包括：
- 加载专家配置
- 加载技能定义
- RAG 检索
- 历史消息加载

**建议**: 实现分层缓存

```javascript
// 三级缓存架构
class ContextCache {
  // L1: 内存缓存（热点数据）
  memoryCache = new LRUCache({ max: 100, ttl: 60000 });
  
  // L2: Redis 缓存（跨实例共享）
  redisCache = new Redis();
  
  // L3: 数据库
  database;
  
  async getExpertConfig(expertId) {
    // 1. 检查内存缓存
    if (this.memoryCache.has(expertId)) {
      return this.memoryCache.get(expertId);
    }
    
    // 2. 检查 Redis 缓存
    const cached = await this.redisCache.get(`expert:${expertId}`);
    if (cached) {
      this.memoryCache.set(expertId, cached);
      return cached;
    }
    
    // 3. 从数据库加载
    const config = await this.database.loadExpertConfig(expertId);
    await this.redisCache.set(`expert:${expertId}`, config, 'EX', 300);
    this.memoryCache.set(expertId, config);
    return config;
  }
}
```

#### 4.2.2 工具调用并行化

**问题**: 当前工具调用是串行执行的

```javascript
// 当前实现（串行）
for (const call of toolCalls) {
  const result = await this.executeTool(toolName, params, context);
  results.push(result);
}
```

**建议**: 无依赖的工具调用并行执行

```javascript
// 分析工具调用依赖
const { independent, dependent } = this.analyzeToolDependencies(toolCalls);

// 并行执行无依赖的工具
const independentResults = await Promise.all(
  independent.map(call => this.executeTool(call.name, call.params, context))
);

// 串行执行有依赖的工具
const dependentResults = [];
for (const call of dependent) {
  const result = await this.executeTool(call.name, {
    ...call.params,
    // 注入前面工具的结果
    previousResults: [...independentResults, ...dependentResults]
  }, context);
  dependentResults.push(result);
}
```

### 4.3 可靠性优化

#### 4.3.1 消息持久化增强

**问题**: 当前消息发送后立即返回，如果处理失败：
- 用户消息已保存但无响应
- 无法自动重试

**建议**: 实现消息状态追踪

```javascript
// 消息状态表
CREATE TABLE message_status (
  message_id VARCHAR(20) PRIMARY KEY,
  status ENUM('pending', 'processing', 'completed', 'failed'),
  retry_count INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

// 处理流程
async processMessageAsync(params) {
  const messageId = await this.saveUserMessage(params);
  
  try {
    await this.updateMessageStatus(messageId, 'processing');
    // ... 处理逻辑
    await this.updateMessageStatus(messageId, 'completed');
  } catch (error) {
    await this.updateMessageStatus(messageId, 'failed', error.message);
    // 触发重试或告警
  }
}
```

#### 4.3.2 驻留进程健康检查

**问题**: 驻留进程可能静默失败

**建议**: 实现心跳检测和自动重启

```javascript
class ResidentProcess {
  startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      if (this.state === ProcessState.RUNNING) {
        try {
          // 发送 ping 命令
          const response = await this.invoke({ command: 'ping' }, 5000);
          if (response !== 'pong') {
            this.handleHealthCheckFailure('Invalid response');
          }
        } catch (error) {
          this.handleHealthCheckFailure(error.message);
        }
      }
    }, 30000); // 30秒检查一次
  }
  
  async handleHealthCheckFailure(reason) {
    logger.error(`Health check failed: ${reason}`);
    await this.stop();
    await this.start(); // 自动重启
  }
}
```

### 4.4 代码质量优化

#### 4.4.1 统一错误处理

**问题**: 错误处理分散在各处，格式不统一

**建议**: 实现统一的错误处理中间件

```javascript
class AppError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

// 错误类型定义
const ErrorCodes = {
  SSE_NOT_CONNECTED: { code: 'SSE_NOT_CONNECTED', statusCode: 410 },
  EXPERT_NOT_FOUND: { code: 'EXPERT_NOT_FOUND', statusCode: 404 },
  TOOL_EXECUTION_FAILED: { code: 'TOOL_EXECUTION_FAILED', statusCode: 500 },
  // ...
};

// 统一错误处理中间件
async function errorHandler(ctx, next) {
  try {
    await next();
  } catch (error) {
    if (error instanceof AppError) {
      ctx.status = error.statusCode;
      ctx.body = { code: error.code, message: error.message };
    } else {
      logger.error('Unexpected error:', error);
      ctx.status = 500;
      ctx.body = { code: 'INTERNAL_ERROR', message: '服务器内部错误' };
    }
  }
}
```

#### 4.4.2 日志规范化

**问题**: 日志格式不统一，难以追踪

**建议**: 实现结构化日志

```javascript
// 使用 pino 或 winston
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// 添加请求追踪
function requestLogger(ctx, next) {
  const requestId = ctx.get('X-Request-ID') || uuid();
  ctx.state.requestId = requestId;
  
  logger.info({
    requestId,
    method: ctx.method,
    path: ctx.path,
    userId: ctx.state.session?.id,
  }, 'Request started');
  
  return next().then(() => {
    logger.info({
      requestId,
      status: ctx.status,
      duration: Date.now() - ctx.state.startTime,
    }, 'Request completed');
  });
}
```

---

## 五、总结

### 当前架构优点

1. **清晰的分层设计**: Controller → Service → Client，职责明确
2. **双心智架构**: 表达心智 + 反思心智，支持复杂 AI 行为
3. **工具隔离执行**: 技能代码在子进程中运行，安全性高
4. **流式响应**: SSE 实时推送，用户体验好
5. **异步助理**: 支持长时间任务，不阻塞主流程

### 主要改进方向

| 优先级 | 改进项 | 影响 | 工作量 |
|-------|--------|------|--------|
| 高 | 消息队列解耦 | 提高可靠性 | 中 |
| 高 | 统一错误处理 | 提高可维护性 | 低 |
| 中 | SSE 连接管理 | 支持多实例 | 中 |
| 中 | 上下文缓存 | 提高性能 | 中 |
| 低 | 工具并行化 | 提高性能 | 低 |
| 低 | 驻留进程健康检查 | 提高可靠性 | 低 |

---

*让我们一起愉快地写代码吧！ 💪✨*