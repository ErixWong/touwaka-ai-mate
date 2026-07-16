/**
 * Document Evidence Rerank & Coverage 单元测试
 *
 * 覆盖审计标准：
 * - audit-round01 P0-1: _hybridRerank 混合重排
 * - audit-round01 P0-2: _assessCoverage 覆盖度评估
 *
 * 运行：node tests/document-evidence-rerank-coverage.test.js
 */

import DocRecallService from '../lib/doc-recall-service.js';
import DocumentEvidencePacker from '../lib/document-evidence-packer.js';

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

// ==========================================
// P0-1: _hybridRerank 测试
// ==========================================

function testRerank_Basic() {
  console.log('\n📋 Rerank 用例1: 基础重排');

  const service = new DocRecallService();
  const items = [
    { _raw: { content: '第14.2.5条规定防水等级为IPX5', chunk_title: '防水等级', distance: 0.15 }, score: 0.85, chunk: { id: 'c1', title: '防水等级', content: '第14.2.5条规定防水等级为IPX5', seq: 5 } },
    { _raw: { content: '前言概述...', chunk_title: '前言', distance: 0.10 }, score: 0.90, chunk: { id: 'c2', title: '前言', content: '前言概述...', seq: 0 } },
  ];
  const queryPlan = { entity_terms: ['IPX5', '14.2.5'], procedure_terms: ['试验', '方法'] };

  const result = service._hybridRerank(items, queryPlan);

  assert(result.items.length === 2, 'R1.1: 返回同数量 items');
  assert(result.debug.length === 2, 'R1.2: 返回 debug 信息');
  assert(typeof result.items[0]._rerank === 'object', 'R1.3: item 含 _rerank 子分数');
  assert(result.items[0]._rerank.entity > 0, 'R1.4: 实体命中分 > 0');

  // c1 含实体 + 章节锚点，应该排第一
  assert(result.items[0].chunk.id === 'c1', 'R1.5: 含实体+锚点的 chunk 排第一');
  assert(result.items[0].score > result.items[1].score, 'R1.6: 第一的 final 分高于第二');

  // 前言 seq=0 且无 section pattern → structural 低
  const c2Debug = result.debug.find(d => d.chunk_id === 'c2');
  assert(c2Debug.structural <= 0.5, 'R1.7: 前言 overview chunk structural 偏低');
}

function testRerank_EmptyFacets() {
  console.log('\n📋 Rerank 用例2: 空 facets');

  const service = new DocRecallService();
  const items = [
    { _raw: { content: 'content a', chunk_title: 'title a' }, score: 0.80, chunk: { id: 'c1', title: 'title a', content: 'content a', seq: 1 } },
    { _raw: { content: 'content b', chunk_title: 'title b' }, score: 0.75, chunk: { id: 'c2', title: 'title b', content: 'content b', seq: 1 } },
  ];
  const queryPlan = { entity_terms: [], procedure_terms: [] };

  const result = service._hybridRerank(items, queryPlan);

  assert(result.items.length === 2, 'R2.1: 空 facets 正常返回');
  // 纯语义排序：保持原顺序（按 semantic 降序）
  assert(result.items[0].chunk.id === 'c1', 'R2.2: 无 facets 保持语义排序');
  assert(result.items[0]._rerank.entity === 0, 'R2.3: 空实体时 entity=0');
  assert(result.items[0]._rerank.procedure === 0, 'R2.4: 空程序词时 procedure=0');
}

function testRerank_WeightsSumToOne() {
  console.log('\n📋 Rerank 用例3: 权重校验');

  const service = new DocRecallService();
  const items = [
    { _raw: { content: 'anything', chunk_title: 'title' }, score: 1.0, chunk: { id: 'c1', title: 'title', content: 'anything', seq: 3 } },
  ];
  const queryPlan = { entity_terms: [], procedure_terms: [] };

  const result = service._hybridRerank(items, queryPlan);

  // semantic=1.0, entity=0, procedure=0, structural=0.5(default)
  // final = 0.45*1.0 + 0*0.30 + 0*0.15 + 0.5*0.10 = 0.50
  const d = result.debug[0];
  assert(d.semantic === 1, 'R3.1: semantic=1.0');
  assert(d.final <= 1.0, 'R3.2: 总分不超过 1.0');
  assert(d.final >= 0.0, 'R3.3: 总分不低于 0.0');
}

