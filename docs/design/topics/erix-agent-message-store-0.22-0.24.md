# erix-agent 消息存储变更（0.22 → 0.23 → 0.24）× 本地 MySQL 三表实现比对与方案

> 状态：设计稿（待 Eric 拍两处语义）。证据全部指向上游源码 `../erix-agent`（**0.24.0**）与本地
> `lib/llm-kit-adapters/transcript-store.js`（1241 行）的具体行号，可自行复核。
> 关联：issue #1220、`lib/llm-kit-adapters/README.md` 的「与 erix-agent 0.22 / 0.23 的行为变化」节。

## 0. TL;DR（五条决策）

| # | 决策 | 理由一句话 |
|---|---|---|
| D1 | 升 `erix-agent` 到 **0.24.0**，折叠**优先用上游导出的 `foldMessageRows`**，本地那份降级为「旧版 fallback + 口径参考」 | 0.24 起因 #401 R1 已进包根导出（`src/index.js:53`），继续自研就正是上游点名的 #353/#401 事故根因形状；我们上一轮「上游没导出所以自研」的理由**已被上游修掉** |
| D2 | 若暂时留在 0.23：本地折叠必须补 **#439 逐条 `ts`** + **去重比较剥 `ts`** | 否则升 0.24 契约套件时新加的折叠格直接红，且宿主拿 `load()` 做时间线/延迟分析时被折叠过的消息没有时间戳 |
| D3 | 0.22 的 dedup 冲突语义**要翻**，且**零 DDL**：把写前点查扩成取 `record_json`，用上游同式指纹比较 | 比较对象本来就要取（`transcript-store.js:560` 为复用 `round_id` 已经付了这次索引点查），加列只多一份要维护一致性的冗余真相 |
| D4 | 消息行仍写 legacy `agent_rounds`，但把「一行 ≠ 一轮」显式写进不变量/对账脚本口径 | 全仓除 store 自身外只有 4 个脚本按 `agent_rounds` 计数，改脚本比改表便宜一个数量级 |
| D5 | 补测试库凭据，让 0.24 契约套件（含新增折叠格 + 冲突格）真跑一次 | 当前 28 例 skip，是**唯一**能证伪上面所有推断的手段 |

## 1. 上游到底改了什么（逐版、带出处）

### 1.1 上游**没有** MySQL store —— 折叠与 dedup 判据天生是宿主的活

`src/store/` 只有 `memory.js`(141) / `file.js`(478) / `message-rows.js`(325) / `transcript-dedup.js`(203) /
`append-user-turn.js`(168) / `notes*.js`。`grep -rl "MySqlTranscriptStore|INSERT IGNORE|ON CONFLICT" src bin`
只命中前三个文件。**结论**：上游给的是「算法 + 契约断言」，不是可继承的类；本项目 MySQL 侧的折叠与
幂等判据只能自己实现——但也必须**与上游同一份口径**，否则契约测试会挑出来。

### 1.2 0.23.0：写侧收敛成「一条消息一行」

- 引擎改成每条消息成型即落盘：`<runId>:msg:<n>:<seq>`、`kind:"message"`、`seq` 轮内从 0 递增、
  `messages` 只装一条；一轮的多个 `tool_result` 每个结果一行，分片用 `partOf` 指认前一片。
- 轮行 `<runId>:engine:round:<n>` **只剩元数据，没有 `messages` 这个键**。
- 口径后果（升级指南 §2–§5）：**`load()` 就是正文 API**；`onRound(record).messages` 变 `undefined`；
  `snapshot.messages` 退化成**落后副本**（恢复只取执行状态）；`projectTranscriptForDisplay` 不能喂原始行。

### 1.3 0.24.0：三处直接影响本仓

1. **`foldMessageRows` 进公共 API**（`src/index.js:53`，CHANGELOG #401 R1）。文件头写得很直白：
   packed install 里 `'foldMessageRows' in await import("erix-agent")` 在 0.23 是 `false`，
   而「宿主自己重写折叠」是 #353 / #401 两次事故的**根因形状**。`isRoundCarrier` 刻意**不外露**
   （载体形态属于实现口径）。`exports` 仍只有 `.` / `./tools` / `./contract-tests`（深路径 import 会
   `ERR_PACKAGE_PATH_NOT_EXPORTED`，实测 `./package.json` 同样被拒）。
