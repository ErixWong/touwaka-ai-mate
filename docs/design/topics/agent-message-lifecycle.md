# Agent 消息生命周期与存储真相（erix-agent 0.29 时代）

> **状态**：现行事实说明（不是方案稿）。所有结论带可复核锚点（文件:行 / 表列 / 实测数字）。
> **取证基线**：`master = 76279aa`，`erix-agent = 0.29.0`，`2026-11-01 17:38 CST`，生产库 `touwaka_mate` 只读取数。
> **关联**：issue #1227（0.29 迁移，阶段 2/3 在跑）、#1237（思考按轮存）、#1238（前端抢滚动）、`docs/design/topics/erix-agent-message-store-0.22-0.24.md`（上游逐版变更比对，0.24 时代）、`lib/llm-kit-adapters/README.md`。
> **本文只讲"是什么 + 谁消费 + 生命周期"**；待办一律标 `→ 待办`，不夹带未拍板的方案。

---

## 0. 一页速览：三类数据，不要混

| 类别 | 是什么 | 存在哪 | 生命周期归属 |
|---|---|---|---|
| **① 对话账本** | 给用户看的来回消息 + 计量（正文、每轮思考、工具入参/结果、tokens/费用/延迟、软删、topic/task 归属） | `messages`、`chat_tool_calls`（+ `topics`、`chat_requests`） | **应用**：可编辑、可软删、会被终稿覆盖写 |
| **② 引擎工作档案** | 引擎口径"这一轮发生了什么"的**可重放记录**（每轮消息块原样、折叠载体、去重坐标、引擎记的轮号/成败/耗时） | `agent_transcript_rounds`（真相）+ `agent_rounds`（摘要投影） | **引擎**：逐轮不可变 |
| **③ 引擎运行参数** | 这次 run 怎么跑的（`config.*` 轮数上限/压缩策略/预算、`capabilities.*`、thinking 配置、工具集、模型） | **没有表**（只在内存与日志） | —— |

**三条不变量（现有守卫只覆盖了前两条）**

- **I1** ② 是引擎侧唯一真相；一切投影必须能由 ② 派生（对账器 `scripts/verify-transcript-projection.mjs` 守）。
- **I2** 投影不得发明字段；宿主补的值必须在 `record_json` 里留 `__hostSynthesizedColumns` 标记（`transcript-store.js:105`，issue #1150）。
- **I3** ① 的账本行不应被 ② 的口径**覆盖** —— 现状违反，见 #1237。`→ 待办`

---

## 1. 消息来自哪个 store，落到哪张表

| store 端口 | 谁实现 | 写入的表 | 状态 |
|---|---|---|---|
| **TranscriptStore**（对话档案） | 宿主：`lib/llm-kit-adapters/transcript-store.js` + `loop-bridge.js`（`createErixStore`），在 `lib/agent/agent-loop.js:1445` 以 `store:` 传给引擎 | `agent_transcript_rounds`（②真相）、`agent_rounds`（②摘要投影）、`messages`（①）、`chat_tool_calls`（①工具正身） | 必需面 `{appendRound, load}` 已实现；**7 格 `run snapshot` / `run-state` 有意未实现**（见 §5.9） |
| **NotesStore**（工作记忆/便签） | 宿主：`lib/notes/db-note-record-store.js`（表 `note_record`，`scope_ref + note_key` 唯一，`expires_at` 为 TTL 权威） | `note_record`（当前 5 行） | 已实现；消费者是 `lib/psyche/psyche-manager.js:108-111`（`notesStore.take`）与内置 notes 工具（`lib/tool-manager.js:77-79` 用 `rejectingNotesStore` 挡掉上游 `FileNotesStore` 落盘）。**与对话档案无关** |

要点（避免常见误解）：

1. **上游没有 MySQL store**。`src/store/` 只有 `memory.js` / `file.js` / `message-rows.js` / `transcript-dedup.js` / `append-user-turn.js` / `notes*.js`。上游给的是**算法 + 契约断言**，不是可继承的类 ⇒ 上面 4 张表的形状**全是宿主选择**，上游不要求"两张表"或"三张表"。
2. 上游被复用的三件（不是可选项，宿主自研第二份就正是上游点名的事故形状）：`foldMessageRows`（折叠，`transcript-store.js:80` 引入）、`canonicalToOpenAIMessages`（出站报文，见 §6）、`appendUserTurn`（用户轮点查快路径，`transcript-store.js:51`）。
3. **表清单与关键列**（今日 `SHOW COLUMNS` 实测）：

