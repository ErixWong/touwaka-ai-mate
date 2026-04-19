# Task 630: 修复类型错误 + SettingsView 继续重构

## 目标
1. 修复 KnowledgeBaseView 的 any 类型错误
2. 继续 SettingsView Element Plus 重构

## 状态
✅ **已完成 (部分)**

## 已完成 ✅

### KnowledgeBaseView.vue
- [x] 修复 5 处 any 类型错误
  - (m: any) → (m: AIModel) 在 3 处
  - (kb as any).visibility → kb.visibility
  - (kb as any).embedding_model_id → kb.embedding_model_id

### SettingsView.vue
- [x] Model 对话框 → el-dialog + el-form
- [x] Provider 删除确认对话框 → el-dialog
- [x] Model 删除确认对话框 → el-dialog

## 剩余工作 (SettingsView 复杂度太高，需单独规划)

### 高复杂度对话框 (待后续处理)
- [ ] Expert 对话框 (300+ 行，有 Tab 导航、头像上传)
- [ ] Expert 删除确认对话框
- [ ] User 对话框
- [ ] User 删除确认对话框
- [ ] Skills 对话框
- [ ] Role 对话框

### 其他视图对话框 (待后续处理)
- [ ] KnowledgeBaseView - 创建/编辑对话框
- [ ] KnowledgeBaseView - 删除确认对话框
- [ ] KnowledgeBaseView - 全局搜索对话框
- [ ] SolutionsView - 创建/编辑对话框

## 分支
`feature/630-fix-types-settings-refactor`

## 变更统计
```
KnowledgeBaseView.vue:  +6/-82 行 (修复类型错误)
SettingsView.vue:       +103/-173 行 (Model对话框 + 删除确认)
```

## 代码审计
- ✅ KnowledgeBaseView: 0 错误，11 警告
- ⚠️ SettingsView: 仍有 8+ 个对话框待处理

## 建议
SettingsView 剩余对话框非常复杂（Expert 有 300+ 行），建议：
1. 拆分为独立子任务
2. 或将对话框抽取为独立组件
3. 优先级可适当降低
