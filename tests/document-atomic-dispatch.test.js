/**
 * 文档检索原子 tool dispatch 与名称-行为一致性测试（round02）
 *
 * 覆盖 round01 结论 §6 Phase 1 完成判据 ①②：
 *   ① 6 tool schema 与执行一一对应（dispatch 分派正确性）
 *   ② 每个 tool 的 atomic_steps ⊆ 该 tool 语义允许的最小步骤集，
 *     而非仅断言调用了正确方法：
 *       - search_documents_by_metadata → ['metadata_search']
 *       - read_document_content        → ['read_document']
 *       - search_chunks_in_document    → ['scoped_chunk_recall']
 *       - search_chunks_globally       → ['global_chunk_recall']
 *       - rank_chunks_for_question     → ['rank']（不得含任何检索步骤）
 *       - resolve_documents_from_chunks → ['resolve']（不得含任何检索步骤）
 *
 * 另覆盖：handle 真实交接链路、假 handle 拒绝、参数校验、
 * collection 预校验、旧 tool 名拒绝。
 *
 * 运行：node tests/document-atomic-dispatch.test.js
 */

import ToolManager from '../lib/tool-manager.js';
import { DocumentHandleStore } from '../lib/document-handle-store.js';

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

const ctx = { userId: 'u1', user_id: 'u1', topicId: 'topic-test' };

const sampleChunks = [
  { chunk_id: 'c1', document_id: 'd1', document_title: '标准A', doc_type: 'standard', content: 'IPX5 防水试验内容', score: 0.88 },
  { chunk_id: 'c2', document_id: 'd2', document_title: '回信2', doc_type: 'letter', content: '另一段内容', score: 0.62 },
];

/** 构建带 mock 的 ToolManager 实例（不触发构造器与 db） */
function makeToolManager(overrides = {}) {
  const tm = Object.create(ToolManager.prototype);
  tm.db = null;
  tm.expertId = 'expert-test';

  const calls = [];
  tm._docAtomicTools = {
    searchDocumentsByMetadata: async (p) => {
      calls.push('searchDocumentsByMetadata');
      return {
        success: true,
        matched_by: 'title_metadata',
        documents: [
          { document_id: 'd1', document_title: '标准A', doc_type: 'standard', collection_name: '库1', relevance_score: 0.91 },
          { document_id: 'd2', document_title: '回信2', doc_type: 'letter', collection_name: '库1', relevance_score: 0.73 },
        ],
        total: 2,
      };
    },
    readDocumentContent: async (p) => {
      calls.push('readDocumentContent');
      return {
        success: true,
        document: { document_id: p.document_id, document_title: '标准A' },
        content: '文档正文内容',
        content_truncated: false,
        total_chunks: 3,
      };
    },
    searchChunksInDocument: async (p) => {
      calls.push('searchChunksInDocument');
      return { success: true, chunks: sampleChunks, total: 2 };
    },
    searchChunksGlobally: async (p) => {
      calls.push('searchChunksGlobally');
      return { success: true, chunks: sampleChunks, total: 2 };
    },
    rankChunksForQuestion: (p) => {
      calls.push('rankChunksForQuestion');
      return {
        success: true,
        chunks: p.chunks.map(c => ({ ...c, rank_score: 0.95, rank_signals: { vector_score: 0.9 } })),
        total: p.chunks.length,
      };
    },
    resolveDocumentsFromChunks: async (p) => {
      calls.push('resolveDocumentsFromChunks');
      return {
        success: true,
        documents: [{ document_id: 'd1', document_title: '标准A', chunk_count: 2, max_chunk_score: 0.88 }],
        total: 1,
      };
    },
    ...overrides,
  };
  tm._docHandleStore = new DocumentHandleStore();
  tm._docAccessService = {
    getAccessibleCollectionIds: async () => ['col-allowed'],
  };
  return { tm, calls };
}

