/**
 * Recall 策略化模块
 * 将 Recall 从提示词建议升级为可控策略（Phase 3）
 *
 * 三层架构：
 * 1. Pre-check  — 规则判定 need_recall
 * 2. Policy     — 两段式召回执行
 * 3. Post-check — 回答证据链校验
 */

import logger from './logger.js';

const RECALL_TOPIC_FETCH_COUNT = 5;
const RECALL_TOPIC_EVIDENCE_LIMIT = 3;
const RECALL_MESSAGE_FETCH_COUNT = 10;
const RECALL_MESSAGE_EVIDENCE_LIMIT = 5;

const DEFAULT_METRICS = Object.freeze({
  triggerCount: 0,
  forceCount: 0,
  maybeCount: 0,
  missCount: 0,
  falsePositiveCount: 0,
  executionCount: 0,
  timeoutCount: 0,
  degradedCount: 0,
});

function createDefaultMetrics() {
  return { ...DEFAULT_METRICS };
}

/**
 * Recall 策略类
 */
export class RecallStrategy {
  constructor(config = {}) {
    this.config = {
      precheckForceMinRules: config.precheckForceMinRules ?? 2,
      precheckConfidenceForce: config.precheckConfidenceForce ?? 0.75,
      recallMaxCallsPerTurn: config.recallMaxCallsPerTurn ?? 2,
      recallTimeoutMs: config.recallTimeoutMs ?? 2500,
      postcheckMaxRetry: config.postcheckMaxRetry ?? 1,
      degradeOnNoEvidence: config.degradeOnNoEvidence ?? true,
      postcheckStrictEvidenceGate: config.postcheckStrictEvidenceGate ?? true,
      ...config,
    };

    this.flags = {
      recallStrategyEnabled: true,
      recallMaybeForceEnabled: false,
      recallPostcheckEnabled: true,
      recallDegradeEnabled: true,
      recallPostcheckStrictEvidenceGate: true,
    };

    this.metrics = createDefaultMetrics();
  }

