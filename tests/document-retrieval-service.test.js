/**
 * DocumentRetrievalService 真实编排层测试
 *
 * audit-round03 P1-1: 真实编排验证
 * audit-round04 P1-3: 类型偏好重排 + Round 2 组合场景
 *
 * 运行：node tests/document-retrieval-service.test.js
 */

import DocumentRetrievalService from '../lib/document-retrieval-service.js';
import logger from '../lib/logger.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${label}`); }
}

// ============================================================
// Mock helpers
// ============================================================
function makeDbMock() {
  return { query: () => [], execute: () => {}, getModel: () => ({}) };
}

function makeConfigLoaderMock() {
  return { get: () => ({}), getModel: () => ({}) };
}

function makeCandidate(id, title, score, docType = 'standard') {
  return { document_id: id, document_title: title, relevance_score: score, doc_type: docType, revision_id: id + '-rev' };
}

// ============================================================
// 场景 1：allow_fallback=false + chunk_first 建议 → 不被抢占
// ============================================================
async function testCase1_NoChunkFirstBypass() {
  console.log('\n📋 场景1: find_document 不被 chunk-first 抢占');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  // Stub DecisionService: 返回 chunk_first 建议
  svc.decisionService.analyze = () => ({
    intent: 'content_exploration',
    anchor_strength: 'none',
    confidence: 0.3,
    matched_patterns: [],
    reason_codes: ['no_document_anchor'],
    recommended_strategy: 'chunk_first',
  });

  // Stub SearchService: 返回零候选（触发降级路径）
  // 注意：当 decision 建议 chunk_first 但 allow_fallback=false 时，应绕过 bypass，
  // 继续走 document-first（搜索返回零候选 → 尝试扩召 → 降级）
  svc.searchService.search = async () => ({
    success: true, candidates: [], total: 0, strategy: 'empty',
  });

  const result = await svc.retrieve('纯内容探索问题', {
    userId: 'u1',
    allow_fallback: false,  // find_document 场景
  });

  // 不应该走 chunk_first_fallback 策略
  assert(result.strategy !== 'chunk_first_fallback',
    '1.1 allow_fallback=false 时不应被 chunk_first 抢占');
  // 零候选应降级
  assert(result.strategy === 'degrade',
    '1.2 零候选应降级 (degrade)');
  assert(result.packet.meta.reason_codes.includes('no_candidates'),
    '1.3 reason_codes 应包含 no_candidates');
}

// ============================================================
// 场景 2：Round 1 低质量 → Round 2 触发 + 最终 meta 使用 R2 质量
// ============================================================
async function testCase2_Round2QualityWriteback() {
  console.log('\n📋 场景2: Round 1 低分 → Round 2 命中 → meta 反映 R2 质量');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  svc.decisionService.analyze = () => ({
    intent: 'document_lookup',
    anchor_strength: 'medium',
    confidence: 0.6,
    matched_patterns: ['标准'],
    reason_codes: ['medium_anchor_detected'],
    recommended_strategy: 'document_first',
  });

  let searchCallCount = 0;

  svc.searchService.search = async (query) => {
    searchCallCount++;
    if (searchCallCount === 1) {
      // Round 1: 返回低分候选（score=30 < 50）
      return {
        success: true,
        candidates: [makeCandidate('d1', '低分文档', 30)],
        total: 1,
        strategy: 'title_match',
      };
    }
    // Round 2: 扩召命中高分候选
    return {
      success: true,
      candidates: [makeCandidate('d2', '高分目标文档', 85)],
      total: 1,
      strategy: 'title_match',
    };
  };

  // Stub: recall 返回最小有效证据
  svc._ensureRecallService = () => {};
  svc.recallService = {
    recallWithinDocuments: async () => ({
      success: true,
      items: [{ score: 0.8, content: 'test chunk', document: { id: 'd2' } }],
    }),
  };

  const result = await svc.retrieve('汽车车身术语', {
    userId: 'u1',
    allow_fallback: true,
  });

  // Round 2 应被触发（因为 top1 分数 30 < 50）
  assert(searchCallCount >= 2, '2.1 Round 2 应被触发（search 被调用 >= 2 次）');

  // 最终 meta 的 candidate_quality 应反映 Round 2 结果
  assert(result.packet.meta.candidate_quality === 'good',
    '2.2 最终 candidate_quality 应为 good（Round 2 高分）');
  assert(result.packet.meta.document_recall_round === 2,
    '2.3 document_recall_round 应为 2');
}

