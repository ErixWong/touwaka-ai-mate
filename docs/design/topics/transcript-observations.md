# 转录持久化上线观测（#1227 收尾项）

> 首次采集：2026-11-02 01:2x（UTC+8），生产库 `touwaka_mate`，**全部只读查询 + 容器日志计数**。
> 用途：给"canonical 存档 + 可重建投影"这套存储留一条**可比较的基线**——以后投影写放大、索引成本、降级噪声变了没有，拿这里对。

## 1. 行数与写放大

| 指标 | 实测 |
|---|---|
| 请求数（有 canonical 行的 `request_id`） | 41 |
| `agent_transcript_rounds`（canonical 引擎存档） | 193 |
| `agent_rounds`（可重建投影） | 193 |
| `chat_tool_calls` | 62 |
| `messages`（应用账本，全量历史） | 2678 |
| **行/请求**（canonical 与投影**相等**） | **4.71** |

单请求 canonical 行数 Top5：`22 / 18 / 17 / 12 / 11`（多工具链的请求才是大头，中位数远小于均值）。

**读法**：canonical 与投影行数**一比一**是设计后果（投影 = canonical 展开的消息行 + 载体行，见 `docs/design/topics/agent-message-lifecycle.md`），不是异常。**每请求约 4.7 行存档 + 4.7 行投影**是这套方案的真实写放大。

## 2. 空间与索引

| 表 | 数据 | 索引 |
|---|---|---|
| `agent_transcript_rounds` | 2.25 MB | 0.03 MB |
| `agent_rounds` | 1.50 MB | 0.05 MB |
| `chat_tool_calls` | 0.11 MB | 0.05 MB |
| `messages` | 41.50 MB | 1.09 MB |

- 引擎两表合计不到 4 MB，**成本大头仍是 `messages`**（应用账本，与本次迁移无关）。
- `idx_agent_rounds_request_kind` 的"值不值"已由**真实消费者**兑现：`EXPLAIN` 在投影重建/对账路径上命中该索引（`key=idx_agent_rounds_request_kind`、`key_len=325`，见 #1227 线上 e2e 证据评论 `6551454834`），不是"建了没人用"。
- MariaDB 的 `information_schema.STATISTICS` **没有** `STAT_VALUE` 列（MySQL 才有），想按索引估字节得走 `information_schema.TABLES.index_length` 或 `mysql.index_statistics`——记在这里免得下次又踩。

## 3. 冲突与降级

| 计数（近 24h 容器日志） | 值 |
|---|---|
| `erix.transcript_dedup_conflict` | **0** |
| `erix.persistence_capability_degraded` | **16** |
| `erix.unhandled_event` | 6 |

降级事件的原文形状（用于以后 grep）：

```json
{"event":"erix.persistence_capability_degraded","request_id":"req_…","runId":"req_…","method":"saveRunState"}
{"event":"erix.persistence_capability_degraded","request_id":"req_…","runId":"req_…","method":"saveRunSnapshot"}
```

**16 条全部落在 `saveRunSnapshot` / `saveRunState` 两个口上**——这把"`erix.persistence_capability_degraded` 策略"这条悬了很久的待决项**具体化了**：不是随机噪声，是**宿主没有实现 0.29 的 run snapshot / run-state 端口**，引擎每次要存都降级一次并记一条日志。二选一，没有第三条路：

- **实现它**：需要一张 run 状态表（新增表 = DDL，按红线要 Eric 点头），换来"可从中途轮恢复/审计预算"能力；
- **正式承认为预期降级**：把这两个事件按能力名降噪（例如每请求每能力只记一次），文档写明"宿主不持久化 run-state，恢复靠 canonical 重放"。

> **2026-11-02 裁定：选后者（B）**——正式承认为预期降级并按 capability 名降噪，**不补**端口、**不动 DDL**。
> 上面那行「两个口」在本单里被更正为**三个方法**（漏了 `markRunState`）。落地细节、三条成立判据、
> 以及「什么变化会让 B 失效」全部收在 **§8**。

## 4. 接口延迟（#1227 阶段 4 的最后一格，现已有数）

