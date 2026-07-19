/**
 * chat-service 真原子化消费层测试（round02）
 *
 * 覆盖 round01 结论 §3/§4：
 *   - _collectDocRetrievalResults：聚合一轮中全部原子结果（而非只取第一个）
 *   - buildEvidenceInjection：静态规则前置 + read 正文 / chunks / 候选分段聚合 + token 预算
 *   - _detectChainPattern：链路形态判定（content_chain / meta_only / unranked_chunks）
 *   - _consumeDocRetrievalResult：新契约 { found, docRetrievalResults, evidenceInjection, chainHealth }
 *
 * 运行：node tests/chat-service-atomic-consumption.test.js
 */

import { ExpertChatService } from '../lib/chat-service.js';

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

// 用原型实例（消费层方法为纯方法，不依赖构造状态）
const svc = Object.create(ExpertChatService.prototype);

const metaResult = {
  success: true,
  tool_name: 'search_documents_by_metadata',
  skill_namespace: 'document_retrieval',
  atomic_steps: ['metadata_search'],
  documents: [
    { document_id: 'd1', document_title: '标准A', doc_type: 'standard', relevance_score: 0.91 },
  ],
  total: 1,
};

const readResult = {
  success: true,
  tool_name: 'read_document_content',
  skill_namespace: 'document_retrieval',
  atomic_steps: ['read_document'],
  document: { document_id: 'd1', document_title: '标准A' },
  content: 'IPX5 防水等级试验条件：喷水试验，喷嘴内径 6.3mm。',
  content_truncated: false,
  total_chunks: 3,
};

const rankResult = {
  success: true,
  tool_name: 'rank_chunks_for_question',
  skill_namespace: 'document_retrieval',
  atomic_steps: ['rank'],
  chunks: [
    { chunk_id: 'c1', document_id: 'd1', document_title: '标准A', content: 'IPX5 防水试验片段', score: 0.88, rank_score: 0.95 },
    { chunk_id: 'c2', document_id: 'd2', document_title: '回信2', content: '另一片段', score: 0.60, rank_score: 0.61 },
  ],
  total: 2,
};

const globalResult = {
  success: true,
  tool_name: 'search_chunks_globally',
  skill_namespace: 'document_retrieval',
  atomic_steps: ['global_chunk_recall'],
  chunks: [
    { chunk_id: 'c1', document_id: 'd1', document_title: '标准A', content: 'IPX5 防水试验片段', score: 0.88 },
  ],
  total: 1,
};

const otherSkillResult = {
  success: true,
  tool_name: 'web_search',
  skill_namespace: 'web',
  atomic_steps: ['web_search'],
};

// ============================================================
// 场景 1：聚合全部原子结果（而非只取第一个）
// ============================================================
console.log('\n场景 1：_collectDocRetrievalResults 聚合');
{
  const results = svc._collectDocRetrievalResults([metaResult, readResult, rankResult]);
  assert(results.length === 3, '聚合全部 3 个原子结果', `actual=${results.length}`);
  assert(results[0].tool_name === 'search_documents_by_metadata', '保持调用顺序');

  const onlyDoc = svc._collectDocRetrievalResults([metaResult, otherSkillResult]);
  assert(onlyDoc.length === 1, '非 document_retrieval 结果被过滤');

  const failedResult = { success: false, skill_namespace: 'document_retrieval', tool_name: 'x' };
  const noFail = svc._collectDocRetrievalResults([failedResult, metaResult]);
  assert(noFail.length === 1, '失败结果被过滤');

  assert(svc._collectDocRetrievalResults([]).length === 0, '空数组返回空');
  assert(svc._collectDocRetrievalResults(null).length === 0, 'null 返回空');
}

// ============================================================
// 场景 2：buildEvidenceInjection 聚合输出
// ============================================================
console.log('\n场景 2：buildEvidenceInjection 聚合');
{
  const injection = svc.buildEvidenceInjection([metaResult, readResult, rankResult]);

  assert(injection.includes('文档检索证据使用规则'), '静态证据规则前置');
  assert(injection.indexOf('文档检索证据使用规则') < injection.indexOf('文档正文'), '规则在最前');

  assert(injection.includes('文档正文：《标准A》'), 'read 正文段存在');
  assert(injection.includes('IPX5 防水等级试验条件'), '正文内容注入');

  assert(injection.includes('相关内容片段'), 'chunks 段存在');
  assert(injection.includes('IPX5 防水试验片段'), 'chunk 内容注入');

  assert(injection.includes('检索到的文档候选'), '候选元信息段存在');
  assert(injection.includes('document_id: d1'), '候选含 document_id（供后续 read 使用）');
}

