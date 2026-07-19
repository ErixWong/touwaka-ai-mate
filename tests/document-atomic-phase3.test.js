/**
 * Phase 3 测试：暂缓项裁决的 3 个实施项
 *
 * 覆盖：
 *   1. 跨文档桥接 hint（search_chunks_in_document 无命中时引导全库检索）
 *   2. candidates_analysis 多候选分组统计（数据面，无决策建议）
 *   3. coverage attribute 维度（替代完整参数闭合检测的裁剪版）
 *
 * 运行：node tests/document-atomic-phase3.test.js
 */

import DocumentAtomicTools from '../lib/document-atomic-tools.js';
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

const ctx = { userId: 'u1', user_id: 'u1', topicId: 'topic-p3' };

// ============================================================
// 场景 1：跨文档桥接 hint（无命中时引导 search_chunks_globally）
// ============================================================
console.log('\n场景 1：跨文档桥接 hint');
{
  const tm = Object.create(ToolManager.prototype);
  tm.db = null;
  tm.expertId = 'expert-test';
  tm._docAtomicTools = {
    searchChunksInDocument: async () => ({ success: true, chunks: [], total: 0 }),
  };
  tm._docHandleStore = new DocumentHandleStore();
  tm._docAccessService = { getAccessibleCollectionIds: async () => ['c1'] };

  const r = await tm._dispatchDocRetrievalTool('search_chunks_in_document', {
    content_query: '不存在的内容', document_ids: ['d1'],
  }, ctx, 't');

  assert(r.success === true, '无命中仍为成功（空结果非错误）');
  assert(r.chunks.length === 0, 'chunks 为空');
  assert(typeof r.hint === 'string' && r.hint.includes('search_chunks_globally'), 'hint 引导跨文档桥接', r.hint);
  assert(!r.chunkset, '无命中不产生 chunkset handle');

  // 有命中时不应有 bridge hint
  const tm2 = Object.create(ToolManager.prototype);
  tm2.db = null;
  tm2.expertId = 'expert-test';
  tm2._docAtomicTools = {
    searchChunksInDocument: async () => ({
      success: true,
      chunks: [{ chunk_id: 'c1', document_id: 'd1', document_title: 'A', content: 'x', score: 0.9 }],
      total: 1,
    }),
  };
  tm2._docHandleStore = new DocumentHandleStore();
  tm2._docAccessService = { getAccessibleCollectionIds: async () => ['c1'] };
  const r2 = await tm2._dispatchDocRetrievalTool('search_chunks_in_document', {
    content_query: 'x', document_ids: ['d1'],
  }, ctx, 't');
  assert(r2.success && !r2.hint, '有命中时不带 bridge hint');
}

// ============================================================
// 场景 2：candidates_analysis 分组统计（数据面）
// ============================================================
console.log('\n场景 2：candidates_analysis 分组统计');
{
  const mockSearch = {
    search: async () => ({
      success: true,
      candidates: [
        { document_id: 'd1', document_title: '标准A', doc_type: 'standard', collection_name: '库1' },
        { document_id: 'd2', document_title: '标准B', doc_type: 'standard', collection_name: '库1' },
        { document_id: 'd3', document_title: '合同C', doc_type: 'contract', collection_name: '库2' },
      ],
      total: 3,
    }),
    searchByAttachmentFilenames: async () => [],
    getDocumentInfo: async () => [],
  };
  const tools = new DocumentAtomicTools(null, null, { searchService: mockSearch });

  const r = await tools.searchDocumentsByMetadata({ metadata_query: '规定', user_id: 'u1' });
  assert(r.success === true, '检索成功');
  const ca = r.candidates_analysis;
  assert(ca, '多候选时 candidates_analysis 存在');
  assert(ca.total === 3, '候选总数正确');
  assert(ca.by_doc_type.standard === 2 && ca.by_doc_type.contract === 1, 'doc_type 分组正确', JSON.stringify(ca.by_doc_type));
  assert(ca.by_collection['库1'] === 2 && ca.by_collection['库2'] === 1, 'collection 分组正确');
  assert(ca.same_doc_type === false && ca.same_collection === false, '混合集合判定正确');

  // 纯统计数据：不含"建议合并/建议重选"类决策字段
  const keys = Object.keys(ca);
  assert(!keys.some(k => /suggest|recommend|should|action|mode/i.test(k)), '分组统计不含决策建议字段', keys.join(','));

  // 单候选/无候选时不产生
  const single = new DocumentAtomicTools(null, null, {
    searchService: {
      search: async () => ({ success: true, candidates: [{ document_id: 'd1', document_title: 'A', doc_type: 'standard' }], total: 1 }),
      searchByAttachmentFilenames: async () => [],
      getDocumentInfo: async () => [],
    },
  });
  const r2 = await single.searchDocumentsByMetadata({ metadata_query: 'x', user_id: 'u1' });
  assert(r2.candidates_analysis === undefined, '单候选不产生 candidates_analysis');
}

// ============================================================
// 场景 3：coverage attribute 维度
// ============================================================
console.log('\n场景 3：coverage attribute 维度');
{
  const tools = new DocumentAtomicTools(null, null);
  const chunks = [
    { chunk_id: 'c1', document_id: 'd1', document_title: '标准', content: '试验温度为 23℃，湿度为 50%。', seq: 3, score: 0.8 },
  ];
  const r = tools.rankChunksForQuestion({ question: '试验的温度是多少', chunks });
  assert(r.coverage, 'coverage 存在');
  assert(typeof r.coverage.attribute_total === 'number', 'attribute_total 字段存在');
  assert(Array.isArray(r.coverage.covered_attributes) && Array.isArray(r.coverage.missed_attributes), 'attribute 覆盖/未覆盖清单存在');

  // 既有维度不受影晌
  assert(typeof r.coverage.entity_total === 'number' && typeof r.coverage.procedure_total === 'number', 'entity/procedure 维度保留');
}

// ============================================================
console.log('\n' + '='.repeat(40));
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