// ==========================================
// P0-2: _assessCoverage 测试
// ==========================================

function testCoverage_Covered() {
  console.log('\n📋 Coverage 用例1: 完全覆盖');

  const packer = new DocumentEvidencePacker();
  const packet = {
    meta: { total_evidence: 3, max_evidence_score: 0.85 },
    documents: [
      { evidence: [{ content: 'IPX5 防水等级要求 第14.2.5条' }, { content: '试验方法说明' }] },
      { evidence: [{ content: '附录A 详细参数' }] },
    ],
  };
  const facets = { entity_terms: ['IPX5', '14.2.5'], procedure_terms: ['试验'] };

  const coverage = packer._assessCoverage(packet, facets);
  assert(coverage.status === 'covered', 'C1.1: 所有实体+程序词命中 → covered');
  assert(coverage.reason_codes.length === 0, 'C1.2: 无 warning code');
}

function testCoverage_Partial() {
  console.log('\n📋 Coverage 用例2: 部分覆盖');

  const packer = new DocumentEvidencePacker();
  const packet = {
    meta: { total_evidence: 2 },
    documents: [
      { evidence: [{ content: 'IPX5 等级说明' }] },
    ],
  };
  const facets = { entity_terms: ['IPX5', 'IPX7'], procedure_terms: [] };

  const coverage = packer._assessCoverage(packet, facets);
  assert(coverage.status === 'partial', 'C2.1: 部分实体未命中 → partial');
  assert(coverage.reason_codes.includes('coverage_miss_core_entity'), 'C2.2: miss_core_entity');
}

function testCoverage_NotCovered() {
  console.log('\n📋 Coverage 用例3: 未覆盖');

  const packer = new DocumentEvidencePacker();
  const packet = {
    meta: { total_evidence: 2 },
    documents: [
      { evidence: [{ content: '前言概述' }, { content: '术语定义' }] },
    ],
  };
  const facets = { entity_terms: ['IPX5', '14.2.5'], procedure_terms: ['试验'] };

  const coverage = packer._assessCoverage(packet, facets);
  assert(coverage.status === 'not_covered', 'C3.1: 实体完全未命中 → not_covered');
  assert(coverage.reason_codes.includes('coverage_miss_core_entity'), 'C3.2: miss_core_entity');
}

function testCoverage_NoEvidence() {
  console.log('\n📋 Coverage 用例4: 无证据');

  const packer = new DocumentEvidencePacker();
  const packet = {
    meta: { total_evidence: 0 },
    documents: [],
  };
  const facets = { entity_terms: ['IPX5'], procedure_terms: [] };

  const coverage = packer._assessCoverage(packet, facets);
  assert(coverage.status === 'not_covered', 'C4.1: 无证据 → not_covered');
  assert(coverage.reason_codes.includes('no_evidence'), 'C4.2: no_evidence');
}

function testCoverage_NoFacets() {
  console.log('\n📋 Coverage 用例5: 无 facets');

  const packer = new DocumentEvidencePacker();
  const packet = {
    meta: { total_evidence: 1 },
    documents: [{ evidence: [{ content: 'anything' }] }],
  };
  const facets = { entity_terms: [], procedure_terms: [] };

  const coverage = packer._assessCoverage(packet, facets);
  assert(coverage.status === 'not_evaluated', 'C5.1: 无 facets → not_evaluated');
}

// ==========================================
// 运行
// ==========================================

console.log('\n╔══════════════════════════════════════╗');
console.log('║  Evidence Rerank & Coverage 单元测试 ║');
console.log('╚══════════════════════════════════════╝');

testRerank_Basic();
testRerank_EmptyFacets();
testRerank_WeightsSumToOne();

testCoverage_Covered();
testCoverage_Partial();
testCoverage_NotCovered();
testCoverage_NoEvidence();
testCoverage_NoFacets();

console.log(`\n${'='.repeat(40)}`);
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) {
  process.exit(1);
}
