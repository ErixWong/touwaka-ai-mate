# AI Provider 统一调用标准

> **最后更新**: 2026-06-14
> **版本**: v2.0 (第二阶段收敛)
> **关联**: `AGENTS.md` / `coding-standards.md` / `code-review-checklist.md`

---

## 1. 背景

项目中的 LLM / Embedding / ASR / TTS 调用已经跨越多个业务模块（聊天、OCR、文档管道、知识库向量化、skills 等）。历史上有多个业务模块自行拼 provider URL、自行查 `ai_model` 裸表、自行构造 HTTP 请求。

经过两阶段收敛后，本项目已建立统一的 AI Provider 能力调用规范。

---

## 2. 统一架构

```
业务模块层（chat / ocr / kb / recall / skills）
         ↓
  能力客户端层（LLMClient / InternalLLMService / EmbeddingClient / ASRClient / TTSClient）
         ↓
  基础设施层（modelRegistry / db.getModelConfig() / normalizeBaseUrl()）
         ↓
  传输执行层（base-llm / fetch）
```

### 基础设施层
| 组件 | 文件 | 职责 |
|------|------|------|
| URL 归一化 | `lib/llm-url-utils.js` | 统一 `normalizeBaseUrl()` 唯一定义源 |
| 模型配置读取 | `lib/db.js` `getModelConfig()` | JOIN provider 获取完整配置 |
| 模型注册表 | `lib/model-registry.js` | 缓存 + 默认模型选择 |

### 能力客户端层
| 能力 | 客户端 | 文件 |
|------|--------|------|
| LLM Chat (Expert) | `LLMClient` | `lib/llm-client.js` |
| LLM Chat (Internal) | `InternalLLMService` | `lib/internal-llm-service.js` |
| Embedding | `EmbeddingClient` | `lib/embedding-client.js` |
| ASR | `ASRClient` | `lib/asr-client.js`（接口骨架） |
| TTS | `TTSClient` | `lib/tts-client.js`（接口骨架） |

---

## 3. 配置来源规则

### 3.1 必须使用完整配置

任何需要发起 AI Provider 请求的代码，**必须**通过以下入口获取完整模型配置：

1. `db.getModelConfig(modelId)` — 含 provider JOIN 的完整配置
2. `modelRegistry.getModelConfig(modelId)` — 带缓存的完整配置
3. `modelRegistry.getDefaultVLModel()` — 默认多模态模型（用于 OCR/VLM 场景）

完整配置至少包含：`model_name`、`base_url`、`api_key`、`timeout`、`provider_name`、`user_agent`

### 3.2 禁止直接读 ai_model

```javascript
// ❌ 禁止 — 直接读 ai_model 裸数据
const model = await AiModel.findByPk(modelId, { raw: true });
callLlm({ model_name: model.model_name, base_url: model.base_url, api_key: model.api_key });

// ✅ 正确 — 通过统一配置来源
const modelConfig = await db.getModelConfig(modelId);
const client = new EmbeddingClient(modelConfig);
```

---

## 4. URL 归一化规则

所有 provider `base_url` 统一通过 `lib/llm-url-utils.js` 的 `normalizeBaseUrl()` 处理：

| 输入 | 输出 |
|------|------|
| `https://api.example.com/v1` | `https://api.example.com/v1` |
| `api.example.com/v1` | `https://api.example.com/v1` |
| `localhost:11434/v1` | `http://localhost:11434/v1` |
| `https://api.example.com/v1/` | `https://api.example.com/v1`（去尾斜杠） |

禁止业务模块自写协议补全或 URL 拼接规则。

---

## 5. 能力边界

### 5.1 LLM Chat

- **LLMClient**: Expert Chat / persona / stream / tools / 多模态聊天
- **InternalLLMService**: 结构化提取 / judge / 内部判断 / `extractJson()` / `generateText()`
- Doc Pipeline judge 通过 `createCallLlmFn()` 统一入口（内部使用 `db.getModelConfig()`）
- `remote-llm` skill 通过内部 API 获取模型配置，不走直连

### 5.2 Embedding

- 统一客户端: `EmbeddingClient`
- 支持三种构造方式:
  - `new EmbeddingClient(modelConfig)` — 直接传 model config
  - `EmbeddingClient.fromModelId(db, modelId)` — 从数据库加载配置
  - `EmbeddingClient.fromEnv()` — 从环境变量加载（仅 doc-recall-service）
