# 编码规范

> **最后更新**: 2026-03-08
> **维护者**: 开发团队

---

## 🔴 铁律：全栈统一 snake_case

从数据库到前端，所有字段名保持一致，**禁止任何形式的字段名转换**。

```
数据库 (snake_case) → 后端 (snake_case) → API (snake_case) → 前端 (snake_case)
```

| 层级 | 命名格式 | 示例 |
|------|---------|------|
| 数据库列名 | snake_case | `expressive_model_id` |
| API 响应 JSON | snake_case | `{ "expressive_model_id": "..." }` |
| 前端 TypeScript | snake_case | `expert.expressive_model_id` |

**唯一允许的转换**：类型转换（如 BIT → boolean），但字段名不变。

---

## 🔴 铁律：响应格式统一

### 后端响应格式

**必须使用 `ctx.success()` 包装响应数据**：

```javascript
// ✅ 正确 - 使用 ctx.success()
ctx.success({ items: [], total: 0 });
// 返回: { code: 200, message: 'success', data: { items: [], total: 0 } }

// ❌ 错误 - 直接赋值 ctx.body
ctx.body = { items: [], total: 0 };
// 返回: { items: [], total: 0 } - 缺少 data 包装层
```

**原因**：前端 `apiRequest` 期望 `response.data.data` 格式：

```typescript
// frontend/src/api/client.ts
export async function apiRequest<T>(
  request: Promise<{ data: { data: T } }>
): Promise<T> {
  const response = await request;
  return response.data.data;  // 期望 data 包装层
}
```

### 分页响应格式

使用 `buildPaginatedResponse()` 构建分页响应：

```javascript
import { buildPaginatedResponse } from '../../lib/query-builder.js';

// ✅ 正确 - 包装在 ctx.success() 中
ctx.success(buildPaginatedResponse(rows, count, pagination));
// 返回: { code: 200, message: 'success', data: { items: [...], pagination: {...} } }

// ❌ 错误 - 直接赋值 ctx.body
ctx.body = buildPaginatedResponse(rows, count, pagination);
```

**响应结构**：

```javascript
{
  code: 200,
  message: 'success',
  data: {
    items: [...],
    pagination: {
      page: 1,
      size: 10,
      total: 100,
      pages: 10,
      has_next: true,
      has_prev: false
    }
  }
}
```

### 前端处理

```typescript
// 前端 store 中提取 items
const response = await knowledgeBaseApi.getArticles(kbId);
articles.value = response.items || [];  // response 已经是 data 内的对象
```

---

## ⚠️ 强制：Utils.newID()

所有数据库主键必须使用 `Utils.newID()` 生成，**禁止**自增 ID：

```javascript
const id = Utils.newID();  // 返回如：ym2zbgr7ocdkkgy3wivj
const id = Utils.newID(20);  // 指定长度
```

---

## ⚠️ 强制：GET/POST 双请求支持

对于需要支持复杂查询的列表接口，应同时支持 GET 和 POST 请求：

```javascript
// 路由定义
router.get('/:kb_id/articles', authenticate(), controller.queryArticles);
router.post('/:kb_id/articles/query', authenticate(), controller.queryArticles);

// Controller 实现
async queryArticles(ctx) {
  // 支持 GET (ctx.query) 和 POST (ctx.request.body)
  const queryParams = ctx.method === 'GET' ? ctx.query : ctx.request.body;
  const queryRequest = queryParams || {};
  // ...
}
```

---

## 数据库方法

| 方法 | 用途 | 返回值 |
|------|------|--------|
| `query()` | SELECT | 结果数组 |
| `execute()` | UPDATE/DELETE | `{ affectedRows }` |
| `getOne()` | 单条查询 | 对象或 null |

---

## 路由 this 绑定

```javascript
// ✅ 正确
router.get('/', (ctx) => controller.list(ctx));
router.get('/', controller.list.bind(controller));

// ❌ 错误 - this 丢失
router.get('/', controller.list);
```

---

## REST 路由规范

| 操作 | 方法 | URL |
|------|------|-----|
| 列表 | GET | `/api/resources` |
| 详情 | GET | `/api/resources/:id` |
| 创建 | POST | `/api/resources` |
| 更新 | PUT | `/api/resources/:id` |
| 删除 | DELETE | `/api/resources/:id` |
| 复杂查询 | POST | `/api/resources/query` |

---

## 相关文档

- [代码审计清单](./code-review-checklist.md) - 提交 PR 前的检查清单
- [API 参考](./api-reference.md) - API 设计规范
- [核心模块](./core-modules.md) - 后端核心模块说明
