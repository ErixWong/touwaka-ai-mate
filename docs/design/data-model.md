# Touwaka 数据模型

本文档登记 touwaka 主库（`touwaka_mate`，MariaDB/InnoDB，utf8mb4）中
由应用代码直接维护的横切数据表与 ID 前缀约定。各平台专属表（文档平台等）
见 `docs/design/doc-platform/data-model.md` 等专题文档；全量表结构以
`scripts/upgrade-database.js` 增量迁移与 `models/` 生成物为准。

## 表登记

### 1. `note_record`

对应模型：`models/note_record.js`（sequelize-auto 生成物，禁止手改）

引入：issue #1132 决策 3 修订（Phase 3 阶段三）。erix NoteRecord 的
持久化存储，替代阶段二的 Redis 方案（Lua CAS + PXAT）。
**#1132 决策 3 里的「存储层乐观锁（record_version CAS）并发校验已于 issue #1203
废除，只留 `uk_scope_ref_key` 唯一键这一层**：notes 是小抄，语义就是 key/value +
更新时间，不该有版本号；读-改-写由调用方（LLM）自己负责，真撞了就后写覆盖。

作用：

- 存储 erix `NoteRecord` 完整 JSON（`record` 列，LONGTEXT）
- `scope_ref` + `note_key` 唯一键定位一条笔记（唯一的并发约束，#1203 后再无其他）
- `expires_at`（BIGINT，毫秒时间戳）为 TTL 唯一权威；read/list 不续期，
  命中过期行时惰性 DELETE

关键字段：

| 字段 | 说明 |
|------|------|
| `id` | 行 ID，`nr_` 前缀 + `Utils.newID(20)` |
| `scope` | 固定 `'run'`（erix 协议），默认由 DDL 填充 |
| `scope_ref` | 稳定 scopeRef，`buildNotesScopeRef(user_id, expert_id)` 派生（`notes-v1:<sha256-24>`），禁用 request_id/run_id |
| `note_key` | 笔记 key（如 `wm_<ts>_<rand>`） |
| `record` | 完整 NoteRecord JSON（erix 协议字段 camelCase；touwaka 扩展字段如 `record_version`/`legacy_metadata` 为 snake_case） |
| `record_version` | 写入指纹，`Utils.newID(20)` 随机串：**列保留、每次写入照常生成新串**，但自 issue #1203 起不再作并发判据（UPDATE/DELETE 均不带版本条件），读回只供调用方对账 |
| `expires_at` | 过期时间（ms），取自 `record.expires_at`（adapter/facade 统一注入）；`NULL` 表示不过期 |
| `created_at` / `updated_at` | 应用侧写入的毫秒时间戳 |

索引：`PRIMARY KEY (id)`，`UNIQUE KEY uk_scope_ref_key (scope_ref, note_key)`，
`KEY idx_expires_at (expires_at)`。

并发语义（issue #1203）：同 key 并发写 = **后写覆盖（LWW）**，端口与存储层都不再做
版本/谱系校验。更新路径 `UPDATE ... WHERE scope_ref = ? AND note_key = ?
AND (expires_at IS NULL OR expires_at > ?)`（已去掉 `AND record_version = ?`）；
影响行数 0 = 没有活行（不存在 / 只剩过期残留 / 刚被并发删除），按原语义落回 INSERT
创建路径，不把「没更到」包装成冲突错误。**唯一键仍是硬约束**（一个 key 一行）：
并发创建竞态撞 `ER_DUP_ENTRY` 且残留的是活行时，显式抛
`NotesStoreError(code: notes_unique_key_conflict)`（旧 `notes_cas_conflict` 已随
CAS 一起退役，错误文案不再提版本）。`record_version` 列继续写，DDL 不变。

访问入口：`lib/notes/db-note-record-store.js`（raw SQL，经 `lib/db.js` 的
`query/getOne/insert/execute`）；不写 Sequelize 模型 API。

### 2. `agent_transcript_rounds`

对应模型：无。与 `agent_rounds` / `chat_tool_calls` 同例，**未注册进
`models/init-models.js`**，访问走裸 SQL；`models/` 为生成产物且禁手改。

引入：issue #1156 决策①与③′（Eric 已拍板，2026-10-09）。erix `RoundRecord`
的 **canonical 存储（引擎面唯一真相）**，取代以 `agent_rounds` 为真相的旧形状。
本阶段（Stage A）**只建表、不接代码**：`lib/llm-kit-adapters/` 与 `lib/agent/`
一行未改，线上行为零变化；`agent_rounds` 冻结不删（作回滚锚），读写切换在 Stage B/C。

