# AI / LLM 架构方针

> 最后更新：2026-06-15  
> 关联：`AGENTS.md` / `docs/SOUL.md` / `docs/development/llm-call-standards.md`

---

## 1. 文档目的

本文档用于给后续开发提供一份更偏“系统设计与落地边界”的统一方针，重点回答三个问题：

1. 新功能接入 AI 能力时，应该走哪一层。
2. `ChatService`、`LLMClient`、`InternalLLMService` 等现有组件分别负责什么。
3. 什么情况下应该复用现有能力，什么情况下才允许新增调用入口。

这份文档不替代 `docs/development/llm-call-standards.md`。后者更偏调用标准与禁止项，本文更偏架构视角和工程决策入口。

---

## 2. 总体原则

### 2.1 业务层不直接碰 Provider

任何业务模块，无论是聊天、OCR、文档管道、知识库、召回还是技能系统，都不应直接：

1. 拼 provider URL
2. 直接读 `ai_model` 裸表
3. 自建 chat / embedding / asr / tts HTTP 请求

统一要求：

1. 通过能力客户端层发起请求
2. 通过 `db.getModelConfig()` 或 `modelRegistry` 获取完整模型配置
3. 通过 `normalizeBaseUrl()` 处理 provider `base_url`

### 2.2 优先复用现有能力分层

新增功能优先复用已有层次，而不是新增“类似但不完全一样”的调用入口：

1. 用户对话、流式回复、工具调用、多轮推理：优先走 `ChatService` + `LLMClient`
2. 内部判断、结构化提取、轻量文本生成：优先走 `InternalLLMService`
3. 文档管道中的 Judge/标准化场景：优先在文档管线服务内部直接复用统一 `messages` 级调用层
4. 向量化：优先走 `EmbeddingClient`
5. ASR / TTS：优先走 `ASRClient` / `TTSClient`

只有当现有分层无法表达新需求，才考虑新增能力层入口。

### 2.3 timeout 只在 I/O 层生效

AI 相关调用必须遵循当前项目已经收敛出的 timeout 原则：

1. 业务阶段本身不包总 timeout
2. 真正的 timeout 只存在于 I/O 调用层
3. timeout 默认值来自系统设置
4. 如有 stage override，只是覆盖 request timeout 的最终值

因此，新功能不能再引入：

1. service 层 `Promise.race()` 外包 timeout
2. 无法真正 abort 底层请求的伪 timeout

---

## 3. 架构分层图

```text
业务模块层
  ├─ Chat / Topic / Expert 对话
  ├─ OCR / 文档处理 / Doc Pipeline
  ├─ Knowledge Base / Recall / Embedding
  └─ Skills / Assistant / 其他 AI 业务
           ↓
业务语义层
  ├─ ChatService
  ├─ LLMClient
  ├─ InternalLLMService
  ├─ EmbeddingClient
  ├─ ASRClient
  └─ TTSClient
           ↓
统一 messages 调用层
  └─ message-llm-client
           ↓
配置与模型基础设施层
  ├─ db.getModelConfig()
  ├─ modelRegistry
  ├─ normalizeBaseUrl()
  └─ SystemSettingService
           ↓
传输执行层
  ├─ base-llm.js
  ├─ fetch / AbortController
  └─ provider 对应 HTTP 请求
```

---

## 4. 核心组件职责

## 4.1 `ChatService`

文件：`lib/chat-service.js`

定位：**面向用户对话的应用层总编排器**。

它负责：

1. 组织用户对话生命周期
2. 管理 topic / message / task 上下文
3. 准备对话上下文与工具调用环境
4. 调度 `ExpertChatService` / `LLMClient` 做实际对话调用
5. 管理流式响应、多轮工具调用、payload 缓存等

它不应负责：

1. 直接拼 provider 请求
2. 直接实现底层 HTTP chat client
3. 承担内部 judge / 结构化抽取职责

适用场景：

1. Expert 对话
2. 流式聊天
3. 带 tool calling 的用户侧交互

## 4.2 `LLMClient`

文件：`lib/llm-client.js`

定位：**专家聊天能力客户端**。

它负责：

1. 基于 Expert 配置选择 expressive / reflective mind 模型
2. 将调用统一下沉到 `base-llm.js`
3. 处理流式与非流式 chat 调用
4. 管理活跃请求，支持中止请求
5. 应用专家级别的 temperature / top_p / penalties 等参数

适用场景：

1. 面向 Expert 的聊天回复
2. reflective mind / expressive mind 双心智调用
3. 对话过程中的工具调用编排入口

不适合场景：

1. 轻量 judge
2. 内部结构化抽取
3. 文档流水线内部标准化调用

## 4.3 `InternalLLMService`

文件：`lib/internal-llm-service.js`

定位：**内部轻量 LLM 能力客户端**。

它负责：

1. `extractJson()`：结构化抽取
2. `generateText()`：轻量内部文本生成
3. 从系统设置读取 `timeout.internal_llm`
4. 通过 `modelRegistry` 获取默认模型或专家模型
5. 统一处理内部 LLM 的 timeout / retry / schema 校验边界

适用场景：

1. 内部判断
2. 配置解析
3. 小型结构化生成
4. 非用户可见的内部辅助 AI 流程

不适合场景：

1. 用户对话主链路
2. 需要 tool calling 的大对话编排

## 4.4 `message-llm-client`

文件：`lib/message-llm-client.js`

定位：**统一 `messages` 级调用实现**。

它负责：

