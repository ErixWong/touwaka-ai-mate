/**
 * DocumentAtomicTools 契约测试
 *
 * 验证六个原子 tool 的输入输出契约，使用构造函数 DI mock 不依赖数据库。
 *
 * audit-round01 Phase 1 交付物。
 * 运行：node tests/document-atomic-tools.test.js
 */

import DocumentAtomicTools from '../lib/document-atomic-tools.js';

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

function makeMockSearchService(overrides = {}) {
  return {
    search: async (q, opts) => (overrides.searchResult || { success: true, candidates: [], total: 0 }),
    searchByAttachmentFilenames: async (q, opts) => (overrides.attachResult || []),
    getDocumentInfo: async (ids) => (overrides.docInfo || []),
  };
}

function makeMockRecallService(overrides = {}) {
  return {
    recall: async (q, opts) => (overrides.globalResult || { success: true, items: [] }),
    recallWithinDocuments: async (q, docIds, opts) => (overrides.scopedResult || { success: true, items: [] }),
  };
}

function makeMockAccessService(accessibleIds = ['col-1']) {
  return {
    getAccessibleCollectionIds: async (uid) => accessibleIds,
  };
}

function makeMockDb(chunkRows = []) {
  return {
    sequelize: {
      query: async (sql, opts) => chunkRows,
      QueryTypes: { SELECT: 'SELECT' },
    },
  };
}

function makeAtomicTools(opts = {}) {
  return new DocumentAtomicTools(opts.db || makeMockDb(), null, {
    searchService: opts.searchService || makeMockSearchService(),
    recallService: opts.recallService || makeMockRecallService(),
    accessService: opts.accessService || makeMockAccessService(),
  });
}

// ============================================================
// 1. search_documents_by_metadata
// ============================================================

async function testSearchByMetadataDefault() {
  console.log('\n📋 AT-01: search_documents_by_metadata（标题+元数据）');

  const mockSearch = makeMockSearchService({
    searchResult: {
      success: true,
      candidates: [
        { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 95 },
      ],
      total: 1,
    },
  });
  const tools = makeAtomicTools({ searchService: mockSearch });

  const r = await tools.searchDocumentsByMetadata({
    metadata_query: 'GB/T 4208',
    user_id: 'u1',
  });

  assert(r.success, 'AT-01.1 success=true');
  assertEqual(r.matched_by, 'title_metadata', 'AT-01.2 matched_by title_metadata');
  assertEqual(r.documents.length, 1, 'AT-01.3 1 document');
  assertEqual(r.documents[0].document_id, 'd1', 'AT-01.4 doc id');
  assertEqual(r.total, 1, 'AT-01.5 total=1');
}

async function testSearchByAttachmentFilename() {
  console.log('\n📋 AT-02: search_documents_by_metadata（附件文件名）');

  const mockSearch = makeMockSearchService({
    attachResult: [
      { document_id: 'd2', document_title: 'Intake-001', best_identity_label: '施工合同附件A.pdf', matched_attachment: '施工合同附件A.pdf' },
    ],
  });
  const tools = makeAtomicTools({ searchService: mockSearch });

  const r = await tools.searchDocumentsByMetadata({
    metadata_query: '施工合同',
    user_id: 'u1',
    match_fields: ['attachment_filename'],
  });

  assert(r.success, 'AT-02.1 success=true');
  assertEqual(r.matched_by, 'attachment_filename', 'AT-02.2 matched_by');
  assertEqual(r.documents[0].matched_attachment, '施工合同附件A.pdf', 'AT-02.3 attachment name');
}

async function testSearchEmptyQuery() {
  console.log('\n📋 AT-03: search_documents_by_metadata（空 query 报错）');

  const tools = makeAtomicTools();
  const r = await tools.searchDocumentsByMetadata({ metadata_query: '', user_id: 'u1' });

  assert(!r.success, 'AT-03.1 success=false');
  assert(r.error, 'AT-03.2 有 error');
  assertEqual(r.documents.length, 0, 'AT-03.3 空 documents');
}

