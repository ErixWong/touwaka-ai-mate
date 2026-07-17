/**
 * DocumentRetrievalWorkflow 编排测试
 *
 * 验证 find_document / answer_question / verify_fact 三个 workflow 的
 * 步骤序列、动作映射、权限门控。使用 DI mock 不依赖数据库。
 *
 * audit-round01 Phase 2 交付物。
 * 运行：node tests/document-retrieval-workflow.test.js
 */

import DocumentRetrievalWorkflow from '../lib/document-retrieval-workflow.js';

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
// Mock 工厂
// ============================================================

function makeMockAtomicTools(overrides = {}) {
  return {
    searchDocumentsByMetadata: async (p) => (overrides.metaResult || { success: true, documents: [], total: 0, matched_by: 'title_metadata' }),
    searchChunksInDocument: async (p) => (overrides.scopedResult || { success: true, chunks: [], total: 0 }),
    searchChunksGlobally: async (p) => (overrides.globalResult || { success: true, chunks: [], total: 0 }),
    rankChunksForQuestion: (p) => {
      if (overrides.rankResult) return overrides.rankResult;
      return { success: true, chunks: p.chunks || [], total: (p.chunks || []).length };
    },
    resolveDocumentsFromChunks: async (p) => (overrides.resolveResult || { success: true, documents: [], total: 0 }),
  };
}

function makeMockAccessService(overrides = {}) {
  const defaultIds = overrides.accessibleIds || ['col-1'];
  return { getAccessibleCollectionIds: async () => defaultIds };
}

function makeMockDecisionService(overrides = {}) {
  return {
    hints: (q, ctx) => (overrides.hints || {
      user_query: q || '',
      document_hints: [],
      topic_terms: [],
      content_terms: [],
      has_explicit_document_anchor: false,
      intent_hint: 'ambiguous',
      initial_strategy_hint: 'chunk_first',
      analysis: {},
    }),
    // audit-round02 变更项 A：runAnswerQuestion 新增决策分析调用
    analyze: (q, ctx) => (overrides.analyzeResult || {
      intent: 'informational',
      anchor_strength: 'medium',
      confidence: 0.6,
      recommended_strategy: 'document_first',
      reason_codes: [],
    }),
  };
}

function makeWorkflow(opts = {}) {
  return new DocumentRetrievalWorkflow(null, null, {
    atomicTools: opts.atomicTools || makeMockAtomicTools(),
    accessService: opts.accessService || makeMockAccessService(),
    decisionService: opts.decisionService || makeMockDecisionService(),
    packer: opts.packer || null,
  });
}

// ============================================================
// runFindDocument
// ============================================================

async function testFindDocumentMetadataHit() {
  console.log('\n📋 WF-01: find_document — metadata 命中 → return_document_candidates');

  const mockMeta = makeMockAtomicTools({
    metaResult: {
      success: true,
      documents: [
        { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 95 },
      ],
      total: 1,
      matched_by: 'title_metadata',
    },
    scopedResult: { success: true, chunks: [{ chunk_id: 'c1', content: 'IPX5试验...', score: 0.85, document_id: 'd1', doc_type: 'standard', collection_id: 'col-1' }], total: 1 },
  });
  const wf = makeWorkflow({ atomicTools: mockMeta });

  const r = await wf.runFindDocument({ query: 'GB/T 4208', user_id: 'u1' });

  assert(r.success, 'WF-01.1 success=true');
  assertEqual(r.action, 'return_document_candidates', 'WF-01.2 action=return_document_candidates');
  assertEqual(r.total_candidates, 1, 'WF-01.3 1 candidate');
  assertEqual(r.strategy, 'metadata_search', 'WF-01.4 strategy=metadata_search');
  assert(r.steps.length >= 2, 'WF-01.5 >=2 steps（hints + metadata）');
  assertEqual(r.steps[0].step, 'hints', 'WF-01.6 step0=hints');
  assertEqual(r.steps[1].step, 'search_documents_by_metadata', 'WF-01.7 step1=search');
}

