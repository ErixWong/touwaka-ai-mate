/**
 * Document Retrieval 集成测试 — 桥接层行为验证
 *
 * audit-round02 变更项 C：
 * 验证新 workflow + 真实 DocumentEvidencePacker 组合后的行为正确性，
 * 重点测试 packet → action 映射、evidence_sufficiency 判定、
 * verify_fact verdict 映射。
 *
 * 运行：node tests/document-retrieval-integration.test.js
 */

import DocumentRetrievalWorkflow from '../lib/document-retrieval-workflow.js';
import DocumentEvidencePacker from '../lib/document-evidence-packer.js';

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

// ============================================================
// Helpers
// ============================================================

function makeChunk(docId, content, score) {
  return {
    chunk_id: `c_${docId}_${Math.random().toString(36).substring(2, 6)}`,
    document_id: docId,
    document_title: `Doc-${docId}`,
    doc_type: 'contract',
    collection_id: 'col-1',
    revision_id: 'r1',
    outline_id: null,
    seq: 1,
    chunk_title: '',
    content,
    score,
  };
}

function makeCandidate(docId, title, relevance) {
  return {
    document_id: docId,
    document_title: title,
    doc_type: 'contract',
    collection_id: 'col-1',
    collection_name: '合同库',
    relevance_score: relevance,
    candidate_confidence: relevance >= 70 ? 'high' : 'low',
  };
}

function makeMockAtomicTools(metaDocs, scopedChunks) {
  return {
    searchDocumentsByMetadata: async () => ({
      success: true,
      documents: metaDocs,
      total: metaDocs.length,
      matched_by: 'title_metadata',
    }),
    searchChunksInDocument: async () => ({
      success: true,
      chunks: scopedChunks,
      total: scopedChunks.length,
    }),
    searchChunksGlobally: async () => ({
      success: true,
      chunks: [],
      total: 0,
    }),
    rankChunksForQuestion: (p) => ({ success: true, chunks: p.chunks || [], total: (p.chunks || []).length }),
    resolveDocumentsFromChunks: async () => ({ success: true, documents: [], total: 0 }),
  };
}

function makeMockAccessService() {
  return { getAccessibleCollectionIds: async () => ['col-1'] };
}

function makeMockDecisionService(strategy = 'document_first') {
  return {
    analyze: () => ({
      intent: 'factual_lookup',
      anchor_strength: 'medium',
      confidence: 0.7,
      recommended_strategy: strategy,
      reason_codes: [],
    }),
    hints: () => ({
      user_query: 'test',
      document_hints: [],
      topic_terms: [],
      content_terms: ['test'],
      has_explicit_document_anchor: false,
      intent_hint: 'factual_lookup',
      initial_strategy_hint: strategy,
      analysis: {},
    }),
  };
}

// ============================================================
// INT-01: 单文档 + 强证据 → answer_with_ranked_chunks
// ============================================================

async function testStrongEvidenceSingleDoc() {
  console.log('\n📋 INT-01: 单文档 + 强证据（3 chunks, max≥0.8）→ answer_with_ranked_chunks');

  const chunks = [
    makeChunk('d1', '合同条款第3条明确约定：违约责任按日万分之五计算。', 0.92),
    makeChunk('d1', '违约金计算方式：逾期付款金额 × 0.05% × 逾期天数。', 0.85),
    makeChunk('d1', '双方确认上述违约金标准为协商结果。', 0.81),
  ];
  const candidates = [makeCandidate('d1', '施工合同-2024', 95)];

  const wf = new DocumentRetrievalWorkflow(null, null, {
    atomicTools: makeMockAtomicTools(candidates, chunks),
    accessService: makeMockAccessService(),
    decisionService: makeMockDecisionService(),
    packer: new DocumentEvidencePacker(),
  });

  const r = await wf.runAnswerQuestion({ query: '违约金计算标准', user_id: 'u1' });

  assert(r.success, 'INT-01.1 success');
  assertEqual(r.action, 'answer_with_ranked_chunks', 'INT-01.2 action=answer_with_ranked_chunks');
  assertEqual(r.evidence_sufficiency, 'strong', 'INT-01.3 sufficiency=strong');
  assertEqual(r.documents.length, 1, 'INT-01.4 1 doc');
  assert(r.documents[0].evidence_count >= 3, 'INT-01.5 ≥3 evidence items');
  assert(r.steps.map(s => s.step).includes('evidence_packing'), 'INT-01.6 evidence_packing visible');
  // audit-round04 变更项 A：should_clarify 已删除，用 workflow_action 替代
  assertEqual(r.action, 'answer_with_ranked_chunks', 'INT-01.7 action not ask_for_clarification');
}

