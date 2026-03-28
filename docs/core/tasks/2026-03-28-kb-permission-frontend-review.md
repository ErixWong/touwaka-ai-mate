# KB Permission Frontend Code Review

> **审计时间**: 2026-03-28
> **审计范围**: 前端代码变更（`frontend/src/views/KnowledgeBaseView.vue`, `frontend/src/types/index.ts`, `frontend/src/i18n/locales/*.ts`）
> **Issue**: [#426](https://github.com/ErixWong/touwaka-ai-mate/issues/426)
> **PR**: [#427](https://github.com/ErixWong/touwaka-ai-mate/pull/427)

---

## 审计清单

### 第一步：编译与自动化检查

| 检查项 | 结果 | 备注 |
|--------|------|------|
| `npm run lint` | ✅ PASS | 无 buildPaginatedResponse 参数错误 |
| 后端启动 | ✅ PASS | （已在后端审计中验证） |
| 前端构建 | ✅ PASS | `npm run build` 成功 |

### 第二步：API 响应格式检查

| 检查项 | 结果 | 备注 |
|--------|------|------|
| ctx.success() 使用 | ✅ PASS | 后端 API 使用统一响应格式 |
| buildPaginatedResponse 参数 | ✅ PASS | 后端审计已验证 |

### 第三步：代码质量检查

| 检查项 | 结果 | 备注 |
|--------|------|------|
| SQL 注入 | ✅ PASS | 使用 Sequelize ORM，参数化查询 |
| XSS | ✅ PASS | 使用 DOMPurify 净化 markdown |
| 敏感数据日志 | ✅ PASS | 无敏感数据暴露 |
| 错误处理 | ✅ PASS | 所有 async 操作有 try-catch |
| 边界条件 | ✅ PASS | 空值处理：`kb.visibility || 'owner'` |
| 空 catch 块 | ⚠️ INFO | 第489行 `renderMarkdown` 的空 catch 是合理的 fallback |
| API 客户端 | ✅ PASS | 使用 apiClient，无原生 fetch |

### 第四步：前后端契约检查

| 检查项 | 结果 | 备注 |
|--------|------|------|
| KnowledgeBase 类型定义 | ✅ PASS | 新增 `visibility`, `creator_id`, `is_owner`, `can_edit`, `can_delete` |
| create 方法处理新字段 | ✅ PASS | `formData.visibility` 正确传递 |
| update 方法处理新字段 | ✅ PASS | 编辑时正确传递 `visibility` |
| list 方法返回新字段 | ✅ PASS | 后端 API 返回完整字段 |

### 第五步：架构设计审计

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 职责边界 | ✅ PASS | 权限逻辑在后端 `lib/kb-permission.js`，前端仅展示 |
| 依赖方向 | ✅ PASS | 前端依赖 store，store 依赖 apiClient |
| 扩展性 | ✅ PASS | visibility 使用 ENUM，易于扩展 |

### 第六步：命名规范检查

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 数据库字段 | ✅ PASS | `visibility`, `creator_id` 使用 snake_case |
| 前端变量 | ✅ PASS | `formData`, `visibility` 使用 camelCase |
| API 路由 | ✅ PASS | `/api/kb/:kb_id/transfer-owner` 使用 kebab-case |

### 第七步：i18n 国际化检查

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 翻译键完整性 | ✅ PASS | 所有新增 key 在 zh-CN.ts 和 en-US.ts 中存在 |
| 硬编码中文 | ⚠️ INFO | 发现原有代码中的硬编码（非本次修改引入） |

**原有代码中的硬编码中文**（非本次修改引入，可后续优化）：
- 第111行：`{{ size }}/页` - 分页选择器
- 第216行：`'全局搜索'` - fallback 文本

**本次新增的 i18n key**：
```typescript
// zh-CN.ts
visibilityLabel: '可见性',
visibility: {
  owner: '仅自己可见',
  department: '部门可见',
  all: '所有人可见',
},
visibilityHint: '设置知识库的访问权限范围',
permissionOwner: '管理员',

// en-US.ts
visibilityLabel: 'Visibility',
visibility: {
  owner: 'Private (Owner only)',
  department: 'Department',
  all: 'Public (All users)',
},
visibilityHint: 'Set the access permission scope for this knowledge base',
permissionOwner: 'Owner',
```

### 第八步：前端 API 客户端检查

| 检查项 | 结果 | 备注 |
|--------|------|------|
| apiClient 使用 | ✅ PASS | 无原生 fetch 调用 |
| Token 键名 | ✅ PASS | 使用 `access_token`（由 apiClient 自动处理） |

---

## 审计结论

### ✅ 通过项

所有关键检查项均通过：
- 编译与构建成功
- API 响应格式正确
- 前后端契约一致
- 安全检查通过（XSS、SQL注入）
- i18n 翻译完整
- API 客户端使用正确

### ⚠️ 信息项（非阻塞）

1. **原有代码硬编码中文**（第111行、第216行）
   - 非本次修改引入
   - 建议后续优化：添加 `pagination.perPage` 翻译键

2. **renderMarkdown 空 catch 块**（第489行）
   - 这是合理的 fallback 处理
   - markdown 解析失败时返回原始内容

---

## 变更文件清单

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `frontend/src/types/index.ts` | 修改 | 新增 `KbVisibility` 类型，更新 `KnowledgeBase` 接口 |
| `frontend/src/i18n/locales/zh-CN.ts` | 修改 | 新增 visibility 相关翻译键 |
| `frontend/src/i18n/locales/en-US.ts` | 修改 | 新增 visibility 相关翻译键 |
| `frontend/src/views/KnowledgeBaseView.vue` | 修改 | 新增 visibility 选择器、权限徽章、条件按钮 |

---

## 前端变更详情

### 1. TypeScript 类型定义

```typescript
// 新增类型
export type KbVisibility = 'owner' | 'department' | 'all'

// KnowledgeBase 接口新增字段
interface KnowledgeBase {
  // ... existing fields
  creator_id: string       // 创建者 ID
  visibility: KbVisibility // 可见性
  is_owner?: boolean       // 是否是管理员
  can_edit?: boolean       // 是否可编辑
  can_delete?: boolean     // 是否可删除
}
```

### 2. 表单字段

```typescript
// formData 新增 visibility
const formData = ref({
  name: '',
  description: '',
  visibility: 'owner' as 'owner' | 'department' | 'all',
  embedding_model_id: '' as string | number,
})
```

### 3. 模板变更

- **创建/编辑对话框**：新增 visibility 下拉选择器
- **KB 卡片**：新增 visibility 徽章和 owner 徽章
- **操作按钮**：基于 `can_edit` 和 `can_delete` 条件显示
- **右键菜单**：基于 `can_edit` 和 `can_delete` 条件显示

### 4. CSS 样式

新增 visibility 徽章样式：
```css
.visibility-badge.visibility-owner { /* 灰色 */ }
.visibility-badge.visibility-department { /* 绿色 */ }
.visibility-badge.visibility-all { /* 蓝色 */ }
.owner-badge { /* 橙色 */ }
```

---

## 建议

1. **后续优化**：将分页选择器的 `{{ size }}/页` 改为 i18n 翻译
2. **P2 任务**：实现 owner 转移界面（管理员专用）

---

*审计完成，前端代码变更符合规范，可以合并。*