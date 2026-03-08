# 代码审计清单

> **最后更新**: 2026-03-08
> **来源**: `docs/core/SOUL.md` 自我代码审计清单

---

## 使用时机

提交 PR 前，按以下步骤逐项检查。

---

## 第一步：编译与自动化检查

```bash
# 必须首先通过
npm run lint
npm start &
cd frontend && npm run build
```

**检查项**：
- [ ] `npm run lint` 通过（检查 buildPaginatedResponse 参数）
- [ ] 后端启动无报错
- [ ] 前端构建成功

**⚠️ `npm run lint` 必须通过后才能提交 PR！**

---

## 第二步：API 响应格式检查

### ctx.success() 使用

```javascript
// ✅ 正确
ctx.success(data);
ctx.success(buildPaginatedResponse(result, pagination, startTime));

// ❌ 错误
ctx.body = data;
```

### buildPaginatedResponse 参数顺序（关键）

```javascript
// ✅ 正确 - (result, pagination, startTime)
const result = await Model.findAndCountAll({...});
ctx.success(buildPaginatedResponse(result, pagination, startTime));

// ❌ 错误 - 不要解构后传递
const { rows, count } = await Model.findAndCountAll({...});
ctx.success(buildPaginatedResponse(rows, count, pagination));
```

---

## 第三步：代码质量检查

| 关键词 | 检查项 |
|--------|--------|
| **SQL 注入** | 用户输入拼接到 SQL？使用参数化查询 |
| **XSS** | 用户输入渲染到页面？使用 DOMPurify |
| **敏感数据** | 日志是否暴露密钥、token？ |
| **错误处理** | try-catch 覆盖完整？错误提示友好？ |
| **边界条件** | 空值、空数组是否有处理？ |
| **并发安全** | 定时任务重叠执行？共享资源竞态？ |
| **资源泄漏** | 连接/文件/定时器是否正确释放？ |
| **N+1 查询** | 循环中有数据库调用？改用批量查询 |
| **路由顺序** | 动态路由 `/:id` 是否在静态路由之后？ |

---

## 第四步：前后端契约检查

**后端返回**：
```javascript
{ code: 200, data: { items: [...], pagination: {...} } }
```

**前端期望**：
```typescript
interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  pages: number
}
```

**契约变更流程**：
1. 后端变更 → 同步更新前端类型定义
2. 新增字段 → 使用可选字段 `?`
3. 删除字段 → 确认前端无依赖后再删除
4. 重命名字段 → 先新增后删除，保持兼容

---

## 第五步：架构设计审计

| 检查方向 | 思考点 |
|----------|--------|
| **职责边界** | 模块职责是否清晰？是否存在上帝类？ |
| **依赖方向** | 依赖是否单向？是否存在循环依赖？ |
| **扩展性** | 新增功能是否需要大量修改？ |
| **复用性** | 重复代码是否可抽取为公共模块？ |
| **性能瓶颈** | 是否有 O(n²) 或更差的算法？ |
| **可测试性** | 模块是否易于单元测试？ |

---

## 第六步：命名规范检查

| 类型 | 规范 | 示例 |
|------|------|------|
| 数据库字段 | snake_case | `expressive_model_id` |
| 前端组件 | PascalCase | `KnowledgeBaseCard.vue` |
| API 路由 | kebab-case | `/api/kb/:kb_id/articles` |

**Git 提交**：`[T{编号}] {type}: 描述`

---

## 常见问题快速修复

### 分页数据不显示

```bash
# 检查错误模式（应该无结果）
grep -rn "buildPaginatedResponse(rows" server/
grep -rn "buildPaginatedResponse(count" server/
```

**修复**：
```javascript
// ❌ 错误
const { rows, count } = await Model.findAndCountAll({...});
ctx.success(buildPaginatedResponse(rows, count, pagination));

// ✅ 正确
const result = await Model.findAndCountAll({...});
ctx.success(buildPaginatedResponse(result, pagination, startTime));
```

---

## 相关文档

- [编码规范](./coding-standards.md)
- [API 参考](./api-reference.md)
- [SOUL.md](../../core/SOUL.md)
