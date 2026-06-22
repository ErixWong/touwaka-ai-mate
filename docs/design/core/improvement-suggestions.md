# Touwaka Mate V2 改进建议报告

基于对 NanoClaw、OpenClaw、PicoClaw、ZeroClaw 四个开源项目的深度分析，结合当前项目架构，提出以下可落地的改进建议。

---

## 当前项目架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Expert Instance (Node.js)                     │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │  Expressive │◄──►│  Reflective │    │   Memory    │          │
│  │    Mind     │    │    Mind     │    │   System    │          │
│  │(DeepSeek)   │    │(GLM-4-Flash)│    │  (MariaDB)  │          │
│  └──────┬──────┘    └─────────────┘    └──────┬──────┘          │
│         │                                      │                  │
│  ┌──────▼──────┐    ┌──────────────────┐      │                  │
│  │ ToolManager │◄──►│  ContextManager  │◄─────┘                  │
│  │  (Skills)   │    │(Soul+InnerVoice) │                           │
│  └─────────────┘    └──────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

**核心特点：**
- 二分心智架构（表达+反思双模型）
- 基于Topic的消息归档
- Soul/InnerVoice驱动的上下文管理
- 数据库+文件系统双模式技能存储

---

## 一、记忆系统改进建议

### 1.1 引入向量检索（借鉴 ZeroClaw）

**现状问题：**
- 当前Topic匹配基于LLM判断，成本高且慢
- 没有语义相似度搜索能力

**改进方案：**
```javascript
// lib/vector-memory.js - 新增向量记忆层
class VectorMemory {
  constructor(db, embeddingProvider) {
    this.db = db;
    this.embedder = embeddingProvider; // 支持本地或API embedding
  }

  async store(key, content, category = 'conversation') {
    // 1. 生成embedding（使用轻量级模型如 BGE-small）
    const embedding = await this.embedder.embed(content);
    
    // 2. 存入数据库（新增 embeddings 表）
    await this.db.execute(
      `INSERT INTO memory_vectors (key, content, category, embedding) 
       VALUES (?, ?, ?, ?)`,
      [key, content, category, JSON.stringify(embedding)]
    );
  }

  async recall(query, limit = 5) {
    // 1. 生成查询embedding
    const queryEmbedding = await this.embedder.embed(query);
    
    // 2. 向量相似度搜索（余弦相似度）
    const results = await this.db.query(
      `SELECT key, content, category,
              cosine_similarity(embedding, ?) as score
       FROM memory_vectors
       ORDER BY score DESC
       LIMIT ?`,
      [JSON.stringify(queryEmbedding), limit]
    );
    
    return results;
  }
}
```

**数据库表设计：**
```sql
CREATE TABLE memory_vectors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expert_id VARCHAR(64) NOT NULL,
  contact_id VARCHAR(64),
  key_name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category ENUM('core', 'daily', 'conversation', 'topic') DEFAULT 'conversation',
  embedding JSON NOT NULL, -- 存储向量数组
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_expert_category (expert_id, category),
  FULLTEXT INDEX ft_content (content) -- 混合搜索备用
);
```

**优先级：** ⭐⭐⭐⭐⭐
**工作量：** 中等（2-3天）
**收益：** Topic匹配准确率提升50%+，响应延迟降低

---

### 1.2 混合搜索策略（FTS5 + 向量）

**借鉴 ZeroClaw 的混合检索：**
```javascript
// lib/hybrid-search.js
class HybridSearch {
  async search(query, options = {}) {
    const { vectorWeight = 0.7, keywordWeight = 0.3, limit = 10 } = options;
    
    // 并行执行两种搜索
    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorSearch(query, limit * 2),
      this.keywordSearch(query, limit * 2)
    ]);
    
    // 加权融合
    return this.mergeResults(vectorResults, keywordResults, vectorWeight, keywordWeight, limit);
  }
  
  mergeResults(vectorResults, keywordResults, vWeight, kWeight, limit) {
    const scores = new Map();
    
    // 归一化向量分数（余弦相似度通常在0-1之间）
    vectorResults.forEach((r, i) => {
      scores.set(r.id, { ...r, score: (r.similarity || 0) * vWeight });
    });
    
    // 归一化关键词分数（BM25风格）
    keywordResults.forEach((r, i) => {
      const existing = scores.get(r.id);
      const keywordScore = (1 / (i + 1)) * kWeight; // 排名倒数加权
      if (existing) {
        existing.score += keywordScore;
      } else {
        scores.set(r.id, { ...r, score: keywordScore });
      }
    });
    
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
```

