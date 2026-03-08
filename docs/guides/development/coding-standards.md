# 编码规范

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

## ⚠️ 强制：Utils.newID()

所有数据库主键必须使用 `Utils.newID()` 生成，**禁止**自增 ID：

```javascript
const id = Utils.newID();  // 返回如：ym2zbgr7ocdkkgy3wivj
```

---

## 响应格式

```javascript
ctx.success(data);          // 成功：{ code: 200, message: 'success', data }
ctx.error(message, code);   // 失败
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

---

*最后更新: 2026-03-08*