// ============================================================
// 场景 3：token 预算截断
// ============================================================
console.log('\n场景 3：token 预算截断');
{
  const bigRead = {
    ...readResult,
    content: 'x'.repeat(10000),
  };
  const injection = svc.buildEvidenceInjection([bigRead, rankResult], { maxTokens: 100 });
  assert(injection.includes('内容超预算截断'), '超预算内容被截断标记');
  assert(injection.length < 10000, '总输出受预算约束', `len=${injection.length}`);
}

// ============================================================
// 场景 4：_detectChainPattern 链路形态判定
// ============================================================
console.log('\n场景 4：_detectChainPattern 形态判定');
{
  const p1 = svc._detectChainPattern([metaResult, readResult]);
  assert(p1.pattern === 'content_chain', 'metadata + read → content_chain', p1.pattern);

  const p2 = svc._detectChainPattern([globalResult, rankResult]);
  assert(p2.pattern === 'content_chain', 'global + rank → content_chain', p2.pattern);

  const p3 = svc._detectChainPattern([metaResult]);
  assert(p3.pattern === 'meta_only', '仅 metadata → meta_only', p3.pattern);

  const p4 = svc._detectChainPattern([globalResult]);
  assert(p4.pattern === 'unranked_chunks', '有召回无 rank → unranked_chunks', p4.pattern);

  const p5 = svc._detectChainPattern([]);
  assert(p5.pattern === 'meta_only' && p5.steps.length === 0, '空结果安全兜底');
}

// ============================================================
// 场景 5：_consumeDocRetrievalResult 新契约
// ============================================================
console.log('\n场景 5：_consumeDocRetrievalResult 新契约');
{
  const consumption = svc._consumeDocRetrievalResult([metaResult, readResult], { caller: 'test' });
  assert(consumption.found === true, 'found=true');
  assert(consumption.docRetrievalResults.length === 2, '聚合结果数组');
  assert(typeof consumption.evidenceInjection === 'string' && consumption.evidenceInjection.length > 0, 'evidenceInjection 产出');
  assert(consumption.chainHealth?.pattern === 'content_chain', 'chainHealth 产出');

  const empty = svc._consumeDocRetrievalResult([otherSkillResult], { caller: 'test' });
  assert(empty.found === false && empty.evidenceInjection === null, '无文档检索结果时 found=false');

  // 契约不再包含旧字段
  assert(!('modeDecision' in consumption), '契约不含旧 modeDecision 字段');
  assert(!('docRetrievalResult' in consumption), '契约不含旧单结果字段');
}

// ============================================================
// 场景 6：静态规则文本要点（prompt 主防线）
// ============================================================
console.log('\n场景 6：静态证据规则文本要点');
{
  const rules = svc._buildEvidenceUsageRules();
  assert(rules.includes('禁止'), '含禁止性条款');
  assert(rules.includes('handle_not_found_or_expired'), '含 handle 过期行为说明');
  assert(rules.includes('read_document_content') || rules.includes('search_chunks'), '含内容级工具指引');
  assert(rules.includes('根据文档原文'), '含"未获正文禁止声称原文"条款');
}

// ============================================================
// 场景 7：search + rank 同一批 chunk 不重复注入（round03 去重修复）
// ============================================================
console.log('\n场景 7：chunk 按 chunk_id 去重');
{
  // globalResult 与 rankResult 携带同一 chunk_id: c1
  const injection = svc.buildEvidenceInjection([globalResult, rankResult]);
  const occurrences = (injection.match(/IPX5 防水试验片段/g) || []).length;
  assert(occurrences === 1, '同一 chunk_id 只注入一次（rank 版本优先）', `occurrences=${occurrences}`);
  assert(injection.includes('95%'), '去重后保留 rank_score 版本（95% 而非原始 88%）');
}

// ============================================================
console.log('\n' + '='.repeat(40));
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
