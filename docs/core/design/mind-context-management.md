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
    // 1. 获取过去 4 轮对话
    const recentMessages = await memorySystem.getRecentMessages(userId, 4);
    
    // 2. 从 Store 获取当前 Psyche（JSON）
    const currentPsyche = await this.psycheStore.get(userId, options.expertId)
      || this.createEmptyPsyche();
    
    // 3. 调用反思 LLM 更新 Psyche
    const reflection = await this.reflect(currentPsyche, recentMessages);
    
    // 4. 执行压缩、遗忘、总结、构造
    const updatedPsyche = this.processPsyche(reflection);
    
    // 5. 保存回 Store
    await this.psycheStore.set(userId, options.expertId, updatedPsyche, 3600);
    
    // 6. 转换为文本注入 System Prompt
    const psycheText = this.formatPsycheForPrompt(updatedPsyche);
    const systemPrompt = this.buildSystemPrompt(psycheText);
    
    // 7. 返回精简上下文（Psyche 替代 Messages）
    return new ContextResult({
      systemPrompt,
      messages: [{ role: 'user', content: options.currentMessage }],
      hiddenContext: { psyche: updatedPsyche }
    });
  }
  
  processPsyche(reflection) {
    // 压缩：Psyche 太大时，将大段内容转为 Notes 引用
    // 遗忘：删除过时信息
    // 总结：调整工作方向
    // 构造：生成新的 Psyche 结构
  }
}
```

### 3.4 Psyche 大小限制与压缩策略

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

### 3.5 Psyche 和 Notes 的存储

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

### 4.2 Notes 排序与遗忘

**排序策略**（多维度加权）：

```javascript
const notesScore = (item) => {
  return (
    item.access_count * 2 +        // 访问次数（最重要）
    item.relevance * 1.5 +         // LLM 标记的相关性
    (1 / item.age_days) * 1        // 越新越好
  );
};
```

**遗忘触发**：
1. Psyche 压缩时：将大段内容转为 Notes 引用
2. Notes 满时：按排序删除最后 10%
3. 会话结束时：删除临时性 Notes

### 4.3 Notes 工具接口

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
- `reflect()`: 调用 LLM 生成新 Psyche
- `compressPsyche()`: 大小限制检查与压缩（第 3.4 节）

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
- `lib/context-organizer/minimal-organizer.js` - 新策略实现（待添加）
- `data/skills/notes/` - Notes 技能实现（待添加）

---

*文档版本：v2.0*
*更新时间：2026-03-31*
*关联 Issue：#437*
