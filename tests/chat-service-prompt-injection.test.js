/**
 * ChatService prompt 注入测试 — 真实方法回归保护
 *
 * audit-round06: 从 static 副本测试升级为真实 ExpertChatService 方法调用。
 * 使用 Object.create(prototype) 绕过构造函数重依赖，调用的仍是源文件中的真实方法。
 *
// audit-round07: auto_content_chain 场景 (G-J)
 *
 * audit-round08: 新增 cross_document_bridge 桥接场景 + identity_resolved 阶段字段场景
 *
 * 运行：node tests/chat-service-prompt-injection.test.js
 */

import { ExpertChatService } from '../lib/chat-service.js';
import { buildEvidenceContextMessage } from '../lib/evidence-formatter.js';
import { shouldAutoChainContent } from '../lib/document-orchestration-service.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}`);
  }
}

function assertContains(text, substring, label) {
  if (text.includes(substring)) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label} | 预期包含: "${substring}"`);
    console.error(`    实际文本前 300 字符: ${text.substring(0, 300)}`);
  }
}

function assertNotContains(text, substring, label) {
  if (!text.includes(substring)) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label} | 不应包含: "${substring}"`);
  }
}

// ============================================================
// 构造最小实例：绕过构造函数重依赖，调用真实原型方法
// 审计建议 5.2: Object.create(ExpertChatService.prototype)
// ============================================================
const service = Object.create(ExpertChatService.prototype);

// ============================================================
// 场景 A（必补）: 真实 _buildResponseModeConstraint('single_document')
// audit-round06 §4.1
// ============================================================
function testCaseA_RealSingleDocumentConstraint() {
  console.log('\n📋 场景A: 真实 _buildResponseModeConstraint("single_document")');

  const output = service._buildResponseModeConstraint('single_document');

  assertContains(output, '强制回答约束：单文档定位模式', 'A.1 含 single_document 约束标题');
  assertContains(output, '确认已定位到的文档身份', 'A.2 含身份确认规则');
  assertContains(output, '不要仅凭片段摘要编造答案', 'A.3 含禁止编造规则（无内容证据分支）');
  assertContains(output, '禁止过度解读 supporting_evidence 片段', 'A.4 含禁止过度解读规则');
  // audit-round07: 新约束文本含内容证据分支
  assertContains(output, '直接基于证据回答用户问题', 'A.5 含内容证据分支（直接回答）');
}

// ============================================================
// 场景 B（必补）: 真实 buildEvidenceInjection() identity_only + query_signal_override
// audit-round06 §4.2
// ============================================================
function testCaseB_RealIdentityOnlyGuardInjection() {
  console.log('\n📋 场景B: 真实 buildEvidenceInjection() identity_only + query_signal_override');

  const toolResult = {
    success: true,
    suggested_response_mode: 'single_document',
    strategy: 'document_first',
    evidence_sufficiency: 'low',
    reason_codes: ['single_candidate'],
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库' },
    ],
    orchestration: {
      evidence_capability: 'identity_only',
      goal_type_source: 'query_signal_override',
      goal_type: 'answer_question',
      candidate_resolution: 'single',
      action: 'answer',
    },
  };

  const output = service.buildEvidenceInjection(toolResult, { maxTokens: 4000 });

  assertContains(output, '强制回答约束：单文档定位模式', 'B.1 含 single_document 约束');
  assertContains(output, '证据能力约束：身份信息仅用于定位', 'B.2 含 identity_only 守卫标题');
  assertContains(output, '未提供完整的原文内容', 'B.3 含「未提供完整原文」声明');
  assertContains(output, '不要基于片段摘要编造完整的条款', 'B.4 含禁止编造条款规则');
}

// ============================================================
// 场景 C（建议）: identity_only + tool_name → 不触发守卫
// audit-round06 §4.3
// ============================================================
function testCaseC_RealPureLocateNoGuard() {
  console.log('\n📋 场景C: identity_only + tool_name → 不注入守卫');

  const toolResult = {
    success: true,
    suggested_response_mode: 'single_document',
    strategy: 'document_first',
    evidence_sufficiency: 'high',
    reason_codes: ['single_candidate'],
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库' },
    ],
    orchestration: {
      evidence_capability: 'identity_only',
      goal_type_source: 'tool_name',
      goal_type: 'locate_document',
      candidate_resolution: 'single',
      action: 'answer',
    },
  };

  const output = service.buildEvidenceInjection(toolResult, { maxTokens: 4000 });

  assertContains(output, '强制回答约束：单文档定位模式', 'C.1 含 single_document 约束');
  assertNotContains(output, '证据能力约束：身份信息仅用于定位', 'C.2 不含 identity-only 守卫');
}

