---
name: remote-llm
description: "远程 LLM 调用技能。用于调用远程 LLM（如 Claude、Gemini、DeepSeek 等），支持图片处理。当需要使用其他 LLM 处理任务时触发。"
argument-hint: "remote_llm_submit --file=xxx"
user-invocable: false
allowed-tools: []
---

# Remote LLM - 远程 LLM 调用技能

双层架构技能，用于让专家调用远程 LLM。

## 架构

```
专家 → remote_llm_submit (提交) → 驻留进程 (异步执行) → 结果通知
```

- **驻留进程** (`index.js`)：跟随系统启动，处理异步 LLM 调用
- **专家入口** (`submit.js`)：专家调用的入口工具，提交请求后立即返回

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `remote_llm_submit` | 提交 LLM 请求 | `file`, `files`, `prompt` |
| `remote-llm-executor` | 驻留进程（内部） | - |

## remote_llm_submit

提交异步 LLM 请求。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | string | 否 | 本地图片路径 |
| `files` | array | 否 | 多个本地图片路径数组 |
| `prompt` | string | 否 | 额外提示内容（追加到默认 prompt 后） |

**返回：**

```json
{
  "success": true,
  "task_id": "task_xxx",
  "message": "已放入队列，待执行完成后会通知您",
  "status": "queued"
}
```

## 参数配置

### skill_parameters 表（环境变量注入）

| 参数名 | 环境变量 | 说明 |
|--------|----------|------|
| `model_id` | SKILL_MODEL_ID | 目标模型 ID（ai_models 表） |
| `prompt` | SKILL_PROMPT | 默认 prompt |
| `system_prompt` | SKILL_SYSTEM_PROMPT | 系统提示（可选） |
| `max_tokens` | SKILL_MAX_TOKENS | 最大输出 token |
| `temperature` | SKILL_TEMPERATURE | 温度参数 |

## 图片处理

### 支持的图片格式

- PNG (.png)
- JPEG (.jpg, .jpeg)
- GIF (.gif)
- WebP (.webp)

### 图片处理流程

1. 专家传入本地图片路径
2. `submit.js` 自动将图片读取并转换为 base64
3. 构建 OpenAI Vision 格式的消息内容
4. 发送给驻留进程处理

## 使用流程

1. **专家调用**：专家调用 `remote_llm_submit` 工具
2. **提交确认**：工具立即返回 "已放入队列"
3. **后台处理**：驻留进程异步执行 LLM 调用
4. **结果通知**：完成后通过内部 API 将结果推送给专家

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `API_BASE` | 内部 API 地址 | http://localhost:3000 |
| `INTERNAL_KEY` | 内部 API 密钥 | 空（使用 IP 白名单） |
| `DATA_BASE_PATH` | 数据基础路径 | 当前工作目录 |

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