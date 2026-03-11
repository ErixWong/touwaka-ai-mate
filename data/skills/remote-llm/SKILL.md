# Remote LLM - 远程 LLM 调用技能

## 概述

这是一个**驻留式技能**，用于调用远程 LLM API 并将结果推送给专家。

### 驻留模式特性

- 作为长期运行的子进程启动
- 通过 stdio 与主进程通信
- 支持异步任务处理
- 可主动推送消息给专家

## 技能信息

| 属性 | 值 |
|------|-----|
| 名称 | remote-llm |
| 版本 | 1.0.0 |
| 类型 | 驻留式 (is_resident = 1) |
| 依赖 | 无外部依赖（使用 Node.js 内置模块） |

## 工具列表

### 1. call_llm - 调用远程 LLM

调用远程 LLM API 并返回结果。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| api_base | string | 是 | LLM API 端点 URL |
| api_key | string | 是 | API 密钥 |
| model | string | 是 | 模型名称 |
| messages | array | 是 | 消息数组 |
| temperature | number | 否 | 温度参数，默认 0.7 |
| max_tokens | number | 否 | 最大 token 数，默认 4096 |
| notify | object | 否 | 自动通知专家配置 |

**notify 配置：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户 ID |
| expert_id | string | 是 | 专家 ID |

**示例：**

```json
{
  "action": "call_llm",
  "api_base": "https://api.openai.com/v1/chat/completions",
  "api_key": "sk-xxx",
  "model": "gpt-4",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "notify": {
    "user_id": "user_123",
    "expert_id": "expert_456"
  }
}
```

### 2. notify_expert - 通知专家

直接向专家发送消息（通过内部 API）。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 是 | 用户 ID |
| expert_id | string | 是 | 专家 ID |
| content | string | 是 | 消息内容 |
| role | string | 否 | 角色，默认 "assistant" |

### 3. ping - 健康检查

检查驻留进程是否正常运行。

## 通信协议

### 输入格式（stdin）

```json
{"command": "invoke", "task_id": "xxx", "params": {...}}
{"command": "exit"}
{"command": "ping"}
```

### 输出格式（stdout）

**任务结果：**
```json
{"task_id": "xxx", "result": {...}}
{"task_id": "xxx", "error": "错误信息"}
```

**日志消息：**
```json
{"type": "log", "message": "日志内容"}
```

**就绪信号：**
```json
{"type": "ready", "timestamp": 1234567890}
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| INTERNAL_API_BASE | 内部 API 地址 | http://localhost:3000 |
| INTERNAL_KEY | 内部 API 密钥 | 空（使用 IP 白名单） |
| RESIDENT_MODE | 驻留模式标记 | true |

## 数据库配置

在 `skill_tools` 表中注册：

```sql
INSERT INTO skill_tools (skill_id, name, description, is_resident, script_path)
VALUES (
  'remote-llm-skill-id',
  'call_llm',
  '调用远程 LLM API',
  1,  -- is_resident = 1 表示驻留模式
  'index.js'
);
```

## 使用场景

1. **异步 LLM 调用**：专家发起请求后立即返回任务 ID，LLM 响应后自动推送
2. **多模型协作**：一个专家可以调用多个不同的 LLM
3. **后台任务**：长时间运行的 LLM 任务不阻塞主流程

## 错误处理

- API 调用失败会返回错误信息
- 超时默认 120 秒
- 进程异常退出时，主进程会自动重启

## 安全注意事项

1. API 密钥通过参数传递，不存储在技能中
2. 内部 API 使用 IP 白名单或密钥验证
3. 建议在生产环境中使用 HTTPS

## 调试

查看 stderr 输出：

```bash
# 日志会输出到 server.log
# 格式：[timestamp] [remote-llm] message
```

手动测试：

```bash
# 启动技能进程
node data/skills/remote-llm/index.js

# 输入命令（stdin）
echo '{"command":"ping"}' | node data/skills/remote-llm/index.js