// ============================================================
// INT-02: 多文档 + 弱证据 → return_document_candidates
// ============================================================

async function testWeakEvidenceMultipleDocs() {
  console.log('\n📋 INT-02: 多文档 + 弱证据（2 chunks, max<0.6）→ return_document_candidates');

  const chunks = [
    makeChunk('d1', '提及相关概念但无明确依据', 0.45),
    makeChunk('d2', '另一文档也涉及该主题', 0.42),
  ];
  const candidates = [
    makeCandidate('d1', '合同A', 80),
    makeCandidate('d2', '合同B', 75),
    makeCandidate('d3', '合同C', 70),
  ];

  const wf = new DocumentRetrievalWorkflow(null, null, {
    atomicTools: makeMockAtomicTools(candidates, chunks),
    accessService: makeMockAccessService(),
    decisionService: makeMockDecisionService(),
    packer: new DocumentEvidencePacker(),
  });

  const r = await wf.runAnswerQuestion({ query: '模糊查询', user_id: 'u1' });

  assert(r.success, 'INT-02.1 success');
  assertEqual(r.action, 'return_document_candidates', 'INT-02.2 action=return_document_candidates');
  assertEqual(r.evidence_sufficiency, 'weak', 'INT-02.3 sufficiency=weak');
  assert(r.documents.length >= 3, 'INT-02.4 ≥3 candidates');
}

// ============================================================
// INT-03: 零文档零证据 → decline
// ============================================================

async function testNoEvidenceDecline() {
  console.log('\n📋 INT-03: 零文档零证据 → decline_due_to_insufficient_evidence');

  const wf = new DocumentRetrievalWorkflow(null, null, {
    atomicTools: makeMockAtomicTools([], []),
    accessService: makeMockAccessService(),
    decisionService: makeMockDecisionService(),
    packer: new DocumentEvidencePacker(),
  });

  const r = await wf.runAnswerQuestion({ query: '不存在的内容XYZ', user_id: 'u1' });

  assert(r.success, 'INT-03.1 success (decline is success)');
  assertEqual(r.action, 'decline_due_to_insufficient_evidence', 'INT-03.2 action=decline');
  assertEqual(r.evidence_sufficiency, 'none', 'INT-03.3 sufficiency=none');
  assertEqual(r.documents.length, 0, 'INT-03.4 0 docs');
}

// ============================================================
// INT-04: verify_fact — strong → supported（真实 packer 映射）
// ============================================================

async function testVerifyFactStrongToSupported() {
  console.log('\n📋 INT-04: verify_fact strong → supported（真实 packer 判定）');

  const chunks = [
    makeChunk('d1', '根据GB/T 4208-2017标准，IPX5防护等级要求喷嘴内径6.3mm，水流量12.5L/min。', 0.93),
    makeChunk('d1', '试验条件：水温为常温，试验持续时间至少3分钟。', 0.86),
    makeChunk('d1', 'IPX5试验后，外壳内部不应进水。', 0.82),
  ];
  const candidates = [makeCandidate('d1', 'GB/T 4208-2017 外壳防护等级', 95)];

  const wf = new DocumentRetrievalWorkflow(null, null, {
    atomicTools: makeMockAtomicTools(candidates, chunks),
    accessService: makeMockAccessService(),
    decisionService: makeMockDecisionService(),
    packer: new DocumentEvidencePacker(),
  });

  const r = await wf.runVerifyFact({ query: 'IPX5试验条件要求喷嘴内径6.3mm', user_id: 'u1' });

  assertEqual(r.verdict, 'supported', 'INT-04.1 verdict=supported');
  assert(r.supporting_evidence.length > 0, 'INT-04.2 has supporting evidence');
  assertEqual(r.action, 'answer_with_ranked_chunks', 'INT-04.3 action');
  assert(r.supporting_evidence[0].document_id, 'INT-04.4 evidence has document_id');
  assert(r.supporting_evidence[0].score > 0.8, 'INT-04.5 evidence score preserved');
}