// ============================================================
// 2. read_document_content
// ============================================================

async function testReadDocumentContent() {
  console.log('\n📋 AT-04: read_document_content（正常读取）');

  const mockSearch = makeMockSearchService({
    docInfo: [{ document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_id: 'col-1', collection_name: '标准库' }],
  });
  const mockDb = makeMockDb([
    { chunk_id: 'c1', outline_id: 'o1', chunk_title: 'Ch1', content: 'IPX5试验：喷嘴内径6.3mm', seq: 1 },
    { chunk_id: 'c2', outline_id: 'o1', chunk_title: 'Ch2', content: '水流量12.5L/min', seq: 2 },
  ]);
  const tools = makeAtomicTools({
    searchService: mockSearch,
    db: mockDb,
  });

  const r = await tools.readDocumentContent({
    document_id: 'd1',
    user_id: 'u1',
    include_chunks: true,
    max_chars: 500,
  });

  assert(r.success, 'AT-04.1 success=true');
  assertEqual(r.document.document_id, 'd1', 'AT-04.2 doc id');
  assert(r.content.includes('IPX5试验'), 'AT-04.3 content 含第一个 chunk');
  assert(r.content.includes('12.5L/min'), 'AT-04.4 content 含第二个 chunk');
  assert(!r.content_truncated, 'AT-04.5 未截断');
  assertEqual(r.total_chunks, 2, 'AT-04.6 total_chunks=2');
  assertEqual(r.chunks.length, 2, 'AT-04.7 include_chunks 返回 chunk 列表');
}

async function testReadDocumentContentTruncated() {
  console.log('\n📋 AT-05: read_document_content（截断）');

  const mockSearch = makeMockSearchService({
    docInfo: [{ document_id: 'd1', document_title: 'Test', doc_type: 'standard', collection_id: 'col-1' }],
  });
  const mockDb = makeMockDb([
    { chunk_id: 'c1', outline_id: 'o1', chunk_title: '', content: 'A'.repeat(30), seq: 1 },
  ]);
  const tools = makeAtomicTools({ searchService: mockSearch, db: mockDb });

  const r = await tools.readDocumentContent({ document_id: 'd1', user_id: 'u1', max_chars: 10 });
  assert(r.success, 'AT-05.1 success');
  assert(r.content_truncated, 'AT-05.2 content_truncated=true');
  assert(r.content.length <= 10, 'AT-05.3 长度受 max_chars 限制');
}

async function testReadDocumentNotFound() {
  console.log('\n📋 AT-06: read_document_content（文档不存在）');

  const tools = makeAtomicTools({ searchService: makeMockSearchService({ docInfo: [] }) });
  const r = await tools.readDocumentContent({ document_id: 'nx', user_id: 'u1' });
  assert(!r.success, 'AT-06.1 success=false');
  assertEqual(r.error, 'document_not_found', 'AT-06.2 not found');
}

async function testReadDocumentAccessDenied() {
  console.log('\n📋 AT-07: read_document_content（无权限）');

  const mockSearch = makeMockSearchService({
    docInfo: [{ document_id: 'd1', document_title: 'Test', collection_id: 'col-secret' }],
  });
  const mockAccess = makeMockAccessService(['col-1']);
  const tools = makeAtomicTools({ searchService: mockSearch, accessService: mockAccess });
  const r = await tools.readDocumentContent({ document_id: 'd1', user_id: 'u1' });
  assert(!r.success, 'AT-07.1 success=false');
  assertEqual(r.error, 'access_denied', 'AT-07.2 access denied');
}

// ============================================================
// 3. search_chunks_in_document
// ============================================================

