/**
 * Agent loop.
 *
 * This module owns the streaming LLM/tool loop for an Agent run. Phase A moves
 * the existing root chat loop here without changing its behavior.
 */

import LLMClient from '../llm-client.js';
import logger from '../logger.js';
import { isRetryableError } from '../llm-retry.js';
import { getToolCallDisplayNames, presentToolCalls, toToolCallArray } from '../tool-call-presenter.js';
import { addTokenUsage } from '../token-usage-accumulator.js';
import { createRoundStateSnapshot, restoreRoundStateSnapshot } from '../chat/round-state-snapshot.js';
import { getSystemSettingService, DEFAULT_SETTINGS } from '../../server/services/system-setting.service.js';
import { resolveEffectiveMaxToolRounds } from './max-tool-rounds.js';
import { compactHistory } from './history-compactor.js';
// issue #1277：折叠策略的配置面（`ERIX_FOLDING_STRATEGY`）独立成模块——纯函数/纯数据，
// 不必连库就能测（见 `tests/agent/folding-strategy.test.mjs`）。
import { buildFoldingContext } from './folding-strategy.js';
import { canonicalToOpenAIMessages, runToolLoop } from 'erix-agent';
import { createTouwakaProvider } from '../llm-kit-adapters/provider-adapter.js';
// #1227 阶段 2 切片 B2：同 key 异 payload 的可判定冲突错（与上游 `DEDUP_CONFLICT_CODE` 同值，
// 见 lib/llm-kit-adapters/transcript-payload-fingerprint.js 的对照表）。
import { DEDUP_CONFLICT_CODE } from '../llm-kit-adapters/transcript-payload-fingerprint.js';

// erix retry.attempts counts additional retries: 2 means 3 total attempts.
// The same retry options cover provider and persistence writes; this streaming
// path calls runToolLoop directly and does not use BaseLLM.retryWithBackoff.
const DEFAULT_STREAM_RECOVERY_MAX_ATTEMPTS = 2;
const DEFAULT_STREAM_RECOVERY_BASE_DELAY_MS = 1500;
const DEFAULT_STREAM_RECOVERY_MAX_DELAY_MS = 10000;

const HANDLED_ERIX_EVENT_TYPES = new Set([
  'round_start',
  'attempt',
  'recovering',
  'recovered',
  'usage',
  'round_end',
]);

/**
 * issue #1255：**按设计不会发射**的 erix 事件类型（显式清单，命中打 DEBUG + 计数，不打 WARN）。
 *
 * 为什么要一张显式清单、而不是「不认识的都静默」：`run_outcome` 当初就是靠 `default` 那条
 * `erix.unhandled_event` WARN 才被发现的（现网 24h 8 条、每 run 恰好一条）。把 WARN 调成静默，
 * 等于把「引擎新加了一种事件」这条唯一的发现通道拆掉。所以这里**只列结构上不可能发生的类型**，
 * 清单之外的未知事件照旧 WARN（见 `default` 分支）。
 *
 * 每一条都必须写清「为什么结构上不会发」和「什么变化会让它重新可能发生」——否则这张清单
 * 会变成藏 bug 的地方。
 */
const DELIBERATELY_IGNORED_ERIX_EVENT_TYPES = new Set([
  // 续接块（continuity）三兄弟：全部被 `config.continuity.handoff` 的开关挡住。
  // 结构上不会发：`orchestrator.js:778` 把 `effectiveOptions.handoff` 归一成 `continuityWriteMode`，
  // 缺省是 `"off"`（`orchestrator.js:484` 的默认值注释），而 `off` 时读/写两条路径都在第一行就
  // return（`orchestrator.js:3122` 读、`:3227` 写），事件发不出来。touwaka 从未配置
  // `config.continuity`（`grep -rn "continuity" lib/ server/` = 0 命中）⇒ 恒为 off。
  // 复开判据：一旦给 `config.continuity.handoff` 赋 `prompt` / `prompt-and-fallback`，这三种事件
  // 立刻变成可达，必须从本清单删掉并补对应的处理分支。
  'continuity_written',
  'continuity_write_failed',
  'continuity_injection_skipped',
  // 结构上不会发：`final_guard_extend` 只在 `extendAfterGuard`（`orchestrator.js:4517`）里发，
  // 那条路要求宿主传了 `finalGuard` 回调（没传时 `verification` 恒 `skipped/no_final_guard`）。
  // touwaka 从未传（`grep -rn "finalGuard" lib/ server/` = 0 命中）⇒ 不可达。
  // 复开判据：接入 `finalGuard`（最终输出保护 / 判据核验）时，`final_guard` 与
  // `final_guard_extend` 会一起出现，两者都要重新评估。
  'final_guard_extend',
  // 结构上不会发：`config_override_conflict`（`orchestrator.js:1271`）要求「同名扁平键与 `config.*`
  // 同时给出**不同的值**」（或装配口 policy 与调用级 config 两棵树逐叶冲突）。touwaka 走 0.29 的
  // **纯嵌套**写法，一个扁平同名键都没传，而且扁平名本身会被 0.29 的名称闸口当场拒
  // （`assertConfigNamespace` 一系，见 `agent-loop.js` 里 `buildErixRunOptions` 的注释）⇒ 冲突无从产生。
  // 复开判据：一旦为了兼容旧写法重新引入扁平别名，这条立刻可能发。
  'config_override_conflict',
  // 结构上不会发：`resume_journal_skipped`（`orchestrator.js:2845`）只在**恢复路径**上发，要求宿主
  // 传 `resume`（`config.run.resume` / resume 坐标）。touwaka 未接 resume/replayPolicy
  // （`grep -rn "resume" lib/llm-kit-adapters/loop-bridge.js` 只有一条注释）⇒ 不可达。
  // 复开判据：接入崩溃续跑（resume）时，这条与 `tool_replay_decision_required` 会一起变成可达。
  'resume_journal_skipped',
]);

/**
 * issue #1249：**我们知道自己没实现、且已裁定不实现**的可选 store capability（按 `method` 名分流）。
 *
 * 与上面 `DELIBERATELY_IGNORED_ERIX_EVENT_TYPES` **同一哲学**（显式清单、命中降噪、清单外仍 WARN），
 * 但分流键不同：那张表分的是**事件类型**，这张表分的是 `persistence_capability_degraded` 这一种
 * 事件里的 **`method` 字段**。为什么不按事件类型整体降噪：这一种事件同时承载两件性质相反的事——
 * 「我们刻意没实现的可选端口」（噪声，每 run 必发）与「引擎认为该有的端口不见了」（信号）。
 * 按 `type` 降噪会把后者一起埋掉，那正是本单存在的理由。
 *
 * 引擎语义（`node_modules/erix-agent/src/loop/orchestrator.js:1230-1257` 的
 * `notifyCapabilitySkipped`，实测 0.29.0）：`persist()`（`:1321`）在
 * `typeof store?.[method] !== "function"` 时按方法名发一条（`Set` 去重 ⇒ 每 run 每方法一条），
 * 然后**跳过该次持久化、run 正常执行**（仅失去中途 crash resume）。
 * 载荷字段是 `{type, runId, parentRunId?, method, detail}`——`method` 是**字符串方法名**，
 * 取值就是 `persist()` 的第一个实参（`:1377` `"markRunState"`、`:1420`/`:3067` `"saveRunState"`）
 * 或 `persistRunSnapshot()` 的常量（`:2708` `"saveRunSnapshot"`）；resume 路径另有
 * `loadRunState` / `loadLatestRunSnapshot`（`loop/resume-manager.js:161`、`:469`）。
 * 必需面只有 `{appendRound, load}`（引擎 `orchestrator.js:511` 的 JSDoc 也把 run-state /
 * run-snapshot 标成 optional）。
 *
 * 每条都必须写「为什么是预期」+「什么变化必须让它重新评估」——否则这张表会变成藏 bug 的地方。
 * 裁定来源：Eric 2026-11-02 选 B ——**正式承认为预期降级并降噪**，不补 run-state / run-snapshot
 * 端口、不动 DDL（`llm_kit_run_checkpoint` 空表保留）。
 */
const EXPECTED_UNIMPLEMENTED_CAPABILITIES = new Set([
  // 为什么是预期：run-state 一族（markRunState / saveRunState / loadRunState）宿主全不实现——
  // `createErixStore`（`lib/llm-kit-adapters/loop-bridge.js:330`）刻意只暴露 4 个方法
  // {appendRound, load, loadByDedupKey, loadMaxRound}，理由写在 `:313-317`（「run-state / run snapshot /
  // checkpoint 可选 capability 有意不实现」）。`markRunState` 是引擎给 run 打的
  // running / failed / aborted 标记（`orchestrator.js:1376` 定义、`:1428` 终局补写），
  // **唯一读者**是 resume 的 `restorePersistedRunState()`（`resume-manager.js:157`）——
  // 而 touwaka 从不传 `resume`（`grep -rn "resume" lib/llm-kit-adapters/loop-bridge.js lib/agent/agent-loop.js`
  // 只有注释）⇒ 补这个端口买不到调用方。
  // 复开判据：① 接入崩溃续跑（resume）；或 ② 决定补 run-state 持久化（#1249 的 A 方案，需 DDL）。
  // 两者任一发生，本行必须删掉并实现端口——否则降噪会把这个缺口藏起来。
  'markRunState',
  // 为什么是预期：同上。引擎在轮结束/收尾时把整份 runLoopState 落一份（`orchestrator.js:1420`、
  // `:3067`），读者同样只有 resume（`resume-manager.js:157` 的 `loadRunState`）。
  // 复开判据：同 `markRunState`（接 resume 或补 run-state 时重新评估）。
  'saveRunState',
  // 为什么是预期：run 级 snapshot（工具执行前后的崩溃现场）。`persistRunSnapshot()`
  // （`orchestrator.js:2695`）在 `saveRunSnapshot` / 旧名 `saveCheckpoint` / `appendCheckpoint`
  // 三者皆无时发这一条（`:2708`），`method` 恒为**字面量** `"saveRunSnapshot"`（不会随旧名变）。
  // 落点表 `llm_kit_run_checkpoint` 已存在但**0 行、无写入方**（`docs/design/data-model.md` §3）。
  // 复开判据：同 run-state；另加一条——它一复活，`resume_journal_skipped` 与
  // `tool_replay_decision_required` 会**一起**复活（三者同属 resume 路径，见上面白名单）。
  'saveRunSnapshot',
]);