**优先级：** ⭐⭐⭐⭐
**工作量：** 中等（1-2天）

---

### 1.3 Embedding缓存机制

**借鉴 ZeroClaw 的LRU缓存：**
```javascript
// lib/embedding-cache.js
class EmbeddingCache {
  constructor(maxSize = 10000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = []; // LRU追踪
  }

  async getOrCompute(content, computeFn) {
    const hash = this.hashContent(content);
    
    if (this.cache.has(hash)) {
      this.updateLRU(hash);
      return this.cache.get(hash);
    }
    
    const embedding = await computeFn(content);
    this.set(hash, embedding);
    return embedding;
  }
  
  hashContent(content) {
    // 使用 SHA-256 前8字节作为哈希
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}
```

**优先级：** ⭐⭐⭐
**工作量：** 小（半天）

---

## 二、Skill系统改进建议

### 2.1 TOML声明式技能定义（借鉴 ZeroClaw）

**现状问题：**
- 当前技能需要写JavaScript代码，门槛高
- 简单工具（如HTTP调用、Shell命令）也需要完整技能文件

**改进方案：**
```toml
# skills/weather/SKILL.toml
[skill]
name = "weather"
description = "获取天气预报"
version = "1.0.0"
author = "touwaka"
tags = ["utility", "weather"]

[[tools]]
name = "get_weather"
description = "获取指定城市的天气预报"
kind = "http"  # shell, http, script
command = "https://api.weather.com/v1/current"
method = "GET"
headers = { "Authorization" = "Bearer {{env.WEATHER_API_KEY}}" }

[tools.params]
city = { type = "string", required = true, description = "城市名称" }
units = { type = "string", enum = ["celsius", "fahrenheit"], default = "celsius" }

[[tools]]
name = "save_location"
description = "保存用户常用位置"
kind = "memory"  # 特殊类型：直接写入记忆系统
key_pattern = "user.locations.{{contactId}}"
```

**加载器实现：**
```javascript
// lib/toml-skill-loader.js
class TomlSkillLoader {
  async loadFromToml(tomlPath) {
    const content = fs.readFileSync(tomlPath, 'utf-8');
    const manifest = toml.parse(content);
    
    // 动态生成技能模块
    return {
      id: manifest.skill.name,
      ...manifest.skill,
      getTools: () => manifest.tools.map(t => this.convertToOpenAIFormat(t)),
      execute: (toolName, params, context) => this.executeTool(manifest, toolName, params, context)
    };
  }
  
  executeTool(manifest, toolName, params, context) {
    const tool = manifest.tools.find(t => t.name === toolName);
    
    switch (tool.kind) {
      case 'http':
        return this.executeHttpTool(tool, params);
      case 'shell':
        return this.executeShellTool(tool, params, context);
      case 'memory':
        return this.executeMemoryTool(tool, params, context);
      default:
        throw new Error(`Unknown tool kind: ${tool.kind}`);
    }
  }
}
```

**优先级：** ⭐⭐⭐⭐⭐
**工作量：** 中等（2-3天）
**收益：** 技能开发门槛大幅降低，非开发者也能创建简单技能

---

### 2.2 技能市场生态（借鉴 ZeroClaw open-skills）