async function testSearchChunksInDocument() {
  console.log('\n📋 AT-08: search_chunks_in_document');

  const mockRecall = makeMockRecallService({
    scopedResult: {
      success: true,
      items: [
        { chunk: { id: 'c1', title: '条款X', content: '试验条件...', outline_id: 'o1', seq: 5 }, document: { id: 'd1', title: 'GB/T 4208', doc_type: 'standard', collection_id: 'col-1' }, revision: { id: 'r1' }, score: 0.85 },
      ],
    },
  });
  const tools = makeAtomicTools({ recallService: mockRecall });

  const r = await tools.searchChunksInDocument({
    content_query: '试验条件',
    document_ids: ['d1'],
    user_id: 'u1',
  });

  assert(r.success, 'AT-08.1 success=true');
  assertEqual(r.chunks.length, 1, 'AT-08.2 1 chunk');
  assertEqual(r.chunks[0].chunk_id, 'c1', 'AT-08.3 chunk_id');
  assertEqual(r.chunks[0].score, 0.85, 'AT-08.4 score');
  assertEqual(r.chunks[0].document_id, 'd1', 'AT-08.5 document_id');
}

async function testSearchChunksInDocumentNoTarget() {
  console.log('\n📋 AT-09: search_chunks_in_document（无目标文档）');

  const tools = makeAtomicTools();
  const r = await tools.searchChunksInDocument({
    content_query: 'test',
    document_ids: [],
    user_id: 'u1',
  });
  assert(r.success, 'AT-09.1 success=true（空目标不是错误）');
  assertEqual(r.total, 0, 'AT-09.2 total=0');
}

// ============================================================
// 4. search_chunks_globally
// ============================================================

async function testSearchChunksGlobally() {
  console.log('\n📋 AT-10: search_chunks_globally');

  const mockRecall = makeMockRecallService({
    globalResult: {
      success: true,
      items: [
        { chunk: { id: 'c1', title: 'Intro', content: '这是预览内容...', outline_id: 'o1', seq: 1 }, document: { id: 'd1', title: 'Doc A', doc_type: 'contract', collection_id: 'col-1' }, revision: { id: 'r1' }, score: 0.72 },
      ],
    },
  });
  const tools = makeAtomicTools({ recallService: mockRecall });

  const r = await tools.searchChunksGlobally({
    content_query: '重要条款',
    user_id: 'u1',
    top_k: 5,
  });

  assert(r.success, 'AT-10.1 success=true');
  assertEqual(r.chunks.length, 1, 'AT-10.2 1 chunk');
  assertEqual(r.chunks[0].content, '这是预览内容...', 'AT-10.3 content');
}

async function testSearchChunksGloballyEmptyQuery() {
  console.log('\n📋 AT-11: search_chunks_globally（空 query 报错）');

  const tools = makeAtomicTools();
  const r = await tools.searchChunksGlobally({ content_query: '', user_id: 'u1' });
  assert(!r.success, 'AT-11.1 success=false');
}

// ============================================================
// 5. rank_chunks_for_question
// ============================================================

function testRankChunksForQuestion() {
  console.log('\n📋 AT-12: rank_chunks_for_question');

  const tools = makeAtomicTools();
  const chunks = [
    { chunk_id: 'c1', document_id: 'd1', document_title: 'GB 4785', chunk_title: '车身术语', content: '本标准规定了汽车车身术语和定义...', score: 0.80, doc_type: 'standard', collection_id: 'c1', revision_id: 'r1', outline_id: 'o1', seq: 1 },
    { chunk_id: 'c2', document_id: 'd2', document_title: '其他标准', chunk_title: '通用', content: '这是一份通用的管理体系文件...', score: 0.75, doc_type: 'standard', collection_id: 'c1', revision_id: 'r2', outline_id: 'o2', seq: 1 },
  ];

  const r = tools.rankChunksForQuestion({
    question: '车身术语标准定义',
    chunks,
    locked_document_ids: ['d1'],
    top_k: 2,
  });

  assert(r.success, 'AT-12.1 success=true');
  assertEqual(r.total, 2, 'AT-12.2 total=2');
  assert(r.chunks[0].rank_score !== undefined, 'AT-12.3 有 rank_score');
  assert(r.chunks[0].rank_score > r.chunks[1].rank_score, 'AT-12.4 locked d1 排前面');
  assert(r.chunks[0].rank_signals.locked_bonus === 1, 'AT-12.5 locked_bonus=1');
  assert(r.chunks[1].rank_signals.locked_bonus === 0, 'AT-12.6 非锁定文档 locked_bonus=0');
}