2. **#439 A：折叠出的每条逻辑消息必须带 `ts`**，取值是**该消息首片行**的 `ts`
   （`message-rows.js:109-111` `stampRowTs`：消息已有非空 string `ts` 就不改写；行上没有 `ts` ⇒ **缺键**，
   不写 `undefined`、不猜值）。分片合并只追加 content、不改首片已写上的戳（与 #430「锚点钉在首片」同向）。
3. **#439 的重复折叠守卫 `withoutJournalTs`**（`message-rows.js:321`）：判断「这段正文是不是已经折过」时
   **两侧都先剥掉消息上的信封 `ts`**——因为 `ts` 答的是「什么时候」，不是「是不是同一条」。
4. **契约套件新增折叠格**（`test/contract/transcript-store.js:255+`）：此前该套件里
   `grep -c 'kind: "message"'` = 0，于是「全绿但根本没折叠」的自研 store 能安静过完整个套件，
   而 resume 侧时间线从 `[ok]` 掉成 `[pending]`。新格用「载体行 + 3 条消息行（其中 1 条是 `partOf` 分片）」
   的真实形状，逐条断言折叠结果**与折前深比较相等**，并**逐条核对 `ts`**。
5. **dedup 判据（#326，`src/store/transcript-dedup.js`）**：
   `recordKey = dedupKey ?? roundKey ?? <runId>:round:<n>`；
   `payloadFingerprint = sha256(canonical JSON of record − 顶层 dedupKey/roundKey/round/ts)` 取前 24 hex，
   前缀 `sha256:`；canonical JSON = 对象逐层**排序键**、数组**保序**、`undefined`/函数/symbol 丢弃、
   `NaN`/`Infinity`→`null`、`bigint`→十进制字符串、循环引用→`"[Circular]"`。
   同 key 同指纹 = 幂等 no-op；不同 = 抛 `TranscriptDedupConflictError`（`code = "dedup_payload_conflict"`，
   带 `key` / `existingFingerprint` / `incomingFingerprint` / 前 8 个差异顶层字段名，消息里必须含 `key`）。
   契约把**「什么不算冲突」钉得比「什么算冲突」更死**：字段插入顺序、顶层 `ts`/`round` 漂移都**不得**判成冲突
   （`appendUserTurn` 崩溃重跑就是这个形状），因为「把可安全重放的预写误判成冲突比静默丢弃更砸契约」。

## 2. 本地实现现状（同一批问题的另一侧）

三张展示面表 + 一张 canonical 真相表，`appendRound` 单事务四段写：

| 位置 | 事实 |
|---|---|
| `transcript-store.js:95` | `CANONICAL_TABLE = "agent_transcript_rounds"`，列只有 `id/request_id/round_no/dedup_key/record_json/created_at/updated_at` |
| `buildCanonicalRecordJson()` | **就是 `JSON.stringify(record)`** ⇒ canonical 的 `record_json` 保留**完整** payload（含 `messages`） |
| `SUMMARY_FIELDS`（`:79`） | legacy 侧把 `round/dedupKey/ts/messages/folded/foldedRoundRange` 从 `record_json` **剥到列/子表**（`messages` 表按 `round_id`+`sequence_no` 拆行、`chat_tool_calls` 存工具调用） |
| `:560` | 写前点查 `SELECT id FROM agent_rounds WHERE dedup_key = :dedupKey LIMIT 1` 复用 `round_id`；`uk_agent_rounds_dedup_key` + `INSERT IGNORE` ⇒ **同 key 异 payload 静默丢弃** |
| `load()` | 默认 `ERIX_TRANSCRIPT_READ_MODE=new` → `loadCanonicalRounds()`（`record_json` 原样 → `canonicalRecordOf`）；显式 `legacy` → 三表装配 `assembleRoundRecord`；**两条都在返回前 `foldMessageRows(...)`** |

