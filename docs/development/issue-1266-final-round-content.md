# issue #1266 —— 末轮 assistant 正文被写成「前文 + 本轮」

> 状态：取证完成（2026-11-02），写侧已修（见同分支后续提交）。存量行只出 dry-run，生产写由主 agent 走 #1246 备份闸门。

## 1. 取证边界

| 打开过 | 事实 |
|---|---|
| `lib/agent/agent-loop.js`（全文 1792 行，含 `run()` 与 `runErix()` 两条路径） | 两条路径各自维护一个**跨轮累积**的 `fullContent`，无分隔 `+=` |
| `lib/chat-service.js`（`streamChat` 第 9/10/12 步、`saveAssistantMessageAndCompleteRequest`） | 终稿单写 `Message.update({ content, ... })` |
| `lib/llm-kit-adapters/transcript-projection.js`（`reconcileRequest` / `isHostEnrichedReasoning` / `applyProjectionWrites` / `applyReasoningRewrites`） | 对账器 + 单表写入口，`--fix-reasoning` 是 #1237 的同类先例 |
| `scripts/verify-transcript-projection.mjs`（dry-run 跑过生产只读） | 4 个请求的逐轮对账明细 |
| `scripts/verify-transcript-read-parity.js`（读脚本头 + `--gate` 语义） | 关门判据 |
| `frontend/src/composables/useSSEHandler.ts`（`recovering` / `complete` 两个 case） | `recovering.content` **替换**气泡正文；`complete` 用 `replaceMessage` **替换**正文 |
| 生产库只读（`touwaka_mate`，`SELECT` only） | 4 个请求的行级事实、canonical 与 messages 的逐字比对、canonical 行落库时刻 |
| `node_modules/erix-agent`（`loop/provider-runner.js`、`loop/orchestrator.js`） | 重试时 delta 只在成功 attempt 后回放（不会重复计数）；`finalText` 每轮覆写 = 末轮那段；`round_start` 每轮一次 |

打不开 / 没做的事：
- 生产**写**：按契约禁止（`#1246` 备份闸门由主 agent 执行），本单只跑只读 dry-run。
- `BLOCKED` 无。

## 2. 根因：两条写路径，同一个「累积串当终稿」

生产实际走的是 **erix 路径**（`run()` 里 `process.env.ERIX_LOOP !== '0'` 就转 `runErix()`；
`docker exec touwaka-mate env` 里没有 `ERIX_LOOP`，容器里也没有 `.env`）——
所以工单评论里那组行号（`634` / `751`）落在 **legacy 路径**上，同一缺陷在 erix 路径上是
`1226` / `1714`。两条都修了，别只改一条（`ERIX_LOOP=0` 是运维回退开关）。

| 路径 | 声明 | 无分隔累加 | 终稿返回值 | 落库点 |
|---|---|---|---|---|
| erix（默认，生产） | `agent-loop.js:1226` `let fullContent = ''` | `:1714` `fullContent += delta`（`onDelta`，跨轮不清零） | `:1782` `return { fullContent, ... }` | `chat-service.js:1173` `Message.update({ content, ... })` |
| legacy（`ERIX_LOOP=0`） | `agent-loop.js:634` | `:751` `fullContent += delta` | `:978` `return { fullContent, ... }` | 同上 |

`roundContent`（轮内那段）在 legacy 路径里本来就存在（`:723` 起），只是**没被当终稿用**；
erix 路径里则**完全没有**按轮变量。`490 = 13 + 477` 正是「13 那轮 + 477 那轮」的无分隔拼接。

## 3. `fullContent` 的全部消费方（改前）

`grep -n "fullContent" lib/agent/agent-loop.js lib/chat-service.js` 共 17 处，逐条归类：

