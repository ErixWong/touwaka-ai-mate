# PR #100 代码审计报告

> **审计日期**: 2026-03-12
> **审计人**: Maria
> **PR 标题**: [T67] feat: 助理系统更新汇总
> **PR 来源**: JeanneQiu:master → master
> **审计标准**: [code-review-checklist.md](../guides/development/code-review-checklist.md)

---

## 一、PR 概述

### 变更统计

| 类型 | 文件数 | 新增行数 |
|------|--------|----------|
| 前端组件 | 4 | ~1500 |
| 前端 Store | 2 | ~220 |
| 后端服务 | 3 | ~2200 |
| 数据库迁移 | 2 | ~240 |
| 类型定义 | 2 | ~140 |
| i18n | 2 | ~110 |
| 文档 | 8 | ~2300 |

### 合并的 PR

此 PR 汇总了以下功能分支：
- #93 [T91] feat: 实现助理系统前端面板
- #92 [T87] feat: 实现 Assistant Messages
- #90 [T88] feat: Assistant Summon 输入结构优化
- #86 [T67] feat: Assistant System初步实现
- #84 [T66] fix: bailian 405 error

---

## 二、审计结果汇总

### ✅ 通过项

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| npm run lint | ✅ | buildPaginatedResponse 调用正确 |
| API 响应格式 | ✅ | 使用 `ctx.success()` / `ctx.error()` |
| SQL 注入 | ✅ | 使用 Sequelize ORM，参数化查询 |
| XSS 防护 | ✅ | Vue 模板自动转义 |
| 敏感数据 | ✅ | 无敏感数据泄露 |
| API 客户端 | ✅ | 使用 `apiClient`，无原生 fetch |
| i18n 国际化 | ✅ | 所有 UI 文本使用 `$t()` |
| 命名规范 | ✅ | 组件 PascalCase，路由 snake_case |
| 模块导入 | ✅ | ES Module 格式正确 |
| 资源清理 | ✅ | 轮询定时器在 `onUnmounted` 清理 |

### ⚠️ 需改进项

#### 1. Store 错误处理缺少用户反馈

**问题位置**: [`frontend/src/stores/assistant.ts`](frontend/src/stores/assistant.ts)

**问题描述**: Store 中的错误只设置了 `error.value` 并 `console.error`，没有使用 `alert()` 或 toast 通知用户。

```typescript
// 当前代码 (第 29-34 行)
async function fetchAssistants() {
  try {
    // ...
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to fetch assistants'
    console.error('Failed to fetch assistants:', e)  // ❌ 只有 console.error
  }
}
```

**建议修复**: 在调用 Store 方法的组件中添加用户反馈：

```typescript
// 组件中
async function loadData() {
  try {
    await assistantStore.fetchAssistants()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('assistant.loadFailed')
    alert(errorMsg)  // 或使用 toast
  }
}
```

**严重程度**: 🟡 中等 - 影响用户体验，但不影响功能

#### 2. 硬编码 Fallback 字符串

**问题位置**: [`frontend/src/components/panel/AssistantTab.vue`](frontend/src/components/panel/AssistantTab.vue)

**问题描述**: 部分文本使用了 `|| '中文'` 作为 fallback，违反 i18n 最佳实践。

```vue
<!-- 当前代码 -->
{{ $t('assistant.availableAssistants') || '可用助理' }}
{{ $t('assistant.noAssistants') || '暂无可用助理' }}
```

**建议修复**: 依赖 i18n 的默认值机制，移除 fallback：

```vue
{{ $t('assistant.availableAssistants') }}
{{ $t('assistant.noAssistants') }}
```

**严重程度**: 🟢 低 - 功能正常，代码风格问题

#### 3. 删除确认使用原生 confirm()

**问题位置**: [`frontend/src/components/panel/AssistantTab.vue`](frontend/src/components/panel/AssistantTab.vue)

**问题描述**: 使用原生 `confirm()` 对话框，风格与项目不统一。

```typescript
// 当前代码
const confirmed = confirm(t('assistant.confirmDelete'))
```

**建议修复**: 考虑使用自定义确认弹窗组件，与项目 UI 风格统一。

**严重程度**: 🟢 低 - 功能正常，UI 风格问题

---

## 三、详细审计记录

### 第一步：编译与自动化检查

