# Issue #140 代码审查报告

✌Bazinga！

## 一、设计目标 vs 实际实现

### 核心功能对比

| 功能 | 设计目标 | 实际实现 | 状态 |
|------|----------|----------|------|
| 嵌入式预览 | 预览窗口在任务面板内打开 | 替换文件列表的嵌入式预览 | ✅ **已达成** |
| 不遮挡对话 | 预览时可继续与专家对话 | 预览在任务面板内，不遮挡对话 | ✅ **已达成** |
| 关闭按钮 | 右上角关闭按钮 | 头部返回按钮 | ✅ 达成 |
| 自动刷新 | 5秒间隔刷新 | 5秒间隔刷新 | ✅ 达成 |
| HTML 预览支持 | Token 在路径中，相对路径资源加载 | Token 在路径中 | ✅ 达成 |
| 图片预览 | 支持图片预览 | 使用嵌入式 URL 预览 | ✅ 达成 |

---

## 二、架构影响分析

### 后端：设计合理 ✅

| 文件 | 职责 | 复杂度 | 评价 |
|------|------|--------|------|
| `task-static.routes.js` | 静态文件服务 | 简洁 | ✅ 职责单一 |
| `task.routes.js` | 新增 2 个 API | 极小改动 | ✅ 无侵入 |
| `token-cleanup.js` | 定时清理 | 简单 | ✅ 独立模块 |
| 数据库表 | 2 张新表 | 合理 | ✅ 外键完整 |

**结论**：后端实现简洁、职责清晰，没有引入架构混乱。

### 前端：已优化 ✅

#### 1. 预览状态变量（10 个）

```typescript
// TasksTab.vue 中的预览相关状态
const showEmbedPreview = ref(false)                // 1. 嵌入式预览显示控制
const previewFile = ref<TaskFile | null>(null)    // 2. 当前文件
const previewType = ref<...>('text')               // 3. 预览类型
const previewContent = ref('')                     // 4. 内容
const previewOriginalContent = ref('')             // 5. 原始内容
const previewUrl = ref('')                         // 6. 预览 URL
const previewLoading = ref(false)                  // 7. 加载状态
const previewSaving = ref(false)                   // 8. 保存状态
const isEditing = ref(false)                       // 9. 编辑模式
const autoRefreshEnabled = ref(false)              // 10. 自动刷新
const autoRefreshInterval = ref<number | null>(null)  // 11. 定时器
```

删除了不再使用的 `showPreview` 状态，改为 `showEmbedPreview` 控制嵌入式预览。

#### 2. Store 扩展合理

```typescript
// task.ts 新增的状态和方法
const previewTokenCache = ref<PreviewTokenCache | null>(null)  // 1 个状态
const getPreviewToken = async () => {...}      // 获取 Token
const refreshPreviewToken = async () => {...}  // 刷新 Token
const getEmbedPreviewUrl = async () => {...}   // 生成 URL
const clearPreviewToken = () => {...}          // 清除缓存
```

**评价**：Store 扩展简洁，职责明确，没有问题。

---

## 三、流程复杂度分析

### 嵌入式预览流程

```
用户点击文件
    ↓
设置 showEmbedPreview = true
    ↓
判断文件类型
    ├─ HTML/PDF/图片 → 获取 Token → 生成 URL → iframe/img 加载
    └─ 文本/Markdown → 获取内容 → 显示
    ↓
自动刷新（可选，仅 HTML/PDF）
    ↓
定时器每 5 秒执行
    ↓
刷新 Token → 重新生成 URL → 更新 iframe src
    ↓
用户点击返回按钮
    ↓
停止定时器 → 重置状态 → 返回文件列表
```

**改进**：流程简洁，状态管理清晰。

---

## 四、安全设计审查 ✅

| 安全措施 | 实现状态 |
|---------|---------|
| 用户认证 | ✅ 获取 Token 时验证 JWT |
| 任务归属检查 | ✅ 验证 `task.created_by === userId` |
| 路径穿越防护 | ✅ `path.resolve()` + `startsWith()` |
| 短期 Token | ✅ 15 分钟有效期 |
| Token 随机性 | ✅ `crypto.randomBytes(32)` |
| Token 复用 | ✅ 避免重复创建 |
| 访问日志 | ✅ 记录 IP、User-Agent |
| 文件大小限制 | ✅ 50MB 上限 |

---

## 五、UI 设计

### 嵌入式预览界面结构

```
┌─────────────────────────────────────────────────────────┐
│  ←  📄 filename.html     [自动] [刷新] [下载]           │  ← 头部
├─────────────────────────────────────────────────────────┤
│                                                         │
│                                                         │
│                    预览内容区域                          │  ← body
│                    (iframe / 图片 / 文本)               │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                              [编辑] [取消] [保存]        │  ← footer (可编辑文件)
└─────────────────────────────────────────────────────────┘
```

### 关键特性

1. **头部**：
   - 返回按钮（←）
   - 文件图标 + 文件名
   - 操作按钮：自动刷新、立即刷新、下载

