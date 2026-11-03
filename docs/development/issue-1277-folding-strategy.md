# issue #1277 —— erix 折叠策略（`ERIX_FOLDING_STRATEGY`）

> 状态：已实现（2026-11-03，分支 `feat/20261103-fold-strategy`，基于 master `39f3d2f` / erix-agent `0.30.0`）。
> 用户裁决：**B —— 默认 `fold-llm`，且不加宿主侧降级处置**。

## 1. 问题（改造前的现场）

erix 路由（生产默认路径，`lib/agent/agent-loop.js` 的 `run()` 里 `ERIX_LOOP !== '0'` 就转
`runErix()`）交给引擎的折叠配置**只有预算、没有策略**：

```js
// 改造前（agent-loop.js，foldContext）
folding: { context: { budgetTokens, keepRounds, stripHistoricalImages } }
```

引擎的语义是：`folding.context.strategy` **未配置** ⇒ 超预算时走库层兜底
`createSlidingWindowStrategy()`（零 LLM 的机械折叠），并发一条 `compaction_strategy_fallback`
（erix-agent `src/loop/orchestrator.js:3853` 起）。结论：**本项目从来没吃到语义折叠**。
现网 30 天压缩 0 次只说明预算（默认 80k）相对模型窗口给得宽，不说明这条路是对的。

## 2. 三档策略

三档都是引擎内置策略名（`node_modules/erix-agent/src/compact/pipeline.js` 的注册表），
逐字匹配、**大小写敏感**：

| 名字 | 行为 | 每次真折叠的模型调用 | 新失败面 |
|---|---|---|---|
| `sliding-window` | 机械折叠（整轮 tail keep / head drop），零 LLM | 0 | 无 |
| `fold-statistical` | 统计式摘要折叠，零 LLM | 0 | 无 |
| **`fold-llm`（默认）** | 语义摘要折叠；摘要器由引擎用**本次 run 的 provider** 注入 | **1 次** | 有：摘要器坏/超时/空文本 ⇒ 本次 run `failed` |

复合档（引擎的 `fold-statistical+fold-llm`）**刻意不开放**：宿主只暴露这三档，
多开放一档就多一条没有用例覆盖的路径。

## 3. 配置面

| 项 | 值 |
|---|---|
| 环境变量 | `ERIX_FOLDING_STRATEGY` |
| 取值域 | `sliding-window` \| `fold-statistical` \| `fold-llm` |
| 未设 / 空串 / 纯空白 | 默认 `fold-llm`（与 `CHAT_COMPACT_BUDGET_TOKENS` 同姿势：`!raw` ⇒ 用默认值） |
| 落点 | `config.folding.context.strategy`（`agent-loop.js` 的 `foldContext`） |
| 装配点 | `lib/agent/folding-strategy.js#buildFoldingContext`（**唯一**装配点） |
| 非法值 | **装配处当场抛** `FoldingStrategyConfigError`（`code = invalid_folding_strategy`），报错点名「收到的值 + 合法清单 + 环境变量名」 |

**非法值不静默退回默认档**，也不等引擎启动期那个 `TypeError`（引擎的报错不含我们的环境变量名，
运维看到它找不到该改哪里）。它被当成**配置错误**：`runErix` 在**发第一个请求之前**就抛，
0 次 provider 调用（用例 `#1277 非法环境变量` 钉住了这一点）。

`budgetTokens` / `keepRounds` / `stripHistoricalImages` 三个成员的**语义与取值一律不动**
（本单只新增 `strategy` 一格，键集合由用例钉死）。

## 4. 默认档 `fold-llm` 与**硬失败**语义（裁决 B，别读错）

> **摘要器坏 = 这次 run 以 `failed` 收尾，是用户可见的硬失败。**
> 这是有意的取舍：0.30 之前引擎会把它静默降级成统计摘要，质量掉了没人发现
> （erix-agent #661 改成了终局错误）。一键回退口是环境变量，**不需要发版**。

具体到我们这一层：

- **不做**（裁决明确否决，任何人不要加回来）：自动重试、自动改选 `fold-statistical`、
  把终局改成 `completed`。
