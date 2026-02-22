# 原始 index.js 设计参考

> **状态**: 已弃用
> **最后版本**: e37d5561cf70c393a8f93e7df8d5ed14ca8e90e1
> **弃用原因**: 从 Express 迁移到 Koa，重构为前后端分离架构

## 原始代码

```javascript
/**
 * Chat Expert Instance - 专家副本主入口
 * 单专家副本模式，通过 EXPERT_ID 环境变量指定专家
 *
 * 流程：
 * 1. 读取 config/database.json 连接数据库
 * 2. 从环境变量获取 EXPERT_ID
 * 3. 加载专家配置（Soul、模型、技能）
 * 4. 初始化 LLM Client（支持双模型）
 * 5. 等待消息并处理
 */

const fs = require('fs');
const path = require('path');
const Database = require('./lib/db');
const DatabaseInitializer = require('./lib/db-init');
const ConfigLoader = require('./lib/config-loader');
const LLMClient = require('./lib/llm-client');
const MemorySystem = require('./lib/memory-system');
const ContextManager = require('./lib/context-manager');
const ReflectiveMind = require('./lib/reflective-mind');
const ToolManager = require('./lib/tool-manager');
const logger = require('./lib/logger');

class ExpertInstance {
  constructor() {
    this.expertId = null;
    this.db = null;
    this.configLoader = null;
    this.llmClient = null;
    this.memorySystem = null;
    this.contextManager = null;
    this.reflectiveMind = null;
    this.toolManager = null;
    this.expertConfig = null;

    this.running = false;
  }

  /**
   * 初始化专家副本
   */
  async initialize() {
    logger.info('========================================');
    logger.info('  Chat Expert Instance - 专家副本系统');
    logger.info('========================================');

    // 1. 获取 EXPERT_ID
    this.expertId = process.env.EXPERT_ID;
    if (!this.expertId) {
      throw new Error('EXPERT_ID 环境变量未设置。请使用: EXPERT_ID=eric npm start');
    }
    logger.info(`专家ID: ${this.expertId}`);

    // 2. 读取数据库配置
    const dbConfig = this.loadDatabaseConfig();

    // 3. 连接数据库
    this.db = new Database(dbConfig);
    await this.db.connect();

    // 3.5 自动初始化数据库（如果表不存在）
    const dbInitializer = new DatabaseInitializer(this.db);
    const initialized = await dbInitializer.initialize();
    if (initialized) {
      logger.info('Database was auto-initialized with default data');
    }

    // 4. 加载专家配置
    this.configLoader = new ConfigLoader(this.db);
    this.expertConfig = await this.configLoader.loadExpertConfig(this.expertId);

    logger.info(`专家名称: ${this.expertConfig.expert.name}`);
    logger.info(`表达模型: ${this.expertConfig.expressiveModel?.id || '未配置'}`);
    logger.info(`反思模型: ${this.expertConfig.reflectiveModel?.id || '未配置'}`);
    logger.info(`技能数量: ${this.expertConfig.skills?.length || 0}`);

    // 5. 初始化 LLM Client
    this.llmClient = new LLMClient(this.db, this.expertId);
    await this.llmClient.loadConfig();

    // 6. 初始化记忆系统
    this.memorySystem = new MemorySystem(this.db, this.expertId, this.llmClient);

    // 7. 初始化上下文管理器
    this.contextManager = new ContextManager(this.expertConfig);

    // 8. 初始化反思心智
    const soul = this.extractSoul(this.expertConfig.expert);
    this.reflectiveMind = new ReflectiveMind(soul, this.llmClient);

    // 9. 初始化工具管理器
    this.toolManager = new ToolManager(this.db, this.expertId);
    await this.toolManager.initialize();

    logger.info('初始化完成，等待消息...');
    this.running = true;
  }

  /**
   * 读取数据库配置
   */
  loadDatabaseConfig() {
    const configPath = path.join(__dirname, 'config', 'database.json');

    if (!fs.existsSync(configPath)) {
      throw new Error(`数据库配置文件不存在: ${configPath}\n请先创建 config/database.json`);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    // 支持环境变量替换
    return this.resolveEnvVars(config);
  }

  /**
   * 解析环境变量
   */
  resolveEnvVars(obj) {
    if (typeof obj === 'string') {
      return obj.replace(/\$\{(\w+)\}/g, (match, varName) => {
        return process.env[varName] || match;
      });
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveEnvVars(item));
    }

    if (typeof obj === 'object' && obj !== null) {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.resolveEnvVars(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * 从专家配置中提取 Soul
   */
  extractSoul(expert) {
    return {
      coreValues: this.parseJson(expert.core_values),
      taboos: this.parseJson(expert.taboos),
      emotionalTone: expert.emotional_tone || '温和、真诚',
      behavioralGuidelines: this.parseJson(expert.behavioral_guidelines),
    };
  }

  /**
   * 解析 JSON 字段
   */
  parseJson(field) {
    if (!field) return [];
    if (typeof field === 'object') return field;
    try {
      return JSON.parse(field);
    } catch {
      return [];
    }
  }

  /**
   * 处理消息（核心流程）
   * @param {string} contactId - 联系人ID
   * @param {string} content - 消息内容
   * @returns {Promise<object>} 处理结果
   */
  async handleMessage(contactId, content) {
    logger.info(`[ExpertInstance] 收到消息: contact=${contactId}, content=${content.substring(0, 50)}...`);

    try {
      // 1. 确保联系人存在
      await this.memorySystem.getOrCreateContact(contactId);

      // 2. 记录用户消息
      await this.memorySystem.addMessage(contactId, 'user', content);

      // 3. 检查是否需要归档历史
      const shouldArchive = await this.memorySystem.shouldProcessHistory(contactId);
      if (shouldArchive) {
        // 异步归档，不阻塞回复
        this.memorySystem.processHistory(contactId).catch(err => {
          logger.error('[ExpertInstance] 归档历史失败:', err.message);
        });
      }

      // 4. 构建上下文
      const context = await this.contextManager.buildContext(
        this.memorySystem,
        contactId,
        { currentMessage: content }
      );

      logger.debug('[ExpertInstance] 上下文构建完成:', {
        messageCount: context.metadata.messageCount,
        innerVoiceCount: context.metadata.innerVoiceCount,
      });

      // 5. 获取工具定义
      const tools = this.toolManager.getToolDefinitions();

      // 6. 调用表达心智生成回复
      let response;
      let toolCalls = null;

      if (tools.length > 0) {
        // 支持工具调用
        const llmResponse = await this.llmClient.callExpressive(
          context.messages,
          { tools }
        );

        // 检查是否有工具调用
        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          toolCalls = await this.handleToolCalls(llmResponse.toolCalls, contactId);

          // 将工具结果发回 LLM 生成最终回复
          const followUpMessages = [
            ...context.messages,
            { role: 'assistant', content: llmResponse.content, tool_calls: llmResponse.toolCalls },
            ...this.toolManager.formatToolResultsForLLM(toolCalls),
          ];

          const finalResponse = await this.llmClient.callExpressive(followUpMessages);
          response = finalResponse.content;
        } else {
          response = llmResponse.content;
        }
      } else {
        // 不支持工具调用
        const llmResponse = await this.llmClient.callExpressive(context.messages);
        response = llmResponse.content;
      }

      logger.info(`[ExpertInstance] 生成回复: ${response.substring(0, 100)}...`);

      // 7. 发送回复（记录到数据库）
      const messageOptions = {};
      if (toolCalls) {
        messageOptions.toolCalls = toolCalls;
      }

      await this.memorySystem.addMessage(contactId, 'assistant', response, messageOptions);

      // 8. 异步反思（不阻塞）
      this.performReflection(contactId, content, response).catch(err => {
        logger.error('[ExpertInstance] 反思失败:', err.message);
      });

      return {
        success: true,
        response,
        contactId,
      };
    } catch (error) {
      logger.error('[ExpertInstance] 处理消息失败:', error.message);
      return {
        success: false,
        error: error.message,
        contactId,
      };
    }
  }

  /**
   * 处理工具调用
   */
  async handleToolCalls(toolCalls, contactId) {
    const context = {
      expertId: this.expertId,
      contactId,
      memorySystem: this.memorySystem,
    };

    return await this.toolManager.executeToolCalls(toolCalls, context);
  }

  /**
   * 执行反思（异步）
   */
  async performReflection(contactId, triggerMessage, myResponse) {
    // 获取最近消息作为上下文
    const recentMessages = await this.memorySystem.getRecentMessages(contactId, 10);

    const reflection = await this.reflectiveMind.reflect({
      triggerMessage: { content: triggerMessage },
      myResponse: { content: myResponse },
      context: recentMessages,
    });

    // 将 Inner Voice 存入最近的消息
    logger.debug('[ExpertInstance] 反思完成:', {
      score: reflection.selfEvaluation?.score,
      monologue: reflection.monologue?.substring(0, 50),
    });

    // Inner Voice 存储在内存中，供下一轮使用
    const innerVoice = {
      selfEvaluation: reflection.selfEvaluation,
      nextRoundAdvice: reflection.nextRoundAdvice,
      monologue: reflection.monologue,
    };

    // 更新消息（这里需要 DB 支持更新最后一条消息）
    await this.updateLastMessageInnerVoice(contactId, innerVoice);

    return reflection;
  }

  /**
   * 更新最后一条消息的 Inner Voice
   */
  async updateLastMessageInnerVoice(contactId, innerVoice) {
    // 获取最近的消息（assistant 角色）
    const messages = await this.db.getRecentMessages(this.expertId, contactId, 1);
    if (messages.length > 0 && messages[0].role === 'assistant') {
      // 更新 inner_voice
      await this.db.execute(
        'UPDATE messages SET inner_voice = ? WHERE id = ?',
        [JSON.stringify(innerVoice), messages[0].id]
      );
    }
  }

  /**
   * 启动 HTTP API 服务器
   */
  async startServer(port = 3000) {
    const express = require('express');
    const app = express();

    app.use(express.json());

    // 健康检查
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        expertId: this.expertId,
        expertName: this.expertConfig?.expert?.name,
      });
    });

    // 发送消息
    app.post('/chat', async (req, res) => {
      const { contactId, content } = req.body;

      if (!contactId || !content) {
        return res.status(400).json({ error: 'contactId and content are required' });
      }

      const result = await this.handleMessage(contactId, content);
      res.json(result);
    });

    // 获取对话历史
    app.get('/chat/:contactId/history', async (req, res) => {
      const { contactId } = req.params;
      const limit = parseInt(req.query.limit) || 20;

      const messages = await this.memorySystem.getRecentMessages(contactId, limit);
      res.json({ contactId, messages });
    });

    // 获取专家信息
    app.get('/expert', (req, res) => {
      res.json({
        id: this.expertConfig.expert.id,
        name: this.expertConfig.expert.name,
        introduction: this.expertConfig.expert.introduction,
        speakingStyle: this.expertConfig.expert.speaking_style,
      });
    });

    // 重新加载技能
    app.post('/admin/reload-skills', async (req, res) => {
      await this.toolManager.reload();
      res.json({ success: true, skills: this.toolManager.getSkillList() });
    });

    app.listen(port, () => {
      logger.info(`API 服务器启动: http://localhost:${port}`);
    });
  }

  /**
   * 启动命令行交互模式（用于测试）
   */
  async startCLI() {
    const readline = require('readline');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const contactId = 'cli_user';

    console.log('\n命令行交互模式启动');
    console.log('输入消息与专家对话，输入 /exit 退出\n');

    const askQuestion = () => {
      rl.question('You: ', async (content) => {
        if (content === '/exit') {
          rl.close();
          await this.shutdown();
          return;
        }

        const result = await this.handleMessage(contactId, content);

        if (result.success) {
          console.log(`\n${this.expertConfig.expert.name}: ${result.response}\n`);
        } else {
          console.log(`\nError: ${result.error}\n`);
        }

        askQuestion();
      });
    };

    askQuestion();
  }

  /**
   * 优雅关闭
   */
  async shutdown() {
    logger.info('正在关闭...');
    this.running = false;

    if (this.db) {
      await this.db.close();
    }

    logger.info('已关闭');
    process.exit(0);
  }
}