列集合（判据：**只有 SQL 真按它筛/排/局部更新，派生列才允许存在**）：

| 字段 | 说明 |
|------|------|
| `id` | 行 ID，`atr_` 前缀 + `Utils.newID`（见下方前缀登记） |
| `request_id` | erix `runId`，即 `chat_requests.request_id` |
| `round_no` | 轮次序号；**同轮可存多行**（引擎行 + `appendUserTurn` 预写行） |
| `dedup_key` | erix `RoundRecord.dedupKey`，**领域身份**；宽度与 `agent_rounds.dedup_key`（已在生产验证）一致 |
| `record_json` | 全量 `RoundRecord` 原样 = 真相，`NOT NULL` |
| `created_at` / `updated_at` | 应用侧写入（DDL 不写 `DEFAULT CURRENT_TIMESTAMP`） |

索引：`PRIMARY KEY (id)`（单列），`UNIQUE KEY uk_atr_dedup_key (dedup_key)`，
`KEY idx_atr_request_round (request_id, round_no)`。

**决不能把 `(request_id, round_no)` 改成 UNIQUE**（决策①）：它是属性不是身份，
同轮两条不同 `dedupKey` 是上游契约要求，而写入侧走 `INSERT IGNORE`，
误建唯一键会**静默丢用户行**。护栏断言见
`tests/llm-kit-adapters/transcript-rounds-ddl.test.mjs`。
同理不建 `messages_json` / `folded_payload_json` / `stop_reason` / `usage` /
`latency_ms` / `folded`（展示面投影，留在 `agent_rounds` 与 `messages` / `chat_tool_calls`）。

### 3. `llm_kit_run_checkpoint`

对应模型：无（同上，裸 SQL）。引入：issue #1156 决策⑥。run 级 snapshot 存档。

| 字段 | 说明 |
|------|------|
| `run_id` | erix `runId`，字符串主键 |
| `snapshot_json` | run 级 snapshot 原样（整份覆盖写），`NOT NULL` |
| `revision` | `BIGINT`，**单 run 单调 CAS** 版本号 |
| `updated_at` | 应用侧写入 |

索引：`PRIMARY KEY (run_id)`。`run-state` 语义继续不实现并接受 `degraded` 诊断。

DDL 双侧：`scripts/upgrade-database.js`（存量库，步骤名含 `#1156 Stage A`）与
`scripts/init-database.js`（新装库基线）逐字段一致，`tests/llm-kit-adapters/transcript-rounds-ddl.test.mjs`
断言两侧不漂移。

## ID 前缀登记

| 前缀 | 用途 | 生成位置 |
|------|------|----------|
| `nr_` | `note_record.id`（Notes NoteRecord 行 ID） | `lib/notes/db-note-record-store.js`（`nr_` + `Utils.newID(20)`） |
| `wm_` | Notes 笔记 key（工作记忆临时笔记，宿主 facade 写入） | `lib/psyche/psyche-manager.js`（`wm_<ts>_<random>`） |
| `msg_` | 消息 ID（流式响应首 delta 的 message_id） | `lib/chat-service.js`（`msg_` + `Utils.newID(10)`） |
| `round_` | `agent_rounds.id`（一次 LLM 调用一行，issue #1134） | erix adaptor 写入侧（T2 落地，`round_` + `Utils.newID`） |
| `atr_` | `agent_transcript_rounds.id`（erix RoundRecord canonical 行 ID，issue #1156 Stage A） | erix adaptor 写入侧（Stage B 已接入：`atr_` + `Utils.newID`；读侧仍用 legacy，待 Stage C 切换；DDL 已落，见 §表登记 2） |
| `tc_` | `chat_tool_calls` 关联实体 ID 预留（表主键为 provider call id `tool_use_id`，无前缀；`tc_` 预留给派生消息/聚合行的关联 ID，T2/T3 落地） | erix adaptor 写入侧（`tc_` + `Utils.newID`） |
| `notes-v1:` | Notes scopeRef 命名空间（非表 ID，登记以避免前缀碰撞） | `lib/notes/notes-policy.js`（`buildNotesScopeRef`） |
| `lsn_` | `memory_lesson.id`（记忆 lesson/pattern 行 ID，**设计中未落地**，见 `topics/memory/memory-model.md`） | 设计稿（实现时落 `lib/memory-lesson/`） |

未加前缀的表 ID 默认使用 `Utils.newID(20)`（20 字符随机/时间混编）。