- **要做**（本单落地的最低要求「失败可读、留证」）：
  - 终局语义**不改**：`termination.reason = "failed"`、`termination.errorCode = "summarizer_failed"`；
  - 日志面：一条结构化 ERROR（`event=erix.summarizer_failed`），字段含 `details_kind`
    （`timeout` / `context_window_exceeded` / `empty_summary` / `error`）、根因 `root_error_code`、
    `strategy`、`termination_*`、`host_degraded: false`（显式写死「没有降级处置」）；
  - 响应面：`error.message` 换成
    `上下文折叠失败：fold-llm 摘要器出错（kind=…, 根因 errorCode=…）：<引擎原文>`；
    流式走 `error` 帧、非流式走 `{success:false, error}`（**契约不变**，只换文案），
    原始错误挂在 `cause` 上；
  - 不许冒泡成未捕获异常或裸 500 堆栈：`chat-service.js` 的两条 catch（`streamChat` / `chat`）
    本来就把错误收成 `onError` / `{success:false}`，本单只补「说清楚」。

### 一键回退（运维）

```bash
# 摘要器坏了 / 想省掉那次模型调用：先退到统计式（零 LLM）
ERIX_FOLDING_STRATEGY=fold-statistical
# 连机械折叠都想要最保守的：退到库层兜底同款
ERIX_FOLDING_STRATEGY=sliding-window
# 回到默认（语义折叠）
unset ERIX_FOLDING_STRATEGY
```

## 5. 观测语义升级：`compaction_strategy_fallback`

这条事件仍在「**故意留 WARN**」清单里（`agent-loop.js` 的 `DELIBERATELY_IGNORED_*` 之外的
`default` 分支）。语义**升级**为：

> 配上策略之后，`compaction_strategy_fallback` **再出现就说明策略没生效**（装配处被绕过 /
> 有人把 `strategy` 又删了 / 引擎改了兜底触发条件）＝ **配置错误**。

**告警不许删**：它是这条判据唯一的观测通道。用例 `#1277 三档策略都能配起来` 断言「配置了策略 ⇒
该事件 0 次」，并用一格**变异自证**（把 `strategy` 从配置里拿掉）证明这条断言不是空断言。

## 6. 成本可见（`fold-llm` 多出来的那一次模型调用）

- 摘要器**继续走统一层**：引擎的默认摘要器是 `createProviderSummarizer({ chat: provider.chat ... })`
  （`orchestrator.js:1649` 起），`provider` 就是本仓
  `lib/llm-kit-adapters/provider-adapter.js` 造的那一个（`createTouwakaProvider`）
  ⇒ 摘要那一发落进 `llmClient.call`（非流式）。**没有**为折叠另开 provider 出口。
- 用量入账：引擎 `addUsage(response, undefined, { trackLatest: false, account: "engine" })`
  ⇒ `result.usage = modelUsage + engineUsage`，宿主侧 `tokenUsage`（= `loopResult.usage`）**包含**
  摘要那一发。
- 日志面：本单顺手修了 `erix.compaction` 那条一直是 `null` 的日志（见 §7），现在每次折叠都能读到
  `strategyName`、`foldedRounds`、`tokensBefore/After`、以及 `summarizerInputTokens` /
  `summarizerOutputTokens`（摘要那一发的 token 量级）。
- 实测（契约层，假 provider 报 777 prompt / 33 completion per summarizer call）：
  `engineUsage` 恰好 = 折数 × (777, 33)，`usage = modelUsage + engineUsage`；
  e2e（`runErix`）里 `tokenUsage` 也按同一口径增长（例：4 轮流式 2/3 + 2 次摘要 777/33
  ⇒ prompt 1562 / completion 78）。
- **未证明**：真机（真实 provider）上一次 `fold-llm` 折叠的账单。本单没有跑真机 run
  （生产库只读边界 + 不为一张单子烧真 token），所以「线上确实多算了那一发」只在**契约层**证明。

## 7. 顺手修的现场缺陷：`erix.compaction` 日志一直是 `null`