**设计方案：**
```javascript
// lib/skill-marketplace.js
class SkillMarketplace {
  constructor(repoUrl = 'https://github.com/besoeasy/open-skills') {
    this.repoUrl = repoUrl;
    this.localPath = path.join(os.homedir(), '.touwaka', 'skills-marketplace');
  }

  async sync() {
    if (!fs.existsSync(this.localPath)) {
      // 首次克隆
      await exec(`git clone --depth 1 ${this.repoUrl} ${this.localPath}`);
    } else if (this.shouldSync()) {
      // 每周更新
      await exec(`git -C ${this.localPath} pull --ff-only`);
    }
  }
  
  async search(keyword) {
    const skills = await this.scanSkills();
    return skills.filter(s => 
      s.name.includes(keyword) || 
      s.tags.some(t => t.includes(keyword))
    );
  }
  
  async install(skillName) {
    const sourcePath = path.join(this.localPath, skillName);
    const targetPath = path.join(this.localSkillsPath, skillName);
    
    // 支持 symlink 或 copy
    fs.symlinkSync(sourcePath, targetPath);
  }
}
```

**CLI支持：**
```bash
# 搜索技能
npm run skill:search weather

# 安装技能
npm run skill:install weather

# 列出已安装
npm run skill:list

# 更新所有技能
npm run skill:update
```

**优先级：** ⭐⭐⭐⭐
**工作量：** 中等（2天）

---

## 三、MCP对接改进建议

### 3.1 MCP工具桥接层（借鉴 OpenClaw）

**现状问题：**
- 当前工具仅限于内部技能系统
- 无法利用外部MCP服务（如Composio的900+工具）

**改进方案：**
```javascript
// lib/mcp-adapter.js
class MCPAdapter {
  constructor(mcpServerUrl) {
    this.serverUrl = mcpServerUrl;
    this.tools = [];
  }

  async connect() {
    // 连接到MCP服务器
    const response = await fetch(`${this.serverUrl}/tools`);
    const toolSpecs = await response.json();
    
    // 转换为OpenAI格式
    this.tools = toolSpecs.map(spec => this.convertToOpenAIFormat(spec));
  }
  
  async execute(toolName, params) {
    const response = await fetch(`${this.serverUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolName, params })
    });
    return response.json();
  }
  
  getToolDefinitions() {
    return this.tools;
  }
}

// 集成到 ToolManager
class ToolManager {
  async initialize() {
    // 1. 加载内部技能
    await this.loadInternalSkills();
    
    // 2. 连接MCP服务（如果配置了）
    if (process.env.MCP_SERVER_URL) {
      this.mcpAdapter = new MCPAdapter(process.env.MCP_SERVER_URL);
      await this.mcpAdapter.connect();
    }
  }
  
  getToolDefinitions() {
    const internalTools = Array.from(this.skills.values()).flatMap(...);
    const mcpTools = this.mcpAdapter?.getToolDefinitions() || [];
    return [...internalTools, ...mcpTools];
  }
}
```

**配置示例：**
```json
// config/mcp.json
{
  "adapters": [
    {
      "name": "composio",
      "type": "composio",
      "apiKey": "${COMPOSIO_API_KEY}"
    },
    {
      "name": "local-mcp",
      "type": "sse",
      "url": "http://localhost:3001"
    }
  ]
}
```

**优先级：** ⭐⭐⭐⭐⭐
**工作量：** 中等（2-3天）
**收益：** 瞬间获得数百个外部工具能力

---

## 四、消息系统改进建议

### 4.1 多通道支持架构（借鉴 OpenClaw）

**现状问题：**
- 当前仅支持HTTP API
- 无原生微信、Telegram等集成

**改进方案：**
```javascript
// channels/channel-interface.js
class ChannelInterface {
  async initialize(config) {}
  async start(handler) {}  // handler: (message) => Promise<reply>
  async stop() {}
  async send(recipient, content) {}
  async broadcast(content) {}
}

// channels/wechat-channel.js
class WeChatChannel extends ChannelInterface {
  async initialize(config) {
    this.bot = new Wechaty({ puppet: config.puppet });
    
    this.bot.on('message', async (msg) => {
      const result = await this.messageHandler({
        contactId: msg.talker().id,
        content: msg.text(),
        channel: 'wechat'
      });
      
      await msg.say(result.response);
    });
  }
}

