# Psyche 上下文管理机制 - 详细设计文档

## 1. 概述

### 1.1 设计理念

**给 LLM 一个干净的起点，让它自己决定需要什么信息。**

传统方案中，上下文由后端拼装，LLM 被动接收。当上下文变得纷乱时，LLM 没有主动权来清理或重组。Psyche 机制将信息管理的责任转移给 LLM，让它主动决定需要什么信息。

### 1.2 核心概念

```
Psyche 上下文 = System Prompt（含 Psyche 文本）+ 用户消息 + 可选工具
```

不再由后端拼装大量历史信息，而是通过 Psyche（心神）提供精简的工作记忆。

### 1.3 架构定位

**Psyche 是 IContextOrganizer 的核心组件，不是 Skill。**

| 组件 | 归属 | 职责 |
|------|------|------|
| Psyche 生成 | IContextOrganizer | 反思阶段自动生成，注入 System Prompt |
| Notes 存取 | Skill | LLM 主动调用，按需加载材料 |

**原因**：
- Psyche 需要修改 System Prompt（Skill 做不到）
- Psyche 需要替代 Messages（Skill 做不到）
- Notes 作为 Skill，任何上下文策略都能使用

---

## 2. 工作流程

### 2.1 统一工作流程

对于任何不清晰的需求，LLM 都应反问确认。这是对双方时间的尊重。

```
用户消息
    ↓
【反思阶段】IContextOrganizer 自动执行：
    1. 获取过去 4 轮对话
    2. 获取当前 Psyche（JSON 格式）
    3. 调用反思 LLM → 更新 Psyche
    4. 将 Psyche 转换为文本格式
    5. 构建 System Prompt（注入 Psyche 文本）
    6. 用 Psyche 替代原始 Messages
    ↓
【生成阶段】LLM 基于 Psyche 生成回复
    ↓
【可选】LLM 调用 notes.take 存入新材料
    ↓
【可选】LLM 调用 notes.read 获取 Notes 材料
    ↓
返回用户
```

### 2.2 反问确认机制

对于模糊需求，LLM 使用 Psyche 记录澄清过程：

```
用户：帮我做个方案
    ↓
Psyche 注入：
  当前主题：方案制定（需求待澄清）
  工作阶段：需求收集
  待确认问题：["什么类型的方案？", "预算范围？", "时间要求？"]
    ↓
LLM：需要了解一些信息：1.什么类型的方案？2.预算范围？...
    ↓
用户：预算方案，50万，两周内
    ↓
Psyche 更新：
  工作阶段：执行阶段
  已确认需求：["预算方案", "50万", "两周"]
    ↓
LLM 继续工作...
```

---

## 3. Psyche（心神）设计

### 3.1 存储格式 vs 注入格式

| 维度 | 存储格式 | 注入格式 |
|------|---------|---------|
| **格式** | JSON（便于处理） | 文本（便于阅读） |
| **位置** | Redis/内存 | System Prompt |
| **用途** | 后端处理、反思更新 | LLM 直接阅读 |

**转换示例**：

```javascript
// 存储格式（JSON）
const psycheJSON = {
  session_meta: {
    current_topic: "Q2 预算方案",
    conversation_round: 5
  },
  methodology: {
    approach: "收集需求 → 查询历史 → 生成方案",
    current_phase: "细化配置"
  },
  notes_refs: ["q1_budget", "server_quote"]
};

// 注入格式（文本）
const psycheText = `
【心神】
当前主题：Q2 技术部预算方案制定
工作阶段：细化配置阶段（已完成需求收集和框架生成）

关键决策：
- 总预算：50 万元
- 分配比例：服务器 60%（30万），云服务 40%（20万）

可用笔记（通过 notes.read 获取）：
- notes:q1_budget → Q1 预算报告，实际支出 42 万
- notes:server_quote → 服务器供应商报价单
`;
```

### 3.2 Psyche 构成（6 大模块）

```json
{
  "session_meta": {
    "current_topic": "Q2 预算方案",
    "user_intent": "制定技术部预算",
    "conversation_round": 5,
    "last_updated": "2026-03-31T14:30:00Z"
  },
  
  "methodology": {
    "approach": "收集需求 → 查询历史 → 生成方案 → 细化配置",
    "current_phase": "细化配置",
    "next_action": "询问服务器具体配置需求"
  },
  
  "conversation_digest": {
    "key_exchanges": [
      {"round": 1, "summary": "用户要求制定 Q2 预算，确认预算 50 万"},
      {"round": 3, "summary": "生成预算框架，服务器:云服务 = 6:4"},
      {"round": 5, "summary": "用户追问服务器具体配置"}
    ],
    "key_decisions": ["总预算 50 万", "覆盖技术部", "服务器+云服务"],
    "pending_questions": ["服务器具体配置？"]
  },
  
  "notes_refs": [
    {"id": "q1_budget", "summary": "Q1 预算报告，实际支出 42 万", "relevance": 0.95},
    {"id": "server_quote", "summary": "服务器报价单", "relevance": 0.88}
  ],
  
  "topics_context": [
    {"topic_id": 123, "title": "Q2 预算规划", "relevance": 0.98}
  ],
  
  "working_memory": {
    "calculated_values": {"server_budget": 300000, "cloud_budget": 200000},
    "temp_notes": "用户倾向于 AWS 而非阿里云"
  }
}
```

