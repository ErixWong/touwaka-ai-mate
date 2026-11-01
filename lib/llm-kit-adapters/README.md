# erix-llm-kit 适配器（touwaka 项目侧）

erix-llm-kit 的"驱动模型"：接口在库，DB 适配器在项目侧（ADR-001/002）。
本目录是 touwaka 的 MariaDB 适配器实现。

## 适配器清单

| 文件 | 接口 | 后端 |
|---|---|---|
| `model-config-provider.js` | ModelConfigProvider | `ai_models` + `providers` 表（经 lib/db.js） |
| `transcript-store.js` | TranscriptStore | `agent_rounds`/`messages`/`chat_tool_calls` 三层拆行（issue #1134/#1146/#1147，sequelize 参数化 raw query） |
| `provider-adapter.js` | erix Provider (`chatStream`/`chat`) | `LLMClient.callStream`/`call`，纯桥接 |

## 与 erix-agent 0.16.0 的行为变化（touwaka 侧知悉项，issue #1146 / #1147）

0.16.0 给宿主 store 新增了两条明文义务，本目录已合规（#1146 零 DDL；#1147 补了
经 Eric 批准的一列 `messages.meta_json`）：

1. **同轮保序**（契约 "Load order"）：`load()` 必须对同 `round` 的记录保持持久化追加顺序，
   引擎 `resume-manager` 直接按返回顺序重建状态、**不再二次排序**，且明文禁止依赖执行计划/
   主键扫描/filesort 巧合。`agent_rounds` 查询已改为 `ORDER BY round_no ASC, id ASC`；
   `id` 由 `Utils.newID` 生成（时间戳前缀 + 同毫秒递增，且本身就是主键的一部分），
   符合契约“插入时间戳 + 唯一二级键（或主键一部分）”的可选项，故不需新增 `append_seq` 列。
2. **字段保真**（契约 "Store fidelity requirements"）：不得用字段白名单重建 `RoundRecord`。
   `roundKey`/`meta`/`response` 已移出 `SUMMARY_FIELDS`，随 `record_json` 原样往返；
   `load()` 的 `response` 合成改为 **record_json 优先**、仅历中行（`record_json` 无 response）
   才用 `stop_reason`/`usage` 列合成，否则列合成会把完整的 `response.content` 覆盖掉。
   `stop_reason`/`usage` 两列**有意保留不删**（与 `record_json` 内容重复，仍供查询与排查用）。

3. **message 级保真**（契约 "Store fidelity requirements" minimum-fields 表首行，issue #1147）：
   `messages[].meta` 现随新列 `messages.meta_json`（`longtext NULL`，DDL 已由 Eric 批准，
   批准范围仅该列）**原样 JSON 往返**——写侧 `messageRowFor` 有 meta 即 `JSON.stringify`、
   无则 NULL；读侧 `parseMetaColumn` 解析后**整对象**挂回 `message.meta`，**不做键白名单**，
   故宿主未知键同样保真。`meta.source` 是**引擎保留字段**（judge 方向提示轮 = `judge-control`），
   宿主不得用它写自己的来源信息。迁移见 `scripts/upgrade-database.js` 步骤
   `messages.meta_json column add`（幂等）；历史行留 NULL，读侧不回填、不报错、不挂空对象。
   ⚠️ **`meta_json` 不是对外字段**：`server/controllers/message.controller.js` 的
   `formatMessage` 显式剔除它，`lib/chat-service.js` 的未回复扫描也已由 `SELECT m.*` 改显式
   字段列表，消息类接口的响应字段集合与加列前逐字一致。是否把 `meta` 暴露给前端做
   synthetic 标注是后续独立需求，本 issue 不做。

另：0.16.0 的 `projectTranscriptForDisplay` 新增 `key` / `meta.sourceInferred` 等**只读增量字段**，
本项目当前不消费该投影（store 侧无业务调用点，仅回归测试用于验保真）；按上游要求不要把
投影 `key` 当持久 ID 或 `tool_use.id` 使用。

## TranscriptStore 保真声明（load() 往返等价面）

拆行前的 RoundRecord 与 `load()` 输出在以下字段上等价：

- 基础（#1134）：`round`、`ts`、`dedupKey`、`messages`（含 tool_use/tool_result 块位置）、
  `folded`、`foldedRoundRange`、`foldedPayload`，以及其余未拆行的未知字段（走 `record_json`）。
- 本次新增（#1146）：`roundKey`、`meta`、`response`（含 `response.content` 的 text/reasoning/tool_use
  块与 `usage`/`stopReason`）。
- **已闭环（#1147）**：`messages[].meta`（含引擎保留键 `source` 与宿主未知键）随
  `messages.meta_json` 列原样往返。回归见 `tests/llm-kit-adapters/transcript-store-message-meta.test.mjs`：
  meta 往返含未知键与非对象 meta（数组/标量）、`projectTranscriptForDisplay` 对 judge 方向提示轮输出
  `meta.synthetic=true` / `source="judge-control"`（#1146 里是 `false`）、评委 `judge-control`
  排除规则重新生效、历史 NULL 行兼容、重复 `appendRound` 不把 meta 覆盖成 NULL。

**#1146 的已知偏离（`messages[].meta.source` 未落库）已由 #1147 消除。**

