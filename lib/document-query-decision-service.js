/**
 * Document Query Decision Service - 文档查询决策服务
 *
 * 在文档检索链路中作为第一层，分析用户查询意图：
 * - 判断查询是"文档定位型"（document_lookup）还是"内容探索型"（content_exploration）
 * - 评估锚点强度（strong / medium / weak / none）
 * - 为后续检索策略选择提供决策依据
 *
 * 设计原则：
 * - 轻量级启发式判定，不依赖 LLM 调用
 * - 宁可误判为 content_exploration（走回退），也不误判为 document_lookup（走错路径）
 * - 所有规则均可审计、可调整
 *
 * 使用方式：
 *   const decisionService = new DocumentQueryDecisionService();
 *   const decision = decisionService.analyze(query, context);
 */

import logger from './logger.js';

/**
 * 文档锚点信号模式
 * 按优先级排序：强锚点 > 中等锚点 > 弱锚点
 */
const ANCHOR_PATTERNS = {
  // 强锚点：明确的文档编号/标准号模式
  strong: [
    // 中国标准号：GB/T 12345-2020, GB 12345, GB/T 12345.1-2020
    /\bGB[\/\sT]*\d[\d.]*(-\d{2,4})?\b/i,
    // ISO 标准：ISO 9001:2015, ISO/IEC 27001
    /\bISO[\/\s]*\d[\d.:]+\b/i,
    // 行业标准：YY/T, HJ, DB, QB 等
    /\b(YY\/T|HJ|DB\d|\bQB)\s*\d[\d.]*\b/i,
    // 合同编号模式：HT-2024-001, CONT-2024001
    /\b(HT|CONT|CONTRACT)[-\s]*\d{2,4}[-\s]*\d+\b/i,
    // 文档编号通用模式：DOC-2024-001, NO.2024-001
    /\b(DOC|NO\.?)[-\s]*\d{2,4}[-\s]*\d+\b/i,
    // 文件号/文号：国发〔2024〕1号, 财会〔2024〕1号
    /[〔\[]?\d{4}[〕\]]?\d+\s*号/,
  ],

  // 中等锚点：文档类型 + 关键词组合
  medium: [
    // "XX合同" / "XX协议"
    /(?:那[份个]|哪[份个]|这[份个]|关于|有关)?.*(?:合同|协议|契约)/,
    // "XX标准" / "XX规范"
    /(?:那[份个]|哪[份个]|这[份个]|关于|有关)?.*(?:标准|规范|规程|准则)/,
    // "XX制度" / "XX办法" / "XX规定"
    /(?:那[份个]|哪[份个]|这[份个]|关于|有关)?.*(?:制度|办法|规定|条例|章程|细则)/,
    // "XX手册" / "XX指南"
    /(?:那[份个]|哪[份个]|这[份个]|关于|有关)?.*(?:手册|指南|说明书|操作指引)/,
    // 明确的文档标题引用
    /《[^》]+》/,
    // 文件A / 文件B / 文档A / 文档B / 回信2 / 标准A 这类编号化锚点
    /(?:文件|文档|回信|回复|合同|协议|标准|报告|说明书)[a-z0-9一二三四五六七八九十甲乙丙丁]+/i,
    // “文件A这份文件 / 该文件 / 这个文件”
    /(?:文件|文档|回信|回复|合同|协议|标准|报告|说明书)[a-z0-9一二三四五六七八九十甲乙丙丁]+这份(?:文件|文档|合同|协议|标准|报告|说明书)/i,
    /(?:这个|该)(?:文件|文档|回信|回复|合同|协议|标准|报告|说明书)/,
  ],

  // 弱锚点：模糊的文档指代
  weak: [
    // 泛指某份文档
    /(?:找|查|看|调|打开|帮我).*(?:文档|文件|资料)/,
    // 询问某份文档的内容
    /(?:文档|文件|资料)(?:里|中|里面|里边|上).*(?:怎么|如何|什么|哪些|有没有)/,
    // 提到collection/知识库
    /(?:知识库|文档库|资料库|归档)/,
    // 口语型找文档：那个/哪份/叫什么/是哪个
    /(?:那个|那份|哪份|这份).*(?:是哪个|叫什么|叫啥|哪一个)/,
    /(?:帮我|给我)?(?:翻一下|找一下|看一下).*(?:那个|那份|哪份)/,
    /(?:帮我|给我)?(?:翻一下|找一下|看一下).*(?:文件|文档|合同|协议|标准|报告)/,
  ],
};

