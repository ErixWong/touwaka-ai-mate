# Task 631: SettingsView Expert/Skills 对话框重构

## 目标
继续 SettingsView Element Plus 重构

## 状态
⏸️ **部分完成**

## 已完成 ✅

### SettingsView.vue
- [x] Expert 对话框 → el-dialog + el-tabs + el-form
  - [x] 基本信息 Tab
  - [x] 人设配置 Tab
  - [x] 模型配置 Tab
  - [x] 头像上传按钮改为 el-button
  - [x] 删除确认对话框 → el-dialog
- [x] Skills 对话框 → el-dialog
  - [x] 搜索输入框 → el-input
  - [x] 内置技能标签 → el-tag
  - [x] 技能开关 → el-switch
  - [x] 空状态 → el-empty
- [x] 移除未使用的 expertTabs 变量

## 剩余工作

### SettingsView.vue 剩余对话框
- [ ] User 对话框 (200+ 行)
- [ ] User 删除确认对话框
- [ ] Role 对话框

## 变更统计
```
SettingsView.vue: 约 600 行简化，大量原生组件改为 Element Plus
```

## ESLint 状态
- 5 个 pre-existing 错误（any 类型、未使用变量）
- 无新增错误

## 建议
剩余 3 个对话框可继续处理或作为技术债务后续处理