// ============================================================
// 场景 3：Round 1 高分 → 不触发 Round 2
// ============================================================
async function testCase3_NoExpansionNeeded() {
  console.log('\n📋 场景3: Round 1 高分 → 不触发 Round 2');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  svc.decisionService.analyze = () => ({
    intent: 'document_lookup',
    anchor_strength: 'strong',
    confidence: 0.9,
    matched_patterns: ['GB/T'],
    reason_codes: ['strong_anchor_detected'],
    recommended_strategy: 'document_first',
  });

  let searchCallCount = 0;

  svc.searchService.search = async () => {
    searchCallCount++;
    return {
      success: true,
      candidates: [makeCandidate('d1', 'GB/T 汽车术语标准', 100)],
      total: 1,
      strategy: 'title_match',
    };
  };

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recallWithinDocuments: async () => ({
      success: true,
      items: [{ score: 0.9, content: 'test', document: { id: 'd1' } }],
    }),
  };

  const result = await svc.retrieve('GB/T 12345-2020', {
    userId: 'u1',
    allow_fallback: true,
  });

  // Round 2 不应触发（高分候选）
  assert(searchCallCount === 1, '3.1 search 只应被调用 1 次（无 Round 2）');
  assert(result.packet.meta.document_recall_round === 1,
    '3.2 document_recall_round 应为 1');
  assert(result.packet.meta.candidate_quality === 'good',
    '3.3 candidate_quality 应为 good');
  assert(result.strategy === 'document_first',
    '3.4 strategy 应为 document_first');
}

// ============================================================
// 场景 4（audit-round04 P1-3）：Round 2 命中后类型偏好重排
// ============================================================
async function testCase4_TypePreferenceRankingAfterRound2() {
  console.log('\n📋 场景4: Round 2 → 类型偏好重排不丢失主题相关性');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  // 模拟"国标文件"查询
  svc.decisionService.analyze = () => ({
    intent: 'document_lookup',
    anchor_strength: 'medium',
    confidence: 0.7,
    matched_patterns: ['国标', '标准'],
    reason_codes: ['medium_anchor_detected'],
    recommended_strategy: 'document_first',
  });

  let searchCallCount = 0;
  svc.searchService.search = async (query) => {
    searchCallCount++;
    if (searchCallCount === 1) {
      // Round 1: 返回主题相关但非国标类型的文档（score=40 < 50）
      return {
        success: true,
        candidates: [
          makeCandidate('d1', '汽车行业技术报告', 40, '报告'),
        ],
        total: 1,
        strategy: 'title_match',
      };
    }
    // Round 2: 扩召命中两个候选，其中 d2 是国标
    return {
      success: true,
      candidates: [
        makeCandidate('d2', 'GB/T 汽车术语标准', 80, 'standard'),
        makeCandidate('d3', '汽车行业技术报告 v2', 75, '报告'),
      ],
      total: 2,
      strategy: 'title_match',
    };
  };

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recallWithinDocuments: async () => ({
      success: true,
      items: [
        { score: 0.9, content: 'test chunk', document: { id: 'd2' } },
        { score: 0.7, content: 'test chunk', document: { id: 'd3' } },
      ],
    }),
  };

  const result = await svc.retrieve('汽车车身术语国标', {
    userId: 'u1',
    allow_fallback: true,
  });

  // Round 2 应被触发
  assert(searchCallCount >= 2, '4.1 Round 2 被触发');
  // 最终质量反映 Round 2（top1=80/top2=75 margin 小 → marginal，非错误）
  assert(result.packet.meta.document_recall_round === 2, '4.2 document_recall_round=2');
  // 候选文档至少 2 个，且 top1 为 d2（GB/T 标准）
  const docCount = result.packet.documents?.length || 0;
  assert(docCount >= 2, '4.3 至少 2 个文档候选');
  const top1Id = result.packet.documents?.[0]?.document_id;
  assert(top1Id === 'd2', '4.4 top1 是 d2（GB/T 标准，类型匹配）');
}