```
agent_transcript_rounds  id / request_id / round_no / dedup_key(UNI) / record_json / created_at / updated_at
agent_rounds             id / request_id / round_no / dedup_key(UNI) / stop_reason / usage / latency_ms /
                         folded bit(1) / folded_range / record_json / ts / created_at
                         + kind / seq / part_of   ← 生成列（从 record_json 派生），索引 idx_agent_rounds_request_kind
chat_tool_calls          tool_use_id(PK) / request_id / round_id / name / input_json / result_json /
                         is_error bit(1) / duration_ms / created_at
messages                 24 列：含 content / reasoning_content / inner_voice / tool_calls / error_info /
                         prompt_tokens / completion_tokens / cost / latency_ms / provider_name / model_name /
                         round_id / sequence_no / meta_json / is_deleted   ← 无 tool_calls 之外的引擎块结构
note_record              id / scope / scope_ref / note_key / record / record_version / expires_at / …
```

当前规模（2026-11-01 实测）：`agent_transcript_rounds=160`、`agent_rounds=160`、`chat_tool_calls=57`、`messages=2661`、`note_record=5`。

---

## 2. 会产生哪些消息：类型 × 写侧 × 落库 × 消费者

> "轮（round）"= 一次 LLM 调用。`runErix` 是线上路径（`agent-loop.js:411-413`：`ERIX_LOOP !== '0'` 即走它）。