const EXPECTED_STEPS = {
  search_documents_by_metadata: ['metadata_search'],
  read_document_content: ['read_document'],
  search_chunks_in_document: ['scoped_chunk_recall'],
  search_chunks_globally: ['global_chunk_recall'],
  rank_chunks_for_question: ['rank'],
  resolve_documents_from_chunks: ['resolve'],
};

// ============================================================
// 场景 1：6 tool 一一分派 + atomic_steps ⊆ 最小步骤集
// ============================================================
console.log('\n场景 1：dispatch 一一分派 + atomic_steps 一致性');
{
  // search_documents_by_metadata
  let { tm, calls } = makeToolManager();
  let r = await tm._dispatchDocRetrievalTool('search_documents_by_metadata', { metadata_query: 'GB/T 4208' }, ctx, 't');
  assert(r.success && calls.join() === 'searchDocumentsByMetadata', 'search_documents_by_metadata → searchDocumentsByMetadata');
  assert(JSON.stringify(r.atomic_steps) === JSON.stringify(['metadata_search']), 'steps ⊆ [metadata_search]', JSON.stringify(r.atomic_steps));
  assert(typeof r.doc_ref === 'string' && r.doc_ref.startsWith('docref:'), '返回 doc_ref handle');

  // read_document_content
  ({ tm, calls } = makeToolManager());
  r = await tm._dispatchDocRetrievalTool('read_document_content', { document_id: 'd1' }, ctx, 't');
  assert(r.success && calls.join() === 'readDocumentContent', 'read_document_content → readDocumentContent');
  assert(JSON.stringify(r.atomic_steps) === JSON.stringify(['read_document']), 'steps ⊆ [read_document]');
  assert(r.content === '文档正文内容', '正文直接返回');

  // search_chunks_in_document（document_ids 直传）
  ({ tm, calls } = makeToolManager());
  r = await tm._dispatchDocRetrievalTool('search_chunks_in_document', { content_query: 'IPX5', document_ids: ['d1'] }, ctx, 't');
  assert(r.success && calls.join() === 'searchChunksInDocument', 'search_chunks_in_document → searchChunksInDocument');
  assert(JSON.stringify(r.atomic_steps) === JSON.stringify(['scoped_chunk_recall']), 'steps ⊆ [scoped_chunk_recall]');
  assert(typeof r.chunkset === 'string' && r.chunkset.startsWith('chunkset:'), '返回 chunkset handle');

  // search_chunks_globally
  ({ tm, calls } = makeToolManager());
  r = await tm._dispatchDocRetrievalTool('search_chunks_globally', { content_query: 'IPX5' }, ctx, 't');
  assert(r.success && calls.join() === 'searchChunksGlobally', 'search_chunks_globally → searchChunksGlobally');
  assert(JSON.stringify(r.atomic_steps) === JSON.stringify(['global_chunk_recall']), 'steps ⊆ [global_chunk_recall]');
}

// ============================================================
// 场景 2：rank / resolve 不做任何新检索（数据交接层原子化）
// ============================================================
console.log('\n场景 2：rank / resolve 消费 handle，不重新检索');
{
  const { tm, calls } = makeToolManager();

  // 先产生 chunkset
  const search = await tm._dispatchDocRetrievalTool('search_chunks_globally', { content_query: 'IPX5' }, ctx, 't');
  assert(search.success && search.chunkset, '前置：获得 chunkset');
  calls.length = 0; // 清空调用记录

  // rank：只准调 rankChunksForQuestion，不准出现任何 search 调用
  const ranked = await tm._dispatchDocRetrievalTool('rank_chunks_for_question', { question: '防水等级？', chunkset: search.chunkset }, ctx, 't');
  assert(ranked.success, 'rank 成功');
  assert(calls.join() === 'rankChunksForQuestion', 'rank 只调 rankChunksForQuestion，无新检索', calls.join());
  assert(JSON.stringify(ranked.atomic_steps) === JSON.stringify(['rank']), 'rank steps ⊆ [rank]（无检索步骤）');
  assert(typeof ranked.rankedset === 'string' && ranked.rankedset.startsWith('rankedset:'), '返回 rankedset handle');
  assert(ranked.chunks[0].rank_score === 0.95, 'rank_score 透传到摘要');

  calls.length = 0;
  // resolve：只准调 resolveDocumentsFromChunks
  const resolvedDocs = await tm._dispatchDocRetrievalTool('resolve_documents_from_chunks', { chunkset: ranked.rankedset }, ctx, 't');
  assert(resolvedDocs.success, 'resolve 成功');
  assert(calls.join() === 'resolveDocumentsFromChunks', 'resolve 只调 resolveDocumentsFromChunks，无新检索', calls.join());
  assert(JSON.stringify(resolvedDocs.atomic_steps) === JSON.stringify(['resolve']), 'resolve steps ⊆ [resolve]');
  assert(resolvedDocs.documents[0].document_id === 'd1', '聚合文档视图正确');
}

