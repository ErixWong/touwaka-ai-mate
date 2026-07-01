# App Wildcard Handler 规范

> 约定大于配置：直接映射 handler 文件，无需显式路由声明

> 当前统一约束：所有 app handler 默认必须登录，暂不支持匿名 API。

## 1. 快速入门

### 1.1 创建 Handler

```js
// apps/ocr-tool/server/handlers/analyze.js

export async function get(ctx, deps) {
  const { taskId } = ctx.params;
  const result = await deps.services.query(
    'SELECT * FROM app_ocr_tasks WHERE id = ?',
    [taskId]
  );
  ctx.success(result[0]);
}

export async function post(ctx, deps) {
  const { imageUrl } = ctx.request.body;
  // 调用 AI 服务处理...
  ctx.success({ taskId: 'xxx', status: 'processing' });
}
```

### 1.2 URL 映射规则

```
/api/apps/{appId}/xxx/yyy → apps/{appId}/server/handlers/xxx.js
```

| 请求 | Handler 文件 |
|------|-------------|
| GET /api/apps/ocr-tool/analyze/123 | apps/ocr-tool/server/handlers/analyze.js |
| GET /api/apps/ocr-tool/status | apps/ocr-tool/server/handlers/status.js |
| POST /api/apps/ocr-tool/upload | apps/ocr-tool/server/handlers/upload.js |

---

## 2. Handler 文件规范

### 2.1 文件位置

```
apps/{appId}/server/handlers/{name}.js
```

### 2.2 导出方式

支持两种导出方式：

**方式 A：命名导出（推荐）**
```js
export async function get(ctx, deps) { ... }
export async function post(ctx, deps) { ... }
export async function put(ctx, deps) { ... }
export async function delete(ctx, deps) { ... }
export async function patch(ctx, deps) { ... }
```

**方式 B：默认导出**
```js
export default {
  get: async function(ctx, deps) { ... },
  post: async function(ctx, deps) { ... }
}
```

### 2.3 函数签名

```js
export async function method(ctx, deps) {
  // ctx - Koa 上下文
  // deps - 平台注入的依赖
}
```

### 2.4 当前认证约束

- wildcard 在进入 handler 前统一执行认证
- 所有 app handler 默认要求已登录
- 暂不支持匿名 API
- 若未来确实需要匿名接口，必须先升级平台协议，而不是由单个 app 私自绕过

### 2.5 可选元数据导出（预留）

当前建议为 handler 预留轻量元数据导出，供后续平台能力收敛使用：

```js
export const route = {
  admin_only: false,
  methods: ['GET', 'POST'],
  timeout_ms: 30000,
}
```

当前优先考虑的元数据：

- `admin_only`
- `upload`
- `methods`
- `timeout_ms`

---

## 3. 上下文对象

### 3.1 ctx（Koa Context）

| 属性 | 说明 |
|------|------|
| `ctx.params` | 路径参数，如 `{ p0: '123', p1: 'abc' }` |
| `ctx.query` | Query 参数，如 `{ page: 1, size: 10 }` |
| `ctx.request.body` | POST/PUT 请求体 JSON |
| `ctx.state.session` | 当前登录用户信息 |
| `ctx.state.session.id` | 用户 ID |
| `ctx.state.session.role` | 用户角色 |
| `ctx.state.isAdmin` | 是否管理员 |
| `ctx.success(data)` | 返回成功响应 |
| `ctx.error(message, status)` | 返回错误响应 |

### 3.2 deps（依赖注入）

```js
const deps = {
  db,           // Sequelize 实例
  appId,        // 当前 app ID
  app,          // mini_apps 记录（��含 name, config 等）
  services: {
    query(sql, replacements),    // SQL 查询（SELECT）
    execute(sql, replacements),  // SQL 执行（INSERT/UPDATE/DELETE）
    getModel(modelName),         // 获取 Sequelize Model
    log(level, message, meta),   // 日志：level 为 'info'|'warn'|'error'
  }
}
```

---

## 4. 权限校验

### 4.1 平台已统一认证

handler 默认运行前提：

- 请求已通过认证
- `ctx.state.session` 可用

因此通常不需要再做平台级“是否登录”判断，除非希望自定义报错语义。

### 4.2 在 handler 内校验管理员权限（当前推荐）

```js
export async function post(ctx, deps) {
  // 检查管理员权限
  if (!ctx.state.session.isAdmin) {
    ctx.error('需要管理员权限', 403);
    return;
  }

  // ... 业务逻辑
}
```

### 4.3 获取当前用户信息

```js
export async function get(ctx, deps) {
  const userId = ctx.state.session?.id;
  const userRole = ctx.state.session?.role;
  
  ctx.success({ userId, userRole });
}
```

---

## 5. 平台能力复用

### 5.1 文件上传

**方式 A：调用平台 API**
```js
export async function post(ctx, deps) {
  const formData = new FormData();
  formData.append('file', fileBlob, 'filename.pdf');
  formData.append('source_tag', 'app_ocr');
  formData.append('source_id', ctx.params.taskId);
  
  const response = await fetch('/api/attachments/upload', {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${ctx.state.session?.token || ''}` 
    },
    body: formData
  });
  
  const result = await response.json();
  ctx.success(result);
}
```

**方式 B：直接使用 AttachmentService**
```js
import AttachmentService from '../../../server/services/attachment.service.js';