### 3.3 反思阶段的工作流程

```javascript
class MinimalContextOrganizer {
  constructor(psycheStore, notesStore) {
    this.psycheStore = psycheStore; // IPsycheStore 实例
    this.notesStore = notesStore;    // INotesStore 实例
  }
  
  async organize(memorySystem, userId, options) {
    // 1. 获取过去 N 轮对话（通过时间边界查询，包含 tool 消息）
    const { messages: recentMessages, topics, dialogCount } =
      await this._getRecentMessages(memorySystem, userId, expertId);
    
    // 2. 从 Store 获取当前 Psyche（JSON）
    const currentPsyche = await this.psycheStore.get(userId, options.expertId)
      || this.createEmptyPsyche();
    
    // 3. 调用反思 LLM 更新 Psyche（含滑动窗口处理）
    const reflection = await this._reflectionService.reflect(
      currentPsyche.toJSON(),
      recentMessages,
      topics,
      { userId, expertId, dialogCount }
    );
    
    // 4. 执行压缩、遗忘、总结、构造
    const updatedPsyche = this.processPsyche(reflection);
    
    // 5. 保存回 Store
    await this.psycheStore.set(userId, options.expertId, updatedPsyche, 3600);
    
    // 6. 转换为文本注入 System Prompt
    const psycheText = this.formatPsycheForPrompt(updatedPsyche);
    const systemPrompt = this.buildSystemPrompt(psycheText, options.taskContext);
    
    // 7. 构建 messages 数组（处理 tool_calls 映射）
    const messages = this._buildMessagesArray(recentMessages, options.currentMessage);
    
    // 8. 返回精简上下文（Psyche 替代 Messages）
    return new ContextResult({
      systemPrompt,
      messages,
      hiddenContext: {
        psyche: updatedPsyche,
        stats: this._psycheManager.getStats(updatedPsyche)
      }
    });
  }
}
```

### 3.4 反思服务的滑动窗口机制

当历史消息过多时，反思 LLM 的上下文可能不足以处理全部消息。此时需要使用**滑动窗口机制**截断消息。

#### 滑动窗口策略

```javascript
class ReflectionService {
  _applySlidingWindow(messages, currentPsyche, topics) {
    // 计算最大允许的输入 token 数（默认占反思 LLM 上下文的 85%）
    const maxInputTokens = Math.floor(
      this.config.reflectionContextSize * this.config.inputTokenRatio
    );
    
    // 估算固定开销（Psyche + Topics + Prompt 模板）
    const fixedTokens =
      this._estimateJsonTokens(currentPsyche) +
      this._estimateTopicsTokens(topics) +
      1500; // Prompt 模板约 1500 tokens
    
    // 消息部分可用的 token 预算
    const messagesBudget = maxInputTokens - fixedTokens;
    
    // 如果未超预算，直接返回
    let currentTokens = this._estimateMessagesTokens(messages);
    if (currentTokens <= messagesBudget) return messages;
    
    // 从最早的消息开始移除，直到符合预算
    let result = [...messages];
    while (result.length > 0 && currentTokens > messagesBudget) {
      result.shift(); // 移除最早的消息
      currentTokens = this._estimateMessagesTokens(result);
      
      // 安全保护：至少保留 4 条消息（2轮对话）
      if (result.length <= 4) break;
    }
    
    return result;
  }
}
```

#### Token 估算方法

| 内容类型 | 估算方式 |
|---------|---------|
| JSON 对象 | `Math.ceil(JSON.stringify(obj).length / 4)` |
| 文本消息 | `Math.ceil(content.length / 4) + 4`（格式开销） |
| Topics | 标题+描述长度 / 4 + 4 |

#### 反思服务配置参数

```javascript
{
  // 反思模型配置（从 ai_models 表获取）
  reflectionModel: 'gpt-4o-mini',           // 反思 LLM 模型
  reflectionContextSize: 128000,            // 反思 LLM 上下文大小（默认 128k）
  reflectionInputRatio: 0.85,               // 输入占反思上下文的比例（预留 15% 给输出）
  
  // 表达模型配置（用于 Psyche 大小限制）
  expressiveContextSize: 128000,            // 表达 LLM 上下文大小
  maxTokensRatio: 0.3,                       // Psyche 占表达上下文最大比例
  
  // 其他配置
  lookbackRounds: 4,                        // 反思时查看过去 4 轮
  enableNotes: true                         // 启用 Notes
}
```

### 3.5 Messages 数组构建与 Tool Calls 映射

在返回给表达 LLM 的 messages 数组中，需要正确处理 `tool_calls` 与 `tool` 消息的关联关系。

#### 核心问题

OpenAI 格式要求：
- `assistant` 消息的 `tool_calls` 中的 `id` 需要与 `tool` 消息的 `tool_call_id` 对应
- 为了便于后续 `recall` 查询，使用 tool 消息的 `messages.id` 作为 `tool_calls.id`

