# App 专用 API 机制设计

> 创建时间: 2026-05-04
> 状态: 已定稿
> 关联: 合同管理 v2 (#665)

## 问题背景

当前 App（如 contract-mgr-v2）需要独立业务表（组织树、合同主记录、版本），但这些表的数据访问面临架构困境：

| 方案 | 问题 |
|------|------|
| Sequelize 模型 | 破坏 App 自包含，依赖外部 models/*.js，安装需额外步骤 |
| 通用 API（callExtension） | 只能操作扩展表，无法查询独立业务表 |
| 直接 sequelize.query() | 裸 SQL，无路由层，前端无法调用 |

**结论**：需要一种让 App 自带 controller 的机制，通过统一路由动态分发请求。

---

## 设计方案

### 核心思路

```
manifest.json 声明 APIs
        ↓
系统注册一个通用路由 /api/apps/:appId/*
        ↓
运行时匹配 → require() App 的 controller 文件
        ↓
调用对应 HTTP 方法函数（get/post/put/delete）
```

### 路由机制

**一个通用路由捕获所有 App API 请求**：

```javascript
// server/index.js

this.router.all('/api/apps/:appId/*', async (ctx) => {
  const appId = ctx.params.appId;
  const requestPath = ctx.path.replace(`/api/apps/${appId}/`, '');

  // 1. 获取 App 配置
  const app = this.installedApps.get(appId);
  if (!app) return ctx.error('App not found', 404);

  // 2. 从 manifest.apis 匹配
  const api = app.apis?.find(a => matchPath(a.path, requestPath));
  if (!api) return ctx.error('API not found', 404);

  // 3. 检查方法
  if (!api.methods.includes(ctx.method)) return ctx.error('Method not allowed', 405);

  // 4. 动态加载 controller
  const handlerPath = path.join(process.cwd(), 'apps', appId, api.handler);
  const controller = require(handlerPath);
  const fn = controller[ctx.method.toLowerCase()];

  if (!fn) return ctx.error('Handler not implemented', 501);

  // 5. 注入依赖并调用
  await fn(ctx, {
    db: this.db,
    sequelize: this.db.sequelize,
    services: this.services,
    app,
    logger,
  });
});
```

### 为什么不用启动时注册

Koa-router 的 `routes()` 执行后，后续动态添加的路由不会被处理。

通用路由方案的优势：
- ✅ 安装 App 后立即生效，无需重启
- ✅ `require()` 自带缓存，无性能问题
- ✅ 一个路由覆盖所有 App

---

## manifest.json 声明

```json
{
  "apis": [
    {
      "path": "/org-nodes",
      "methods": ["GET", "POST"],
      "handler": "controllers/org-nodes.js"
    },
    {
      "path": "/org-nodes/:id",
      "methods": ["GET", "PUT", "DELETE"],
      "handler": "controllers/org-nodes.js"
    },
    {
      "path": "/contracts",
      "methods": ["GET", "POST"],
      "handler": "controllers/contracts.js"
    },
    {
      "path": "/contracts/:id",
      "methods": ["GET", "PUT", "DELETE"],
      "handler": "controllers/contracts.js"
    },
    {
      "path": "/contracts/:id/versions",
      "methods": ["GET", "POST"],
      "handler": "controllers/versions.js"
    },
    {
      "path": "/dashboard",
      "methods": ["GET"],
      "handler": "controllers/dashboard.js"
    }
  ]
}
```

### 字段说明

| 字段 | 说明 | 示例 |
|------|------|------|
| `path` | 路由路径（支持 `:param`） | `/org-nodes/:id` |
| `methods` | 允许的 HTTP 方法 | `["GET", "POST"]` |
| `handler` | controller 文件路径（相对于 App 根目录） | `controllers/org-nodes.js` |

---

## Controller 文件规范

### 约定式方法映射

```
methods 中的 HTTP 方法 → controller 文件中 export 的函数名

GET    → export async function get(ctx, deps)
POST   → export async function post(ctx, deps)
PUT    → export async function put(ctx, deps)
DELETE → export async function delete(ctx, deps)
```

### 注入依赖（deps）

| 字段 | 类型 | 说明 |
|------|------|------|
| `db` | DB 实例 | getModel()、Sequelize 实例 |
| `sequelize` | Sequelize | 原始 query 接口 |
| `services` | Services | callExtension、callMcp、callLlm |
| `app` | Object | 当前 App 配置 |
| `logger` | Logger | 日志 |

### 示例

```javascript
// apps/contract-mgr-v2/controllers/org-nodes.js

import Utils from '../../../../lib/utils.js';
import { Op } from 'sequelize';

export async function get(ctx, { sequelize }) {
  const { id } = ctx.params;

  if (id) {
    const [nodes] = await sequelize.query(
      'SELECT * FROM contract_v2_org_nodes WHERE id = ? AND is_active = 1',
      { replacements: [id], type: sequelize.QueryTypes.SELECT }
    );
    return ctx.success(nodes);
  }

  const nodes = await sequelize.query(
    'SELECT * FROM contract_v2_org_nodes WHERE is_active = 1 ORDER BY level, sort_order',
    { type: sequelize.QueryTypes.SELECT }
  );
  ctx.success(buildTree(nodes));
}

export async function post(ctx, { sequelize }) {
  const data = ctx.request.body;
  const id = Utils.newID(20);

  await sequelize.query(
    'INSERT INTO contract_v2_org_nodes (id, parent_id, node_type, name, path, level, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    { replacements: [id, data.parent_id || null, data.node_type, data.name, '', 1, 0] }
  );

  ctx.success({ id });
}

export async function put(ctx, { sequelize }) {
  const { id } = ctx.params;
  const data = ctx.request.body;

  await sequelize.query(
    'UPDATE contract_v2_org_nodes SET name = ? WHERE id = ?',
    { replacements: [data.name, id] }
  );

  ctx.success({ id });
}

export async function delete(ctx, { sequelize }) {
  const { id } = ctx.params;

  await sequelize.query(
    'DELETE FROM contract_v2_org_nodes WHERE id = ?',
    { replacements: [id] }
  );

  ctx.success(null, '删除成功');
}

function buildTree(nodes) { /* ... */ }
```

---

## 路径匹配规则

```
manifest path: /org-nodes/:id
请求路径:      /api/apps/contract-mgr-v2/org-nodes/abc123