用仓库自身的 JWT 签发路径签短期票，打**生产 3017** 真接口，各 40 次（`curl %{time_total}`，loopback、热连接、单客户端）：

| 接口 | 状态分布 | p50 | p95 | max |
|---|---|---|---|---|
| `GET /api/messages/expert/<id>?page=1&limit=20` | 200 × 40 | 14 ms | **17 ms** | 20 ms |
| `POST /api/messages/query`（终稿行带 `run_reasoning_content` 拼接） | 200 × 40 | 14 ms | **20 ms** | 21 ms |

**读法与限制**（别把这张表当成能外推的数字）：
- 没有文档化的既有 SLO 阈值可引，所以这里只报**实测值**，不写"达标/不达标"——**整段思考拼接这条新读路径没有把列表接口拖到可感知量级**是本次唯一能下的结论。
- loopback + 热连接 + 单客户端 + 2678 行 `messages` 的小数据集 ⇒ **不能**当容量规划输入；跨网络/并发/大库要另测。
- 测量踩坑（值得记）：`POST /api/messages/query` 的契约是 `filter.expert_id`（缺了返回 `code:400`），我第一遍把 `request_id` 放在顶层 ⇒ 40 次全是 400，量出来 **p95=6ms** 看着极快，其实测的是错误响应。**延迟数字必须和状态码分布一起看**，否则就是"绿得没道理"。

## 5. 采不到什么（诚实清单）

1. **append 事务 p95 采不到**：当前**没有任何 append 耗时打点**（日志里搜 `append|transcript` + `ms|duration|elapsed` 零命中）。要这条指标必须先加打点——属于新需求，不混进迁移单。
2. **无历史对比基线**：本文是第一份。以后任何"迁移后变慢/变大"的结论都必须引用本文的具体数字，而不是"感觉变多了"。
3. **单实例前提**：所有按请求的单调/一致性结论都只在"单进程写库"下成立（见全局 ID 约定）；多实例部署时要重新评估。

## 6. #1227 阶段门禁逐格裁定（2026-11-02 01:3x 收口）

| 阶段 4 门禁 | 结果 |
|---|---|
| `dedup_payload_conflict` 只对应真实冲突 | 近 24h **0 条**冲突事件（且 Phase 2 契约测试钉住语义） |
| `invalid_messages` / persistence error 不高于基线 | 容器日志真实异常 **0** |
| 读 parity 无未解释差异 | **全库 41 个请求：三格全等 41、块形状全等 41、`GATE_EXIT=0`**；剩余 15 个 `content_diff` 已归因（展示面不存 `erix` / `metadata` / 浮点 `duration` / 每条消息 `ts` 信封，基线既有、无新增无加重） |
| 消息列表 p95 | 见 §4：列表 **17ms** / 查询 **20ms**（p50 均 14ms，40/40 全 200） |
| 演练 `new→legacy` 回滚 | 见 `transcript-rollback-drill.md`：回滚 → **`GATE_EXIT=3`（23 条全 `parity_regression`）** → 修复 → **`GATE_EXIT=0`**，往返与生产 CRC 相同 |

**全库对账（2026-11-02 01:2x，`--limit 200` 覆盖全部 41 个请求）＝零漂移**：`tool_error A=0 / B=11 / C=0 / unchanged=51`、`folded` 全零（193 行）、`reasoning A=0 / B=92 / C=0（C_derived=0 / C_opaque=0）`，`canonical_plan` / `record_json_plan` / `reasoning_plan` **全空**。

**唯一没满的一格是"观察期"本身**——它天然是时间函数，不是我能在一个通宵里造出来的事实。所以**关闭判据写成一条可跑的断言，而不是日期或版本号**：

> 下一次真实业务流量之后，复跑 `node scripts/verify-transcript-projection.mjs --limit 200 --fix-is-error --fix-folded --fix-reasoning --rewrite-record-json --dry-run` 仍得 **三份 plan 全空 + 三个方向 A=0/C=0**，且 `verify-transcript-read-parity.js --gate` 仍 `GATE_EXIT=0` ⇒ #1227 可关闭。