| # | 消息/记录 | 谁写 | 落到哪 | 生命周期事件 | 消费场景 |
|---|---|---|---|---|---|
| 1 | **用户输入行** | `chat-service`（宿主） | `messages`（`role=user`）；引擎侧另存 round 0 种子 record（见 #6） | 请求受理即写 | UI 历史、续跑上下文、`chat_requests.user_message_id` 关联 |
| 2 | **每轮 assistant 消息行**（每轮 1 行） | TranscriptStore 投影（`transcript-store.js:839-845`，`ON DUPLICATE KEY UPDATE id=id` 幂等） | `messages`：`content`=本轮文本、`reasoning_content`=**本轮**思考、`round_id`、`sequence_no`、`meta_json` | 每条消息成型即落（0.23 起"一条消息一行"） | UI 历史与"思考过程"折叠块（`AssistantMessage.vue:26,39-40`）、历史接口（`message.controller.js:72/408/521`） |
| 3 | **工具调用半行（tool_use 时刻）** | TranscriptStore（`:778-781`） | `chat_tool_calls`：写 `name`/`input_json`，`result_json=NULL`、`is_error=b'0'`、`duration_ms=NULL` | 模型发出 tool_use 即写 | 工具面板/审计；"已发出未回填"的可观测点 |
| 4 | **工具结果回填（tool_result 时刻）** | TranscriptStore（`:813-831` UPSERT） | 同一行补 `result_json`、`is_error`、`duration_ms`（取 `block.erix?.durationMs ?? block.duration`） | 工具执行完 | UI 工具气泡、续跑时的 `tool_result` 块、审计 |
| 5 | **`role=tool` 行** | **不写**（#1134 `skipToolMessageRow`，`agent-loop.js:1090-1093`） | 正身唯一存 `chat_tool_calls.result_json` | —— | 读侧由 `message.controller` 聚合 `chat_tool_calls` 还原等价行 |
| 6 | **引擎每轮 record（②真相）** | 引擎经 `appendRound` | `agent_transcript_rounds.record_json`（`{round, roundKey, dedupKey, kind, seq, messages[], ts}`）+ `dedup_key` 唯一索引 | 每轮/每条消息成型即写；单事务含工具行（消除孤儿） | **续跑与上下文重建的唯一真相**；压缩/折叠的输入；对账基准 |
| 7 | **轮摘要行（②投影）** | TranscriptStore（`:723-728`） | `agent_rounds`：`stop_reason`/`usage`/`folded`/`folded_range`/`ts` + `record_json` 快照 + 生成列 `kind/seq/part_of` | 与 #6 同事务 | 运维查询、索引化检索（`idx_agent_rounds_request_kind`，实测 `key_len=325`）、对账 |
| 8 | **折叠载体与分片** | 上游 `foldMessageRows` + 引擎 | 载体 record（`kind`/`seq`/`part_of`）+ `folded`/`folded_range` 列 | 压缩发生时 | 压缩决策、legacy 装配（`buildLegacyRoundRecords`）、`load()` 语义 |
| 9 | **终稿行（覆盖写）** | `chat-service.saveAssistantMessageAndCompleteRequest`（`:1090-1125`，**UPDATE** 最后一条 `round_id` 非空的 assistant 行 `:1108-1119`） | `messages` 同一行：`content`=终稿、`reasoning_content`=**全轮累积串**、tokens/latency/model/provider | run 收尾 | UI 最终回答；**副作用：覆盖掉该轮原本思考 ⇒ #1237** |
| 10 | **`recovering` 事件（含累积思考）** | `agent-loop.js:1322`（线上路径）/ `:609`（`ERIX_LOOP=0` 回退路径） | **不落库**，只走 `onDelta` → SSE | 流式重试 | 前端重试时不清空已显示内容（`chat.ts:326`） |
| 11 | **轮状态快照（round snapshot）** | `createRoundStateSnapshot`（`lib/chat/round-state-snapshot.js:19-33`，含 `fullReasoningContent`） | **纯内存**（无 snapshot 表） | 每轮开始 | 仅用于同轮流式失败回滚重试（`agent-loop.js:594-596`，回退路径） |
| 12 | **请求状态/错误** | `ChatRequest.update`（`:1126-1137`）+ 异常路径 | `chat_requests.status/error_message/completed_at`；`messages.error_info` | 完成/失败/停止/超时 | 状态机、重试入口、UI 错误态 |
| 13 | **软删** | 应用侧 | `messages.is_deleted` | 用户/管理删除 | 账本可见性；**②不受影响**（档案不软删） |
| 14 | **便签/工作记忆** | psyche / 内置 notes 工具 → `db-note-record-store` | `note_record`（带 TTL） | `take` 读取后按策略清理 | 专家工作记忆，与对话历史无关 |
| 15 | **反思 / 历史归档** | `performReflection`（只拿**正文**，`chat-service.js:668-672`）/ `processHistoryIfNeeded` | **未核**：本轮未在本文取证，落库点不下结论 | 异步 | 反思链路**不消费思考过程**（这条已核） |

---

## 3. 生命周期时序（五种情形）

**A 首次运行（多轮工具）**
1. 写用户行（①）+ round 0 种子 record（②，摘要里**不含** `messages`）。
2. 每轮：引擎产出块序列 → `appendRound` 单事务写 ②（canonical）+ ②摘要（`agent_rounds`）+ ①（`messages` 每轮 1 行、`chat_tool_calls` 半行→回填）。
3. 收尾：UPDATE 最后一条 assistant 行（终稿 + 累积思考，#9）；更新 `chat_requests`；发 `complete` 事件（`:689`）；异步反思/归档。
实测对应关系：`req_457urtcf988nsb3x` 7 轮（r0-r6）→ `messages` 7 行（1 user + 6 assistant）；`req_457ut4mgzghbr46y` 5 轮 → 4 行（**纯工具结果轮不产 assistant 行**）。

**B 续跑 / 接管**
引擎经 store 端口读档案重建上下文：`new` 档读 `agent_transcript_rounds`（真相）；`legacy` 档由 `agent_rounds + messages + chat_tool_calls` 三表重建（`loadLegacyRounds`，`transcript-store.js:644`，读档模式开关 `:555`）。⇒ **① 单独不足以续跑**，但 ①+②投影 三表合起来对新时代请求已能等价重建（实测字段差见 §5.1）。