  /**
   * Pre-check：判断是否需要召回
   * @param {string} userMessage - 用户消息
   * @param {object} context - 上下文
   * @param {string} context.assistantDraft - 回答草稿（可选）
   * @param {string} context.topicSummaries - 话题总结（可选）
   * @returns {object} { decision: 'none'|'maybe'|'force', reason_codes: string[], confidence: number, trace_id: string }
   */
  preCheck(userMessage, context = {}) {
    const { assistantDraft = '', topicSummaries = '' } = context;
    const traceId = `rc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reasonCodes = [];
    const messages = [];

    // P1-2: Feature Flag 总开关检查
    if (!this.flags.recallStrategyEnabled) {
      return { decision: 'none', reason_codes: [], confidence: 0, trace_id: traceId, query_keyword: '' };
    }

    // P0-1: 从用户消息提取查询关键词
    let queryKeyword = '';
    const keywordMatch = userMessage.match(/(?:方案|问题|功能|配置|设置|代码|任务|项目|话题|主题|讨论)[：:]*\s*([^\s，,。.？?！!]{2,20})/);
    if (keywordMatch) {
      queryKeyword = keywordMatch[1];
    } else {
      // 提取最后一个有语义的词组作为关键词
      const words = userMessage.replace(/[？?！!。.，,]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !/上次|之前|刚才|继续|那个|这个|一下|帮我/.test(w));
      queryKeyword = words.slice(-3).join(' ') || userMessage.slice(0, 30);
    }

    // R1：历史依赖词命中
    const historyPattern = /上次|之前|刚才|继续|那个方案|前面|之前说|回顾|总结一下|你忘了|还记得/m;
    if (historyPattern.test(userMessage)) {
      reasonCodes.push('R1');
      messages.push('历史依赖词命中');
    }

    // R2：指代词且无显式先行词（在草稿或上下文中无明确指代）
    const pronounPattern = /它|那个|这件事|这个|那条/m;
    // P1 修复：排除自身依赖前置上下文的标记，仅匹配真正的自包含先行词
    const hasExplicitAntecedent = /具体来说|该|此|根据第\d+条|详见|参考/m;
    if (pronounPattern.test(userMessage) && !hasExplicitAntecedent.test(userMessage)) {
      reasonCodes.push('R2');
      messages.push('指代词且无显式先行词');
    }

    // R3：上下文含摘要占位或工具摘要提示
    if (topicSummaries && topicSummaries.length > 0) {
      const hasPlaceholder = /recall|获取完整|查看更多|...\s*$/m;
      if (hasPlaceholder.test(topicSummaries)) {
        reasonCodes.push('R3');
        messages.push('摘要占位命中');
      }
    }

    // 决策：命中 >=2 条 → force，1 条 → maybe，0 条 → none
    let decision = 'none';
    let confidence = 0;

    if (reasonCodes.length >= this.config.precheckForceMinRules) {
      decision = 'force';
      confidence = Math.min(0.75 + reasonCodes.length * 0.1, 0.95);
    } else if (reasonCodes.length === 1) {
      // P1-3: 使用 precheckConfidenceForce 阈值判定
      const baseConfidence = 0.5;
      decision = (this.flags.recallMaybeForceEnabled || baseConfidence >= this.config.precheckConfidenceForce)
        ? 'force' : 'maybe';
      confidence = baseConfidence;
    }

    this.metrics.triggerCount++;
    if (decision === 'force') this.metrics.forceCount++;
    if (decision === 'maybe') this.metrics.maybeCount++;

    logger.info(`[RecallStrategy] preCheck: decision=${decision}, reason_codes=[${reasonCodes.join(',')}], confidence=${confidence}, trace_id=${traceId}`);

    return { decision, reason_codes: reasonCodes, confidence, trace_id: traceId, query_keyword: queryKeyword, _messages: messages };
  }

  /**
   * Policy 执行器：两段式召回 → Evidence Packet（Phase 4 WP-2）
   * @param {object} preCheckResult - preCheck 输出
   * @param {object} toolManager - ToolManager 实例
   * @param {string} userId
   * @param {string} expertId
   * @returns {EvidencePacket}
   */
  _normalizeTopicKeywords(topic) {
    const raw = topic?.keywords;
    if (Array.isArray(raw)) return raw.join(' ');
    if (typeof raw !== 'string') return '';
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.join(' ') : raw;
    } catch (error) {
      return raw;
    }
  }

  _scoreRecallTopic(topic, keyword = '') {
    const query = String(keyword || '').trim().toLowerCase();
    const title = String(topic?.title || topic?.name || '').toLowerCase();
    const description = String(topic?.description || topic?.summary || '').toLowerCase();
    const keywords = this._normalizeTopicKeywords(topic).toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    let score = 0;

    for (const term of terms) {
      if (title === term) score += 8;
      if (title.includes(term)) score += 5;
      if (keywords.includes(term)) score += 4;
      if (description.includes(term)) score += 2;
    }

    score += Math.min(2, Number(topic?.message_count || 0) / 20);
    const updatedAt = new Date(topic?.updated_at || topic?.created_at || 0).getTime();
    if (Number.isFinite(updatedAt) && updatedAt > 0) {
      const ageHours = Math.max(0, (Date.now() - updatedAt) / 3600000);
      score += Math.max(0, 2 - ageHours / 72);
    }
    if (topic?.status === 'active') score += 0.5;

    return score;
  }

  _rankRecallTopics(topics, keyword = '') {
    return [...(topics || [])]
      .map((topic, index) => ({
        topic,
        index,
        score: this._scoreRecallTopic(topic, keyword),
      }))
      .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  }

  async executePolicy(preCheckResult, toolManager, userId, expertId) {
    const { decision, trace_id, query_keyword } = preCheckResult;
    const items = [];
    let recallCalls = 0;
    let timedOut = false;
    let degraded = false;
    let messageStageAttempted = false;
    let messageStageFailed = false;
    let selectedTopicId = null;

    // P1-2: Feature Flag 检查
    if (!this.flags.recallStrategyEnabled || decision === 'none') {
      return this._buildEvidencePacket(trace_id, decision, [], { calls: 0, timeout: false, degraded: false });
    }

    const maxCalls = this.config.recallMaxCallsPerTurn;
    const timeout = this.config.recallTimeoutMs;
    const keyword = query_keyword || '';
    this.metrics.executionCount++;

    try {
      const topicAction = keyword ? 'search' : 'list';
      const topicParams = { mode: 'topic', action: topicAction, start: 0, count: RECALL_TOPIC_FETCH_COUNT };
      if (keyword) topicParams.keyword = keyword;

      logger.debug(`[RecallStrategy] topic 阶段: action=${topicAction}, keyword="${keyword}"`);
      const topicResult = await this._executeRecallWithTimeout(
        toolManager, 'recall', topicParams, { userId, expertId }, timeout
      );

      if (topicResult.success) {
        recallCalls++;
        const topicList = topicResult.topics || topicResult.data?.topics || [];
        const rankedTopics = this._rankRecallTopics(topicList, keyword);
        for (const ranked of rankedTopics.slice(0, RECALL_TOPIC_EVIDENCE_LIMIT)) {
          const t = ranked.topic;
          items.push({
            source: 'topic',
            id: t.id || t.topic_id,
            role: null,
            snippet: t.title || t.name || '',
            confidence: Math.min(0.95, 0.65 + ranked.score / 20),
            timestamp: new Date().toISOString()
          });
        }

        if (rankedTopics.length > 0 && recallCalls < maxCalls) {
          const targetTopic = rankedTopics[0].topic;
          const targetTopicId = targetTopic.id || targetTopic.topic_id;
          selectedTopicId = targetTopicId;
          const msgParams = { mode: 'topic', action: 'messages', topic_id: targetTopicId, start: 0, count: RECALL_MESSAGE_FETCH_COUNT };
          messageStageAttempted = true;

          const msgResult = await this._executeRecallWithTimeout(
            toolManager, 'recall', msgParams, { userId, expertId }, timeout
          );

          recallCalls++;
          if (msgResult.success) {
            const msgs = msgResult.messages || msgResult.data?.messages || [];
            messageStageFailed = msgs.length === 0;
            for (const m of msgs.slice(0, RECALL_MESSAGE_EVIDENCE_LIMIT)) {
              const rawContent = m.content || m.summary || '';
              items.push({
                source: 'message',
                id: m.id || m.message_id,
                role: m.role || null,
                snippet: typeof rawContent === 'string' ? rawContent.slice(0, 300) : '',
                confidence: 0.7,
                timestamp: m.created_at || m.timestamp || new Date().toISOString()
              });
            }
          } else {
            messageStageFailed = true;
          }
        }
      }
    } catch (error) {
      if (error.message?.includes('timeout')) {
        timedOut = true;
        this.metrics.timeoutCount++;
      }
      logger.error(`[RecallStrategy] executePolicy 失败: ${error.message}`);
    }

    if (items.length === 0 && (decision === 'force' || this.config.degradeOnNoEvidence)) {
      degraded = true;
      this.metrics.degradedCount++;
    }

    const packet = this._buildEvidencePacket(trace_id, decision, items, {
      calls: recallCalls,
      timeout: timedOut,
      degraded,
      query_keyword: keyword,
      messageStageAttempted,
      messageStageFailed,
      selectedTopicId,
    });

    logger.info(`[RecallStrategy] executePolicy: items=${items.length}, calls=${recallCalls}, trace_id=${trace_id}`);
    return packet;
  }

  /**
   * Phase 4 WP-2: 构建 Evidence Packet
   */
  _buildEvidencePacket(traceId, decision, items, meta) {
    return {
      trace_id: traceId,
      decision,
      items,
      meta: {
        calls: meta.calls || 0,
        timeout: meta.timeout || false,
        degraded: meta.degraded || false,
        query_keyword: meta.query_keyword || '',
        messageStageAttempted: meta.messageStageAttempted || false,
        messageStageFailed: meta.messageStageFailed || false,
        selectedTopicId: meta.selectedTopicId || null,
      },
      // 便捷方法
      getSnippets(maxLength = 200) {
        return this.items
          .map(i => i.snippet)
          .filter(Boolean)
          .join('\n')
          .slice(0, maxLength);
      },
      hasMessages() {
        return this.items.some(i => i.source === 'message');
      }
    };
  }

  /**
   * Post-check：回答校验
   * @param {string} answer - 模型回答
   * @param {EvidencePacket} evidencePacket - 证据包
   * @returns {object} { need_retry, reason, retry_count, trace_id }
   */
  _hasSpecificHistoricalAssertion(answer) {
    const text = String(answer || '');
    const hasHistoryReference = /上次|之前|刚才|前面|此前|已经|讨论过|提到过|previous|earlier|discussed|mentioned/i.test(text);
    const hasSpecificObject = /\d{2,}|第\s*\d+|方案|配置|任务|项目|代码|接口|字段|文件|文档|标题|时间|日期|版本|issue|task|config|file|document|topic/i.test(text);
    return hasHistoryReference && hasSpecificObject;
  }

  postCheck(answer, evidencePacket) {
    const result = {
      need_retry: false,
      reason: 'ok',
      retry_count: 0,
      trace_id: evidencePacket.trace_id,
    };

    if (!this.flags.recallPostcheckEnabled) {
      return result;
    }

    const hasEvidenceChain = evidencePacket.hasMessages ? evidencePacket.hasMessages() : false;
    const strictGateEnabled = this.flags.recallPostcheckStrictEvidenceGate && this.config.postcheckStrictEvidenceGate;
    const missingEvidence = strictGateEnabled
      ? evidencePacket.decision === 'force'
        && evidencePacket.meta?.messageStageFailed === true
        && !hasEvidenceChain
        && this._hasSpecificHistoricalAssertion(answer)
      : !hasEvidenceChain && this._hasSpecificHistoricalAssertion(answer);

    if (missingEvidence && this.config.postcheckMaxRetry > 0) {
      result.need_retry = true;
      result.reason = 'missing_evidence';
      result.retry_count = 1;
      this.metrics.missCount++;
      logger.info(`[RecallStrategy] postCheck: need_retry=true (missing_evidence), trace_id=${evidencePacket.trace_id}`);
    }

    return result;
  }

  /**
   * 生成降级回答模板
   */
  getDegradeResponse(originalAnswer) {
    return `根据当前可用信息，我暂时无法确认具体的细节。建议您提供更多上下文，或者我们可以重新讨论。\n\n以下是基于现有信息的部分回答：\n\n${originalAnswer}`;
  }

  /**
   * 获取指标
   */
  getMetrics() {
    return { ...this.metrics };
  }

  resetMetrics() {
    this.metrics = createDefaultMetrics();
    logger.info('[RecallStrategy] metrics reset');
    return this.getMetrics();
  }

  /**
   * 设置功能开关
   */
  setFlag(name, value) {
    if (name in this.flags) {
      this.flags[name] = value;
      logger.info(`[RecallStrategy] flag ${name} = ${value}`);
    }
  }

  /**
   * Phase 4 WP-4: 批量设置开关
   */
  setFlags(flags) {
    for (const [k, v] of Object.entries(flags)) {
      if (k in this.flags) {
        this.flags[k] = v;
      }
    }
    logger.info(`[RecallStrategy] flags updated: ${JSON.stringify(this.flags)}`);
  }

  // 带超时的 recall 执行
  async _executeRecallWithTimeout(toolManager, toolName, params, context, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        fn(value);
        return true;
      };

      const timer = setTimeout(() => {
        logger.warn(`[RecallStrategy] recall 超时 (${timeoutMs}ms)，tool=${toolName}`);
        finish(reject, new Error('timeout'));
      }, timeoutMs);

      toolManager.executeTool(toolName, params, context, '回忆')
        .then(result => {
          if (!finish(resolve, result)) {
            // 已超时，结果直接丢弃
            logger.debug('[RecallStrategy] recall result ignored after timeout');
          }
        })
        .catch(err => {
          if (!finish(reject, err)) {
            logger.debug(`[RecallStrategy] recall error ignored after timeout: ${err.message}`);
          }
        });
    });
  }
}

export default RecallStrategy;
