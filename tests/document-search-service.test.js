import DocumentSearchService from '../lib/document-search-service.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  ❌ FAIL: ${label}`);
  }
}

function makeDbMock(rows = []) {
  return {
    getModel: () => ({}),
    sequelize: {
      QueryTypes: { SELECT: 'SELECT' },
      query: async (sql, options) => {
        if (String(sql).includes('FROM documents d')) {
          return rows;
        }
        return [];
      },
    },
  };
}

function makeAccessService() {
  return {
    getAccessibleCollectionIds: async () => ['c1'],
  };
}

async function testCase1_CompactTopicRecallRanksHigher() {
  console.log('\n📋 场景1: 连续主题标题优先于零散命中');

  const rows = [
    {
      document_id: 'd1',
      document_title: 'GB/T 4780-2020 汽车车身术语',
      doc_type: 'standard',
      collection_id: 'c1',
      collection_name: 'test',
      revision_id: 'r1',
      revision_no: 1,
      revision_label: 'v1',
      relevance_score: 60,
    },
    {
      document_id: 'd2',
      document_title: '汽车行业术语报告（车身部分）',
      doc_type: 'report',
      collection_id: 'c1',
      collection_name: 'test',
      revision_id: 'r2',
      revision_no: 1,
      revision_label: 'v1',
      relevance_score: 62,
    },
  ];

  const service = new DocumentSearchService(makeDbMock(rows));
  service.accessService = makeAccessService();

  const result = await service.search('汽车车身 术语', { userId: 'u1', top_k: 10 });

  assert(result.candidates[0]?.document_id === 'd1', '1.1 连续主题标题应排到 top1');
  assert((result.candidates[0]?.topic_recall_boost || 0) > (result.candidates[1]?.topic_recall_boost || 0), '1.2 连续主题标题应获得更高主题 boost');
}

async function testCase2_LongTopicSplitHelpsRecall() {
  console.log('\n📋 场景2: 长主题词拆分后应识别核心词');

  const rows = [
    {
      document_id: 'd-ip',
      document_title: 'GB/T 4208-2017 外壳防护等级（IP代码）',
      doc_type: 'standard',
      collection_id: 'c1',
      collection_name: 'test',
      revision_id: 'r-ip',
      revision_no: 1,
      revision_label: 'v1',
      relevance_score: 55,
    },
  ];

  const service = new DocumentSearchService(makeDbMock(rows));
  service.accessService = makeAccessService();

  const result = await service.search('外壳防护等级', { userId: 'u1', top_k: 10 });

  assert(result.candidates.length === 1, '2.1 应返回候选');
  assert(result.candidates[0]?.topic_match_terms?.includes('防护等级') || result.candidates[0]?.topic_match_terms?.includes('外壳防护等级'), '2.2 应识别核心主题词命中');
}

console.log('╔══════════════════════════════════╗');
console.log('║  DocumentSearchService 排序测试 ║');
console.log('╚══════════════════════════════════╝');

await testCase1_CompactTopicRecallRanksHigher();
await testCase2_LongTopicSplitHelpsRecall();

console.log(`\n${'='.repeat(40)}`);
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) {
  process.exit(1);
}