匹配结果:
  appId = contract-mgr-v2
  requestPath = org-nodes/abc123
  ctx.params.id = abc123
```

### 匹配算法

```javascript
function matchPath(apiPath, requestPath) {
  const apiParts = apiPath.replace(/^\//, '').split('/');
  const reqParts = requestPath.replace(/^\//, '').split('/');

  if (apiParts.length !== reqParts.length) return null;

  const params = {};
  for (let i = 0; i < apiParts.length; i++) {
    if (apiParts[i].startsWith(':')) {
      params[apiParts[i].slice(1)] = reqParts[i];
    } else if (apiParts[i] !== reqParts[i]) {
      return null;
    }
  }

  return params; // 返回提取的 params
}
```

---

## 前端调用

```typescript
// 通用路径：/api/apps/:appId/:apiPath

// 获取组织树
await apiClient.get('/apps/contract-mgr-v2/org-nodes')

// 创建节点
await apiClient.post('/apps/contract-mgr-v2/org-nodes', {
  name: '联想控股',
  node_type: 'group'
})

// 获取合同详情
await apiClient.get('/apps/contract-mgr-v2/contracts/abc123')

// Dashboard
await apiClient.get('/apps/contract-mgr-v2/dashboard')
```

---

## require() 缓存

Node.js 的 `require()` 自带模块缓存：

```javascript
// 第一次
const ctrl = require('./controller.js'); // 解析 + 缓存

// 第二次（同一路径）
const ctrl = require('./controller.js'); // 直接返回缓存，0 开销
```

如需热更新（开发环境），清除缓存：

```javascript
delete require.cache[require.resolve(handlerPath)];
```

---

## 安全约束

1. **路径安全**：handler 路径必须在 `apps/{appId}/` 下，禁止 `../` 跳转
2. **App 激活检查**：只处理 `is_active = 1` 的 App
3. **认证中间件**：通用路由前挂载 `authenticate()`
4. **方法白名单**：只允许 manifest 中声明的方法

```javascript
// 路径安全校验
const handlerPath = path.join(process.cwd(), 'apps', appId, api.handler);
const realPath = fs.realpathSync(handlerPath);
if (!realPath.startsWith(path.join(process.cwd(), 'apps', appId))) {
  return ctx.error('Invalid handler path', 403);
}
```

---

## 与现有架构的关系

```
┌─────────────────────────────────────────────────┐
│                  App 平台层                      │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │ 通用 API         │  │ App 专用 API (新)     │ │
│  │ (现有)           │  │                      │ │
│  │ • mini-app CRUD  │  │ • /api/apps/:id/*    │ │
│  │ • 状态流转       │  │ • 动态路由分发       │ │
│  │ • callExtension  │  │ • App 自带 controller│ │
│  └──────────────────┘  └──────────────────────┘ │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │ 扩展表           │  │ 独立业务表           │ │
│  │ (通用 API 读写)  │  │ (专用 API 读写)      │ │
│  └──────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**互不冲突**：
- 通用 API 继续处理 mini_app_rows 的 CRUD、状态流转、callExtension
- 专用 API 处理 App 自己的业务逻辑（组织树、合同管理、版本管理）
- 两者共享同一个 ctx 和 deps

---

## contract-mgr-v2 迁移计划

### 现有代码 → 新架构

| 文件 | 变更 |
|------|------|
| `server/services/contract-v2.service.js` | → 移入 `apps/contract-mgr-v2/controllers/` |
| `server/controllers/contract-v2.controller.js` | → 废弃，逻辑并入 controller |
| `server/routes/contract-v2.routes.js` | → 废弃，由通用路由替代 |
| `server/index.js` 中的注册代码 | → 删除 |
| `manifest.json` | → 新增 `apis` 字段 |
| `models/contract_v2_*.js` | → 删除，不再依赖模型 |

### 安装流程简化

```
之前: 迁移 → 生成模型 → 写 Service → 写 Controller → 写路由 → 注册到 index.js
之后: 迁移 → 完成
```
