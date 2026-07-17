/**
 * Chat-service 消费层联调测试
 *
 * audit-round04 变更项 D：
 * 验证 chat-service 已按 workflow_action 组织行为，suggested_response_mode
 * 兼容字段已从 tool-manager 输出面物理删除，不再作为正常输入面。
 *
 * 测试 _getResponseModeDecision / _resolveConstraintMode /
 * _buildResponseModeConstraint 在新路径下的行为。
 *
 * 运行：node tests/chat-service-consumption.test.js
 */

import { ExpertChatService } from '../lib/chat-service.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${label}`); }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${label} | expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`); }
}

// 最小化实例（mock db 仅避免构造函数崩溃，不测试 DB 路径）
function makeChatService() {
  const mockDb = {
    getModel: () => ({}),  // 返回空对象，避免 undefined 崩溃
  };
  return new ExpertChatService(mockDb, 'test-expert');
}

// ============================================================
// CS-01: workflow_action=return_document_candidates → 短路
// ============================================================

function testReturnDocumentCandidatesShortCircuits() {
  console.log('\n📋 CS-01: workflow_action=return_document_candidates → 短路 LLM');

  const svc = makeChatService();
  const result = {
    success: true,
    workflow_action: 'return_document_candidates',
    suggested_response_mode: 'candidate_list',
    documents: [
      { document_id: 'd1', document_title: 'Doc A', doc_type: 'contract', collection_name: 'Col', relevance_score: 80, candidate_confidence: 'high', top_evidence: [{ content: '摘要片段', score: 0.8 }] },
      { document_id: 'd2', document_title: 'Doc B', doc_type: 'contract', collection_name: 'Col', relevance_score: 75, candidate_confidence: 'high', top_evidence: [{ content: '另一摘要', score: 0.75 }] },
    ],
    evidence_sufficiency: 'medium',
    strategy: 'document_first',
  };

  const decision = svc._getResponseModeDecision(result);

  assert(decision.isShortCircuit, 'CS-01.1 isShortCircuit=true');
  assert(decision.directResponse !== null, 'CS-01.2 has directResponse');
  assert(decision.directResponse.includes('Doc A'), 'CS-01.3 response contains Doc A');
  assert(decision.directResponse.includes('Doc B'), 'CS-01.4 response contains Doc B');
  assertEqual(decision.evidenceInjection, null, 'CS-01.5 no evidenceInjection on short circuit');
}

// ============================================================
// CS-02: workflow_action=answer_with_ranked_chunks → 证据注入
// ============================================================

function testAnswerWithRankedChunksInjectsEvidence() {
  console.log('\n📋 CS-02: workflow_action=answer_with_ranked_chunks → evidenceInjection');

  const svc = makeChatService();
  const result = {
    success: true,
    workflow_action: 'answer_with_ranked_chunks',
    suggested_response_mode: 'answer_with_citation',
    documents: [
      { document_id: 'd1', document_title: 'GB/T 4208', doc_type: 'standard', collection_name: '标准库', relevance_score: 95, candidate_confidence: 'high', evidence_count: 3, top_evidence: [{ content: 'IPX5试验条件：喷嘴内径6.3mm，水流量12.5L/min', score: 0.92 }] },
    ],
    evidence_sufficiency: 'strong',
    strategy: 'document_first',
    reason_codes: [],
  };

  const decision = svc._getResponseModeDecision(result);

  assert(!decision.isShortCircuit, 'CS-02.1 not short circuit');
  assertEqual(decision.directResponse, null, 'CS-02.2 no directResponse');
  assert(decision.evidenceInjection !== null, 'CS-02.3 has evidenceInjection');
  assert(decision.evidenceInjection.length > 0, 'CS-02.4 evidenceInjection non-empty');
  assert(decision.evidenceInjection.includes('GB/T 4208') || decision.evidenceInjection.includes('IPX5'), 'CS-02.5 contains evidence content');
}

// ============================================================
// CS-03: workflow_action=decline → 保守回答约束
// ============================================================