// ============================================================
// 场景 5：chunk-first fallback 日志保留 document_recall_round=0
// ============================================================
async function testCase5_FallbackLogKeepsZeroRound() {
  console.log('\n📋 场景5: chunk-first fallback 日志保留 round=0');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  const originalInfo = logger.info;
  const completedLogs = [];
  logger.info = (message, payload) => {
    if (message === '[DocRetrieval] Completed:') {
      completedLogs.push(payload);
    }
  };

  try {
    svc.decisionService.analyze = () => ({
      intent: 'content_exploration',
      anchor_strength: 'none',
      confidence: 0.2,
      matched_patterns: [],
      reason_codes: ['no_document_anchor'],
      recommended_strategy: 'chunk_first',
    });

    svc._ensureRecallService = () => {};
    svc.recallService = {
      recall: async () => ({
        success: true,
        items: [{ score: 0.6, content: 'fallback chunk', document: { id: 'd1' } }],
      }),
    };

    svc.searchService.getDocumentInfo = async () => ([{
      document_id: 'd1',
      document_title: '回退命中文档',
      doc_type: 'standard',
      relevance_score: 70,
      revision_id: 'd1-rev',
    }]);

    const result = await svc.retrieve('随便问个内容问题', {
      userId: 'u1',
      allow_fallback: true,
    });

    assert(result.strategy === 'chunk_first_fallback', '5.1 应走 chunk_first_fallback');
    assert(completedLogs.length > 0, '5.2 应产出 Completed 日志');
    const lastLog = completedLogs[completedLogs.length - 1] || {};
    assert(lastLog.document_recall_round === 0, '5.3 fallback Completed 日志应保留 round=0');
    assert(lastLog.candidate_quality === 'not_applicable', '5.4 fallback Completed 日志应记录 not_applicable');
  } finally {
    logger.info = originalInfo;
  }
}

// ============================================================
// 场景 6：degrade 日志显式记录 round/quality
// ============================================================
async function testCase6_DegradeLogHasStructuredFields() {
  console.log('\n📋 场景6: degrade 日志显式记录 round/quality');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  const originalInfo = logger.info;
  const completedLogs = [];
  logger.info = (message, payload) => {
    if (message === '[DocRetrieval] Completed:') {
      completedLogs.push(payload);
    }
  };

  try {
    svc.decisionService.analyze = () => ({
      intent: 'content_exploration',
      anchor_strength: 'none',
      confidence: 0.3,
      matched_patterns: [],
      reason_codes: ['no_document_anchor'],
      recommended_strategy: 'chunk_first',
    });

    svc.searchService.search = async () => ({
      success: true,
      candidates: [],
      total: 0,
      strategy: 'empty',
    });

    const result = await svc.retrieve('纯内容探索问题', {
      userId: 'u1',
      allow_fallback: false,
    });

    assert(result.strategy === 'degrade', '6.1 应走 degrade');
    assert(completedLogs.length > 0, '6.2 应产出 Completed 日志');
    const lastLog = completedLogs[completedLogs.length - 1] || {};
    assert(lastLog.document_recall_round === 0, '6.3 degrade Completed 日志应显式记录 round=0');
    assert(lastLog.candidate_quality === 'not_applicable', '6.4 degrade Completed 日志应显式记录 not_applicable');
  } finally {
    logger.info = originalInfo;
  }
}

// ============================================================
// 场景 7：真实主题扩召 —— 汽车外壳防护等级 → 外壳防护等级(IP代码)
// ============================================================
async function testCase7_TopicExpansionFindsIPDocument() {
  console.log('\n📋 场景7: 主题扩召命中外壳防护等级(IP代码)');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  svc.decisionService.analyze = () => ({
    intent: 'document_lookup',
    anchor_strength: 'medium',
    confidence: 0.6,
    matched_patterns: ['标准'],
    reason_codes: ['medium_anchor_detected'],
    recommended_strategy: 'document_first',
  });

  const seenQueries = [];
  svc.searchService.search = async (query) => {
    seenQueries.push(query);
    if (query.includes('汽车外壳防护等级')) {
      return {
        success: true,
        candidates: [],
        total: 0,
        strategy: 'title_match',
      };
    }
    if (query.includes('防护等级')) {
      return {
        success: true,
        candidates: [makeCandidate('d-ip', 'GB/T 4208-2017 外壳防护等级（IP代码）', 88, 'standard')],
        total: 1,
        strategy: 'title_match',
      };
    }
    return {
      success: true,
      candidates: [],
      total: 0,
      strategy: 'title_match',
    };
  };

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recallWithinDocuments: async () => ({
      success: true,
      items: [{ score: 0.86, content: 'IP代码与外壳防护等级', document: { id: 'd-ip' } }],
    }),
  };

  const result = await svc.retrieve('汽车外壳防护等级', {
    userId: 'u1',
    allow_fallback: true,
  });

  assert(seenQueries.some(q => q.includes('防护等级')),
    '7.1 应尝试主题放宽扩召并命中“防护等级”相关查询');
  assert(result.strategy === 'document_first',
    '7.2 应命中文档级检索，不应直接降级');
  assert(result.packet.documents?.[0]?.document_id === 'd-ip',
    '7.3 top1 应为外壳防护等级(IP代码)文档');
}

