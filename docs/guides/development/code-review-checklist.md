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

### ⚠️ ES 模块导入验证（重要）

**ESLint 不检查模块导入/导出是否匹配！** 任何涉及 `import`/`export` 的修改都必须验证：

```bash
# 验证模块导入是否正确（替换为实际修改的文件）
node -e "import('./server/services/system-setting.service.js').then(m => console.log('Exports:', Object.keys(m)))"
node -e "import('./lib/skill-loader.js').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

**常见错误**：
```javascript
// ❌ 错误 - 使用命名导入但模块只有默认导出
import { SystemSettingService } from './service.js';
// service.js 只有: export default class SystemSettingService {}

// ✅ 正确 - 添加命名导出
// service.js:
export { SystemSettingService };  // 添加命名导出
export default SystemSettingService;
```

**何时必须验证**：
- 新增或修改 `export` 语句
- 新增或修改 `import` 语句
- 重构模块导出方式
- **即使认为"不涉及启动流程变更"，只要改了 import/export 就必须验证！**

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

## 第七步：i18n 国际化检查

### 翻译键完整性检查

**必须检查项**：
- [ ] 所有 `$t()` 调用的 key 在 locale 文件中存在
- [ ] 新增功能同时更新 `zh-CN.ts` 和 `en-US.ts`
- [ ] 没有硬编码的中文/英文文本

**快速检查命令**：
```bash
# 查找所有 $t() 调用
grep -rn "\$t(" frontend/src/views/ frontend/src/components/

# 检查是否有硬编码中文（排除注释和字符串中的英文）
grep -rn "[一-龥]" frontend/src/views/*.vue frontend/src/components/*.vue
```

**修复示例**：
```typescript
// ❌ 错误 - 硬编码中文
<h1>知识库文章</h1>

// ❌ 错误 - key 不存在
<h1>{{ $t('knowledgeBase.articles') }}</h1>  // 如果 locales 中没有这个 key

// ✅ 正确
<h1>{{ $t('knowledgeBase.articles') }}</h1>
// 同时在 zh-CN.ts 和 en-US.ts 中添加：
// knowledgeBase: { articles: '知识库文章' / 'Knowledge Base Articles' }

---

## 第八步：前端 API 客户端检查

### 使用 apiClient 而非原生 fetch

**必须使用项目统一的 `apiClient`**：
- `apiClient` 自动处理 `access_token` 认证
- `apiClient` 支持 Token 过期自动刷新
- `apiClient` 统一错误处理

```typescript
// ❌ 错误 - 使用原生 fetch 和错误的 token 键名
const token = localStorage.getItem('token')  // 错误键名
const response = await fetch('/api/system/packages', {
  headers: { 'Authorization': `Bearer ${token}` },
})

// ✅ 正确 - 使用项目标准的 apiClient
import apiClient, { apiRequest } from '@/api/client'
const result = await apiRequest<PackageList>(apiClient.get('/system/packages'))
```

**快速检查命令**：
```bash
# 检查是否有直接使用 fetch 调用 API 的代码（应该无结果）
grep -rn "fetch('/api" frontend/src/stores/
grep -rn 'fetch("/api' frontend/src/stores/
```

**Token 存储键名**：
- ✅ 正确：`localStorage.getItem('access_token')`（由 apiClient 自动处理）
- ❌ 错误：`localStorage.getItem('token')`

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
