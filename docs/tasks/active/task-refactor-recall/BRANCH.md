# Branch Mapping

task: 重构 recall 工具
task_path: docs/tasks/active/task-refactor-recall

## Git 分支
- branch: feature/refactor-recall
- base: main
- type: feature

## 文件变更
- lib/tool-manager.js (修改)
  - BUILTIN_TOOLS[1] - 更新 recall 工具定义
  - executeRecall() - 重构执行逻辑
  - 新增/更新辅助方法

## 提交规范
- feat: 重构 recall 工具，采用 mode+action 双参数结构