```bash
$ npm run lint
🔍 检查 buildPaginatedResponse 调用...
✅ 所有 buildPaginatedResponse 调用都正确！
```

### 第二步：API 响应格式检查

**新增 API 端点**:

| 端点 | 方法 | 响应格式 |
|------|------|----------|
| `/api/assistants` | GET | `ctx.success(assistants)` ✅ |
| `/api/assistants/call` | POST | `ctx.success(result)` ✅ |
| `/api/assistants/requests/:request_id` | GET | `ctx.success(result)` ✅ |
| `/api/assistants/requests` | GET | `ctx.success(requests)` ✅ |
| `/api/assistants/requests/:request_id/messages` | GET | `ctx.success({ request_id, messages })` ✅ |
| `/api/assistants/requests/:request_id/archive` | POST | `ctx.success({ request_id, is_archived })` ✅ |
| `/api/assistants/requests/:request_id/unarchive` | POST | `ctx.success({ request_id, is_archived })` ✅ |
| `/api/assistants/requests/:request_id` | DELETE | `ctx.success({ request_id, deleted })` ✅ |

### 第三步：代码质量检查

| 检查项 | 状态 | 说明 |
|--------|:----:|------|
| SQL 注入 | ✅ | Sequelize ORM 参数化查询 |
| XSS | ✅ | Vue 模板自动转义 |
| 敏感数据 | ✅ | 无敏感数据暴露 |
| 错误处理 | ⚠️ | Store 缺少用户反馈 |
| 边界条件 | ✅ | 空数组检查完整 |
| 并发安全 | ✅ | 轮询定时器正确管理 |
| 资源泄漏 | ✅ | `onUnmounted` 清理定时器 |
| N+1 查询 | ✅ | 删除操作正确级联 |

### 第四步：前后端契约检查

**新增类型定义** ([`frontend/src/types/index.ts`](frontend/src/types/index.ts)):

```typescript
export interface Assistant {
  assistant_type: string
  name: string
  icon: string
  description: string
  model_id: string
  prompt_template: string
  max_tokens: number
  temperature: number
  estimated_time: number
  timeout: number
  tool_name: string
  tool_description: string
  tool_parameters: Record<string, unknown>
  can_use_skills: number
  execution_mode: 'direct' | 'llm' | 'hybrid'
  is_active: number
}

export interface AssistantRequest {
  request_id: string
  assistant_type: string
  expert_id: string
  contact_id: string
  user_id: string
  topic_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout'
  input: Record<string, unknown>
  result: string
  error_message: string
  tokens_input: number
  tokens_output: number
  model_used: string
  latency_ms: number
  is_archived?: number
  created_at: string
  started_at: string
  completed_at: string
}

export interface AssistantMessage {
  id: number
  request_id: string
  parent_message_id: string
  role: 'expert' | 'assistant' | 'tool' | 'system'
  message_type: 'task' | 'tool_call' | 'tool_result' | 'final' | 'error' | 'status'
  content: string
  content_preview: string
  tool_name: string
  tool_call_id: string
  status: string
  sequence_no: number
  metadata: Record<string, unknown>
  tokens_input: number
  tokens_output: number
  latency_ms: number
  created_at: string
}
```

**契约一致性**: ✅ 与后端模型字段对应

### 第五步：架构设计审计

**组件结构**:

```
RightPanel.vue
    └── AssistantTab.vue
            ├── assistant.ts (Pinia Store)
            │   ├── fetchAssistants()
            │   ├── fetchRequests()
            │   ├── fetchRequestMessages()
            │   ├── archiveRequest()
            │   ├── unarchiveRequest()
            │   ├── deleteRequest()
            │   ├── startPolling()
            │   └── stopPolling()
            ├── AssistantRequestCard.vue
            ├── AssistantResult.vue
            └── AssistantRoster.vue
```

**设计评价**:
- ✅ 职责边界清晰
- ✅ 单向依赖，无循环依赖
- ✅ Store 与 Component 分离，易于测试
- ✅ 新增 Tab 无需修改现有组件

### 第六步：i18n 国际化检查

**新增翻译键** ([`frontend/src/i18n/locales/zh-CN.ts`](frontend/src/i18n/locales/zh-CN.ts)):

