# 驻留式技能工具设计方案

**Issue:** #80, #81

## 概述

驻留式技能工具（Resident Skill Tool）是一种在系统启动时加载并持续运行的技能进程。它通过 stdio 与主进程通信，支持异步任务处理，适用于需要长时间运行的操作（如远程 LLM 调用）。

## 核心设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            主进程 (Server)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────┐    ┌────────────────────────────────────┐   │
│  │ ResidentSkillManager  │    │         API Layer                   │   │
│  │                       │    │  POST /internal/resident/invoke     │   │
│  │ - 启动驻留进程        │◄───┤  - 接收其他技能/工具的调用请求      │   │
│  │ - 维护 stdio 映射     │    │  - 验证 user token                 │   │
│  │ - 生命周期管理        │    │  - 转发到对应驻留进程              │   │
│  └───────────┬───────────┘    └────────────────────────────────────┘   │
│              │                                                          │
│              │ stdin/stdout (JSON-RPC 风格)                             │
│              ▼                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                 驻留进程 (Resident Worker)                      │    │
│  │                                                                 │    │
│  │  - 监听 stdin 接收任务                                          │    │
│  │  - 执行异步操作（如远程 LLM 调用）                              │    │
│  │  - 完成后调用回调 API 插入消息                                  │    │
│  │  - 继续等待下一个任务                                           │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                    SSE Manager                                   │    │
│  │                                                                 │    │
│  │  - 维护活跃的 SSE 连接 (user_id + expert_id)                    │    │
│  │  - 消息插入后检查是否有活跃连接                                 │    │
│  │  - 有连接：立即触发专家响应                                     │    │
│  │  - 无连接：消息留在数据库等待下次对话                           │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 数据流

### 1. 系统启动

```
系统启动
    │
    ├─► 查询 skill_tools WHERE is_resident = true
    │
    ├─► 为每个驻留工具启动子进程
    │       const proc = spawn('node', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    │       this.processes.set(skillId, { proc, stdin, stdout });
    │
    └─► 建立 stdin/stdout 通信管道
```

### 2. 其他技能/工具发起请求

```
其他技能/工具发起请求
    │
    ├─► POST /internal/resident/invoke
    │       Headers: Authorization: Bearer <user_token>
    │       Body: { skill_id, tool, params, context }
    │
    ├─► 验证 token，提取 user_id
    │
    ├─► 通过 stdin 发送给驻留进程
    │       { task_id, tool, params, user_id, expert_id, topic_id, access_token }
    │
    └─► 立即返回 { task_id, status: "pending" }
```

### 3. 驻留进程执行

```
驻留进程收到任务
    │
    ├─► 解析 stdin 数据
    │
    ├─► 执行异步操作（如远程 LLM 调用）
    │
    ├─► 完成后调用回调 API
    │       POST /internal/messages/insert
    │       Body: { task_id, user_id, expert_id, topic_id, content }
    │
    └─► 继续等待下一个任务
```

### 4. 消息触发专家响应

```
消息插入后
    │
    ├─► 检查是否有活跃的 SSE 连接 (user_id + expert_id)
    │
    ├─► [有连接] 立即触发专家响应
    │       - SSE 推送: { event: "new_context", data: { message_id } }
    │       - 专家收到通知，重新生成响应
    │
    └─► [无连接] 消息留在数据库
            - 下次用户发消息时，读取所有未处理的系统消息
            - 作为上下文发送给专家
```

## 触发专家响应的机制

### 方案：混合模式（推送 + 拉取）

#### 场景 A：专家正在与用户对话（SSE 连接活跃）

```
用户 ◄─────── SSE ───────► 专家
                          │
                          ▼
              消息插入后立即触发
                          │
                          ▼
              SSE 推送: { event: "new_context" }
                          │
                          ▼
              专家收到通知，重新生成响应
```

**实现：**
```javascript
// 在 ChatService.insertSystemMessage() 中
async insertSystemMessage(params) {
  // 1. 插入消息到数据库
  const message = await this.Message.create({ ... });
  
  // 2. 检查是否有活跃的 SSE 连接
  const sseManager = this.getSSEManager();
  const activeConnection = sseManager.getConnection(params.user_id, params.expert_id);
  
  if (activeConnection) {
    // 3. 有连接：立即推送通知
    sseManager.push(params.user_id, params.expert_id, {
      event: 'new_context',
      data: {
        message_id: message.id,
        content: message.content,
        trigger_response: true,  // 告诉专家需要响应
      }
    });
  }
  
  return message;
}
```

