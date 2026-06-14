# 外包实施说明 - AppClock Tick Timeout 治理

## 1. 文档用途

本文档面向外包团队，目标是让执行方在无需反复口头沟通的前提下，完成 `AppClock` tick timeout 与人工介入机制的整改设计、开发、自测与交付。

## 2. 问题摘要

当前平台中的 `AppClock` 负责定时调用各 app 的 `tick(context)`。

现状问题是：

1. 外层 tick timeout 使用 `Promise.race()` 实现，只结束等待，不会真正终止底层脚本。
2. timeout 后平台会过早释放 app 运行锁，导致后续调度可能误重入。
3. 平台没有向管理员暴露“该 app 已 timeout，等待人工处理”的显式状态。
4. 平台并不知道 app 内部具体处理的业务对象，因此不能把 document/note/email 的业务语义硬编码到通用调度器中。

## 3. 设计边界（必须遵守）

### 3.1 平台抽象边界

本任务中，平台层只负责管理：

1. 某个 app 的 tick 是否仍在运行。
2. timeout 后该 app 是否进入人工处理态。
3. 管理员如何观察并恢复该 app 的自动调度。

平台层不负责：

1. 理解 app 内部处理的是 document、note、vector、todo 还是 email。
2. 为所有 app 统一定义业务 work unit 租约模型。

### 3.2 timeout 后处理策略

timeout 后必须采用保守策略：

1. timeout 不等于成功结束。
2. timeout 后不得自动再次调度该 app。
3. 必须等待管理员人工处理。

## 4. 目标行为

### 4.1 正常运行

1. 若某个 app 没有运行中的 tick，则到达 `clock_interval` 时正常调用 tick。
2. 若上一次 tick 已自然完成，则允许下一次继续运行。

### 4.2 运行中

1. 若某个 app 的上一次 tick 仍在运行，则下一次 clock 到来时必须跳过该 app。
2. 跳过必须有明确日志。

### 4.3 timeout

1. 若某个 app 的 tick 超过 `tick_timeout_ms`，则标记为 `timed_out`。
2. 标记后该 app 不再自动 tick。
3. 前端必须清楚展示该状态。

### 4.4 人工恢复

1. 管理员可以手动清除 `timed_out` 状态。
2. 清除后该 app 恢复自动调度资格。
3. 如有必要，可提供“立即触发一次 tick”的按钮，但此按钮必须在状态已恢复后使用。

## 5. 实施范围

### 本次必须完成

1. 后端调整 app 运行态管理逻辑。
2. timeout 后阻断自动再次调度。
3. 前端增加状态展示与人工处理入口。
4. 为 timeout 相关配置、状态、日志补充必要说明。

### 本次不做

1. 不实现真正中止底层 LLM/MCP 请求的能力。
2. 不引入全局任务队列系统。
3. 不引入 document/note/email 级统一租约模型。

## 6. 推荐修改点

### 后端

1. `lib/app-clock.js`
2. `server/index.js`
3. 必要时新增 AppClock 运行状态持久化或运行态查询接口

### 前端

1. App 管理或系统设置页面中的运行状态面板
2. 对应 store / API

## 7. 验收标准

1. 某个 app 运行中时，后续调度不会重复进入。
2. 某个 app timeout 后，不会自动再次 tick。
3. 管理员可在前端看到该 app 已 timeout。
4. 管理员可手动恢复该 app。
5. 恢复后该 app 能重新参与自动调度。

## 8. 交付物

1. 代码修改
2. 自测记录
3. timeout 场景复现与恢复演示
4. 前端界面截图

✌Bazinga！