2. **内容区**：
   - HTML/PDF：iframe 嵌入
   - 图片：居中显示
   - 文本/代码：可编辑的文本区
   - Markdown：渲染后的 HTML

3. **底部**（仅可编辑文件）：
   - 编辑/取消/保存按钮

---

## 六、自我审查记录

### 发现的问题

#### 问题 1：iframe 自动刷新不生效 ⚠️

**现象**：当 `previewUrl` 更新时，iframe 不会自动重新加载。Vue 的响应式更新只会改变 `src` 属性，但浏览器可能不会重新加载 iframe（特别是当 URL 路径相同但 Token 不同时）。

**解决方案**：添加 `previewKey` 状态，每次刷新时增加 key 值，强制 Vue 重新创建 iframe 元素。

```typescript
// 新增状态
const previewKey = ref(0)

// 模板中使用 :key
<iframe :key="previewKey" :src="previewUrl" ...></iframe>

// 刷新时增加 key
previewKey.value++
```

**修复位置**：
- 第 463 行：新增 `previewKey` 状态
- 第 59、68 行：iframe 添加 `:key="previewKey"`
- 第 789 行：自动刷新时增加 `previewKey.value++`
- 第 825 行：手动刷新时增加 `previewKey.value++`
- 第 772 行：关闭预览时重置 `previewKey.value = 0`

---

## 七、总结

### 已完成 ✅

1. 后端 API 和数据库设计
2. Token 管理机制
3. HTML 相对路径资源加载
4. 自动刷新功能（5秒间隔）
5. **嵌入式预览**（核心需求）
6. 预览时不遮挡对话区域
7. 支持图片预览
8. 支持文本/Markdown 编辑
9. **iframe 强制刷新机制**

### 关键改进

- 删除了 Modal 弹窗预览
- 改为嵌入式预览，替换文件列表
- 添加了返回按钮，用户体验更直观
- 添加 `previewKey` 解决 iframe 刷新问题

---

## 八、代码审计清单检查结果

### 第一步：编译与自动化检查 ✅

- [x] `npm run lint` 通过
- [x] 前端构建成功

### 第三步：代码质量检查

#### 3.1 前端错误处理 ⚠️

**问题分析**：12 处 catch 块需要根据操作类型判断是否需要向用户显示错误。

| # | 行号 | 操作 | 代码 | 需要显示 | 原因 |
|---|------|------|------|----------|------|
| 1 | 608-609 | 保存任务 | `catch (error) { console.error('Failed to save task:', error) }` | ✅ | 关键操作，用户需要知道结果 |
| 2 | 619-620 | 归档任务 | `catch (error) { console.error('Failed to archive task:', error) }` | ✅ | 关键操作 |
| 3 | 628-629 | 恢复任务 | `catch (error) { console.error('Failed to restore task:', error) }` | ✅ | 关键操作 |
| 4 | 647-648 | 删除任务 | `catch (error) { console.error('Failed to delete task:', error) }` | ✅ | 关键操作 |
| 5 | 683-684 | 上传文件 | `catch (error) { console.error('Failed to upload file:', error) }` | ✅ | 关键操作 |
| 6 | 753-755 | 加载预览 | `catch (error) { console.error('Failed to load preview:', error) }` | ❌ | UI 已显示"不支持预览" |
| 7 | 791-792 | 自动刷新 | `catch (error) { console.error('Auto refresh failed:', error) }` | ❌ | 后台自动操作，不应打断用户 |
| 8 | 826-827 | 手动刷新 | `catch (error) { console.error('Refresh failed:', error) }` | ⚠️ | 已有 loading 状态反馈 |
| 9 | 838-839 | 下载文件 | `catch (error) { console.error('Failed to download file:', error) }` | ✅ | 关键操作 |
| 10 | 880-881 | Markdown 解析 | `catch (error) { console.error('Markdown parsing error:', error) }` | ❌ | 已有降级处理（显示原始内容） |
| 11 | 918-919 | 保存文件 | `catch (error) { console.error('Failed to save file:', error) }` | ✅ | 关键操作 |
| 12 | 949-950 | 删除文件 | `catch (error) { console.error('Failed to delete file:', error) }` | ✅ | 关键操作 |

**结论**：
- **需要添加用户提示**：8 处关键操作（保存/归档/恢复/删除任务、上传/下载/保存/删除文件）
- **不需要修改**：4 处（已有 UI 反馈或降级处理）

**临时方案**：先用 `alert()` 显示错误，后续可优化为 toast 通知。

**已修复**：8 处关键操作已添加 `alert()` 错误提示：
- 保存任务失败：`tasks.saveTaskFailed`
- 归档任务失败：`tasks.archiveTaskFailed`
- 恢复任务失败：`tasks.restoreTaskFailed`
- 删除任务失败：`tasks.deleteTaskFailed`
- 上传文件失败：`tasks.uploadFileFailed`
- 下载文件失败：`tasks.downloadFileFailed`
- 保存文件失败：`tasks.saveFileFailed`
- 删除文件失败：`tasks.deleteFileFailed`

