# Task 628: SkillsView / KnowledgeDetailView Element Plus 重构 (P2)

## 目标
将 SkillsView 和 KnowledgeDetailView 从原生组件重构为 Element Plus 组件

## 状态
🚧 **进行中**

### SkillsView.vue ✅ 已完成
- [x] 搜索过滤区: `input` → `el-input`, `select` → `el-select`
- [x] 操作按钮: `button` → `el-button`
- [x] 技能详情对话框: 自定义 → `el-dialog`
- [x] 技能编辑弹窗: 
  - [x] 自定义 Tab → `el-tabs`
  - [x] 自定义表单 → `el-form`
  - [x] 自定义输入 → `el-input`, `el-textarea`
  - [x] 自定义按钮 → `el-button`
  - [x] 标签输入 → `el-tag`
  - [x] 参数列表优化
- [x] 清理旧 CSS 样式

### KnowledgeDetailView.vue ⏳ 待完成
- [ ] 头部按钮: `button` → `el-button`
- [ ] 进度显示: 自定义 → `el-progress`
- [ ] 搜索对话框: 自定义 → `el-dialog`
- [ ] 转让所有者对话框: 自定义 → `el-dialog`
- [ ] 文章/章节管理优化

## 分支
`feature/628-element-plus-p2-skills-kb`

## 变更摘要 (SkillsView)
- 7 处 `<input>` → `<el-input>`
- 1 处 `<select>` → `<el-select>`
- 4 处 `<button>` → `<el-button>`
- 1 处自定义详情弹窗 → `<el-dialog>`
- 1 处自定义编辑弹窗 → `<el-dialog>` + `<el-tabs>` + `<el-form>`
- 删除 ~600 行旧 CSS，新增 ~150 行 Element Plus 适配 CSS

## 预估工作量
- SkillsView: 2-3 小时 ✅
- KnowledgeDetailView: 1-2 小时 ⏳
- 总计: ~4 小时