#### 场景 B：专家在后台运行（无 SSE 连接）

```
用户 ◄─────── 无连接 ───────► 专家

消息插入后
    │
    ▼
消息留在数据库，标记为 pending
    │
    ▼
下次用户发消息时
    │
    ▼
读取所有 pending 消息
    │
    ▼
作为上下文发送给专家
```

**实现：**
```javascript
// 在 ChatService.chat() 中
async chat(userId, expertId, userMessage) {
  // 1. 检查是否有未处理的系统消息
  const pendingMessages = await this.Message.findAll({
    where: {
      user_id: userId,
      expert_id: expertId,
      role: 'system',
      processed: false,
    },
    order: [['created_at', 'ASC']],
  });
  
  // 2. 构建上下文
  const context = [
    ...pendingMessages.map(m => ({ role: 'system', content: m.content })),
    { role: 'user', content: userMessage },
  ];
  
  // 3. 调用专家
  const response = await this.callExpert(expertId, context);
  
  // 4. 标记系统消息为已处理
  await this.Message.update(
    { processed: true },
    { where: { id: pendingMessages.map(m => m.id) } }
  );
  
  return response;
}
```

## 数据库设计

### skill_tools 表添加字段

```sql
ALTER TABLE skill_tools 
ADD COLUMN is_resident BIT(1) DEFAULT b'0' COMMENT '是否驻留进程';
```

### messages 表添加字段（可选）

```sql
ALTER TABLE messages 
ADD COLUMN processed BIT(1) DEFAULT b'0' COMMENT '是否已被专家处理';
```

## 关键组件

### 1. ResidentSkillManager

```javascript
// lib/resident-skill-manager.js

import { spawn } from 'child_process';
import Utils from './utils.js';
import logger from './logger.js';

class ResidentSkillManager {
  constructor(db) {
    this.db = db;
    this.processes = new Map(); // skillId -> { proc, stdin, stdout, buffer }
  }
  
  /**
   * 系统启动时调用，启动所有驻留进程
   */
  async startAll() {
    const SkillTool = this.db.getModel('skill_tool');
    const residents = await SkillTool.findAll({
      where: { is_resident: true },
      include: [{ model: this.db.getModel('skill'), as: 'skill' }],
      raw: true,
    });
    
    logger.info(`[ResidentSkillManager] 发现 ${residents.length} 个驻留工具`);
    
    for (const tool of residents) {
      await this.startProcess(tool);
    }
  }
  
  /**
   * 启动单个驻留进程
   */
  async startProcess(tool) {
    const skillId = tool.skill_id;
    const skillPath = tool.skill.source_path;
    const scriptPath = tool.script_path || 'index.js';
    
    const fullScriptPath = path.join(process.env.DATA_BASE_PATH, skillPath, scriptPath);
    
    logger.info(`[ResidentSkillManager] 启动驻留进程: ${skillId}, 脚本: ${fullScriptPath}`);
    
    const proc = spawn('node', [fullScriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SKILL_ID: skillId,
        IS_RESIDENT: 'true',
      },
    });
    
    const processInfo = {
      proc,
      stdin: proc.stdin,
      stdout: proc.stdout,
      buffer: '',
      pendingCallbacks: new Map(), // taskId -> { resolve, reject }
    };
    
    // 监听 stdout，处理响应
    proc.stdout.on('data', (data) => {
      this.handleOutput(processInfo, data);
    });
    
    // 监听 stderr，记录日志
    proc.stderr.on('data', (data) => {
      logger.debug(`[Resident:${skillId}] ${data.toString()}`);
    });
    
    // 监听进程退出
    proc.on('close', (code) => {
      logger.warn(`[ResidentSkillManager] 进程退出: ${skillId}, code: ${code}`);
      this.processes.delete(skillId);
      // TODO: 自动重启
    });
    
    this.processes.set(skillId, processInfo);
  }
  
  /**
   * 发送任务给驻留进程
   */
  async invoke(skillId, tool, params, context) {
    const processInfo = this.processes.get(skillId);
    if (!processInfo) {
      throw new Error(`Resident process not found: ${skillId}`);
    }
    
    const taskId = `task_${Utils.newID(12)}`;
    
    const task = {
      task_id: taskId,
      tool,
      params,
      user_id: context.userId,
      expert_id: context.expertId,
      topic_id: context.topicId,
      access_token: context.accessToken,
      api_base: process.env.API_BASE,
    };
    
    // 发送到 stdin
    processInfo.stdin.write(JSON.stringify(task) + '\n');
    
    logger.info(`[ResidentSkillManager] 任务已发送: ${taskId} -> ${skillId}`);
    
    return { task_id: taskId, status: 'pending' };
  }
  
  /**
   * 处理驻留进程的输出
   */
  handleOutput(processInfo, data) {
    processInfo.buffer += data.toString();
    
    // 按行分割，每行是一个 JSON
    const lines = processInfo.buffer.split('\n');
    processInfo.buffer = lines.pop(); // 保留不完整的行
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response = JSON.parse(line);
        logger.debug(`[ResidentSkillManager] 收到响应:`, response);
        
        // 如果是回调通知，触发相应处理
        if (response.type === 'callback_complete') {
          // 驻留进程已完成任务并调用了回调 API
          logger.info(`[ResidentSkillManager] 任务完成: ${response.task_id}`);
        }
      } catch (e) {
        logger.warn(`[ResidentSkillManager] 解析输出失败: ${line}`);
      }
    }
  }
  
  /**
   * 停止所有驻留进程
   */
  async stopAll() {
    for (const [skillId, processInfo] of this.processes) {
      logger.info(`[ResidentSkillManager] 停止进程: ${skillId}`);
      processInfo.proc.kill();
    }
    this.processes.clear();
  }
}

// 单例
let instance = null;

export function getResidentSkillManager(db) {
  if (!instance && db) {
    instance = new ResidentSkillManager(db);
  }
  return instance;
}

export default ResidentSkillManager;
```