export async function post(ctx, deps) {
  const attachmentService = new AttachmentService(deps.db);
  
  const attachment = await attachmentService.createFromBuffer({
    sourceTag: 'app_ocr',
    sourceId: ctx.params.taskId,
    createdBy: ctx.state.session?.id,
    fileName: 'image.png',
    mimeType: 'image/png',
    buffer: Buffer.from(ctx.request.body.base64, 'base64'),
  });
  
  ctx.success(attachment);
}
```

### 5.2 SSE / 流式响应

```js
export async function get(ctx, deps) {
  ctx.set('Content-Type', 'text/event-stream');
  ctx.set('Cache-Control', 'no-cache');
  ctx.set('Connection', 'keep-alive');
  
  ctx.body = new ReadableStream({
    start(controller) {
      // 逐块推送数据
      controller.enqueue('data: {"status":"processing"}\n\n');
      setTimeout(() => {
        controller.enqueue('data: {"status":"done"}\n\n');
        controller.close();
      }, 2000);
    }
  });
}
```

### 5.3 调用 LLM

```js
import InternalLLMService from '../../../lib/internal-llm-service.js';

export async function post(ctx, deps) {
  const llmService = new InternalLLMService(deps.db);
  
  const result = await llmService.chat({
    model: 'gpt-4',
    messages: [{ role: 'user', content: ctx.request.body.prompt }]
  });
  
  ctx.success(result);
}
```

### 5.4 常用服务路径汇总

| 服务 | 导入路径 | 用途 |
|------|----------|------|
| LLM (Chat) | `../../../lib/internal-llm-service.js` | 调用大语言模型 |
| Attachment | `../../../server/services/attachment.service.js` | 文件上传/下载 |
| Document OCR | `../../../lib/document-ocr-service.js` | 文档 OCR 识别 |
| Document Embedding | `../../../lib/document-embedding-service.js` | 文档向量化 |
| Document Chunk | `../../../lib/document-chunk-service.js` | 文档分块 |
| Document Clean | `../../../lib/document-clean-service.js` | 文档清洗 |
| Document Outline | `../../../lib/document-outline-service.js` | 文档大纲提取 |
| RAG | `../../../lib/rag-service.js` | RAG 检索增强 |
| Recall | `../../../lib/doc-recall-service.js` | 文档召回 |

---

## 6. 数据库操作

### 6.1 查询数据

```js
export async function get(ctx, deps) {
  // 方式 A：SQL 查询
  const rows = await deps.services.query(
    'SELECT * FROM app_my_table WHERE user_id = ? LIMIT 10',
    [ctx.state.session?.id]
  );
  
  // 方式 B：使用 Model
  const MyTable = deps.services.getModel('app_my_table');
  const rows2 = await MyTable.findAll({
    where: { user_id: ctx.state.session?.id },
    limit: 10
  });
  
  ctx.success(rows);
}
```

### 6.2 写入数据

```js
export async function post(ctx, deps) {
  const result = await deps.services.execute(
    'INSERT INTO app_my_table (id, name, created_at) VALUES (?, ?, NOW())',
    [Utils.newID(), ctx.request.body.name]
  );
  
  ctx.success({ inserted: true });
}
```

---

## 7. 目��结构示例

```
apps/ocr-tool/
├── manifest.json
├── tick/
│   └── index.js
├── server/
│   └── handlers/
│       ├── analyze.js    # POST /api/apps/ocr-tool/analyze
│       ├── status.js     # GET  /api/apps/ocr-tool/status/:p0
│       └── presets.js    # GET  /api/apps/ocr-tool/presets
└── states.js
```

---

## 8. 常见问题

### Q: 如何处理 404？

A: 业务路由下如果没有对应 handler，应由 wildcard 返回 `404`。如果是 handler 内部业务对象不存在，可在 handler 中显式返回 `404`：

```js
export async function get(ctx, deps) {
  const data = await findData(ctx.params.id);
  if (!data) {
    ctx.error('数据不存在', 404);
    return;
  }
  ctx.success(data);
}
```

### Q: 如何返回分页数据？

A: 自行处理分页逻辑：

```js
export async function get(ctx, deps) {
  const page = parseInt(ctx.query.page) || 1;
  const size = parseInt(ctx.query.size) || 20;
  const offset = (page - 1) * size;
  
  const rows = await deps.services.query(
    'SELECT * FROM app_my_table LIMIT ? OFFSET ?',
    [size, offset]
  );
  
  const total = await deps.services.query(
    'SELECT COUNT(*) as count FROM app_my_table'
  );
  
  ctx.success({
    list: rows,
    pagination: {
      page,
      size,
      total: total[0].count
    }
  });
}
```

### Q: 如何获取 app 配置？

A: 通过 `deps.app.config`：

```js
export async function get(ctx, deps) {
  const appConfig = deps.app?.config ? JSON.parse(deps.app.config) : {};
  const apiKey = appConfig.api_key;
  // ...
}
```

---

## 9. 相关文档

- [App 模块架构总纲](./current-architecture.md)
- [App 开发指南](./app-generation-guide.md)
- [WILDCARD-REALIGNMENT 审计报告](../tasks/active/task-20260701-runtime-wildcard-realignment/WILDCARD-REALIGNMENT.md)

---

✌Bazinga！