**判据复跑记录（2026-11-02 01:29，#1238 部署之后）**：

```
tool_error_directions.summary = {"A":0,"B":11,"C":0,"unchanged":51,"total":62}
folded_directions.summary     = {"A":0,"B":0,"C":0,"unchanged":199,"total":199}
reasoning_directions.summary  = {"A":0,"B":94,"C":0,"unchanged":0,"total":94,"C_derived":0,"C_opaque":0}
canonical_plan / reasoning_plan / record_json_plan = 全空
reconciliation.diffs 非空的请求 = 0 / 43        孤儿请求 = 0
verify-transcript-read-parity --gate（基线=全库快照）：GATE_EXIT=0
  请求 43（0.23 形状 13 / 老账本 30）；三格全等 43；块形状全等 43；宿主增强 reasoning 0
  parity 仍有 20 个会话 content_diff（存量展示面漂移，逐请求与基线比过：无新增、无加重）
```

两点必须说清，否则这条记录会被高估：

1. **新增的 2 个请求是 agent 自己造的流量**（#1238 真机复验与 worker 验证产生），**不是用户业务流量**。判据的措辞是"业务流量"，所以这一格**形式上过了、语义上还差用户真实使用**——不要因为这条记录就宣布观察期结束。
2. 两条判据都**必须** `export ALLOW_NON_TEST_DB=1` 才能对生产库跑：脚本的测试库白名单只放 `llm_kit_test`，`--gate` / `--dry-run` 全程只 SELECT，放行时会打 WARN 不静默。另外脚本读 `process.env.DB_*`（**不读** `config/config.json`），宿主上必须显式导出 `DB_HOST=127.0.0.1 DB_PORT=3306`，否则会连到默认库并**安静地返回 0 个请求**（我就据此得出过一次假的"没有匹配的 request_id"）。

后续工作已全部拆成独立单：**#1246**（批量写备份前置闸 + 回滚 SQL 带 `utf8mb4`）、**#1249**（run snapshot / run-state 持久化二选一）、**#1250**（`complete` 一致性格夹具改单轮）。

## 7. erix 事件面分布（#1255，erix-agent 0.29.0）

§3 那张表里 `erix.unhandled_event` 那一格（当时 6 条）在 #1255 被查清了：**全部是 `run_outcome`**——引擎每个 run 恰好发一条 run 级终局汇总，宿主一条都没接。这一节把事件面按「宿主怎么处置」摊平，以后再加事件时**先看这张表**。

### 7.1 账表：25 = 14 + 6 + 4 + 1

口径：**只数 touwaka 这条接线实际能收到的类型**（见 §7.3 的排除项）。发射点全部在引擎 `node_modules/erix-agent/src/`，处置点在宿主 `lib/agent/agent-loop.js`。

| 处置 | 种数 | 位置 |
|---|---|---|
| 已处理（`HANDLED_ERIX_EVENT_TYPES` 6 + `switch` 8） | **14** | `lib/agent/agent-loop.js:30`（常量）、`:193` 起（switch） |
| 显式白名单（打 DEBUG + 计数，不打 WARN） | **6** | `lib/agent/agent-loop.js:50`（`DELIBERATELY_IGNORED_ERIX_EVENT_TYPES`） |
| 故意保持 WARN（不进白名单） | **4** | 落到 `lib/agent/agent-loop.js:340` 的 `default` |
| 新增 INFO（`erix.run_outcome`） | **1** | `lib/agent/agent-loop.js:205` 的 `case 'run_outcome'` |
| **合计** | **25** | |

逐格点名（引擎发射点 → 宿主处置）：