| 位置 | 角色 | 改后影响 |
|---|---|---|
| `agent-loop.js:634` / `:1226` | legacy / erix 的**累积串声明** | erix 保留（只给 `recovering` 用）；legacy 保留（`roundSnapshot` 恢复语义不变） |
| `agent-loop.js:716` / `:799` | legacy 轮快照（`createRoundStateSnapshot` / `restoreRoundStateSnapshot`） | 不动：恢复语义要的是「本次 run 已经流过的全部文字」 |
| `agent-loop.js:751` / `:1714` | 无分隔累加 | 不动（累积串本身留着），**新增**按轮变量（legacy `lastRoundContent` / erix `roundContent`） |
| `agent-loop.js:812` / `:1525` | `recovering` 事件的 `content` | 不动：前端 `useSSEHandler` 用**替换**语义把气泡正文设成它，而气泡里本来就已经流过所有轮的 delta ⇒ 这里要的正是累积串（换成按轮值会把前几轮已经显示的文字从气泡里删掉） |
| `agent-loop.js:970-972` / `:1774-1776` | 「LLM 没返回内容」占位文案 | 判据改成「**整轮都没吐过文字**」才用占位；末轮无正文但前轮有 → 返回空串（不回退累积串） |
| `agent-loop.js:978` / `:1782` | **返回值** `fullContent` | **改**：返回末轮自己的正文（erix 兜底 `loopResult.finalText`，也是末轮那段） |
| `chat-service.js:639-640` | `const { fullContent } = llmResult; let finalContent = fullContent;` | 值随上游变正确 |
| `chat-service.js:644` `_handleRecallPostCheck(answer)` | recall 事后校验的 `answer` | 用末轮正文（recall 修正仍会追加到它后面，机制不变） |
| `chat-service.js:670` `performReflection(..., finalContent, ...)` | 反思输入 | 用末轮正文（前几轮正文各自有行，反思看终稿即可） |
| `chat-service.js:1173` `Message.update({ content })` | **落库** | 值随上游变正确；**新增**「空正文不覆盖列」夹子 |
| `chat-service.js:709` `onComplete({ message: { content: finalContent } })` | 给前端的 SSE `complete` 载荷 | 会话内显示 = 末轮行（与刷新后按轮渲染逐字一致，同 #1237 切片 B 的口径） |

**`assistant` 消息的「新建」与「更新」两条路径的区别**（本条缺陷只在更新路径上）：

- **新建**（`saveAssistantMessage`，`chat-service.js:1090` 的 `Message.create`）：只在**找不到**
  `round_id IS NOT NULL` 的 canonical 行时兜底触发（adaptor 未写/异常路径）。此时库里有没
  有别的行会被覆盖——它建一条新行，`content` 就是宿主交来的正文，没有「覆盖别人」的风险。
- **更新**（`saveAssistantMessageAndCompleteRequest` 的 `Message.update`）：erix adaptor 已经
  按轮落好了行（`round_id IS NOT NULL`），这里按 `created_at DESC, id DESC LIMIT 1` 选中
  **最后一轮**那条行并覆盖它。缺陷就是在这里把累积串盖到「末轮那条行」上。
  同一个 `LIMIT 1` 还带来一个次生风险：**末轮没有正文时**（末轮只调工具就撞轮数上限），
  选中的是**更早某一轮**的行，此时若把空串写进去就是「抹掉别人的正文」⇒ 新增的空正文夹子
  正是挡这个。

## 4. 波及面：4 个请求，但只有 1 个是「canonical 干净 + messages 被污染」

判据（工单口径，排除 `CHAR_LENGTH(b.content) > 3` 的空正文噪声）：同一 `request_id` 内某条
assistant 行的 `content` 以另一条更早 assistant 行的**全文**为前缀（无分隔 ⇒ 必须用
`LEFT(a, CHAR_LENGTH(b)) = b`）。

逐行验证（只读，`temp/dryrun-1266.mjs`，见 §6）：末行 `content` == **所有更早非空轮正文的
逐字有序拼接** + 本轮正文，四例全部成立（`startsWith(concatBefore) === true`，且各段落在
拼接串里的偏移逐一吻合）⇒ 不是模型自我复述，是宿主无分隔累积。

| request_id | 轮数 | canonical 行落库时刻 | 请求发生时刻 | 污染落在哪 |
|---|---|---|---|---|
| `req_457xy398cytzsb4h` | 4 | `2026-11-02 02:17:59`（与请求同秒，**引擎直写**） | `2026-11-02 02:17:50` | **只有 `messages` 末行**（canonical 末轮 = 477 干净） |
| `req_45548rfy4t4y5m4f` | 10 | `2026-10-09 11:54:52`（**Stage-B 回填**） | `2026-10-03 16:44:56` | **canonical 本身**（该轮 record 的正文就是累积串） |
| `req_455497ssynxk9kde` | 17 | `2026-10-09 11:54:53`（回填） | `2026-10-03 16:52:03` | 同上 |
| `req_45548nmbm493bdhq` | 5 | `2026-10-09 11:54:52`（回填） | `2026-10-03 16:43:31` | 同上 |

后三个的 canonical 是 `scripts/backfill-transcript-canonical.js`（#1156 Stage B）**从展示面
重建**的：那个年代 `agent_rounds.record_json` 不存正文（本轮实测 `messages` 字段长度为 0），
正文只在 `messages` 行里，回填只能取它 ⇒ 累积串被一起搬进了 canonical。
所以对这三个请求，「canonical 是真值」这条纪律的结果是：**没有可改的一侧**——
canonical 与 `messages` 逐字相同，改任何一边都等于动 canonical。

## 5. 修法（零 DDL，不动 `models/`，字段名全程 snake_case）

1. `agent-loop.js` 两条路径都新增**按轮**正文变量（legacy `lastRoundContent`、erix `roundContent`
   在 `round_start` 清零），**返回值 `fullContent` 改成末轮自己的正文**；累积串原样保留给
   `recovering` 事件（前端替换语义要的就是它）。
