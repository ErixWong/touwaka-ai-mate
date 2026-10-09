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
| `loadByDedupKey(key, dedupKey)` | 命中返回**完整**存储记录（与 `load()` 对应轮逐字段一致），未命中 `null` | SQL 按 `request_id` 限定并用 `dedup_key` / `record_json.roundKey` 的 OR 取候选；按 `round_no DESC, id DESC` 取**最近 N 条候选**（资源上界，issue #1166；默认 `DEFAULT_DEDUP_CANDIDATE_LIMIT = 200`，环境变量 `LLM_KIT_DEDUP_CANDIDATE_LIMIT` 可覆盖），翻正后按 `round_no, id` 顺序完整装配，再用上游 `??` 判据过滤。**不能 `LIMIT 1`**（最新候选可能是必须 miss 的伪候选，会截掉真命中）；真命中落在窗口外时按“未命中”处理，判据本身不变 |
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
  `round_no ASC, id ASC`（与 `load()` 相同）排序装配，再严格使用上游判据
  `(record?.dedupKey ?? record?.roundKey) === dedupKey` 并返回第一条命中。若同一条记录的
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
| `legacy`（**默认**） | `agent_rounds` + `messages` / `chat_tool_calls` 展示面拆行装配 | 现网读法，**一行语义都没改**（分支体就是 Stage B 之前的实现） |
| `new` | canonical `agent_transcript_rounds.record_json`（整份 RoundRecord 原样，决策③′） | 不再从展示面重组；`loadByDedupKey` 的候选窗口与 `??` 判据（#1150 / #1166）逐条对齐 |

- **默认仍是 `legacy`，生产要不要切 `new` 由 Eric 拍**（一次 restart 切完）。代码不许自己翻默认值
  ——`transcript-store-read-mode.test.mjs` ② 专门钉这一条。
- 未知取值：**按 `legacy` 跑** + 一条结构化告警（`event: transcript_read_mode_unknown`），
  不静默、不抛错；同一取值只告一次。日志实现抛错也不许带倒读路径（与孤儿行告警同规则）。
- 两模式等价由 `scripts/verify-transcript-read-parity.js` 自证（**只读**，支持 `--limit` /
  `--request-id` / `--report`）：逐会话在两个档下取三个读方法的输出做深比对，规范化剔除的键
  与理由一并写进报告 JSON；有差异 exit 3（是信号不是崩）。它**不复制任何装配逻辑**，
  两侧都调 store 现成读法，模式只经上面那个解析入口生效。
- 展示面的既有损形状（纯 tool 消息上的 `message.meta`、块序非 `[text→tool_use→reasoning]`、
  显式 `is_error:false`、浮点 `duration`）在 `new` 档会**变得可见**（canonical 是无损的那一侧）：
  这不是 Stage C 引入的回归，但切 `new` 前应当先用 parity 脚本在生产库跑一遍确认差异面。
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

测试会在 `llm_kit_test` 库内建/删 `providers` 与 `ai_models` 两表（sequelize sync 真实模型定义），
**不要**把凭据指向 touwaka_mate 生产库。
