/**
 * Document Orchestration Service — 多文档协同问答编排层
 *
 * audit-round01 (multi-doc-orchestration) P0-1:
 * 引入统一编排层，解决当前"单文档定位 / 单文档回答优先"的架构缺陷。
 *
 * 核心职责：
 * 1. 判定用户目标 goal_type（定位文档 vs 获得答案）
 * 2. 判定候选收敛状态 candidate_resolution（single/mergeable/ambiguous/conflicting）
 * 3. 产出统一动作 action（answer/clarify/candidate_list/conservative_answer）
 *
 * 不替代现有检索链（DocumentRetrievalService / DocRecallService / DocumentEvidencePacker），
 * 而是在它们之上提供任务编排。现有检索模块作为"检索与证据引擎"保持稳定。
 *
 * audit-round02 P0-1: find_document + mergeable 不再直接放行为 answer，
 *  改为 candidate_list + mergeable_hint（find_document 不返回 chunk 级证据，
 *  过早放行会导致 LLM 仅凭候选标题做"伪引用回答"）。
 *
 * 决策表（audit-round02修订）：
 *
 * | goal_type         | candidate_resolution | action             |
 * |-------------------|----------------------|--------------------|
 * | locate_document   | single               | answer             |
 * | locate_document   | mergeable            | candidate_list (*) |
 * | locate_document   | ambiguous            | candidate_list     |
 * | locate_document   | conflicting          | candidate_list     |
 * | answer_question   | single               | answer             |
 * | answer_question   | mergeable            | answer             |
 * | answer_question   | ambiguous            | candidate_list     |
 * | answer_question   | conflicting          | conservative_answer|
 * | (any)             | none (0 candidates)  | clarify            |
 *
 * (*) locate_document + mergeable 走 candidate_list 而非 answer，
 *    因为 find_document 不返回 chunk 级证据。mergeable 信号通过
 *    mergeable_hint 注入到候选列表提示中，供用户/LLM 做多文档消费决策。
 */

import logger from './logger.js';

/**
 * @typedef {Object} OrchestrationInput
 * @property {string} toolName - 工具名 'find_document' | 'answer_from_documents' | 'verify_fact'
 * @property {string} query - 用户原始查询
 * @property {Array<Object>} candidates - 候选文档列表
 * @property {Object} [packetMeta] - retrieval packet meta
 */

/**
 * @typedef {Object} OrchestrationResult
 * @property {'locate_document'|'answer_question'} goal_type
 * @property {'single'|'mergeable'|'ambiguous'|'conflicting'|'none'} candidate_resolution
 * @property {'answer'|'clarify'|'candidate_list'|'conservative_answer'} action
 * @property {string[]} reason_codes
 * @property {Object} [merge_signals] - mergeable 判定信号
 * @property {boolean} mergeable_hint - 是否应提示用户候选可合并消费（仅 candidate_list + mergeable时）
 * @property {string} [goal_type_source] - goal_type 判定来源 'tool_name' | 'query_signal'
 * @property {'identity_only'|'chunk_evidence'} evidence_capability - 当前 tool 的证据能力
 * @property {boolean} [identity_resolved] - 是否已确认文档身份（audit-round08 P1）
 * @property {boolean} [evidence_resolved] - 是否已具备正文证据（audit-round08 P1）
 */

class DocumentOrchestrationService {