async function testFindDocumentAttachmentFallback() {
  console.log('\n📋 WF-02: find_document — metadata 0 → 附件名兜底');

  const emptyMetaResult = { success: true, documents: [], total: 0, matched_by: 'title_metadata' };
  const attachResult = {
    success: true,
    documents: [
      { document_id: 'd2', document_title: 'Intake-001', best_identity_label: '施工合同附件A.pdf', matched_attachment: '施工合同附件A.pdf', doc_type: 'contract', collection_name: '合同库' },
    ],
    total: 1,
    matched_by: 'attachment_filename',
  };

  let callCount = 0;
  const mockAtomic = makeMockAtomicTools({ metaResult: emptyMetaResult });
  mockAtomic.searchDocumentsByMetadata = async (p) => {
    callCount++;
    if (callCount === 1) return emptyMetaResult;
    return attachResult;
  };
  const wf = makeWorkflow({ atomicTools: mockAtomic });

  const r = await wf.runFindDocument({ query: '施工合同', user_id: 'u1' });

  assert(r.success, 'WF-02.1 success=true');
  assertEqual(r.total_candidates, 1, 'WF-02.2 1 candidate（附件兜底）');
  assertEqual(r.strategy, 'attachment_filename_fallback', 'WF-02.3 strategy=attachment_filename_fallback');
  assert(r.reason_codes.includes('attachment_filename_fallback'), 'WF-02.4 attachment_filename_fallback code');
  assertEqual(r.candidates[0].identity_source, 'attachment_filename_match', 'WF-02.5 attachment 来源');
  assert(r.steps.some(s => s.step === 'search_by_attachment_filename'), 'WF-02.6 含附件搜索步骤');
}

async function testFindDocumentContentBridge() {
  console.log('\n📋 WF-03: find_document — metadata + 附件均 0 → 内容桥接反查');

  const mockAtomic = makeMockAtomicTools({
    metaResult: { success: true, documents: [], total: 0 },
    globalResult: {
      success: true,
      chunks: [
        { chunk_id: 'c1', document_id: 'd3', document_title: '内部制度', content: '巡检周期每周一次', score: 0.88, doc_type: 'policy', collection_id: 'col-1' },
      ],
      total: 1,
    },
    resolveResult: {
      success: true,
      documents: [
        { document_id: 'd3', document_title: '内部制度 v3', doc_type: 'policy', collection_id: 'col-1', collection_name: '内部制度库', chunk_count: 1, max_chunk_score: 0.88 },
      ],
      total: 1,
    },
  });
  const mockDec = makeMockDecisionService({
    hints: { user_query: '巡检周期', document_hints: [], topic_terms: ['巡检', '周期'], content_terms: ['巡检', '周期'], has_explicit_document_anchor: false, intent_hint: 'content_exploration', initial_strategy_hint: 'chunk_first', analysis: {} },
  });
  const wf = makeWorkflow({ atomicTools: mockAtomic, decisionService: mockDec });

  const r = await wf.runFindDocument({ query: '巡检周期', user_id: 'u1' });

  assert(r.success, 'WF-03.1 success=true');
  assertEqual(r.total_candidates, 1, 'WF-03.2 内容桥接命中');
  assertEqual(r.strategy, 'content_bridge', 'WF-03.3 strategy=content_bridge');
  assert(r.reason_codes.includes('content_bridge'), 'WF-03.4 content_bridge code');
  assertEqual(r.candidates[0].identity_source, 'content_bridge', 'WF-03.5 content_bridge 来源');
  assert(r.steps.some(s => s.step === 'search_chunks_globally'), 'WF-03.6 含全局 chunk 搜索');
  assert(r.steps.some(s => s.step === 'resolve_documents_from_chunks'), 'WF-03.7 含 chunk→doc 解析');
}

async function testFindDocumentZeroResult() {
  console.log('\n📋 WF-04: find_document — 三步全空 → ask_for_clarification');

  const mockAtomic = makeMockAtomicTools({
    metaResult: { success: true, documents: [], total: 0 },
    globalResult: { success: true, chunks: [], total: 0 },
  });
  const wf = makeWorkflow({ atomicTools: mockAtomic });

  const r = await wf.runFindDocument({ query: '不存在的文档', user_id: 'u1' });

  assert(r.success, 'WF-04.1 success=true（澄清不是失败）');
  assertEqual(r.action, 'ask_for_clarification', 'WF-04.2 action=ask_for_clarification');
  assertEqual(r.total_candidates, 0, 'WF-04.3 0 candidates');
  assert(r.reason_codes.includes('no_candidates'), 'WF-04.4 no_candidates code');
}