// ============================================================
// 场景 8：README 主线 —— parser 表明在找文档时，不允许 decision 抢去 chunk_first
// ============================================================
async function testCase8_ForceDocumentFirstForLookupIntent() {
  console.log('\n📋 场景8: lookup_intent 命中时强制 document-first');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  svc.decisionService.analyze = () => ({
    intent: 'content_exploration',
    anchor_strength: 'none',
    confidence: 0.25,
    matched_patterns: [],
    reason_codes: ['no_document_anchor'],
    recommended_strategy: 'chunk_first',
  });

  let fallbackCalled = false;
  svc._handleChunkFirstFallback = async () => {
    fallbackCalled = true;
    throw new Error('should not fallback first');
  };

  svc.searchService.search = async (query) => ({
    success: true,
    candidates: [makeCandidate('d-std', `GB/T 4780-2020 ${query}`, 72, 'standard')],
    total: 1,
    strategy: 'title_match',
  });

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recallWithinDocuments: async () => ({
      success: true,
      items: [{ score: 0.82, content: '汽车车身术语', document: { id: 'd-std' } }],
    }),
  };

  const result = await svc.retrieve('有一个规定了汽车车身术语的国标文件是啥来着？', {
    userId: 'u1',
    allow_fallback: true,
  });

  assert(fallbackCalled === false, '8.1 parser 识别为找文档时不应先走 fallback');
  assert(result.strategy === 'document_first', '8.2 应优先走 document_first');
  assert(result.packet.documents?.[0]?.document_id === 'd-std', '8.3 应返回 document-first 候选');
}

// ============================================================
// 场景 9：README 主线 —— 第一轮主题召回后类型偏好不匹配，应触发第二轮而不是直接结束
// ============================================================
async function testCase9_DocTypeHintTriggersRound2() {
  console.log('\n📋 场景9: 缺少类型匹配时触发第二轮主题扩召');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  svc.decisionService.analyze = () => ({
    intent: 'document_lookup',
    anchor_strength: 'medium',
    confidence: 0.66,
    matched_patterns: ['标准'],
    reason_codes: ['medium_anchor_detected'],
    recommended_strategy: 'document_first',
  });

  const queries = [];
  svc.searchService.search = async (query) => {
    queries.push(query);
    if (queries.length === 1) {
      return {
        success: true,
        candidates: [makeCandidate('d-report', '汽车车身术语研究报告', 62, '报告')],
        total: 1,
        strategy: 'title_match',
      };
    }

    return {
      success: true,
      candidates: [
        makeCandidate('d-std', 'GB/T 4780-2020 汽车车身术语', 61, 'standard'),
        makeCandidate('d-report', '汽车车身术语研究报告', 62, '报告'),
      ],
      total: 2,
      strategy: 'title_match',
    };
  };

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recallWithinDocuments: async () => ({
      success: true,
      items: [{ score: 0.84, content: '汽车车身术语正文', document: { id: 'd-std' } }],
    }),
  };

  const result = await svc.retrieve('汽车车身术语国标', {
    userId: 'u1',
    allow_fallback: true,
  });

  assert(queries.length >= 2, '9.1 第一轮无类型匹配时应触发第二轮扩召');
  assert(result.packet.meta.document_recall_round === 2, '9.2 应记录第二轮召回');
  assert(result.packet.documents?.[0]?.document_id === 'd-std', '9.3 第二轮后应由标准文档排到 top1');
}

// ============================================================
// 执行
// ============================================================
console.log('╔══════════════════════════════════════╗');
console.log('║  DocumentRetrievalService 编排测试  ║');
console.log('╚══════════════════════════════════════╝');