  /**
   * 主编排入口
   * @param {OrchestrationInput} input
   * @returns {OrchestrationResult}
   */
  orchestrate({ toolName, query, candidates, packetMeta }) {
    const goalTypeResult = this._determineGoalType(toolName, query);
    const candidateResolution = this._determineCandidateResolution(candidates, packetMeta);
    let action = this._decideAction(goalTypeResult.goal_type, candidateResolution.resolution, candidates.length);

    const anchoredBridgeEligible = (
      toolName === 'find_document'
      && goalTypeResult.source === 'anchored_document_answer_intent'
      && candidateResolution.resolution === 'mergeable'
    );

    // audit-round09 P0: 显式文档锚点 + 同集合可桥接多候选
    // 典型场景：用户明确点名“文件A”，而 A 正文又把关键参数指向同集合中的文件B。
    // 此时多候选并非真正歧义，而是“已锁定主文档 + 关联答案载体”的桥接关系。
    // 允许继续进入回答链，后续由 auto/broad content chain 获取 chunk 级证据。
    if (anchoredBridgeEligible && action === 'candidate_list') {
      action = 'answer';
    }

    // audit-round03 P0-1: tool-level guard — find_document 无 chunk 级证据，
    // 无论 goal_type 是否被 query 纠偏为 answer_question，
    // 多候选场景下不得直接进入 answer_with_citation 路径。
    // 这封死了 round02 遗留的旁路：
    //   find_document + query_signal_override + mergeable → answer → answer_with_citation
    const reasonCodes = [...candidateResolution.reason_codes];
    let toolGuardActive = false;
    if (toolName === 'find_document' && candidates.length > 1 && action === 'answer' && !anchoredBridgeEligible) {
      action = 'candidate_list';
      toolGuardActive = true;
      reasonCodes.push('tool_guard_find_document_multi_candidate');
    }

    // audit-round03 P1-1: 显式证据能力维度
    const evidenceCapability = (toolName === 'find_document') ? 'identity_only' : 'chunk_evidence';

    // audit-round02 P0-1: locate_document + mergeable → candidate_list（保守方案）
    // 但因候选可合并，提示用户可多文档消费
    const mergeableHint = (
      goalTypeResult.goal_type === 'locate_document' &&
      candidateResolution.resolution === 'mergeable' &&
      action === 'candidate_list'
    );

    const result = {
      goal_type: goalTypeResult.goal_type,
      candidate_resolution: candidateResolution.resolution,
      action,
      reason_codes: reasonCodes,
      merge_signals: candidateResolution.merge_signals,
      mergeable_hint: mergeableHint,
      goal_type_source: goalTypeResult.source,
      evidence_capability: evidenceCapability,
    };

    logger.info('[DocOrchestration] Orchestration result:', {
      goal_type: result.goal_type,
      goal_type_source: result.goal_type_source,
      candidate_resolution: result.candidate_resolution,
      action: result.action,
      candidate_count: candidates.length,
      reason_codes: result.reason_codes,
      mergeable_hint: result.mergeable_hint,
      evidence_capability: result.evidence_capability,
      tool_guard_active: toolGuardActive,
    });

    return result;
  }

