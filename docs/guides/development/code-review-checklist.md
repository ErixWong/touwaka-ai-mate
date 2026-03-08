# 代码审计清单

> **最后更新**: 2026-03-08
> **来源**: `docs/core/SOUL.md` 自我代码审计清单

---

## 使用时机

提交 PR 前，按以下步骤逐项检查。

---

## 第一步：编译检查

```bash
# 后端检查（ESLint + 启动验证）
npm run lint
npm start &

# 前端检查（TypeScript 编译 + 构建）
cd frontend
npm run build
```

**必须确保前后端都能正常编译通过！**

---

## 第二步：API 响应格式检查

### ctx.success() 使用检查

**所有 Controller 方法必须使用 `ctx.success()` 包装响应**：

```javascript
// ✅ 正确
ctx.success(data);
ctx.success(buildPaginatedResponse(rows, count, pagination));

// ❌ 错误 - 直接赋值 ctx.body
ctx.body = data;
ctx.body = { success: true };
```

**检查命令**：

```bash
# 查找所有 ctx.body = 赋值（应该没有或极少）
grep -rn "ctx.body\s*=" server/controllers/
```

### 分页响应格式检查

```javascript
// ✅ 正确 - 返回 { items, pagination }
ctx.success(buildPaginatedResponse(rows, count, pagination));

// 前端提取
const response = await api.getArticles(kbId);
articles.value = response.items || [];
```

---

## 第三步：代码质量检查

| 关键词 | 检查项 |
|--------|--------|
| **SQL 注入** | 用户输入拼接到 SQL？使用参数化查询或验证输入 |
| **XSS** | 用户输入渲染到页面？使用转义或 DOMPurify |
| **敏感数据** | 日志/错误信息是否暴露密钥、token？ |
| **错误处理** | try-catch 覆盖完整？错误是否有友好提示？ |
| **边界条件** | 空值、空数组、超长字符串是否有处理？ |
| **并发安全** | 定时任务重叠执行？共享资源竞态？加锁/标志位 |
| **资源泄漏** | 连接/文件/定时器是否正确释放？ |
| **N+1 查询** | 循环中有数据库调用？改用批量查询 |
| **API 限流** | 批量调用外部 API 是否有延迟？避免触发限流 |
| **幂等性** | 重复执行是否产生副作用？迁移脚本用 `IF NOT EXISTS` |
| **路由顺序** | 动态参数路由（如 `/:id`）是否在静态路由之后？避免路由冲突 |

---

## 第四步：架构设计审计

> 发现设计问题或升级建议，创建 Issue 并标记 `architecture` 标签

| 检查方向 | 思考点 |
|----------|--------|
| **职责边界** | 模块职责是否清晰？是否存在上帝类/大杂烩？ |
| **依赖方向** | 依赖是否单向？是否存在循环依赖？ |
| **扩展性** | 新增功能是否需要大量修改？考虑插件化/策略模式 |
| **复用性** | 重复代码是否可抽取为公共模块？ |
| **性能瓶颈** | 是否有 O(n²) 或更差的算法？大数据量场景如何？ |
| **可测试性** | 模块是否易于单元测试？依赖是否可 mock？ |
| **未来升级** | 当前设计是否为未来需求留有余地？是否过度设计？ |

---

## 第五步：命名规范检查

### 字段命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 数据库字段 | snake_case | `expressive_model_id` |
| 前端组件 | PascalCase | `KnowledgeBaseCard.vue` |
| API 路由 | kebab-case | `/api/kb/:kb_id/articles` |

### Git 提交规范

格式：`[T{编号}] {type}: 描述`

类型：`feat` | `fix` | `refactor` | `docs` | `test` | `chore`

示例：
```
[T123] feat: 添加知识库文章导入功能
[T124] fix: 修复 API 响应格式不一致问题
```

---

## 常见问题快速检查表

### 问题：前端报错 "Cannot read properties of undefined"

**可能原因**：
1. 后端使用 `ctx.body = ...` 而非 `ctx.success()`
2. 前端期望 `response.items` 但后端返回格式不同

**检查**：
```bash
# 检查后端响应格式
grep -rn "ctx.body\s*=" server/controllers/

# 检查前端期望
grep -rn "response.items\|response.data" frontend/src/
```

### 问题：API 返回 403 "无效的令牌"

**可能原因**：
1. Token 过期或无效
2. 认证中间件捕获了下游错误

**检查**：
1. 确认 Token 有效
2. 检查 `server/middlewares/auth.js` 的 try-catch 是否正确

---

## 相关文档

- [编码规范](./coding-standards.md) - 代码风格和格式规范
- [API 参考](./api-reference.md) - API 设计规范
- [SOUL.md](../../core/SOUL.md) - 开发助手人设与工作规范