
## 9. 本轮已落地（截至交付时点）

| 项 | 状态 | 落点 | 验证 |
|---|---|---|---|
| §3 Phase 0 两条（#439 逐条 `ts` + 去重剥 `ts`） | **已实现** | `lib/llm-kit-adapters/transcript-store.js` 的 `stampRowTs()` / `withoutJournalTs()`，接在 `foldMessageRows()` 的三个折入点 | `tests/llm-kit-adapters/transcript-message-rows-fold.test.mjs` 共 12 用例，全绿 |
| §2.9 #447 多字节截断**原语** | **已实现，尚未接线** | `transcript-store.js` 导出的 `truncateMultisafe(value, max)`（按码点、剔孤立代理项高半边、省略号不计入 `max`） | `tests/llm-kit-adapters/text-control.test.mjs` 5 用例，全绿 |
| #439 B 出口净化、#463 usage.total、#464 L2/L3、#422 兜底、#416、#458 | **仅设计** | 见 §3 Phase 1/2 | — |

全量静态：`node --test tests/llm-kit-adapters/*.test.mjs` → 117 tests / 92 pass / 0 fail / 25 skipped（runtime-gated）；`npm run lint` 通过。
`truncateMultisafe` 目前是**待接线的原语**（Phase 2 接线点：`save()` 写前的工具输出截断、`load()` 出口的文本净化），刻意不抢在 runtime 基线之前改写路径。

## 10. Phase 1 落地（续 §9）

| 上游 | 本副本落点 | 口径 |
|---|---|---|
| #463 usage.total | `provider-adapter.js#normalizeUsage`（改为导出）：新增 `tokenCount()`，补 cache_read/cache_write 分项，缺 `total` 时按**族名**派生 | Anthropic 家族（带 `input_tokens`，input 不含缓存）⇒ total = input+cache_read+cache_write+output；OpenAI 家族（只带 `prompt_tokens`，已含 `cached_tokens`）⇒ total = prompt+completion，缓存不再加第二遍。provider 报了 total 就照抄（幂等），分项全缺不造 0 |
| #422 只回 reasoning | `provider-adapter.js#toChatResponse`（改为导出）：只加 `providerThinkingOnly=true` 标记，**不改 stopReason**、且只在命中时写键 | 既有按 stopReason 分支的消费方与对返回值做 deepEqual 的断言零行为变化；需兜底的调用方读标记决定重试/降级 |
| #464 有界压缩 | `lib/agent/history-compactor.js#compactHistory`：`assemble(keepCount)` + `while (hardBudget>0 && over && keep>1)` 递减折叠，返回新增 `stillOverBudget` | 默认（不给 hardBudget / 不设 `CHAT_COMPACT_HARD_BUDGET_TOKENS`）逐字节等价于既有行为；给了才继续往里折，keep 单调递减到 1 ⇒ 必然终止；折到底仍超预算如实报，不再拿 `compacted=true` 当假绿灯 |

测试：`tests/llm-kit-adapters/provider-usage.test.mjs`（7）、`provider-thinking-only.test.mjs`（6）、`tests/agent/history-compactor-bounded.test.mjs`（5）。
仍未开工：#439 B 出口净化（`truncateMultisafe` 待接线）、#416 有界 journal、#458 工具名、#464 的 L2/L3 语义摘要（本副本只做预算维度的有界折叠，不做语义摘要）。

### 复跑记录（Phase 1）

- #463 是**契约变更**：`normalizeUsage` 现在会派生 `total_tokens`，既有 `provider-adapter.test.mjs` 里对 usage 做 deepEqual 的 2 处期望按新契约补了 `total_tokens`（脚本改的，n=2）；这不是回归，是上游口径落地。
- `tests/agent/*` 34 tests 全绿 ⇒ #464 的默认路径没有动既有行为。

## 11. 交付核对（2026-10-24，收口轮）

**git 状态**：全部改动落在默认分支 `master`，**未提交**（HEAD 仍是导入快照 `8b19148`），无分支、无 stash；`temp/` 下的 issue 草稿被忽略，不进提交。

**测试登记**：`package.json` 的 `test:llm-kit` 已补入本轮 4 个新测试（`provider-usage` / `provider-thinking-only` / `text-control` / `history-compactor-bounded`），此前只登记了 `transcript-message-rows-fold` —— 未登记的文件能手动跑绿但不进门禁。

**两处口径更正（早前口头汇报有误，以本节为准）**：
- 已装 `erix-agent@0.23.0`（入口 `src/index.js`）**不导出** `truncateToolMessageContent`、`normalizeToolName`、`normalizeToolResultName`、`MAX_TOOL_RESULT_CHARS`（实测 `typeof === "undefined"`），且 `lib/` 全仓**没有任何地方引用**它们。⇒ #447 的「持久/回喂文本被朴素 `slice` 截断」在**持久层没有落地面**（本副本持久层不截断工具输出，也没有 journal 层）；`truncateMultisafe` 目前是**待接线原语**，唯一现实候选接线点是 `lib/agent/agent-loop.js` 的日志/错误串 clamp（`safeLogField` 等 4 处 `slice(0, 200)`，属可观测性而非正确性）。同理 #458 在 0.23.0 无引擎侧对应物，本副本的 tool 名匹配面不依赖引擎归一函数。
- 因此**剩余上游差集的真实边界**是：#439 B（`load()` / `loadByDedupKey()` 出口剥档案信封 `ts` —— 两条路径必须同步改，否则破坏 #1150 的读对等不变式）、#416（有界 journal，本副本无 journal 层 ⇒ 需要的是持久层新语义，改的是写侧数据形状）。两者都改读写路径，**必须**在有 PG/Redis 的环境以 `npm run test:runtime` 建基线后才可动。