  /**
   * 判定用户目标类型
   *
   * audit-round02 P1-1: 增加 query 语义纠偏
   * - toolName 作为强先验（find_document → locate_document）
   * - query 语义信号可覆盖 tool 选择偏差
   *
   * query 语义信号（最小覆盖）：
   * - 问答型：怎么/如何/什么/多少/几/吗/呢/是否/能不能
   * - 计算/条款型：成本/费用/价格/多少钱/计算/条款/规定/要求/责任/承担
   * - 纯定位型：找/在哪/有哪些/列表/列出/搜索/查
   *
   * @param {string} toolName
   * @param {string} query
   * @returns {{ goal_type: string, source: string }}
   */
  _determineGoalType(toolName, query) {
    const q = (query || '').toLowerCase();

    // 问答信号（强信号，可覆盖 find_document 的定位默认）
    const answerPatterns = [
      /怎么|如何|什么|多少|几[个项条]|[多几]少钱|是不是|能否|能不能|是否/,
      /成本|费用|价格|计算|公式|标准值|参数|要求|规定|条款|责任|承担|赔偿|违约/,
      /比例|基数|系数|每天|每日|延[期迟]交付|告诉我/,
      /吗[？?\s]*$|呢[？?\s]*$/,
    ];
    const hasAnswerSignal = answerPatterns.some(p => p.test(q));

    // 显式文档锚点：用户已指出具体文件/文档对象，后续更可能是在问该文档内容
    // 例如：
    // - 帮我看一下审稿人回信2里的回复都做了什么修改
    // - 文件A里延期违约金怎么规定
    // - 那个合同补充协议里面写了什么
    const anchoredDocumentPatterns = [
      /[《“"]?[^《》“”"\s]{1,40}(文件|文档|回信|回复|合同|协议|标准|报告|说明书)[0-9一二三四五六七八九十甲乙丙丁]*[》”"]?(里|中|内|里面)/,
      /(文件|文档|回信|回复|合同|协议|标准|报告|说明书)[a-z0-9一二三四五六七八九十甲乙丙丁]+(里|中|内|里面)/,
      /(文件|文档|回信|回复|合同|协议|标准|报告|说明书)[a-z0-9一二三四五六七八九十甲乙丙丁]+这份(文件|文档|合同|协议|标准|报告|说明书)/,
      /(这个|该)(文件|文档|回信|回复|合同|协议|标准|报告|说明书)/,
      /审稿人回信[0-9一二三四五六七八九十]+(里|中|内|里面)?/,
    ];
    const hasAnchoredDocumentSignal = anchoredDocumentPatterns.some(p => p.test(q));

    // 定位信号
    const locatePatterns = [
      /找|在哪|有哪些|列表|列出|搜索|查[询看找]|定位/,
      /^(GB\/T|ISO|GB|JT|DL|NB|SH|SY|HG)\s*[\d.-]+/,  // 纯编号开头
    ];
    const hasLocateSignal = locatePatterns.some(p => p.test(q));

    if (toolName === 'find_document') {
      // find_document + 显式文档锚点 + 问答信号 → answer_question（优先读该文档内容）
      // 这类 query 的核心不是“帮我确认这份文件是谁”，而是“基于这份文件回答内容问题”。
      // 即使句子里混有“看一下/找一下/查一下”等定位措辞，也应优先视作 anchored answer intent。
      if (hasAnchoredDocumentSignal && hasAnswerSignal) {
        return { goal_type: 'answer_question', source: 'anchored_document_answer_intent' };
      }

      // find_document + 明显问答信号 → answer_question（纠偏）
      if (hasAnswerSignal && !hasLocateSignal) {
        return { goal_type: 'answer_question', source: 'query_signal_override' };
      }
      // find_document + 同时有问答和定位信号 → locate_document_with_answer_intent
      if (hasAnswerSignal && hasLocateSignal) {
        return { goal_type: 'locate_document', source: 'tool_name_with_answer_intent' };
      }
      return { goal_type: 'locate_document', source: 'tool_name' };
    }

    // answer_from_documents, verify_fact → answer_question（默认正确）
    return { goal_type: 'answer_question', source: 'tool_name' };
  }

  /**
   * 判定候选收敛状态
   *
   * 启发式规则（第一阶段，先做可测可审的骨架）：
   * - 0 candidates → 无候选
   * - 1 candidate → single
   * - 2+ candidates → 检查 mergeable 信号，否则 ambiguous
   *
   * mergeable 信号（按优先级）：
   * 1. 同集合（same collection）：候选来自同一标准库/合同库 → mergeable
   *    不同章节/条款常分布在同集合的不同文档中
   * 2. 互补类型（complementary types）：如 standard + price_list → mergeable
   *    费用计算常需"规则文档 + 价格文档"
   * 3. 来源连续性（same source）：同上传批次 / 同附件来源 → mergeable
   * 4. 默认：ambiguous
   *
   * @param {Array<Object>} candidates
   * @param {Object} [packetMeta]
   * @returns {{ resolution: string, reason_codes: string[], merge_signals: Object }}
   */
  _determineCandidateResolution(candidates, packetMeta) {
    const n = candidates.length;

    if (n === 0) {
      return {
        resolution: 'none',
        reason_codes: ['no_candidates'],
        merge_signals: null,
      };
    }

    if (n === 1) {
      return {
        resolution: 'single',
        reason_codes: ['single_candidate'],
        merge_signals: null,
      };
    }

    // n >= 2: 先检查 conflicting，再检查 mergeable
    const conflict = this._detectConflicting(candidates);
    if (conflict.isConflicting) {
      return {
        resolution: 'conflicting',
        reason_codes: conflict.reasons,
        merge_signals: null,
      };
    }

    // 检查 mergeable 信号
    const signals = this._detectMergeSignals(candidates);

    if (signals.mergeable) {
      return {
        resolution: 'mergeable',
        reason_codes: signals.reasons,
        merge_signals: signals,
      };
    }

    // 无法判定 → ambiguous
    return {
      resolution: 'ambiguous',
      reason_codes: ['ambiguous_candidates_no_merge_signal'],
      merge_signals: signals,
    };
  }

  /**
   * 检测多候选是否可合并消费
   *
   * @param {Array<Object>} candidates
   * @returns {{ mergeable: boolean, reasons: string[], signals: Object }}
   */
  _detectMergeSignals(candidates) {
    const reasons = [];
    const signals = { same_collection: false, complementary_types: false, same_source: false };

    // 信号 1：同集合
    const collections = new Set(candidates.map(c => c.collection_name).filter(Boolean));
    if (collections.size === 1 && candidates.length >= 2) {
      signals.same_collection = true;
      reasons.push('same_collection');
    }

    // 信号 2：互补类型（至少 2 种不同类型，且类型组合为已知互补对）
    const docTypes = new Set(candidates.map(c => c.doc_type).filter(Boolean));
    const complementaryPairs = [
      new Set(['standard', 'price_list']),
      new Set(['standard', 'attachment']),
      new Set(['contract', 'attachment']),
      new Set(['contract', 'price_list']),
      new Set(['standard', 'regulation']),
    ];
    const isComplementary = complementaryPairs.some(pair => {
      const intersection = [...docTypes].filter(t => pair.has(t));
      return intersection.length >= 2;
    });
    if (isComplementary) {
      signals.complementary_types = true;
      reasons.push('complementary_types');
    }

    // 信号 3：来源连续性（暂用 collection_name 相同 + relevance_score 相近）
    // 后续可扩展为 attachment 来源 / 上传批次
    if (signals.same_collection) {
      const scores = candidates.map(c => c.relevance_score || 0).filter(s => s > 0);
      if (scores.length >= 2) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const allClose = scores.every(s => Math.abs(s - avg) < 0.3);
        if (allClose) {
          signals.same_source = true;
          reasons.push('same_source_affinity');
        }
      }
    }

    const mergeable = reasons.length > 0;

    return { mergeable, reasons, signals };
  }