// ============================================================
// 场景 D（建议）: chunk_evidence → 不触发 identity-only 守卫
// audit-round06 §4.4
// ============================================================
function testCaseD_RealChunkEvidenceNoGuard() {
  console.log('\n📋 场景D: chunk_evidence → 不含 identity-only 守卫');

  const toolResult = {
    success: true,
    suggested_response_mode: 'answer_with_citation',
    strategy: 'semantic_first',
    evidence_sufficiency: 'high',
    reason_codes: ['sufficient_evidence'],
    documents: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库' },
    ],
    orchestration: {
      evidence_capability: 'chunk_evidence',
      goal_type_source: 'tool_name',
      goal_type: 'answer_question',
      candidate_resolution: 'single',
      action: 'answer',
    },
  };

  const output = service.buildEvidenceInjection(toolResult, { maxTokens: 4000 });

  assertContains(output, '强制回答约束：引用回答模式', 'D.1 含 answer_with_citation 约束');
  assertNotContains(output, '证据能力约束：身份信息仅用于定位', 'D.2 不含 identity-only 守卫');
  assertNotContains(output, '强制回答约束：单文档定位模式', 'D.3 不含 single_document 约束');
}

// ============================================================
// 场景 E: 失败 toolResult → 空字符串（真实方法）
// ============================================================
function testCaseE_RealFailedToolResultEmptyOutput() {
  console.log('\n📋 场景E: 失败 toolResult → 空字符串');

  const output1 = service.buildEvidenceInjection(null, { maxTokens: 4000 });
  assert(output1 === '', 'E.1 null → 空字符串');

  const output2 = service.buildEvidenceInjection({ success: false }, { maxTokens: 4000 });
  assert(output2 === '', 'E.2 { success: false } → 空字符串');
}

// ============================================================
// 场景 F: single_document 完整路径（无 orchestration 的正常路径）
// ============================================================
function testCaseF_RealSingleDocumentFullPath() {
  console.log('\n📋 场景F: single_document 完整路径（无 orchestration）');

  const toolResult = {
    success: true,
    suggested_response_mode: 'single_document',
    strategy: 'document_first',
    evidence_sufficiency: 'medium',
    reason_codes: ['single_candidate'],
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库' },
    ],
  };

  const output = service.buildEvidenceInjection(toolResult, { maxTokens: 4000 });

  assertContains(output, '强制回答约束：单文档定位模式', 'F.1 含 single_document 约束');
  assertContains(output, '确认已定位到的文档身份', 'F.2 含身份确认规则');
  assertContains(output, '禁止过度解读 supporting_evidence 片段', 'F.3 含禁止过度解读规则');
  assertContains(output, 'GB/T 4208-2017', 'F.4 含文档证据内容');
  assertNotContains(output, '证据能力约束：身份信息仅用于定位', 'F.5 无 orchestration 不注入守卫');
}

// ============================================================
// audit-round07 新增场景
// ============================================================

// 场景 G: shouldAutoChainContent 决策逻辑 — query_signal_override
function testCaseG_ShouldAutoChainQuerySignalOverride() {
  console.log('\n📋 场景G: shouldAutoChainContent query_signal_override → true');

  assert(shouldAutoChainContent(
    { evidence_capability: 'identity_only', goal_type_source: 'query_signal_override' },
    1
  ), 'G.1 identity_only + query_signal_override + 1 candidate → true');

  assert(!shouldAutoChainContent(
    { evidence_capability: 'identity_only', goal_type_source: 'query_signal_override' },
    2
  ), 'G.2 identity_only + query_signal_override + 2 candidates → false');

  assert(!shouldAutoChainContent(
    { evidence_capability: 'chunk_evidence', goal_type_source: 'query_signal_override' },
    1
  ), 'G.3 chunk_evidence + query_signal_override → false（已有内容证据）');
}

// 场景 H: shouldAutoChainContent 决策逻辑 — tool_name_with_answer_intent
function testCaseH_ShouldAutoChainMixedIntent() {
  console.log('\n📋 场景H: shouldAutoChainContent tool_name_with_answer_intent → true');

  assert(shouldAutoChainContent(
    { evidence_capability: 'identity_only', goal_type_source: 'tool_name_with_answer_intent' },
    1
  ), 'H.1 identity_only + mixed_intent + 1 candidate → true');

  assert(!shouldAutoChainContent(
    { evidence_capability: 'identity_only', goal_type_source: 'tool_name' },
    1
  ), 'H.2 identity_only + tool_name(pure locate) → false');
}