#### 构建流程

```javascript
_buildMessagesArray(recentMessages, currentMessage) {
  // 1. 按时间正序排列
  const sortedMessages = [...recentMessages].sort((a, b) =>
    a.timestamp - b.timestamp
  );
  
  // 2. 构建 tool_call_id -> tool message id 的映射
  const toolCallIdToMessageId = new Map();
  for (const msg of sortedMessages) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      toolCallIdToMessageId.set(msg.tool_call_id, msg.id);
    }
  }
  
  // 3. 识别对话轮次（user -> assistant 为一个轮次）
  const rounds = [];
  let currentRound = null;
  
  for (const msg of sortedMessages) {
    if (msg.role === 'user') {
      if (currentRound) rounds.push(currentRound);
      currentRound = { user: msg, assistant: null };
    } else if (msg.role === 'assistant' && currentRound) {
      currentRound.assistant = msg;
      rounds.push(currentRound);
      currentRound = null;
    }
    // tool 消息不加入 rounds（但已记录 id 映射）
  }
  
  // 4. 只取最近 4 轮
  const recentRounds = rounds.slice(-4);
  
  // 5. 构建 messages 数组
  const messages = [];
  for (const round of recentRounds) {
    // 添加 user 消息
    if (round.user) {
      messages.push({ role: 'user', content: round.user.content });
    }
    
    // 添加 assistant 消息（替换 tool_calls.id 为 tool 消息的 messages.id）
    if (round.assistant) {
      const assistantMsg = {
        role: 'assistant',
        content: round.assistant.content
      };
      
      if (round.assistant.tool_calls?.length > 0) {
        assistantMsg.tool_calls = round.assistant.tool_calls.map(tc => ({
          id: toolCallIdToMessageId.get(tc.id),  // 使用 messages.id
          type: tc.type,
          function: tc.function
        }));
      }
      
      messages.push(assistantMsg);
    }
  }
  
  // 6. 添加当前用户消息
  if (currentMessage) {
    messages.push({ role: 'user', content: currentMessage });
  }
  
  return messages;
}
```

#### 消息角色统计

构建后的 messages 数组包含：
- `user`：用户消息
- `assistant`：AI 回复（可能包含 `tool_calls`）
- 不包含 `tool` 消息（已被整合到 assistant 的 tool_calls 中）

### 3.6 Psyche 大小限制与压缩策略

#### 大小限制

| 指标 | 数值 | 说明 |
|------|------|------|
| **Psyche 文本上限** | 上下文长度的 30% | 如 128k 模型 = 38,400 tokens |
| **警告阈值** | 最大限制的 80% | 达到时触发压缩（30,720 tokens）|
| **Notes 上限** | 100 条 | 按访问频率自动遗忘 |

#### 压缩策略

当 Psyche 接近上限时，按以下优先级压缩：

1. **working_memory** → 转为 Notes 引用
2. **conversation_digest** → 进一步摘要，保留关键决策
3. **notes_refs** → 删除低相关性引用（relevance < 0.5）
4. **topics_context** → 只保留最相关的 3 个 Topic

```javascript
compressPsyche(psyche, maxTokens) {
  const currentTokens = this.estimateTokens(psyche);
  if (currentTokens < maxTokens * 0.8) return psyche;
  
  // 1. 将 working_memory 大段内容转为 Notes
  if (psyche.working_memory.temp_notes) {
    const noteKey = `wm_${Date.now()}`;
    this.notesStore.take(userId, expertId, noteKey, {
      content: psyche.working_memory.temp_notes,
      type: 'working_memory',
      relevance: 0.9
    });
    psyche.notes_refs.push({id: noteKey, summary: "工作记忆临时笔记", relevance: 0.9});
    delete psyche.working_memory.temp_notes;
  }
  
  // 2. 如果还超，删除低相关性 notes_refs
  if (this.estimateTokens(psyche) > maxTokens) {
    psyche.notes_refs = psyche.notes_refs
      .filter(ref => ref.relevance > 0.5)
      .slice(0, 10); // 最多保留 10 个引用
  }
  
  return psyche;
}
```

### 3.7 Psyche 和 Notes 的存储

#### 存储方案对比

| 方案 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **进程内存（Map）** | 单实例、开发环境 | 简单、最快 | 重启丢失、不支持分布式 |
| **Redis（推荐）** | 生产环境、分布式 | TTL自动过期、分布式共享、会话保持 | 增加依赖 |
| **MySQL** | 不需要 | 持久化 | 太重，Psyche/Notes不需要持久化 |

#### 内存存储实现（开发环境）

**适用场景**：
- 开发/测试环境
- 单实例部署
- 快速原型验证

**实现要点**：