剩余不可保真点（有意取舍，均非白名单问题）：

1. 同一 assistant 消息内的块序按 `[text…, tool_use…, reasoning]` 还原（拆行后块间相对
   位置无法记录），非该约定的块序不能保真。
2. **纯 tool_use / tool_result 消息**（无 text/reasoning/multimodal 内容）按 D2-i 不落
   `messages` 行，其 `meta` 无处存放、随拆行丢失。现网该形态的 meta 只有引擎自己的
   `judge-control`，且只出现在带文本的 user 提示轮上，实际不受影响。
3. 本列上线前写入的历史行 `meta_json` 为 NULL：其 synthetic 分类回退上游文本前缀启发式
   （与 #1146 行为一致），不回填。

## 与 erix-agent 0.17.0 的行为变化（touwaka 侧知悉项，issue #1150）

0.17.0 是纯增量（无 API 删除、无调用点变更、无强制 store 改动），但其中
上游 #157 的 **`appendUserTurn` 成对可选快路径探针** 是本项目主动采纳的：

**能力档位变化**：本目录的 store 原档位是「必需面 `{appendRound, load}` +
两条探针都不实现」，现在是「必需面 + **两条探针都实现**」。

| 方法 | 语义 | 走的路径 |
|---|---|---|
| `loadByDedupKey(key, dedupKey)` | 命中返回**完整**存储记录（与 `load()` 对应轮逐字段一致），未命中 `null` | SQL 按 `request_id` 限定并用 `dedup_key` / `record_json.roundKey` 的 OR 取候选；按 `round_no DESC, id DESC` 取**最近 N 条候选**（资源上界，issue #1166；默认 `DEFAULT_DEDUP_CANDIDATE_LIMIT = 200`，环境变量 `LLM_KIT_DEDUP_CANDIDATE_LIMIT` 可覆盖），翻正后按 `round_no, id` 顺序完整装配，再用**与写侧同一个** `recordKey(runId, record)` 判据过滤（#1227 B1 起；= 上游 `transcript-dedup.js#recordKey`：`dedupKey ?? roundKey ?? <runId>:round:<n>`）。**不能 `LIMIT 1`**（最新候选可能是必须 miss 的伪候选，会截掉真命中）；真命中落在窗口外时按“未命中”处理，判据本身不变 |
| `loadMaxRound(key)` | 等价于对 `load()` 结果取 `Math.max(0, …safe-integer round…)`；**空会话返回 `null`** | `idx_agent_rounds_request` 上的 `MAX(round_no)` |

引擎行为与后果：

- **成对语义**：两者都是函数才走快路径；**只实现一条 == 都没实现**（全量 `load` 路径原样运行）。
  `lib/llm-kit-adapters/loop-bridge.js` 的 `createErixStore` 已**两条一起透传**，所以生产接线可达。
- 快路径上：先算 `dedupKey` → `loadByDedupKey` 命中即返回（`loadMaxRound` 与 `load` 都不再调）；
  未命中才 `loadMaxRound` 派生 `round` → `appendRound`。**全程不调 `store.load`** →
  直接消掉原先在接收消息事务内的全量 `load()`（此前每预写一轮用户输入都要把整会话重读重组）。
- `written` 语义与返回形状不变，命中仍返回既有 `record`；违约不静默降级，引擎抛 `TypeError`。
- **零 DDL**：不加列 / 不加索引 / 不动约束（roundKey 自 #1146 起只在 `record_json` 里，
  宁可用 JSON 函数扫本会话行也不加列）。现有会话最大 18 round，所以今日收益主要是
  契约合规 + 移除事务内全量读，而不是吞吐数字。
