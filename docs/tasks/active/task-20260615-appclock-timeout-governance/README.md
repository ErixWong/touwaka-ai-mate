# Task: AppClock Tick Timeout 治理与人工介入机制

## 目标

围绕 `AppClock` 当前的 tick 超时、重复调度和人工干预缺口，形成下一轮优化任务基线，指导后续内部实施或外包交付。

本任务不是立即重构全部调度框架，而是先把问题抽象、约束、设计方向和验收标准沉淀清楚，避免后续继续围绕局部 timeout 打补丁。

## 背景

近期在文档平台 OCR 同步与 finalize 链路中，已经确认以下事实：

1. `doc-ocr-pipeline` 的真实业务执行可能超过 `AppClock` 当前默认 30000ms tick watchdog。
2. tick timeout 发生后，`Promise.race()` 会让 `AppClock` 外层尽快判失败，但底层脚本未必真正停止。
3. `AppClock` 目前在 `finally` 中释放 `runningApps`，这意味着 timeout 后真实脚本若仍在后台执行，后续调度可能误以为该 app 已空闲。
4. 当前平台中不同 app 的业务对象完全不同，可能处理 document、note、向量化、todo、邮件等，因此平台层不能把“document 阶段租约”写死到通用调度器里。
5. 基于上述约束，当前阶段更合理的目标不是引入复杂的全局业务 lease 语义，而是先把 `AppClock` 收敛成只感知“某个 app 的 tick 脚本是否仍在运行”，并在 timeout 后进入明确的人工介入状态。

## 已确认问题

### 1. timeout 语义与真实执行生命周期不一致

当前 `AppClock` 的 timeout 由 `Promise.race()` 实现：

1. 外层超时只会结束等待，不会真正取消底层脚本。
2. 因此“tick failed”不等于脚本已停止。
3. 这会造成“平台已判失败，但业务仍继续执行”的分叉状态。

### 2. app 级运行锁释放过早

当前平台已有 `runningApps` 防重入机制，但其生命周期绑定在 `invokeTick()` 的 `try/catch/finally`。

一旦 timeout 抛错：

1. `finally` 仍会执行。
2. `runningApps.delete(app_id)` 仍会发生。
3. 如果真实脚本尚未结束，则后续 tick 存在误重入窗口。

### 3. 平台缺少“已超时待人工处理”状态

现在 timeout 只会记一条失败日志，并计入 failure/cooldown。问题在于：

1. 用户无法从前端明确看到“某个 app 被卡住了”。
2. 用户无法明确区分“暂时失败可继续自动调度”与“已经超时，必须人工确认再恢复”。
3. 平台默认继续按自动调度思路运行，但这一行为并不符合当前系统对多种异构 app 的抽象边界。

## 本次任务的核心设计结论

### 结论 1：AppClock 只负责 app 级 tick dispatcher 运行态

本轮优化不要求平台理解每个 app 内部的业务 work unit，也不要求平台统一管理 document/note/email 等对象级租约。

平台层只需要明确：

1. 某个 app 的 tick 脚本当前是否仍在运行。
2. 如果仍在运行，则下一轮调度应跳过该 app。
3. 如果已 timeout，则进入“人工处理态”，暂停自动重试。

### 结论 2：timeout 后禁止自动再次 tick

当某个 app 的 tick 超过 `tick_timeout_ms` 后，平台应视其进入异常运行态，而不是立即释放运行锁并继续自动调度。

本轮目标原则：

1. timeout 不等于任务自然结束。
2. timeout 后不自动再次调度同一 app。
3. timeout 后要求用户从前端显式处理。

### 结论 3：前端必须提供人工处理入口

本轮优化必须新增一个面向管理员的 AppClock 运行状态面板，至少支持：

1. 查看当前 running app。
2. 查看 timed_out app。
3. 查看开始时间、持续时长、最近错误。
4. 手动解除锁。
5. 手动恢复自动调度。
6. 必要时手动重试一次 tick。

## 范围

### 本次必须完成

1. 收敛 `AppClock` timeout 语义：timeout 后不得立即释放 app 运行态。
2. 调整 app 级运行锁管理，使其跟随真实 tick promise 生命周期，而非仅跟随 `Promise.race()` 的返回。
3. 为 app 增加显式运行状态：`idle` / `running` / `timed_out`。
4. 为 timeout 场景增加人工处理机制，禁止自动再次 tick。
5. 增加管理员可见的前端状态展示与手动操作入口。
6. 补充后端日志和必要的状态记录，确保管理员能够定位 stuck/timed_out app。