```javascript
// lib/psyche-store/memory-store.js
class MemoryPsycheStore {
  constructor() {
    this.store = new Map();  // key -> { data, expireAt }
    this.startCleanupTimer();
  }

  // Key 格式: psyche:{user_id}:{expert_id}
  async get(userId, expertId) {
    const key = `psyche:${userId}:${expertId}`;
    const item = this.store.get(key);
    
    if (!item) return null;
    if (Date.now() > item.expireAt) {
      this.store.delete(key);
      return null;
    }
    
    return item.data;
  }

  async set(userId, expertId, psyche, ttl = 3600) {
    const key = `psyche:${userId}:${expertId}`;
    this.store.set(key, {
      data: psyche,
      expireAt: Date.now() + (ttl * 1000)
    });
  }

  // 自动清理过期数据
  startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.store.entries()) {
        if (now > item.expireAt) {
          this.store.delete(key);
        }
      }
    }, 60000); // 每分钟清理一次
  }
}

class MemoryNotesStore {
  constructor() {
    this.store = new Map();  // key -> { content, metadata, expireAt }
  }

  // Key 格式: notes:{user_id}:{expert_id}:{note_key}
  async read(userId, expertId, key) {
    const fullKey = `notes:${userId}:${expertId}:${key}`;
    const item = this.store.get(fullKey);
    
    if (!item) return null;
    if (Date.now() > item.expireAt) {
      this.store.delete(fullKey);
      return null;
    }
    
    // 更新访问计数
    item.metadata.access_count++;
    item.metadata.last_accessed = new Date().toISOString();
    
    return {
      content: item.content,
      metadata: item.metadata
    };
  }

  async take(userId, expertId, key, note, ttl = 3600) {
    const fullKey = `notes:${userId}:${expertId}:${key}`;
    this.store.set(fullKey, {
      content: note.content,
      metadata: {
        ...note.metadata,
        created_at: new Date().toISOString(),
        access_count: 0
      },
      expireAt: Date.now() + (ttl * 1000)
    });
  }

  async list(userId, expertId) {
    const prefix = `notes:${userId}:${expertId}:`;
    const keys = [];
    
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key.replace(prefix, ''));
      }
    }
    
    return keys;
  }
}
```

**内存存储特点**：
- 数据存储在 Node.js 进程内存中
- 支持 TTL 自动过期（通过定时清理）
- 重启后数据丢失（符合 Psyche 工作记忆的设计）
- 单实例性能最优

#### Redis 存储实现（生产环境）

**适用场景**：
- 生产环境
- 多实例部署
- 需要会话保持

**Key 格式**：

```
# Psyche - Hash 结构
Key: psyche:{user_id}:{expert_id}
Field: session_meta, methodology, conversation_digest, notes_refs, topics_context, working_memory
TTL: 3600秒（1小时）

# Notes - String 结构  
Key: notes:{user_id}:{expert_id}:{note_key}
Value: JSON字符串 {content, type, metadata}
TTL: 3600秒（1小时）
```

**Redis 操作示例**：

```javascript
// lib/psyche-store/redis-store.js
class RedisPsycheStore {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async get(userId, expertId) {
    const key = `psyche:${userId}:${expertId}`;
    const data = await this.redis.hgetall(key);
    
    if (!data || Object.keys(data).length === 0) {
      return null;
    }
    
    // 解析 JSON 字段
    return {
      session_meta: JSON.parse(data.session_meta),
      methodology: JSON.parse(data.methodology),
      conversation_digest: JSON.parse(data.conversation_digest),
      notes_refs: JSON.parse(data.notes_refs),
      topics_context: JSON.parse(data.topics_context),
      working_memory: JSON.parse(data.working_memory)
    };
  }

  async set(userId, expertId, psyche, ttl = 3600) {
    const key = `psyche:${userId}:${expertId}`;
    
    // 使用 Hash 存储，每个字段单独存储
    await this.redis.hset(key, {
      session_meta: JSON.stringify(psyche.session_meta),
      methodology: JSON.stringify(psyche.methodology),
      conversation_digest: JSON.stringify(psyche.conversation_digest),
      notes_refs: JSON.stringify(psyche.notes_refs),
      topics_context: JSON.stringify(psyche.topics_context),
      working_memory: JSON.stringify(psyche.working_memory)
    });
    
    // 设置 TTL
    await this.redis.expire(key, ttl);
  }

  async delete(userId, expertId) {
    const key = `psyche:${userId}:${expertId}`;
    await this.redis.del(key);
  }
}

class RedisNotesStore {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async read(userId, expertId, key) {
    const fullKey = `notes:${userId}:${expertId}:${key}`;
    const data = await this.redis.get(fullKey);
    
    if (!data) return null;
    
    const note = JSON.parse(data);
    
    // 更新访问计数（使用 Redis 事务）
    note.metadata.access_count++;
    note.metadata.last_accessed = new Date().toISOString();
    
    // 获取剩余 TTL
    const ttl = await this.redis.ttl(fullKey);
    await this.redis.set(fullKey, JSON.stringify(note), 'EX', ttl > 0 ? ttl : 3600);
    
    return note;
  }

  async take(userId, expertId, key, note, ttl = 3600) {
    const fullKey = `notes:${userId}:${expertId}:${key}`;
    const data = {
      content: note.content,
      type: note.type,
      metadata: {
        size: note.content.length,
        relevance: note.relevance || 0.5,
        access_count: 0,
        saved_at: new Date().toISOString()
      }
    };
    
    await this.redis.set(fullKey, JSON.stringify(data), 'EX', ttl);
  }

  async list(userId, expertId) {
    const pattern = `notes:${userId}:${expertId}:*`;
    const keys = await this.redis.keys(pattern);
    
    // 提取 note_key 部分
    const prefix = `notes:${userId}:${expertId}:`;
    return keys.map(k => k.replace(prefix, ''));
  }

  async delete(userId, expertId, key) {
    const fullKey = `notes:${userId}:${expertId}:${key}`;
    await this.redis.del(fullKey);
  }
}
```