await testCase1_NoChunkFirstBypass();
await testCase2_Round2QualityWriteback();
await testCase3_NoExpansionNeeded();
await testCase4_TypePreferenceRankingAfterRound2();
await testCase5_FallbackLogKeepsZeroRound();
await testCase6_DegradeLogHasStructuredFields();
await testCase7_TopicExpansionFindsIPDocument();
await testCase8_ForceDocumentFirstForLookupIntent();
await testCase9_DocTypeHintTriggersRound2();

// ============================================================
// 场景 10：口语型“那个…是哪个”应视为文档定位，不应直接 chunk-first
// ============================================================
async function testCase10_ColloquialLookupAvoidsBlindFallback() {
  console.log('\n📋 场景10: 口语型找文档问法不应盲目 chunk-first');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  let fallbackCalled = false;
  const originalAnalyze = svc.decisionService.analyze.bind(svc.decisionService);
  svc._handleChunkFirstFallback = async () => {
    fallbackCalled = true;
    throw new Error('should not fallback first');
  };

  svc.searchService.search = async (query) => ({
    success: true,
    candidates: [makeCandidate('lab1', `可信实验室算法考核 ${query}`, 78, 'contract')],
    total: 1,
    strategy: 'title_match',
  });

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recallWithinDocuments: async () => ({
      success: true,
      items: [{ score: 0.76, content: '可信实验室算法考核', document: { id: 'lab1' } }],
    }),
  };

  try {
    const result = await svc.retrieve('那个实验室算法考核你帮我翻一下是哪个', {
      userId: 'u1',
      allow_fallback: true,
      context: {
        parsed_query: {
          topic_terms: ['实验室算法考核'],
          cleaned_query: '实验室算法考核',
        },
      },
    });

    assert(fallbackCalled === false, '10.1 不应先走 chunk-first fallback');
    assert(result.strategy === 'document_first', '10.2 应优先走 document_first');
    assert(result.packet.documents?.[0]?.document_id === 'lab1', '10.3 应返回目标文档');
  } finally {
    svc.decisionService.analyze = originalAnalyze;
  }
}

// ============================================================
// 场景 11：fallback 候选不应出现 0 分 high 置信度混入
// ============================================================
async function testCase11_FallbackCandidateConfidenceAndFiltering() {
  console.log('\n📋 场景11: fallback 候选筛选与置信度收紧');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  svc.decisionService.analyze = () => ({
    intent: 'content_exploration',
    anchor_strength: 'none',
    confidence: 0.2,
    matched_patterns: [],
    reason_codes: ['no_document_anchor'],
    recommended_strategy: 'chunk_first',
  });

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recall: async () => ({
      success: true,
      items: [
        { score: 0.82, chunk: { content: '可信实验室算法考核' }, document: { id: 'd-good' } },
        { score: 0.12, chunk: { content: '无关片段' }, document: { id: 'd-bad' } },
      ],
    }),
  };

  svc.searchService.getDocumentInfo = async () => ([
    { document_id: 'd-good', document_title: '可信实验室算法考核', doc_type: 'contract', relevance_score: 0, revision_id: 'd-good-rev' },
    { document_id: 'd-bad', document_title: 'GB 28046.5-2013', doc_type: 'contract', relevance_score: 0, revision_id: 'd-bad-rev' },
  ]);

  const result = await svc.retrieve('实验室算法考核', {
    userId: 'u1',
    allow_fallback: true,
  });

  assert(result.strategy === 'chunk_first_fallback', '11.1 应走 fallback');
  assert(result.packet.documents.length === 1, '11.2 应过滤掉弱相关 fallback 候选');
  assert(result.packet.documents[0].document_id === 'd-good', '11.3 仅保留高集中候选');
  assert(result.packet.documents[0].candidate_confidence !== 'high', '11.4 fallback 候选不应默认 high');
}

await testCase10_ColloquialLookupAvoidsBlindFallback();
await testCase11_FallbackCandidateConfidenceAndFiltering();