1. 统一非流式 / 流式 `messages` 调用
2. 统一接入 `llm-thinking-config.js`，收敛 `openai` / `glm` / `qwen` / `deepseek` 差异
3. 统一处理 `thinking_policy`、`thinking`、`reasoning`、`reasoning_effort`、`chat_template_kwargs`
4. 作为 `LLMClient`、`InternalLLMService`、Doc Pipeline 服务共用的底层消息调用层

它不是业务语义入口，不直接承载：

1. Expert 对话编排
2. Topic / message 生命周期
3. 结构化提取高层 API
4. 文档管线业务流程

## 4.5 `EmbeddingClient`

文件：`lib/embedding-client.js`

定位：**统一向量化客户端**。

它负责：

1. 调 embedding provider
2. 统一处理 `base_url`、`api_key`、`model_name`
3. 支持 `timeout.embedding`
4. 使用 `AbortController` 在 timeout 时真实中断请求

适用场景：

1. 文档向量化
2. 知识库段落 embedding
3. recall / retrieve 前的 query embedding

## 4.6 `ASRClient` / `TTSClient`

文件：

1. `lib/asr-client.js`
2. `lib/tts-client.js`

定位：**接口骨架 / 未来统一入口**。

当前状态：

1. 已定义能力边界
2. 尚非完整生产实现

要求：

1. 后续若落地 ASR/TTS 能力，应继续沿用这两个客户端作为统一入口
2. 禁止业务代码绕开它们直接连 provider

---

## 5. 配置与模型来源规则

### 5.1 一律使用完整模型配置

统一来源：

1. `db.getModelConfig(modelId)`
2. `modelRegistry.getModelConfig(modelId)`
3. `modelRegistry.getDefaultVLModel()`
4. `modelRegistry.getExpertModelConfig(expertId)`

禁止：

1. `AiModel.findByPk()` 后手工拼 provider 信息
2. 直接从裸 `ai_model` 行构造请求参数

### 5.2 系统级 timeout 来源

当前约定的 I/O 层 timeout 分类：

1. `timeout.internal_llm`
2. `timeout.external_http`
3. `timeout.mcp_request`
4. `timeout.embedding`
5. `timeout.chat_idle`（前端 UI）

新增功能应复用这些分类，而不是再次引入新的泛化 `timeout_ms`。

### 5.3 URL 归一化

所有 provider `base_url` 统一通过：

`lib/llm-url-utils.js -> normalizeBaseUrl()`

禁止重复实现协议补全或尾斜杠处理规则。

---

## 6. 新功能接入决策树

新增 AI 功能时，优先按以下顺序判断：

### 6.1 这是用户对话能力吗？

如果是：

1. 优先接入 `ChatService`
2. 由 `ChatService` 编排 `LLMClient`

### 6.2 这是内部轻量判断/结构化抽取吗？

如果是：

1. 优先走 `InternalLLMService`

### 6.3 这是文档管道内部步骤吗？

如果是：

1. 优先在现有 `DocumentOcrService` / `DocumentOutlineService` / `DocumentCleanService` 流程上补 handler
2. LLM 调用统一复用 `message-llm-client`
3. 不再新增独立的 Doc Pipeline LLM 入口函数

### 6.4 这是向量化吗？

如果是：

1. 一律走 `EmbeddingClient`

### 6.5 这是语音识别或语音合成吗？

如果是：

1. 预留统一走 `ASRClient` / `TTSClient`

---

## 7. 典型模式

### 7.1 用户聊天主链路

```text
Controller
  -> ChatService
    -> ExpertChatService / ConversationOrchestrator
      -> LLMClient
        -> base-llm.call() / callStream()
```

### 7.2 内部结构化抽取

```text
业务模块
  -> InternalLLMService.extractJson()
    -> modelRegistry / getModelConfig
      -> message-llm-client.invokeWithRetry()
        -> base-llm.callWithRetry()
```

### 7.3 文档管道 Judge

```text
DocumentOcrService / DocumentOutlineService
  -> db.getModelConfig()
    -> message-llm-client.invokeWithRetry()
      -> base-llm.callWithRetry()
```

### 7.4 向量化

```text
embedding-worker / recall-service
  -> EmbeddingClient
    -> fetch(/embeddings)
```

---

## 8. 明确禁止项

新增功能开发时，以下做法仍然禁止：

1. 业务层直接 `fetch(provider + '/chat/completions')`
2. 业务层直接 `fetch(provider + '/embeddings')`
3. 直接读取 `ai_model` 裸表拼 provider 配置
4. service 层再包一个不可取消 `Promise.race()` timeout
5. 新建一个与 `InternalLLMService` / `EmbeddingClient` 职责重复的私有客户端

---

## 9. 推荐落地方式

当以后开发新功能时，推荐按下面顺序决策：

1. 先看是否已有能力客户端可复用。
2. 再看模型配置是否能通过 `modelRegistry` / `db.getModelConfig()` 获取。
3. 再看 timeout 是否能复用既有分类。
4. 最后才考虑新增独立入口。

如果新增功能跨越多个业务模块，优先补本文档和 `llm-call-standards.md`，再动代码。

---

## 10. 与现有文档关系

1. `AGENTS.md`
   - 项目级红线和执行入口
2. `docs/SOUL.md`
   - 角色、人设、协作入口
3. `docs/development/llm-call-standards.md`
   - 统一调用标准、禁止项、迁移模板
4. **本文档**
   - 面向后续开发的架构决策入口与组件职责地图

✌Bazinga！
