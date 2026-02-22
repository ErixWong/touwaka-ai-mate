# 编码规范

## 🔴 铁律：全栈统一使用 snake_case 字段名

**这是不可违反的铁律，没有任何例外！**

从数据库到后端到前端，所有字段名必须保持一致，使用数据库的 snake_case 命名，**禁止任何形式的字段名转换**。

```
数据库 (snake_case) → 后端 (snake_case) → API (snake_case) → 前端 (snake_case)
```

### 为什么这是铁律？

1. 字段名转换是 bug 的温床（如 `expressive_model` vs `expressive_model_id` 的问题）
2. 增加心智负担，开发者需要记住两套名称
3. 代码搜索和维护困难
4. 没有任何实际收益，只是"看起来像 JavaScript 风格"

### 命名规范

| 层级 | 命名格式 | 示例 |
|------|---------|------|
| 数据库列名 | snake_case | `expressive_model_id` |
| SQL 查询结果 | snake_case | `row.expressive_model_id` |
| API 响应 JSON | snake_case | `{ "expressive_model_id": "..." }` |
| 前端 TypeScript | snake_case | `expert.expressive_model_id` |

### 正确示例

```javascript
// ✅ 正确 - 全栈统一
// 数据库: expressive_model_id VARCHAR(32)
// 后端: const modelId = expert.expressive_model_id
// API: { "expressive_model_id": "mls393gx4l140xr2yvju" }
// 前端: const modelId = expert.expressive_model_id
```

### 错误示例

```javascript
// ❌ 错误 - 禁止转换
// 后端 Controller 做转换:
// expressiveModelId: e.expressive_model_id  // 禁止！

// 前端 TypeScript 使用驼峰:
// interface Expert { expressiveModelId: string }  // 禁止！
```

### 唯一允许的转换

- `is_active` 等布尔字段从 MySQL BIT 转换为 JavaScript boolean（但字段名保持不变）
- JSON 字符串解析为对象（如 `core_values: JSON.parse(row.core_values)`）

```javascript
// ✅ 允许的类型转换，但字段名不变
const expert = {
  ...row,
  is_active: row.is_active === 1,  // BIT → boolean
  core_values: JSON.parse(row.core_values || '[]'),  // JSON string → array
};
```

---

## ⚠️ 强制：Utils.newID()

所有数据库记录主键必须使用 `Utils.newID()` 生成，**禁止**使用自增 ID：

```javascript
const Utils = require('../lib/utils');
const id = Utils.newID();  // 返回如：ym2zbgr7ocdkkgy3wivj
```

---

## 数据库方法

| 方法 | 用途 | 返回值 |
|------|------|--------|
| `query()` | SELECT | 结果数组 |
| `execute()` | UPDATE/DELETE | `{ affectedRows }` |
| `getOne()` | 单条查询 | 对象或 null |

---

## 响应格式

```javascript
ctx.success(data);          // 成功
ctx.error(message, code);   // 失败
```

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

---

## Git 提交规范

```
type: description
```

示例：
- `feat: 添加文档管理功能`
- `fix: 修复话题切换时的消息丢失问题`
- `refactor: 重构 ChatService`

---

*最后更新: 2026-02-22*
