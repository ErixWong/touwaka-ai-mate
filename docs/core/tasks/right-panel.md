# 对话窗口右侧多功能 Panel

**状态：** ✅ 基础功能已完成  
**创建日期：** 2026-02-22

## 描述

在对话页面右侧实现一个固定显示的面板容器，采用 Tab 页形式组织多个功能模块。

## Tab 页

1. ~~**Docs Tab**~~ - ❌ 已移除（简化设计）
2. **Topics Tab** - ✅ 历史话题列表（已完成）
3. **Debug Tab** - ✅ 调试信息（已完成）

---

## 已完成

- [x] 实现 `RightPanel.vue` 容器组件
- [x] 迁移 `DebugPanel.vue` 到 `DebugTab.vue`
- [x] 实现 `TopicsTab.vue` 组件
- [x] 实现通用分页组件 `Pagination.vue`
- [x] 创建 `panel.ts` 状态管理
- [x] 更新 `types/index.ts` 添加分页类型
- [x] 更新国际化文件（zh-CN, en-US）
- [x] 修改 `ChatView.vue` 集成右侧面板
- [x] 后端 Topics 分页 API 实现（`topic.controller.js`）
- [x] Topic 消息计数和标题自动更新功能
- [x] 移除 Docs Tab（简化设计）
- [x] Debug Tab 显示更多调试信息（如 token 统计）- 2026-02-23

---

## 待办

- [ ] Topics Tab 支持加载更多/无限滚动

---

## 相关文档

- [右侧面板设计方案 v2](../design/v2/right-panel-design.md)
- [API 查询设计规范](../guides/database/api-query-design.md)