// ============================================================
// INT-05: verify_fact — weak → insufficient_evidence
// ============================================================

async function testVerifyFactWeakToInsufficient() {
  console.log('\n📋 INT-05: verify_fact weak → insufficient_evidence（真实 packer 判定）');

  const chunks = [
    makeChunk('d1', '可能相关的内容片段', 0.35),
  ];
  const candidates = [makeCandidate('d1', '某文档', 40)];

  const wf = new DocumentRetrievalWorkflow(null, null, {
    atomicTools: makeMockAtomicTools(candidates, chunks),
    accessService: makeMockAccessService(),
    decisionService: makeMockDecisionService(),
    packer: new DocumentEvidencePacker(),
  });

  const r = await wf.runVerifyFact({ query: '不存在的事实主张', user_id: 'u1' });

  assertEqual(r.verdict, 'insufficient_evidence', 'INT-05.1 verdict=insufficient_evidence');
  assertEqual(r.supporting_evidence.length, 0, 'INT-05.2 no supporting evidence');
  assertEqual(r.action, 'decline_due_to_insufficient_evidence', 'INT-05.3 action=decline');
}

// ============================================================
// INT-06: 中等证据 + 单文档 → answer_with_ranked_chunks
// ============================================================

async function testMediumEvidenceSingleDoc() {
  console.log('\n📋 INT-06: 中等证据（max≥0.6, ≥1 chunk）→ answer_with_ranked_chunks');

  const chunks = [
    makeChunk('d1', '合同约定交货期为2024年6月30日前。', 0.72),
    makeChunk('d1', '逾期交货按合同总额的0.1%每日计算违约金。', 0.68),
  ];
  const candidates = [makeCandidate('d1', '供货合同', 85)];

  const wf = new DocumentRetrievalWorkflow(null, null, {
    atomicTools: makeMockAtomicTools(candidates, chunks),
    accessService: makeMockAccessService(),
    decisionService: makeMockDecisionService(),
    packer: new DocumentEvidencePacker(),
  });

  const r = await wf.runAnswerQuestion({ query: '交货期约定', user_id: 'u1' });

  assert(r.success, 'INT-06.1 success');
  assertEqual(r.action, 'answer_with_ranked_chunks', 'INT-06.2 action=answer_with_ranked_chunks');
  assertEqual(r.evidence_sufficiency, 'medium', 'INT-06.3 sufficiency=medium');
  assert(r.documents[0].top_evidence.length === 2, 'INT-06.4 2 evidence items');
}

// ============================================================
// INT-07: 决策直接建议 clarify → ask_for_clarification
// ============================================================

async function testDecisionClarify() {
  console.log('\n📋 INT-07: decision 建议 clarify → ask_for_clarification');

  const wf = new DocumentRetrievalWorkflow(null, null, {
    atomicTools: makeMockAtomicTools([], []),
    accessService: makeMockAccessService(),
    decisionService: makeMockDecisionService('clarify'),
    packer: new DocumentEvidencePacker(),
  });

  const r = await wf.runAnswerQuestion({ query: '帮我看看', user_id: 'u1' });

  assertEqual(r.action, 'decline_due_to_insufficient_evidence', 'INT-07.1 clarify→decline');
  assertEqual(r.strategy, 'degrade', 'INT-07.2 strategy=degrade');
  assert(r.reason_codes.includes('ambiguous_query'), 'INT-07.3 ambiguous_query');
}

// ============================================================
// 运行
// ============================================================

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Document Retrieval 集成测试        ║');
  console.log('║  (audit-round02 变更项 C)           ║');
  console.log('╚══════════════════════════════════════╝');

  await testStrongEvidenceSingleDoc();
  await testWeakEvidenceMultipleDocs();
  await testNoEvidenceDecline();
  await testVerifyFactStrongToSupported();
  await testVerifyFactWeakToInsufficient();
  await testMediumEvidenceSingleDoc();
  await testDecisionClarify();

  console.log(`\n========================================`);
  console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
  console.log(`========================================`);

  if (failed > 0) process.exit(1);
}

main();
