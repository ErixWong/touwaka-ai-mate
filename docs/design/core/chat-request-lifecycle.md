# 聊天请求生命周期管理设计

**来源任务:** task-20260718-chat-stream-timeout-recovery-analysis（PR #965）
**日期:** 2026-07-19
**状态:** 已实施

## 一、背景与问题本质

用户与专家对话的一次流式请求（`request_id`）生命周期中，stop / recover / complete / error 四类事件的判定依据曾分散在六处：后端内存布尔标记、LLM transport 存在性、DB `chat_requests` 记录、SSE 事件、前端消息 status、前端本地兜底集合。每个竞态靠补丁式 if 修复，判定标准彼此漂移。

本设计的核心结论：**聊天请求是一等对象，其生命周期必须由单一 runtime 状态机裁决；transport 状态、SSE 事件、前端展示都只是状态机的投影，不是判定依据。**

## 二、后端：Request Runtime State Machine

### 2.1 相位定义

`StreamController.activeRequests` 是唯一 runtime 真相源（内存 `Map<requestId, RequestRuntimeState>`），相位集合：

```text
accepted → running → recovering → stopping → stopped | completed | failed
```

- `recovering`：provider 故障后当前 LL 轮处于退避/重发窗口，是显式相位而非隐式等待
- `stopping`：停止命令已接受、执行管线尚未确认收口的过渡相位
- `stopped / completed / failed` 为终态，终态与 `stopping` 是保护区，非法迁出直接忽略

转移唯一入口：`_transitionRuntimeState()`。非预期但非保护区的转移告警放行（状态机不阻塞执行管线）。

### 2.2 字段职责分层（硬约束）

| 字段 | 职责 | 约束 |
|------|------|------|
| `phase` / `stop_requested` | **决策字段**：stop/recover/complete/error 全部以此为判定依据 | 任何回调不得绕开它们做终态判断 |
| `round` / `recovery_attempt` / `round_snapshot_ref` / `has_active_transport` | **观测字段**：日志与调试 | 禁止作为决策依据 |

### 2.3 真相源三层结构

| 层 | 载体 | 职责 |
|----|------|------|
| 内存生命周期 | `activeRequests` | 决策真相源（含 recovering/stopping） |
| 持久化终态 | `chat_requests` 表 | 终态存档：`accepted/running/completed/failed/stopped/timeout` |
| DB 读缓存 | `requestStore` | 纯投影，不是独立真相源 |

约束：`recovering/stopping` 不落库；DB 枚举扩展需另行评审，不得在代码中隐式漂移。

### 2.4 残留清扫的保守 TTL 原则

执行管线正常即时删除 runtime 条目；`_sweepStaleRuntimeStates` 仅兜底，TTL 取 30 分钟（与请求最长执行时间同级）。**禁止激进 TTL**：过早清扫会丢失 `stop_requested` 信号——abort 失败、当前轮仍在长流式/长工具执行时，管线必须在下一检查点读到停止命令。活跃相位（running/recovering）永不清扫。

## 三、Stop 语义：Request 级取消，而非 Transport 级 Abort

### 3.1 判定顺序（不可颠倒）

1. 先切 runtime state：`stopping` + `stop_requested = true`（停止命令已被接受）
2. 再 best-effort abort transport（仅为实现动作之一）
3. 统一进入 `stopped`：广播 `stopped` 事件 + DB 收口

### 3.2 推论

- `stopRequest()` 返回值反映"request 是否已接受停止命令"，**禁止**以底层 socket 是否存在定义 stop 成败
- recovery 退避期无活跃 transport 时（`abort` 返回 false）停止仍必须成功——管线在下一检查点读 `stop_requested` 退出
- `stopped` 是强终态：`onComplete`/`onError` 必须有 stopped 守卫，complete 不得覆盖停止语义
- 内存态缺失（如进程重启）时回退 DB 记录收口；重复停止幂等，不重复广播
- `/api/chat/stop` 与所有接口一样走 `ctx.success()`/`ctx.error()`，禁止裸 `ctx.body` 特例结构

## 四、Provider 轮级恢复语义

### 4.1 恢复粒度

