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

### 2.4 Handler 级元数据导出（可选但推荐）

为了更好的参数映射和平台能力支持，handler 可以导出 `route` 元数据对象：

```js
// 声明具名参数路径（平台将自动提取参数并注入 ctx.params）
export const route = {
  path: '/batches/:batch_id/files/:file_id',  // 具名参数声明
  methods: ['GET', 'POST'],                     // 允许的 HTTP 方法
  upload: {                                     // 上传配置（可选）
    fields: [{ name: 'files', maxCount: 50 }], // multer fields 配置
    // 或 single: 'file'                        // 单文件配置
  },
  admin_only: false,
  timeout_ms: 30000,
}
```

**为什么要声明 `route.path`？**

- 平台会自动从 URL 中提取命名参数并注入 `ctx.params`
- 不再需要手动解析 `ctx.params.p0/p1/...`
- 例如：`path: '/batches/:batch_id/files/:file_id'` + 请求 `/batches/123/files/456`
  → `ctx.params = { batch_id: '123', file_id: '456', p0: '123', p1: '456' }`

**向后兼容：**

- 如果 handler 没有声明 `route.path`，平台仍会注入 `p0/p1/...` 位置参数
- 兼容旧的 `config.multer` 导出形式

- wildcard 在进入 handler 前统一执行认证
- 所有 app handler 默认要求已登录
- 暂不支持匿名 API
- 若未来确实需要匿名接口，必须先升级平台协议，而不是由单个 app 私自绕过

### 2.4 当前认证约束

- wildcard 在进入 handler 前统一执行认证
- 所有 app handler 默认要求已登录
- 暂不支持匿名 API
- 若未来确实需要匿名接口，必须先升级平台协议，而不是由单个 app 私自绕过

### 2.5 Handler 路径匹配规则

**最长匹配优先 + 目录递归：**

Wildcard 使用以下策略解析 handler 文件：

1. **最长匹配优先**：从请求路径的最长前缀向最短尝试匹配 `.js` 文件
2. **目录递归**：如果遇到目录，将后续段视为参数，递归进入目录查找更具体的 handler

**示例：**

| 请求 URL | Handler 文件 | 说明 |
|---------|-------------|------|
| `/contracts/123/versions/from-attachment` | `handlers/contracts/versions-from-attachment.js` | 嵌套 handler 被优先选择 |
| `/batches/123/files/456` | `handlers/batches/files.js` | 目录递归 + 最长匹配 |
| `/reports/123` | `handlers/reports/index.js` | 目录下的 index.js |

**嵌套目录结构：**

```text
apps/my-app/server/handlers/
├── index.js              # GET /api/apps/my-app/
├── batches.js            # GET /api/apps/my-app/batches/:id
├── batches/
│   ├── index.js          # GET /api/apps/my-app/batches/ (列表)
│   └── files.js          # GET /api/apps/my-app/batches/:batch_id/files/:file_id
├── reports/
│   ├── index.js          # GET /api/apps/my-app/reports/:batch_id
│   └── export.js         # POST /api/apps/my-app/reports/:batch_id/export
└── analysis/
    └── run.js            # POST /api/apps/my-app/analysis/run
```

### 2.6 可选元数据导出（预留）

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
| `ctx.params` | 路径参数，包含：<br>- **具名参数**：来自 handler 的 `route.path` 声明，如 `{ batch_id: '123', file_id: '456' }`<br>- **位置参数**：始终可用的 `p0/p1/...`，如 `{ p0: '123', p1: '456' }` |
| `ctx.params._` | 剩余路径（如果有未匹配的段） |
| `ctx.query` | Query 参数，如 `{ page: 1, size: 10 }` |
| `ctx.request.body` | POST/PUT 请求体 JSON |
| `ctx.files` / `ctx.request.files` | 上传的文件（如果有 handler 声明了 `route.upload`） |
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

Wildcard 原生支持 handler 级上传声明。推荐方式：

**声明式配置（推荐）：**
```js
export const route = {
  path: '/uploads',
  upload: {
    fields: [{ name: 'files', maxCount: 50 }],  // 多文件
    // 或 single: 'file'                         // 单文件
  },
};

export async function post(ctx, deps) {
  // ctx.files.files - 多文件上传
  const files = ctx.files?.files || ctx.request.files?.files;
  // ...
}
```

**旧式配置（兼容）：**
```js
const upload = multer({ storage: multer.memoryStorage() });
export const config = { multer: upload };
```

**平台上传能力：**

- Wildcard 在调用 handler 前自动解析 multipart/form-data
- 解析后的文件对象放入 `ctx.files` 或 `ctx.request.files`
- 支持单文件 (`ctx.file`) 和多文件 (`ctx.files`) 场景
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

## 7. 目录结构示例

### 简单 App（ocr-tool）

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

### 复杂 App（带嵌套路由）

```
apps/current-feature-analyzer/
├── server/
│   └── handlers/
│       ├── uploads.js           # POST /api/apps/current-feature-analyzer/uploads
│       ├── batches.js           # GET  /api/apps/current-feature-analyzer/batches/:batch_id
│       ├── batches/
│       │   ├── index.js         # GET  /api/apps/current-feature-analyzer/batches/
│       │   └── files.js         # GET  /api/apps/current-feature-analyzer/batches/:batch_id/files/:file_id
│       ├── analysis/
│       │   └── run.js           # POST /api/apps/current-feature-analyzer/analysis/run
│       ├── reports/
│       │   ├── index.js         # GET  /api/apps/current-feature-analyzer/reports/:batch_id
│       │   └── export.js        # POST /api/apps/current-feature-analyzer/reports/:batch_id/export
│       ├── rule-sets.js         # CRUD /api/apps/current-feature-analyzer/rule-sets/:id
│       └── config.js            # GET/PUT /api/apps/current-feature-analyzer/config
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