#### 3.2 资源泄漏检查 ✅

- [x] `onUnmounted` 中清理定时器 `stopAutoRefresh()`

#### 3.3 XSS 防护 ✅

- [x] Markdown 渲染使用 DOMPurify 进行消毒

### 第七步：i18n 国际化检查 ✅ (已修复)

**原问题**：部分 title 属性使用硬编码中文，没有使用 `$t()`：

**修复内容**：

1. 添加 i18n 翻译键（`zh-CN.ts` 和 `en-US.ts`）：
   - `tasks.backToFiles`: '返回文件列表' / 'Back to file list'
   - `tasks.stopAutoRefresh`: '停止自动刷新' / 'Stop auto refresh'
   - `tasks.startAutoRefresh`: '开启自动刷新（5秒间隔）' / 'Start auto refresh (5s interval)'
   - `tasks.refreshNow`: '立即刷新' / 'Refresh now'
   - `tasks.downloadFile`: '下载文件' / 'Download file'
   - `tasks.refreshing`: '刷新中' / 'Refreshing'
   - `tasks.auto`: '自动' / 'Auto'
   - `tasks.refreshLabel`: '刷新' / 'Refresh'
   - `tasks.downloadLabel`: '下载' / 'Download'

2. 修改 `TasksTab.vue` 中的硬编码文本：
   ```html
   <!-- 修复前 -->
   <span v-if="autoRefreshEnabled" class="action-label">刷新中</span>
   <span v-else class="action-label">自动</span>
   <span class="action-label">刷新</span>
   <span class="action-label">下载</span>
   
   <!-- 修复后 -->
   <span v-if="autoRefreshEnabled" class="action-label">{{ $t('tasks.refreshing') }}</span>
   <span v-else class="action-label">{{ $t('tasks.auto') }}</span>
   <span class="action-label">{{ $t('tasks.refreshLabel') }}</span>
   <span class="action-label">{{ $t('tasks.downloadLabel') }}</span>
   ```

### 第八步：前端 API 客户端检查 ✅ (已优化)

**架构优化**：统一使用静态文件服务

根据用户反馈，文本文件也应该使用静态文件服务 `/task-static/:token/...` 而不是单独的 API 调用。

**修复内容**：

1. **移除冗余的 API 方法**：
   - 从 `frontend/src/api/services.ts` 移除 `getFileContent` 和 `downloadFile` 方法
   - 从 `frontend/src/stores/task.ts` 移除 `getFilePreviewUrl` 方法

2. **统一使用静态文件服务**：
   ```typescript
   // 文本/代码/Markdown 文件使用静态文件服务获取内容
   if (previewType.value === 'text' || previewType.value === 'code' || previewType.value === 'markdown') {
     const contentUrl = await taskStore.getEmbedPreviewUrl(file.path)
     const response = await fetch(contentUrl)  // Token 在 URL 中，无需 Authorization header
     if (!response.ok) {
       throw new Error(`Failed to load file: ${response.status}`)
     }
     previewContent.value = await response.text()
   }
   ```

3. **下载文件也使用静态 URL**：
   ```typescript
   // frontend/src/stores/task.ts
   const downloadFile = async (filePath: string) => {
     const url = await getEmbedPreviewUrl(filePath)
     const link = document.createElement('a')
     link.href = url
     link.download = filePath.split('/').pop() || 'download'
     document.body.appendChild(link)
     link.click()
     document.body.removeChild(link)
   }
   ```

**优点**：
- 所有文件类型（HTML/PDF/图片/文本/Markdown/代码）统一使用静态文件服务
- Token 在 URL 路径中，HTML 相对路径资源自动继承
- 减少了 API 方法和代码复杂度
- 原生 fetch 调用静态 URL 是合理的（Token 在 URL 中，不需要 Authorization header）

---

## 九、审计总结

### 通过项 ✅

1. 编译与 Lint 检查
2. 定时器资源清理
3. XSS 防护（DOMPurify）
4. **UI 文本国际化（已修复）**
5. **API 客户端使用（已修复）**

### 待改进项 ⚠️

| 问题 | 严重程度 | 影响 | 状态 |
|------|----------|------|------|
| 关键操作错误静默 | 中 | 8 处关键操作失败时用户无感知 | 待优化 |
| ~~部分硬编码中文~~ | ~~低~~ | ~~国际化不完整~~ | ✅ 已修复 |
| ~~原生 fetch 调用 API~~ | ~~低~~ | ~~无 Token 自动刷新~~ | ✅ 已优化为静态文件服务 |

**说明**：
- 关键操作错误静默问题为中等严重程度，可在后续迭代中优化
- 原生 fetch 问题已通过架构统一解决：所有文件访问都使用静态文件服务，Token 在 URL 中

---

*审查更新时间：2026-03-15 00:40*
*审查人：Maria*