function testDeclineInsufficientEvidenceConservativeAnswer() {
  console.log('\n📋 CS-03: workflow_action=decline_due_to_insufficient_evidence → conservative_answer');

  const svc = makeChatService();
  const result = {
    success: true,
    workflow_action: 'decline_due_to_insufficient_evidence',
    suggested_response_mode: 'conservative_answer',
    documents: [],
    evidence_sufficiency: 'none',
    strategy: 'degrade',
    reason_codes: ['no_candidates'],
  };

  const decision = svc._getResponseModeDecision(result);

  assert(!decision.isShortCircuit, 'CS-03.1 not short circuit');
  assert(decision.evidenceInjection !== null, 'CS-03.2 has evidenceInjection');
  // 保守回答约束应包含"依据有限"等关键词
  assert(
    decision.evidenceInjection.includes('依据有限') || decision.evidenceInjection.includes('保守回答'),
    'CS-03.3 contains conservative constraint'
  );
}

// ============================================================
// CS-04: workflow_action=ask_for_clarification → 澄清约束
// ============================================================

function testAskForClarificationConstraint() {
  console.log('\n📋 CS-04: workflow_action=ask_for_clarification → 澄清约束');

  const svc = makeChatService();
  const result = {
    success: true,
    workflow_action: 'ask_for_clarification',
    suggested_response_mode: 'clarify',
    documents: [],
    evidence_sufficiency: 'none',
    strategy: 'none',
    reason_codes: ['empty_query'],
  };

  const decision = svc._getResponseModeDecision(result);

  assert(!decision.isShortCircuit, 'CS-04.1 not short circuit');
  assert(decision.evidenceInjection !== null, 'CS-04.2 has evidenceInjection');
  assert(decision.evidenceInjection.includes('澄清'), 'CS-04.3 contains clarify constraint');
}

// ============================================================
// CS-05: 无 workflow_action（异常/旧数据路径）→ 防御性兜底
// ============================================================

function testNoWorkflowActionDefensiveFallback() {
  console.log('\n📋 CS-05: 无 workflow_action → 防御性兜底（conservative_answer）');

  const svc = makeChatService();
  const result = {
    success: true,
    // audit-round04 变更项 A：suggested_response_mode 已从 tool-manager 输出面物理删除，
    // 此用例验证异常/旧数据路径的防御性兜底行为。
    documents: [
      { document_id: 'd1', document_title: 'Doc X', doc_type: 'contract', collection_name: 'Col', relevance_score: 90, candidate_confidence: 'high' },
    ],
    evidence_sufficiency: 'medium',
    strategy: 'document_first',
  };

  const decision = svc._getResponseModeDecision(result);

  // 无 workflow_action 时不再短路 LLM，改为 conservative_answer + 证据注入兜底
  assert(!decision.isShortCircuit, 'CS-05.1 not short circuit (defensive fallback)');
  assertEqual(decision.directResponse, null, 'CS-05.2 no directResponse');
  assert(decision.evidenceInjection !== null, 'CS-05.3 has evidenceInjection');
  assert(decision.evidenceInjection.includes('依据有限') || decision.evidenceInjection.includes('保守回答'),
    'CS-05.4 falls back to conservative constraint');
}

// ============================================================
// CS-08: action/mode 冲突 → action 胜出（P0 补强测试）
// ============================================================