// ============================================================
// 场景 3：完整链路交接（search → rank → resolve，数据真实交接）
// ============================================================
console.log('\n场景 3：完整链路交接');
{
  const { tm } = makeToolManager();
  const s = await tm._dispatchDocRetrievalTool('search_chunks_in_document', { content_query: '试验条件', document_ids: ['d1'] }, ctx, 't');
  const rk = await tm._dispatchDocRetrievalTool('rank_chunks_for_question', { question: '试验条件？', chunkset: s.chunkset }, ctx, 't');
  const rv = await tm._dispatchDocRetrievalTool('resolve_documents_from_chunks', { chunkset: rk.rankedset }, ctx, 't');
  assert(s.success && rk.success && rv.success, '三步链路全部成功');
  assert(rv.documents[0].chunk_count === 2, 'resolve 基于真实交接的 2 条 chunk 聚合', `chunk_count=${rv.documents[0].chunk_count}`);
}

// ============================================================
// 场景 4：doc_ref 交接（search metadata → search_chunks_in_document）
// ============================================================
console.log('\n场景 4：doc_ref 交接');
{
  const { tm, calls } = makeToolManager();
  const meta = await tm._dispatchDocRetrievalTool('search_documents_by_metadata', { metadata_query: '标准' }, ctx, 't');
  assert(meta.doc_ref, '获得 doc_ref');

  const scoped = await tm._dispatchDocRetrievalTool('search_chunks_in_document', { content_query: 'IPX5', doc_ref: meta.doc_ref }, ctx, 't');
  assert(scoped.success, 'doc_ref 解引用成功并执行检索');
  assert(scoped.searched_document_ids.length === 2, '目标文档来自 doc_ref payload（2 个）', JSON.stringify(scoped.searched_document_ids));
}

// ============================================================
// 场景 5：假 handle / 跳步伪造被拒绝（统一错误 + hint）
// ============================================================
console.log('\n场景 5：假 handle / 跳步伪造被拒绝');
{
  const { tm } = makeToolManager();
  const r1 = await tm._dispatchDocRetrievalTool('rank_chunks_for_question', { question: 'q', chunkset: 'chunkset:fake-uuid' }, ctx, 't');
  assert(r1.success === false && r1.error === 'handle_not_found_or_expired', '伪造 chunkset 被拒绝');
  assert(typeof r1.hint === 'string' && r1.hint.includes('search_chunks'), 'hint 指引重新调用上游检索', r1.hint);

  const r2 = await tm._dispatchDocRetrievalTool('resolve_documents_from_chunks', { chunkset: 'chunkset:fake-uuid' }, ctx, 't');
  assert(r2.success === false && r2.error === 'handle_not_found_or_expired', 'resolve 伪造 handle 被拒绝');
}