**C 重跑 / 幂等**
同一 `dedupKey` 重放：先点查（`loadByDedupKey`），命中则比**载荷指纹**（`transcript-payload-fingerprint.js`，#1227 阶段 2 B2）；冲突 ⇒ 记 `erix.transcript_dedup_conflict` 并**丢弃冲突写**，不重试不失败 run。

**D 压缩 / 折叠**
上游 `foldMessageRows` 在 ② 行上算 ⇒ 产生载体行（`folded`、`folded_range`、`kind/seq/part_of`）。legacy 装配复用同一份 `foldMessageRows`（B0 决策：删掉宿主第二套折叠）。

**E 停止 / 错误**
`chat_requests.status`（`stopped/failed/timeout`）+ `messages.error_info`；已落的 ② 行**不回滚**（档案保留部分进度，续跑可用）。

---

## 4. "消息摘要"到底怎么存的（专项）

**摘要字段是"从 record 里剥出来变成列"的，不是另存一份文本。**

```js
// transcript-store.js:94-101
const SUMMARY_FIELDS = ["round", "dedupKey", "ts", "messages", "folded", "foldedRoundRange"];
```

- **写侧**（`buildAgentRoundRecordSnapshot`，`:1072-1094`）：
  `recordSnapshot = record − SUMMARY_FIELDS`（逐字段剔除，不裁剪、不改名）；
  **种子轮（`round === 0`）额外剔掉 `messages`** ⇒ 55 行老 `record_json` 曾缺 `response` 键的成因（#1227 C2b 已回填 55 行，备份在 `/docker/touwaka-backups/1227-c2b-2026-11-01/`）。
  宿主补的 `dedupKey/ts/folded` 记进 `record_json.__hostSynthesizedColumns`（`:105`，#1150），读侧据此还原原值。
- **摘要落在 `agent_rounds` 的列**：`stop_reason`（来自 `record.response?.stopReason`）、`usage`、`folded`、`folded_range`、`ts`、`round_no`、`dedup_key`；`record_json` 存"去掉摘要字段后的 record 快照"。
- **`kind / seq / part_of` 是生成列**（`GENERATED ALWAYS AS json_extract(record_json …)`），不是应用写的列 ⇒ 它们不会与 `record_json` 失配；索引 `idx_agent_rounds_request_kind (request_id, kind, seq)` 就是建在它们上。
- **②真相侧不存摘要**：`agent_transcript_rounds.record_json` 是**原样 record**（契约要求"整条可回读"），只有 `dedup_key` 抽成唯一索引列。
- **摘要 ↔ 原文的一致性由对账器守**（C1）：`scripts/verify-transcript-projection.mjs` 四类差异 —— `record_json_mismatch` / `tool_row_mismatch` / `host_enriched_reasoning` / 孤儿（`orphan_tool_row`、`tool_result_missing`、`tool_result_pending`）。今日生产实测：35 请求中 `record_json_mismatch=0`、`tool_row_mismatch=29`（= C2d 待清的 canonical 污染）、`host_enriched_reasoning=9`、孤儿 0。
- **摘要有一格常年空**：`agent_rounds.latency_ms` 写侧直接传 `NULL`（`:727`）。`→ 待办`

---

## 5. 字段丢失与口径分裂（实测清单）

### 5.1 同一请求两种读法的**字段路径差**（`store.load()` 输出取集合差）

| 请求 | 档案侧 | 投影侧 | 只有档案有 | 只有投影有 |
|---|---|---|---|---|
| `req_457urtcf988nsb3x` | 7 轮 / 96 路径 | 7 轮 / 84 路径 | **13** | 1（扁平 `content[].duration`） |
| `req_457ut4mgzghbr46y` | 5 轮 / 94 | 5 轮 / 82 | **13** | 1 |
| `req_45548xc2bcnc2yq4`（老账本） | 17 轮 / 81 | 17 轮 / 81 | **0** | 0 |
| `req_455497ssynxk9kde`（老账本） | 18 轮 / 63 | 18 轮 / 63 | **0** | 0 |