async function testFindDocumentCollectionNotAccessible() {
  console.log('\n📋 WF-05: find_document — 指定集合不可访问 → clarify');

  const mockAccess = makeMockAccessService({ accessibleIds: ['col-x'] });
  const wf = makeWorkflow({ accessService: mockAccess });

  const r = await wf.runFindDocument({ query: 'test', user_id: 'u1', collection_id: 'col-secret' });

  assertEqual(r.action, 'ask_for_clarification', 'WF-05.1 action=ask_for_clarification');
  assert(r.reason_codes.includes('collection_not_accessible'), 'WF-05.2 collection_not_accessible');
}

async function testFindDocumentEmptyQuery() {
  console.log('\n📋 WF-06: find_document — 空 query → clarify');

  const wf = makeWorkflow();
  const r = await wf.runFindDocument({ query: '', user_id: 'u1' });

  assertEqual(r.action, 'ask_for_clarification', 'WF-06.1 clarify');
  assert(r.reason_codes.includes('empty_query'), 'WF-06.2 empty_query');
}

// ============================================================
// runAnswerQuestion（audit-round02 变更项 A：从 retrievalService 迁出）
// ============================================================

async function testAnswerQuestionSufficientEvidence() {
  console.log('\n📋 WF-07: answer_question — 强证据 → answer_with_ranked_chunks');

  const mockAtomic = makeMockAtomicTools({
    metaResult: {
      success: true,
      documents: [
        { document_id: 'd1', document_title: 'GB/T 4208', doc_type: 'standard', collection_name: '标准库', relevance_score: 95 },
      ],
      total: 1,
      matched_by: 'title_metadata',
    },
    scopedResult: {
      success: true,
      chunks: [
        { chunk_id: 'c1', document_id: 'd1', document_title: 'GB/T 4208', doc_type: 'standard', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 1, chunk_title: '', content: 'IPX5试验：喷嘴内径6.3mm', score: 0.92 },
        { chunk_id: 'c2', document_id: 'd1', document_title: 'GB/T 4208', doc_type: 'standard', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 2, chunk_title: '', content: '水流量12.5L/min', score: 0.88 },
        { chunk_id: 'c3', document_id: 'd1', document_title: 'GB/T 4208', doc_type: 'standard', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 3, chunk_title: '', content: '试验持续时间3min', score: 0.82 },
        { chunk_id: 'c4', document_id: 'd1', document_title: 'GB/T 4208', doc_type: 'standard', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 4, chunk_title: '', content: '防护等级IPX5', score: 0.78 },
      ],
      total: 4,
    },
  });
  const mockDec = makeMockDecisionService({
    analyzeResult: { recommended_strategy: 'document_first', intent: 'factual_lookup', anchor_strength: 'strong', confidence: 0.85, reason_codes: [] },
  });
  const wf = makeWorkflow({ atomicTools: mockAtomic, decisionService: mockDec });

  const r = await wf.runAnswerQuestion({ query: 'IPX5试验条件', user_id: 'u1' });

  assert(r.success, 'WF-07.1 success=true');
  assertEqual(r.action, 'answer_with_ranked_chunks', 'WF-07.2 action=answer_with_ranked_chunks');
  assertEqual(r.strategy, 'document_first', 'WF-07.3 strategy preserved');
  assert(r.documents.length >= 1, 'WF-07.4 has documents');
  assert(r.steps.length >= 4, 'WF-07.5 explicit steps (decision+meta+recall+pack)');
  // 验证 steps 已显式化
  const stepNames = r.steps.map(s => s.step);
  assert(stepNames.includes('decision'), 'WF-07.6 decision step visible');
  assert(stepNames.includes('search_documents_by_metadata'), 'WF-07.7 metadata step visible');
  assert(stepNames.includes('search_chunks_in_document'), 'WF-07.8 scoped_recall step visible');
  assert(stepNames.includes('evidence_packing'), 'WF-07.9 evidence_packing step visible');
}