// channels/telegram-channel.js
class TelegramChannel extends ChannelInterface {
  async initialize(config) {
    this.bot = new Telegraf(config.token);
    
    this.bot.on('text', async (ctx) => {
      const result = await this.messageHandler({
        contactId: ctx.from.id.toString(),
        content: ctx.message.text,
        channel: 'telegram'
      });
      
      await ctx.reply(result.response);
    });
  }
}
```

**通道管理器：**
```javascript
// lib/channel-manager.js
class ChannelManager {
  constructor(expertInstance) {
    this.expert = expertInstance;
    this.channels = new Map();
  }

  async registerChannel(name, channel) {
    channel.setMessageHandler(this.handleMessage.bind(this));
    await channel.initialize(this.getConfig(name));
    this.channels.set(name, channel);
  }
  
  async handleMessage({ contactId, content, channel }) {
    // 统一包装contactId，包含通道信息
    const wrappedContactId = `${channel}:${contactId}`;
    return this.expert.handleMessage(wrappedContactId, content);
  }
}
```

**优先级：** ⭐⭐⭐⭐⭐
**工作量：** 较大（5-7天，每个通道1-2天）
**收益：** 大幅扩展用户触达渠道

---

### 4.2 消息队列与流控（借鉴 NanoClaw）

**改进方案：**
```javascript
// lib/message-queue.js
class MessageQueue {
  constructor() {
    this.queues = new Map(); // contactId -> queue
    this.processing = new Set();
    this.maxConcurrent = 5;
  }

  async enqueue(contactId, message) {
    if (!this.queues.has(contactId)) {
      this.queues.set(contactId, []);
    }
    
    this.queues.get(contactId).push(message);
    this.processNext(contactId);
  }
  
  async processNext(contactId) {
    if (this.processing.has(contactId)) return;
    
    const queue = this.queues.get(contactId);
    if (!queue || queue.length === 0) return;
    
    this.processing.add(contactId);
    const message = queue.shift();
    
    try {
      await this.processMessage(contactId, message);
    } finally {
      this.processing.delete(contactId);
      // 继续处理下一条
      if (queue.length > 0) {
        setImmediate(() => this.processNext(contactId));
      }
    }
  }
}
```

**优先级：** ⭐⭐⭐
**工作量：** 小（1天）

---

## 五、用户界面改进建议

### 5.1 CLI体验优化（借鉴 ZeroClaw）

**改进方案：**
```javascript
// 使用 @clack/prompts 美化交互
const { select, text, confirm } = require('@clack/prompts');

// cli/commands/interactive.js
async function interactiveMode(expert) {
  console.log(pc.green('╔══════════════════════════════════╗'));
  console.log(pc.green('║     Touwaka Expert Chat v2       ║'));
  console.log(pc.green('╚══════════════════════════════════╝'));
  
  while (true) {
    const action = await select({
      message: '选择操作',
      options: [
        { value: 'chat', label: '💬 开始对话' },
        { value: 'skills', label: '🔧 管理技能' },
        { value: 'memory', label: '🧠 查看记忆' },
        { value: 'exit', label: '👋 退出' }
      ]
    });
    
    if (action === 'exit') break;
    // ...
  }
}
```

**优先级：** ⭐⭐⭐
**工作量：** 小（1天）

---

## 六、安全与隔离改进

### 6.1 技能沙箱（借鉴 NanoClaw）

**现状问题：**
- 当前技能使用vm模块执行，但仍可访问Node.js核心模块
- 无文件系统隔离

**改进方案：**
```javascript
// lib/skill-sandbox.js
class SkillSandbox {
  constructor(skillId, allowedPaths = []) {
    this.skillId = skillId;
    this.allowedPaths = allowedPaths;
    
    // 创建受限的require
    this.safeRequire = this.createSafeRequire();
  }
  
  createSafeRequire() {
    const whitelist = new Set(['url', 'querystring', 'crypto', 'util']);
    
    return (moduleName) => {
      if (whitelist.has(moduleName)) {
        return require(moduleName);
      }
      
      // 禁止文件系统访问
      if (['fs', 'path'].includes(moduleName)) {
        return this.createMockFs();
      }
      
      throw new Error(`Module '${moduleName}' is not allowed`);
    };
  }
  