### 本次不做

1. 不引入 document 级、note 级、email 级统一业务租约抽象。
2. 不把 `AppClock` 升级为通用任务编排器。
3. 不为所有 app 一次性重构成队列系统或外部 worker 模式。
4. 不要求真正终止底层外部请求（如 MCP、LLM）。
5. 不要求本次解决“后台脚本如何被硬取消”的问题。

## 推荐实现方案

### 方案 A：真实 tick promise 持有 + timeout 后进入人工处理态

推荐本轮优先实施该方案。

#### 设计要求

1. `AppClock` 需要区分：
   - dispatcher 超时
   - 真实脚本是否已 settle
2. `runningApps` 不能在 watchdog timeout 发生后立刻释放。
3. 应新增一张或复用现有运行状态记录机制，保存：
   - `app_id`
   - `run_status`（`running` / `timed_out` / `idle`）
   - `started_at`
   - `last_error`
   - `last_timeout_at`
   - `manual_clear_required`
4. timeout 后该 app 不再自动 tick，直到管理员手动 clear / resume。

#### 期望行为

1. 正常结束：
   - 状态回到 `idle`
   - 下轮可继续调度
2. 运行中：
   - 后续 clock 命中该 app 时直接 skip
3. timeout：
   - 状态改为 `timed_out`
   - 停止该 app 的自动调度
   - 前端明显提示管理员处理

### 方案 B：新增管理员状态面板

前端建议新增或扩展现有设置页中的 App 管理区域，展示至少以下字段：

1. App 名称
2. 当前运行状态
3. 当前运行开始时间
4. 当前运行持续时间
5. 最近一次成功时间
6. 最近一次失败/超时信息
7. 手动操作按钮：
   - 解除锁
   - 恢复调度
   - 手动触发一次 tick

### 方案 C：配置项收敛

与本轮 timeout 语义相关的配置应归口到系统设置 `app.*`：

1. `app.clock_interval`
2. `app.tick_timeout_ms`
3. 如后续需要，可新增 `app.tick_timeout_manual_recovery` 等布尔开关，但本轮不强制要求新增。

## 风险与注意事项

### 风险 1：timeout 过短导致误进入人工处理态

若 `tick_timeout_ms` 仍显著小于真实业务耗时，则系统会频繁将 app 标记为 `timed_out`，增加人工处理负担。

处理要求：

1. 调整默认值时必须结合真实运行日志。
2. 当前 OCR finalize 场景下，30000ms 已被证明偏短。

### 风险 2：timeout 后脚本仍在后台运行

本轮方案并不解决“如何真正杀掉底层脚本”的问题，因此必须采用保守策略：

1. timeout 后禁止自动重试。
2. 必须人工确认后再恢复。

### 风险 3：前端提示不足导致管理员误操作

如果前端只显示“失败”，但不显示“该 app 已停止自动调度且需要人工恢复”，则用户会误以为系统仍会自动恢复。

处理要求：

1. UI 中必须明确显示 `timed_out` 是阻断态。
2. 按钮文案和说明文字必须明确其影响。

## 建议涉及文件

至少预计涉及以下文件：

1. `lib/app-clock.js`
2. `server/index.js`
3. `server/services/system-setting.service.js`
4. `server/controllers/system-setting.controller.js`（若需要扩展运行态接口）
5. 现有 App 管理 / 系统设置前端页面组件
6. 对应前端 store / API 文件

## 验收标准

### 运行逻辑

1. 当某个 app 的 tick 正在运行时，后续调度不会重复进入该 app。
2. 当某个 app 的 tick 发生 timeout 时，该 app 进入 `timed_out` 状态。
3. `timed_out` 状态下，该 app 不再自动调度。
4. 管理员手动 clear / resume 后，该 app 才恢复自动调度。

### 前端可观测性

1. 管理员可以在前端看到 running / timed_out 状态。
2. 管理员可以看到最近错误和持续时长。
3. 管理员可以执行人工恢复操作。

### 回归要求

1. 不影响其他正常 app 的周期调度。
2. 不影响未 timeout 的 tick 正常完成。
3. 不引入同一 app 的自动重复执行。

## 交付要求

外包团队交付时必须提供：

1. 修改文件清单
2. 设计说明（为何采用该状态机和恢复策略）
3. 自测记录
4. 至少 1 份 timeout 场景验证说明
5. 前端界面截图或录屏说明

## 当前状态

1. 状态：active
2. 性质：下一轮优化任务定义
3. 是否已实施：否
4. 是否可直接进入开发：是

✌Bazinga！