#### 存储切换配置

**配置方式**：

```javascript
// config.js
module.exports = {
  psyche: {
    store: process.env.PSYCHE_STORE || 'memory', // 'memory' | 'redis'
    ttl: 3600, // 秒
    maxSize: 38400, // tokens
  },
  notes: {
    store: process.env.NOTES_STORE || 'memory', // 'memory' | 'redis'
    ttl: 3600,
    maxCount: 100, // 最大笔记数
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
    password: process.env.REDIS_PASSWORD || undefined,
  }
};
```

**环境变量示例**：

```bash
# 开发环境（内存存储）
PSYCHE_STORE=memory
NOTES_STORE=memory

# 生产环境（Redis 存储）
PSYCHE_STORE=redis
NOTES_STORE=redis
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your_password
```

**存储工厂实现**：

```javascript
// lib/psyche-store/index.js
import { MemoryPsycheStore, MemoryNotesStore } from './memory-store.js';
import { RedisPsycheStore, RedisNotesStore } from './redis-store.js';
import { createClient } from 'redis';

class StoreFactory {
  constructor(config) {
    this.config = config;
    this.instances = {};
  }

  async initialize() {
    // 根据配置初始化存储
    if (this.config.psyche.store === 'redis' || this.config.notes.store === 'redis') {
      this.redisClient = createClient({
        socket: {
          host: this.config.redis.host,
          port: this.config.redis.port,
        },
        password: this.config.redis.password,
        database: this.config.redis.db,
      });
      
      await this.redisClient.connect();
      console.log('[StoreFactory] Redis 连接成功');
    }
  }

  getPsycheStore() {
    if (!this.instances.psyche) {
      this.instances.psyche = this.config.psyche.store === 'redis'
        ? new RedisPsycheStore(this.redisClient)
        : new MemoryPsycheStore();
    }
    return this.instances.psyche;
  }

  getNotesStore() {
    if (!this.instances.notes) {
      this.instances.notes = this.config.notes.store === 'redis'
        ? new RedisNotesStore(this.redisClient)
        : new MemoryNotesStore();
    }
    return this.instances.notes;
  }

  async close() {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }
}

export default StoreFactory;
```

#### 为什么不持久化到 MySQL？

1. **Psyche 是工作记忆**：类似人脑短期记忆，会话结束即清空
2. **Notes 是临时材料**：用完即弃，不需要长期保留
3. **下次会话可重建**：通过 `recall` 从持久化的 messages 中恢复
4. **Redis 足够**：TTL 自动过期，无需手动清理
5. **简化架构**：避免引入不必要的持久化逻辑

#### 存储方案选择建议

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 本地开发 | 内存 | 零依赖，快速启动 |
| 单元测试 | 内存 | 测试隔离，自动清理 |
| 单实例生产 | Redis | 重启后数据不丢失 |
| 多实例生产 | Redis | 会话共享，负载均衡 |
| 容器化部署 | Redis | 容器重启数据保持 |

---

## 4. Notes（手抄）设计

### 4.1 Notes 格式

**Key-Value JSON**，适合查询：

```json
{
  "q1_budget": {
    "type": "budget_report",
    "content": "Q1 技术部预算执行情况...",
    "metadata": {
      "size": 2500,
      "access_count": 5,
      "relevance": 0.95,
      "saved_at": "2026-03-31T10:00:00Z"
    }
  },
  "server_quote": {
    "type": "vendor_quote", 
    "content": "Dell R750 报价：15万/台...",
    "metadata": {
      "size": 800,
      "access_count": 3,
      "relevance": 0.88
    }
  }
}
```

### 4.2 NotesManager 高级功能

NotesManager 封装了 Notes 的高级操作，包括排序、自动遗忘和统计。

#### 排序算法

**多维度加权评分**：

```javascript
class NotesManager {
  _calculateScore(note) {
    const metadata = note.metadata || {};
    const accessCount = metadata.access_count || 0;
    const relevance = metadata.relevance || 0.5;
    
    // 计算年龄（天数）
    const savedAt = metadata.saved_at ? new Date(metadata.saved_at) : new Date();
    const ageDays = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60 * 24);
    const freshness = ageDays > 0 ? 1 / ageDays : 1;

    // 分数 = 访问次数*2 + 相关性*1.5 + 新鲜度*1
    return accessCount * 2 + relevance * 1.5 + freshness * 1;
  }
  
  async listWithDetails(userId, expertId) {
    const keys = await this.list(userId, expertId);
    const notes = [];
    
    for (const key of keys) {
      const note = await this.read(userId, expertId, key);
      if (note) {
        notes.push({
          key,
          ...note,
          score: this._calculateScore(note)
        });
      }
    }
    
    // 按分数降序排列
    return notes.sort((a, b) => b.score - a.score);
  }
}
```