// ============================================================
// 场景 12：find_document 应允许 document-first 失败后回退到 chunk-first 锁文档
// ============================================================
async function testCase12_FindDocumentCanFallbackAfterDocumentFirstMiss() {
  console.log('\n📋 场景12: find_document 允许两轮 document-first 后回退 chunk-first 锁文档');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  svc.searchService.search = async () => ({
    success: true,
    candidates: [],
    total: 0,
    strategy: 'title_match',
  });

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recall: async () => ({
      success: true,
      items: [
        { score: 0.88, chunk: { content: 'IPX5 试验应使用直径 6.3 mm 喷嘴进行喷水试验' }, document: { id: 'd-ipx5' } },
        { score: 0.74, chunk: { content: '外壳防护等级（IP代码）规定了 IPX5 的试验方法' }, document: { id: 'd-ipx5' } },
      ],
    }),
  };

  svc.searchService.getDocumentInfo = async () => ([{
    document_id: 'd-ipx5',
    document_title: 'GB/T 4208-2017 外壳防护等级（IP代码）',
    doc_type: 'standard',
    relevance_score: 0,
    revision_id: 'd-ipx5-rev',
    best_identity_label: 'GB/T 4208-2017 外壳防护等级（IP代码）',
    identity_label_source: 'document_title',
  }]);

  const result = await svc.retrieve('IPX5 外壳防护等级 标准', {
    userId: 'u1',
    allow_fallback: true,
  });

  assert(result.strategy === 'chunk_first_fallback', '12.1 无标题候选时应允许 fallback 锁文档');
  assert(result.packet.meta.scoped_identity_confirmed === true, '12.2 chunk 命中同一文档时应确认 scoped identity');
  assert(result.packet.documents?.[0]?.document_id === 'd-ipx5', '12.3 应反锁到正确标准文档');
}

// ============================================================
// 场景 13：IPX5 类问题的主题扩召失败后，仍应可由 fallback 反锁标准文档
// ============================================================
async function testCase13_IPX5FallbackRecoversOriginalStrategy() {
  console.log('\n📋 场景13: IPX5 标准标题想不起来时，fallback 仍应可反锁文档');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  const seenQueries = [];
  svc.decisionService.analyze = () => ({
    intent: 'document_lookup',
    anchor_strength: 'medium',
    confidence: 0.6,
    matched_patterns: ['标准'],
    reason_codes: ['medium_anchor_detected'],
    recommended_strategy: 'document_first',
  });

  svc.searchService.search = async (query) => {
    seenQueries.push(query);
    return {
      success: true,
      candidates: [],
      total: 0,
      strategy: 'title_match',
    };
  };

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recall: async () => ({
      success: true,
      items: [
        { score: 0.81, chunk: { content: 'IPX5 防护等级要求进行喷水试验' }, document: { id: 'd-4208' } },
        { score: 0.77, chunk: { content: '本标准规定外壳防护等级 IPX5 的试验装置与判定' }, document: { id: 'd-4208' } },
      ],
    }),
  };
  svc.searchService.getDocumentInfo = async () => ([{
    document_id: 'd-4208',
    document_title: 'GB/T 4208-2017 外壳防护等级（IP代码）',
    doc_type: 'standard',
    relevance_score: 0,
    revision_id: 'd-4208-rev',
  }]);

  const result = await svc.retrieve('IPX5 外壳防护等级 标准', {
    userId: 'u1',
    allow_fallback: true,
  });

  assert(seenQueries.length >= 1, '13.1 仍应先尝试 document-first');
  assert(result.strategy === 'chunk_first_fallback', '13.2 document-first 无结果后应走 fallback');
  assert(result.packet.documents?.[0]?.document_title === 'GB/T 4208-2017 外壳防护等级（IP代码）', '13.3 fallback 应反锁到 GB/T 4208 文档');
}

// ============================================================
// 场景 14：find_document query plan 应保留原问句 + normalized_lookup_query
// ============================================================
async function testCase14_FindDocumentQueryPlanKeepsNaturalQuestion() {
  console.log('\n📋 场景14: find_document query 入口保留原问句与 normalized_lookup_query');

  const { default: ToolManager } = await import('../lib/tool-manager.js');
  const tm = new ToolManager(makeDbMock(), 'expert-test', {});

  const plan = tm._buildFindDocumentQueryPlan('我想找那个关于IPX5的标准，是哪份文件？顺便告诉我要做什么实验。');

  assert(plan.queries[0].role === 'raw_query', '14.1 第一入口应为 raw_query');
  assert(plan.queries[0].query.includes('我想找那个关于IPX5的标准'), '14.2 第一入口应保留原始自然语言问句');
  assert(plan.queries.some(q => q.query.includes('IPX5')), '14.3 query plan 应保留 IPX5 核心实体');
  assert(plan.queries.some(q => q.role === 'lookup_query' || q.role === 'topic_query'), '14.4 query plan 应包含 lookup/topic 归一化入口');
}