function testActionModeConflictActionWins() {
  console.log('\n📋 CS-08: workflow_action 与旧 suggested_response_mode 冲突 → action 胜出');

  const svc = makeChatService();
  // 构造真正的冲突输入：
  // workflow_action=return_document_candidates（应短路 LLM，输出候选列表）
  // 但旧 suggested_response_mode=conservative_answer（应保守回答）
  const result = {
    success: true,
    workflow_action: 'return_document_candidates',
    // 即使旧兼容字段还在（防御测试），action 必须胜出
    suggested_response_mode: 'conservative_answer',
    documents: [
      { document_id: 'd1', document_title: 'Contract Alpha', doc_type: 'contract', collection_name: 'Col', relevance_score: 90, candidate_confidence: 'high', top_evidence: [{ content: '违约金条款摘要', score: 0.85 }] },
    ],
    evidence_sufficiency: 'medium',
    strategy: 'document_first',
  };

  const decision = svc._getResponseModeDecision(result);

  // 关键断言：action 胜出 → 短路 LLM，输出候选列表
  assert(decision.isShortCircuit, 'CS-08.1 action wins: isShortCircuit=true');
  assert(decision.directResponse !== null, 'CS-08.2 action wins: has directResponse');
  assert(decision.directResponse.includes('Contract Alpha'), 'CS-08.3 action wins: contains candidate doc');
  // 不应进入 conservative_answer 路径
  assert(!decision.evidenceInjection?.includes('依据有限'),
    'CS-08.4 action wins: NOT conservative (would contain 依据有限)');
}

// ============================================================
// CS-06: _resolveConstraintMode 映射表验证
// ============================================================

function testResolveConstraintModeMapping() {
  console.log('\n📋 CS-06: _resolveConstraintMode 映射表');

  const svc = makeChatService();

  assertEqual(svc._resolveConstraintMode({ workflow_action: 'return_document_candidates' }), 'candidate_list', 'CS-06.1 candidates → candidate_list');
  assertEqual(svc._resolveConstraintMode({ workflow_action: 'ask_for_clarification' }), 'clarify', 'CS-06.2 clarify → clarify');
  assertEqual(svc._resolveConstraintMode({ workflow_action: 'decline_due_to_insufficient_evidence' }), 'conservative_answer', 'CS-06.3 decline → conservative');
  assertEqual(svc._resolveConstraintMode({ workflow_action: 'answer_with_ranked_chunks', evidence_sufficiency: 'strong' }), 'answer_with_citation', 'CS-06.4 strong → answer_with_citation');
  assertEqual(svc._resolveConstraintMode({ workflow_action: 'answer_with_ranked_chunks', evidence_sufficiency: 'weak' }), 'direct_answer', 'CS-06.5 weak → direct_answer');
  // 无 workflow_action → 防御性兜底 conservative_answer（audit-round04 变更项 A）
  assertEqual(svc._resolveConstraintMode({ suggested_response_mode: 'conservative_answer' }), 'conservative_answer', 'CS-06.6 no action → defensive conservative default');
}

// ============================================================
// CS-07: _buildResponseModeConstraint 对每种模式生成约束
// ============================================================

function testBuildResponseModeConstraint() {
  console.log('\n📋 CS-07: _buildResponseModeConstraint 对每种模式生成约束');

  const svc = makeChatService();

  const clarifyConstraint = svc._buildResponseModeConstraint('clarify');
  assert(clarifyConstraint.includes('澄清'), 'CS-07.1 clarify constraint');

  const candidateConstraint = svc._buildResponseModeConstraint('candidate_list');
  assert(candidateConstraint.includes('候选'), 'CS-07.2 candidate constraint');

  const conservativeConstraint = svc._buildResponseModeConstraint('conservative_answer');
  assert(conservativeConstraint.includes('依据有限'), 'CS-07.3 conservative constraint');

  const defaultConstraint = svc._buildResponseModeConstraint('answer_with_citation');
  assertEqual(defaultConstraint, '', 'CS-07.4 answer_with_citation → no constraint (default)');
}

// ============================================================
// 运行
// ============================================================

function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Chat-Service 消费层联调测试        ║');
  console.log('║  (audit-round04 变更项 D)           ║');
  console.log('╚══════════════════════════════════════╝');

  testReturnDocumentCandidatesShortCircuits();
  testAnswerWithRankedChunksInjectsEvidence();
  testDeclineInsufficientEvidenceConservativeAnswer();
  testAskForClarificationConstraint();
  testNoWorkflowActionDefensiveFallback();
  testResolveConstraintModeMapping();
  testBuildResponseModeConstraint();
  testActionModeConflictActionWins();

  console.log(`\n========================================`);
  console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
  console.log(`========================================`);

  if (failed > 0) process.exit(1);
}

main();
