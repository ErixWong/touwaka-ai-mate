/**
 * Evidence Formatter — 证据上下文格式化模块
 *
 * 从 rag-service 迁出的独立模块，将 evidence packet 格式化为 LLM 可消费的上下文文本。
 * 本模块是 document_retrieval tool 路径中的唯一证据格式化入口。
 *
 * 迁出时间：2026-07-07（旧自动预检索路径退场任务 Round 01）
 * 原位置：lib/rag-service.js buildEvidenceContextMessage()
 *
 * audit-round03 P2-1: reason_codes 消费边界
 * - reason_codes: 流程级原因（no_evidence_in_candidates, fallback_supplement, weak_evidence_degrade 等）
 * - coverage_reason_codes: 覆盖级原因（coverage_miss_core_entity, coverage_no_chunk_overlap 等）
 * - 格式化时分别展示，避免混淆
 */

import logger from './logger.js';

/**
 * 将 evidence packet 格式化为 LLM 上下文文本
 *
 * @param {Object} packet - evidence packet（来自 document_retrieval tool）
 * @param {Object} packet.strategy - 检索策略标识
 * @param {Object} packet.meta - 元信息
 * @param {string} packet.meta.evidence_sufficiency - 证据充分性
 * @param {string} packet.meta.coverage_status - 证据覆盖状态（audit-round03 P1-1）
 * @param {string[]} packet.meta.coverage_reason_codes - 覆盖原因标记（audit-round03 P1-1）
 * @param {string} packet.meta.suggested_response_mode - 建议回答模式
 * @param {string[]} packet.meta.reason_codes - 流程级原因标记
 * @param {Array} packet.documents - 候选文档列表
 * @param {Object} options - 选项
 * @param {number} options.maxTokens - 最大 token 数（默认 3000）
 * @returns {string} 格式化的证据上下文消息
 */
export function buildEvidenceContextMessage(packet, options = {}) {
  const { maxTokens = 3000 } = options;

  if (!packet || !packet.documents || packet.documents.length === 0) {
    return '';
  }

  const sufficiency = packet.meta?.evidence_sufficiency || 'unknown';
  const responseMode = packet.meta?.suggested_response_mode || 'direct_answer';
  const reasonCodes = packet.meta?.reason_codes || [];
  const coverageStatus = packet.meta?.coverage_status || 'not_evaluated';
  const coverageReasonCodes = packet.meta?.coverage_reason_codes || [];

  let context = '';

  // 证据概览
  context += `## 文档检索结果\n`;
  context += `- 检索策略: ${packet.strategy || 'unknown'}\n`;
  context += `- 证据充分性: ${sufficiency}\n`;
  context += `- 覆盖状态: ${coverageStatus}\n`;
  if (coverageReasonCodes.length > 0) {
    context += `- 覆盖原因: ${coverageReasonCodes.join(', ')}\n`;
  }
  context += `- 回答原则: 若证据中出现明确数值、时间、距离、章节号、表格参数，回答时必须优先逐项引用这些原文参数；禁止用常识或泛化表述替换。\n`;

  if (responseMode === 'conservative_answer') {
    context += `- ⚠️ 建议回答模式: 保守回答（证据不足，请明确告知用户依据有限）\n`;
  } else if (responseMode === 'clarify') {
    context += `- ⚠️ 建议回答模式: 澄清问题（意图不明确，请向用户确认需求）\n`;
  } else if (responseMode === 'candidate_list') {
    context += `- ⚠️ 建议回答模式: 列出候选（多个可能文档，请先确认目标）\n`;
  } else if (responseMode === 'answer_with_citation') {
    context += `- 建议回答模式: 引用回答（请引用文档来源）\n`;
  }

  if (reasonCodes.length > 0) {
    context += `- 流程原因: ${reasonCodes.join(', ')}\n`;
  }
  context += '\n';

  // 候选文档及证据
  for (let i = 0; i < packet.documents.length; i++) {
    const doc = packet.documents[i];
    const evidenceCount = doc.evidence?.length || 0;

    context += `### 文档 ${i + 1}: ${doc.document_title || '未命名'}\n`;
    context += `- 类型: ${doc.doc_type || 'unknown'} | 集合: ${doc.collection_name || 'unknown'}\n`;
    context += `- 相关度: ${Math.round((doc.relevance_score || 0) * 100)}% | 置信度: ${doc.candidate_confidence || 'unknown'}\n`;
    context += `- 证据条数: ${evidenceCount}\n`;
    context += `- 回答要求: 若该文档证据已包含试验条件/判定条件/表格参数，必须直接依据下方证据作答，不得补写证据中未出现的试验时长、深度、流量、步骤。\n`;

    if (doc.evidence && doc.evidence.length > 0) {
      context += `\n**关键证据片段：**\n`;
      for (let j = 0; j < Math.min(doc.evidence.length, 3); j++) {
        const ev = doc.evidence[j];
        const snippet = (ev.content || '').substring(0, 400);
        context += `> [证据${j + 1}] (相关度: ${Math.round((ev.score || 0) * 100)}%)\n`;
        context += `> ${snippet}\n\n`;
      }
    }
  }

  // Token 限制
  if (context.length > maxTokens * 1.5) {
    context = context.substring(0, Math.floor(maxTokens * 1.5)) + '\n...(证据上下文已截断)';
  }

  return context;
}

export default { buildEvidenceContextMessage };