**正文不会丢**（这是上一轮最该担心的一点，已排除）：0.23 的消息行在 canonical 侧 `record_json` 里带全文，
在 legacy 侧拆成 `messages` 行；两种读模式折出来的都是每轮一条。

## 3. 逐条比对：已适配 / 缺口 / 不受影响

| 上游变更 | 本地现状 | 结论 |
|---|---|---|
| 消息行落盘（§1.2） | `load()` 两路都折；纯函数回归 10 例通过 | **已适配** |
| 折叠口径（载体/rowKey/崩溃点/`seq`/`partOf`/同引用） | 上一轮已逐条对齐（同轮取**第一条**载体、`dedupKey ?? roundKey` 非空、无载体原样保留、无可折叠行返回入参同一引用、只有带 `seq` 的行参与、`partOf` 拼回同一条） | **已适配** |
| #439 逐条 `ts` | `foldMessageRows` 里 `jsonClone(row.messages[0])` 直接入列，**没有** `stampRowTs` | **缺口 →** 升 0.24 契约新格会红；宿主时间线分析缺时间戳 |
| #439 守卫剥 `ts` | 去重签名 `JSON.stringify(message)` **含 `ts`** | **缺口（低）** → 同正文不同 `ts` 会被判成两条 |
| #401 折叠可发现（导出） | 本地自研那份 | **风险**：0.23 时是被迫的，0.24 起是自愿背漂移 |
| #326 dedup 冲突 | `INSERT IGNORE` 先到先得、后到**静默忽略** | **缺口**：与契约不一致，重跑写错正文没有任何信号 |
| 一轮 N 行（写放大） | 消息行同样落 `agent_rounds`（`stop_reason`/`usage` 为 NULL、`round_no` 重复）；全仓除 store 外只有 `verify-transcript-read-parity.js` / `check-transcript-sql-invariants.mjs` / `backfill-transcript-canonical.js` / `upgrade-database.js` 碰这张表，**无 app 侧按轮次聚合** | **可控缺口**：不变量 I1「轮覆盖」等口径要改成消息行感知 |
| `onRound().messages` / `snapshot.messages` / `projectTranscriptForDisplay` | 全仓不消费（grep 已核，README 已记证据） | **不受影响** |
| `appendUserTurn` 的 `:input:` 行（无 `seq`） | 折叠只吃带 `seq` 的行，幂等判据不被吸走 | **已适配** |

## 4. 方案

### Phase 0 — 立即可做（零 DDL、零依赖变更，1 个 PR）
1. **折叠补 `ts`**：入列前对每条消息做 `stampRowTs` 同式（消息已有非空 string `ts` 不改；否则取该行 `ts`；
   行上没有 ⇒ **不加键**）；`partOf` 命中已入列的父消息时**只追加 content、不动父消息的 `ts`**（首片锚点）。
2. **去重比较剥 `ts`**：`seen` 的签名改成 `JSON.stringify(withoutJournalTs(message))`，
   与上游 `withoutJournalTs` 同式（只在带 `ts` 时浅拷贝并删键）。
3. 这两条各加纯函数回归（不连库、无凭据也跑）：「每条消息带自己那行的 `ts`、分片取首片戳」
   「同正文不同 `ts` 不重复入列」。

### Phase 1 — 升 0.24.0，折叠换成上游那份
- `package.json`: `^0.24.0`。折叠改为**运行时能力探测**：
  `const upstream = (await import("erix-agent")).foldMessageRows`；命中就用上游的，
  没命中（≤0.23）回退本地那份。这样「宿主自研折叠」从**长期义务**降成**旧版本兼容层**。
- 加 **parity 测试**：同一批 fixture（含 `partOf` 链、崩溃点、`:input:`、种子轮、同 key 重跑）分别喂
  上游实现与本地实现，断言输出深比较相等——这是把「两份实现会不会漂」变成机器可判的唯一办法。
- `isRoundCarrier` 不外露 ⇒ 本地实现里别引入对它的依赖。

### Phase 2 — dedup 冲突语义（#326）落地
- 写前点查改成 `SELECT id, record_json FROM agent_rounds WHERE dedup_key = :dedupKey LIMIT 1`
  （同一索引、同一事务，**零额外往返**）。