// 刻意**不**进上面那张清单的两条：`loadRunState` / `loadLatestRunSnapshot`。它们同属「我们没实现的
// 可选端口」，但只在 resume 路径上发（`resume-manager.js:161`、`:469`），touwaka 未接 resume ⇒ 现在
// 恒不发（现网 24h 实测只有上面 3 个方法）。把它们也塞进清单等于「哪天有人接了 resume 却忘了实现
// loader」时我们**哑掉**——那恰恰是本清单最该报警的场面。所以只降噪**现在每 run 必发**的 3 个写端口。

// issue #1255：`run_outcome` 的字符串字段（尤其 `termination.detail`——可能是整条错误 message
// 或预算串）入日志前统一截断到 500 字符。`safeLogField` 的默认 200 是给短标识（type/method）
// 用的；这里放宽到 500 是因为终局 detail 的诊断价值往往在中段，截太短等于没记。
const RUN_OUTCOME_LOG_TEXT_MAX = 500;

function readEventField(event, field) {
  try {
    return event?.[field];
  } catch {
    return undefined;
  }
}

function safeLogField(value, maxLength = 200) {
  if (typeof value === 'string') return value.slice(0, maxLength);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean' || value === null) return value;
  return null;
}

function persistenceErrorFields(errorEvent, request_id, source) {
  const nestedError = readEventField(errorEvent, 'error');
  const error = nestedError === undefined ? errorEvent : nestedError;
  const errorMessage = readEventField(error, 'message');
  const errorCode = readEventField(error, 'code') ?? readEventField(errorEvent, 'code');
  const readFromEventOrError = field => (
    safeLogField(readEventField(errorEvent, field) ?? readEventField(error, field))
  );

  return {
    event: 'erix.persistence_error',
    source,
    request_id: safeLogField(request_id),
    port: readFromEventOrError('port'),
    phase: readFromEventOrError('phase'),
    operation: readFromEventOrError('operation'),
    runId: readFromEventOrError('runId'),
    fatal: readFromEventOrError('fatal'),
    sideEffect: readFromEventOrError('sideEffect'),
    ts: readFromEventOrError('ts'),
    error_message: typeof errorMessage === 'string'
      ? errorMessage.slice(0, 200)
      : typeof error === 'string'
        ? error.slice(0, 200)
        : 'Unknown persistence error',
    error_code: safeLogField(errorCode),
  };
}

function reportErixCallbackFailure(targetLogger, request_id, callback, eventType, error) {
  const fields = {
    event: 'erix.callback_error',
    callback,
    request_id: safeLogField(request_id),
    type: eventType,
    error_message: safeLogField(readEventField(error, 'message')) ?? 'Unknown callback error',
    error_code: safeLogField(readEventField(error, 'code')),
  };
  try {
    targetLogger.error('[AgentLoop] erix 回调内部异常', fields);
  } catch {
    try {
      console.error('[AgentLoop] erix 回调内部异常', fields);
    } catch {
      // Logging must never interrupt the agent run.
    }
  }
}

export {
  DELIBERATELY_IGNORED_ERIX_EVENT_TYPES,
  EXPECTED_UNIMPLEMENTED_CAPABILITIES,
  HANDLED_ERIX_EVENT_TYPES,
};

export function createErixEventHandler({
  request_id,
  logger: targetLogger = logger,
  onKnownEvent = () => {},
} = {}) {
  let toolUseCount = 0;
  let toolResultCount = 0;
  // issue #1255：白名单事件也要留计数。打 DEBUG 不打 WARN 的前提是「它确实按设计不发」——
  // 一旦计数开始涨，说明上面那条「结构上不会发」的推理已经不成立，该回来重新评估。
  const deliberatelyIgnoredCounts = new Map();
  // issue #1249：预期降级的 capability 同样要留计数（按 `method` 分桶）。理由与上一行相同：
  // 「我们知道它每 run 发一条」是当前事实，一旦某个方法名的条数开始偏离（比如每轮一条、
  // 或冒出新的 `method` 取值），就是接线变了，该回来重新评估。
  const expectedCapabilityCounts = new Map();

  return event => {
    let type = 'unknown';
    try {
      const rawType = readEventField(event, 'type');
      type = typeof rawType === 'string' && rawType.length > 0
        ? rawType.slice(0, 200)
        : 'unknown';

      if (HANDLED_ERIX_EVENT_TYPES.has(type)) {
        onKnownEvent(event);
        return;
      }

      const runId = safeLogField(readEventField(event, 'runId'));
      const baseFields = { request_id: safeLogField(request_id) };

      // issue #1255：显式白名单——结构上不会发的类型，打 DEBUG + 计数。
      // ⚠ 这不是「其他一律静默」：清单之外的未知事件仍然落到下面的 `default` 打 WARN。
      if (DELIBERATELY_IGNORED_ERIX_EVENT_TYPES.has(type)) {
        const count = (deliberatelyIgnoredCounts.get(type) ?? 0) + 1;
        deliberatelyIgnoredCounts.set(type, count);
        targetLogger.debug('[AgentLoop] erix 事件按设计忽略（当前接线不会触发）', {
          event: 'erix.deliberately_ignored_event',
          ...baseFields,
          runId,
          type,
          count,
        });
        return;
      }

      switch (type) {
        // issue #1255：run 级终局汇总（引擎 0.29 经 onEvent 发出的新事件）。
        //
        // 为什么必须接：宿主此前对它**零处理**（`grep -rn "\.termination" lib/ server/` = 0 命中），
        // 所以「这个 run 到底怎么结束的」在生产上一直是黑洞：`termination.reason`
        // （end_turn / max_rounds_cap / aborted / failed …）、`errorCode`、`forcedFinal` 全不可见。
        // 这条日志是**净新增的观测面**：只打 INFO，不落库、不加 DDL（载荷没有 `ts`、没有 usage 汇总、
        // 没有 finalText，见引擎 `src/loop/judge-record.js` 的 `runOutcomeRecord()`）。
        //
        // 为什么只记这几格：`judgeRecordCount` 对 touwaka 恒 0（不传 `onJudge`）、`verification`
        // 恒 `skipped/no_final_guard`（不传 `finalGuard`）——`judgeRecordCount` 常数无信息量所以不记，
        // 而 `verification` 保留：它一旦变了（接入 finalGuard）就是最重要的信号。
        case 'run_outcome': {
          const termination = readEventField(event, 'termination');
          const verification = readEventField(event, 'verification');
          const bounded = value => safeLogField(value, RUN_OUTCOME_LOG_TEXT_MAX);
          targetLogger.info('[AgentLoop] erix run 终局', {
            event: 'erix.run_outcome',
            ...baseFields,
            runId: bounded(readEventField(event, 'runId')),
            // 载荷可能缺 `model` / `rounds`（早退失败、模型名未解析）：缺就写 null，
            // 不写 `undefined` 也不写字符串 "undefined"。
            model: bounded(readEventField(event, 'model')),
            rounds: safeLogField(readEventField(event, 'rounds')),
            termination: {
              reason: bounded(readEventField(termination, 'reason')),
              errorCode: bounded(readEventField(termination, 'errorCode')),
              forcedFinal: safeLogField(readEventField(termination, 'forcedFinal')),
              // 可能是整条错误 message 或预算串：入日志前截断到 500（见 RUN_OUTCOME_LOG_TEXT_MAX）。
              detail: bounded(readEventField(termination, 'detail')),
            },
            verification: {
              status: bounded(readEventField(verification, 'status')),
            },
          });
          break;
        }
        case 'persistence_capability_degraded': {
          // issue #1249：**按 capability 名（`method`）分流，不按事件类型降噪**。
          //   · 清单内（我们刻意没实现的可选端口）⇒ DEBUG + 计数。生产 `LOG_LEVEL` 缺省是
          //     `info`（`lib/logger.js:109` 的 `debug()` 在非 debug 级直接 return）⇒ 生产日志里
          //     这 3 条不再出现，这就是降噪的**全部**机制（没有改采样、没有改事件、没有落库）。
          //   · 清单外 / **缺 `method` 字段** ⇒ 保持原来的 WARN。后者是防「载荷字段名将来变了」：
          //     缺字段时绝不能静默，否则引擎换字段名 = 我们发现通道被静默拔掉。
          //   · 将来引擎若把某个**必需**端口报成降级，方法名不在清单里 ⇒ 仍然 WARN，不会哑。
          const method = safeLogField(readEventField(event, 'method'));
          if (typeof method === 'string' && EXPECTED_UNIMPLEMENTED_CAPABILITIES.has(method)) {
            const count = (expectedCapabilityCounts.get(method) ?? 0) + 1;
            expectedCapabilityCounts.set(method, count);
            targetLogger.debug('[AgentLoop] erix 可选能力未实现（预期降级，已降噪）', {
              event: 'erix.persistence_capability_degraded_expected',
              ...baseFields,
              runId,
              method,
              count,
            });
            break;
          }
          // 形状与 #1249 之前**逐字段一致**（不新增字段），既有日志检索/看板口径不变。
          targetLogger.warn('[AgentLoop] erix 持久化能力降级', {
            event: 'erix.persistence_capability_degraded',
            ...baseFields,
            runId,
            method,
          });
          break;
        }
        case 'forced_final':
          targetLogger.warn('[AgentLoop] erix 触发强制收尾', {
            event: 'erix.forced_final',
            ...baseFields,
            reason: safeLogField(readEventField(event, 'reason')),
          });
          break;
        case 'tool_output_aggregate': {
          const action = [
            'action',
            'status',
            'outcome',
            'mode',
          ].map(field => safeLogField(readEventField(event, field)))
            .find(value => value !== null) ?? null;
          const fields = {
            event: 'erix.tool_output_aggregate',
            ...baseFields,
            action,
          };
          if (action === 'archived') {
            targetLogger.info('[AgentLoop] erix 工具输出已归档', fields);
          } else if (action === 'terminated') {
            targetLogger.error('[AgentLoop] erix 工具输出聚合终止，原文已丢失', fields);
          } else {
            targetLogger.warn('[AgentLoop] erix 工具输出聚合结果未知', fields);
          }
          break;
        }
        case 'final_guard': {
          const action = safeLogField(readEventField(event, 'action'));
          const fields = {
            event: 'erix.final_guard',
            ...baseFields,
            action,
          };
          if (action === 'error') {
            targetLogger.error('[AgentLoop] erix 最终输出保护异常', fields);
          } else if (action === 'degraded') {
            targetLogger.warn('[AgentLoop] erix 最终输出保护降级', fields);
          } else {
            targetLogger.info('[AgentLoop] erix 最终输出保护结果', fields);
          }
          break;
        }
        case 'compaction':
          targetLogger.info('[AgentLoop] erix 上下文压缩统计', {
            event: 'erix.compaction',
            ...baseFields,
            ...Object.fromEntries([
              'round',
              'foldedRounds',
              'tokensBefore',
              'tokensAfter',
            ].map(field => [field, safeLogField(readEventField(event, field))])),
          });
          break;
        case 'tool_use':
          toolUseCount += 1;
          targetLogger.debug('[AgentLoop] erix 工具事件计数', {
            event: 'erix.tool_event_count',
            ...baseFields,
            type,
            count: toolUseCount,
          });
          break;
        case 'tool_result':
          toolResultCount += 1;
          targetLogger.debug('[AgentLoop] erix 工具事件计数', {
            event: 'erix.tool_event_count',
            ...baseFields,
            type,
            count: toolResultCount,
          });
          break;
        case 'tool_replay_decision_required':
          targetLogger.warn(
            '[AgentLoop] erix 工具重放待宿主决策；当前未接 resume/replayPolicy，此路径预期不触发',
            {
              event: 'erix.tool_replay_decision_required',
              ...baseFields,
              runId,
            },
          );
          break;
        // issue #1255：**未知事件必须继续 WARN**——白名单（DELIBERATELY_IGNORED_ERIX_EVENT_TYPES）
        // 是显式清单，不是「其他一律静默」。这是本单存在的意义：`run_outcome` 当初就是靠这条
        // WARN 被发现的（现网 24h 8 条）。上游 `orchestrator.d.ts` 的事件 union 只列 19 种，比行为面
        // 少 6 种 ⇒ 类型面不能当穷举依据，唯一可靠的发现通道就是这条 default。
        //
        // 下列 4 种**故意留在 WARN**（不进白名单）：它们都是「我们想知道」的信号，不是噪声。
        //   · compaction_strategy_fallback：**配上策略之后，这条事件再出现就等于配置错误**
        //     （issue #1277 的判据，语义升级）。引擎只在 `folding.context.strategy` **未配置**时
        //     发它，并改用库层兜底 `sliding-window`（`orchestrator.js:3853` 起）——那正是本单之前
        //     本项目的常态：只给预算、没给策略 ⇒ 超预算必走机械兜底，从没吃到语义折叠。
        //     `foldContext` 现在**恒**带 `strategy`（默认 `fold-llm`，环境变量
        //     `ERIX_FOLDING_STRATEGY` 可改档），所以这条事件不该再出现；出现了就说明策略没生效
        //     （装配处被绕过 / 有人把 strategy 又删了 / 引擎改了兜底触发条件），按**配置错误**查。
        //     告警**故意不删**：它是这条判据唯一的观测通道（删了就等于「策略没生效」变哑）。
        //   · compaction_deferred：压缩被推迟（`orchestrator.js:4884`，尾部是未完结的 tool_use）。
        //     它意味着本发请求按本地估算超预算，属于「预算/截断」这类要看的信号。
        //   · budget_below_working_set：预算配小了（`orchestrator.js:4056`，工作集单独就超预算且
        //     模型反复重读同一输入）——run 会因此提前结束，这是配置问题，必须有人看。
        //   · model_metadata_missing：目前是**抑制态**（显式给了 `config.folding.context.budgetTokens`，
        //     引擎 `orchestrator.js:1512` 只在 `budgetTokens === undefined && !budgetMetadataComplete`
        //     时发）。若哪天不给预算、且 `ai_models` 缺 `max_output_tokens`，它就会天天发——
        //     那正是「压缩被静默关掉」的告警，不能静默。
        default:
          targetLogger.warn('[AgentLoop] 收到未处理的 erix 事件', {
            event: 'erix.unhandled_event',
            ...baseFields,
            type,
          });
          break;
      }
    } catch (error) {
      reportErixCallbackFailure(
        targetLogger,
        request_id,
        'onEvent',
        type,
        error,
      );
    }
  };
}

