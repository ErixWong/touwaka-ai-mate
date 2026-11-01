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
| 7 | `persistence_capability_degraded` | `loop/orchestrator.js:1243`（启动期直调） | 已处理（warn） |
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