### 2. 驻留进程模板

```javascript
// data/skills/remote-llm/index.js (驻留模式)

const https = require('https');
const http = require('http');
const readline = require('readline');

// 从环境变量读取配置
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

/**
 * 调用内部 API
 */
async function callAPI(method, path, body, token) {
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
        'Content-Type': 'application/json',
      },
    };
    
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    
    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * 插入消息到对话
 */
async function insertMessage(task, content) {
  await callAPI('POST', '/internal/messages/insert', {
    task_id: task.task_id,
    user_id: task.user_id,
    expert_id: task.expert_id,
    topic_id: task.topic_id,
    role: 'system',
    content: `【任务 ${task.task_id} 已完成】\n\n${content}`,
  }, task.access_token);
}

/**
 * 执行远程 LLM 调用
 */
async function executeRemoteLLM(task) {
  const { params } = task;
  
  // TODO: 实现实际的远程 LLM 调用
  // 这里模拟一个异步操作
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  return {
    content: `远程 LLM 处理完成。参数: ${JSON.stringify(params)}`,
    tokens: 1234,
  };
}

/**
 * 处理单个任务
 */
async function handleTask(task) {
  try {
    // 执行远程 LLM 调用
    const result = await executeRemoteLLM(task);
    
    // 插入消息到对话
    await insertMessage(task, result.content);
    
    // 通知主进程任务完成
    console.log(JSON.stringify({
      type: 'callback_complete',
      task_id: task.task_id,
      success: true,
    }));
    
  } catch (error) {
    // 插入错误消息
    await insertMessage(task, `任务执行失败: ${error.message}`);
    
    console.log(JSON.stringify({
      type: 'callback_complete',
      task_id: task.task_id,
      success: false,
      error: error.message,
    }));
  }
}

/**
 * 主循环：监听 stdin
 */
async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  
  process.stderr.write('[remote-llm] 驻留进程已启动，等待任务...\n');
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const task = JSON.parse(line);
      process.stderr.write(`[remote-llm] 收到任务: ${task.task_id}\n`);
      
      // 异步处理任务（不阻塞主循环）
      handleTask(task).catch(err => {
        process.stderr.write(`[remote-llm] 任务处理错误: ${err.message}\n`);
      });
      
    } catch (e) {
      process.stderr.write(`[remote-llm] 解析任务失败: ${e.message}\n`);
    }
  }
}

main();
```

### 3. 内部 API 路由

