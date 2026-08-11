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
import { getSystemSettingService } from '../../server/services/system-setting.service.js';

const DEFAULT_STREAM_RECOVERY_MAX_ATTEMPTS = 2;
const DEFAULT_STREAM_RECOVERY_BASE_DELAY_MS = 1500;
const DEFAULT_STREAM_RECOVERY_MAX_DELAY_MS = 10000;

// R15: 任务型 agent（如锚点清洗）的过渡文本判定参数
const MAX_CONSECUTIVE_NO_TOOL_ROUNDS = 3; // 连续无工具调用且无完成信号的最大轮数
// R16-3: 补充"阶段3完成"“最终报告”等实际结束语——锚点清洗 agent 收尾时输出
// "## 阶段3完成！"（外部引用定位回写完毕），此前不在信号内被误判为过渡文本，
// 连续两轮追加 assistant 消息导致消息列表末尾相邻 assistant，provider 400 报错。
const COMPLETION_SIGNALS = [
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
}

export default AgentLoop;