| # | 类型 | 引擎发射点 | 宿主 |
|---|---|---|---|
| 1 | `round_start` | `loop/orchestrator.js:4790` | 已处理（常量） |
| 2 | `attempt` | `loop/provider-runner.js:171` | 已处理（常量） |
| 3 | `recovering` | `loop/provider-runner.js:342` | 已处理（常量） |
| 4 | `recovered` | `loop/provider-runner.js:279`、`:294` | 已处理（常量） |
| 5 | `usage` | `loop/provider-runner.js:184`、`loop/orchestrator.js:4849`、`:4921` | 已处理（常量） |
| 6 | `round_end` | `loop/orchestrator.js:5474` | 已处理（常量） |
| 7 | `persistence_capability_degraded` | `loop/orchestrator.js:1243`（启动期直调） | 已处理（**按 `method` 分流**：#1249 起清单内 debug、清单外仍 warn，见 §8） |
| 8 | `forced_final` | `loop/termination.js:648` | 已处理（warn） |
| 9 | `tool_output_aggregate` | `loop/run-snapshot-executor.js:217` | 已处理（info/error/warn 按 action） |
| 10 | `final_guard` | `loop/termination.js:381/391/423/437/448/463/493/507`、`loop/orchestrator.js:5534/5549/5626` | 已处理（按 action 分三级） |
| 11 | `compaction` | `loop/orchestrator.js:2354` | 已处理（info） |
| 12 | `tool_use` | `loop/orchestrator.js:4600`、`:4989` | 已处理（debug 计数） |
| 13 | `tool_result` | `loop/orchestrator.js:4675`、`:5042` | 已处理（debug 计数） |
| 14 | `tool_replay_decision_required` | `loop/orchestrator.js:4664` | 已处理（warn） |
| 15 | `continuity_written` | `loop/orchestrator.js:3240` | **白名单**（需 `config.continuity.handoff≠off`） |
| 16 | `continuity_write_failed` | `loop/orchestrator.js:3127`、`:3205`、`:3251` | **白名单**（同上） |
| 17 | `continuity_injection_skipped` | `loop/orchestrator.js:3269` | **白名单**（同上） |
| 18 | `final_guard_extend` | `loop/orchestrator.js:4517` | **白名单**（需传 `finalGuard`） |
| 19 | `config_override_conflict` | `loop/orchestrator.js:1271`（启动期直调） | **白名单**（需扁平名与 `config.*` 同键异值） |
| 20 | `resume_journal_skipped` | `loop/orchestrator.js:2845` | **白名单**（需传 `resume`） |
| 21 | `compaction_strategy_fallback` | `loop/orchestrator.js:3808` | **保持 WARN**（触发即压缩真的开始了） |
| 22 | `compaction_deferred` | `loop/orchestrator.js:4884` | **保持 WARN**（尾部未完结的 tool_use） |
| 23 | `budget_below_working_set` | `loop/orchestrator.js:4056` | **保持 WARN**（预算配小了，run 会提前结束） |
| 24 | `model_metadata_missing` | `loop/orchestrator.js:1304`（启动期直调） | **保持 WARN**（当前被显式 `budgetTokens` 抑制） |
| 25 | `run_outcome` | `loop/orchestrator.js:1401`（`runOutcomeRecord()`） | **新增 INFO** |

### 7.2 白名单的四条「结构上不会发」判据（会随接线变化失效）

白名单不是「不认识的都静默」——它只装**当前接线结构上不可能发生**的类型，每条都带复开判据（源码注释在 `lib/agent/agent-loop.js:50`）：

| 类型 | 为什么现在不会发 | 什么变化会让它复活 |
|---|---|---|
| `continuity_*`（3 种） | `config.continuity.handoff` 缺省 `off`（`loop/orchestrator.js:778` 归一、`:484` 默认值），`off` 时读/写路径首行 return（`:3122` / `:3227`）。宿主从未配置（`grep -rn "continuity" lib/ server/` = 0） | 给 `config.continuity.handoff` 赋 `prompt` / `prompt-and-fallback` |
| `final_guard_extend` | 只在 `extendAfterGuard` 里发（`loop/orchestrator.js:4517`），该路径要求宿主传 `finalGuard`；`grep -rn "finalGuard" lib/ server/` = 0 | 接入 `finalGuard`（`final_guard` 会一起出现） |
| `config_override_conflict` | 要求同名扁平键与 `config.*` 同键异值（`loop/orchestrator.js:1271`）；宿主走 0.29 纯嵌套，扁平名会被名称闸口当场拒 | 重新引入扁平别名 / 装配口 policy 与调用级 config 双源 |
| `resume_journal_skipped` | 只在恢复路径发（`loop/orchestrator.js:2845`），需传 `resume`；宿主未接 resume/replayPolicy | 接入崩溃续跑（`tool_replay_decision_required` 会一起复活） |