function testRankChunksEmptyInput() {
  console.log('\n📋 AT-13: rank_chunks_for_question（空输入）');

  const tools = makeAtomicTools();
  const r = tools.rankChunksForQuestion({ question: 'test', chunks: [] });
  assert(r.success, 'AT-13.1 success=true');
  assertEqual(r.total, 0, 'AT-13.2 total=0');
}

function testRankChunksNullChunks() {
  console.log('\n📋 AT-14: rank_chunks_for_question（null chunks）');

  const tools = makeAtomicTools();
  const r = tools.rankChunksForQuestion({ question: 'test', chunks: null });
  assert(!r.success, 'AT-14.1 success=false');
}

// ============================================================
// 6. resolve_documents_from_chunks
// ============================================================

async function testResolveDocumentsFromChunks() {
  console.log('\n📋 AT-15: resolve_documents_from_chunks');

  const mockSearch = makeMockSearchService({
    docInfo: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_id: 'col-1', collection_name: '标准库' },
      { document_id: 'd2', document_title: '其他标准', doc_type: 'standard', collection_id: 'col-1', collection_name: '标准库' },
    ],
  });
  const tools = makeAtomicTools({ searchService: mockSearch });

  const chunks = [
    { document_id: 'd1', chunk_id: 'c1', content: 'A1', score: 0.9, doc_type: 'standard' },
    { document_id: 'd1', chunk_id: 'c2', content: 'A2', score: 0.7, doc_type: 'standard' },
    { document_id: 'd2', chunk_id: 'c3', content: 'B1', score: 0.3, doc_type: 'standard' },
  ];

  const r = await tools.resolveDocumentsFromChunks({
    chunks,
    aggregate: true,
  });

  assert(r.success, 'AT-15.1 success=true');
  assertEqual(r.documents.length, 2, 'AT-15.2 2 documents');
  // d1 应排在 d2 前面（max_chunk_score 更高）
  assertEqual(r.documents[0].document_id, 'd1', 'AT-15.3 d1 排第一');
  assertEqual(r.documents[0].chunk_count, 2, 'AT-15.4 d1 chunk_count=2');
  assertEqual(r.documents[0].max_chunk_score, 0.9, 'AT-15.5 max_chunk_score=0.9');
  assert(r.documents[0].top_chunk, 'AT-15.6 有 top_chunk');
  assertEqual(r.documents[1].chunk_count, 1, 'AT-15.7 d2 chunk_count=1');
}

async function testResolveDocumentsEmptyChunks() {
  console.log('\n📋 AT-16: resolve_documents_from_chunks（空输入）');

  const tools = makeAtomicTools();
  const r = await tools.resolveDocumentsFromChunks({ chunks: [] });
  assert(r.success, 'AT-16.1 success=true');
  assertEqual(r.total, 0, 'AT-16.2 total=0');
}

// ============================================================
// 运行
// ============================================================

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Document Atomic Tools 契约测试     ║');
  console.log('╚══════════════════════════════════════╝');

  await testSearchByMetadataDefault();
  await testSearchByAttachmentFilename();
  await testSearchEmptyQuery();
  await testReadDocumentContent();
  await testReadDocumentContentTruncated();
  await testReadDocumentNotFound();
  await testReadDocumentAccessDenied();
  await testSearchChunksInDocument();
  await testSearchChunksInDocumentNoTarget();
  await testSearchChunksGlobally();
  await testSearchChunksGloballyEmptyQuery();
  testRankChunksForQuestion();
  testRankChunksEmptyInput();
  testRankChunksNullChunks();
  await testResolveDocumentsFromChunks();
  await testResolveDocumentsEmptyChunks();

  console.log(`\n${'='.repeat(40)}`);
  console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
  console.log(`${'='.repeat(40)}`);

  if (failed > 0) process.exit(1);
}

main();