// 主函数
async function main() {
  // 加载 .env 文件
  require('dotenv').config();

  const instance = new ExpertInstance();

  // 设置退出处理
  process.on('SIGINT', () => instance.shutdown());
  process.on('SIGTERM', () => instance.shutdown());

  try {
    await instance.initialize();

    // 根据环境变量决定启动模式
    const mode = process.env.RUN_MODE || 'cli';

    if (mode === 'server') {
      const port = parseInt(process.env.PORT) || 3000;
      await instance.startServer(port);
    } else {
      await instance.startCLI();
    }
  } catch (error) {
    logger.error('启动失败:', error.message);
    process.exit(1);
  }
}

// 运行
main();
```

## 关键设计要点

### 1. Topic 创建逻辑

在原始设计中，**Topic 不是用户手动创建的**，而是由 `MemorySystem.processHistory()` 自动生成：

```javascript
// 3. 检查是否需要归档历史
const shouldArchive = await this.memorySystem.shouldProcessHistory(contactId);
if (shouldArchive) {
  // 异步归档，不阻塞回复
  this.memorySystem.processHistory(contactId).catch(err => {
    logger.error('[ExpertInstance] 归档历史失败:', err.message);
  });
}
```

触发条件（见 `lib/memory-system.js`）：
- 消息数量 >= 20 条
- 或 token 数达到上下文大小的 70%

### 2. 消息处理流程

1. 确保联系人存在
2. 记录用户消息
3. 检查是否需要归档历史（创建 Topic）
4. 构建上下文
5. 获取工具定义
6. 调用 LLM 生成回复
7. 记录助手回复
8. 异步反思（Inner Voice）

### 3. 与当前架构的差异

| 方面 | 原始设计 | 当前实现 |
|------|----------|----------|
| Topic 创建 | 后端自动（消息积累后） | 前端手动（发送第一条消息时） |
| API 风格 | Express | Koa |
| 前后端 | 单体 | 分离 |
| 认证 | 无 | JWT |
