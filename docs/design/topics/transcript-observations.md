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
