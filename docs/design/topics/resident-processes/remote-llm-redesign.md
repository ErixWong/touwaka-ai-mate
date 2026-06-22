# Remote LLM 调用技能 - 重新设计

## 背景

基于已完成的驻留式技能基础设施（Issue #80, #81），需要重新设计远程 LLM 调用技能。

## 已完成的基础设施

1. **`lib/resident-skill-manager.js`** - 驻留式技能管理器
2. **`server/routes/internal.routes.js`** - 内部 API 路由
3. **`server/controllers/internal.controller.js`** - 内部 API 控制器
4. **`/internal/messages/insert`** - 消息插入 API（支持 SSE 推送）

## 新需求架构

### 两层 Tool 设计

```
┌─────────────────────────────────────────────────────────────────┐
│                           专家层                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Tool: remote_llm_submit (专家调用)                      │   │
│  │  - 参数: model_id, prompt, system_prompt, etc.          │   │
│  │  - 返回: "已放入队列，任务ID: xxx，完成后会通知您"         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ResidentSkillManager                                    │   │
│  │  - 管理驻留进程                                          │   │
│  │  - 转发任务请求                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼ (stdin/stdout)                   │
├─────────────────────────────────────────────────────────────────┤
│                        驻留进程层                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Tool: remote-llm-executor (驻留进程)                    │   │
│  │  - is_resident = 1                                       │   │
│  │  - 跟随系统启动                                          │   │
│  │  - 接收任务请求                                          │   │
│  │  - 查询 ai_models 表获取 API 配置                        │   │
│  │  - 发起远程 LLM 调用                                     │   │
│  │  - 完成后调用 /internal/messages/insert 通知专家         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Tool 1: remote-llm-executor（驻留进程）

### 配置

| 属性 | 值 |
|------|-----|
| 名称 | remote-llm-executor |
| 类型 | 驻留式 (is_resident = 1) |
| 脚本 | `data/skills/remote-llm/index.js` |
| 启动 | 跟随系统自动启动 |

### 功能

1. 监听 stdin 接收任务请求
2. 从 `ai_models` 表查询模型配置（endpoint, api_key）
3. 发起远程 LLM API 调用
4. 调用 `/internal/messages/insert` 将结果推送给专家

### 通信协议

**输入 (stdin):**
```json
{
  "command": "invoke",
  "task_id": "task_xxx",
  "params": {
    "user_id": "user_xxx",
    "expert_id": "expert_xxx",
    "model_id": "model_xxx",
    "prompt": "用户的问题",
    "system_prompt": "系统提示",
    "temperature": 0.7,
    "max_tokens": 4096
  }
}
```

**输出 (stdout):**
```json
// 立即返回任务确认
{"task_id": "task_xxx", "result": {"status": "queued", "message": "已放入队列"}}

// 日志消息
{"type": "log", "message": "正在调用模型 xxx..."}

// 后续通过 /internal/messages/insert 推送结果
```

### 需要的环境变量

| 变量 | 说明 |
|------|------|
| INTERNAL_API_BASE | 内部 API 地址 |
| INTERNAL_KEY | 内部 API 密钥 |
| DB_PATH | 数据库配置（用于查询 ai_models） |

## Tool 2: remote_llm_submit（专家调用）

### 配置

| 属性 | 值 |
|------|-----|
| 名称 | remote_llm_submit |
| 类型 | 普通技能工具 |
| 所属技能 | remote-llm |

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model_id | string | 是 | 目标模型 ID（ai_models 表） |
| prompt | string | 是 | 发送给 LLM 的提示 |
| system_prompt | string | 否 | 系统提示 |
| temperature | number | 否 | 温度参数，默认 0.7 |
| max_tokens | number | 否 | 最大输出 token，默认 4096 |

### 返回

```json
{
  "success": true,
  "task_id": "task_xxx",
  "message": "已放入队列，待执行完成后会通知您"
}
```

### 实现逻辑

```javascript
// data/skills/remote-llm/submit.js
export async function execute(params, context) {
  const { model_id, prompt, system_prompt, temperature, max_tokens } = params;
  const { user_id, expert_id, residentSkillManager } = context;
  
  // 调用驻留进程
  const result = await residentSkillManager.invokeByName(
    'remote-llm',  // skill_id 或 skill_name
    'remote-llm-executor',  // tool_name
    {
      user_id,
      expert_id,
      model_id,
      prompt,
      system_prompt,
      temperature,
      max_tokens,
    }
  );
  
  return {
    success: true,
    task_id: result.task_id,
    message: '已放入队列，待执行完成后会通知您',
  };
}
```

## 数据库查询

驻留进程需要查询 `ai_models` 表获取模型配置：

```sql
SELECT 
  m.id, m.model_name, m.provider_id,
  p.base_url, p.api_key
FROM ai_models m
JOIN ai_providers p ON m.provider_id = p.id
WHERE m.id = ?
```

## 任务队列

使用内存队列管理任务：

```javascript
// lib/task-queue.js
class TaskQueue {
  constructor() {
    this.tasks = new Map();  // taskId -> Task
    this.queue = [];         // 待执行队列
  }
  
  submit(task) {
    const taskId = generateTaskId();
    this.tasks.set(taskId, { ...task, id: taskId, status: 'pending' });
    this.queue.push(taskId);
    this.processNext();
    return taskId;
  }
  
  async processNext() {
    if (this.processing) return;
    const taskId = this.queue.shift();
    if (!taskId) return;
    
    this.processing = true;
    const task = this.tasks.get(taskId);
    task.status = 'running';
    
    try {
      const result = await this.executeTask(task);
      task.status = 'completed';
      task.result = result;
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
    }
    
    this.processing = false;
    this.processNext();
  }
}
```

## 文件结构

```
data/skills/remote-llm/
├── index.js          # 驻留进程脚本 (remote-llm-executor)
├── submit.js         # 专家调用工具 (remote_llm_submit)
├── task-queue.js     # 任务队列（可选，也可以在主进程）
├── SKILL.md          # 技能文档
└── package.json      # 依赖配置
```

## 实现步骤

1. [ ] 更新 `data/skills/remote-llm/index.js` - 实现驻留进程逻辑
   - 添加 `ai_models` 表查询
   - 实现任务队列
   - 完成后调用内部 API 通知

2. [ ] 创建 `data/skills/remote-llm/submit.js` - 专家调用工具
   - 调用驻留进程
   - 返回任务确认

3. [ ] 更新 `data/skills/remote-llm/SKILL.md` - 文档

4. [ ] 注册两个工具到数据库
   - `remote-llm-executor` (is_resident = 1)
   - `remote_llm_submit` (is_resident = 0)

5. [ ] 测试验证

## 关键问题

### Q: 驻留进程如何访问数据库？

方案 A: 通过内部 API
- 提供 `/internal/models/:model_id` API 获取模型配置
- 驻留进程调用内部 API 查询

方案 B: 驻留进程直接连接数据库
- 需要传递数据库连接配置
- 驻留进程使用独立的数据库连接

**推荐方案 A**，保持驻留进程简单，不直接访问数据库。

### Q: 如何通知专家？

使用已实现的 `/internal/messages/insert` API：
- 调用成功：插入 assistant 消息，包含结果
- 调用失败：插入 system 消息，说明错误

## 安全考虑

1. model_id 验证：确保模型存在且可用
2. API 密钥保护：不在日志中输出
3. 超时处理：设置合理的超时时间
4. 错误处理：失败时通知专家