```javascript
// server/routes/internal.routes.js

import Router from '@koa/router';
import { getResidentSkillManager } from '../../lib/resident-skill-manager.js';

const router = new Router({ prefix: '/internal' });

// 驻留进程调用 API
router.post('/resident/invoke', async (ctx) => {
  const { skill_id, tool, params, context } = ctx.request.body;
  
  // 验证 user token
  const token = ctx.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    ctx.status = 401;
    ctx.body = { error: 'Unauthorized' };
    return;
  }
  
  // 从 token 提取 user_id（或从 context 获取）
  const userId = ctx.state.user?.id || context?.user_id;
  
  try {
    const manager = getResidentSkillManager(ctx.db);
    const result = await manager.invoke(skill_id, tool, params, {
      ...context,
      userId,
      accessToken: token,
    });
    
    ctx.body = result;
  } catch (error) {
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

// 消息插入 API（供驻留进程调用）
router.post('/messages/insert', async (ctx) => {
  const { task_id, user_id, expert_id, topic_id, role, content, metadata } = ctx.request.body;
  
  // 验证 token
  const token = ctx.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    ctx.status = 401;
    ctx.body = { error: 'Unauthorized' };
    return;
  }
  
  try {
    const Message = ctx.db.getModel('message');
    const messageId = ctx.db.utils.newID(20);
    
    await Message.create({
      id: messageId,
      topic_id,
      user_id,
      expert_id,
      role: role || 'system',
      content,
      inner_voice: metadata ? JSON.stringify(metadata) : null,
    });
    
    // 检查是否有活跃的 SSE 连接
    const sseManager = ctx.app.context.sseManager;
    if (sseManager) {
      const activeConnection = sseManager.getConnection(user_id, expert_id);
      if (activeConnection) {
        // 推送通知
        sseManager.push(user_id, expert_id, {
          event: 'new_context',
          data: {
            message_id: messageId,
            content,
            trigger_response: true,
          },
        });
      }
    }
    
    ctx.body = { success: true, message_id: messageId };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

export default router;
```

## 实现步骤

### Phase 1: 基础设施 ✅ 已完成

1. **数据库迁移** ✅
   - `skill_tools` 表添加 `is_resident` 字段
   - 迁移脚本: `scripts/migrate-skill-tools-resident.js`
   - 模型更新: `models/skill_tool.js`

2. **创建 ResidentSkillManager** ✅
   - `lib/resident-skill-manager.js`
   - 支持进程启动、停止、任务调用
   - stdio 通信协议实现

3. **创建内部 API 路由** ✅
   - `server/routes/internal.routes.js`
   - `server/controllers/internal.controller.js`
   - 端点: `POST /internal/messages/insert`

### Phase 2: SSE 集成 ✅ 已完成

1. **扩展 SSE Manager** ✅
   - `StreamController.expertConnections` Map
   - `InternalController.setExpertConnections()` 共享连接池

2. **消息插入服务** ✅
   - `InternalController.insertMessage()` 方法
   - SSE 推送触发逻辑

### Phase 3: 驻留技能 ✅ 已完成

1. **创建 remote-llm 技能** ✅
   - `data/skills/remote-llm/index.js`
   - `data/skills/remote-llm/SKILL.md`
   - `data/skills/remote-llm/package.json`

2. **服务器集成** ✅
   - `server/index.js` 导入并初始化 `ResidentSkillManager`
   - 优雅关闭处理

### Phase 4: 注册技能（待执行）

需要通过管理 API 或数据库插入注册技能：

```sql
-- 1. 注册技能
INSERT INTO skills (id, name, source_path, description)
VALUES ('remote-llm', 'remote-llm', 'remote-llm', '远程 LLM 调用驻留技能');

-- 2. 注册工具
INSERT INTO skill_tools (id, skill_id, name, description, is_resident, script_path)
VALUES (
  'tool_remote_llm_call',
  'remote-llm',
  'call_llm',
  '调用远程 LLM API',
  1,  -- is_resident = 1
  'index.js'
);
```

## 已实现文件清单

| 文件 | 说明 | 状态 |
|------|------|------|
| `lib/resident-skill-manager.js` | 驻留进程管理器 | ✅ |
| `server/index.js` | 集成初始化和关闭处理 | ✅ |
| `server/controllers/internal.controller.js` | 内部 API 控制器 | ✅ |
| `server/routes/internal.routes.js` | 内部 API 路由 | ✅ |
| `models/skill_tool.js` | 添加 is_resident 字段 | ✅ |
| `scripts/migrate-skill-tools-resident.js` | 迁移脚本 | ✅ |
| `data/skills/remote-llm/index.js` | 远程 LLM 技能实现 | ✅ |
| `data/skills/remote-llm/SKILL.md` | 技能文档 | ✅ |
| `data/skills/remote-llm/package.json` | 技能配置 | ✅ |

## 待讨论

1. **驻留进程崩溃恢复**：是否需要自动重启？ - 建议：Phase 5 实现
2. **任务状态持久化**：是否需要在数据库记录任务状态？ - 建议：Phase 5 实现
3. **并发限制**：每个驻留进程的最大并发任务数？ - 建议：Phase 5 实现

---

✌Bazinga！