async function testAnswerQuestionCandidateList() {
  console.log('\n📋 WF-08: answer_question — 多候选弱证据 → return_document_candidates');

  const mockAtomic = makeMockAtomicTools({
    metaResult: {
      success: true,
      documents: [
        { document_id: 'd1', document_title: 'Doc A', doc_type: 'contract', collection_name: '合同库', relevance_score: 80 },
        { document_id: 'd2', document_title: 'Doc B', doc_type: 'contract', collection_name: '合同库', relevance_score: 75 },
        { document_id: 'd3', document_title: 'Doc C', doc_type: 'contract', collection_name: '合同库', relevance_score: 70 },
      ],
      total: 3,
    },
    scopedResult: {
      success: true,
      chunks: [
        { chunk_id: 'c1', document_id: 'd1', document_title: 'Doc A', doc_type: 'contract', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 1, chunk_title: '', content: 'some content', score: 0.45 },
        { chunk_id: 'c2', document_id: 'd2', document_title: 'Doc B', doc_type: 'contract', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 1, chunk_title: '', content: 'other content', score: 0.42 },
      ],
      total: 2,
    },
  });
  const mockDec = makeMockDecisionService({
    analyzeResult: { recommended_strategy: 'document_first', intent: 'informational', anchor_strength: 'weak', confidence: 0.4, reason_codes: [] },
  });
  const wf = makeWorkflow({ atomicTools: mockAtomic, decisionService: mockDec });

  const r = await wf.runAnswerQuestion({ query: '合同条款', user_id: 'u1' });

  assertEqual(r.action, 'return_document_candidates', 'WF-08.1 action=return_document_candidates');
  assert(r.documents.length >= 3, 'WF-08.2 3 文档候选');
  assertEqual(r.evidence_sufficiency, 'weak', 'WF-08.3 weak evidence');
}

async function testAnswerQuestionNoEvidence() {
  console.log('\n📋 WF-09: answer_question — 零证据零文档 → decline');

  // metadata 无结果 + global chunks 也无结果
  const mockAtomic = makeMockAtomicTools({
    metaResult: { success: true, documents: [], total: 0 },
    globalResult: { success: true, chunks: [], total: 0 },
  });
  const mockDec = makeMockDecisionService({
    analyzeResult: { recommended_strategy: 'document_first', intent: 'informational', anchor_strength: 'weak', confidence: 0.3, reason_codes: [] },
  });
  const wf = makeWorkflow({ atomicTools: mockAtomic, decisionService: mockDec });

  const r = await wf.runAnswerQuestion({ query: '不存在的内容', user_id: 'u1' });

  assertEqual(r.action, 'decline_due_to_insufficient_evidence', 'WF-09.1 decline');
  assertEqual(r.evidence_sufficiency, 'none', 'WF-09.2 none');
  assert(r.documents.length === 0, 'WF-09.3 0 docs');
}

async function testAnswerQuestionChunkFallback() {
  console.log('\n📋 WF-09b: answer_question — metadata 0 结果 → chunk 回退');

  // metadata 无结果，但 global chunks 有命中
  const mockAtomic = makeMockAtomicTools({
    metaResult: { success: true, documents: [], total: 0 },
    globalResult: {
      success: true,
      chunks: [
        { chunk_id: 'c1', document_id: 'd9', document_title: '标准文档X', doc_type: 'standard', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 1, chunk_title: '', content: '关于电气安全的关键段落...', score: 0.82 },
        { chunk_id: 'c2', document_id: 'd9', document_title: '标准文档X', doc_type: 'standard', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 2, chunk_title: '', content: '防护等级要求...', score: 0.75 },
      ],
      total: 2,
    },
    resolveResult: {
      success: true,
      documents: [{ document_id: 'd9', document_title: '标准文档X', doc_type: 'standard', collection_id: 'col-1', collection_name: '标准库', max_chunk_score: 0.82, chunk_count: 2 }],
      total: 1,
    },
    scopedResult: {
      success: true,
      chunks: [
        { chunk_id: 'c1', document_id: 'd9', document_title: '标准文档X', doc_type: 'standard', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 1, chunk_title: '', content: '关于电气安全的关键段落...', score: 0.82 },
      ],
      total: 1,
    },
  });
  const mockDec = makeMockDecisionService({
    analyzeResult: { recommended_strategy: 'document_first', intent: 'factual_lookup', anchor_strength: 'medium', confidence: 0.5, reason_codes: [] },
  });
  const wf = makeWorkflow({ atomicTools: mockAtomic, decisionService: mockDec });

  const r = await wf.runAnswerQuestion({ query: '电气安全要求', user_id: 'u1' });

  assert(r.success, 'WF-09b.1 success');
  assertEqual(r.strategy, 'chunk_first_fallback', 'WF-09b.2 chunk_first_fallback strategy');
  assert(r.steps.map(s => s.step).includes('search_chunks_globally'), 'WF-09b.3 global chunk step visible');
  assert(r.steps.map(s => s.step).includes('resolve_documents_from_chunks'), 'WF-09b.4 resolve step visible');
  assert(r.documents.length >= 1, 'WF-09b.5 has docs from fallback');
}

