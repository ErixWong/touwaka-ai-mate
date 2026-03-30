# 核心模块

## ChatService

对话服务的主入口，管理专家级别的对话实例。

### 基本使用

```javascript
const chatService = new ChatService(db);
await chatService.initialize();
const expertChat = chatService.getExpertService('eric');
await expertChat.streamChat(topicId, userMessage, (event, data) => {
  // event: 'content' | 'tool_call' | 'done' | 'error'
});
```

### 职责

- 管理多个专家的对话实例
- 协调 LLM 调用、记忆系统和反思心智
- 处理消息存储和流式响应

---

## LLMClient

LLM API 客户端，负责与 AI 模型通信。

### 基本使用

```javascript
const llmClient = new LLMClient(db, expertId);
await llmClient.loadConfig();
const response = await llmClient.callExpressive(messages);
const reflection = await llmClient.callReflective(messages);
```

### 双心智架构

- **表达心智 (Expressive Mind)**：生成面向用户的回复
- **反思心智 (Reflective Mind)**：分析对话、生成内心独白

---

## MemorySystem

用户记忆和对话历史管理。

### 基本使用

```javascript
const memory = new MemorySystem(db, expertId, llmClient);
const profile = await memory.getOrCreateUserProfile(userId);
const messages = await memory.getRecentMessages(userId, 20);
```

### 职责

- 管理用户档案（user_profiles 表）
- 读取和归档对话历史
- 提供上下文给 LLM

⚠️ **注意**：消息存储由 `ChatService` 直接处理，`MemorySystem` 只负责读取和归档。

---

## 认证中间件

### 使用方式

```javascript
const { authenticate, requireAdmin, optionalAuth } = require('./middlewares/auth');

// 需要认证
router.get('/protected', authenticate(), controller);

// 可选认证（有 token 则解析，无 token 也可访问）
router.get('/public', optionalAuth(), controller);

// 需要管理员权限
router.get('/admin', authenticate(), requireAdmin(), controller);
```

⚠️ **注意**：`authenticate` 和 `requireAdmin` 是工厂函数，必须加 `()` 调用。

### 认证流程

1. 从 `Authorization` 头获取 Access Token
2. 验证 Token 有效性
3. 解析用户信息并注入 `ctx.state.user`
4. `requireAdmin` 额外检查 `user.role === 'admin'`

### JWT 双 Token 机制

| Token 类型 | 有效期 | 用途 |
|-----------|--------|------|
| Access Token | 15 分钟 | API 访问 |
| Refresh Token | 7 天 | 刷新 Access Token |

刷新接口：`POST /api/auth/refresh`

---

## ReflectiveMind

反思心智模块，实现双心智架构的反思部分。

### 职责

- 分析用户意图和情感
- 生成专家的内心独白 (inner_voice)
- 提供对话策略建议

---

*最后更新: 2026-02-22*