那 13 个字段全是**工具元数据**：`erix.{round,success,durationMs,toolCallKey}` + `metadata.{toolCallId,toolId,toolName,duration,error,context,arguments.*}`。
**关键更正**：其中 **11 个在库里已有等价物**（`chat_tool_calls` 的 `tool_use_id / name / input_json / duration_ms / is_error / round_id`），只是 **legacy 读侧重建时压根没去取**；库里真没有的只有 **`erix.toolCallKey`** 与 **`metadata.context`**。`→ 待办`（读侧回接 + 两个落点）

### 5.2 口径分裂（同一个事实两个数/两种写法）

| 事实 | 现存值 | 出处 |
|---|---|---|
| 一次工具调用耗时 | `metadata.duration=189` / `erix.durationMs=190` / `chat_tool_calls.duration_ms=195` | 写侧取 `erix?.durationMs ?? duration`（`:831`），宿主另有自计 |
| 工具名 | `metadata.toolName="fs/list_files"` vs `chat_tool_calls.name="fs__list_files"` | 档案与账本各存一份，无规范化 |
| `is_error` | ① 有列、② 有块内标志 | C2b 判明：库里列是对的，②被 10-09 回填污染 29 条 |

### 5.3–5.12 其余已确认的丢失/污染/缺口

| # | 问题 | 现状 |
|---|---|---|
| 5.3 | **终稿覆盖写掉本轮思考** | 末轮行 `reasoning_content` 被全轮累积串替换（`68/99/195/192/453/223` → 末位变 `1230`），同请求内重复存储 `1007/746/321` 字 ⇒ **#1237** |
| 5.4 | `messages` 无工具块结构 | 工具正身在 `chat_tool_calls`，读时聚合还原（#1134） |
| 5.5 | `agent_rounds.latency_ms` 恒 `NULL` | 写侧传 NULL |
| 5.6 | canonical 存量污染 | `29` 条假 `is_error:true` + `69` 轮假 `folded:true`（10-09 从 ① 回填 ②，`BIT(1)` 被 `Buffer` 恒真读错）；代码侧 C2c 修，数据侧待 **C2d** |
| 5.7 | 历史 `record_json` 缺 `response` | C2b 已回填 55 行（幂等 55→0，行数不变） |
| 5.8 | 思考的"整段"形态是投影发明的 | 界面那格原本是"全轮累积串"，非按轮 ⇒ `host_enriched_reasoning=9`；口径已定"按轮存 + 读取时拼接"（#1237） |
| 5.9 | **`run snapshot` / `run-state` 7 格未实现** | 契约套件跳过清单 7 条（`transcript-store-upstream-contract.test.mjs:28-42`）：snapshot 往返保真/未知 runId/多 runId 隔离/新写不含终态/写失败上抛 + run-state 保真与终态独立读取/未知 runId。引擎每方法发一条 `persistence_capability_degraded`（合法降级，**不要用假 snapshot 压告警**）⇒ 运行态目前无处存 |
| 5.10 | **③ 运行参数完全不落库** | 无法回答"那一次用什么模型/轮数上限/压缩策略/reasoning 开没开"，只能翻日志 |
| 5.11 | `metadata.context` 常为 `null` | 库里无落点（本文样本为 `null`，未见非 null 实例） |
| 5.12 | 反思不消费思考 | `performReflection` 只传正文（`chat-service.js:668-672`） |

---

## 6. 消费场景矩阵（谁读什么）

| 消费场景 | 数据来源 | 备注 |
|---|---|---|
| UI 历史消息 | `messages` +（聚合）`chat_tool_calls`，经 `message.controller.js:72/408/521` | 前端 `ChatWindow.vue:47` / `AssistantMessage.vue:26,39-40` / `chat.ts:198` |
| UI 流式（含重试期） | SSE 事件（`reasoning_delta` / `tool_call` / `recovering` / `complete`） | `chat.ts:326` 收尾填充思考 |
| **续跑 / 接管** | `new`：`agent_transcript_rounds`；`legacy`：三表重建 | ②是真相；① 单独不足 |
| **回喂模型（出站报文）** | **②的块**：`canonicalToOpenAIMessages`（`erix-agent src/providers/openai.js:48`），其中 `appendReasoning`（`src/messages/canonical.js:220-224`）把 `reasoning` 块拼进出站 assistant 的 `reasoning_content` | ⇒ **思考会进上下文并计费**；但**不读** `messages.reasoning_content`（`legacy` 读档路径除外，`transcript-store.js:530-531`） |
| 计费 / 计量 | `messages.prompt_tokens/completion_tokens/cost/latency_ms/provider_name/model_name` | 只有终稿行有值（中间轮为空） |
| 审计 / 对账 | `scripts/verify-transcript-projection.mjs`（②↔①）、`scripts/verify-transcript-read-parity.js`（读法等价性） | 门禁口径见 `lib/llm-kit-adapters/README.md` |
| 压缩决策 | ②行 + `folded`/`folded_range` + `kind/seq/part_of` | 上游 `foldMessageRows` |