/**
 * 查询意图类型
 */
export const QUERY_INTENT = {
  DOCUMENT_LOOKUP: 'document_lookup',
  CONTENT_EXPLORATION: 'content_exploration',
  AMBIGUOUS: 'ambiguous',
};

/**
 * 锚点强度
 */
export const ANCHOR_STRENGTH = {
  STRONG: 'strong',
  MEDIUM: 'medium',
  WEAK: 'weak',
  NONE: 'none',
};

class DocumentQueryDecisionService {
  constructor() {
    this.patterns = ANCHOR_PATTERNS;
  }

  /**
   * 分析用户查询，返回决策对象
   *
   * @param {string} query - 用户查询文本
   * @param {Object} [context={}] - 可选上下文信息
   * @param {string} [context.collection_name] - 当前对话关联的知识库名称
   * @param {string[]} [context.recent_doc_titles] - 最近讨论的文档标题
   * @param {Object} [context.expert_config] - 专家配置（已废弃的知识策略字段 knowledge_config 不再消费）
   * @returns {Object} 决策对象
   * @returns {string} return.intent - 查询意图：document_lookup | content_exploration | ambiguous
   * @returns {string} return.anchor_strength - 锚点强度：strong | medium | weak | none
   * @returns {number} return.confidence - 置信度 0-1
   * @returns {string[]} return.matched_patterns - 命中的模式描述
   * @returns {string[]} return.reason_codes - 决策原因码
   * @returns {string} return.recommended_strategy - 推荐策略：document_first | chunk_first | clarify
   */
  analyze(query, context = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return this._buildResult(QUERY_INTENT.AMBIGUOUS, ANCHOR_STRENGTH.NONE, 0, [], ['empty_query'], 'clarify');
    }

    const trimmedQuery = query.trim();
    const matchedPatterns = [];
    let anchorStrength = ANCHOR_STRENGTH.NONE;
    let confidence = 0;

    // 1. 检测强锚点
    const strongMatches = this._matchPatterns(trimmedQuery, this.patterns.strong);
    if (strongMatches.length > 0) {
      anchorStrength = ANCHOR_STRENGTH.STRONG;
      confidence = Math.min(0.9, 0.7 + strongMatches.length * 0.1);
      matchedPatterns.push(...strongMatches);
    }

    // 2. 检测中等锚点（仅在无强锚点时评估）
    if (anchorStrength === ANCHOR_STRENGTH.NONE) {
      const mediumMatches = this._matchPatterns(trimmedQuery, this.patterns.medium);
      if (mediumMatches.length > 0) {
        anchorStrength = ANCHOR_STRENGTH.MEDIUM;
        confidence = Math.min(0.7, 0.5 + mediumMatches.length * 0.1);
        matchedPatterns.push(...mediumMatches);
      }
    }

    // 3. 检测弱锚点（仅在无强/中锚点时评估）
    if (anchorStrength === ANCHOR_STRENGTH.NONE) {
      const weakMatches = this._matchPatterns(trimmedQuery, this.patterns.weak);
      if (weakMatches.length > 0) {
        anchorStrength = ANCHOR_STRENGTH.WEAK;
        confidence = Math.min(0.5, 0.3 + weakMatches.length * 0.1);
        matchedPatterns.push(...weakMatches);
      }
    }

    // 4. 结合上下文增强判断
    if (context.recent_doc_titles && context.recent_doc_titles.length > 0) {
      const titleMatch = context.recent_doc_titles.some(title =>
        trimmedQuery.includes(title) || title.includes(trimmedQuery)
      );
      if (titleMatch && anchorStrength === ANCHOR_STRENGTH.NONE) {
        anchorStrength = ANCHOR_STRENGTH.MEDIUM;
        confidence = Math.max(confidence, 0.6);
        matchedPatterns.push('context:recent_doc_title_match');
      }
    }