// ============================================================
// runVerifyFact
// ============================================================

async function testVerifyFactSupported() {
  console.log('\n📋 WF-10: verify_fact — strong → supported');

  const mockAtomic = makeMockAtomicTools({
    metaResult: {
      success: true,
      documents: [{ document_id: 'd1', document_title: 'Doc', doc_type: 'contract', collection_name: 'Col', relevance_score: 90 }],
      total: 1,
    },
    scopedResult: {
      success: true,
      chunks: [
        { chunk_id: 'c1', document_id: 'd1', document_title: 'Doc', doc_type: 'contract', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 1, chunk_title: '', content: '匹配内容段落A', score: 0.91 },
        { chunk_id: 'c2', document_id: 'd1', document_title: 'Doc', doc_type: 'contract', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 2, chunk_title: '', content: '匹配内容段落B', score: 0.85 },
        { chunk_id: 'c3', document_id: 'd1', document_title: 'Doc', doc_type: 'contract', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 3, chunk_title: '', content: '匹配内容段落C', score: 0.81 },
      ],
      total: 3,
    },
  });
  const mockDec = makeMockDecisionService({
    analyzeResult: { recommended_strategy: 'document_first', intent: 'factual_lookup', anchor_strength: 'strong', confidence: 0.9, reason_codes: [] },
  });
  const wf = makeWorkflow({ atomicTools: mockAtomic, decisionService: mockDec });

  const r = await wf.runVerifyFact({ query: '命题', user_id: 'u1' });

  assertEqual(r.verdict, 'supported', 'WF-10.1 verdict=supported');
  assert(r.supporting_evidence.length > 0, 'WF-10.2 有 supporting evidence');
  assertEqual(r.action, 'answer_with_ranked_chunks', 'WF-10.3 action');
}

async function testVerifyFactInsufficient() {
  console.log('\n📋 WF-11: verify_fact — weak → insufficient_evidence');

  // 有候选但证据弱（1 chunk, low score）
  const mockAtomic = makeMockAtomicTools({
    metaResult: {
      success: true,
      documents: [{ document_id: 'd1', document_title: 'Doc', doc_type: 'contract', collection_name: 'Col', relevance_score: 40 }],
      total: 1,
    },
    scopedResult: {
      success: true,
      chunks: [
        { chunk_id: 'c1', document_id: 'd1', document_title: 'Doc', doc_type: 'contract', collection_id: 'col-1', revision_id: 'r1', outline_id: null, seq: 1, chunk_title: '', content: '弱相关内容', score: 0.35 },
      ],
      total: 1,
    },
  });
  const mockDec = makeMockDecisionService({
    analyzeResult: { recommended_strategy: 'document_first', intent: 'informational', anchor_strength: 'weak', confidence: 0.3, reason_codes: [] },
  });
  const wf = makeWorkflow({ atomicTools: mockAtomic, decisionService: mockDec });

  const r = await wf.runVerifyFact({ query: '命题', user_id: 'u1' });

  assertEqual(r.verdict, 'insufficient_evidence', 'WF-11.1 verdict=insufficient_evidence');
  assertEqual(r.supporting_evidence.length, 0, 'WF-11.2 无 supporting evidence');
}

// ============================================================
// 运行
// ============================================================

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Document Retrieval Workflow 测试   ║');
  console.log('╚══════════════════════════════════════╝');

  await testFindDocumentMetadataHit();
  await testFindDocumentAttachmentFallback();
  await testFindDocumentContentBridge();
  await testFindDocumentZeroResult();
  await testFindDocumentCollectionNotAccessible();
  await testFindDocumentEmptyQuery();
  await testAnswerQuestionSufficientEvidence();
  await testAnswerQuestionCandidateList();
  await testAnswerQuestionNoEvidence();
  await testAnswerQuestionChunkFallback();
  await testVerifyFactSupported();
  await testVerifyFactInsufficient();

  console.log(`\n${'='.repeat(40)}`);
  console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
  console.log(`${'='.repeat(40)}`);

  if (failed > 0) process.exit(1);
}

main();
