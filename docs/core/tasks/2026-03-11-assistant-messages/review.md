# Code Review: Assistant Messages 内部消息链路

> **审查日期**: 2026-03-11
> **审查人**: Claude Code
> **任务**: #87 助理系统内部通信
> **审查标准**: [code-review-checklist.md](../../guides/development/code-review-checklist.md)

---

## 第一步：编译与自动化检查

### ✅ 通过

```bash
$ npm run lint
🔍 检查 buildPaginatedResponse 调用...
✅ 所有 buildPaginatedResponse 调用都正确！

$ cd frontend && npm run build
✓ built in 1.29s
```

- [x] `npm run lint` 通过
- [x] 数据库迁移成功
- [x] 前端构建成功

---

## 第二步：API 响应格式检查

### ✅ 通过

所有新增 API 端点正确使用 `ctx.success()` 和 `ctx.error()`:

```javascript
// server/controllers/assistant.controller.js
ctx.success(assistants);                    // line 23 - 列出助理
ctx.success(result);                        // line 107 - 召唤助理
ctx.success(result);                        // line 128 - 查询委托状态
ctx.success(requests);                      // line 155 - 查询委托列表
ctx.success({ request_id, messages });      // line 182 - 查询委托消息
ctx.error('缺少 assistant_type 参数', 400); // line 57 - 参数验证
ctx.error('缺少 input 参数', 400);          // line 62 - 参数验证
ctx.error('缺少 request_id 参数', 400);     // line 123, 175 - 参数验证
```

**注意**: 本次新增的 `getMessages` 接口不需要分页，因此不使用 `buildPaginatedResponse`。

---

## 第三步：代码质量检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| SQL 注入 | ✅ | 使用 Sequelize ORM，参数化查询 |
| XSS | ✅ | 内容存储为纯文本，前端 Vue 自动转义 |
| 敏感数据 | ✅ | api_key 仅用于 LLM 调用，不记录日志 |
| 错误处理 | ✅ | 完整的 try-catch，错误信息友好 |
| 边界条件 | ✅ | 空值检查、sequence_no 自增处理 |
| 并发安全 | ✅ | 消息按 sequence_no 顺序写入 |
| 资源泄漏 | ✅ | 无连接/文件/定时器泄漏风险 |
| N+1 查询 | ✅ | 消息查询为单次批量查询，无循环内数据库调用 |
| 路由顺序 | ✅ | 静态路由在动态路由之前 |

### 敏感数据日志检查

```javascript
// ✅ 正确 - api_key 不记录日志
logger.info(`[AssistantManager] LLM 调用:`, {
  model: model.model_name,
  url: `${requestOptions.hostname}${requestOptions.path}`,
  messages_count: messages.length,
  tools_count: options.tools?.length || 0,
});
```

### 路由顺序检查

```javascript
// ✅ 正确 - 静态路由在前，动态路由在后
router.get('/requests', controller.listRequests.bind(controller));           // 静态
router.get('/requests/:request_id/messages', controller.getMessages.bind(controller)); // 动态
router.get('/requests/:request_id', controller.getRequest.bind(controller)); // 动态
```

---

## 第四步：前后端契约检查

### ✅ 通过

**新增 API**: `GET /api/assistants/requests/:request_id/messages`

**Query 参数**:
- `debug` (可选): `true` / `false` - 是否返回完整内容

**后端响应**:

```typescript
// 普通模式 (debug=false)
{
  code: 200,
  data: {
    request_id: string,
    messages: AssistantMessagePreview[]
  }
}

// 调试模式 (debug=true)
{
  code: 200,
  data: {
    request_id: string,
    messages: AssistantMessageDebug[]
  }
}
```

**消息字段**:

| 字段 | 类型 | 普通模式 | 调试模式 |
|------|------|:--------:|:--------:|
| id | number | ✅ | ✅ |
| request_id | string | ✅ | ✅ |
| role | enum | ✅ | ✅ |
| message_type | enum | ✅ | ✅ |
| content_preview | string | ✅ | ❌ |
| content | string | ❌ | ✅ |
| tool_name | string | ✅ | ✅ |
| tool_call_id | string | ✅ | ✅ |
| status | enum | ✅ | ✅ |
| sequence_no | number | ✅ | ✅ |
| metadata | object | ❌ | ✅ |
| tokens_input | number | ❌ | ✅ |
| tokens_output | number | ❌ | ✅ |
| latency_ms | number | ❌ | ✅ |
| created_at | datetime | ✅ | ✅ |

---

## 第五步：架构设计审计