- 本地实现 `payloadFingerprint`（照 §1.3-5 的 canonical JSON 口径，排除顶层
  `dedupKey/roundKey/round/ts`）：命中且指纹相等 ⇒ 现有幂等路径不变；不等 ⇒ 抛
  `code: "dedup_payload_conflict"` 的错误，带 `key` / `existingFingerprint` / `incomingFingerprint` /
  差异顶层字段，消息含 `key`。
- **必须**同时实现契约里那两格「不得误判成冲突」（字段顺序、顶层 `ts`/`round` 漂移）。
- 指纹算法不依赖上游私有模块（`transcript-dedup.js` 明写「不发公共面」，`exports` 也不给深路径），
  所以用**固定向量**把算法钉死：几条已知 record 的期望指纹写进测试，升级时上游若改口径会立刻显形。

### Phase 3 — 口径与对账
- `check-transcript-sql-invariants.mjs`：I1「`agent_rounds` 的 `(request_id, round_no)` ⊇ canonical」
  在 0.23 后仍成立（是超集），但要新增一条**写放大感知**断言，例如
  「`kind="message"` 行数 ≈ `messages` 表里对应行数」，避免以后把消息行当缺陷去「修」。
- `verify-transcript-read-parity.js`：legacy 与 canonical 两侧都过 `foldMessageRows`，
  对 0.23 之后的 run 要按**折叠后**的 record 比较，别拿原始行数比。
- 测试库凭据到位后跑 `npm run test:llm-kit`（含 0.24 契约的折叠格 + 冲突格），再决定是否把
  `ERIX_TRANSCRIPT_READ_MODE` 保持 `new`、以及 legacy 表要不要长期收消息行。

### 被否掉的方案
| 方案 | 为什么不做 |
|---|---|
| canonical 加 `payload_fp` 列 | 比较对象**本来就要取**（`:560` 已付这次点查）；加列要迁移 + 回填 + 与 `record_json` 双写一致性，收益 0 |
| 给消息行单独建一张表 | `record_json` 本身无 schema，`load()` 契约就是「load 即正文」；建表等于再造第二份真相，且 legacy/canonical 双写对账要重做 |
| 现在就停 legacy 表写入 | `verify-transcript-read-parity` 与前端历史数据还依赖双写；等 Phase 3 全绿再说 |
| 继续在 0.23 上维护自研折叠 | 上游已导出且已把自研折叠定性为事故根因；留着它只有一种正当理由（兼容 ≤0.23），那就把它降级成 fallback（Phase 1）而不是真相源 |

## 5. 验证矩阵

| 项 | 命令 | 需要 DB 凭据 | 当前状态 |
|---|---|---|---|
| 折叠纯函数回归 | `node --test tests/llm-kit-adapters/transcript-message-rows-fold.test.mjs` | 否 | 10/10 通过 |
| 静态套件（DDL / 读模式 / 基线） | `node --test tests/llm-kit-adapters/transcript-rounds-ddl.test.mjs …` | 否 | 24 例 / pass 7 / **fail 0** |
| 全量（含上游契约套件） | `npm run test:llm-kit` | 是（`llm_kit_test` 库） | 28 例 skip（缺 `~/.config/mcp/creds/touwaka-test-db.json`） |
| 0.24 新增折叠格 / 冲突格 | 同上 | 是 | **未跑** |
| 写→读端到端（0.23 消息行真的能折回来） | 起一次真 run 后 `load()` 对比 `flatMap` | 是 | **未跑** |

## 6. 待拍板
1. **dedup 冲突要不要翻**（Phase 2）：翻了以后 `persist` 重试路径从「静默忽略」变「抛错」，
   业务侧要接住 `code === "dedup_payload_conflict"`。我的建议是翻——契约在 0.22 就这么定，
   且静默丢弃正文错误在事故复盘里最难查。
2. **legacy `agent_rounds` 要不要继续收消息行**（D4）：若前端/运营有按 `agent_rounds` 列「轮次」的入口，
   0.23 后一个 run 的行数会变成 3–5 倍；现有 grep 显示没有，但这条依赖的不是代码而是**产品口径**。
