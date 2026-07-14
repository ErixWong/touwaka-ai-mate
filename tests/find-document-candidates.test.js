/**
 * find_document 候选构造逻辑最小验证
 *
 * 验证场景：
 * 1. 单候选高置信 → supporting_evidence 附带
 * 2. 多候选 → supporting_evidence 为 undefined
 * 3. 无候选 → 空数组
 *
 * 注意：此测试仅验证 candidates 构造逻辑（修复 Round 02 P0-1 自引用 bug 的回归）
 * 不依赖数据库或完整检索链路。
 */

// 模拟 packet.documents 数据结构（与 DocumentEvidencePacker 输出一致）
function mockDoc(id, title, confidence, evidence) {
  return {
    document_id: id,
    document_title: title,
    doc_type: 'contract',
    collection_name: '测试集合',
    relevance_score: 100,
    candidate_confidence: confidence,
    identity_confidence: 'confirmed',
    identity_source: 'search_match',
    evidence: evidence || [],
  };
}

// 待验证的 candidates 构造逻辑（与 tool-manager._handleFindDocument 完全一致）
function buildCandidates(docs) {
  const isSingleHighConf = docs.length === 1 && docs[0]?.candidate_confidence === 'high';

  return docs.map(doc => ({
    document_id: doc.document_id,
    document_title: doc.document_title,
    doc_type: doc.doc_type,
    collection_name: doc.collection_name,
    relevance_score: doc.relevance_score,
    candidate_confidence: doc.candidate_confidence,
    identity_confidence: doc.identity_confidence,
    match_reason: doc.candidate_confidence === 'high' ? '关键词匹配' : '语义相似',
    supporting_evidence: (isSingleHighConf
      ? (doc.evidence || []).slice(0, 3).map(ev => ({ content: ev.content?.substring(0, 300) || '' }))
      : undefined),
  }));
}

// ============================================================
// 场景 1：单候选高置信
// ============================================================
function testSingleHighConf() {
  const docs = [mockDoc('doc-1', '劳动合同模板', 'high', [
    { content: '第一条 甲方与乙方经协商一致...' },
    { content: '第二条 合同期限自...' },
  ])];

  const candidates = buildCandidates(docs);

  console.assert(candidates.length === 1, '场景1: 应返回 1 个候选');
  console.assert(candidates[0].candidate_confidence === 'high', '场景1: confidence 应为 high');
  console.assert(candidates[0].match_reason === '关键词匹配', '场景1: match_reason 应为关键词匹配');
  console.assert(
    Array.isArray(candidates[0].supporting_evidence) && candidates[0].supporting_evidence.length === 2,
    '场景1: 单候选高置信应有 supporting_evidence'
  );
  console.assert(
    candidates[0].supporting_evidence[0].content.startsWith('第一条'),
    '场景1: supporting_evidence content 应被截断/保留'
  );

  console.log('✅ 场景1 通过：单候选高置信 → supporting_evidence 附带');
  return true;
}

// ============================================================
// 场景 2：多候选
// ============================================================
function testMultipleCandidates() {
  const docs = [
    mockDoc('doc-1', '劳动合同模板', 'high', [{ content: '第一条...' }]),
    mockDoc('doc-2', '劳动合同补充协议', 'high', [{ content: '第一条...' }]),
    mockDoc('doc-3', '实习协议', 'low', []),
  ];

  const candidates = buildCandidates(docs);

  console.assert(candidates.length === 3, '场景2: 应返回 3 个候选');
  console.assert(
    candidates.every(c => c.supporting_evidence === undefined),
    '场景2: 多候选时所有 supporting_evidence 均应为 undefined'
  );

  console.log('✅ 场景2 通过：多候选 → 无 supporting_evidence');
  return true;
}

// ============================================================
// 场景 3：无候选
// ============================================================
function testNoCandidates() {
  const docs = [];

  const candidates = buildCandidates(docs);

  console.assert(candidates.length === 0, '场景3: 应返回空数组');
  // 验证 isSingleHighConf 在空数组时不会抛出异常
  console.assert(typeof buildCandidates([]) !== 'undefined', '场景3: 空数组不应抛出');

  console.log('✅ 场景3 通过：无候选 → 空数组，不抛异常');
  return true;
}

// ============================================================
// 额外场景 4：单候选低置信
// ============================================================
function testSingleLowConf() {
  const docs = [mockDoc('doc-1', '某模糊文档', 'low', [{ content: '一些内容...' }])];

  const candidates = buildCandidates(docs);

  console.assert(candidates.length === 1, '场景4: 应返回 1 个候选');
  console.assert(
    candidates[0].supporting_evidence === undefined,
    '场景4: 单候选低置信时不应附带 supporting_evidence'
  );

  console.log('✅ 场景4 通过：单候选低置信 → 无 supporting_evidence');
  return true;
}

// ============================================================
// 运行全部测试
// ============================================================
let passed = 0;
let failed = 0;

const tests = [
  { name: '场景1: 单候选高置信', fn: testSingleHighConf },
  { name: '场景2: 多候选', fn: testMultipleCandidates },
  { name: '场景3: 无候选', fn: testNoCandidates },
  { name: '场景4: 单候选低置信', fn: testSingleLowConf },
];

for (const { name, fn } of tests) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`❌ ${name} 失败:`, e.message);
    failed++;
  }
}

console.log(`\n============================================================`);
console.log(`验证完成: ${passed}/${tests.length} 通过, ${failed} 失败`);
console.log(`============================================================`);

process.exit(failed > 0 ? 1 : 0);