### 7.3 为什么不数「引擎里出现的所有 type」：5 种结构上收不到

扫引擎源码能扫出 28 种 `emitEvent({type:...})` / 直调 `onEvent` 的类型，比 25 多 3 种；另有 2 种不走 `onEvent`。**不要把它们算进宿主的事件面**，否则账永远对不上：

- `delta` / `reasoning_delta` / `tool_call`：只在**引擎自带 provider** 里发（`providers/openai.js:550`、`:558`、`:565`、`:574`）。touwaka 注入自己的 provider（`createTouwakaProvider`），而引擎给 provider 的 request 里**没有 `onEvent`**（`loop/provider-runner.js:200-215` 的 request 字段表里没有它），所以 touwaka 适配器里那几处 `request.onEvent?.(...)`（`lib/llm-kit-adapters/provider-adapter.js:218`、`:482`、`:488`、`:502`、`:531`）在这条链路上恒为空转。
- `context_unknown_option`（`assembly.js:928`）：只经 `createAssemblyPort` 的 `port.emit` 发出，宿主没用装配口。
- `persistence_error`（`loop/orchestrator.js:314` 构造）：出口是 `onPersistenceError` 回调 + 错误账本（`:1161`），**不走 `onEvent`**。

### 7.4 类型面不可当穷举依据（重要）

引擎的 `LoopEvent` 联合类型只列 **19** 种（`node_modules/erix-agent/src/loop/orchestrator.js:389` 的 `@typedef`，**不是** `.d.ts`——0.29.0 发布的 `src/*.d.ts` 里根本没有事件类型 union，只有 `assembly.d.ts` 提了一句 `onEvent` 是 sink）。缺的 6 种是 `continuity_written` / `continuity_write_failed` / `continuity_injection_skipped` / `final_guard_extend` / `forced_final` / `tool_output_aggregate`——它们全都在行为面上真实发射。

所以：**`@typedef` 少列 ≠ 引擎不发**。唯一可靠的发现通道是宿主 `default` 分支那条 `erix.unhandled_event` WARN（`run_outcome` 就是这么被发现的：现网 24h 8 条 WARN、每 run 恰好一条）。这也是 #1255 坚持「未知事件必须继续 WARN」的原因：白名单一旦变成「其他一律静默」，下一种新事件就会**永远不被发现**。

### 7.5 新增的观测面：`erix.run_outcome`

`run_outcome` 是 run 级终局裁决（引擎 `loop/judge-record.js` 的 `runOutcomeRecord()`），载荷**刻意克制**：没有 `ts`、没有 usage 汇总、没有 `finalText`；`judgeRecordCount` 对 touwaka 恒 0（不传 `onJudge`），`verification` 恒 `skipped/no_final_guard`（不传 `finalGuard`）。

宿主只打一条 INFO（不落库、不加 DDL），字段：`request_id` / `runId` / `model` / `rounds` / `termination.{reason,errorCode,forcedFinal,detail}` / `verification.status`，其中**所有字符串字段截断到 500 字符**（`termination.detail` 可能是整条错误 message 或预算串）。缺失字段写 `null`，不写字符串 `"undefined"`。

在此之前「这个 run 怎么结束的」在生产上是黑洞（`grep -rn "\.termination" lib/ server/` = 0 命中）。判据格在 `tests/agent/erix-event-policy.test.mjs`（8 格，含「未知事件仍 WARN」与「白名单与 switch case 不相交」两条自证）。

## 8. `persistence_capability_degraded` 的裁定 B：预期降级 + 按 capability 名降噪（#1249）