#### 自动遗忘机制

当笔记数量超过限制时，自动删除分数最低的 10%：

```javascript
class NotesManager {
  async _checkAndForget(userId, expertId) {
    const notes = await this.listWithDetails(userId, expertId);
    
    if (notes.length > this.config.maxCount) {
      const deleteCount = Math.ceil(notes.length * 0.1);
      const toDelete = notes.slice(-deleteCount); // 分数最低的
      
      const keysToDelete = toDelete.map(n => n.key);
      await this.deleteMany(userId, expertId, keysToDelete);
      
      logger.info(`[NotesManager] 自动遗忘 ${deleteCount} 个笔记`);
    }
  }
  
  // 保存笔记时触发遗忘检查
  async take(userId, expertId, key, note, ttl = 3600) {
    await this.notesStore.take(userId, expertId, key, note, ttl);
    await this._checkAndForget(userId, expertId); // 检查是否需要遗忘
  }
}
```

#### 统计信息

```javascript
async getStats(userId, expertId) {
  const notes = await this.listWithDetails(userId, expertId);
  const totalSize = notes.reduce((sum, n) => sum + (n.metadata?.size || 0), 0);

  return {
    count: notes.length,
    totalSize,
    byType: notes.reduce((acc, n) => {
      acc[n.type || 'general'] = (acc[n.type || 'general'] || 0) + 1;
      return acc;
    }, {})
  };
}
```

### 4.3 Notes 排序与遗忘触发时机

**遗忘触发**：
1. **Psyche 压缩时**：将大段内容转为 Notes 引用
2. **Notes 满时**：按排序删除最后 10%
3. **会话结束时**：删除临时性 Notes（`cleanupTempNotes`）

### 4.4 任务上下文处理（三种工作模式）

MinimalContextOrganizer 支持三种工作模式，每种模式有不同的上下文注入方式。

#### 模式识别

```javascript
_buildTaskContextSection(taskContext) {
  const fullPath = taskContext.fullWorkspacePath || '';
  
  const isTaskMode = taskContext.id && taskContext.title;
  const isSkillMode = fullPath.startsWith('skills/');
  const isChatMode = fullPath.startsWith('work/') && !isTaskMode;

  if (isSkillMode) return this._buildSkillContextSection(taskContext);
  if (isChatMode) return this._buildChatContextSection(taskContext);
  if (isTaskMode) return this._buildTaskWorkspaceSection(taskContext);
  return null;
}
```

#### 1. Task 模式（任务工作空间）

用户创建了明确的任务，有专门的工作目录。

```javascript
_buildTaskWorkspaceSection(taskContext) {
  const fullPath = taskContext.fullWorkspacePath || '';
  const userId = taskContext.userId || 'unknown';
  
  // 文件列表格式化
  let filesDescription = '暂无文件';
  if (taskContext.inputFiles?.length > 0) {
    filesDescription = taskContext.inputFiles.map(file => {
      const sizeKB = file.isDirectory ? '-' : `${(file.size / 1024).toFixed(1)} KB`;
      return file.isDirectory
        ? `📁 ${file.name}/`
        : `📄 ${file.name} (${sizeKB})`;
    }).join('\n');
  }

  return `## 当前任务工作空间

你正在**任务工作空间模式**中。

### 任务信息
- **任务ID**: ${taskContext.id}
- **任务标题**: ${taskContext.title}
${taskContext.description ? `- **任务描述**: ${taskContext.description}` : ''}