/**
 * 持久化包装层：把「同 key 异 payload」的**可判定冲突**降级为「丢弃本次写入 + 记一笔」
 * （issue #1227 阶段 2 切片 B2）。
 *
 * 为什么必须在这里抹平：erix `runToolLoop` 的 `persist()` 对 store 抛错的处理是
 * **重试（retry.attempts 次、指数退避）→ 仍失败 ⇒ 造 `persistence_failed` 终局**
 * （`node_modules/erix-agent/src/loop/orchestrator.js:1341-1370`）。对 "dedup_payload_conflict"
 * 这两个默认反应都是错的：
 *   · 重试无意义——同一份 payload 再发一次必然再撞同一条既有行，白费退避等待；
 *   · 整轮失败更错——canonical 里已经存着**同一身份键**的那份事实，本轮只是没能落自己这一版；
 *     引擎的 resume / 上下文重建读的是既有那份，丢掉这一版不会让 run 失去可继续的账本。
 * 因此包装层：`code === DEDUP_CONFLICT_CODE` ⇒ `logger.error`（带 key + 两份指纹 +
 * differingFields，便于对齐盘上事实）→ 返回（丢弃）→ 不重试、不让 run 失败；其余错误
 * **原样抛出**（真持久化故障必须继续走引擎的重试 + persistence_failed 路径，不得被这里吃掉）。
 *
 * 为什么是包装而不是改 store：store 是引擎面的写入口，它就该诚实地报冲突（上游两个内置
 * store 同形状），把「宿主怎么处置」的策略放在宿主 loop 层，职责边界不变。
 *
 * @template T
 * @param {T} store 引擎面 store（`{appendRound, load, ...}`）
 * @param {{ request_id?: string, logger?: { error?: Function } }} [options]
 * @returns {T} 同一个 store 形状的包装（无 appendRound 时原样返回）
 */
export function createDedupConflictTolerantStore(store, { request_id, logger: targetLogger = logger } = {}) {
  if (!store || typeof store.appendRound !== 'function') return store;

  return {
    ...store,
    async appendRound(runId, record) {
      try {
        return await store.appendRound(runId, record);
      } catch (error) {
        if (readEventField(error, 'code') !== DEDUP_CONFLICT_CODE) throw error;
        try {
          targetLogger.error(
            '[AgentLoop] erix transcript 同 key 异 payload 冲突，已丢弃本次写入（不重试、不让 run 失败）',
            {
              event: 'erix.transcript_dedup_conflict',
              request_id: safeLogField(request_id),
              runId: safeLogField(runId),
              key: safeLogField(readEventField(error, 'key')),
              existing_fingerprint: safeLogField(readEventField(error, 'existingFingerprint')),
              incoming_fingerprint: safeLogField(readEventField(error, 'incomingFingerprint')),
              differing_fields: Array.isArray(readEventField(error, 'differingFields'))
                ? readEventField(error, 'differingFields').slice(0, 8)
                : [],
              error_message: safeLogField(readEventField(error, 'message')),
              error_code: DEDUP_CONFLICT_CODE,
            },
          );
        } catch (logError) {
          reportErixCallbackFailure(
            targetLogger,
            request_id,
            'appendRound',
            'dedup_payload_conflict',
            logError,
          );
        }
        return undefined;
      }
    },
  };
}

export function createErixPersistenceErrorHandlers({
  request_id,
  logger: targetLogger = logger,
} = {}) {
  const report = source => errorEvent => {
    try {
      targetLogger.error(
        '[AgentLoop] erix transcript 持久化失败',
        persistenceErrorFields(errorEvent, request_id, source),
      );
    } catch (error) {
      reportErixCallbackFailure(
        targetLogger,
        request_id,
        source,
        'persistence_error',
        error,
      );
    }
  };

  return {
    diagnostics: { error: report('diagnostics.error') },
    onPersistenceError: report('onPersistenceError'),
  };
}

// R15: 任务型 agent（如锚点清洗）的过渡文本判定参数
const MAX_CONSECUTIVE_NO_TOOL_ROUNDS = 3; // 连续无工具调用且无完成信号的最大轮数
// R16-3: 补充"阶段3完成"“最终报告”等实际结束语——锚点清洗 agent 收尾时输出
// "## 阶段3完成！"（外部引用定位回写完毕），此前不在信号内被误判为过渡文本，
// 连续两轮追加 assistant 消息导致消息列表末尾相邻 assistant，provider 400 报错。
export const COMPLETION_SIGNALS = [
  '任务完成',
  '已完成全部',
  '全部完成',
  '所有引用已处理',
  '所有章节已',
  '清洗完毕',
  '处理完毕',
  '引用清洗完成',
  '清洗完成',
  '阶段3完成',
  '阶段 3 完成',
  '最终报告',
  '没有更多引用',
  'no more references',
  'all done',
  'complete',
];

/**
 * R16-3: 追加纯文本 assistant 消息，防御消息列表末尾出现连续 assistant。
 * OpenAI 兼容 API 拒绝末尾 2+ 条 assistant 消息（HTTP 400）。无工具调用轮会把
 * LLM 输出追加为 assistant 消息，若上一轮也走同路径，末尾会相邻两条 assistant。
 * 这里在末尾已是"纯文本 assistant"（无 tool_calls）时合并内容而非新增消息。
 *
 * @param {Array} messages - 消息列表
 * @param {string} content - 本轮 assistant 输出
 * @returns {Array} 更新后的消息列表
 */