  createMockFs() {
    return {
      readFileSync: (filePath) => {
        // 只允许访问技能目录下的文件
        if (!filePath.startsWith(this.skillBasePath)) {
          throw new Error('Access denied');
        }
        return fs.readFileSync(filePath);
      }
    };
  }
  
  execute(code) {
    const context = vm.createContext({
      require: this.safeRequire,
      console: this.createSafeConsole(),
      Buffer,
      // ...其他安全的全局变量
    });
    
    vm.runInContext(code, context, { timeout: 5000 });
    return context.module.exports;
  }
}
```

**优先级：** ⭐⭐⭐⭐
**工作量：** 中等（2天）

---

## 七、实施路线图

### 第一阶段：核心能力提升（2周）

| 任务 | 优先级 | 工作量 | 负责人 |
|------|--------|--------|--------|
| 向量记忆系统 | ⭐⭐⭐⭐⭐ | 3天 | - |
| TOML声明式技能 | ⭐⭐⭐⭐⭐ | 3天 | - |
| MCP适配器 | ⭐⭐⭐⭐⭐ | 2天 | - |
| WeChat通道集成 | ⭐⭐⭐⭐⭐ | 3天 | - |

### 第二阶段：生态完善（1周）

| 任务 | 优先级 | 工作量 |
|------|--------|--------|
| 技能市场同步 | ⭐⭐⭐⭐ | 2天 |
| 混合搜索优化 | ⭐⭐⭐⭐ | 1天 |
| CLI交互美化 | ⭐⭐⭐ | 1天 |

### 第三阶段：安全加固（1周）

| 任务 | 优先级 | 工作量 |
|------|--------|--------|
| 技能沙箱 | ⭐⭐⭐⭐ | 2天 |
| 更多通道（Telegram/Slack） | ⭐⭐⭐⭐ | 3天 |

---

## 八、参考代码片段

### 8.1 轻量级Embedding服务

```python
# embedding-service/main.py (FastAPI)
from fastapi import FastAPI
from sentence_transformers import SentenceTransformer

app = FastAPI()
model = SentenceTransformer('BAAI/bge-small-zh-v1.5')  # 中文优化，仅100MB

@app.post("/embed")
async def embed(texts: list[str]):
    embeddings = model.encode(texts, normalize_embeddings=True)
    return {"embeddings": embeddings.tolist()}
```

### 8.2 余弦相似度计算（SQL）

```sql
-- MySQL 8.0+ 支持向量函数
CREATE FUNCTION cosine_similarity(a JSON, b JSON) 
RETURNS FLOAT DETERMINISTIC
BEGIN
  DECLARE dot_product FLOAT DEFAULT 0;
  DECLARE norm_a FLOAT DEFAULT 0;
  DECLARE norm_b FLOAT DEFAULT 0;
  DECLARE i INT DEFAULT 0;
  DECLARE dim INT;
  
  SET dim = JSON_LENGTH(a);
  
  WHILE i < dim DO
    SET dot_product = dot_product + 
      JSON_EXTRACT(a, CONCAT('$[', i, ']')) * 
      JSON_EXTRACT(b, CONCAT('$[', i, ']'));
    SET norm_a = norm_a + POW(JSON_EXTRACT(a, CONCAT('$[', i, ']')), 2);
    SET norm_b = norm_b + POW(JSON_EXTRACT(b, CONCAT('$[', i, ']')), 2);
    SET i = i + 1;
  END WHILE;
  
  RETURN dot_product / (SQRT(norm_a) * SQRT(norm_b));
END;
```

---

## 九、总结

**最高优先级改进项：**

1. **向量记忆系统** - 解决当前Topic匹配的痛点
2. **TOML声明式技能** - 降低技能开发门槛
3. **MCP适配器** - 瞬间扩展工具能力
4. **WeChat通道** - 扩大用户触达

**预期收益：**
- 记忆检索准确率 +50%
- 技能开发效率 +200%
- 可用工具数量 +900
- 用户触达渠道 +3

---

*报告生成时间：2026-02-16*
*参考项目版本：NanoClaw (main)、OpenClaw (main)、PicoClaw (main)、ZeroClaw (main)*