- **SQL OR 仅用于候选，不是命中判据**：探针对每条候选复用 `assembleRoundRecord()`，按
  `round_no ASC, id ASC`（与 `load()` 相同）排序装配，再严格使用**写侧同一个**
  `recordKey(runId, record)`（#1227 B1；= `dedupKey ?? roundKey ?? <runId>:round:<n>`，
  与上游 `src/store/transcript-dedup.js:72-76` 同式）并返回第一条命中。若同一条记录的
  `dedupKey=A`、`roundKey=B`，查询 `B` 会 miss、查询 `A` 才会命中；JSON `null` 也由 JS 的
  nullish 语义处理，不依赖 SQL `NULL` 的不同语义。上游对该探针契约仍在
  [erix-agent issue #171](https://github.com/ErixWong/erix-agent/issues/171) 裁决。
- **当前宿主侧并没有 `appendUserTurn` 调用点**（仅作为引擎导出面存在），所以本次上线**不改变现网行为**；
  探针能力是“已就绪 + 契约合规”，未来接预写用户轮时自动享快路径。

两个附带的保真修正（均为支撑上面两条，零 DDL）：

1. `appendRound` **容忍缺 `ts`** 的 record：`agent_rounds.ts` 是 NOT NULL，直接把 `undefined`
   交给驱动会报 `Named replacement ":ts" has no entry` 而不是可读错误；现在与 `created_at`
   一样退到 now。写入方（erix）永远带 ts，故现网行为不变。
2. `load()` / 探针**不再发明写入方没给的字段**：`dedupKey`/`ts`/`folded` 本来不存在于传入 record
   时，列仍会补齐（NOT NULL 与历史回填行为不变），但 `record_json` 里用内部键
   `__hostSynthesizedColumns` 记录宿主合成字段。显式 `dedupKey: null` 同样按 nullish 语义标记；
   列值可用补齐后的键，读回 record 则恢复原有的 `null` 或字段缺失。若写入方自带该同名键，
   元数据会封存并在读回时恢复其原值，而非吞掉它。这样“拆行前 RoundRecord ≡ 读出记录”才真正
   逐字段成立（上游契约对整 record 做 `deepStrictEqual`，多一个 `folded:false` 就挂）。
   **历史行无此标记 → 回填行为逐字不变**；`loop-bridge.js` 消费 `folded` 已按 `undefined` 处理。

## 读侧模式开关 `ERIX_TRANSCRIPT_READ_MODE`（issue #1156 Stage C）

三个读方法（`load` / `loadByDedupKey` / `loadMaxRound`）的真相源现在可切换，解析收在
唯一入口 `resolveTranscriptReadMode()`（`transcript-store.js`），三个方法共用：

| 取值 | 真相源 | 说明 |
|---|---|---|
| `new`（**默认**） | canonical `agent_transcript_rounds.record_json`（整份 RoundRecord 原样，决策③′） | 不再从展示面重组；`loadByDedupKey` 的候选窗口与 `??` 判据（#1150 / #1166）逐条对齐 |
| `legacy` | `agent_rounds` + `messages` / `chat_tool_calls` 展示面拆行装配 | 旧读法，**一行语义都没改**（分支体就是 Stage B 之前的实现） |

- 默认已切至 `new`（Eric 已批准）；要回退到 `legacy`，设置
  `ERIX_TRANSCRIPT_READ_MODE=legacy` 并重启。
- 未知取值：**回落到当前默认档（目前为 `new`）** + 一条结构化告警（`event: transcript_read_mode_unknown`），
  不静默、不抛错；同一取值只告一次。日志实现抛错也不许带倒读路径（与孤儿行告警同规则）。
- 两模式等价由 `scripts/verify-transcript-read-parity.js` 自证（**只读**，支持 `--limit` /
  `--request-id` / `--report`）：逐会话在两个档下取三个读方法的输出做深比对，规范化剔除的键
  与理由一并写进报告 JSON；有差异 exit 3（是信号不是崩）。它**不复制任何装配逻辑**，
  两侧都调 store 现成读法，模式只经上面那个解析入口生效。
- 展示面的既有损形状（纯 tool 消息上的 `message.meta`、块序非 `[text→tool_use→reasoning]`、
  显式 `is_error:false`、浮点 `duration`）在 `new` 档会**变得可见**（canonical 是无损的那一侧）：
  这不是 Stage C 引入的回归；本次默认切换前已用生产全量语料验证两模式等价。
- 顺带的语义修正（同一 Stage）：孤儿 `chat_tool_calls` 行（`round_id` 找不到宿主轮）从
  Stage B 的“挂到首轮”**改回丢弃**，结构化告警保留。基点 `26a5df7` 的 SQL 是
  `WHERE round_id IN (:roundIds)` = 本来就取不到 = 丢弃，attach 反而把 tool 行污染成首轮内容。

## 与 erix-agent 0.3.5 的行为变化（touwaka 侧知悉项）

- checkpoint 执行后写失败由静默改为 fail-closed（抛出 `KitError` `checkpoint_failed`），该次请求会显式失败。由于 `request_id` 每请求新生成，且本项目没有复用 `runId` 的 resume 场景，无需按 tool id 做幂等保护。
- observer 回调异常改走 `onObserverError`，不再掀掉整轮循环；`runErix` 已接线到 `logger.warn`。
- 流式 `onDelta` 时机不变。本项目显式传入 `retry.attempts >= 1`，仍在尝试成功后批量 flush；仅 `CHAT_STREAM_RECOVERY_MAX_ATTEMPTS=0` 时才会启用 0.3.5 的实时透传路径。
- 其余 0.3.5 变化（file store `runId` 哈希、`ERIX_*` env 校验、`providerOptions` 保护、内置 provider 的 SSE 解析）本项目不适用。

## 流式重试与持久化诊断（issue #1155）

`CHAT_STREAM_RECOVERY_MAX_ATTEMPTS` 传给 erix 的 `retry.attempts`，表示**额外重试次数**，
不是总尝试次数：`attempts = 2` 表示总共最多尝试 `3` 次。erix 用这一组选项同时控制
provider 调用与 transcript persistence 写入重试。Agent 流式路径直接调用 `runToolLoop`，
不经过 `lib/chat/base-llm.js` 中 `callWithRetry` 专用的 `retryWithBackoff`；
因此这里说明上游重试语义，不改变默认值或环境变量名。

`runErix` 同时接入上游独立的 `diagnostics.error` 与 `onPersistenceError`。持久化错误以
结构化 error 日志记录 `request_id`、port、phase、operation、runId、fatal、sideEffect
及错误 message/code；其他 erix 事件按类型记录安全摘要，不记录 `tool_use` /
`tool_result` 正文。`persistence_capability_degraded` 是可选 store 能力未实现的预期降级，
只记 warn，不视为持久化失败。

## 与 erix-agent 0.22 / 0.23 的行为变化（touwaka 侧知悉项，issue #1220）

**0.23.0 是「存储收敛」版：一个 run 的正文不再存在轮行里。** 引擎改成**一条消息一行、一成型就落盘**
（`<runId>:msg:<n>:<seq>`、`kind:"message"`、`seq` 轮内从 0 递增，且写在它描述的那次工具执行**之前**），
轮行（`<runId>:engine:round:<n>`）只留元数据、**根本没有 `messages` 这个键**。一句话口径：
**`store.load()` 就是正文 API**，以前「从 journal 行里读正文」成立的事，现在只对 `load()` 的返回值成立。

- **已适配（#1227 阶段 2 切片 B0 起为委托）**：`transcript-store.js` 导出 `foldMessageRows()`，`load()` 的
  `new`（canonical）与 `legacy` 两条读路径返回前都把消息行折回轮行，所以
  `records.flatMap(r => r.messages ?? [])` 仍是模型当时看到的序列（引擎 `resume-manager#restoreResume`
  重建上下文的唯一口径）。0.23 时上游 `src/store/message-rows.js` **未从包入口导出**（包 `exports` 只放
  `.` / `./tools` / `./contract-tests`，深路径 import 会 `ERR_PACKAGE_PATH_NOT_EXPORTED`），故当时是宿主侧
  等价实现；**erix-agent 0.29.0 起上游把它提升为公共 API 并从包根导出**
  （`node_modules/erix-agent/src/index.js:53`、实现 `src/store/message-rows.js:152`），宿主副本已删除，
  `transcript-store.js` 的 `foldMessageRows` 现在是**上游函数本身的别名**（无包装层）。
  口径（均由上游实现提供）：同轮取**第一条**载体、`rowKey` 取 `dedupKey ?? roundKey` 且必须非空、无载体行时
  消息行原样保留（崩溃点矩阵）、无可折叠消息行时返回**入参同一引用**（0.23 之前的账本逐字不变）、只有带
  `seq` 的行参与（`:input:` 行被吸走会让 `appendUserTurn` 幂等失效）、`partOf` 分片拼回同一条消息、
  载体自带 `messages` 时**取并集而不是覆盖**（legacy 档里宿主预写的用户行就是该轮第一条载体，覆盖会丢
  用户问题）。上游独有的**折叠守卫**（issue #401 R3 / #439）随之到位：载体行已经带着该轮折好的正文时，
  这一轮的消息行按**重复副本**丢弃（比较两侧都剥掉信封 `ts`），宿主「两份都留」不再让正文翻倍。
- **不受影响（grep 已核）**：全仓不消费 `onRound(record).messages`（§3，0.23 起它是 `undefined`）、
  不从 `snapshot.messages` 恢复上下文（§4，那份现在只是**落后副本**，恢复只取执行状态）、
  不调 `projectTranscriptForDisplay`（§5，喂原始行会重复条目且 `durationMs` 变 `undefined`）。
- **未翻的语义（待 Eric 拍）**：0.22.0 要求「同 `dedupKey` 但 payload 不同」抛
  `TranscriptDedupConflictError`；本店仍是 `INSERT IGNORE`「先到先得、后到忽略」，因为文件头明文写着这是
  与旧表逐字对齐的刻意设计，而能证伪它的 `transcriptStoreContract` 在无库凭据时是 skip——盲改语义不做。
- **护栏**：`tests/llm-kit-adapters/transcript-message-rows-fold.test.mjs` 是**纯函数级**回归（不连库、
  不需要凭据，所以始终会跑到），守上游 `docs/host-upgrade-guide-0.23.0_cn.md` §6 四问里的问 1、问 2，
  外加崩溃点、老账本透传、`:input:` 不吸走、无 key 行不当载体，以及 #1227 B0 之后新增的两条：
  「折叠函数**就是**上游导出的那一个（宿主不另存副本）」与「#439 守卫：载体已带折好的正文（无 `ts`）
  + 消息行（带 `ts`）不重复入列」。

## 与 erix-agent 0.29 的身份键口径对齐（#1227 阶段 2 切片 B1）

**一句话：写侧身份键与上游 `recordKey` 对齐，写/读（含折叠）不再各算一套。**

- 判据唯一入口 `transcript-store.js#recordKey(runId, record)` =
  ``record?.dedupKey ?? record?.roundKey ?? `${String(runId)}:round:${String(record?.round)}` ``，
  与上游 `node_modules/erix-agent/src/store/transcript-dedup.js:72-76` **逐字同式**。上游把它放在
  引擎内部模块（包 `exports` 只有 `.` / `./tools` / `./contract-tests`，深路径 import 抛
  `ERR_PACKAGE_PATH_NOT_EXPORTED`），故只能本地复制这一行；**上游改判据时必须同步**。
- 共用点（此前是两套）：`agent_transcript_rounds` 插入键、`agent_rounds` 插入键、
  `loadByDedupKey` 的 JS 判据。宿主侧不再有第二处自己拼 `<runId>:round:<n>`。
  （`loadMaxRound` 没有身份谓词——它是 `MAX(round_no)`，不受影响。）
- 修的缺陷：B1 之前写侧是 `dedupKey ?? <runId>:round:<n>`，**缺 `roundKey` 这一环**，而折叠侧
  （上游 `message-rows.js#rowKey` = `dedupKey ?? roundKey`）与上游 store 都有它 ⇒ roundKey-only
  记录（崩溃重跑时顶层 `round`/`ts` 漂移，二者在上游属 volatile）会落两行，上游 memory store
  同序列只落一行。现在同 key + 同 payload 的重放幂等。
- 取值域变化与存量行：只有「无 `dedupKey`、有 `roundKey`」的记录换键（隐式键 → roundKey）。
  生产实测（2026-10-31，110 行 × 2 表）：canonical 侧 roundKey-only 行 **0** 条、
  `recordKey` 与 `dedup_key` 列不一致的行 **0** 条；`agent_rounds` 侧 legacy 读侧身份与列值不一致
  的行 **0** 条；roundKey 值撞上任何已有 `dedup_key` 的 **0** 处，跨 request_id 复用的 roundKey **0** 个。
  ⇒ **存量行不会被新口径重写成第二行**；列宽 `varchar(255)`（现存键长 35–59、roundKey 最长 28）
  富余，**零 DDL**。
- **仍未做（B2）**：同 key 异 payload 的冲突指纹。本店写侧仍是 `INSERT IGNORE`「先到先得、后到忽略」，
  上游 `dedup_payload_conflict` 那 4 格在 `npm run test:store-contract` 里仍红（就是 B2 的工作清单）。

## 测试

契约测试消费已发布的 `erix-agent` 包，通过
`erix-agent/contract-tests` 导入接口兼容断言：

`execute-tool.contract.test.mjs` 与 `engine-api.contract.test.mjs` 是**上游漂移护栏，
不是宿主符合性护栏**；其中大部分断言验证引擎侧规范化/API 行为。宿主侧调用约定由
`loop-bridge.test.mjs` 守，两个方向的错误各能触发 1 个失败。

```bash
# 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）
#   { "host": "127.0.0.1", "port": 3306, "user": "eric", "password": "…", "database": "llm_kit_test" }
npm run test:llm-kit   # 不要用目录形式 node --test tests/llm-kit-adapters/（MODULE_NOT_FOUND）
```

契约与元数据测试共用同一组三层表（agent_rounds/messages/chat_tool_calls），
以独立 runId 命名空间隔离，因此可以在 Node.js 测试默认并发下安全运行。

0.17.0 快路径探针的回归（差异对等 / 零 load / 成对语义 / 类型违约 / 残缺 record 负控）在
`tests/llm-kit-adapters/transcript-store-fastpath.test.mjs`。

0.23.0 消息行折叠的回归（纯函数、不连库）在
`tests/llm-kit-adapters/transcript-message-rows-fold.test.mjs`，已列入 `npm run test:llm-kit`。

`npm run test:store-contract` 是**上游契约套件 + 键形状矩阵**（真库、真适配链），故意**不进**
`test:llm-kit`：它今天仍有 4 格红，全部是 B2 的 payload 冲突指纹（同 `dedupKey` 异 payload /
数组顺序 / 宿主未知字段 / 回落到 roundKey 与隐式键），红就是阶段 2 的工作清单。
`#1227 阶段 2 切片 B1` 已把矩阵里「写侧身份键缺 roundKey 回落」两格翻绿（现为回归守卫）。

测试会在 `llm_kit_test` 库内建/删 `providers` 与 `ai_models` 两表（sequelize sync 真实模型定义），
**不要**把凭据指向 touwaka_mate 生产库。

## 投影可重建：对账器 + 孤儿检测（#1227 阶段 3 切片 C1）

**一句话：canonical 是真相，投影（`agent_rounds` / `messages` / `chat_tool_calls`）必须能被它逐格重建；
对账器把“重建不出来”的地方按类报出来，`--apply` 只允许在非生产库补写。**

| 文件 | 角色 | 读写 |
|---|---|---|
| `transcript-projection.js` | canonical → 投影的**唯一**推导/对账/重建实现 | 除 `projectRequest({apply:true})` 外全 SELECT |
| `scripts/verify-transcript-projection.mjs` | CLI：逐请求对账 / 孤儿 / legacy 探针 / 基线统计 / EXPLAIN | 默认 dry-run |

**生成列终于有消费者了**：`agent_rounds.kind` / `seq` / `part_of`（#1229 的 VIRTUAL 生成列）与
`idx_agent_rounds_request_kind (request_id, kind, seq)` 在 C1 之前全仓没有 SQL 读；对账器的取行是第一个消费者：

- 载体行：`WHERE request_id = :runId AND kind IS NULL`
- 消息行：`WHERE request_id = :runId AND kind = 'message' ORDER BY round_no, seq`

两条实测都走 `idx_agent_rounds_request_kind`（`type=ref`，`key_len=325`）。`--explain` 会把 EXPLAIN 打出来。

**复用而非复制**（硬约束）：`agent_rounds.record_json` 走 `transcript-store.js#buildAgentRoundRecordSnapshot()`，
`messages` 行字段走 `#projectMessageRow()`，折叠走 `#foldMessageRows`（= erix-agent 0.29 公共 API），
legacy 读法直接调 `store.load()`。C1 只是把 appendRound 里原本内联的两段**纯提取**成新导出
（`buildAgentRoundRecordSnapshot` / `projectMessageRow`，行为逐字不变，`TRANSCRIPT_SUMMARY_FIELDS` 为只读导出），
没有第二份投影形状。

**差异分类**（`PROJECTION_DIFF_KINDS`，每类独立判据）：`missing_carrier` / `extra_carrier` /
`missing_round_row` / `extra_round_row` / `seq_mismatch` / `part_of_mismatch` / `record_json_mismatch` /
`missing_message_row` / `unexpected_message_row` / `content_mismatch` / `missing_tool_row` /
`extra_tool_row` / `tool_row_mismatch` / `tool_result_mismatch` / `tool_result_missing`。

**已知非缺陷**：`host_enriched_reasoning`。终稿单写
（`lib/chat-service.js#saveAssistantMessageAndCompleteRequest`）会 UPDATE 引擎已落的 assistant
`messages` 行，把 `reasoning_content` 换成**整个 run 的累积推理**（canonical 每轮只存本轮那一段），
并补 tokens/latency/model。判据只认「只有 reasoning 一个字段不同 + actual 以 expected 为后缀」，
其它一律算 `content_mismatch`；`--apply` **不回写**这种行（否则会毁掉现网展示值）。

**孤儿检测**：`chat_tool_calls.round_id` 找不到宿主轮 ⇒ `orphan_tool_row`；轮已完成但
`result_json IS NULL` ⇒ canonical 有结果时报 `tool_result_missing`（真丢正文），canonical 也没有时
只记 `tool_result_pending`（引擎未 settle / 中止，非投影缺陷）。

**`--apply` 的边界**：只允许非生产库（`database !== 'touwaka_mate'`，库名为空也拒绝），
写入口只有 `projectRequest() → applyProjectionWrites()`：补缺失 `agent_rounds` 行（`INSERT IGNORE`）、
按 `(round_id, sequence_no)` upsert `messages`、按 `tool_use_id` upsert `chat_tool_calls`、
剪掉“未被吸附”的 `messages` 行。**不重写既有 `agent_rounds.record_json`**（历史行保留原样，
那部分差异只报告不修复——存量重写走 C2b 的 `--rewrite-record-json`，见下节）。幂等：第二次跑 `written` 全 0
（`affectedRowsOf()` 同时兼容 sequelize 的两种写入返回形状：`[insertId, affectedRows]` 与 `[ResultSetHeader, …]`）。

**legacy 探针（给 C2 的靶子）**：同一请求三档对比——`new`（canonical 折叠）/ `legacy`（现网读法）/
`carrier-only`（只用载体行当轮宿主，子行按 canonical 轮归属挂回）。生产 5 个 0.23 请求实测：
legacy 会把 `agent_rounds` 里的消息行当成轮宿主 ⇒ 轮数从 7 涨到 16、工具轮正文整轮丢失；
carrier-only 已把轮数与条数拉回与 canonical 一致，**只剩块顺序差**（`reasoning+text` vs
`text+reasoning`，即 #1196 的 ordering-only 噪音）。

**测试**：`tests/llm-kit-adapters/transcript-projection-reconcile.test.mjs`（真库 `llm_kit_test`）——
干净 0.23 fixture（载体 + 消息行 + 分片）0 差异，然后**逐类**人为制造差异并断言分类计数与命中行；
另有 dry-run 只读自证（写 SQL 代理会抛 + 静态断言写 SQL 只在写入口之后）、`--apply` 库名判据、
`--apply` 幂等、宿主增强 reasoning 不回写。

## 存量投影漂移回填 / canonical 假阳性清洗（#1227 阶段 3 切片 C2b → C2d）

三个开关**默认关**，不带开关时行为与 C1 完全一致（dry-run 只读）：

| 开关 | 改什么（**写哪张表**） | 方向约束 |
|---|---|---|
| `--fix-is-error` | `agent_transcript_rounds.record_json`：**删** A 格 `tool_result` 块的 `is_error` 键 | **单向**：只动「canonical `true` 且列 `0`」（A 格）；B（两边真）与 C（列真 & canonical 非真）一律不动，C 只报告 |
| `--fix-folded` | `agent_transcript_rounds.record_json`：A 格 `folded` → `false`，`foldedRoundRange` 从列推导 | 同上三格表；判据同表，动作指向 canonical |
| `--rewrite-record-json` | `agent_rounds.record_json` | 用 `buildAgentRoundRecordSnapshot(canonical).recordSnapshot` 重写（唯一快照实现，不另写第二份） |

**生产库写入门槛**：开关本身 + `ALLOW_NON_TEST_DB=1` 必须**同时在场**；缺任一即拒绝，
code=`ERR_PROJECTION_BACKFILL_NEEDS_ALLOW_NON_TEST_DB`（库名缺失是 `ERR_PROJECTION_BACKFILL_UNKNOWN_DATABASE`）。
`--dry-run` 与开关同用时只出清单不写。

**真写怎么触发（别用 `--apply`）**：`--apply` 是**投影重建**开关，它在生产库被
`assertProjectionApplyAllowed()` 直接拒绝（exit 1、零写入），且它写的是 `agent_rounds` /
`messages` / `chat_tool_calls`——与“只改 canonical”相反。清洗的真写靠**不给 `--dry-run`**：

```bash
# 预演（只读）
node scripts/verify-transcript-projection.mjs --limit 40 --fix-is-error --fix-folded --dry-run --json
# 真写（只 UPDATE agent_transcript_rounds）
node scripts/verify-transcript-projection.mjs --limit 40 --fix-is-error --fix-folded --json
```

**三格方向表永远可见**（`collectToolErrorDirections` / `collectFoldedDirections` + 两个 `summarize*`）：
A=canonical真&列0 / B=两边真 / C=列真&canonical非真 / 两边皆假。为什么强制三格而不是只报“命中数”：
C2b 复盘发现 `agent_transcript_rounds.is_error` 自己会被 2026-10-09 的 canonical 回填污染
（`reconstructMessages` 的 `row.is_error` 是 `BIT(1)` 的 `Buffer`，`Boolean(Buffer)` 恒真），
只报命中数会把“canonical 假阳性”伪装成“投影丢位”。**基准本身是否可信必须一眼可见**。

### 为什么 `--fix-is-error` 的 A 格动作从「列改 1」翻成「删 canonical 键」（C2d）

C2b 实现这个开关时的假设是「canonical 是真相」，于是 A 格动作写成 `chat_tool_calls.is_error = b'1'`。
**这个假设已被 C2b 自己的实测推翻**（C2c 复测一字不差）：

| 方向 | `is_error` 实测 | `folded` 实测 | 谁错 |
|---|---|---|---|
| A（canonical 真 & 列 0） | **29 块** | **69 轮** | **canonical 错**（回填缺陷注入） |
| B（两边真） | 10 块 | 0 轮 | 都正确，不许动 |
| C（列真 & canonical 非真） | 0 块 | 0 轮 | 列侧另有来源，不许动 |

机制：`reconstructMessages()` 旧写法 `...(row.is_error ? {is_error:true} : {})` 在 `Buffer` 上恒真
⇒ 2026-10-09 那批回填给**每个** `tool_result` 都挂了 `is_error:true`（39 块 = 29 假 + 10 真）；
`assembleRoundRecord()` 的 `Boolean(round.folded)` 同病 ⇒ 每轮都被写成「已折叠」。
⇒ **投影列是真相，canonical 是被污染的一方**。

所以 A 格的正确动作是**清 canonical**：`is_error` **删键**（引擎契约「无键 = 非错误」；
`is_error:false` 与「无键」在 canonical 里不是一回事），`folded` **写 `false`**（写侧
`assembleRoundRecord` 对每一轮都给布尔值；实测 69/69 行 `folded:false` 后
`buildAgentRoundRecordSnapshot` 与盘上 `agent_rounds.record_json` 逐字段相等，改成删键则 0/69
——删键会让写侧多出一个存量行没有的 `__hostSynthesizedColumns` 标记）。

**为什么不能“另开开关保留旧语义”**：留着「列改 1」= 一颗脚枪。谁再跑一次就会把 29 条
**正确非错误**的工具结果污染成错误——正是本切片要消灭的缺陷类。

### 单表不变量与幂等

- 两个开关的写入面**只有 `agent_transcript_rounds`**（唯一写入口 `applyCanonicalRecordRewrites`）。
  用例用写 SQL 探针钉住：每条写语句必须匹配 `^UPDATE agent_transcript_rounds\b`，且不得出现
  `chat_tool_calls` / `agent_rounds` / `messages` 的写。
- 两个开关的计划**必须合并**（`planCanonicalCleanups`）：同一条 canonical 行可能既带假 `is_error`
  又带假 `folded`（生产实测 29 个假 `is_error` 块全部落在 69 个假 `folded` 轮之内）。分别算
  `newRecord` 再先后写，后一份会盖掉前一份的修复。
- 定位 `tool_result` 块**不能**用 `deriveProjectedRows().toolCalls[].ownerDedupKey`——那是
  `tool_use` 块所在的行（`chat_tool_calls.round_id` 钉在 tool_use 行），而 `is_error` 长在
  `tool_result` 块上，两者可以不同行（分片形状里就是）。用 `findToolResultBlocks()` 扫块。
- 幂等：计划阶段按深比较只收“真的会变”的行；SQL 侧再夹 `record_json <> :recordJson`。
  第二次跑计划为空 ⇒ `written = 0`。`updated_at` 不动（只改内容，回滚只需还原 `record_json`）。

**不碰的边界**：`messages.reasoning_content`（宿主增强累积推理）不回填；`agent_rounds.folded` /
`chat_tool_calls.is_error` 两列本切片**一行都不写**；`reconstructMessages` 的读档语义不在本切片改（C2c）。

**测试**：`transcript-projection-reconcile.test.mjs` 里 —— 闸门纯函数（生产库缺 `ALLOW_NON_TEST_DB=1` 拒写）、
`--fix-is-error` / `--fix-folded` **各一格三格方向**（A 清、B 不动、C 不动且被点名 + 幂等）、
raw `Buffer` 列（无 typeCast 连接）下判定仍正确、清洗后 canonical 形状可被写侧函数重建（幂等）、
`foldedRoundRange` 与 `folded` 一致性（列 NULL ⇒ 删键；列有值 ⇒ 用列的值）、单表不变量、
`--rewrite-record-json` 与 `buildAgentRoundRecordSnapshot` **逐字节相等** + 幂等；
dry-run 只读自证里也加了全部计划阶段（零写 SQL）。

## `BIT(1)` 读侧转换（#1227 阶段 3 切片 C2c）

### 唯一实现

`lib/llm-kit-adapters/bit-column.js` 的 `bitToBoolean()` 是**全仓唯一一份** `BIT(1)` → 布尔转换。
`transcript-projection.js` 只是 `import` + `export { bitToBoolean }`（C1 的 import 面保持不变），
`transcript-store.js` 直接 `import` 同一个模块。`tests/llm-kit-adapters/bit-column.test.mjs`
用「读源码 + 函数对象同一性 + grep 唯一实现点」三条钉住“不会出现第二份”。

### 为什么必须转换（缺陷本体）

`AGENTS.md §2.1` 规定布尔列统一 `BIT(1)`。mysql2 对 BIT 列返回 `Buffer`，而 JS 真值判断在 Buffer 上全错：

| 表达式 | `Buffer 00`（列=0） | `Buffer 01`（列=1） |
|---|---|---|
| `Boolean(v)` / `if (v)` / `v ? a : b` | **`true`**（恒真） | `true` |
| `Number(v)` | `NaN` → 假 | `NaN` → 假（恒假） |
| `v.some(byte => byte !== 0)` | `false` ✅ | `true` ✅ |

恒真/恒假两种错法都是**静默**的，且**只在没有连接级 `typeCast` 的连接上显形**。

### 暴露面结论（重要，别再重复踩）

`lib/db.js` 的 `dialectOptions.typeCast` 把 `BIT(1)` 提前转成 JS boolean，因此：

| 通道 | 谁在用 | BIT 列形态 | 缺陷可见性 |
|---|---|---|---|
| A `typeCast` | server（`lib/db.js` 单例）、`openTestDatabase()`、全部 Sequelize 模型查询 | `boolean` | **被掩盖**（未修代码也是对的） |
| B raw | `scripts/*` 的 `DB_*` 直连（`new Sequelize(...)` 不带 typeCast）：canonical 回填、parity、verify、sql-invariants | `Buffer` | **显形** |

⇒ **这个缺陷在生产 server 路径上被 `typeCast` 掩盖**；实际影响的是 raw 连接工具链，以及
2026-10-09 那次 canonical 回填**已经落盘**的数据。修代码只能止住今后，已落盘的存量要 C2d 清。

### 本切片修的两处读点

| 位置 | 列 | 旧读法 | 后果 |
|---|---|---|---|
| `transcript-store.js` `reconstructMessages()` | `chat_tool_calls.is_error` | `...(row.is_error ? {is_error:true} : {})` | **每一个** `tool_result` 都被挂假 `is_error:true`（resume 上下文与 legacy 展示全污染，并把假阳性回填进 canonical） |
| `transcript-store.js` `assembleRoundRecord()` | `agent_rounds.folded` | `Boolean(round.folded)` | **每一轮**都被读成「已折叠」 |

`is_error` 为 0 时**不写该键**（引擎契约：无键 = 非错误；`is_error:false` 与「无键」在 canonical 里不是一回事）。

### 存量漂移与门禁口径（C2d 之前）

canonical 里由同一次回填缺陷落盘的假阳性（**C2d 的范围 = 两件事一起清**）：

| 存量 | 量 | 分布 | 判据 |
|---|---|---|---|
| 假 `is_error:true` | **29 个 `tool_result` 块** | 6 个请求 | canonical `true` 且 `chat_tool_calls.is_error = b'0'` |
| 假 `folded:true` | **69 轮** | 14 个请求 | canonical `true` 且 `agent_rounds.folded = b'0'` |

因此 `scripts/verify-transcript-read-parity.js --gate --baseline <改动前快照>` 在 C2d 之前**预期 exit 3**，
且失败项**只能**是 `parity_regression`、diff path **只能**含 `is_error` / `folded` 两个字段
（其余任何字段出现 = 真回归，必须停下）。**禁止**用白名单把它刷绿——那等于把 C2d 的清单藏起来。
同一次运行里 `cells_mismatch = 0`、`shape_regression = 0`、「老账本 legacy 三格变化请求数 = 0」
必须仍然成立：这三项才是“没把内容读坏”的证据。

### 测试

- `tests/llm-kit-adapters/bit-column.test.mjs`：六格输入输出表（`Buffer[0]`/`Buffer[1]`/`0`/`1`/`null`/`undefined`）
  + string/Uint8Array/空 buffer + boolean 幂等（保护 typeCast 通道）+ 单一实现自证（源码断言 + grep）。
- `tests/llm-kit-adapters/transcript-store-bit-columns.test.mjs`：真库，**两条连接各跑一遍**
  （通道 A typeCast / 通道 B raw）。断言 `is_error` 的**键有无**（0 → 无键，1 → `is_error:true`）、
  整轮装配（一轮两个工具结果一真一假，只有那个带键）、`folded` 列 `b'1'`/`b'0'` → `true`/`false`。
  通道 B 在**未修代码**上红、修后绿；通道 A 在未修代码上也绿——这正是“缺陷被 typeCast 掩盖”的证据。
