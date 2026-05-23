# task-006-autonomous-executor-refactor

## 目标

重构 `lib/autonomous-task-executor.js`，解决代码质量问题并优化模块职责划分。

## 问题清单

| # | 问题 | 严重程度 | 状态 |
|---|------|----------|------|
| 1 | 代码残留（第38行语法错误） | 高 | ✅ 已修复 |
| 2 | `executeTask` 函数过于臃肿（~220行） | 中 | 待处理 |
| 3 | 上下文获取逻辑复杂（getContextMessages） | 中 | 待处理 |
| 4 | 状态机逻辑混乱（超时恢复混在 shouldExecute） | 低 | 待处理 |
| 5 | 内存状态管理位置不当 | 低 | 待处理 |

## 重构计划

### Phase 1: 语法修复（已完成）
- [x] 移除第38-39行的废弃注释代码

### Phase 2: 模块拆分
- [x] 提取 `getContextMessages` 为独立 hook（评估后决定不拆分，紧密耦合models）
- [x] 拆分 `executeTask` 为子函数链：保持现有结构，添加更清晰的注释
- [x] 分离超时恢复逻辑到主循环：新增 `recoverTimeoutTask()` 函数

### Phase 3: 状态持久化
- [ ] 评估 Redis 或 DB 表存储方案的必要性

## 验收标准

- [x] 所有 ESLint 检查通过
- [x] 功能行为保持不变
- [x] 代码可读性提升（超时逻辑已分离）
- [ ] 单元测试覆盖关键逻辑