    const colloquialLookupSignals = [
      /(?:那个|那份|哪份|这份).*(?:是哪个|叫什么|叫啥|哪一个)/,
      /(?:帮我|给我)?(?:翻一下|找一下|看一下).*(?:那个|那份|哪份)/,
    ];
    const hasColloquialLookupSignal = colloquialLookupSignals.some(p => p.test(trimmedQuery));
    const parsedTopicTerms = Array.isArray(context?.parsed_query?.topic_terms) ? context.parsed_query.topic_terms : [];
    const cleanedQuery = typeof context?.parsed_query?.cleaned_query === 'string' ? context.parsed_query.cleaned_query.trim() : '';
    const hasRecoverableTopic = parsedTopicTerms.length > 0 || cleanedQuery.length >= 4;

    if (hasColloquialLookupSignal && hasRecoverableTopic && anchorStrength === ANCHOR_STRENGTH.NONE) {
      anchorStrength = ANCHOR_STRENGTH.WEAK;
      confidence = Math.max(confidence, 0.35);
      matchedPatterns.push('colloquial_lookup_signal');
    }

    // 5. 确定意图和推荐策略
    let intent;
    let recommendedStrategy;
    const reasonCodes = [];

    if (anchorStrength === ANCHOR_STRENGTH.STRONG) {
      intent = QUERY_INTENT.DOCUMENT_LOOKUP;
      recommendedStrategy = 'document_first';
      reasonCodes.push('strong_anchor_detected');
    } else if (anchorStrength === ANCHOR_STRENGTH.MEDIUM) {
      intent = QUERY_INTENT.DOCUMENT_LOOKUP;
      recommendedStrategy = 'document_first';
      reasonCodes.push('medium_anchor_detected');
    } else if (anchorStrength === ANCHOR_STRENGTH.WEAK) {
      intent = QUERY_INTENT.AMBIGUOUS;
      recommendedStrategy = 'document_first_with_fallback';
      reasonCodes.push('weak_anchor_detected');
    } else {
      intent = QUERY_INTENT.CONTENT_EXPLORATION;
      recommendedStrategy = 'chunk_first';
      reasonCodes.push('no_document_anchor');
    }

    // 6. 检查是否有明确的"内容探索"信号覆盖文档定位信号
    const contentExplorationSignals = [
      /(?:怎么|如何|什么[是叫]|为什么|可否|能不能|是否|有哪些|多少[个种])/,
      /(?:解释|说明|阐述|分析|对比|比较|总结|概括|归纳)/,
    ];

    const hasContentSignal = contentExplorationSignals.some(p => p.test(trimmedQuery));
    if (hasContentSignal && anchorStrength === ANCHOR_STRENGTH.WEAK && !hasColloquialLookupSignal) {
      // 弱锚点 + 内容探索信号 → 降级为内容探索
      intent = QUERY_INTENT.CONTENT_EXPLORATION;
      recommendedStrategy = 'chunk_first';
      reasonCodes.push('content_signal_overrides_weak_anchor');
      confidence = Math.max(0.3, confidence - 0.2);
    }

    return this._buildResult(intent, anchorStrength, confidence, matchedPatterns, reasonCodes, recommendedStrategy);
  }

  /**
   * 检测模式匹配
   */
  _matchPatterns(text, patterns) {
    const matched = [];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matched.push(pattern.toString());
      }
    }
    return matched;
  }

  /**
   * 构建标准决策结果
   */
  _buildResult(intent, anchorStrength, confidence, matchedPatterns, reasonCodes, recommendedStrategy) {
    const result = {
      intent,
      anchor_strength: anchorStrength,
      confidence: Math.round(confidence * 100) / 100,
      matched_patterns: matchedPatterns,
      reason_codes: reasonCodes,
      recommended_strategy: recommendedStrategy,
    };

    logger.debug('[DocQueryDecision] Analysis result:', result);
    return result;
  }

  /**
   * 判断是否应该走 document_first 路径
   * 便捷方法，等价于 analyze().recommended_strategy === 'document_first'
   */
  shouldUseDocumentFirst(query, context = {}) {
    const decision = this.analyze(query, context);
    return decision.recommended_strategy === 'document_first'
      || decision.recommended_strategy === 'document_first_with_fallback';
  }
}

// 单例
const instance = new DocumentQueryDecisionService();

export { DocumentQueryDecisionService };
export default instance;
