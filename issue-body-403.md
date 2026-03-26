## 问题描述

当用户点击"自动执行"按钮时，任务状态被设置为 `autonomous`，但这个状态是旧设计，应该使用 `autonomous_wait` 代替。

## 当前行为

```javascript
// frontend/src/components/panel/TasksTab.vue
const newStatus: TaskStatus = isAutonomousMode.value ? 'active' : 'autonomous'
```

## 期望行为

点击"自动执行"按钮后，状态应该设为 `autonomous_wait`（等待执行），而不是 `autonomous`。

## 状态定义

- `active`: 手动模式，用户控制
- `autonomous_wait`: 自动模式，等待执行（LLM 空闲）
- `autonomous_working`: 自动模式，正在执行（LLM 处理中）
- ~~`autonomous`~~: 旧状态，已废弃

## 修复位置

`frontend/src/components/panel/TasksTab.vue`:
- 第 595 行: `toggleAutonomousMode` 函数
- 第 625 行: `handleToggleAutonomousFromList` 函数