恢复粒度 = **当前失败的 LLM 轮**，禁止从 `streamChat()` 最外层重放整个 request：

- 每轮 `callStream()` 前建立 round snapshot（messages 深拷贝 + 累计内容 + token 用量），快照保留在 `_executeLLMRounds` 闭包内，controller 只存 `{round, taken_at}` 元信息
- 仅对基础设施类错误恢复（ECONNRESET/ETIMEDOUT/429/5xx/socket hang up 等白名单）；鉴权失败、参数错误、上下文超限、用户停止不恢复
- 指数退避 + 次数上限（`CHAT_STREAM_RECOVERY_MAX_ATTEMPTS`，默认 2）
- 已完成轮次的工具调用绝不重放

### 4.2 状态与事件闭环

- `running → recovering`：进入恢复（携带 round/attempt/内容快照供前端重置展示）
- `recovering → running`：退避完成、当前轮重发前发出 **`recovered`** 事件——这是闭环必需事件：缺少它，前端恢复指示只能在 complete/stopped/error 时消失，与后端状态不一致
- 恢复次数耗尽 → `failed`

### 4.3 测试注入约定

`CHAT_STREAM_TEST_FAIL_ROUND / _ATTEMPT(S) / _AFTER_CHUNKS` 仅在测试环境注入流式故障，按 `round:attempt` 键单次生效（进程重启复位）。此类变量不写入 `.env.example` 部署引导。

## 五、前端：展示与最小兜底原则

### 5.1 职责边界

前端只负责：绑定 `request_id`、展示 `streaming/recovering/stopped/completed/failed`、异常竞态一次性 reconcile。**禁止**前端膨胀出第二套业务状态机；新判断优先后端收口。

### 5.2 手动停止标记的生命周期（硬约束）

`manuallyStoppedRequestIds` 仅用于「点击停止 → 本地终态写入」窗口期的 SSE 抑制：

- 设置：调用 stop API 前
- 清除：本地终态写入后就地清除（成功/409 终态路径）；**API 失败必须回滚**（网络错误/500/409 仍活跃/reconcile 失败），禁止静默吞掉后续 SSE
- 原理：消息状态写为终态后已非 `streaming`，所有 SSE 处理器还有 streaming 状态查找条件，晚到事件自然落空——抑制的长期真相源是消息终态本身，不是标记集合

### 5.3 终态收口语义

| 终态 | 收口方式 | 约束 |
|------|---------|------|
| `stopped` | 本地累计内容即最终内容 | 后端不为 stopped 请求保存 assistant 消息 |
| `completed` | **必须从 DB 同步最终消息**（复用 `syncCompletedRequest`，显式移除临时消息） | 禁止以流式中间态冒充最终回答；临时消息必须被真实 ID 替换，否则 heartbeat 增量同步产生重复 |
| `failed` | 错误信息收口 | 恢复指示清理 |

### 5.4 缓冲纪律

`flushBuffers` 无流式目标时必须**丢弃** `contentBuffer/reasoningBuffer`（孤儿数据语义），禁止残留污染下一次流式会话的首次 flush。

## 六、禁止事项汇总（跨任务复用）

1. 不得把 transport 存在性当作 request 生命周期判定依据
2. 不得新增横向布尔状态或前端本地补丁集合替代状态机
3. 不得从 `streamChat()` 最外层重放 request 实现恢复
4. 不得绕过 `_transitionRuntimeState()` 直接改写 phase
5. 不得让 `complete`/`error` 事件覆盖 `stop_requested` 已置位的请求
6. 不得用裸 `ctx.body` 返回聊天类接口
7. 清扫 runtime state 的 TTL 不得短于请求最长执行时间预期

## 七、验证基线

以下三条 Playwright 主用例是本设计的回归基线（故障注入参数见 §4.3）：

1. 第 2 轮单次恢复成功：`running→recovering→running→completed`，前轮工具不重放
2. recovering 期间手动停止：`recovering→stopping→stopped`（无活跃 transport 仍成功）
3. 恢复次数耗尽：两次 `recovering↔recovered` 后 `failed`

模块级回归：`tests/stream-controller-runtime-state.test.js`（状态机转移/保护区/stop 幂等/DB 回退/管线守卫/清扫路径）。
