/**
 * Document Query Parser 单元测试
 *
 * 覆盖审计标准：
 * - audit-round02 P0-1: 主题/类型分离
 * - audit-round03 P1-2 & P2-1: 疑问词清理、编号保护、长主题扩召
 * - audit-round04 P0-1: 幂等性（消除全局正则 lastIndex 状态污染）
 * - audit-round04 P1-1: 编号不重复、无残片、无口语残留
 * - audit-round04 P1-2: 精确输出断言（不再仅用 includes()）
 *
 * 运行：node tests/document-query-parser.test.js
 */

import { parseDocumentQuery } from '../lib/document-query-parser.js';

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

function assertContains(arr, item, label) {
  if (arr.includes(item)) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${label} — array: ${JSON.stringify(arr)}`); }
}

// ============================================================
// 用例 1："国标文件" — 类型词从主题中剥离
// ============================================================
function testCase1_GuoBiao() {
  console.log('\n📋 用例1: 国标文件查询');
  const r = parseDocumentQuery('有一个规定了汽车车身术语的国标文件是啥来着？');

  assert(r.lookup_intent === true, '1.1 lookup_intent');
  assertEq(r.cleaned_query, '汽车车身术语', '1.2 cleaned_query 精确值');
  assertEq(r.doc_type_hints, ['国家标准'], '1.3 doc_type_hints 精确值');
  assert(r.topic_terms.length > 0, '1.4 topic_terms 非空');
  assert(!r.topic_terms.some(t => t.includes('国标')), '1.5 topic_terms 不含国标');
  assert(!r.cleaned_query.includes('国标'), '1.6 cleaned_query 不含国标');
  assert(!r.cleaned_query.includes('规定了'), '1.7 cleaned_query 不含"规定了"');
}

// ============================================================
// 用例 2："制度办法" — 制度类正确识别，不带噪音
// ============================================================
function testCase2_ZhiDu() {
  console.log('\n📋 用例2: 制度办法查询');
  const r = parseDocumentQuery('公司管理制度有哪些？');

  assert(r.lookup_intent === true, '2.1 lookup_intent');
  assertEq(r.doc_type_hints, ['制度规章'], '2.2 doc_type_hints 精确值（无空格污染）');
  assert(!r.cleaned_query.includes('管理制度'), '2.3 cleaned_query 不含管理制度');
  assert(!r.cleaned_query.includes('哪些'), '2.4 cleaned_query 不含疑问词');
  assert(!r.cleaned_query.includes('？'), '2.5 cleaned_query 不含问号');
}

// ============================================================
// 用例 3："合同编号" — 编号优先，无口语残片（audit-round04 P1-1）
// ============================================================
function testCase3_HeTong() {
  console.log('\n📋 用例3: 合同查询（编号优先）');
  const r = parseDocumentQuery('帮我找一下HT-2024-001那份合同');

  assert(r.lookup_intent === true, '3.1 lookup_intent');
  assertContains(r.doc_type_hints, '合同协议', '3.2 doc_type_hints');
  assertEq(r.identifier_hints, ['HT-2024-001'], '3.3 identifier_hints 精确值');
  assertEq(r.cleaned_query, 'HT-2024-001', '3.4 cleaned_query=纯编号，无口语残片');
  assert(!r.cleaned_query.includes('一下'), '3.5 不含"一下"');
  assert(!r.cleaned_query.includes('那份'), '3.6 不含"那份"');
  // 编号只出现一次
  assert((r.cleaned_query.match(/HT-2024-001/g) || []).length === 1, '3.7 编号不重复');
}

// ============================================================
// 用例 4："纯主题查找" — 无类型提示
// ============================================================
function testCase4_PureTopic() {
  console.log('\n📋 用例4: 纯主题查找');
  const r = parseDocumentQuery('汽车安全性能评测');

  assertEq(r.doc_type_hints, [], '4.1 doc_type_hints 为空');
  assert(r.topic_terms.length >= 1, '4.2 topic_terms 有内容');
  assert(r.cleaned_query.length > 0, '4.3 cleaned_query 非空');
  assert(r.lookup_intent === false, '4.4 lookup_intent=false');
}

// ============================================================
// 用例 5："模糊口语问法" — 噪音剔除
// ============================================================
function testCase5_FuzzyColloquial() {
  console.log('\n📋 用例5: 模糊口语问法');
  const r = parseDocumentQuery('有没有关于环保方面的规定文件来着？');

  assert(r.noise_terms.some(t => t.includes('有没有') || t.includes('来着') || t.includes('文件')),
    '5.1 noise_terms 含口语词');
  assert(!r.cleaned_query.includes('有没有'), '5.2 不含"有没有"');
  assert(!r.cleaned_query.includes('来着'), '5.3 不含"来着"');
  assert(!r.cleaned_query.includes('文件'), '5.4 不含"文件"');
}

// ============================================================
// 用例 6：空 query
// ============================================================
function testCase6_EmptyQuery() {
  console.log('\n📋 用例6: 空 query');
  const r = parseDocumentQuery('');
  assert(!r.lookup_intent, '6.1 lookup_intent=false');
  assertEq(r.topic_terms, [], '6.2 topic_terms 空');
}

// ============================================================
// 用例 7：标准号精确查询 — 编号优先，无GB/T残片重复
// ============================================================
function testCase7_StandardNumber() {
  console.log('\n📋 用例7: 标准号查询（编号优先）');
  const r = parseDocumentQuery('GB/T 12345-2020 在哪里');

  assert(r.lookup_intent === true, '7.1 lookup_intent');
  assertEq(r.identifier_hints, ['GB/T 12345-2020'], '7.2 identifier_hints 精确值');
  assertEq(r.cleaned_query, 'GB/T 12345-2020', '7.3 cleaned_query=纯编号，无GB/T残片');
  // GB/T 只出现一次
  assert((r.cleaned_query.match(/GB\/T/g) || []).length <= 1, '7.4 GB/T 不重复');
  // topic_terms 不应含 GB/T 残片
  assert(!r.topic_terms.some(t => t === 'GB/T' || t === 'GB'), '7.5 topic_terms 无 GB 残片');
}

// ============================================================
// 用例 8：疑问词清理
// ============================================================
function testCase8_QuestionWordCleanup() {
  console.log('\n📋 用例8: 疑问词清理');
  const r = parseDocumentQuery('公司管理制度有哪些？');
  assert(!r.cleaned_query.includes('哪些'), '8.1 不含"哪些"');
  assert(!r.cleaned_query.includes('？'), '8.2 不含问号');
  assertContains(r.doc_type_hints, '制度规章', '8.3 类型仍正确');
}

// ============================================================
// 用例 9：长主题词扩召
// ============================================================
function testCase9_TopicExpansion() {
  console.log('\n📋 用例9: 长主题词扩召');
  const r = parseDocumentQuery('汽车车身术语');
  assert(r.expanded_topic_queries.length >= 1, '9.1 至少 1 个扩召 query');
  const hasSplit = r.expanded_topic_queries.some(q => q.includes('汽车车身'));
  assert(hasSplit, '9.2 扩召含主题拆分');
}

// ============================================================
// 用例 10：制度+疑问词复合
// ============================================================
function testCase10_Supplementary() {
  console.log('\n📋 用例10: 制度+疑问词复合');
  const r = parseDocumentQuery('有没有关于安全生产的管理规定？');
  assert(r.lookup_intent === true, '10.1 lookup_intent');
  assertContains(r.doc_type_hints, '制度规章', '10.2 制度规章');
  assert(!r.cleaned_query.includes('有没有'), '10.3 不含口语');
  assert(!r.cleaned_query.includes('？'), '10.4 不含问号');
}

// ============================================================
// 用例 11：ISO 标准号（audit-round04 新增编号类型覆盖）
// ============================================================
function testCase11_ISO() {
  console.log('\n📋 用例11: ISO 标准号');
  const r = parseDocumentQuery('找一下ISO 9001:2015标准');
  assert(r.identifier_hints.length >= 1, '11.1 identifier_hints 非空');
  assert(r.identifier_hints.some(id => /ISO/i.test(id)), '11.2 含 ISO');
  assert(!r.cleaned_query.includes('找一下'), '11.3 不含口语');
  assert(r.cleaned_query.length > 0, '11.4 cleaned_query 非空');
}

// ============================================================
// 用例 12：文号查询（audit-round04 新增编号类型覆盖）
// ============================================================
function testCase12_DocumentNumber() {
  console.log('\n📋 用例12: 文号查询');
  const r = parseDocumentQuery('国发〔2024〕1号文件');
  assert(r.identifier_hints.length >= 1, '12.1 捕获文号');
  assert(r.lookup_intent === true, '12.2 lookup_intent');
  assert(!r.cleaned_query.includes('文件'), '12.3 不含"文件"噪音');
}

// ============================================================
// 用例 13：标准号 + 内容问法 —— 不应把“主要/标准”误留为主题词
// ============================================================
function testCase13_StandardNumberContentQuestion() {
  console.log('\n📋 用例13: 标准号 + 内容问法');
  const r = parseDocumentQuery('GB28046.5-2013主要讲的是什么标准？');
  assertEq(r.identifier_hints, ['GB28046.5-2013'], '13.1 identifier_hints 精确值');
  assertEq(r.doc_type_hints, [], '13.2 doc_type_hints 不应从内容问法硬推断类型');
  assertEq(r.cleaned_query, 'GB28046.5-2013', '13.3 cleaned_query 应仅保留标准号');
  assertEq(r.topic_terms, [], '13.4 topic_terms 应为空');
}

// ============================================================
// P0-1: 幂等性测试（audit-round04 核心验收标准）
// ============================================================
function testCase_Idempotence_SameQuery() {
  console.log('\n📋 幂等性1: 同一 query 100 次解析结果一致');
  const q = '有一个规定了汽车车身术语的国标文件是啥来着？';
  const results = [];
  for (let i = 0; i < 100; i++) {
    results.push(JSON.stringify(parseDocumentQuery(q)));
  }
  const allSame = results.every(r => r === results[0]);
  assert(allSame, 'Idem1: 100 次相同 query 结果完全一致');
}

function testCase_Idempotence_Alternating() {
  console.log('\n📋 幂等性2: 两个不同 query 交替 100 轮结果一致');
  const q1 = '公司管理制度有哪些？';
  const q2 = 'GB/T 12345-2020 在哪里';
  const even = [];
  const odd = [];
  for (let i = 0; i < 100; i++) {
    const r = JSON.stringify(parseDocumentQuery(i % 2 === 0 ? q1 : q2));
    if (i % 2 === 0) even.push(r);
    else odd.push(r);
  }
  assert(even.every(r => r === even[0]), 'Idem2a: 偶数轮（制度查询）全部一致');
  assert(odd.every(r => r === odd[0]), 'Idem2b: 奇数轮（标准号查询）全部一致');
}

// ============================================================
// 执行
// ============================================================
console.log('╔══════════════════════════════════════╗');
console.log('║  Document Query Parser 单元测试     ║');
console.log('╚══════════════════════════════════════╝');

testCase1_GuoBiao();
testCase2_ZhiDu();
testCase3_HeTong();
testCase4_PureTopic();
testCase5_FuzzyColloquial();
testCase6_EmptyQuery();
testCase7_StandardNumber();
testCase8_QuestionWordCleanup();
testCase9_TopicExpansion();
testCase10_Supplementary();
testCase11_ISO();
testCase12_DocumentNumber();
testCase13_StandardNumberContentQuestion();
testCase_Idempotence_SameQuery();
testCase_Idempotence_Alternating();

// ==========================================
// audit-round01 P1-1: Query Facets 测试
// ==========================================

function testCase_Facets_EntityTerms() {
  console.log('\n📋 用例F1: 实体词提取');

  // 国家标准编号
  const r1 = parseDocumentQuery('GB/T 12345-2020 的防水等级怎么规定');
  assert(r1.facets.entity_terms.includes('GB/T 12345-2020'), 'F1.1: 标准编号');
  // 编号后面的年份可能也被提取
  assert(r1.facets.entity_terms.some(e => e.includes('12345')), 'F1.2: 含数字编号');

  // 合同编号
  const r2 = parseDocumentQuery('合同 HT-2024-001 的付款条款');
  assert(r2.facets.entity_terms.includes('HT-2024-001'), 'F1.3: 合同编号');

  // ISO 编号
  const r3 = parseDocumentQuery('ISO 9001 质量体系');
  assert(r3.facets.entity_terms.some(e => e.includes('ISO')), 'F1.4: ISO编号');

  // 无实体的自然语言问题
  const r4 = parseDocumentQuery('合同违约金怎么算');
  assert(r4.facets.entity_terms.length === 0, 'F1.6: 无编号查询无实体词');

  console.log(`  entity_terms cases: passed`);
}

function testCase_Facets_ProcedureTerms() {
  console.log('\n📋 用例F2: 程序词提取');

  const r1 = parseDocumentQuery('这个试验怎么做');
  assert(r1.facets.procedure_terms.includes('试验'), 'F2.1: 试验');
  assert(r1.facets.procedure_terms.includes('怎么做'), 'F2.2: 怎么做');

  const r2 = parseDocumentQuery('验收条件和测试方法');
  assert(r2.facets.procedure_terms.includes('条件'), 'F2.2: 条件');
  assert(r2.facets.procedure_terms.includes('方法'), 'F2.3: 方法');
  assert(r2.facets.procedure_terms.includes('测试'), 'F2.4: 测试');

  const r3 = parseDocumentQuery('GB/T 12345 在哪里');
  assert(r3.facets.procedure_terms.length === 0, 'F2.5: 纯查找无程序词');

  console.log(`  procedure_terms cases: passed`);
}

function testCase_Facets_NormalizedLookup() {
  console.log('\n📋 用例F3: 归一化查找 query');

  const r1 = parseDocumentQuery('GB/T 12345-2020 的防水等级怎么规定');
  assert(r1.facets.normalized_lookup_query.length > 0, 'F3.1: 有 normalized query');
  assert(r1.facets.normalized_lookup_query.includes('GB/T 12345-2020'), 'F3.2: 包含标准编号');
  assert(r1.facets.normalized_lookup_query.includes('规定'), 'F3.3: 包含程序词');
  assert(!r1.facets.normalized_lookup_query.includes('怎么'), 'F3.4: 无口语词');

  // 纯编号查询（无主题词）
  const r2 = parseDocumentQuery('GB/T 12345-2020');
  assert(r2.facets.normalized_lookup_query === 'GB/T 12345-2020', 'F3.5: 纯编号保留');

  console.log(`  normalized_lookup_query cases: passed`);
}

testCase_Facets_EntityTerms();
testCase_Facets_ProcedureTerms();
testCase_Facets_NormalizedLookup();

console.log(`\n${'='.repeat(40)}`);
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) {
  process.exit(1);
}