- 统一调用接口: `client.embed(text)` 返回 `number[]`

### 5.3 ASR（语音识别）

- 统一客户端: `ASRClient`
- 首版定位：接口骨架 + 设计文档
- 接口方法: `transcribe(audio, options)` / `transcribeStream(audioStream, options)`
- 本轮不要求实现实时 WebSocket ASR

### 5.4 TTS（文本转语音）

- 统一客户端: `TTSClient`
- 首版定位：接口骨架 + 设计文档
- 接口方法: `synthesize(text, options)` / `synthesizeStream(textStream, options)`
- 本轮不要求实现流式 TTS

---

## 6. 默认模型选择规则

### 6.1 文本模型（LLM / Judge）

当无显式 `model_id` 时，通过以下策略选择:

- **InternalLLMService**: 通过 `modelRegistry.getExpertModelConfig(expertId)` 按专家配置
- **Doc Pipeline judge**: `createCallLlmFn()` 自动选择最新创建的激活文本模型（`model_type: 'text', is_active: true, created_at DESC`）

### 6.2 多模态模型（VLM / OCR）

通过 `modelRegistry.getDefaultVLModel()` 统一选择:

- 过滤: `is_active: true, model_type: 'multimodal'`
- 排序: `created_at DESC`
- 返回: 完整 modelConfig（含 provider 信息）

### 6.3 Embedding 模型

由调用方显式传入 `modelId`（如从 `knowledge_basis.embedding_model_id` 读取），通过 `EmbeddingClient.fromModelId(db, modelId)` 创建客户端。

---

## 7. 禁止项

| 禁止行为 | 原因 |
|----------|------|
| 业务代码直接拼 provider URL | 绕过 URL 归一化 + 配置来源统一 |
| 直接读 `ai_model` 表构造 LLM/Embedding 参数 | 缺少 provider.base_url/api_key |
| 自建 `fetch('/embeddings', ...)` 请求 | 绕过 EmbeddingClient |
| 自建 HTTP chat client | 绕过 LLMClient / InternalLLMService |
| 自行实现 `normalizeBaseUrl()` 逻辑 | 规则漂移 |
| 在多处复制相同的默认模型选择逻辑 | 应走 modelRegistry |

---

## 8. 迁移模板

### 旧 Embedding 代码 → EmbeddingClient

```javascript
// ❌ 旧代码
const model = await AiModel.findOne({
  where: { id: modelId },
  include: [{ model: Provider, as: 'provider', attributes: ['base_url', 'api_key'] }],
  raw: true, nest: true,
});
const response = await fetch(model.provider.base_url + '/embeddings', { ... });
const data = await response.json();
const vector = data.data?.[0]?.embedding;

// ✅ 新代码
const client = await EmbeddingClient.fromModelId(db, modelId);
const vector = await client.embed(text);
```

### 旧默认模型选择 → modelRegistry

```javascript
// ❌ 旧代码
const { ai_model } = context.db.getModels();
const model = await ai_model.findOne({
  where: { model_type: 'multimodal', is_active: true },
  order: [['created_at', 'ASC']],
});
modelConfig = await context.db.getModelConfig(model.id);

// ✅ 新代码
modelRegistry.init(context.db);
modelConfig = await modelRegistry.getDefaultVLModel();
```

---

## 9. 审查清单引用

PR 审查时必须检查:

1. 无业务代码直接拼 provider URL
2. 无直接读 `ai_model` 构造 LLM/Embedding 参数
3. URL 归一化复用 `lib/llm-url-utils.js`
4. Embedding 调用走 `EmbeddingClient`
5. 默认模型选择走 `modelRegistry`

详见: `docs/development/code-review-checklist.md` 第八步

---

## 10. 遗留项

| 项目 | 状态 | 计划 |
|------|------|------|
| `remote-llm` skill 自建 HTTP chat client | 待收敛 | 后续评估改为复用统一调用层 |
| ASR 实时 WebSocket | 未实施 | 仅接口骨架就绪 |
| TTS 流式输出 | 未实施 | 仅接口骨架就绪 |
| 历史 app/skill/assistant 全量迁移 | 未实施 | 按模块逐步推进 |

✌Bazinga！