// ============================================================
// 场景 6：参数校验
// ============================================================
console.log('\n场景 6：参数校验');
{
  const { tm } = makeToolManager();
  const e1 = await tm._dispatchDocRetrievalTool('search_documents_by_metadata', {}, ctx, 't');
  assert(e1.success === false && e1.error.includes('metadata_query'), '缺 metadata_query 拒绝');

  const e2 = await tm._dispatchDocRetrievalTool('read_document_content', {}, ctx, 't');
  assert(e2.success === false && e2.error.includes('document_id'), '缺 document_id 拒绝');
  assert(e2.hint && e2.hint.includes('search_documents_by_metadata'), '缺 document_id 的 hint 指向上游');

  const e3 = await tm._dispatchDocRetrievalTool('search_chunks_in_document', { content_query: 'q' }, ctx, 't');
  assert(e3.success === false && e3.error.includes('target documents'), 'document_ids 与 doc_ref 全缺拒绝');

  const e4 = await tm._dispatchDocRetrievalTool('rank_chunks_for_question', { question: 'q' }, ctx, 't');
  assert(e4.success === false && e4.error.includes('chunkset'), '缺 chunkset 拒绝');
}

// ============================================================
// 场景 7：collection 预校验（权限硬边界，诚实错误）
// ============================================================
console.log('\n场景 7：collection 预校验');
{
  const { tm, calls } = makeToolManager();
  const denied = await tm._dispatchDocRetrievalTool('search_chunks_globally', { content_query: 'q', collection_id: 'col-denied' }, ctx, 't');
  assert(denied.success === false && denied.error === 'collection_not_accessible', '不可访问集合返回诚实错误');
  assert(calls.length === 0, '预校验拒绝时不触达原子层', calls.join());

  const allowed = await tm._dispatchDocRetrievalTool('search_chunks_globally', { content_query: 'q', collection_id: 'col-allowed' }, ctx, 't');
  assert(allowed.success === true, '可访问集合正常放行');
}

// ============================================================
// 场景 8：旧 tool 名被拒绝
// ============================================================
console.log('\n场景 8：旧 tool 名被拒绝');
{
  const { tm } = makeToolManager();
  for (const oldTool of ['answer_from_documents', 'find_document', 'verify_fact']) {
    assert(tm._isDocRetrievalTool(oldTool) === false, `_isDocRetrievalTool 拒绝旧名 ${oldTool}`);
    const r = await tm._dispatchDocRetrievalTool(oldTool, { query: 'q' }, ctx, 't');
    assert(r.success === false && r.error.includes('Unknown document retrieval tool'), `dispatch 拒绝旧名 ${oldTool}`);
  }
  for (const newTool of Object.keys(EXPECTED_STEPS)) {
    assert(tm._isDocRetrievalTool(newTool) === true, `_isDocRetrievalTool 接受新名 ${newTool}`);
  }
}

// ============================================================
// 场景 9：原子层失败透传（不做伪装成功）
// ============================================================
console.log('\n场景 9：原子层失败透传');
{
  const { tm } = makeToolManager({
    searchChunksGlobally: async () => ({ success: false, error: 'recall_failed', chunks: [], total: 0 }),
  });
  const r = await tm._dispatchDocRetrievalTool('search_chunks_globally', { content_query: 'q' }, ctx, 't');
  assert(r.success === false && r.error === 'recall_failed', '原子层错误原样透传');
  assert(!r.chunkset, '失败时不产生 handle');
}

// ============================================================
// 场景 10：越权 handle 跨话题被拒绝（经 dispatch 全链路）
// ============================================================
console.log('\n场景 10：越权 handle 跨话题被拒绝');
{
  const { tm } = makeToolManager();
  const s = await tm._dispatchDocRetrievalTool('search_chunks_globally', { content_query: 'q' }, ctx, 't');
  const otherTopicCtx = { userId: 'u1', user_id: 'u1', topicId: 'topic-other' };
  const r = await tm._dispatchDocRetrievalTool('rank_chunks_for_question', { question: 'q', chunkset: s.chunkset }, otherTopicCtx, 't');
  assert(r.success === false && r.error === 'handle_not_found_or_expired', '跨话题使用 handle 被拒绝');
}

// ============================================================
console.log('\n' + '='.repeat(40));
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