`createErixEventHandler` 的 `case 'compaction'` 从**事件顶层**读 `foldedRounds` / `tokensBefore` /
`tokensAfter`，而引擎把统计装在 `event.compaction` 里
（`recordCompactionStat()`：`emitEvent({ type: "compaction", round, compaction })`）⇒ 这四个字段
**恒 `null`**。因为现网 30 天压缩 0 次，这条日志从来没被人看到过；本单把默认档改成 `fold-llm`
之后折叠会真的发生，观测面必须能读。修法：优先读 `event.compaction.*`（顶层平铺仍作兜底），
并补上 `strategyName` 与摘要 token 两格。用例 `#1277 变异自证：摘要器换成恒成功` 断言这四格
不再是 `null`，且摘要 token 量级读得出来。

## 8. 用例与变异自证

| 文件 | 内容 |
|---|---|
| `tests/agent/folding-strategy.test.mjs` | 纯函数：默认档 / 三档 / 非法值报错三件事齐全 / `buildFoldingContext` 键集合；失败事实与可读错误的映射 |
| `tests/agent/fold-strategy-contract.test.mjs` | 契约层（`buildErixRunOptions` + 真引擎 + **我们的 provider 适配器**）：三档生效、无兜底告警、`compactionStats[].strategyName` 归因、成本分账；e2e（`runErix`）：摘要器抛错/空摘要的硬失败 + 日志字段 + 非法值 0 调用 |

变异自证（真跑过，见 `docs/tasks/active/task-1277-fold-strategy/README.md` 的留痕）：

| 变异 | 结果 |
|---|---|
| A：`buildFoldingContext` 不再写 `strategy`（回到改造前形状） | 16 例里 **8 例红**（含「三档生效」「无兜底告警」「成本分账」「失败可读」） |
| B：默认档改成 `fold-statistical` | **5 例红**（含默认档判据与 e2e 的摘要器调用次数） |
| C：`isSummarizerFailure` 恒 `false`（假装认不出） | **6 例红**（失败可读整组） |
| D：`compaction` 日志回到「从顶层读」的旧写法 | **1 例红**（`erix.compaction` 四格不再是 null 的断言） |

## 9. 一处既有用例的校正（透明记录）

`tests/agent/agent-loop-erix.test.mjs` 的「`runErix` emits `history_compacted` with the compaction shape」
原先顺带断言 `tokensBefore > tokensAfter`。**这条是 `sliding-window` 的专属性质**：机械折叠靠丢头部
缩量，而语义折叠在预算=1 这种荒谬预算下，摘要文本本身可能比被折掉的原文更长（实测 52 → 111 tok）。
默认档改成 `fold-llm` 后该断言失效——不是回归，是断言写死了旧默认档的性质。
处置：该用例把策略钉在 `sliding-window`（保持它原本要测的东西），语义折叠档的折叠判据改由
`fold-strategy-contract.test.mjs` 覆盖（含 `history_compacted` 形状与摘要成本）。

## 10. 取证边界

- 打开过：`lib/agent/agent-loop.js`（`runErix` 全文、事件处理器、`foldContext` 装配点）、
  `lib/llm-kit-adapters/provider-adapter.js`（`chat` / `chatStream` / usage 归一）、
  `lib/llm-kit-adapters/loop-bridge.js`（`buildErixRunOptions` 的 config 直通）、
  `lib/chat-service.js`（两条 catch 的失败面）、`server/controllers/stream.controller.js`（`onError` → DB + 广播）、
  `lib/logger.js`（`logFile` 与同步 append），以及 erix-agent 0.30.0 的
  `src/loop/orchestrator.js`（`fail()` / `addUsage` / 兜底告警 / `recordCompactionStat` / 默认摘要器）、
  `src/compact/fold-llm.js`（`summarizerFailure` / `classifyFoldDegradeKind` / `assertUsableSummary`）、
  `src/loop/termination.js`（`withErrorCode` / `annotateTermination`）、`src/compact/pipeline.js`（策略注册表）。
- 没跑到：**真机（真实 provider）的一次 `fold-llm` 折叠**（成本那一格只在契约层证明，见 §6）；
  生产库的任何写操作（本单无 DDL / 无数据迁移）。