### 目录说明
- **工作目录**: ${fullPath}
- **可访问目录**: \`data/work/${userId}/\` 及其所有子目录
- **路径格式**: 相对于 data/ 目录，例如 \`${fullPath}/input/file.xlsx\`

### 当前目录下的文件
${filesDescription}`;
}
```

#### 2. Skill 模式（技能开发）

用户在技能目录下工作，通常是查看或修改技能代码。

```javascript
_buildSkillContextSection(taskContext) {
  const fullPath = taskContext.fullWorkspacePath || 'skills/unknown';
  const skillName = fullPath.replace(/^skills\//, '');

  return `## 当前技能工作目录

你正在**技能模式**中，当前工作目录是技能的源码目录。

### 技能信息
- **技能名称**: ${skillName}
- **工作目录**: ${fullPath}

### 目录说明
- \`SKILL.md\` 文件肯定存在，包含技能的详细说明
- 使用 \`cat SKILL.md\` 或 \`read_file\` 查看技能说明
- ⚠️ **技能目录是只读的**，不应该写入文件`;
}
```

#### 3. Chat 模式（普通对话）

普通对话模式，使用临时文件夹。

```javascript
_buildChatContextSection(taskContext) {
  const fullPath = taskContext.fullWorkspacePath || 'work/unknown/temp';

  return `## 当前工作目录

你正在**对话模式**中，当前工作目录是用户的临时文件夹。

### 路径使用规则
- 路径是相对于系统 data/ 目录的，不需要再加 data/ 前缀
- 可以读取临时文件夹中的现有文件
- ⚠️ **禁止创建文件**：对话模式不支持文件创建操作

### 文件操作限制
如果用户需要创建或写入文件，请提醒用户：
1. 创建一个任务（Task），系统会自动分配专门的工作目录
2. 在任务目录中，可以根据需要组织合适的目录结构`;
}
```

#### System Prompt 构建

```javascript
_buildSystemPrompt(basePrompt, psycheText, taskContext = null) {
  const parts = [];
  
  if (basePrompt) parts.push(basePrompt);
  if (psycheText) parts.push('\n\n' + psycheText);
  
  // 添加任务上下文（如果有）
  if (taskContext) {
    const taskContextSection = this._buildTaskContextSection(taskContext);
    if (taskContextSection) parts.push('\n\n' + taskContextSection);
  }

  // 添加使用说明
  parts.push(`

【使用说明】
- 以上【心神】是你的工作记忆，包含当前主题、关键决策和可用笔记
- 如需查看笔记内容，使用 notes.read 工具
- 如需保存新材料，使用 notes.take 工具
- 如需查看所有笔记，使用 notes.list 工具`);

  return parts.join('\n');
}
```

### 4.5 Notes 工具接口

```typescript
// notes.take - 存入笔记
{
  "name": "notes.take",
  "description": "将材料存入 Notes，供后续对话使用",
  "parameters": {
    "key": "string",           // 笔记标识
    "content": "string",       // 笔记内容
    "type": "string",          // 笔记类型
    "relevance": "number"      // 相关性评分（0-1）
  }
}

// notes.read - 读取笔记
{
  "name": "notes.read", 
  "description": "从 Notes 加载笔记内容",
  "parameters": {
    "key": "string"            // 笔记标识
  }
}

// notes.list - 列出笔记（可选）
{
  "name": "notes.list",
  "description": "列出当前 Notes 中的笔记清单",
  "parameters": {}
}
```

**不需要的工具**：
- `notes.delete`：由系统自动遗忘
- `notes.update`：直接 `take` 覆盖同名 key

---

## 5. 工具调用流程示例

### 5.1 完整对话流程

```
用户：帮我制定 Q2 预算方案

【反思阶段】
  输入：空 Psyche + 当前消息
  输出：Psyche 文本注入 System Prompt
  
System Prompt：
  你是 Maria...
  
  【心神】
  当前主题：Q2 预算方案制定（需求待澄清）
  工作阶段：需求收集
  待确认问题：["预算范围？", "覆盖部门？", "用途？"]
  
  【当前任务】
  帮我制定 Q2 预算方案

LLM 生成：需要了解一些信息：1.预算范围？2.覆盖部门？...

---

用户：50万，技术部，服务器和云服务

【反思阶段】
  输入：当前 Psyche + 过去 2 轮对话
  输出：更新后的 Psyche
  
System Prompt：
  【心神】
  当前主题：Q2 技术部预算方案
  工作阶段：执行阶段
  已确认需求：["预算 50 万", "技术部", "服务器+云服务"]
  
  【当前任务】
  50万，技术部，服务器和云服务

LLM 调用 recall({query: "技术部 Q1 预算"})
  ↓
返回 20 条相关 messages
  ↓
LLM 分析后，筛选出 3 条关键数据
  ↓
LLM 调用 notes.take({
  key: "q1_key_metrics",
  content: "Q1 实际支出 42 万，服务器占 60%...",
  relevance: 0.95
})
  ↓
LLM 生成预算框架

---

用户：服务器具体要什么配置？

【反思阶段】
  Psyche 更新：
    notes_refs: [{id: "q1_key_metrics", summary: "Q1 实际支出 42 万"}]
    
System Prompt：
  【心神】
  ...
  可用笔记（通过 notes.read 获取）：
  - notes:q1_key_metrics → Q1 实际支出 42 万
  
  【当前任务】
  服务器具体要什么配置？

LLM 看到引用 → 调用 notes.read("q1_key_metrics")
  ↓
获取 Q1 数据作为参考
  ↓
LLM 生成回复
```

---

## 6. 与现有策略的对比

### 6.1 现有策略使用 Notes

**可以使用，但效果有限**：

```
FullContextOrganizer：
  System Prompt + 最近 15 条 Messages + Topics
  
  使用 Notes：
  - LLM 可以 notes.take 存材料
  - 但 Psyche 不会自动注入 Notes 引用
  - LLM 需要主动记住"我存了啥"
  - 效果 ≈ 30%
```

### 6.2 新策略使用 Notes

**效果最大化**：

```
MinimalContextOrganizer：
  System Prompt + Psyche（含 Notes 引用）+ 当前消息
  
  使用 Notes：
  - Psyche 自动包含 Notes 引用列表
  - LLM 看到引用 → 自动 notes.read
  - 形成"Psyche 指引 → Notes 补充"闭环
  - 效果 ≈ 90%
```

---

## 7. 实现建议

### 7.1 新增 MinimalContextOrganizer

实现参考第 3.3 节代码示例，核心逻辑：

```javascript
// lib/context-organizer/minimal-organizer.js
export class MinimalContextOrganizer extends IContextOrganizer {
  getName() { return 'minimal'; }
  
  async organize(memorySystem, userId, options) {
    // 1. 获取 Psyche + 最近对话
    // 2. 反思更新 Psyche
    // 3. 压缩（如需要）
    // 4. 构建 System Prompt（注入 Psyche 文本）
    // 5. 返回精简上下文
  }
}
```

**关键依赖**：
- `psycheStore`: IPsycheStore 实例（构造函数注入）
- `notesStore`: INotesStore 实例（用于压缩时转移内容）
- `reflectionService`: 调用 LLM 生成新 Psyche（含滑动窗口机制）
- `psycheManager.compress()`: 大小限制检查与压缩（第 3.6 节）
- `_buildMessagesArray()`: 构建 messages 数组（处理 tool_calls 映射，第 3.5 节）
- `_buildSystemPrompt()`: 构建 System Prompt（含任务上下文，第 4.4 节）

### 7.2 注册 Notes Skill

```javascript
// 全局注册，所有策略可用
skillManager.register({
  name: 'notes',
  tools: ['notes.take', 'notes.read', 'notes.list']
});
```

### 7.3 配置选项

```javascript
{
  "context_strategy": "minimal",  // 或 "full", "simple"
  "psyche_config": {
    "max_tokens_ratio": 0.3,
    "reflection_lookback": 4,     // 反思时查看过去 4 轮
    "enable_notes": true
  }
}
```

---

## 8. 优势与局限

### 8.1 优势

1. **上下文精简**：Psyche 替代原始 Messages，信息密度高
2. **工作记忆**：跨对话保持上下文连续性
3. **材料管理**：Notes 实现"手抄"功能，避免重复查询
4. **策略兼容**：Notes 作为 Skill，所有策略可用

### 8.2 局限

1. **反思开销**：每轮需要额外 LLM 调用生成 Psyche
2. **LLM 依赖**：需要较强模型才能有效利用 Psyche
3. **调试复杂**：Psyche 文本需要可视化工具查看

---

## 9. 附录

### 9.1 相关文档

- [context-organization-architecture.md](../design/context-organization-architecture.md)
- [skill-development-guide.md](../development/skill-development-guide.md)

### 9.2 相关代码

- `lib/context-organizer/interface.js` - 上下文组织器接口
- `lib/context-organizer/minimal-organizer.js` - 精简上下文组织器实现
- `lib/context-organizer/base-organizer.js` - 基础上下文组织器
- `lib/psyche/psyche-manager.js` - Psyche 管理器
- `lib/psyche/psyche-model.js` - Psyche 数据模型
- `lib/psyche/reflection-service.js` - 反思服务（含滑动窗口）
- `lib/psyche-store/memory-store.js` - 内存存储实现
- `lib/psyche-store/redis-store.js` - Redis 存储实现
- `lib/notes/notes-manager.js` - Notes 管理器
- `lib/notes/index.js` - Notes 模块入口

### 9.3 反思 Prompt 示例

反思服务使用的完整 Prompt 模板：

```
你是一位专业的对话分析师。请分析以下对话，更新"心神"(Psyche)状态。

## 当前心神状态
```json
{currentPsyche}
```

## 相关话题（可用于 recall）
{topicsText}

## 工具调用摘要
{toolCallSummary}

## 最近对话（{dialogCount} 轮，{messageCount} 条消息）
{messagesText}

## 任务
请分析对话内容，生成心神更新。你需要：

1. **识别用户意图**：用户想要做什么？
2. **判断工作方向**：是需要继续向用户提问澄清，还是继续执行任务？
3. **给出背景和过程**：之前做了什么尝试？有什么参考？
4. **决定下一步行动**：应该做什么？

## 输出格式（必须是有效的 JSON）
```json
{
  "session_meta": {
    "current_topic": "当前讨论的主题（简洁明确）",
    "user_intent": "用户意图（一句话描述）",
    "conversation_round": 对话轮次数字
  },
  "methodology": {
    "approach": "采用的方法论（如：收集需求 → 分析问题 → 提出方案）",
    "current_phase": "当前阶段 (init/clarification/execution/review/complete)",
    "next_action": "下一步行动（具体明确）"
  },
  "key_exchange": {
    "round": 当前轮次,
    "summary": "本轮对话的关键内容摘要（包含工具调用结果）"
  },
  "key_decisions": ["已确定的关键决策1", "已确定的关键决策2"],
  "pending_questions": ["待确认问题1", "待确认问题2"],
  "tool_summary": [
    {"tool": "工具名", "action": "做了什么", "result": "结果摘要"}
  ],
  "topics_context": [
    {"topic_id": "话题ID", "title": "话题标题", "relevance": 0.95}
  ],
  "working_memory": {
    "calculated_values": {"key": "value"},
    "temp_notes": "临时笔记内容"
  }
}
```

## 注意事项
1. 只输出 JSON，不要其他内容
2. 如果话题切换了，要反映在 current_topic 中
3. 工具调用摘要要简洁，只保留关键信息
4. pending_questions 只保留真正需要用户确认的问题
5. 确保 JSON 格式正确
```

---

*文档版本：v3.0*
*更新时间：2026-04-06*
*关联 Issue：#437*
