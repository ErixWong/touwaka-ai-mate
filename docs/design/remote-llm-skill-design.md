# 远程 LLM 调用技能设计方案

**Issue:** [#80](https://github.com/ErixWong/touwaka-ai-mate/issues/80)

## 关联 Issue

- **[#81 消息插入 API（回调）](https://github.com/ErixWong/touwaka-ai-mate/issues/81)** - 先实现这个

## 需求确认

- **目标 LLM**：从 `ai_models` 表获取，技能参数传入 `model_id`
- **技能配置**：只需一个技能 `remote-llm`
- **核心功能**：完全异步调用其他 LLM，避免阻塞专家对话
- **同步调用**：❌ 不支持，会阻塞专家对话
- **数据存储**：❌ 不使用数据库，使用内存存储（服务重启后丢失）
- **回调机制**：✅ 远程 LLM 完成后，通过 API 将消息插入回对话

## 架构设计

```
┌──────────────────────────────────────────────────────────────────────┐
│                           主进程                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    TaskManager (全局单例)                        │ │
│  │  - tasks: Map<taskId, Task>                                     │ │
│  │  - submit(task) → taskId                                        │ │
│  │  - check(taskId) → Task                                         │ │
│  │  - complete(taskId, result) → 插入消息到对话                     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                    ↑                                 │
│                                    │ 回调                            │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │         ChatService.insertSystemMessage()                       │ │
│  │         将远程 LLM 的结果作为"系统消息"插入对话                    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
          ↑ HTTP (INTERNAL_API_SECRET)            ↑
          │                                        │
    ┌─────┴─────┐                          ┌──────┴──────┐
    │  技能进程  │                          │  主进程路由  │
    │ (子进程)   │                          │ /internal/* │
    └───────────┘                          └─────────────┘
```

## 回调 API 设计

当远程 LLM 完成后，TaskManager 调用内部 API 将结果插入对话：

### 内部 API: `/internal/messages/insert`

**请求：**
```json
{
  "user_id": "user_xxx",
  "expert_id": "expert_xxx",
  "task_id": "task_xxx",
  "role": "system",
  "content": "远程 LLM 已完成任务 task_xxx，结果如下：\n\n...",
  "metadata": {
    "model_name": "claude-3-opus",
    "tokens_used": 1234,
    "latency_ms": 5678
  }
}
```

**处理流程：**
1. 插入一条消息到 `messages` 表
2. 如果用户正在与专家对话（SSE 连接活跃），推送通知
3. 专家下次对话时能看到这条消息

## TaskManager 实现

```javascript
// lib/task-manager.js

import Utils from './utils.js';
import LLMClient from './llm-client.js';
import logger from './logger.js';

class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.maxConcurrent = 5;
    this.running = 0;
    this.llmClient = null;  // 延迟初始化
    this.chatService = null;  // 延迟注入
  }
  
  /**
   * 设置 ChatService 引用（用于回调插入消息）
   */
  setChatService(chatService) {
    this.chatService = chatService;
  }
  
  /**
   * 设置 LLM 客户端配置加载器
   */
  setConfigLoader(configLoader) {
    this.configLoader = configLoader;
  }
  
  /**
   * 提交异步任务
   */
  async submit(task) {
    const taskId = `task_${Utils.newID(12)}`;
    
    const taskRecord = {
      id: taskId,
      user_id: task.user_id,
      expert_id: task.expert_id,
      model_id: task.model_id,
      prompt: task.prompt,
      system_prompt: task.system_prompt,
      parameters: task.parameters || {},
      status: 'pending',
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
      result: null,
      error: null,
    };
    
    this.tasks.set(taskId, taskRecord);
    
    // 异步执行（不等待）
    this.executeTask(taskRecord).catch(err => {
      logger.error('[TaskManager] 任务执行失败:', err.message);
    });
    
    return taskId;
  }
  
  /**
   * 检查任务状态
   */
  check(taskId) {
    return this.tasks.get(taskId) || null;
  }
  
  /**
   * 列出任务
   */
  list(userId, expertId, status = null, limit = 10) {
    let results = [];
    for (const task of this.tasks.values()) {
      if (task.user_id === userId && task.expert_id === expertId) {
        if (!status || task.status === status) {
          results.push(task);
        }
      }
    }
    return results.slice(0, limit);
  }
  
  /**
   * 执行单个任务
   */
  async executeTask(task) {
    task.status = 'running';
    task.started_at = Date.now();
    
    try {
      // 获取模型配置
      const modelConfig = await this.getModelConfig(task.model_id);
      
      // 创建 LLM 客户端
      const client = new LLMClient(this.configLoader, task.expert_id);
      await client.loadConfig();
      
      // 调用 LLM
      const startTime = Date.now();
      const messages = [];
      if (task.system_prompt) {
        messages.push({ role: 'system', content: task.system_prompt });
      }
      messages.push({ role: 'user', content: task.prompt });
      
      const response = await client.call(modelConfig, messages, task.parameters);
      
      task.status = 'completed';
      task.result = {
        content: response.content,
        tokens: response.usage?.total_tokens || 0,
      };
      task.completed_at = Date.now();
      
      // 回调：插入消息到对话
      await this.insertResultMessage(task);
      
      logger.info(`[TaskManager] 任务完成: ${task.id}`);
      
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      task.completed_at = Date.now();
      
      // 回调：插入错误消息
      await this.insertErrorMessage(task);
      
      logger.error(`[TaskManager] 任务失败: ${task.id}, ${error.message}`);
    }
  }
  
  /**
   * 获取模型配置
   */
  async getModelConfig(modelId) {
    // 从数据库或配置加载器获取模型配置
    // 简化实现，实际需要查询 ai_models 表
    return this.configLoader?.getModelConfig?.(modelId);
  }
  
  /**
   * 插入结果消息到对话
   */
  async insertResultMessage(task) {
    if (!this.chatService) {
      logger.warn('[TaskManager] ChatService 未注入，无法插入消息');
      return;
    }
    
    const content = `【任务 ${task.id} 已完成】\n\n远程 LLM 返回结果：\n\n${task.result.content}`;
    
    await this.chatService.insertSystemMessage({
      user_id: task.user_id,
      expert_id: task.expert_id,
      content,
      metadata: {
        task_id: task.id,
        model_id: task.model_id,
        tokens: task.result.tokens,
        latency_ms: task.completed_at - task.started_at,
      },
    });
  }
  
  /**
   * 插入错误消息到对话
   */
  async insertErrorMessage(task) {
    if (!this.chatService) return;
    
    const content = `【任务 ${task.id} 执行失败】\n\n错误：${task.error}`;
    
    await this.chatService.insertSystemMessage({
      user_id: task.user_id,
      expert_id: task.expert_id,
      content,
      metadata: {
        task_id: task.id,
        error: task.error,
      },
    });
  }
}

// 单例导出
export const taskManager = new TaskManager();
```

## ChatService 扩展

在 ChatService 中添加 `insertSystemMessage` 方法：

```javascript
// lib/chat-service.js 中添加

/**
 * 插入系统消息（用于回调通知）
 * @param {object} params - 参数
 * @param {string} params.user_id - 用户ID
 * @param {string} params.expert_id - 专家ID
 * @param {string} params.content - 消息内容
 * @param {object} params.metadata - 元数据（可选）
 */
async insertSystemMessage(params) {
  const { user_id, expert_id, content, metadata = {} } = params;
  
  const message_id = Utils.newID(20);
  
  await this.Message.create({
    id: message_id,
    topic_id: null,  // 未归档
    user_id,
    expert_id,
    role: 'system',
    content,
    inner_voice: JSON.stringify(metadata),
  });
  
  logger.info(`[ChatService] 系统消息已插入: ${message_id}`);
  
  // TODO: 如果用户有活跃的 SSE 连接，推送通知
  
  return message_id;
}
```

## 内部 API 路由

```javascript
// server/routes/internal.routes.js

import Router from '@koa/router';
import { taskManager } from '../../lib/task-manager.js';

const router = new Router();

// 内部 API 密钥验证
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'your-secret-key';

router.use(async (ctx, next) => {
  const authHeader = ctx.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  
  if (token !== INTERNAL_API_SECRET) {
    ctx.status = 401;
    ctx.body = { error: 'Unauthorized' };
    return;
  }
  
  await next();
});

// 提交任务
router.post('/tasks/submit', async (ctx) => {
  const { user_id, expert_id, model_id, prompt, system_prompt, parameters } = ctx.request.body;
  
  if (!user_id || !expert_id || !model_id || !prompt) {
    ctx.status = 400;
    ctx.body = { error: 'Missing required fields' };
    return;
  }
  
  const taskId = await taskManager.submit({
    user_id,
    expert_id,
    model_id,
    prompt,
    system_prompt,
    parameters,
  });
  
  ctx.body = { success: true, task_id: taskId };
});

// 查询任务
router.get('/tasks/:taskId', async (ctx) => {
  const task = taskManager.check(ctx.params.taskId);
  
  if (!task) {
    ctx.status = 404;
    ctx.body = { error: 'Task not found' };
    return;
  }
  
  ctx.body = {
    success: true,
    id: task.id,
    status: task.status,
    result: task.result,
    error: task.error,
    created_at: task.created_at,
    completed_at: task.completed_at,
  };
});

// 列出任务
router.get('/tasks', async (ctx) => {
  const { user_id, expert_id, status, limit } = ctx.query;
  
  const tasks = taskManager.list(
    user_id,
    expert_id,
    status,
    parseInt(limit) || 10
  );
  
  ctx.body = { success: true, tasks };
});

export default router;
```

## 技能代码

```javascript
// data/skills/remote-llm/index.js

const https = require('https');
const http = require('http');

// 内部 API 基础 URL（从环境变量读取）
const API_BASE = process.env.INTERNAL_API_BASE || 'http://localhost:3000';
const API_SECRET = process.env.INTERNAL_API_SECRET || 'your-secret-key';

/**
 * 调用内部 API
 */
async function callInternalAPI(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json',
      },
    };
    
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }
    
    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * 提交异步任务
 */
async function submitTask(params) {
  const { model_id, prompt, system_prompt, temperature, max_tokens } = params;
  
  if (!model_id || !prompt) {
    return { success: false, error: 'model_id and prompt are required' };
  }
  
  // 从 context 中获取 user_id 和 expert_id
  const context = params._context || {};
  
  try {
    const result = await callInternalAPI('POST', '/internal/tasks/submit', {
      user_id: context.user_id,
      expert_id: context.expert_id,
      model_id,
      prompt,
      system_prompt,
      parameters: { temperature, max_tokens },
    });
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 查询任务状态
 */
async function checkTask(params) {
  const { task_id } = params;
  
  if (!task_id) {
    return { success: false, error: 'task_id is required' };
  }
  
  try {
    const result = await callInternalAPI('GET', `/internal/tasks/${task_id}`);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 列出任务
 */
async function listTasks(params) {
  const { status, limit } = params;
  const context = params._context || {};
  
  try {
    const query = new URLSearchParams({
      user_id: context.user_id,
      expert_id: context.expert_id,
      ...(status && { status }),
      ...(limit && { limit }),
    });
    
    const result = await callInternalAPI('GET', `/internal/tasks?${query}`);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 技能入口
 */
async function execute(toolName, params, context = {}) {
  // 注入 context 到 params
  params._context = context;
  
  switch (toolName) {
    case 'submit_task':
      return await submitTask(params);
    case 'check_task':
      return await checkTask(params);
    case 'list_tasks':
      return await listTasks(params);
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

module.exports = { execute };
```

技能代码在**子进程**中通过 `vm.runInContext()` 执行，导出 `execute` 函数：

```javascript
// data/skills/remote-llm/index.js
async function execute(toolName, params, context) {
  switch (toolName) {
    case 'submit_task':
      return await submitTask(params, context);
    case 'check_task':
      return await checkTask(params, context);
    // ...
  }
}

module.exports = { execute };
```

## 技能与主进程通信

**关键问题：技能运行在子进程中，无法直接访问主进程内存！**

解决方案：技能通过**内部 API**与主进程的 TaskManager 通信：

```javascript
// 技能调用内部 API
const response = await fetch(`${process.env.API_BASE}/internal/tasks/submit`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ model_id, prompt, ... }),
});
```

## 工具设计

### 1. `submit_task` - 提交异步任务

**参数：**
- `model_id` (string, required): 目标模型 ID
- `prompt` (string, required): 发送给目标 LLM 的提示
- `system_prompt` (string, optional): 系统提示
- `temperature` (number, optional): 温度参数，默认 0.7
- `max_tokens` (number, optional): 最大输出 token，默认 4096

**返回：**
```json
{ "success": true, "task_id": "task_xxx" }
```

### 2. `check_task` - 查询任务状态

**参数：**
- `task_id` (string, required): 任务编号

**返回：**
```json
{
  "success": true,
  "status": "completed",
  "result": { "content": "..." }
}
```

### 3. `list_tasks` - 列出任务

**参数：**
- `status` (string, optional): 筛选状态
- `limit` (number, optional): 返回数量，默认 10

## LLM 发起调用的完整流程

```
┌──────────────────────────────────────────────────────────────────────┐
│                           专家对话流程                                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 用户发消息: "帮我用 Claude 分析一下这段代码"                      │
│                         ↓                                            │
│  2. LLM 返回 tool_call:                                              │
│     {                                                                │
│       "function": {                                                  │
│         "name": "remote-llm_submit_task",                           │
│         "arguments": {                                               │
│           "model_id": "claude-3-opus",                              │
│           "prompt": "分析这段代码..."                                │
│         }                                                            │
│       }                                                              │
│     }                                                                │
│                         ↓                                            │
│  3. ToolManager.executeTool("remote-llm_submit_task", args)         │
│                         ↓                                            │
│  4. SkillRunner 在子进程中执行 remote-llm 技能                       │
│                         ↓                                            │
│  5. 技能调用内部 API: POST /internal/tasks/submit                    │
│                         ↓                                            │
│  6. TaskManager 创建任务，后台异步执行 LLM 调用                       │
│                         ↓                                            │
│  7. 返回结果给专家: { "success": true, "task_id": "task_xxx" }       │
│                         ↓                                            │
│  8. 专家回复: "任务已提交，编号: task_xxx，完成后会通知您"            │
│                                                                      │
│  ═══════════════════════════════════════════════════════════════════ │
│                                                                      │
│  9. [后台] 远程 LLM 完成调用                                          │
│                         ↓                                            │
│  10. [后台] TaskManager 调用 ChatService.insertSystemMessage()       │
│                         ↓                                            │
│  11. [后台] 插入消息:                                                 │
│      {                                                               │
│        "role": "system",                                             │
│        "content": "【任务 task_xxx 已完成】\n结果：..."               │
│      }                                                               │
│                         ↓                                            │
│  12. [可选] 如果用户在线，通过 SSE 推送通知                           │
│                                                                      │
│  ═══════════════════════════════════════════════════════════════════ │
│                                                                      │
│  13. 用户继续对话，专家能看到任务结果消息                             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 技能注册

在 `skill_tools` 表中注册工具定义，LLM 就能看到并调用：

```sql
-- 注册技能
INSERT INTO skills (id, name, description, source_path, is_active)
VALUES ('remote-llm', 'remote-llm', '远程 LLM 调用技能', 'data/skills/remote-llm', 1);

-- 注册工具
INSERT INTO skill_tools (skill_id, name, description, parameters) VALUES
('remote-llm', 'submit_task', '提交异步任务到远程 LLM。返回任务编号，任务完成后结果会自动插入对话。', 
 '{"type":"object","properties":{"model_id":{"type":"string","description":"目标模型ID，从 ai_models 表获取"},"prompt":{"type":"string","description":"发送给目标 LLM 的提示"},"system_prompt":{"type":"string","description":"系统提示（可选）"},"temperature":{"type":"number","description":"温度参数，默认0.7"},"max_tokens":{"type":"integer","description":"最大输出token，默认4096"}},"required":["model_id","prompt"]}'),
('remote-llm', 'check_task', '查询任务状态和结果',
 '{"type":"object","properties":{"task_id":{"type":"string","description":"任务编号"}},"required":["task_id"]}'),
('remote-llm', 'list_tasks', '列出任务',
 '{"type":"object","properties":{"status":{"type":"string","enum":["pending","running","completed","failed"],"description":"筛选状态"},"limit":{"type":"integer","description":"返回数量，默认10"}}}');
```

## SKILL.md 文档

```markdown
# Remote LLM Skill

调用其他 LLM 的异步技能。

## 工具

### submit_task

提交异步任务到远程 LLM。

**参数：**
- `model_id` (required): 目标模型ID，从 ai_models 表获取
- `prompt` (required): 发送给目标 LLM 的提示
- `system_prompt` (optional): 系统提示
- `temperature` (optional): 温度参数，默认0.7
- `max_tokens` (optional): 最大输出token，默认4096

**返回：**
```json
{ "success": true, "task_id": "task_xxx" }
```

任务完成后，结果会自动作为系统消息插入到对话中。

### check_task

查询任务状态。

**参数：**
- `task_id` (required): 任务编号

**返回：**
```json
{
  "success": true,
  "id": "task_xxx",
  "status": "completed",
  "result": { "content": "...", "tokens": 1234 },
  "error": null
}
```

### list_tasks

列出任务。

**参数：**
- `status` (optional): 筛选状态 (pending/running/completed/failed)
- `limit` (optional): 返回数量，默认10
```

在 `skill_tools` 表中注册工具定义，LLM 就能看到并调用：

```sql
INSERT INTO skill_tools (skill_id, name, description, parameters) VALUES
('remote-llm', 'submit_task', '提交异步任务到远程 LLM', '...');
```

---

## 实现步骤

### 1. 创建文件

```
lib/task-manager.js          # TaskManager 类
server/routes/internal.routes.js  # 内部 API 路由
data/skills/remote-llm/index.js   # 技能代码
data/skills/remote-llm/SKILL.md   # 技能文档
```

### 2. 修改文件

```
lib/chat-service.js          # 添加 insertSystemMessage 方法
server/index.js              # 注册内部 API 路由
```

### 3. 数据库

```sql
-- 注册技能和工具
INSERT INTO skills ...
INSERT INTO skill_tools ...
```

### 4. 环境变量

```bash
INTERNAL_API_SECRET=your-secret-key
INTERNAL_API_BASE=http://localhost:3000
```

---

✌Bazinga！