  /**
   * 检测候选间冲突（P1-2: 最小冲突启发式）
   *
   * 第一阶段不做复杂冲突图谱，仅检测明显互斥信号：
   * 1. 类型互斥：同集合内有不同类型且非互补对（如 standard + contract 同集合竞争）
   * 2. 来源分散：3+ 不同集合的高置信候选
   *
   * @param {Array<Object>} candidates
   * @returns {{ isConflicting: boolean, reasons: string[] }}
   */
  _detectConflicting(candidates) {
    const reasons = [];
    const collections = new Set(candidates.map(c => c.collection_name).filter(Boolean));
    const docTypes = new Set(candidates.map(c => c.doc_type).filter(Boolean));
    const highConf = candidates.filter(c => c.candidate_confidence === 'high');

    // 信号 1：同集合内类型分散（排除 mergeable 的 complementary 对）
    if (collections.size === 1 && candidates.length >= 2) {
      const complementaryPairs = [
        new Set(['standard', 'price_list']),
        new Set(['standard', 'attachment']),
        new Set(['contract', 'attachment']),
        new Set(['contract', 'price_list']),
        new Set(['standard', 'regulation']),
      ];
      const isComplementary = complementaryPairs.some(pair => {
        const intersection = [...docTypes].filter(t => pair.has(t));
        return intersection.length >= 2;
      });
      if (!isComplementary && docTypes.size >= 2) {
        reasons.push('conflicting_types_in_same_collection');
      }
    }

    // 信号 2：来源高度分散（3+ 不同集合，高置信候选）
    if (collections.size >= 3 && highConf.length >= 2) {
      reasons.push('dispersed_high_confidence_sources');
    }

    return {
      isConflicting: reasons.length > 0,
      reasons,
    };
  }

  /**
   * 决策动作
   *
   * 基于 goal_type × candidate_resolution 决策表映射到 action。
   *
   * @param {'locate_document'|'answer_question'} goalType
   * @param {'single'|'mergeable'|'ambiguous'|'conflicting'} candidateResolution
   * @param {number} candidateCount
   * @returns {'answer'|'clarify'|'candidate_list'|'conservative_answer'}
   */
  _decideAction(goalType, candidateResolution, candidateCount) {
    // 0 候选 → clarify
    if (candidateCount === 0) {
      return 'clarify';
    }

    // locate_document 路径
    if (goalType === 'locate_document') {
      switch (candidateResolution) {
        case 'single':
          return 'answer';
        case 'mergeable':
          // audit-round02 P0-1: locate_document + mergeable 走 candidate_list（保守方案）
          // find_document 不返回 chunk 级证据，过早 answer_with_citation 有风险
          // mergeable_hint 由 orchestrate() 方法注入，供候选列表提示合并消费可能性
          return 'candidate_list';
        case 'ambiguous':
          return 'candidate_list';
        case 'conflicting':
          return 'candidate_list';
        default:
          return 'candidate_list';
      }
    }

    // answer_question 路径
    switch (candidateResolution) {
      case 'single':
        return 'answer';
      case 'mergeable':
        return 'answer';
      case 'ambiguous':
        return 'candidate_list';
      case 'conflicting':
        return 'conservative_answer';
      default:
        return 'clarify';
    }
  }
}

// 单例
const instance = new DocumentOrchestrationService();

export default instance;
export { DocumentOrchestrationService };

/**
 * audit-round07 P0: 判定是否需要在 find_document 单候选收敛后
 * 自动追加 scoped answer_from_documents 内容检索。
 *
 * 纯函数，无副作用，可在单元测试中直接验证决策逻辑。
 *
 * @param {Object} orchestration - 编排结果 { evidence_capability, goal_type_source }
 * @param {number} candidatesLength - 候选文档数量
 * @returns {boolean}
 */
export function shouldAutoChainContent(orchestration, candidatesLength) {
  return orchestration.evidence_capability === 'identity_only'
    && candidatesLength === 1
    && (orchestration.goal_type_source === 'tool_name_with_answer_intent'
        || orchestration.goal_type_source === 'query_signal_override');
}
