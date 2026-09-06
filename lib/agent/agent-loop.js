/**
 * Agent loop.
 *
 * This module owns the streaming LLM/tool loop for an Agent run. Phase A moves
 * the existing root chat loop here without changing its behavior.
 */

import LLMClient from '../llm-client.js';
import logger from '../logger.js';
import { join } from 'node:path';
import { isRetryableError } from '../llm-retry.js';
import { getToolCallDisplayNames, presentToolCalls, toToolCallArray } from '../tool-call-presenter.js';
import { addTokenUsage } from '../token-usage-accumulator.js';
import { createRoundStateSnapshot, restoreRoundStateSnapshot } from '../chat/round-state-snapshot.js';
import { getSystemSettingService } from '../../server/services/system-setting.service.js';
import { compactHistory } from './history-compactor.js';
import { canonicalToOpenAIMessages, runToolLoop } from 'erix-agent';
import { createTouwakaProvider } from '../llm-kit-adapters/provider-adapter.js';

const DEFAULT_STREAM_RECOVERY_MAX_ATTEMPTS = 2;
const DEFAULT_STREAM_RECOVERY_BASE_DELAY_MS = 1500;
const DEFAULT_STREAM_RECOVERY_MAX_DELAY_MS = 10000;

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
    const MAX_TOOL_ROUNDS = expertService.expertConfig?.expert?.max_tool_rounds
      || await systemSettingService.getMaxToolRounds();
    const MAX_STREAM_RECOVERY_ATTEMPTS = resolvePositiveIntegerEnv('CHAT_STREAM_RECOVERY_MAX_ATTEMPTS', DEFAULT_STREAM_RECOVERY_MAX_ATTEMPTS);
    const STREAM_RECOVERY_BASE_DELAY_MS = resolvePositiveIntegerEnv('CHAT_STREAM_RECOVERY_BASE_DELAY_MS', DEFAULT_STREAM_RECOVERY_BASE_DELAY_MS);
    const STREAM_RECOVERY_MAX_DELAY_MS = resolvePositiveIntegerEnv('CHAT_STREAM_RECOVERY_MAX_DELAY_MS', DEFAULT_STREAM_RECOVERY_MAX_DELAY_MS);

    let fullContent = '';
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

    // 如果 LLM 没有返回任何内容，生成默认回复
    if (!fullContent || fullContent.trim() === '') {
      logger.warn('[AgentLoop] LLM 未返回内容，生成默认回复');
      fullContent = '我已处理您的请求，但没有生成具体的回复内容。';
    }

    // P0 观测：记录本轮 LLM 调用次数
    logger.info(`[AgentLoop] 本轮 LLM 调用次数: ${llmCallsCount}, 专家: ${expert_id}, 策略: ${expertService.expertConfig?.expert?.context_strategy || 'full'}`);

    return { fullContent, fullReasoningContent, tokenUsage, allToolCalls, finalMessages: messages, llmCallsCount };
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
    const configuredMaxRounds = expertService.expertConfig?.expert?.max_tool_rounds;
    const maxRounds = configuredMaxRounds || (
      typeof this.db?.getModel === 'function'
        ? await getSystemSettingService(this.db).getMaxToolRounds()
        : 20
    );
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
    // —— judge task 简报与三态开关（erix 0.3.4+，issue #34）——
    const taskDir = taskContext?.absolute_workspace_path || null;
    const hasTaskDir = Boolean(
      taskDir
      && taskContext?.workspace_mode
      && taskContext.workspace_mode !== 'chat',
    );
    let isGoalDefinitionPhase = false;
    let taskBrief = null;
    if (hasTaskDir) {
      try {
        const fs = await import('node:fs/promises');
        const readmePath = join(taskDir, 'README.md');
        const readmeText = await fs.readFile(readmePath, 'utf8').catch(() => null);
        const hasGoal = readmeText
          && /(目标|需求|Goal|goal|目的)[\s\S]{0,100}/.test(readmeText)
          && readmeText.length > 50;
        isGoalDefinitionPhase = Boolean(taskDir) && readmeText === null;
        const latestUserText = [...canonicalMessages].reverse()
          .find(message => message?.role === 'user')
          ?.content;
        const latestUser = typeof latestUserText === 'string'
          ? latestUserText.slice(0, 300)
          : (Array.isArray(latestUserText)
            ? latestUserText
              .map(block => block?.type === 'text' ? block.text : '')
              .join(' ')
              .slice(0, 300)
            : '');
        const goalSummary = hasGoal ? readmeText.slice(0, 600) : '';
        const taskBriefPrefix = isGoalDefinitionPhase
          ? `任务目录:${taskDir}\n（README 尚无目标）\n本 run 任务:向用户确认任务目标并写入 README.md（目标/需求/验收），未确认前不要开始实现。`
          : `任务目录:${taskDir}\n任务目标:${goalSummary || taskContext?.description || ''}\n最新指令:`;
        const taskBriefSuffix = isGoalDefinitionPhase ? '' : latestUser;
        const prefixBudget = Math.max(0, 1500 - taskBriefSuffix.length);
        taskBrief = `${taskBriefPrefix.slice(0, prefixBudget)}${taskBriefSuffix}`;
      } catch {
        taskBrief = `任务目录:${taskDir}\n任务目标:${taskContext?.description || ''}`.slice(0, 1500);
      }
    }
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
    let fullContent = '';
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

    const onErixEvent = (event) => {
      if (event.type === 'round_start') {
        currentRound = event.round;
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

    const context = {
      budgetTokens: compactBudgetTokens,
      keepRounds: compactKeepRounds,
      stripHistoricalImages: true,
      onAfterFold: ({
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
      },
    };

    assertNotStopped();
    const erixRunOptions = buildErixRunOptions({
      provider,
      executeTool: executeSingleTool,
      store: this.db?.sequelize && typeof this.db.sequelize.define === 'function'
        ? createErixStore({ db: this.db })
        : undefined,
      runId: request_id,
      maxRounds,
      signals: TOUWAKA_COMPLETION_SIGNALS,
      modelConfig,
      context,
      stallDetection: false,
      retry: {
        attempts: maxRecoveryAttempts,
        backoffBaseMs: recoveryBaseDelayMs,
        backoffMaxMs: recoveryMaxDelayMs,
      },
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
      requestMeta: {
        user_id,
        expert_id,
        request_id,
      },
      initialMessages: canonicalMessages,
      tools: canonicalTools,
      maxTokens: llmPayload.max_tokens,
      temperature: llmPayload.temperature,
      topP: llmPayload.top_p,
      task: taskBrief ?? undefined,
      wrapup: false, // erix 0.3.3+：关闭 WRAPUP_INSTRUCTION 注入，touwaka 是对话宿主（erix-agent #32）
      // erix 只在未显式传 reflection 时读取该 env；宿主显式传入时需自行对齐运维开关
      reflection: hasTaskDir ? {
        enabled: maxRounds >= 16 && process.env.ERIX_NO_REFLECTION?.trim() !== '1',
        roundJudge: !isGoalDefinitionPhase,
        judge: { provider: judgeProvider },
      } : false,
      stream: true,
      signal: abortController.signal,
      onDelta: delta => {
        fullContent += delta;
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
      onEvent: onErixEvent,
    });
    erixRunOptions.completion.maxNoToolRounds = maxNoToolRounds;
    const loopResult = await runToolLoop(erixRunOptions);

    latestCanonicalMessages = loopResult.messages;
    const finalMessages = canonicalToOpenAIMessages(undefined, latestCanonicalMessages);
    if (!fullContent && loopResult.finalText) fullContent = loopResult.finalText;
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
      fullContent = '我已处理您的请求，但没有生成具体的回复内容。';
    }

    logger.info(`[AgentLoop] 本轮 LLM 调用次数: ${loopResult.rounds}, 专家: ${expert_id}, 策略: ${expertService.expertConfig?.expert?.context_strategy || 'full'}`);

    return {
      fullContent,
      fullReasoningContent,
      tokenUsage,
      allToolCalls,
      finalMessages,
      llmCallsCount: loopResult.rounds,
    };
  }
}

export default AgentLoop;
