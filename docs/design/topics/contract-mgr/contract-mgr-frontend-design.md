# 合同管理 App 前端详情页和筛选组件设计

> Issue: #648
> 状态: **已实现**
> 依赖: Phase 2 后端章节结构（已完成）

## 背景

Issue #645 Phase 2 已完成，实现了后端扩展表架构、API 端点、Handler 提示词注入。

Phase 3 前端功能已实现，用户可以：

- 在详情页查看 OCR 原文和章节导航
- 使用树状筛选组件筛选合同
- 重新提取合同元数据

---

## 已实现组件

### 1. DocumentContentViewer 控件

**文件位置：** `frontend/src/components/apps/DocumentContentViewer.vue`

**功能：**
- 左侧章节导航树（可折叠）
- 右侧全文内容滚动展示
- 点击章节 → 锚点跳转
- 支持无章节时的纯文本展示

### 2. TreeFilter 组件

**文件位置：** `frontend/src/components/apps/TreeFilter.vue`

**功能：**
- 多字段树状筛选
- checkbox 多选
- 调用 `/extension/distinct` API 获取唯一值
- emit `filter-change` 事件

### 3. ReExtractDialog 组件

**文件位置：** `frontend/src/components/apps/ReExtractDialog.vue`

**功能：**
- 显示上次提示词和提取结果
- 提供新提示词输入框
- 过滤后文本预览
- 提取结果对比视图（左右对比）
- 高亮差异字段

---

## 文件清单

| 文件 | 说明 | 状态 |
|------|------|------|
| `frontend/src/components/apps/DocumentContentViewer.vue` | 文档内容查看器 | ✅ 已实现 |
| `frontend/src/components/apps/TreeFilter.vue` | 树状筛选组件 | ✅ 已实现 |
| `frontend/src/components/apps/ReExtractDialog.vue` | 重提取对话框 | ✅ 已实现 |
| `frontend/src/api/mini-apps.ts` | API 函数扩展 | ✅ 已实现 |
| `frontend/src/i18n/locales/zh-CN.ts` | 中文国际化 | ✅ 已实现 |
| `frontend/src/i18n/locales/en-US.ts` | 英文国际化 | ✅ 已实现 |

---

*最后更新: 2026-04-26*