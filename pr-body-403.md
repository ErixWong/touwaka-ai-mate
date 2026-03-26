## 问题描述

点击"自动执行"按钮时，任务状态被设置为 `autonomous`，但这个状态应该被废弃。正确的状态应该是：
- `autonomous_wait` - 自动模式，等待执行（LLM 空闲）
- `autonomous_working` - 自动模式，正在执行（LLM 处理中）

## 修改内容

修改 `frontend/src/components/panel/TasksTab.vue` 中的两个函数：

1. **`toggleAutonomousMode`** - 任务详情页的自动执行按钮
   - 将 `'autonomous'` 改为 `'autonomous_wait'`

2. **`handleToggleAutonomousFromList`** - 任务列表的自动执行按钮
   - 将判断条件从 `task.status === 'autonomous'` 改为 `isAutonomousStatus(task.status)`
   - 将设置的状态从 `'autonomous'` 改为 `'autonomous_wait'`

## 测试

- [x] 点击自动执行按钮，状态变为 `autonomous_wait`
- [x] 再次点击，状态恢复为 `active`

Closes #403