```typescript
assistant: {
  rosterTitle: '助理列表',
  noAssistants: '暂无可用助理',
  totalAssistants: '共 {count} 个助理',
  activeAssistants: '{count} 个启用',
  active: '启用',
  inactive: '禁用',
  executionMode: '执行模式',
  model: '模型',
  estimatedTime: '预计耗时',
  statusPending: '等待处理',
  statusRunning: '处理中',
  statusCompleted: '{time}秒完成',
  statusFailed: '执行失败',
  statusTimeout: '执行超时',
  tokensInput: '输入 Token',
  tokensOutput: '输出 Token',
  latency: '耗时',
  modelUsed: '使用模型',
  warning: '警告',
  warningTitle: '注意事项',
  archive: '归档',
  unarchive: '取消归档',
  delete: '删除',
  archived: '已归档',
  showArchived: '显示归档',
  hideArchived: '隐藏归档',
  confirmDelete: '确定要删除此委托吗？此操作不可撤销。',
}
```

**检查结果**:
- ✅ 所有 `$t()` 调用的 key 存在
- ✅ `zh-CN.ts` 和 `en-US.ts` 同步更新
- ⚠️ 部分 UI 文本使用硬编码 fallback

### 第七步：数据库迁移检查

**迁移脚本** ([`scripts/migrate-add-assistants.js`](scripts/migrate-add-assistants.js)):

```javascript
// 幂等设计 - 检查表是否存在
const [tables] = await connection.execute(
  `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
  [DB_CONFIG.database, 'assistants']
);
if (tables.length > 0) {
  console.log('  ⏭️ assistants table already exists, skipping');
  return;
}
```

**检查结果**:
- ✅ 幂等性 - 可重复执行
- ✅ 检查表/字段是否存在再创建
- ✅ 添加索引优化查询

---

## 四、审计结论

### 🟡 代码审查通过（有建议）

代码整体质量良好，架构设计合理，命名规范正确，i18n 完整，前后端契约一致。

### 建议优先级

| 优先级 | 问题 | 建议 |
|:------:|------|------|
| 🟡 中 | Store 错误缺少用户反馈 | 在组件中添加 alert/toast |
| 🟢 低 | 硬编码 fallback 字符串 | 移除 fallback，依赖 i18n |
| 🟢 低 | 原生 confirm() 对话框 | 考虑自定义弹窗组件 |

### 亮点

1. **资源管理** - 轮询定时器在 `onUnmounted` 正确清理
2. **API 规范** - 统一使用 `apiClient`，无原生 fetch
3. **类型完整** - 新增类型与后端契约一致
4. **删除安全** - 状态检查 + 级联删除，防止误删
5. **迁移幂等** - 数据库迁移脚本可重复执行
6. **三种执行模式** - direct/llm/hybrid 模式实现完整

---

## 五、变更文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `frontend/src/components/assistant/AssistantRequestCard.vue` | 新增 | 委托卡片组件 |
| `frontend/src/components/assistant/AssistantResult.vue` | 新增 | 结果展示组件 |
| `frontend/src/components/assistant/AssistantRoster.vue` | 新增 | 助理列表组件 |
| `frontend/src/components/panel/AssistantTab.vue` | 新增 | 助理 Tab 面板 |
| `frontend/src/stores/assistant.ts` | 新增 | Pinia Store |
| `frontend/src/stores/panel.ts` | 修改 | 添加 assistants Tab |
| `frontend/src/api/services.ts` | 修改 | 添加助理 API |
| `frontend/src/types/index.ts` | 修改 | 添加类型定义 |
| `frontend/src/i18n/locales/zh-CN.ts` | 修改 | 中文翻译 |
| `frontend/src/i18n/locales/en-US.ts` | 修改 | 英文翻译 |
| `server/services/assistant-manager.js` | 新增 | 助理管理服务 |
| `server/services/assistant-message-service.js` | 新增 | 助理消息服务 |
| `server/controllers/assistant.controller.js` | 新增 | 控制器 |
| `server/routes/assistant.routes.js` | 新增 | 路由 |
| `models/assistant.js` | 新增 | 模型 |
| `models/assistant_request.js` | 新增 | 模型 |
| `models/assistant_message.js` | 新增 | 模型 |
| `scripts/migrate-add-assistants.js` | 新增 | 迁移脚本 |
| `scripts/migrate-add-assistant-messages.js` | 新增 | 迁移脚本 |

---

*审计完成时间: 2026-03-12 22:52 CST*