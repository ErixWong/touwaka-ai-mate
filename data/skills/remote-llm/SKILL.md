# Remote LLM - 远程 LLM 调用技能

## 概述

这是一个**双层架构技能**，用于让专家调用远程 LLM（如 Claude、Gemini、DeepSeek 等）：

1. **驻留进程** (`index.js`)：跟随系统启动，处理异步 LLM 调用
2. **专家入口** (`submit.js`)：专家调用的入口工具，提交请求后立即返回

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                           专家层                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Tool: remote_llm_submit (专家调用)                      │   │
│  │  - 参数: file, files, prompt (可选)                      │   │
│  │  - model_id/prompt 等从 skill_parameters 读取            │   │
│  │  - 返回: "已放入队列，完成后会通知您"                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Internal API: POST /internal/resident/invoke           │   │
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
│  │  - 查询 ai_models 表获取 API 配置                        │   │
│  │  - 发起远程 LLM 调用                                     │   │
│  │  - 完成后调用 /internal/messages/insert 通知专家         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 技能信息

| 属性 | 值 |
|------|-----|
| 名称 | remote-llm |
| 版本 | 2.1.0 |
| 类型 | 混合（驻留进程 + 普通工具） |
| 依赖 | 无外部依赖（使用 Node.js 内置模块） |

## 参数配置

### skill_parameters 表（环境变量注入）

这些参数在 `skill_parameters` 表中配置，注入为环境变量，专家无需关心：

| 参数名 | 环境变量 | 说明 |
|--------|----------|------|
| model_id | SKILL_MODEL_ID | 目标模型 ID（ai_models 表） |
| prompt | SKILL_PROMPT | 默认 prompt |
| system_prompt | SKILL_SYSTEM_PROMPT | 系统提示（可选） |
| max_tokens | SKILL_MAX_TOKENS | 最大输出 token |
| temperature | SKILL_TEMPERATURE | 温度参数 |

### skill_tools.parameters（专家传入参数）

专家调用时可以传入的参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | string | 否 | 本地图片路径（支持相对 DATA_BASE_PATH 的路径） |
| files | array | 否 | 多个本地图片路径数组 |
| prompt | string | 否 | 额外的提示内容（会追加到默认 prompt 后） |

## 工具列表

### 1. remote_llm_submit - 专家调用入口

专家调用此工具提交异步 LLM 请求。

**调用示例：**

```json
// 简单调用（使用默认配置）
{}

// 处理图片
{
  "file": "work/user123/temp/image.png"
}

// 处理多张图片
{
  "files": ["work/user123/temp/img1.png", "work/user123/temp/img2.jpg"]
}

// 追加额外指令
{
  "file": "work/user123/temp/image.png",
  "prompt": "请详细分析这张图片中的文字内容"
}
```

**返回：**

```json
{
  "success": true,
  "task_id": "task_xxx",
  "message": "已放入队列，待执行完成后会通知您（已附加 1 个图片）",
  "status": "queued"
}
```

### 2. remote-llm-executor - 驻留进程（内部使用）

驻留进程，跟随系统启动，处理实际的 LLM 调用。

**通信协议：**

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
```

## 图片处理

### 支持的图片格式

- PNG (.png)
- JPEG (.jpg, .jpeg)
- GIF (.gif)
- WebP (.webp)

### 图片处理流程

1. 专家传入本地图片路径（相对 DATA_BASE_PATH 或绝对路径）
2. `submit.js` 自动将图片读取并转换为 base64
3. 构建 OpenAI Vision 格式的消息内容
4. 发送给驻留进程处理

### 多模态消息格式

当传入图片时，prompt 会转换为 OpenAI Vision 格式：

```json
[
  { "type": "text", "text": "请把图片中的文字转为文本给我。" },
  { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
]
```

## 数据库配置

### ai_models 表

模型配置存储在 `ai_models` 表中，关联 `providers` 表获取 API 配置：

```sql
SELECT 
  m.id, m.model_name, m.max_output_tokens,
  p.base_url, p.api_key, p.timeout
FROM ai_models m
JOIN providers p ON m.provider_id = p.id
WHERE m.id = ?
```

### skill_tools 表注册

需要注册两个工具：

```sql
-- 驻留进程（is_resident = 1）
INSERT INTO skill_tools (skill_id, name, description, is_resident, script_path)
VALUES (
  'remote-llm',
  'remote-llm-executor',
  '驻留进程：执行远程 LLM 调用',
  1,
  'index.js'
);

-- 专家调用入口（is_resident = 0）
INSERT INTO skill_tools (skill_id, name, description, is_resident, script_path)
VALUES (
  'remote-llm',
  'remote_llm_submit',
  '提交远程 LLM 调用请求',
  0,
  'submit.js'
);
```

## 使用流程

1. **专家调用**：专家调用 `remote_llm_submit` 工具
2. **提交确认**：工具立即返回 "已放入队列"
3. **后台处理**：驻留进程异步执行 LLM 调用
4. **结果通知**：完成后通过内部 API 将结果推送给专家

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| API_BASE | 内部 API 地址 | http://localhost:3000 |
| INTERNAL_KEY | 内部 API 密钥 | 空（使用 IP 白名单） |
| DATA_BASE_PATH | 数据基础路径 | 当前工作目录 |

## 内部 API

### GET /internal/models/:model_id

获取模型配置（含 Provider 信息）。

### POST /internal/resident/invoke

调用驻留式技能工具。

**请求体：**
```json
{
  "skill_id": "remote-llm",
  "tool_name": "remote-llm-executor",
  "params": { ... }
}
```

### POST /internal/messages/insert

插入消息并通知专家（用于结果推送）。

**请求体：**
```json
{
  "user_id": "user_xxx",
  "expert_id": "expert_xxx",
  "content": "消息内容",
  "role": "assistant",
  "trigger_expert": true  // 可选，是否触发专家响应
}
```

**trigger_expert 参数说明：**
- `true`: 插入消息后，自动触发专家进行响应（专家会"看到"这条消息并生成回复）
- `false` 或不传: 仅插入消息，不触发专家响应
- 默认值: `true`（远程 LLM 调用完成后默认触发专家响应）

## 错误处理

- 模型不存在：返回 404 错误
- Provider 未配置：返回错误信息
- API 调用失败：通知专家调用失败
- 超时：默认 120 秒超时

## 安全注意事项

1. 内部 API 仅允许本地调用或使用内部密钥认证
2. API 密钥从数据库获取，不暴露给前端
3. 用户只能使用已配置的模型
4. 文件路径基于 DATA_BASE_PATH，防止路径遍历

## 调试

```bash
# 检查驻留进程状态
curl http://localhost:3000/api/debug/resident-status

# 手动测试驻留进程
echo '{"command":"ping"}' | node data/skills/remote-llm/index.js
```

## 变更历史

- v2.1.0: 简化参数设计，添加本地图片 base64 转换支持
- v2.0.0: 重构为双层架构（驻留进程 + 专家入口）
- v1.0.0: 初始版本