// 场景 I: buildEvidenceInjection 含 auto_content_chain
function testCaseI_AutoContentChainInjection() {
  console.log('\n📋 场景I: buildEvidenceInjection auto_content_chain → 含内容证据');

  const toolResult = {
    success: true,
    suggested_response_mode: 'single_document',
    strategy: 'document_first',
    evidence_sufficiency: 'medium',
    reason_codes: ['single_candidate', 'auto_content_chain'],
    candidates: [
      { document_id: 'd1', document_title: '施工合同附件A', doc_type: 'contract', collection_name: '合同库' },
    ],
    auto_content_chain: { active: true, content_document_count: 1 },
    content_documents: [
      {
        document_id: 'd1',
        document_title: '施工合同附件A',
        doc_type: 'contract',
        collection_name: '合同库',
        relevance_score: 0.95,
        candidate_confidence: 'high',
        top_evidence: [
          { content: '每逾期一日，按合同总价的千分之三支付违约金。计算基数：合同总价（不含暂列金）。', score: 0.92 },
        ],
      },
    ],
    orchestration: {
      evidence_capability: 'chunk_evidence',
      goal_type_source: 'tool_name_with_answer_intent',
      goal_type: 'locate_document',
      candidate_resolution: 'single',
      action: 'answer',
    },
  };

  const output = service.buildEvidenceInjection(toolResult, { maxTokens: 4000 });

  assertContains(output, '强制回答约束：单文档定位模式', 'I.1 含 single_document 约束');
  assertContains(output, '直接基于证据回答用户问题', 'I.2 含内容证据分支（直接回答）');
  assertContains(output, '千分之三', 'I.3 含内容证据文本');
  assertContains(output, '施工合同附件A', 'I.4 含文档名称');
  assertNotContains(output, '证据能力约束：身份信息仅用于定位', 'I.5 不含 identity-only 守卫（已升级 chunk_evidence）');
}

// 场景 J: auto_content_chain 但 content_documents 为空 → 回退到 candidates
function testCaseJ_AutoContentChainEmptyFallback() {
  console.log('\n📋 场景J: auto_content_chain 但 content_documents 为空 → 回退 candidates');

  const toolResult = {
    success: true,
    suggested_response_mode: 'single_document',
    strategy: 'document_first',
    evidence_sufficiency: 'low',
    reason_codes: ['single_candidate', 'auto_content_chain'],
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库' },
    ],
    auto_content_chain: { active: true, content_document_count: 0 },
    content_documents: [],
    orchestration: {
      evidence_capability: 'chunk_evidence',
      goal_type_source: 'tool_name_with_answer_intent',
      goal_type: 'locate_document',
      candidate_resolution: 'single',
      action: 'answer',
    },
  };

  const output = service.buildEvidenceInjection(toolResult, { maxTokens: 4000 });

  assertContains(output, '强制回答约束：单文档定位模式', 'J.1 含 single_document 约束');
  assertContains(output, 'GB/T 4208-2017', 'J.2 含候选文档（回退）');
}

// ============================================================
// audit-round08: 跨文档桥接 + 阶段字段
// ============================================================

// 场景 K: cross_document_bridge — 跨文档桥接包含新文档的内容证据
function testCaseK_CrossDocumentBridge() {
  console.log('\n📋 场景K: cross_document_bridge auto_content_chain → 注入跨文档证据');

  const toolResult = {
    success: true,
    suggested_response_mode: 'single_document',
    strategy: 'document_first',
    evidence_sufficiency: 'medium',
    reason_codes: ['single_candidate', 'auto_content_chain', 'cross_document_bridge'],
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库' },
    ],
    auto_content_chain: { active: true, content_document_count: 2 },
    content_documents: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', top_evidence: [{ content: 'IPX5试验条件：喷嘴内径6.3mm，水流量12.5L/min', score: 0.92 }] },
      { document_id: 'd2', document_title: 'GB/T 4208-2017 关联解读', top_evidence: [{ content: 'IPX5试验需持续至少3分钟，距离2.5-3m', score: 0.88 }] },
    ],
    orchestration: {
      evidence_capability: 'chunk_evidence',
      goal_type_source: 'tool_name_with_answer_intent',
      goal_type: 'locate_document',
      candidate_resolution: 'single',
      action: 'answer',
      identity_resolved: true,
      evidence_resolved: true,
    },
  };

  const output = service.buildEvidenceInjection(toolResult, { maxTokens: 4000 });

  assertContains(output, '单文档定位模式', 'K.1 含 single_document 约束');
  assertContains(output, '直接基于证据回答', 'K.2 含内容证据分支（直接回答）');
  assertContains(output, 'GB/T 4208-2017', 'K.3 含主候选文档');
  assertContains(output, '关联解读', 'K.4 含跨文档桥接文档名称');
  assertContains(output, '12.5L/min', 'K.5 含桥接内容证据');
  assertContains(output, '2.5-3m', 'K.6 含桥接内容证据');
  assertNotContains(output, '身份信息仅用于定位', 'K.7 不含 identity-only 守卫（已桥接到 chunk_evidence）');
}

