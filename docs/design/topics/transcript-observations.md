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

## 4. 采不到什么（诚实清单）

1. **append 事务 p95 采不到**：当前**没有任何 append 耗时打点**（日志里搜 `append|transcript` + `ms|duration|elapsed` 零命中）。要这条指标必须先加打点——属于新需求，不混进迁移单。
2. **无历史对比基线**：本文是第一份。以后任何"迁移后变慢/变大"的结论都必须引用本文的具体数字，而不是"感觉变多了"。
3. **单实例前提**：所有按请求的单调/一致性结论都只在"单进程写库"下成立（见全局 ID 约定）；多实例部署时要重新评估。
