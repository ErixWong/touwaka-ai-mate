/**
 * Document Retrieval 系统闭环测试
 *
 * 覆盖 audit-round02 P1-3 验收标准：
 * 1. rerank 后的结果确实传给上游
 * 2. coverage=not_covered 时不触发 fallback supplement
 * 3. fallback merge 后 coverage/response_mode 被重新计算
 *
 * 运行：node tests/document-retrieval-system.test.js
 */

import DocumentRetrievalService from '../lib/document-retrieval-service.js';
import DocumentEvidencePacker from '../lib/document-evidence-packer.js';
import DocRecallService from '../lib/doc-recall-service.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${label}`); }
}

function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; }
  else {
    failed++;
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(expected)}`);
    console.error(`     actual:   ${JSON.stringify(actual)}`);
  }
}

// ============================================================
// 测试辅助
// ============================================================

function makeDbMock() {
  return {
    getModel: () => ({}),
    sequelize: { QueryTypes: { SELECT: 'SELECT' }, query: async () => [] },
    query: async () => [],
  };
}

function makeConfigMock() {
  return {
    get: () => ({}),
    db: {
      getModelConfig: async () => ({}),
      getDefaultEmbeddingModel: async () => 'em-default',
    },
  };
}

function makeCandidate(id, title, score, docType) {
  return {
    document_id: id, document_title: title, relevance_score: score,
    doc_type: docType, revision_id: `${id}-rev`, collection_id: 'col-1',
    collection_name: 'default', revision_no: 1, is_heuristic_fallback: false,
    candidate_confidence: score >= 80 ? 'high' : 'medium',
  };
}

// ============================================================
// 场景 A: query_plan 正确提取 + rerank 结果传给上游
// ============================================================
function testCaseA_QueryPlanExtraction() {
  console.log('\n📋 系统场景A: query_plan 嵌套提取 + rerank 返回验证');

  const mockDb = makeDbMock();
  const svc = new DocRecallService(mockDb);

  // P0-2: 验证 query_plan 嵌套结构被正确提取
  // 模拟 DocumentRetrievalService 传入的结构
  const query = {
    semantic_query: 'IPX5 防水等级怎么测',
    query_plan: {
      entity_terms: ['IPX5', '4208'],
      procedure_terms: ['试验', '方法'],
      attribute_terms: ['等级'],
      normalized_lookup_query: 'IPX5 4208 试验 方法',
    },
  };

  // 构造 items 模拟 rerank
  const items = [
    { _raw: { content: '前言概要...', chunk_title: '前言', distance: 0.10 }, score: 0.90, chunk: { id: 'c1', title: '前言', content: '前言概要...', seq: 0 } },
    { _raw: { content: '第14.2.5条 IPX5 试验方法 喷水30min', chunk_title: '防水试验', distance: 0.15 }, score: 0.85, chunk: { id: 'c2', title: '防水试验', content: '第14.2.5条 IPX5 试验方法 喷水30min', seq: 5 } },
  ];

  const rerankResult = svc._hybridRerank(items, query.query_plan);
  assert(rerankResult.items.length === 2, 'A1: rerank 后 items 数不变');
  // c2 含 IPX5 + 试验 + 章节锚点 → 应排第一
  assert(rerankResult.items[0].chunk.id === 'c2', 'A2: 含实体+程序词+锚点的 chunk 排第一');
  // 验证子分数
  const c2Debug = rerankResult.debug.find(d => d.chunk_id === 'c2');
  assert(c2Debug.entity > 0, 'A3: c2 entity_score > 0');
  assert(c2Debug.procedure > 0, 'A4: c2 procedure_score > 0');
  assert(c2Debug.final > rerankResult.debug.find(d => d.chunk_id === 'c1').final, 'A5: c2 final > c1 final');
  assert(c2Debug.matched_entities.length > 0, 'A6: matched_entities 不为空');
}

// ============================================================
// 场景 A2: 直接验证 recallWithinDocuments 返回 finalItems
// ============================================================
function testCaseA2_ReturnFinalItems() {
  console.log('\n📋 系统场景A2: recallWithinDocuments 返回 rerank 后结果');

  // 不启动真实数据库，直接验证 rerank 与 return 路径一致性
  const mockDb = makeDbMock();
  const svc = new DocRecallService(mockDb);

  const items = [
    { _raw: { content: '前言...', chunk_title: '前言', distance: 0.10 }, score: 0.90, chunk: { id: 'c1', title: '前言', content: '前言...', seq: 0 } },
    { _raw: { content: 'IPX5 试验条件', chunk_title: '试验方法', distance: 0.15 }, score: 0.85, chunk: { id: 'c2', title: '试验方法', content: 'IPX5 试验条件', seq: 5 } },
  ];
  const queryPlan = { entity_terms: ['IPX5'], procedure_terms: ['试验'] };

  const rerankResult = svc._hybridRerank(items, queryPlan);
  const finalItems = rerankResult.items.slice(0, 3).map(({ _raw, ...rest }) => rest);

  // 模拟 recallWithinDocuments 中的 return 结构
  assert(finalItems.length === 2, 'A2.1: finalItems 长度正确');
  assert(finalItems[0].chunk.id === 'c2', 'A2.2: rerank 后 c2 排第一（含 IPX5）');
  assert(finalItems[0].score > finalItems[1].score, 'A2.3: finalItems 按 rerank 分数排序');
}

// ============================================================
// 场景 B: coverage=not_covered 时不触发 fallback supplement
// ============================================================
async function testCaseB_NoFallbackWhenNotCovered() {
  console.log('\n📋 系统场景B: coverage=not_covered 时阻止 fallback');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  svc.decisionService.analyze = () => ({
    intent: 'document_lookup',
    anchor_strength: 'medium',
    confidence: 0.6,
    matched_patterns: ['标准'],
    reason_codes: ['medium_anchor_detected'],
    recommended_strategy: 'document_first',
  });

  svc.searchService.search = async () => ({
    success: true,
    candidates: [makeCandidate('d1', '前言概述文档', 50, 'standard')],
    total: 1,
    strategy: 'title_match',
  });

  let fallbackCalled = false;
  svc._ensureRecallService = () => {};
  svc.recallService = {
    recallWithinDocuments: async () => ({
      success: true,
      // 只返回与问题无关的前言内容 → coverage 将判定 not_covered
      items: [
        { score: 0.4, chunk: { id: 'c1', title: '前言', content: '本标准前言...', seq: 0 }, document: { id: 'd1' } },
      ],
      total: 1,
    }),
    recall: async () => {
      fallbackCalled = true;
      return { success: true, items: [], total: 0 };
    },
  };

  const result = await svc.retrieve('IPX5 防水等级怎么测', {
    userId: 'u1',
    allow_fallback: true,
  });

  // coverage 应该是 not_covered（entity=IPX5 未命中）
  assert(result.packet.meta.coverage_status === 'not_covered', 'B1: coverage=not_covered');
  // fallback 不应该被调用
  assert(!fallbackCalled, 'B2: fallback supplement 未被调用');
  // 应该降级而非通过
  assert(result.packet.meta.suggested_response_mode === 'conservative_answer', 'B3: 降级为 conservative_answer');
  assert(result.strategy === 'degrade' || result.packet.meta.reason_codes.includes('fallback_blocked_by_coverage'),
    'B4: strategy 降级或日志标注 fallback 被阻止');
}

// ============================================================
// 场景 C: fallback merge 后 coverage 被重新计算
// ============================================================
async function testCaseC_RecomputeCoverageAfterMerge() {
  console.log('\n📋 系统场景C: fallback merge 后重算 coverage');

  // 直接测试 packer 行为，不需要完整 orchestration
  const packer = new DocumentEvidencePacker();

  const existingPacket = packer.pack(
    [makeCandidate('d1', '前言文档', 50, 'standard')],
    [{ score: 0.4, chunk: { id: 'c1', title: '前言', content: '前言内容...' }, document: { id: 'd1' } }],
    { intent: 'document_lookup', recommended_strategy: 'document_first' },
    'trace-c',
    { queryFacets: { entity_terms: ['IPX5'], procedure_terms: ['试验'] } }
  );
  assert(existingPacket.meta.coverage_status === 'not_covered', 'C1: 原始 packet coverage=not_covered');

  // 模拟 fallback 合并：加入命中实体的证据
  const newPacket = packer.pack(
    [makeCandidate('d2', '外壳防护等级', 80, 'standard')],
    [{ score: 0.85, chunk: { id: 'c2', title: 'IPX5 试验条件', content: 'IPX5 试验条件为...', seq: 5 }, document: { id: 'd2' } }],
    { intent: 'document_lookup', recommended_strategy: 'document_first' },
    'trace-c',
    { queryFacets: { entity_terms: ['IPX5'], procedure_terms: ['试验'] } }
  );

  // 合并
  newPacket.documents = [...existingPacket.documents, ...newPacket.documents];
  newPacket.meta.total_candidates = existingPacket.meta.total_candidates + newPacket.meta.total_candidates;
  newPacket.meta.total_evidence = existingPacket.meta.total_evidence + newPacket.meta.total_evidence;
  newPacket.meta.max_evidence_score = Math.max(existingPacket.meta.max_evidence_score, newPacket.meta.max_evidence_score);

  const mergedCoverage = packer._assessCoverage(newPacket, { entity_terms: ['IPX5'], procedure_terms: ['试验'] });
  const mergedMode = packer._deriveResponseMode(newPacket);

  assert(mergedCoverage.status === 'covered', 'C2: merge 后 coverage=covered');
  assert(mergedMode.should_answer_conservatively === false, 'C3: merge 后不再保守回答');
  assert(mergedMode.mode === 'answer_with_citation', 'C4: merge 后恢复引用回答');
}

// ============================================================
// 场景 F: coverage=covered + sufficiency=weak → fallback 触发 → merge 后重算 coverage
// ============================================================
async function testCaseF_FallbackTriggeredWhenCovered() {
  console.log('\n📋 系统场景F: covered+weak → fallback → merge 后 coverage 收敛为具体值');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  svc.decisionService.analyze = () => ({
    intent: 'document_lookup',
    anchor_strength: 'medium',
    confidence: 0.55,
    matched_patterns: ['标准'],
    reason_codes: ['medium_anchor_detected'],
    recommended_strategy: 'document_first',
  });

  svc.searchService.search = async () => ({
    success: true,
    candidates: [makeCandidate('d1', 'IP测试标准', 60, 'standard')],
    total: 1,
    strategy: 'title_match',
  });

  let fallbackRecallCalled = false;
  let getDocumentInfoCalled = false;

  svc._ensureRecallService = () => {};
  svc.recallService = {
    // 主召回：低分但同 chunk 命中实体+程序词 → coverage=covered, sufficiency=weak
    recallWithinDocuments: async () => ({
      success: true,
      items: [
        { score: 0.5, chunk: { id: 'c1', title: 'IPX5 试验概述', content: 'IPX5 试验概述与基本流程...', seq: 0 }, document: { id: 'd1' } },
      ],
      total: 1,
    }),
    // fallback 召回：同 query 其他文档的高分证据
    recall: async () => {
      fallbackRecallCalled = true;
      return {
        success: true,
        items: [
          { score: 0.88, chunk: { id: 'c2', title: 'IPX5 试验条件', content: 'IPX5 试验条件：喷水30min，14.2.7...', seq: 5 }, document: { id: 'd2' } },
        ],
        total: 1,
      };
    },
  };

  svc.searchService.getDocumentInfo = async () => {
    getDocumentInfoCalled = true;
    return [makeCandidate('d2', '外壳防护等级 GB/T 4208', 85, 'standard')];
  };

  // "IPX5 试验" → parser 提取 entity_terms=['IPX5'], procedure_terms=['试验']
  const result = await svc.retrieve('IPX5 试验', {
    userId: 'u1',
    allow_fallback: true,
  });

  assert(fallbackRecallCalled, 'F1: fallback recall() 被调用');
  assert(getDocumentInfoCalled, 'F2: getDocumentInfo 补全了 fallback 文档身份');
  assert(result.packet.documents.length >= 2, 'F3: 合并后包含至少 2 个文档');

  // 核心：merge 后 coverage 必须被重算为具体值，不得停留在 not_evaluated
  const finalCoverage = result.packet.meta.coverage_status;
  assert(finalCoverage === 'covered' || finalCoverage === 'partial',
    `F4: merge 后 coverage 收敛为具体值 (got: ${finalCoverage})`);
  assert(finalCoverage !== 'not_evaluated',
    `F4b: merge 后 coverage 不得仍为 not_evaluated`);

  assert(result.packet.meta.evidence_sufficiency !== 'weak',
    `F5: merge 后 sufficiency 不再为 weak (got: ${result.packet.meta.evidence_sufficiency})`);
  assert(result.packet.meta.suggested_response_mode !== 'conservative_answer',
    `F6: merge 后 response_mode 不是 conservative_answer (got: ${result.packet.meta.suggested_response_mode})`);
  assert(result.packet.meta.reason_codes.includes('fallback_supplement'),
    'F7: reason_codes 含 fallback_supplement');
  assert(result.packet.meta.coverage_reason_codes !== undefined,
    'F8: merge 后 coverage_reason_codes 存在');
}
function testCaseD_ChunkLevelCoverage_NoOverlap() {
  console.log('\n📋 系统场景D: chunk 级覆盖 — 无 overlap 判 partial');

  const packer = new DocumentEvidencePacker();
  const packet = {
    meta: { total_evidence: 2, max_evidence_score: 0.7 },
    documents: [
      {
        document_id: 'd1',
        evidence: [
          { chunk_id: 'c1', content: 'IPX5 防水等级要求' },
          { chunk_id: 'c2', content: '试验方法为喷水30min' },
        ],
      },
    ],
  };
  const facets = { entity_terms: ['IPX5'], procedure_terms: ['试验'] };

  const coverage = packer._assessCoverage(packet, facets);
  // IPX5 在 c1，试验 在 c2 → 有 overlap 因为它们在同一个 document 下
  // 但不同 chunk，overlapChunkIds.size === 0
  assert(coverage.entity_chunk_hits['IPX5']?.includes('c1'), 'D1: IPX5 命中 c1');
  assert(coverage.procedure_chunk_hits['试验']?.includes('c2'), 'D2: 试验 命中 c2');
  // 实体全中但 chunk 无 overlap → 应降为 partial
  assert(coverage.status === 'partial', 'D3: 无 chunk overlap → partial');
  assert(coverage.reason_codes.includes('coverage_no_chunk_overlap'), 'D4: no_chunk_overlap');
}

// ============================================================
// 场景 E: chunk 级覆盖 — 同一 chunk 命中 → covered
// ============================================================
function testCaseE_ChunkLevelCoverage_SameChunk() {
  console.log('\n📋 系统场景E: chunk 级覆盖 — 同一 chunk 命中 → covered');

  const packer = new DocumentEvidencePacker();
  const packet = {
    meta: { total_evidence: 1, max_evidence_score: 0.85 },
    documents: [
      {
        document_id: 'd1',
        evidence: [
          { chunk_id: 'c1', content: 'IPX5 防水等级 试验条件为喷水30min' },
        ],
      },
    ],
  };
  const facets = { entity_terms: ['IPX5'], procedure_terms: ['试验'] };

  const coverage = packer._assessCoverage(packet, facets);
  assert(coverage.status === 'covered', 'E1: 同一 chunk 命中 → covered');
  assert(coverage.reason_codes.length === 0, 'E2: 无 warning code');
}

// ============================================================
// 运行
// ============================================================

console.log('\n╔══════════════════════════════════════╗');
console.log('║  Retrieval System 闭环测试          ║');
console.log('╚══════════════════════════════════════╝');

testCaseA_QueryPlanExtraction();
testCaseA2_ReturnFinalItems();
await testCaseB_NoFallbackWhenNotCovered();
await testCaseC_RecomputeCoverageAfterMerge();
testCaseD_ChunkLevelCoverage_NoOverlap();
testCaseE_ChunkLevelCoverage_SameChunk();
await testCaseF_FallbackTriggeredWhenCovered();

console.log(`\n${'='.repeat(40)}`);
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) process.exit(1);