### ✅ 设计合理

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 职责边界 | ✅ | `AssistantMessageService` 专注消息 CRUD，`AssistantManager` 负责业务流程 |
| 依赖方向 | ✅ | 单向依赖，无循环依赖 |
| 扩展性 | ✅ | 支持新增消息类型、metadata 扩展字段 |
| 复用性 | ✅ | Service 提供通用便捷方法，可复用 |
| 性能 | ✅ | 消息按需查询，支持分页扩展 |
| 可测试性 | ✅ | Service 方法独立，易于单元测试 |

### 依赖关系图

```
assistant.controller.js
         │
         ▼
assistant-manager.js
         │
         ├──► assistant-message-service.js
         │           │
         │           ▼
         │      logger.js
         │
         └──► tool-manager.js (动态导入)
```

**无循环依赖** ✅

### 消息写入时机

| 时机 | 消息类型 | role | 触发位置 |
|------|----------|------|----------|
| 召唤时 | task | expert | `summon()` |
| 开始执行 | status | system | `executeRequest()` |
| 工具调用 | tool_call | tool | `executeDirect()` / `executeLLMWithTools()` |
| 工具返回 | tool_result | tool | 同上 |
| 完成 | final | assistant | `executeRequest()` |
| 错误 | error | system | `executeRequest()` |

---

## 第六步：命名规范检查

### ✅ 通过

| 类型 | 规范 | 示例 | 状态 |
|------|------|------|:----:|
| 数据库表名 | snake_case | `assistant_messages` | ✅ |
| 数据库字段 | snake_case | `request_id`, `message_type`, `content_preview` | ✅ |
| API 路由 | RESTful | `GET /requests/:request_id/messages` | ✅ |
| 服务类 | PascalCase | `AssistantMessageService` | ✅ |
| 方法名 | camelCase | `appendTaskMessage`, `getMessagesByRequestId` | ✅ |
| 文件名 | kebab-case | `assistant-message-service.js` | ✅ |

---

## 第七步：i18n 国际化检查

### ✅ 不适用

本次修改为后端 API 和数据模型，不涉及前端 UI 文本。

---

## 第八步：前端 API 客户端检查

### ✅ 待实现

检查现有前端代码是否使用标准 `apiClient`:

```bash
$ grep -rn "fetch('/api" frontend/src/stores/
# 无结果 - 正确
```

本次仅实现后端功能，前端接入时需添加:

```typescript
// frontend/src/api/services.ts (待添加)
getAssistantMessages: (requestId: string, debug = false) =>
  apiRequest<{ request_id: string; messages: AssistantMessage[] }>(
    apiClient.get(`/assistants/requests/${requestId}/messages`, {
      params: { debug }
    })
  ),
```

---

## 变更文件清单

| 文件 | 类型 | 修改内容 |
|------|------|----------|
| `scripts/migrate-add-assistant-messages.js` | 新增 | 数据库迁移脚本 |
| `models/assistant_message.js` | 新增 | Sequelize 模型定义 |
| `models/init-models.js` | 修改 | 注册新模型、添加关联关系 |
| `server/services/assistant-message-service.js` | 新增 | 消息服务层 |
| `server/services/assistant-manager.js` | 修改 | 集成消息记录、新增 `getMessages()` |
| `server/controllers/assistant.controller.js` | 修改 | 新增 `getMessages()` 控制器方法 |
| `server/routes/assistant.routes.js` | 修改 | 新增 `GET /requests/:id/messages` 路由 |

---

## 审查结论

**✅ 代码审查通过** - 所有检查项通过

### 亮点

1. **完整的消息追踪** - 6 种消息类型覆盖完整的执行生命周期
2. **分层展示设计** - 普通模式返回摘要，调试模式返回完整内容
3. **服务层抽象** - `AssistantMessageService` 提供清晰的便捷方法
4. **最小侵入性** - 消息写入逻辑不影响原有业务流程
5. **sequence_no 自增** - 保证消息顺序，支持时间线展示
6. **正确的路由顺序** - 静态路由在动态路由之前
7. **无敏感数据泄漏** - api_key 不记录到日志

### 待办事项

| 优先级 | 任务 | 说明 |
|--------|------|------|
| 高 | 前端详情面板接入 | 在 `AssistantRequestCard` 中展示消息时间线 |
| 中 | 前端类型定义 | 添加 `AssistantMessage` 类型到 `types/index.ts` |
| 低 | 前端 API 服务 | 添加 `getAssistantMessages` 到 `api/services.ts` |

---

*审查完成时间: 2026-03-11*