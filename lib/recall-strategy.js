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
      ...config,
    };

    this.flags = {
      recallStrategyEnabled: true,
      recallMaybeForceEnabled: false,
      recallPostcheckEnabled: true,
      recallDegradeEnabled: true,
    };

    this.metrics = {
      triggerCount: 0,
      forceCount: 0,
      maybeCount: 0,
      missCount: 0,
      falsePositiveCount: 0,
      executionCount: 0,
      timeoutCount: 0,
      degradedCount: 0,
    };
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
  async executePolicy(preCheckResult, toolManager, userId, expertId) {
    const { decision, trace_id, query_keyword } = preCheckResult;
    const items = [];
    let recallCalls = 0;
    let timedOut = false;
    let degraded = false;

    // P1-2: Feature Flag 检查
    if (!this.flags.recallStrategyEnabled || decision === 'none') {
      return this._buildEvidencePacket(trace_id, decision, [], { calls: 0, timeout: false, degraded: false });
    }

    const maxCalls = this.config.recallMaxCallsPerTurn;
    const timeout = this.config.recallTimeoutMs;
    this.metrics.executionCount++;

    try {
      const keyword = query_keyword || '';
      const topicAction = keyword ? 'search' : 'list';
      const topicParams = { mode: 'topic', action: topicAction, start: 0, count: 5 };
      if (keyword) topicParams.keyword = keyword;

      logger.debug(`[RecallStrategy] topic 阶段: action=${topicAction}, keyword="${keyword}"`);
      const topicResult = await this._executeRecallWithTimeout(
        toolManager, 'recall', topicParams, { userId, expertId }, timeout
      );

      if (topicResult.success) {
        recallCalls++;
        const topicList = topicResult.topics || topicResult.data?.topics || [];
        for (const t of topicList.slice(0, 3)) {
          items.push({
            source: 'topic',
            id: t.id || t.topic_id,
            role: null,
            snippet: t.title || t.name || '',
            confidence: 0.8,
            timestamp: new Date().toISOString()
          });
        }

        if (topicList.length > 0 && recallCalls < maxCalls) {
          const targetTopicId = topicList[0].id || topicList[0].topic_id;
          const msgParams = { mode: 'topic', action: 'messages', topic_id: targetTopicId, start: 0, count: 10 };

          const msgResult = await this._executeRecallWithTimeout(
            toolManager, 'recall', msgParams, { userId, expertId }, timeout
          );

          recallCalls++;
          if (msgResult.success) {
            const msgs = msgResult.messages || msgResult.data?.messages || [];
            for (const m of msgs.slice(0, 5)) {
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
      degraded
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
        degraded: meta.degraded || false
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
postCheck(answer, evidencePacket) {
    const result = {
      need_retry: false,
      reason: 'ok',
      retry_count: 0,
      trace_id: evidencePacket.trace_id,
    };

    const factAssertionPattern = /之前|上次|已经|设置了?过|确认了?过|修改了?过|调整了?过|创建了?过/m;
    const hasEvidenceChain = evidencePacket.hasMessages ? evidencePacket.hasMessages() : false;
    const hasCertaintyMarkers = /(?<![不未无])(确定|肯定|是的|没错|对，)/m;

    if (factAssertionPattern.test(answer) && !hasEvidenceChain && hasCertaintyMarkers.test(answer)) {
      // 有历史断言但无证据链且语气确定 → 需要重试
      if (this.config.postcheckMaxRetry > 0) {
        result.need_retry = true;
        result.reason = 'missing_evidence';
        result.retry_count = 1;
        this.metrics.missCount++;
        logger.info(`[RecallStrategy] postCheck: need_retry=true (missing_evidence), trace_id=${evidencePacket.trace_id}`);
      }
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
    let timedOut = false;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        logger.warn(`[RecallStrategy] recall 超时 (${timeoutMs}ms)，tool=${toolName}`);
        reject(new Error('timeout'));
      }, timeoutMs);

      toolManager.executeTool(toolName, params, context, '回忆')
        .then(result => {
          if (!timedOut) {
            clearTimeout(timer);
            resolve(result);
          } else {
            // 已超时，结果直接丢弃
            logger.debug(`[RecallStrategy] recall 结果已超时丢弃`);
          }
        })
        .catch(err => {
          if (!timedOut) {
            clearTimeout(timer);
            reject(err);
          }
        });
    });
  }
}

export default RecallStrategy;
