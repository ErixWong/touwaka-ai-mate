/**
 * Conversation Orchestrator - 对话编排层（Phase 4 WP-1）
 *
 * 职责：流程编排，不包含 recall 规则判定和 topic 切换实现细节。
 * 委托给：ContextComposer / RecallStrategy / TopicLifecycleManager
 */

import logger from '../logger.js';
import { ContextComposer } from './context-composer.js';

export class ConversationOrchestrator {
  constructor(options = {}) {
    this.contextComposer = options.contextComposer || new ContextComposer();
  }

  /**
   * 执行 Recall Pre-check + Policy
   */
  async handleRecall(expertService, userMessage, userId, expertId) {
    const strategy = expertService.recallStrategy;
    if (!strategy) return null;

    const preCheck = strategy.preCheck(userMessage);
    if (preCheck.decision === 'none') return null;

    if (preCheck.decision === 'force') {
      logger.info(`[Orchestrator] Recall force, executing policy`);
      return await strategy.executePolicy(preCheck, expertService.toolManager, userId, expertId);
    }

    // maybe 模式
    logger.info(`[Orchestrator] Recall maybe (suggested)`);
    return {
      decision: 'maybe',
      items: [],
      meta: { calls: 0, timeout: false, degraded: false },
      trace_id: preCheck.trace_id,
    };
  }

  /**
   * 将 Evidence Packet 注入上下文
   */
  applyEvidence(messages, evidencePacket) {
    if (!evidencePacket || evidencePacket.meta?.degraded) {
      this.contextComposer.injectDegradeNotice(messages);
    } else if (evidencePacket.items?.length > 0) {
      this.contextComposer.injectEvidence(messages, evidencePacket);
    }
  }

  /**
   * 执行 Post-check
   */
  handlePostCheck(expertService, answer, evidencePacket) {
    const strategy = expertService.recallStrategy;
    if (!strategy || !evidencePacket?.meta) return null;

    return strategy.postCheck(answer, evidencePacket);
  }

  /**
   * 基于 Post-check 结果执行补召回并重生回答（返回新增内容，空字符串表示无需修改）
   */
  async handleRetry(expertService, messages, postCheck, evidencePacket, llmOptions) {
    const strategy = expertService.recallStrategy;
    if (!strategy || !postCheck?.need_retry) return '';

    const retryPreCheck = {
      decision: 'force',
      reason_codes: ['postcheck'],
      confidence: 0.8,
      trace_id: postCheck.trace_id,
      query_keyword: '',
    };

    const retryResult = await strategy.executePolicy(
      retryPreCheck, expertService.toolManager, llmOptions.userId, llmOptions.expertId
    );

    const retryItems = retryResult.items?.filter(e => e.source === 'message' && e.snippet);
    if (retryItems.length === 0) return '';

    // 证据注入
    this.applyEvidence(messages, retryResult);

    // 合并证据到原包
    evidencePacket.items.push(...retryResult.items);
    evidencePacket.meta.calls += retryResult.meta.calls;

    return 'retry_success';
  }
}

export default ConversationOrchestrator;