// ============================================================
// 场景 15：find_document 应优先接受原问句命中，而不是只依赖压缩 query
// ============================================================
async function testCase15_FindDocumentPrefersNaturalQuestionHit() {
  console.log('\n📋 场景15: find_document 优先尝试原问句命中');

  const { default: ToolManager } = await import('../lib/tool-manager.js');
  const tm = new ToolManager(makeDbMock(), 'expert-test', {});

  const queries = [];
  const retrievalService = {
    retrieve: async (q) => {
      queries.push(q);
      if (q.includes('顺便告诉我要做什么实验')) {
        return {
          strategy: 'document_first',
          packet: { documents: [{ document_id: 'd1' }], meta: { evidence_sufficiency: 'medium' } },
        };
      }
      return {
        strategy: 'degrade',
        packet: { documents: [], meta: { evidence_sufficiency: 'none' } },
      };
    },
  };

  const plan = tm._buildFindDocumentQueryPlan('我想找那个关于IPX5的标准，是哪份文件？顺便告诉我要做什么实验。');
  const { effectiveQuery, result } = await tm._retrieveWithFindDocumentQueryPlan(retrievalService, plan, {});

  assert(queries.length >= 1, '15.1 应至少尝试一次 query');
  assert(effectiveQuery.includes('顺便告诉我要做什么实验'), '15.2 命中时应保留原问句作为 effectiveQuery');
  assert(result.packet.documents?.length === 1, '15.3 原问句命中时应直接返回结果');
}

// ============================================================
// 场景 16：文件A这份文件类问句应识别为文档锚点，而非 no_document_anchor
// ============================================================
async function testCase16_AnchoredFileQuestionUsesDocumentFirst() {
  console.log('\n📋 场景16: 文件A这份文件 + 内容问题 → document_first');

  const mockDb = makeDbMock();
  const mockConfig = makeConfigLoaderMock();
  const svc = new DocumentRetrievalService(mockDb, mockConfig);

  let capturedDecision = null;
  const originalAnalyze = svc.decisionService.analyze.bind(svc.decisionService);
  svc.decisionService.analyze = (query, context) => {
    const decision = originalAnalyze(query, context);
    capturedDecision = decision;
    return decision;
  };

  svc.searchService.search = async () => ({
    success: true,
    candidates: [makeCandidate('file-a', '文件A', 88, '合同协议')],
    total: 1,
    strategy: 'title_match',
  });

  svc._ensureRecallService = () => {};
  svc.recallService = {
    recallWithinDocuments: async () => ({
      success: true,
      items: [
        {
          score: 0.83,
          chunk: { id: 'c1', content: '如项目延期，每日按合同金额的0.1%承担违约金。' },
          document: { id: 'file-a', document_title: '文件A', doc_type: '合同协议' },
        },
      ],
    }),
  };

  const result = await svc.retrieve('帮我看一下文档平台里文件A这份文件，如果项目延期了，每天具体要扣多少比例的违约金？', {
    userId: 'u1',
    allow_fallback: true,
  });

  assert(capturedDecision?.anchor_strength !== 'none', '16.1 anchor_strength 不应为 none');
  assert(!capturedDecision?.reason_codes?.includes('no_document_anchor'), '16.2 不应包含 no_document_anchor');
  assert(capturedDecision?.recommended_strategy !== 'chunk_first', '16.3 不应推荐 chunk_first');
  assert(result.strategy === 'document_first', '16.4 应走 document_first');
}

await testCase12_FindDocumentCanFallbackAfterDocumentFirstMiss();
await testCase13_IPX5FallbackRecoversOriginalStrategy();
await testCase14_FindDocumentQueryPlanKeepsNaturalQuestion();
await testCase15_FindDocumentPrefersNaturalQuestionHit();
await testCase16_AnchoredFileQuestionUsesDocumentFirst();

console.log(`\n${'='.repeat(40)}`);
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) {
  process.exit(1);
}