function appendAssistantMessage(messages, content) {
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && !last.tool_calls && typeof last.content === 'string') {
    return [
      ...messages.slice(0, -1),
      { role: 'assistant', content: `${last.content}\n\n${content}` },
    ];
  }
  return [...messages, { role: 'assistant', content }];
}

function resolvePositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`${name} is required`);
  }
}

export class AgentLoop {
  constructor({
    db,
    execute_tools,
    save_llm_payload,
    generate_tool_call_summary,
  } = {}) {
    if (!db) {
      throw new Error('db is required');
    }
    assertFunction(execute_tools, 'execute_tools');
    assertFunction(save_llm_payload, 'save_llm_payload');
    assertFunction(generate_tool_call_summary, 'generate_tool_call_summary');

    this.db = db;
    this.execute_tools = execute_tools;
    this.save_llm_payload = save_llm_payload;
    this.generate_tool_call_summary = generate_tool_call_summary;
  }

  async run(expertService, { modelConfig, thinkingConfig, tools, currentMessages, llmPayload, user_id, expert_id, taskContext, topic_id, task_id, session, request_id, onDelta, shouldStop, runtimeState = null, agent_invocation_context = null }) {
    // L3-M3b: 默认由 erix-agent runToolLoop 承载循环（runErix），ERIX_LOOP=0 回退旧实现
    if (process.env.ERIX_LOOP !== '0') {
      return this.runErix(expertService, arguments[1]);
    }
    const systemSettingService = getSystemSettingService(this.db);
    // issue #1166：生效值统一走共享 helper——保留 `null`/`0` → 系统默认 的既有语义，
    // 并把遗留脏数据（负数 / 巨大值）夹进 1–50 且 logger.warn 留痕。
    const MAX_TOOL_ROUNDS = await resolveEffectiveMaxToolRounds({
      configured: expertService.expertConfig?.expert?.max_tool_rounds,
      resolveSystemDefault: () => systemSettingService.getMaxToolRounds(),
      systemDefaultFallback: DEFAULT_SETTINGS.tool.max_rounds.value,
      expert_id,
      request_id,
      source: 'agent-loop.run',
    });
    const MAX_STREAM_RECOVERY_ATTEMPTS = resolvePositiveIntegerEnv('CHAT_STREAM_RECOVERY_MAX_ATTEMPTS', DEFAULT_STREAM_RECOVERY_MAX_ATTEMPTS);
    const STREAM_RECOVERY_BASE_DELAY_MS = resolvePositiveIntegerEnv('CHAT_STREAM_RECOVERY_BASE_DELAY_MS', DEFAULT_STREAM_RECOVERY_BASE_DELAY_MS);
    const STREAM_RECOVERY_MAX_DELAY_MS = resolvePositiveIntegerEnv('CHAT_STREAM_RECOVERY_MAX_DELAY_MS', DEFAULT_STREAM_RECOVERY_MAX_DELAY_MS);

    // issue #1266：`fullContent` 是**跨轮累积串**（下面 `onDelta` 里 `fullContent += delta`，
    // 轮与轮之间没有任何分隔），它只用来在流式恢复事件里把「气泡里已经流过的全部文字」原样回填，
    // **不是**终稿正文。终稿正文必须是**最后一轮自己的**那一段（canonical 是真相），
    // 见 `lastRoundContent`。历史缺陷：把 `fullContent` 当终稿交给 chat-service 写末轮行
    // ⇒ 前几轮的可见文本在末轮行里又出现一遍（UI 同一句两次）。
    let fullContent = '';
    let lastRoundContent = '';
    let fullReasoningContent = '';
    let tokenUsage = null;
    let allToolCalls = [];
    let messages = [...currentMessages];
    let llmCallsCount = 0;  // P0 观测：记录 LLM 调用次数
    let consecutiveNoToolRounds = 0; // R15: 连续无工具调用计数

    const assertNotStopped = () => {
      if (shouldStop?.()) {
        throw new Error('Request aborted by user');
      }
    };

    const waitForRecoveryDelay = async (delayMs) => {
      if (delayMs <= 0) {
        assertNotStopped();
        return;
      }

      const stepMs = 100;
      let remaining = delayMs;
      while (remaining > 0) {
        assertNotStopped();
        const chunk = Math.min(stepMs, remaining);
        await new Promise(resolve => setTimeout(resolve, chunk));
        remaining -= chunk;
      }
      assertNotStopped();
    };

    // 更新 payload 基础信息
    llmPayload.model = modelConfig.model_name;
    llmPayload.temperature = expertService.llmClient.getExpertLLMParams().temperature;
    llmPayload.top_p = expertService.llmClient.getExpertLLMParams().top_p;
    llmPayload.frequency_penalty = expertService.llmClient.getExpertLLMParams().frequency_penalty;
    llmPayload.presence_penalty = expertService.llmClient.getExpertLLMParams().presence_penalty;
    llmPayload.max_tokens = modelConfig.max_output_tokens || 32768;
    if (tools.length > 0) llmPayload.tools = tools;

    logger.info('[AgentLoop] 开始调用 LLM，当前消息数:', messages.length);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      assertNotStopped();
      llmCallsCount++;  // P0 观测：记录 LLM 调用次数

      logger.info('[AgentLoop] 第', round + 1, '轮调用 LLM...');

      // 回收旧图片（compaction 后，旧 base64 替换为文本占位符）
      if (round > 0) {
        messages = LLMClient.stripHistoricalImages(messages);
      }

      // R19-1: 每轮调用前估算上下文，超预算时折叠最早历史轮次为摘要，
      // 防止长任务（如引用清洗打转）消息无上限增长撑爆模型窗口
      const compaction = compactHistory(messages);
      if (compaction.compacted) {
        messages = compaction.messages;
        llmPayload.messages = messages;
        llmPayload._debug.compacted_rounds = compaction.foldedRounds;
        llmPayload._debug.tokens_before_compact = compaction.tokensBefore;
        llmPayload._debug.tokens_after_compact = compaction.tokensAfter;
        llmPayload.cached_at = new Date().toISOString();
        this.save_llm_payload(user_id, expert_id, llmPayload);
        logger.warn(
          `[AgentLoop] 上下文超预算，已压缩历史: ` +
          `折叠 ${compaction.foldedRounds} 轮, tokens ${compaction.tokensBefore} -> ${compaction.tokensAfter} ` +
          `(round=${round + 1}, 消息数=${messages.length})`
        );
        onDelta?.({
          type: 'history_compacted',
          foldedRounds: compaction.foldedRounds,
          tokensBefore: compaction.tokensBefore,
          tokensAfter: compaction.tokensAfter,
          round: round + 1,
          content: `已自动压缩早期工具执行记录（${compaction.foldedRounds} 轮），以控制上下文长度。`,
        });
      }

      const roundSnapshot = createRoundStateSnapshot({
        round,
        messages,
        fullContent,
        fullReasoningContent,
        tokenUsage,
      });

      // 同步 request runtime 观测字段（统一状态真相源由 StreamController 持有）
      if (runtimeState) {
        runtimeState.round = round + 1;
        runtimeState.round_snapshot_ref = { round: round + 1, taken_at: new Date().toISOString() };
      }

      let collectedToolCalls = [];
      let roundContent = '';
      let attempt = 0;

      while (attempt <= MAX_STREAM_RECOVERY_ATTEMPTS) {
        assertNotStopped();
        try {
          if (runtimeState) {
            runtimeState.has_active_transport = true;
          }
          // 流式调用
          await expertService.llmClient.callStream(modelConfig, messages, {
            tools,
            thinking: thinkingConfig.thinking,
            reasoning: thinkingConfig.reasoning,
            reasoning_effort: thinkingConfig.reasoning_effort,
            enable_thinking: thinkingConfig.enable_thinking,
            chat_template_kwargs: thinkingConfig.chat_template_kwargs,
            user_id,  // 添加 user_id 用于 abort 机制
            request_id,
            recovery_test_round: round + 1,
            recovery_test_attempt: attempt,
            onDelta: (delta) => {
              roundContent += delta;
              fullContent += delta;
              onDelta?.({ type: 'delta', content: delta });
            },
            onReasoningDelta: (reasoningDelta) => {
              fullReasoningContent += reasoningDelta;
              onDelta?.({ type: 'reasoning_delta', content: reasoningDelta });
            },
            onToolCall: (toolCalls) => {
              const toolCallsForLog = toToolCallArray(toolCalls);
              const displayNames = getToolCallDisplayNames(toolCallsForLog, expertService.toolManager);
              logger.info(`[AgentLoop] 第${round + 1}轮收到工具调用:`, displayNames);

              collectedToolCalls.push(...toolCallsForLog);

              const toolCallsWithDisplayNames = presentToolCalls(toolCallsForLog, expertService.toolManager);
              onDelta?.({ type: 'tool_call', toolCalls: toolCallsWithDisplayNames });
            },
            onUsage: (usage) => {
              if (usage) {
                tokenUsage = addTokenUsage(tokenUsage, usage);
                logger.info(`[AgentLoop] 第${round + 1}轮 token 使用:`, {
                  prompt: usage.prompt_tokens,
                  completion: usage.completion_tokens,
                  total: usage.total_tokens,
                });
              }
            },
          });
          break;
        } catch (error) {
          if (runtimeState) {
            runtimeState.has_active_transport = false;
          }
          const isStopped = error.message === 'Request aborted by user';
          const isRetryable = isRetryableError(error);

          if (isStopped || !isRetryable || attempt >= MAX_STREAM_RECOVERY_ATTEMPTS) {
            throw error;
          }

          attempt += 1;
          if (runtimeState) {
            runtimeState.recovery_attempt = attempt;
          }
          const delayMs = Math.min(STREAM_RECOVERY_BASE_DELAY_MS * Math.pow(2, attempt - 1), STREAM_RECOVERY_MAX_DELAY_MS);
          logger.warn(`[AgentLoop] 第${round + 1}轮 LLM 流式调用失败，准备恢复重试: attempt=${attempt}/${MAX_STREAM_RECOVERY_ATTEMPTS}, delay=${delayMs}ms, error=${error.message}`);

          const restoredRoundState = restoreRoundStateSnapshot(roundSnapshot);
          fullContent = restoredRoundState.fullContent;
          fullReasoningContent = restoredRoundState.fullReasoningContent;
          tokenUsage = restoredRoundState.tokenUsage;
          collectedToolCalls = [];
          roundContent = '';
          messages = restoredRoundState.messages;

          onDelta?.({
            type: 'recovering',
            request_id,
            round: round + 1,
            attempt,
            max_attempts: MAX_STREAM_RECOVERY_ATTEMPTS,
            content: fullContent,
            reasoning_content: fullReasoningContent,
          });

          await waitForRecoveryDelay(delayMs);

          // 退避完成且未被停止：当前轮即将重新发起，通知状态机 recovering -> running
          onDelta?.({
            type: 'recovered',
            request_id,
            round: round + 1,
            attempt,
          });
        }
      }

      // issue #1266：本轮正文定型（无论本轮有没有工具调用）——终稿只认**最后一轮**这一段。
      // 放在这里而不是 `roundContent` 出圈后：`roundContent` 是轮内 `let`，出圈就没了。
      lastRoundContent = roundContent;

      // 如果没有工具调用，退出循环
      if (collectedToolCalls.length === 0) {
        // R15: 多轮任务（如锚点清洗 read→write 交替）中，LLM 可能在输出过渡文本后
        // 短暂不调用工具（例如"已读取章节，开始分析"）。此时不能简单判定任务完成：
        // - 从未调用过工具（普通对话）→ 直接完成，保持原行为
        // - 之前调用过工具（任务型 agent）→ 检查文本是否含完成信号，无则继续循环
        const hasPriorToolCalls = allToolCalls.length > 0;
        const hasCompletionSignal = COMPLETION_SIGNALS.some(sig => (roundContent || '').includes(sig));

        if (!hasPriorToolCalls || hasCompletionSignal || consecutiveNoToolRounds >= MAX_CONSECUTIVE_NO_TOOL_ROUNDS) {
          logger.info(
            `[AgentLoop] 第${round + 1}轮无工具调用，完成` +
            (hasCompletionSignal ? '（检测到完成信号）' : '') +
            (consecutiveNoToolRounds >= MAX_CONSECUTIVE_NO_TOOL_ROUNDS ? `（连续${consecutiveNoToolRounds}轮无进展，强制结束）` : '')
          );
          if (roundContent) {
            // R16-3: 防御相邻 assistant——若末尾已是纯文本 assistant 则合并内容，避免 provider 400
            messages = appendAssistantMessage(messages, roundContent);
            llmPayload.messages = messages;
            llmPayload._debug.context_messages_count = messages.length;
            llmPayload.cached_at = new Date().toISOString();
            this.save_llm_payload(user_id, expert_id, llmPayload);
          }
          break;
        }

        // 无完成信号的过渡文本 → 保留为 assistant 消息，继续下一轮让 LLM 推进任务
        consecutiveNoToolRounds += 1;
        logger.info(`[AgentLoop] 第${round + 1}轮无工具调用但无完成信号（已有工具调用），视为过渡文本继续循环 (${consecutiveNoToolRounds}/${MAX_CONSECUTIVE_NO_TOOL_ROUNDS})`);
        if (roundContent) {
          // R16-3: 同上，合并相邻 assistant
          messages = appendAssistantMessage(messages, roundContent);
          llmPayload.messages = messages;
          llmPayload._debug.context_messages_count = messages.length;
          llmPayload.cached_at = new Date().toISOString();
          this.save_llm_payload(user_id, expert_id, llmPayload);
        }
        continue;
      }

      // 有工具调用 → 重置连续无工具计数
      consecutiveNoToolRounds = 0;

      logger.info(`[AgentLoop] 第${round + 1}轮开始执行工具调用:`, collectedToolCalls.length);
      assertNotStopped();

      // 执行工具
      const toolResults = await this.execute_tools(expertService, {
        collectedToolCalls,
        user_id,
        taskContext,
        topic_id,
        task_id,
        session,
        expert_id,
        request_id,
        agent_invocation_context,
        onDelta
      });

      // round02: 文档检索原子结果 → 聚合证据注入（流式与非流式共用入口）
      // _consumeDocRetrievalResult 统一聚合 → 证据注入 → 链路形态日志
      const consumption = expertService._consumeDocRetrievalResult(toolResults, {
        caller: 'AgentLoop.run',
        extra: { round: round + 1 },
      });

      if (consumption.found && consumption.evidenceInjection) {
        // 将聚合证据与使用规则注入到消息历史头部，下一轮 LLM 将看到
        messages.unshift({
          role: 'system',
          content: consumption.evidenceInjection,
        });
        logger.info('[AgentLoop] 已注入文档检索证据（流式路径）:', {
          atomic_tools: consumption.docRetrievalResults.map(r => r.tool_name || r.toolName || 'unknown'),
          chain_pattern: consumption.chainHealth?.pattern,
          result_count: consumption.docRetrievalResults.length,
          round: round + 1,
        });
      }

      // 合并工具调用和执行结果
      const toolCallsWithResults = collectedToolCalls.map((call, index) => {
        const result = toolResults[index];
        return {
          ...call,
          result: result ? { success: result.success, data: result.data, error: result.error } : null,
          duration: result?.duration || 0,
          tool_message_id: result?.toolMessageId || null,
          // round03：透传原子执行轨迹供前端展示（仅 document_retrieval 原子 tool 有）
          ...(result?.atomic_steps ? { atomic_steps: result.atomic_steps } : {}),
          timestamp: new Date().toISOString(),
        };
      });
      allToolCalls.push(...toolCallsWithResults);

      // 更新消息历史
      messages = [
        ...messages,
        { role: 'assistant', content: roundContent || null, tool_calls: collectedToolCalls },
        ...expertService.toolManager.formatToolResultsForLLM(toolResults),
      ];

      // 注入合成 user 消息（多模态图片识别）
      LLMClient.injectImageUserMessages(messages, modelConfig, toolResults);

      // 同步更新 LLM Payload 缓存
      llmPayload.messages = messages;
      llmPayload._debug.context_messages_count = messages.length;
      llmPayload.cached_at = new Date().toISOString();
      this.save_llm_payload(user_id, expert_id, llmPayload);

      // 检测工具调用轮数阈值，推送 SSE 事件通知用户
      const currentRound = round + 1;
      const isLastRound = currentRound >= MAX_TOOL_ROUNDS;
      const threshold = currentRound / MAX_TOOL_ROUNDS;

      if (isLastRound) {
        // 达到 100% 上限：生成总结并通知用户
        const summary = this.generate_tool_call_summary(allToolCalls);
        onDelta?.({
          type: 'tool_limit_reached',
          totalRounds: MAX_TOOL_ROUNDS,
          executedRounds: currentRound,
          summary,
          message: `已达到最大工具调用次数（${currentRound}轮），AI 正在生成总结`
        });
        logger.info(`[AgentLoop] 工具调用达上限，生成总结: ${summary.substring(0, 100)}...`);
      } else if (threshold >= 0.8) {
        // 达到 80% 阈值：发送警告提示
        onDelta?.({
          type: 'tool_limit_warning',
          currentRound,
          maxRounds: MAX_TOOL_ROUNDS,
          remainingRounds: MAX_TOOL_ROUNDS - currentRound,
          message: `已调用 ${currentRound}/${MAX_TOOL_ROUNDS} 轮（${Math.round(threshold * 100)}%），即将达到上限`
        });
        logger.info(`[AgentLoop] 工具调用警告: ${currentRound}/${MAX_TOOL_ROUNDS} 轮`);
      }
    }