// 场景 L: orchestration 含 identity_resolved/evidence_resolved → 不影响注入但字段存在
function testCaseL_StageFieldsPropagation() {
  console.log('\n📋 场景L: identity_resolved/evidence_resolved 阶段字段传播');

  const toolResult = {
    success: true,
    suggested_response_mode: 'single_document',
    strategy: 'document_first',
    evidence_sufficiency: 'low',
    reason_codes: ['single_candidate', 'auto_content_chain'],
    candidates: [
      { document_id: 'd3', document_title: '内部操作手册 v3', doc_type: 'manual', collection_name: '内部知识库' },
    ],
    auto_content_chain: { active: true, content_document_count: 1 },
    content_documents: [
      { document_id: 'd3', document_title: '内部操作手册 v3', top_evidence: [{ content: '设备巡检周期为每周一次，记录表编号TM-0421', score: 0.91 }] },
    ],
    orchestration: {
      evidence_capability: 'chunk_evidence',
      goal_type_source: 'query_signal_override',
      goal_type: 'answer_question',
      candidate_resolution: 'single',
      action: 'answer',
      identity_resolved: true,
      evidence_resolved: true,
    },
  };

  const output = service.buildEvidenceInjection(toolResult, { maxTokens: 4000 });

  assertContains(output, '单文档定位模式', 'L.1 含 single_document 约束');
  assertContains(output, '直接基于证据回答', 'L.2 含内容证据分支');
  assertContains(output, '内部操作手册 v3', 'L.3 含文档名称');
  assertContains(output, 'TM-0421', 'L.4 含证据内容');
}

// 场景 M: verify_fact 返回 supported + documents → 进入 answer_with_citation
function testCaseM_VerifyFactSupportedConsumesCitationMode() {
  console.log('\n📋 场景M: verify_fact supported → 消费为 answer_with_citation');

  const toolResult = {
    success: true,
    tool_name: 'verify_fact',
    skill_namespace: 'document_retrieval',
    verdict: 'supported',
    strategy: 'document_first',
    evidence_sufficiency: 'strong',
    suggested_response_mode: 'answer_with_citation',
    reason_codes: ['strong_anchor_detected', 'parameter_evidence_closure'],
    documents: [
      {
        document_id: 'd1',
        document_title: 'GB/T 4208-2017',
        doc_type: 'standard',
        collection_name: '标准库',
        relevance_score: 0.98,
        candidate_confidence: 'high',
        evidence: [
          { content: '对外壳顶部低于 0.85m 的，外壳最高点应低于水面 0.15m 以上；对外壳总高等于或高于 0.85m 的，外壳最低点应低于水面 1m 以下，且外壳最高点应低于水面 0.15m 以上，试验时间 30min。', score: 0.97 },
        ],
        top_evidence: [
          { content: '对外壳顶部低于 0.85m 的，外壳最高点应低于水面 0.15m 以上；对外壳总高等于或高于 0.85m 的，外壳最低点应低于水面 1m 以下，且外壳最高点应低于水面 0.15m 以上，试验时间 30min。', score: 0.97 },
        ],
      },
    ],
  };

  const decision = service._getResponseModeDecision(toolResult);
  const injection = service.buildEvidenceInjection(toolResult, { maxTokens: 4000 });

  assert(decision.mode === 'answer_with_citation', 'M.1 mode = answer_with_citation');
  assert(!decision.isShortCircuit, 'M.2 非短路模式');
  assertContains(decision.evidenceInjection || '', '强制回答约束：引用回答模式', 'M.3 决策注入含引用回答约束');
  assertContains(injection, 'GB/T 4208-2017', 'M.4 注入含文档名');
  assertContains(injection, '试验时间 30min', 'M.5 注入含关键参数原文');
  assertContains(injection, 'parameter_evidence_closure', 'M.6 注入含 reason code');
}

// ============================================================
// 运行
// ============================================================

console.log('╔══════════════════════════════════════╗');
console.log('║  ChatService Prompt 注入测试 (真实) ║');
console.log('╚══════════════════════════════════════╝');

testCaseA_RealSingleDocumentConstraint();
testCaseB_RealIdentityOnlyGuardInjection();
testCaseC_RealPureLocateNoGuard();
testCaseD_RealChunkEvidenceNoGuard();
testCaseE_RealFailedToolResultEmptyOutput();
testCaseF_RealSingleDocumentFullPath();
testCaseG_ShouldAutoChainQuerySignalOverride();
testCaseH_ShouldAutoChainMixedIntent();
testCaseI_AutoContentChainInjection();
testCaseJ_AutoContentChainEmptyFallback();
testCaseK_CrossDocumentBridge();
testCaseL_StageFieldsPropagation();
testCaseM_VerifyFactSupportedConsumesCitationMode();

console.log(`\n${'='.repeat(40)}`);
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) process.exit(1);