2. `chat-service.js#saveAssistantMessageAndCompleteRequest`：`content` **空正文不覆盖列**
   （挡 §3 那个 `LIMIT 1` 次生风险）；非空照旧写（recall post-check 的修正要靠这一列落库）。
3. **不新增可选字段**：整段正文不需要另存——每一轮的正文在 `messages` 里本来就有自己一行，
   「整段」是读侧按轮拼接的事（`#1237` 的 `run_reasoning_content` 是为「思考只有一条落库通道」
   才另存的，正文没有这个问题）。因此本单**没有**新增任何列、字段或 API 键。

## 6. 存量行 dry-run（只读；生产写由主 agent 走 #1246 闸门）

复跑命令（只读，零写入）：

```bash
# ① 逐轮对账（脚本自带 --dry-run 语义：不给 --fix-*/--apply 就一行不写）
PW=$(docker exec touwaka-mate env | grep '^DB_PASSWORD=' | cut -d= -f2-)
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=touwaka DB_PASSWORD="$PW" DB_NAME=touwaka_mate \
ALLOW_NON_TEST_DB=1 node scripts/verify-transcript-projection.mjs \
  --request-id req_457xy398cytzsb4h --request-id req_45548rfy4t4y5m4f \
  --request-id req_455497ssynxk9kde --request-id req_45548nmbm493bdhq \
  --json --report /tmp/1266-projection-dryrun.json
```

结果：**只有 `req_457xy398cytzsb4h` 报 `content_mismatch`**（`messages` 490 → canonical 477）；
另外三个 `counts = {}`（对账器认为两边一致，因为它们本来就把污染一起搬进了 canonical）。

| request_id | 表 | 行 | 改前 | 改后 | 动作 |
|---|---|---|---|---|---|
| `req_457xy398cytzsb4h` | `messages` | `457xy3xgwx29eb2f7s8q`（round 4，末轮） | 490 | **477** | 可重建（canonical 干净） |
| `req_45548rfy4t4y5m4f` | `messages` + `agent_transcript_rounds` | 末轮行 `45548wwu68k2jgs628gk` / `…:engine:round:10` | 4128 | 783（= 4128 − 前 9 轮拼接 3345） | **不可按契约重建**（canonical 同污染） |
| `req_455497ssynxk9kde` | 同上 | 末轮行 `45549kskvtmn3uc4snhd` / `…:engine:round:17` | 3433 | 517（= 3433 − 2916） | 同上 |
| `req_45548nmbm493bdhq` | 同上 | 末轮行 `45548ram7zz3hzw65pqh` / `…:engine:round:5` | 767 | 624（= 767 − 143） | 同上 |

「改后」列的算法是**可推导**的（与 #1237 的 `C-derived` 同口径）：末行 == 各更早非空轮正文的
逐字拼接 + 本轮正文 ⇒ 后缀就是本轮正文。但写它必须**同时改 canonical**，而契约第 1 条
禁止动 `agent_transcript_rounds` ⇒ 本单只报不改，等主 agent 裁决。

`req_457xy398cytzsb4h` 的重建机制（二选一，都不写 canonical）：
- **定向 UPDATE**（推荐，单表单列、幂等）：`UPDATE messages SET content = :canonicalText WHERE id = :id AND content <> :canonicalText`，
  目标值 = `agent_transcript_rounds` 该轮 record 里 assistant 的 text 块拼接（本例 477）。
  与 `--fix-reasoning`（`applyReasoningRewrites`）同一形状，天然带 #1246 备份闸门与幂等夹子。
- 读侧投影重建（`projectRequest({ apply: true })` / `--apply`）：对账器已判 `content_mismatch`，
  upsert 会用 canonical 覆盖 `content`；但 `assertProjectionApplyAllowed()` **在生产库直接拒绝**
  `--apply`，且它同时会写 `agent_rounds` / `chat_tool_calls`，写入面比需要的宽。

## 7. 判据

- 新增测试格（`tests/llm-kit-adapters/reasoning-per-round.test.mjs`，已在 `test:llm-kit` 清单里）：
  ① 末轮行 `content` 恰等末轮正文；② 它 ≠ 跨轮累积串；③ 前轮那条短正文行仍在且未被改写；
  另加「空正文不覆盖终稿行」一格。
- 关门判据：`node scripts/verify-transcript-read-parity.js --gate --baseline /docker/touwaka-backups/drill-261102/snap-full-prod.json`
  退出码 0。**现在还不能达成**：`req_457xy398cytzsb4h` 的 `messages` 末行还是 490（存量），
  修完写侧只保证**新请求**不再产生这一类；存量那一行必须先按 §6 重建（生产写，主 agent 执行）。
  另外三个请求不触发门禁（legacy 与 canonical 读出来逐轮一致），它们只在**消息列表 UI** 上可见重复。
