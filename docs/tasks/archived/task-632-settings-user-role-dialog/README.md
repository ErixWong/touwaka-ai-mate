# Task 632: SettingsView User/Role 对话框重构

## 目标
完成 SettingsView 所有对话框 Element Plus 化

## 状态
✅ **已完成**

## 已完成 ✅

### SettingsView.vue 剩余对话框
- [x] User 对话框 (200+ 行)
  - [x] 所有 input → el-input
  - [x] 所有 select → el-select
  - [x] 角色复选框 → el-checkbox-group
  - [x] 内置角色标签 → el-tag
  - [x] 生日选择 → el-date-picker
  - [x] 邀请配额 → el-input-number
  - [x] 头像上传按钮 → el-button
  - [x] 重置密码区域
- [x] User 删除确认对话框 → el-dialog
- [x] Role 对话框 → el-dialog + el-form

## 变更统计
```
SettingsView.vue: 约 400+ 行简化
```

## SettingsView 对话框重构完成总结

| 对话框 | 状态 |
|--------|------|
| Provider 对话框 | ✅ 完成 |
| Provider 删除确认 | ✅ 完成 |
| Model 对话框 | ✅ 完成 |
| Model 删除确认 | ✅ 完成 |
| Expert 对话框 | ✅ 完成 |
| Expert 删除确认 | ✅ 完成 |
| Skills 对话框 | ✅ 完成 |
| User 对话框 | ✅ 完成 |
| User 删除确认 | ✅ 完成 |
| Role 对话框 | ✅ 完成 |

**总计: 10 个对话框全部完成 Element Plus 化！**

## ESLint 状态
- 5 个 pre-existing 错误（any 类型、未使用变量）
- 无新增错误

## 分支
`feature/632-settings-user-role-dialog`
