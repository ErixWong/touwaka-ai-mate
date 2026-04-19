# Task 629: 其他视图 Element Plus 重构 (P3)

## 目标
将剩余视图的 native 组件重构为 Element Plus 组件

## 状态
🚧 **进行中**

## 范围

### 高优先级 (复杂表单/对话框)
- [ ] **SettingsView.vue** - 设置页面，大量对话框
  - [ ] Provider 对话框 (input/select/checkbox/button)
  - [ ] Model 对话框 (input/select/checkbox)
  - [ ] Expert 对话框 (input/select/checkbox/file)
  - [ ] User 对话框 (input/select/file)
  - [ ] Skills 对话框
  - [ ] 各种删除确认对话框
  - [ ] 设置项按钮

### 中优先级 (列表/管理页面)
- [ ] **KnowledgeBaseView.vue** - 知识库列表
  - [ ] 创建/编辑对话框
  - [ ] 删除确认对话框
  - [ ] 全局搜索对话框
  - [ ] 按钮
- [ ] **TopicsView.vue** - 话题列表
  - [ ] 状态筛选 select
  - [ ] 操作按钮
- [ ] **SolutionsView.vue** - 方案列表
  - [ ] 创建/编辑对话框
  - [ ] 按钮

### 低优先级 (简单页面)
- [ ] **SolutionDetailView.vue** - 方案详情
  - [ ] 返回按钮
  - [ ] 创建任务按钮
- [ ] **HomeView.vue** - 首页
  - [ ] 设置按钮
- [ ] **AppDetailView.vue** - 小程序详情
  - [ ] 返回按钮
- [ ] **ChatView.vue** - 聊天页面
  - [ ] 选择专家按钮

## 分支
`feature/629-element-plus-p3-others`

## 预估工作量
- SettingsView: 2-3 小时 (最复杂)
- KnowledgeBaseView: 1 小时
- TopicsView/SolutionsView: 30 分钟 each
- 其他: 30 分钟
- 总计: ~5 小时
