/**
 * Phase 2 测试：parser 集成 + 四维 rerank + coverage meta
 *
 * 覆盖 round01 结论 §6 Phase 2 完成判据：
 *   - rankChunksForQuestion 四维信号（entity/procedure/structural/title_hit/locked_bonus）
 *   - 新公式 min(1, 0.45v+0.30e+0.15p+0.10s+0.05t+0.05l)
 *   - coverage 覆盖统计（covered/missed entities & procedures）
 *   - searchDocumentsByMetadata 的 parser 预处理（cleaned_query、doc_type 推断、query_parse 透传）
 *
 * 运行：node tests/document-atomic-phase2.test.js
 */

import DocumentAtomicTools from '../lib/document-atomic-tools.js';

let passed = 0;
let failed = 0;

function assert(cond, name, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

const approx = (a, b, eps = 0.001) => Math.abs(a - b) < eps;

// 纯函数测试：db=null（rankChunksForQuestion 不触达服务层）
const tools = new DocumentAtomicTools(null, null);

// ============================================================
// 场景 1：四维信号计算（entity / procedure / structural / title / locked）
// ============================================================
console.log('\n场景 1：四维信号计算');
{
  const chunks = [
    {
      chunk_id: 'c1',
      document_id: 'd1',
      document_title: 'GB/T 4208 外壳防护等级',
      chunk_title: 'IPX5 试验条件',
      content: 'IPX5 防水试验：喷嘴内径 6.3mm，按 14.2.5 条款执行喷水试验。',
      seq: 5,
      score: 0.8,
    },
  ];
  const r = tools.rankChunksForQuestion({ question: 'IPX5 防水试验条件是什么', chunks });
  assert(r.success === true, 'rank 成功');
  const s = r.chunks[0].rank_signals;

  assert(s.entity_score > 0, 'entity_score > 0（IPX5 命中）', `entity=${s.entity_score}`);
  assert(s.procedure_score > 0, 'procedure_score > 0（试验命中）', `procedure=${s.procedure_score}`);
  assert(s.structural_score === 1.0, 'structural_score=1.0（章节号 14.2.5 + 数字实体命中）', `structural=${s.structural_score}`);
  assert(s.title_hit === 1, 'title_hit=1（标题含 IPX5）');
  assert(s.matched_entities.length > 0, 'matched_entities 可审计', JSON.stringify(s.matched_entities));
}

// ============================================================
// 场景 2：新公式验证
// ============================================================
console.log('\n场景 2：rank_score 公式 = min(1, 0.45v+0.30e+0.15p+0.10s+0.05t+0.05l)');
{
  const chunks = [{
    chunk_id: 'c1', document_id: 'd1', document_title: '标准A',
    content: 'IPX5 试验内容 14.2.5', seq: 5, score: 0.8,
  }];
  const r = tools.rankChunksForQuestion({ question: 'IPX5 试验', chunks });
  const s = r.chunks[0].rank_signals;
  const expected = Math.min(1.0,
    0.45 * s.vector_score +
    0.30 * s.entity_score +
    0.15 * s.procedure_score +
    0.10 * s.structural_score +
    0.05 * s.title_hit +
    0.05 * s.locked_bonus
  );
  assert(approx(r.chunks[0].rank_score, Math.round(expected * 10000) / 10000), 'rank_score 与六维公式一致',
    `actual=${r.chunks[0].rank_score} expected=${expected}`);
}

// ============================================================
// 场景 3：structural 启发式边界
// ============================================================
console.log('\n场景 3：structural 启发式边界');
{
  // 低 seq 且无章节号 → 0.4
  const r1 = tools.rankChunksForQuestion({
    question: '概述',
    chunks: [{ chunk_id: 'c1', document_id: 'd1', document_title: '文档', content: '本文档为概述性介绍。', seq: 1, score: 0.5 }],
  });
  assert(r1.chunks[0].rank_signals.structural_score === 0.4, '低 seq 无章节号 → 0.4', `actual=${r1.chunks[0].rank_signals.structural_score}`);

  // 表格/条款关键词 → ≥0.7
  const r2 = tools.rankChunksForQuestion({
    question: '费用表',
    chunks: [{ chunk_id: 'c2', document_id: 'd1', document_title: '文档', content: '见下表：费用明细表格。', seq: 8, score: 0.5 }],
  });
  assert(r2.chunks[0].rank_signals.structural_score >= 0.7, '表格关键词 → ≥0.7', `actual=${r2.chunks[0].rank_signals.structural_score}`);
}

// ============================================================
// 场景 4：locked_bonus 生效
// ============================================================
console.log('\n场景 4：locked_bonus 生效');
{
  const chunks = [
    { chunk_id: 'c1', document_id: 'd1', document_title: '文档A', content: '内容甲', seq: 5, score: 0.7 },
    { chunk_id: 'c2', document_id: 'd2', document_title: '文档B', content: '内容乙', seq: 5, score: 0.7 },
  ];
  const r = tools.rankChunksForQuestion({ question: '内容', chunks, locked_document_ids: ['d2'] });
  const locked = r.chunks.find(c => c.document_id === 'd2');
  const unlocked = r.chunks.find(c => c.document_id === 'd1');
  assert(locked.rank_signals.locked_bonus === 1 && unlocked.rank_signals.locked_bonus === 0, '锁定文档加权');
  assert(locked.rank_score > unlocked.rank_score, '锁定文档 rank_score 更高');
}

// ============================================================
// 场景 5：coverage 覆盖统计
// ============================================================
console.log('\n场景 5：coverage 覆盖统计');
{
  const chunks = [
    { chunk_id: 'c1', document_id: 'd1', document_title: '标准', content: 'IPX5 防水试验条件说明。', seq: 3, score: 0.8 },
  ];
  const r = tools.rankChunksForQuestion({ question: 'IPX5 和 IPX7 的试验差异', chunks });
  assert(r.coverage, 'coverage 字段存在');
  assert(r.coverage.covered_entities.some(e => /IPX5/i.test(e)), 'IPX5 被覆盖');
  assert(r.coverage.missed_entities.some(e => /IPX7/i.test(e)), 'IPX7 标记为未覆盖（证据充分性数据）');
  assert(Array.isArray(r.coverage.covered_procedures), 'procedure 覆盖统计存在');
}

// ============================================================
// 场景 6：parser 兜底（简易分词接管）
// ============================================================
console.log('\n场景 6：entity 词源兜底');
{
  const chunks = [
    { chunk_id: 'c1', document_id: 'd1', document_title: 'Doc', content: 'waterproof testing conditions', seq: 3, score: 0.6 },
  ];
  // 纯英文问题：parser 实体提取可能为空，_extractTerms 兜底接管
  const r = tools.rankChunksForQuestion({ question: 'waterproof testing', chunks });
  assert(r.success === true, '兜底路径 rank 成功');
  assert(r.coverage.entity_total >= 0, 'entity 词源兜底不崩溃');
}

// ============================================================
// 场景 7：metadata 检索 parser 预处理
// ============================================================
console.log('\n场景 7：searchDocumentsByMetadata parser 预处理');
{
  const searchCalls = [];
  const mockSearch = {
    search: async (query, opts) => {
      searchCalls.push({ query, opts });
      return { success: true, candidates: [{ document_id: 'd1', document_title: '标准A' }], total: 1 };
    },
    searchByAttachmentFilenames: async () => [],
    getDocumentInfo: async () => [],
  };
  const t = new DocumentAtomicTools(null, null, { searchService: mockSearch });

  // 7a：doc_type 推断（未显式传 doc_types）
  const r1 = await t.searchDocumentsByMetadata({ metadata_query: 'GB/T 4208 这份标准讲了什么', user_id: 'u1' });
  assert(r1.success === true, '预处理检索成功');
  assert(searchCalls[0].query.includes('GB') || searchCalls[0].query.includes('4208'), '检索词含编号（cleaned_query 编号优先）', searchCalls[0].query);
  assert(r1.query_parse && Array.isArray(r1.query_parse.identifier_hints), 'query_parse 透传编号识别结果');
  assert(r1.query_parse.identifier_hints.length > 0, '识别出标准编号', JSON.stringify(r1.query_parse.identifier_hints));

  // 7b：显式 doc_types 不被推断覆盖
  searchCalls.length = 0;
  await t.searchDocumentsByMetadata({ metadata_query: '这份标准的内容', user_id: 'u1', doc_types: ['contract'] });
  assert(JSON.stringify(searchCalls[0].opts.doc_types) === JSON.stringify(['contract']), '显式 doc_types 优先于推断');
}

// ============================================================
console.log('\n' + '='.repeat(40));
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