---

## 7. 现有守卫（能被机器判的才算守卫）

| 守卫 | 命令 | 当前口径 |
|---|---|---|
| 上游 store 契约 + 形状矩阵 | `npm run test:store-contract` | 26 格，7 格（snapshot/run-state）显式跳过 |
| 全量单测（含对账/读档/指纹/`BIT` 转换） | `npm run test:llm-kit` | 见 #1227 各切片基线 |
| 投影对账 | `node scripts/verify-transcript-projection.mjs [--fix-is-error \| --rewrite-record-json] [--dry-run]` | ⚠ 不带 `--dry-run` 就是**真写生产** |
| 读法回滚门禁 | `node scripts/verify-transcript-read-parity.js --snapshot / --gate --baseline` | C2d 之前预期 `exit 3`，且 `parity_regression` **只能由 `is_error`/`folded` 构成** |
| SQL 不变量 | `scripts/check-transcript-sql-invariants.mjs` | —— |

---

## 8. 待办汇总（本文只登记，不拍板）

1. **I3 落地**：终稿覆盖写停止（#1237，含"按轮存 + 读取时拼接"与空正文气泡处理）。
2. **工具元数据回接**：legacy/重建路径从 `chat_tool_calls` 取 `name/input_json/duration_ms/is_error/round_id` 拼回 `metadata.*` / `erix.*`；补 `erix.toolCallKey`、`metadata.context` 落点。
3. **口径统一**：工具耗时以谁为准；工具名规范化形式。
4. `agent_rounds.latency_ms` 到底填不填（填就接上，不填就明确废弃该列）。
5. **C2d**：清 canonical 的 29 + 69 污染（Eric 已批，等 C2c 合并后做）。
6. **③ 运行参数快照落库**（`chat_requests` 加一列 JSON 或 `agent_run_config` 小表），并与 `snapshot/run-state` 那 7 格一起决策：实现 or 明确长期不实现。
7. **未核项**：反思与历史归档的落库表；`metadata.context` 是否存在非 `null` 实例。

---

## 9. 怎么复核（照抄可跑）

```bash
# 表规模与列
docker exec mariadb mariadb -u"$DB_USER" -p"$DB_PASSWORD" -N -B touwaka_mate -e "SHOW COLUMNS FROM agent_rounds"
# ②↔① 对账（只读）
DB_HOST=127.0.0.1 DB_PORT=3306 ALLOW_NON_TEST_DB=1 NODE_ENV=production \
  node scripts/verify-transcript-projection.mjs --limit 40 --json --report /tmp/x.json
# 两种读法字段路径差（本文 §5.1 手法）
#   createTouwakaTranscriptStore({db:{sequelize}}) 分别设 ERIX_TRANSCRIPT_READ_MODE=new/legacy
#   → store.load(requestId) → 递归展开字段路径 → 取集合差
# 思考重复显示（§5.3）
curl -s "http://127.0.0.1:3017/api/messages/expert/<expert_id>?page=1&size=200" -H "Authorization: Bearer <jwt>"
```

> ⚠ 生产库直连（`DB_*` 的 raw 通道）**不带** `lib/db.js` 的 `typeCast`，`BIT(1)` 会返回 `Buffer`（`Boolean(Buffer.from([0]))===true`）。写只读校验脚本时要么用 `bitToBoolean`（`lib/llm-kit-adapters/bit-column.js`，唯一实现），要么用 `lib/db.js` 连接。