> 裁定：Eric，2026-11-02。**降噪生效日：2026-11-02**（代码落在 `lib/agent/agent-loop.js` 的
> `EXPECTED_UNIMPLEMENTED_CAPABILITIES`，与 #1255 的事件白名单**同一哲学、同一实现位置**）。
> 本节写的是**判据与触发条件**，不写排期、不写版本号。

§3 那条「二选一，没有第三条路」在本单定了：选 **B —— 正式承认为预期降级并降噪**。
**不补** run-state / run-snapshot 端口，**不动 DDL**（`llm_kit_run_checkpoint` 空表**保留**，退役 = DDL，未排期）。

### 8.1 现网事实（2026-11-02，近 24h 容器日志）

| `method` | 条数 |
|---|---|
| `markRunState` | 4 |
| `saveRunState` | 4 |
| `saveRunSnapshot` | 1 |
| **合计** | **9** |

**是三个方法，不是两个**——§3 当时只数到 `saveRunSnapshot` / `saveRunState`，漏了 `markRunState`
（run 起止标记，同属 run-state 一族，同样每 run 一条）。

引擎语义（erix-agent **0.29.0**，`node_modules/erix-agent/src/loop/orchestrator.js:1230-1257`）：
`saveRunSnapshot` / `loadLatestRunSnapshot` 与 `saveRunState` / `loadRunState` / `markRunState` 全是
**可选 capability**；缺失 ⇒ **每方法一条** `persistence_capability_degraded`（`Set` 去重、每 run 每方法一条），
然后**整轮跳过**，**run 正常执行**（只失去中途 crash resume）。必需面只有 `{appendRound, load}`。

### 8.2 B 成立的三条判据（可复核事实，不是判断）

| # | 判据 | 复核方式（`file:line` / 命令） |
|---|---|---|
| ① | 宿主**刻意只实现 4 个方法**，run-state / run snapshot / checkpoint 一族全不实现 | `lib/llm-kit-adapters/loop-bridge.js:330`（`createErixStore` 返回对象只有 `appendRound` / `load` / `loadByDedupKey` / `loadMaxRound`）；「有意不实现」的理由注释在同文件 `:313-317` |
| ② | 这些端口的**唯一读者是 `resume`**，而 touwaka 从不传 `resume` | 读者：`node_modules/erix-agent/src/loop/resume-manager.js:157`（`loadRunState`）、`:284`/`:469`（`loadLatestRunSnapshot`），且 `:158` 的守卫是 `if (!ctx.resume …) return "absent"` ⇒ 不传 resume 时连读都不读；宿主侧 `grep -rn "resume" lib/llm-kit-adapters/loop-bridge.js lib/agent/agent-loop.js` **只有注释**，`grep -rn "resume" lib/agent/ lib/chat-service.js` 无 `config.run.resume` 赋值 |
| ③ | 压缩侧同样没有「中途恢复」的需求在驱动它 | 生产 30 天 **压缩 0 次、`folded` 全 0**。复核：容器日志 `grep -c '"event":"erix.compaction"'`；库侧 `SELECT COUNT(*) FROM agent_transcript_rounds WHERE JSON_EXTRACT(record_json,'$.folded') = TRUE;`（两条都应为 0） |

三条合起来：**补这些端口买不到调用方**（①②），也没有压缩/长跑的需求在推（③）
⇒ 每 run 3 条 WARN 换不来任何能力，纯噪声。

### 8.3 降噪是怎么做的（按 capability 名，不按事件类型）

在 `case 'persistence_capability_degraded'` **之内**读载荷的 `method` 字段（引擎真实字段名是 `method`，
不是日志里那句 `"method":"saveRunState"` 的文本形状——载荷结构见 `orchestrator.js:1243-1250`：
`{type, runId, parentRunId?, method, detail}`），然后三分：