    // issue #1266：终稿正文 = **最后一轮自己的**正文，不是跨轮累积串。
    // 末轮没有正文（例如末轮只调工具就撞上轮数上限）时**不**回退到累积串——那正是本条缺陷：
    // 前几轮的正文各自有自己的行，塞进末轮行就是重复。此时保持空串，让末轮行维持
    // canonical 的取值（chat-service 侧对空正文也不覆盖列，见 `saveAssistantMessageAndCompleteRequest`）。
    let finalContent = lastRoundContent;
    // 整轮都没吐过任何文字（单轮空回复）才用占位文案，与既有语义一致
    if ((!finalContent || finalContent.trim() === '') && (!fullContent || fullContent.trim() === '')) {
      logger.warn('[AgentLoop] LLM 未返回内容，生成默认回复');
      finalContent = '我已处理您的请求，但没有生成具体的回复内容。';
    }

    // P0 观测：记录本轮 LLM 调用次数
    logger.info(`[AgentLoop] 本轮 LLM 调用次数: ${llmCallsCount}, 专家: ${expert_id}, 策略: ${expertService.expertConfig?.expert?.context_strategy || 'full'}`);

    return { fullContent: finalContent, fullReasoningContent, tokenUsage, allToolCalls, finalMessages: messages, llmCallsCount };
  }

  async runErix(expertService, {
    modelConfig,
    thinkingConfig,
    tools = [],
    currentMessages = [],
    llmPayload = {},
    user_id,
    expert_id,
    taskContext,
    topic_id,
    task_id,
    session,
    request_id,
    onDelta,
    shouldStop,
    runtimeState = null,
    agent_invocation_context = null,
  }) {
    const {
      buildErixRunOptions,
      createErixStore,
      TOUWAKA_COMPLETION_SIGNALS,
    } = await import('../llm-kit-adapters/loop-bridge.js');
    // issue #1166：与 run() 共用同一个 helper（勿在此重写 `||` + 夹取，两份逻辑必然漂移）。
    // 无系统设置服务时仍用系统默认值 20 兜底（与改造前的内联字面量一致，改成从
    // DEFAULT_SETTINGS 取，避免又一处魔法数）。
    const maxRounds = await resolveEffectiveMaxToolRounds({
      configured: expertService.expertConfig?.expert?.max_tool_rounds,
      resolveSystemDefault: typeof this.db?.getModel === 'function'
        ? () => getSystemSettingService(this.db).getMaxToolRounds()
        : undefined,
      systemDefaultFallback: DEFAULT_SETTINGS.tool.max_rounds.value,
      expert_id,
      request_id,
      source: 'agent-loop.runErix',
    });
    const maxRecoveryAttempts = resolvePositiveIntegerEnv(
      'CHAT_STREAM_RECOVERY_MAX_ATTEMPTS',
      DEFAULT_STREAM_RECOVERY_MAX_ATTEMPTS,
    );
    const recoveryBaseDelayMs = resolvePositiveIntegerEnv(
      'CHAT_STREAM_RECOVERY_BASE_DELAY_MS',
      DEFAULT_STREAM_RECOVERY_BASE_DELAY_MS,
    );
    const recoveryMaxDelayMs = resolvePositiveIntegerEnv(
      'CHAT_STREAM_RECOVERY_MAX_DELAY_MS',
      DEFAULT_STREAM_RECOVERY_MAX_DELAY_MS,
    );
    const compactBudgetTokens = Math.max(
      1,
      resolvePositiveIntegerEnv('CHAT_COMPACT_BUDGET_TOKENS', 80000),
    );
    const compactKeepRounds = Math.max(
      0,
      resolvePositiveIntegerEnv('CHAT_COMPACT_KEEP_ROUNDS', 6),
    );
    const maxNoToolRounds = MAX_CONSECUTIVE_NO_TOOL_ROUNDS + 1;
    const llmParams = expertService.llmClient.getExpertLLMParams();
    const abortController = new AbortController();

    llmPayload.model = modelConfig.model_name;
    llmPayload.temperature = llmParams.temperature;
    llmPayload.top_p = llmParams.top_p;
    llmPayload.frequency_penalty = llmParams.frequency_penalty;
    llmPayload.presence_penalty = llmParams.presence_penalty;
    llmPayload.max_tokens = modelConfig.max_output_tokens || 32768;
    llmPayload._debug ??= {};
    if (tools.length > 0) llmPayload.tools = tools;

    const assertNotStopped = () => {
      if (!shouldStop?.()) return;
      const error = new Error('Request aborted by user');
      if (!abortController.signal.aborted) abortController.abort(error);
      throw error;
    };

    const parseToolInput = (value) => {
      if (value !== null && typeof value === 'object') return value;
      try {
        return JSON.parse(value === undefined ? '{}' : String(value));
      } catch {
        return {
          _truncatedArguments: value,
          _raw: value,
        };
      }
    };

    const canonicalContentBlock = (block) => {
      if (!block || typeof block !== 'object') {
        return { type: 'raw', protocol: 'openai', payload: block };
      }
      if (block.type === 'text') {
        return { type: 'text', text: String(block.text ?? '') };
      }
      if (block.type === 'reasoning' || block.type === 'thinking') {
        return { type: 'reasoning', text: String(block.text ?? block.thinking ?? '') };
      }
      if (block.type === 'image') return { ...block };
      if (block.type === 'image_url') {
        const imageUrl = block.image_url && typeof block.image_url === 'object'
          ? block.image_url
          : {};
        return {
          type: 'image',
          ...(imageUrl.url === undefined ? {} : { url: imageUrl.url }),
          ...(imageUrl.detail === undefined ? {} : { detail: imageUrl.detail }),
        };
      }
      if (block.type === 'tool_use' || block.type === 'tool_result') {
        return { ...block };
      }
      return { type: 'raw', protocol: 'openai', payload: block };
    };

    const canonicalMessage = (message) => {
      if (message?.role === 'tool') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: message.tool_call_id,
            content: typeof message.content === 'string'
              ? message.content
              : JSON.stringify(message.content ?? ''),
            ...(message.is_error === undefined ? {} : { is_error: Boolean(message.is_error) }),
          }],
        };
      }

      if (message?.content && Array.isArray(message.content)
        && message.content.some(block => (
          block?.type === 'tool_use'
          || block?.type === 'tool_result'
          || block?.type === 'image'
        ))) {
        return {
          ...message,
          content: message.content.map(canonicalContentBlock),
        };
      }

      const content = Array.isArray(message?.content)
        ? message.content.map(canonicalContentBlock)
        : message?.content;
      const blocks = Array.isArray(content)
        ? [...content]
        : content === undefined || content === null
          ? []
          : [{ type: 'text', text: String(content) }];

      if (message?.role === 'assistant') {
        for (const toolCall of message.tool_calls ?? []) {
          blocks.push({
            type: 'tool_use',
            id: toolCall?.id,
            name: toolCall?.function?.name ?? toolCall?.name,
            input: parseToolInput(toolCall?.function?.arguments ?? toolCall?.arguments),
          });
        }
        if (typeof message.reasoning_content === 'string') {
          blocks.push({ type: 'reasoning', text: message.reasoning_content });
        }
      }

      return {
        role: message?.role,
        content: Array.isArray(message?.content) || message?.content === null
          || message?.content === undefined
          || message?.role === 'assistant' && (message.tool_calls?.length || message.reasoning_content)
          ? blocks
          : content,
        ...(message?._synthetic ? { _synthetic: true } : {}),
      };
    };

    const canonicalizeMessages = (messages) => {
      const result = [];
      for (const message of messages) {
        const converted = canonicalMessage(message);
        const previous = result.at(-1);
        const convertedToolResults = converted.role === 'user'
          && Array.isArray(converted.content)
          && converted.content.length > 0
          && converted.content.every(block => block?.type === 'tool_result');
        const previousToolResults = previous?.role === 'user'
          && Array.isArray(previous.content)
          && previous.content.length > 0
          && previous.content.every(block => block?.type === 'tool_result');
        if (convertedToolResults && previousToolResults) {
          previous.content.push(...converted.content);
        } else {
          result.push(converted);
        }
      }
      return result;
    };

    const canonicalMessages = canonicalizeMessages(currentMessages);
    let hadToolCalls = canonicalMessages.some(message => (
      Array.isArray(message.content)
      && message.content.some(block => block?.type === 'tool_use')
    ));

    const canonicalTools = tools
      .map(tool => {
        const functionTool = tool?.function;
        return {
          name: functionTool?.name ?? tool?.name,
          ...(functionTool?.description ?? tool?.description
            ? { description: functionTool?.description ?? tool?.description }
            : {}),
          inputSchema: functionTool?.parameters ?? tool?.inputSchema ?? {},
        };
      })
      .filter(tool => tool.name);

    const toOpenAIToolCall = ({ id, name, input }) => ({
      id,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(input ?? {}),
      },
    });

    const toLegacyToolResult = (result, executionOptions) => ({
      ...(result && typeof result === 'object' ? result : {}),
      toolCallId: result?.toolCallId ?? executionOptions.id,
      toolName: result?.toolName ?? executionOptions.name,
      duration: result?.duration ?? 0,
    });

    const formatToolResultForLLM = (result) => {
      const formatted = expertService.toolManager?.formatToolResultsForLLM?.([result]);
      const first = Array.isArray(formatted) ? formatted[0] : formatted;
      const content = first?.content ?? first;
      if (typeof content === 'string') return content;
      const serialized = JSON.stringify(content ?? result.data);
      return serialized === undefined ? String(content ?? result.data) : serialized;
    };

    const pendingToolResults = [];
    const allToolCalls = [];
    const toolRounds = new Set();
    // issue #1266：两个槽位，语义不同（别合）：
    //   · `fullContent`  = **跨轮累积串**（`onDelta` 里无分隔 `+=`），只给流式恢复事件回填用；
    //   · `roundContent` = **当前轮自己的**正文（`round_start` 时清零），终稿正文取它。
    // 历史缺陷：把 `fullContent` 当终稿交给 chat-service 写末轮行 ⇒ 前几轮可见文本
    // 在末轮行里又出现一遍（490 = 13 + 477，UI 同一句两次）。
    let fullContent = '';
    let roundContent = '';
    let fullReasoningContent = '';
    let tokenUsage = null;
    let sawUsage = false;
    let currentRound = 0;
    let consecutiveNoToolRounds = 0;
    let latestCanonicalMessages = canonicalMessages;
    let preparedToolRound = null;
    let preparedToolResults = [];
    let preparedRequestMessages = null;
    let preparedRequestRound = null;

    const savePayload = (messages, compaction = null) => {
      const openAIMessages = canonicalToOpenAIMessages(undefined, messages);
      llmPayload.messages = openAIMessages;
      llmPayload._debug.context_messages_count = openAIMessages.length;
      if (compaction) {
        llmPayload._debug.compacted_rounds = compaction.foldedRounds;
        llmPayload._debug.tokens_before_compact = compaction.tokensBefore;
        llmPayload._debug.tokens_after_compact = compaction.tokensAfter;
      }
      llmPayload.cached_at = new Date().toISOString();
      this.save_llm_payload(user_id, expert_id, llmPayload);
    };

    const executeSingleTool = async (executionOptions) => {
      assertNotStopped();
      const toolCall = toOpenAIToolCall(executionOptions);
      const toolRound = executionOptions.context?.round ?? currentRound;
      logger.info(
        `[AgentLoop] 第${toolRound}轮收到工具调用:`,
        getToolCallDisplayNames([toolCall], expertService.toolManager),
      );
      onDelta?.({
        type: 'tool_call',
        toolCalls: presentToolCalls([toolCall], expertService.toolManager),
      });

      const startedAt = Date.now();
      let callbackResult = null;
      let usedInjectedExecutor = false;
      let executionFailed = false;
      let result;
      try {
        if (typeof this.execute_tools === 'function') {
          usedInjectedExecutor = true;
          const collectedToolCall = {
            ...executionOptions,
            id: executionOptions.id,
            type: 'function',
            function: {
              name: executionOptions.name,
              arguments: JSON.stringify(executionOptions.input ?? {}),
            },
            name: executionOptions.name,
            arguments: JSON.stringify(executionOptions.input ?? {}),
          };
          const toolResults = await this.execute_tools(expertService, {
            collectedToolCalls: [collectedToolCall],
            user_id,
            taskContext,
            topic_id,
            task_id,
            session,
            expert_id,
            request_id,
            agent_invocation_context,
            onDelta,
            // issue #1134 D3-i：erix 路径停写 role=tool 行（正身唯一存
            // chat_tool_calls.result_json，由 transcript-store 拆行落库），
            // 消息列表经 message.controller 聚合 chat_tool_calls 还原等价行
            skipToolMessageRow: true,
          });
          const firstResult = Array.isArray(toolResults) ? toolResults[0] : toolResults;
          result = firstResult;
        } else {
          logger.warn('[AgentLoop] execute_tools 未提供，回退 expertService.handleToolCalls');
          const results = await expertService.handleToolCalls(
            [toolCall],
            user_id,
            session?.accessToken,
            taskContext,
            topic_id,
            async toolResult => {
              callbackResult = toolResult;
              if (executionOptions.context) toolResult.context = executionOptions.context;
            },
            session,
            agent_invocation_context,
          );
          result = results?.[0] ?? callbackResult;
        }
      } catch (error) {
        executionFailed = true;
        if (executionOptions.signal?.aborted || abortController.signal.aborted) throw error;
        result = {
          success: false,
          data: error?.message ?? String(error),
          error: error?.message ?? String(error),
        };
      }

      const toolResult = toLegacyToolResult(result, executionOptions);
      if (toolResult.duration === 0) toolResult.duration = Date.now() - startedAt;
      logger.info(`[AgentLoop] 工具执行完成: ${toolResult.toolName}, 成功: ${toolResult.success}`);
      hadToolCalls = true;
      consecutiveNoToolRounds = 0;
      pendingToolResults.push(toolResult);
      toolRounds.add(toolRound);
      allToolCalls.push({
        ...toolCall,
        result: {
          success: toolResult.success,
          data: toolResult.data,
          error: toolResult.error,
        },
        duration: toolResult.duration || 0,
        tool_message_id: toolResult.toolMessageId || null,
        ...(toolResult.atomic_steps ? { atomic_steps: toolResult.atomic_steps } : {}),
        timestamp: new Date().toISOString(),
      });
      if (!usedInjectedExecutor || executionFailed) {
        onDelta?.({ type: 'tool_result', result: toolResult });
      }

      return {
        ...toolResult,
        data: formatToolResultForLLM(toolResult),
      };
    };

    const openAIMessageToCanonical = (message) => {
      if (message?.role === 'tool') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: message.tool_call_id,
            content: String(message.content ?? ''),
          }],
        };
      }
      return canonicalMessage(message);
    };

    const prepareProviderRequest = async request => {
      assertNotStopped();

      if (preparedRequestMessages === request.messages && preparedRequestRound === currentRound) {
        latestCanonicalMessages = request.messages;
        return;
      }

      if (currentRound > 1) {
        const shadowMessages = request.messages.flatMap(message => (
          canonicalToOpenAIMessages(undefined, [message]).map(converted => (
            message?._synthetic ? { ...converted, _synthetic: true } : converted
          ))
        ));
        const strippedMessages = LLMClient.stripHistoricalImages(shadowMessages);
        const strippedCanonicalMessages = canonicalizeMessages(strippedMessages);
        request.messages.splice(
          0,
          request.messages.length,
          ...strippedCanonicalMessages,
        );
      }

      if (preparedToolRound !== currentRound) {
        preparedToolRound = currentRound;
        preparedToolResults = pendingToolResults.splice(0, pendingToolResults.length);
      }
      const roundToolResults = preparedToolResults;
      if (roundToolResults.length === 0) {
        latestCanonicalMessages = request.messages;
        preparedRequestMessages = request.messages;
        preparedRequestRound = currentRound;
        return;
      }

      const consumption = typeof expertService._consumeDocRetrievalResult === 'function'
        ? await expertService._consumeDocRetrievalResult(roundToolResults, {
          caller: 'AgentLoop.runErix',
          extra: { round: currentRound },
        })
        : null;
      if (consumption?.found && consumption.evidenceInjection) {
        request.messages.unshift({
          role: 'system',
          content: consumption.evidenceInjection,
        });
      }

      const shadowMessages = canonicalToOpenAIMessages(undefined, request.messages);
      const shadowLength = shadowMessages.length;
      LLMClient.injectImageUserMessages(shadowMessages, modelConfig, roundToolResults);
      for (const message of shadowMessages.slice(shadowLength)) {
        request.messages.push(openAIMessageToCanonical(message));
      }
      latestCanonicalMessages = request.messages;
      preparedRequestMessages = request.messages;
      preparedRequestRound = currentRound;
    };

    const thinkingFields = {
      thinking: thinkingConfig?.thinking,
      reasoning: thinkingConfig?.reasoning,
      reasoning_effort: thinkingConfig?.reasoning_effort,
      enable_thinking: thinkingConfig?.enable_thinking,
      chat_template_kwargs: thinkingConfig?.chat_template_kwargs,
    };
    const baseProvider = createTouwakaProvider({
      llmClient: expertService.llmClient,
      resolveModel: async () => modelConfig,
      defaultUserId: user_id,
      defaultRequestId: request_id,
    });
    const judgeProvider = createTouwakaProvider({
      llmClient: expertService.llmClient,
      resolveModel: (() => {
        let reflectiveModelPromise;
        return async () => {
          if (!reflectiveModelPromise) {
            reflectiveModelPromise = (async () => {
              if (typeof expertService.llmClient?.getModelForMind !== 'function') {
                return modelConfig;
              }
              try {
                return await expertService.llmClient.getModelForMind('reflective');
              } catch (error) {
                logger.warn('[AgentLoop] 反思模型配置不可用，judge 回退主模型:', {
                  error: error instanceof Error ? error.message : String(error),
                });
                return modelConfig;
              }
            })();
          }
          return reflectiveModelPromise;
        };
      })(),
      defaultUserId: user_id,
      defaultRequestId: request_id,
    });

    const invokeProvider = async (method, request) => {
      await prepareProviderRequest(request);
      const enrichedRequest = { ...request, ...thinkingFields };
      if (runtimeState) runtimeState.has_active_transport = true;
      try {
        return await baseProvider[method](enrichedRequest);
      } catch (error) {
        if (
          error
          && typeof error === 'object'
          && error.message !== 'Request aborted by user'
          && isRetryableError(error)
        ) {
          error.retryable = true;
        }
        throw error;
      } finally {
        if (runtimeState) runtimeState.has_active_transport = false;
      }
    };

    const provider = {
      chatStream: request => invokeProvider('chatStream', request),
    };
    if (typeof baseProvider.chat === 'function') {
      provider.chat = request => invokeProvider('chat', request);
    }

    const handleKnownErixEvent = (event) => {
      if (event.type === 'round_start') {
        currentRound = event.round;
        // issue #1266：新一轮 = 新一段正文（终稿只认最后一轮这一段）
        roundContent = '';
        logger.info(`[AgentLoop] 第${event.round}轮调用 LLM...`, {
          message_count: latestCanonicalMessages.length,
        });
        if (runtimeState) {
          runtimeState.round = event.round;
          runtimeState.round_snapshot_ref = {
            round: event.round,
            taken_at: new Date().toISOString(),
          };
        }
      } else if (event.type === 'attempt') {
        if (runtimeState) runtimeState.has_active_transport = true;
      } else if (event.type === 'recovering') {
        const attempt = Math.max(1, Number(event.attempt ?? 1) - 1);
        if (runtimeState) {
          runtimeState.has_active_transport = false;
          runtimeState.recovery_attempt = attempt;
        }
        onDelta?.({
          type: 'recovering',
          request_id,
          round: event.round,
          attempt,
          max_attempts: maxRecoveryAttempts,
          content: fullContent,
          reasoning_content: fullReasoningContent,
        });
      } else if (event.type === 'recovered') {
        const attempt = Math.max(1, Number(event.attempt ?? 1) - 1);
        onDelta?.({
          type: 'recovered',
          request_id,
          round: event.round,
          attempt,
        });
      } else if (event.type === 'usage') {
        const usage = event.usage;
        const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens;
        const completionTokens = usage?.completion_tokens ?? usage?.output_tokens;
        logger.info(`[AgentLoop] 第${event.round}轮 token 使用:`, {
          prompt: promptTokens,
          completion: completionTokens,
          total: usage?.total_tokens ?? (
            Number(promptTokens ?? 0) + Number(completionTokens ?? 0)
          ),
        });
      } else if (event.type === 'round_end') {
        if (runtimeState) runtimeState.has_active_transport = false;
        savePayload(latestCanonicalMessages);
        if (!toolRounds.has(event.round)) {
          const hasCompletionSignal = TOUWAKA_COMPLETION_SIGNALS.some(signal => (
            typeof signal === 'string' && (event.finalText || '').includes(signal)
          ));
          if (!hadToolCalls || hasCompletionSignal || consecutiveNoToolRounds >= MAX_CONSECUTIVE_NO_TOOL_ROUNDS) {
            logger.info(
              `[AgentLoop] 第${event.round}轮无工具调用，完成` +
              (hasCompletionSignal ? '（检测到完成信号）' : '') +
              (!hadToolCalls ? '（从未调用工具）' : '') +
              (consecutiveNoToolRounds >= MAX_CONSECUTIVE_NO_TOOL_ROUNDS
                ? `（连续${consecutiveNoToolRounds}轮无进展，强制结束）`
                : ''),
            );
          } else {
            consecutiveNoToolRounds += 1;
            logger.info(
              `[AgentLoop] 第${event.round}轮无工具调用但无完成信号（已有工具调用），视为过渡文本继续循环 ` +
              `(${consecutiveNoToolRounds}/${MAX_CONSECUTIVE_NO_TOOL_ROUNDS})`,
            );
          }
        }
        if (toolRounds.has(event.round)) {
          const executedRounds = event.round;
          const threshold = executedRounds / maxRounds;
          if (executedRounds >= maxRounds) {
            const summary = this.generate_tool_call_summary(allToolCalls);
            onDelta?.({
              type: 'tool_limit_reached',
              totalRounds: maxRounds,
              executedRounds,
              summary,
              message: `已达到最大工具调用次数（${executedRounds}轮），AI 正在生成总结`,
            });
            logger.info(`[AgentLoop] 工具调用达上限，生成总结: ${summary.substring(0, 100)}...`);
          } else if (threshold >= 0.8) {
            onDelta?.({
              type: 'tool_limit_warning',
              currentRound: executedRounds,
              maxRounds,
              remainingRounds: maxRounds - executedRounds,
              message: `已调用 ${executedRounds}/${maxRounds} 轮（${Math.round(threshold * 100)}%），即将达到上限`,
            });
            logger.info(`[AgentLoop] 工具调用警告: ${executedRounds}/${maxRounds} 轮`);
          }
        }
      }
    };
    const onErixEvent = createErixEventHandler({
      request_id,
      logger,
      onKnownEvent: handleKnownErixEvent,
    });

    // issue #1227 阶段 1：erix 0.29 的 `config` 只装数据、行为载体进 `capabilities`，
    // 所以原来那个混装壳 `context` 必须一拆二：
    //   · 数据成员（budgetTokens / keepRounds / stripHistoricalImages / strategy）→ config.folding.context
    //   · 行为成员 onAfterFold → capabilities.hooks.onAfterFold
    //     （0.29 里它被写回 effectiveOptions.context.onAfterFold，引擎读侧不变）
    //
    // issue #1277：`strategy` 是**语义折叠的总开关**。不给它时引擎走库层兜底
    // `createSlidingWindowStrategy()`（零 LLM 的机械折叠）并发一条 `compaction_strategy_fallback`
    // —— 那正是本单之前的状态：项目只给预算、从没吃到语义折叠。三档都是引擎内置名，
    // 默认 `fold-llm`（用户裁决 B）：摘要器坏 ⇒ 本次 run 以 `failed` /
    // `errorCode=summarizer_failed` 收尾，是**用户可见的硬失败**，这是有意的取舍
    // （0.30 之前引擎会静默降级成统计摘要，质量掉了没人发现）。一键回退口是环境变量
    // `ERIX_FOLDING_STRATEGY`（设 `fold-statistical` / `sliding-window`），**不需要发版**。
    // 非法值在 `buildFoldingContext` 里当场抛（点名值 + 合法清单 + 环境变量名），
    // 不静默退回默认档，也不等引擎启动期那个不含我们配置名的 `TypeError`。
    const foldContext = buildFoldingContext({
      budgetTokens: compactBudgetTokens,
      keepRounds: compactKeepRounds,
      stripHistoricalImages: true,
    });
    const onAfterFold = ({
      messages,
      foldedRounds,
      tokensBefore,
      tokensAfter,
    }) => {
      if (!foldedRounds) return;
      latestCanonicalMessages = messages;
      logger.warn(
        `[AgentLoop] 上下文超预算，已压缩历史: ` +
        `折叠 ${foldedRounds} 轮, tokens ${tokensBefore} -> ${tokensAfter} ` +
        `(round=${currentRound}, 消息数=${messages.length})`,
      );
      onDelta?.({
        type: 'history_compacted',
        foldedRounds,
        tokensBefore,
        tokensAfter,
        round: currentRound,
        content: `已自动压缩早期工具执行记录（${foldedRounds} 轮），以控制上下文长度。`,
      });
      savePayload(latestCanonicalMessages, {
        foldedRounds,
        tokensBefore,
        tokensAfter,
      });
    };

    assertNotStopped();
    const persistenceErrorHandlers = createErixPersistenceErrorHandlers({
      request_id,
      logger,
    });
    const erixRunOptions = buildErixRunOptions({
      provider,
      executeTool: executeSingleTool,
      store: this.db?.sequelize && typeof this.db.sequelize.define === 'function'
        ? createDedupConflictTolerantStore(createErixStore({
          db: this.db,
          // issue #1134：拆行 messages 需要归属上下文（messages.user_id NOT NULL），
          // erix persist() 只传 (runId, record)，经 createErixStore 注入 store
          requestContext: { request_id, topic_id, user_id, expert_id },
        }), { request_id, logger })
        : undefined,
      signals: TOUWAKA_COMPLETION_SIGNALS,
      modelConfig,
      // issue #1227 阶段 1：0.29 的顶层白名单只剩 26 项，下面这些键的规范之家全部在
      // config.* / capabilities.*（扁平写法会被名称闸口当场拒并点名新家）。
      config: {
        input: {
          // 0.29 的唯一注册别名：config.input.messages ⇄ 扁平 initialMessages
          messages: canonicalMessages,
          // erix 0.3.3+：关闭 WRAPUP_INSTRUCTION 注入，touwaka 是对话宿主（erix-agent #32）
          wrapup: false,
        },
        run: {
          runId: request_id,
          maxRounds,
          stallDetection: false,
          completion: { maxNoToolRounds },
          // erix 只在未显式传 reflection 时读取该 env；宿主显式传入时需自行对齐运维开关
          reflection: {
            enabled: maxRounds >= 16 && process.env.ERIX_NO_REFLECTION?.trim() !== '1',
            roundJudge: true,
          },
          stream: true,
        },
        tuning: {
          maxTokens: llmPayload.max_tokens,
          temperature: llmPayload.temperature,
          topP: llmPayload.top_p,
        },
        timing: {
          retry: {
            attempts: maxRecoveryAttempts,
            backoffBaseMs: recoveryBaseDelayMs,
            backoffMaxMs: recoveryMaxDelayMs,
          },
        },
        folding: { context: foldContext },
        metadata: {
          toolContext: {
            user_id,
            expert_id,
            taskContext,
            topic_id,
            task_id,
            session,
            request_id,
            agent_invocation_context,
          },
        },
      },
      capabilities: {
        hooks: { onAfterFold },
        // 0.29：reflection.judge.provider 是能力槽位（config 只装数据，函数值 intake 即拒）
        ports: { judgeProvider },
      },
      tools: canonicalTools,
      signal: abortController.signal,
      onDelta: delta => {
        // issue #1266：累积串只给 recovering 事件用；终稿取 `roundContent`（按轮清零）
        fullContent += delta;
        roundContent += delta;
        onDelta?.({ type: 'delta', content: delta });
      },
      onReasoningDelta: reasoningDelta => {
        fullReasoningContent += reasoningDelta;
        onDelta?.({ type: 'reasoning_delta', content: reasoningDelta });
      },
      onToolCall: () => {},
      onUsage: usage => {
        if (!usage) return;
        sawUsage = true;
        tokenUsage = addTokenUsage(tokenUsage, {
          prompt_tokens: usage.prompt_tokens ?? usage.input_tokens,
          completion_tokens: usage.completion_tokens ?? usage.output_tokens,
          total_tokens: usage.total_tokens
            ?? (Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)
              + Number(usage.completion_tokens ?? usage.output_tokens ?? 0)),
        });
      },
      // erix-agent 0.3.5：观察者异常不再中断循环，改由宿主记录而非 erix 内部 console.error
      onObserverError: error => {
        logger.warn('[AgentLoop] erix 观察者回调异常', {
          error: error instanceof Error ? error.message : String(error),
        });
      },
      diagnostics: persistenceErrorHandlers.diagnostics,
      onPersistenceError: persistenceErrorHandlers.onPersistenceError,
      onEvent: onErixEvent,
    });
    const loopResult = await runToolLoop(erixRunOptions);

    latestCanonicalMessages = loopResult.messages;
    const finalMessages = canonicalToOpenAIMessages(undefined, latestCanonicalMessages);
    // issue #1266：终稿正文 = **最后一轮自己的**正文（`roundContent` 在 `round_start` 清零、
    // 只累本轮 delta）。兜底 `loopResult.finalText` 也是「最后一轮那段」（引擎每轮覆写，
    // 见 erix-agent `orchestrator.js#finalText = textFromBlocks(content)`），
    // **不再**用 `fullContent`（跨轮累积串）当终稿——那会把前几轮正文再写一遍进末轮行。
    let finalContent = roundContent;
    if (!finalContent && loopResult.finalText) finalContent = loopResult.finalText;
    if (!fullReasoningContent) {
      fullReasoningContent = latestCanonicalMessages
        .flatMap(message => Array.isArray(message.content) ? message.content : [])
        .filter(block => block?.type === 'reasoning')
        .map(block => block.text)
        .join('');
    }
    const loopUsage = loopResult?.usage;
    const hasLoopUsage = loopUsage && (
      Number(loopUsage.input_tokens) > 0 || Number(loopUsage.output_tokens) > 0
    );
    if (hasLoopUsage) {
      // loopResult.usage 是 erix 全量（主循环 + judge，trackLatest:false 已并入），权威来源
      tokenUsage = {
        prompt_tokens: Number(loopUsage.input_tokens) || 0,
        completion_tokens: Number(loopUsage.output_tokens) || 0,
        total_tokens: (Number(loopUsage.input_tokens) || 0) + (Number(loopUsage.output_tokens) || 0),
      };
    } else if (!tokenUsage && sawUsage) {
      // 保留原兜底（mock/usage 结构不匹配时）
      tokenUsage = {
        prompt_tokens: loopResult.usage?.input_tokens || 0,
        completion_tokens: loopResult.usage?.output_tokens || 0,
        total_tokens: (loopResult.usage?.input_tokens || 0) + (loopResult.usage?.output_tokens || 0),
      };
    }
    if (!fullContent || fullContent.trim() === '') {
      logger.warn('[AgentLoop] LLM 未返回内容，生成默认回复');
      finalContent = '我已处理您的请求，但没有生成具体的回复内容。';
    }

    logger.info(`[AgentLoop] 本轮 LLM 调用次数: ${loopResult.rounds}, 专家: ${expert_id}, 策略: ${expertService.expertConfig?.expert?.context_strategy || 'full'}`);

    return {
      fullContent: finalContent,
      fullReasoningContent,
      tokenUsage,
      allToolCalls,
      finalMessages,
      llmCallsCount: loopResult.rounds,
    };
  }
}

export default AgentLoop;