| 情形 | 处置 | 为什么 |
|---|---|---|
| `method` ∈ `EXPECTED_UNIMPLEMENTED_CAPABILITIES`（当前 3 个） | **DEBUG** + 按方法名计数（`erix.persistence_capability_degraded_expected`） | 我们知道自己没实现、且已裁定不实现 |
| `method` **不在**清单里（如引擎把某个必需端口报成降级） | **WARN**（`erix.persistence_capability_degraded`，字段与降噪前逐字段一致） | 这是**信号**：端口该有却没有了。绝不能哑 |
| **缺 `method` 字段** / 脏值 | **WARN** | 防引擎换字段名 = 发现通道被静默拔掉 |

**为什么不按事件类型整体降噪**：这一种事件同时承载两件性质相反的事——「我们刻意没实现的可选端口」
（噪声）与「引擎认为该有的端口不见了」（信号）。把 `persistence_capability_degraded` 整个塞进
§7.1 那张类型白名单，等于把后者一起埋掉，也就把「将来引擎换端口」这条唯一的发现通道拆了。

**降噪的机制只有一个**：生产 `LOG_LEVEL` 缺省是 `info`，而 `lib/logger.js:109` 的 `debug()` 在非 `debug`
级别直接 return ⇒ 这 3 条不再进生产日志。没有改采样、没有改事件名（WARN 那条保持原名，既有看板/grep
口径不变）、没有落库、没有 DDL。

**刻意不进清单的两条**：`loadRunState` / `loadLatestRunSnapshot`（`resume-manager.js:161`、`:469`）。
它们同属「没实现的可选端口」，但只在 resume 路径上发；现在恒不发。把它们也塞进清单，等于「哪天有人接了
resume 却忘了实现 loader」时我们哑掉——那恰恰是最该报警的场面。

### 8.4 什么变化会让 B 失效（触发条件，不是排期）

三条任一成立 ⇒ 回来看这张清单，删掉对应方法名（或整张表）、补端口，并把
`resume_journal_skipped` / `tool_replay_decision_required`（同属 resume 路径，见 §7.2）一起重新评估。

| # | 触发条件（可复核事实） | 为什么它推翻 B |
|---|---|---|
| a | **出现第一条真死在 `running` 的请求**：#1264 的自愈把它结算成 `failed` 且 `error_message='进程中断，请求未完成'`，且**一周内 ≥3 条** | 「进程中断即丢」的代价从理论变成事实：此时 resume 有真实调用方，② 不再成立 |
| b | **常态轮数明显超过当前均值 4.59**（口径：`agent_transcript_rounds` 里每请求 `MAX(round_no)` 的均值，`SELECT AVG(m) FROM (SELECT MAX(round_no) AS m FROM agent_transcript_rounds GROUP BY request_id) t;`），**且带副作用工具的重试开始造成重复写** | 长 run 里「重跑整段」会重放写操作，重放安全（snapshot / run-state）不再是理论问题 |
| c | **有人要接「长任务 / 关页面后续跑」产品需求** | 需求侧直接要求 resume，① 与 ② 同时被推翻 |

> 这三条**不是计划表**：没有日期、没有版本号、没有负责人。它们只回答「什么证据出现时，这份『预期』
> 就不再成立」。判据 a 的 4.59 / ≥3 两个数字都是**当前实测值**，不是目标值。

### 8.5 `llm_kit_run_checkpoint` 空表：保留

表已存在、**0 行、无写入方**（`docs/design/data-model.md` §3）。B 的裁定**不动它**：
退役一张表 = DDL，未排期；保留的代价是零行零索引开销，而删掉会让「将来决定补 run-snapshot」多一次迁移。
`persistence_capability_degraded` 的降噪**不依赖**这张表存在与否（引擎只问 store 有没有方法）。

### 8.6 判据格

`tests/agent/erix-expected-capability-degradation.test.mjs`（9 格）：清单内 3 方法 DEBUG + 计数且零 WARN、
**未知方法名仍 WARN**（本单最重要的一格）、必需端口（`appendRound`/`load`）仍 WARN、缺 `method` 仍 WARN、
脏值不做宽松匹配、清单常量与实现双向一致（引擎侧发射点交叉核对 + `createErixStore` 反向核对）、
降噪不波及同窗口的 `run_outcome`（仍 INFO）。每格都配了能把它打红的变异，红名单见 #1249 执行报告。
