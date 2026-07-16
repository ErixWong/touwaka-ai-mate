/**
 * Document Orchestration Service 测试
 *
 * audit-round01 P0-1: 验证编排状态机的正确性
 *
 * 运行：node tests/document-orchestration-service.test.js
 */

import orchestrationService, { shouldAutoChainContent } from '../lib/document-orchestration-service.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label} | expected: ${expected}, got: ${actual}`);
  }
}

// ============================================================
// 场景 1: find_document + single → answer
// ============================================================
function testCase1_FindDocumentSingle() {
  console.log('\n📋 场景1: find_document + 单候选 → answer');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'GB/T 4208 在哪里',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  assertEqual(result.goal_type, 'locate_document', '1.1 goal_type=locate_document');
  assertEqual(result.candidate_resolution, 'single', '1.2 candidate_resolution=single');
  assertEqual(result.action, 'answer', '1.3 action=answer');
}

// ============================================================
// 场景 2: find_document + mergeable (同集合) → candidate_list + mergeable_hint
// audit-round02 P0-1: find_document 不返回 chunk 证据，走保守方案
// ============================================================
function testCase2_FindDocumentMergeableSameCollection() {
  console.log('\n📋 场景2: find_document + 同集合多候选 → candidate_list (mergeable_hint)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'IP防护等级试验条件',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017 第1部分', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.88 },
      { document_id: 'd2', document_title: 'GB/T 4208-2017 第2部分', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.85 },
    ],
  });

  assertEqual(result.goal_type, 'locate_document', '2.1 goal_type=locate_document');
  assertEqual(result.candidate_resolution, 'mergeable', '2.2 candidate_resolution=mergeable');
  assertEqual(result.action, 'candidate_list', '2.3 action=candidate_list (保守!)');
  assert(result.reason_codes.includes('same_collection'), '2.4 含 same_collection 信号');
  assertEqual(result.mergeable_hint, true, '2.5 mergeable_hint=true');
}

// ============================================================
// 场景 3: find_document + complementary types → candidate_list + mergeable_hint
// audit-round02 P0-1: find_document 不返回 chunk 证据，走保守方案
// 注意：query 不含问答信号词（如"成本"），避免 P1-1 query纠偏覆盖
// ============================================================
function testCase3_FindDocumentComplementaryTypes() {
  console.log('\n📋 场景3: find_document + 互补类型 → candidate_list (mergeable_hint)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'X物品分类与参考文档',
    candidates: [
      { document_id: 'd1', document_title: '物品分类标准', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.9 },
      { document_id: 'd2', document_title: '航运价格表', doc_type: 'price_list', collection_name: '价格库', relevance_score: 0.85 },
    ],
  });

  assertEqual(result.goal_type, 'locate_document', '3.1 goal_type=locate_document');
  assertEqual(result.candidate_resolution, 'mergeable', '3.2 candidate_resolution=mergeable');
  assertEqual(result.action, 'candidate_list', '3.3 action=candidate_list (保守!)');
  assert(result.reason_codes.includes('complementary_types'), '3.4 含 complementary_types 信号');
  assertEqual(result.mergeable_hint, true, '3.5 mergeable_hint=true');
}

// ============================================================
// 场景 4: find_document + ambiguous → candidate_list
// ============================================================
function testCase4_FindDocumentAmbiguous() {
  console.log('\n📋 场景4: find_document + 模糊多候选 → candidate_list');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '合同',
    candidates: [
      { document_id: 'd1', document_title: '采购合同A', doc_type: 'contract', collection_name: '合同库A', relevance_score: 0.75 },
      { document_id: 'd2', document_title: '销售合同B', doc_type: 'contract', collection_name: '合同库B', relevance_score: 0.72 },
    ],
  });

  assertEqual(result.goal_type, 'locate_document', '4.1 goal_type=locate_document');
  assertEqual(result.candidate_resolution, 'ambiguous', '4.2 candidate_resolution=ambiguous');
  assertEqual(result.action, 'candidate_list', '4.3 action=candidate_list');
}

// ============================================================
// 场景 5: find_document + 0 候选 → clarify, resolution=none
// audit-round02 P2-1: 0候选 resolution 应为 'none' 而非 'single'
// ============================================================
function testCase5_FindDocumentZero() {
  console.log('\n📋 场景5: find_document + 0 候选 → clarify (resolution=none)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '不存在的文档xyz',
    candidates: [],
  });

  assertEqual(result.goal_type, 'locate_document', '5.1 goal_type=locate_document');
  assertEqual(result.candidate_resolution, 'none', '5.2 candidate_resolution=none');
  assertEqual(result.action, 'clarify', '5.3 action=clarify');
}

// ============================================================
// 场景 6: answer_from_documents + mergeable → answer
// ============================================================
function testCase6_AnswerFromDocumentsMergeable() {
  console.log('\n📋 场景6: answer_from_documents + mergeable → answer');

  const result = orchestrationService.orchestrate({
    toolName: 'answer_from_documents',
    query: 'X物品物流成本怎么算',
    candidates: [
      { document_id: 'd1', document_title: '物品分类标准', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.9 },
      { document_id: 'd2', document_title: '航运价格表', doc_type: 'price_list', collection_name: '价格库', relevance_score: 0.85 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '6.1 goal_type=answer_question');
  assertEqual(result.candidate_resolution, 'mergeable', '6.2 candidate_resolution=mergeable');
  assertEqual(result.action, 'answer', '6.3 action=answer');
}

// ============================================================
// 场景 7: answer_from_documents + ambiguous → candidate_list
// ============================================================
function testCase7_AnswerFromDocumentsAmbiguous() {
  console.log('\n📋 场景7: answer_from_documents + 模糊 → candidate_list');

  const result = orchestrationService.orchestrate({
    toolName: 'answer_from_documents',
    query: '那个标准怎么说',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208', doc_type: 'standard', collection_name: '标准库A', relevance_score: 0.7 },
      { document_id: 'd2', document_title: 'GB/T 12345', doc_type: 'standard', collection_name: '标准库B', relevance_score: 0.68 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '7.1 goal_type=answer_question');
  assertEqual(result.candidate_resolution, 'ambiguous', '7.2 candidate_resolution=ambiguous');
  assertEqual(result.action, 'candidate_list', '7.3 action=candidate_list');
}

// ============================================================
// 场景 8: P1-1 — find_document + 纯文档查询 → locate_document
// ============================================================
function testCase8_GoalTypePureLocate() {
  console.log('\n📋 场景8: find_document + 纯定位query → locate_document (tool_name)');

  // 纯编号查询：无问答信号词，只有定位意图
  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'GB/T 4208',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  assertEqual(result.goal_type, 'locate_document', '8.1 goal_type=locate_document');
  assertEqual(result.goal_type_source, 'tool_name', '8.2 source: 纯编号，无问答信号');
}

// ============================================================
// 场景 8b: P1-1 — find_document + 同时有定位和问答信号 → tool_name_with_answer_intent
// ============================================================
function testCase8b_GoalTypeLocateWithAnswerIntent() {
  console.log('\n📋 场景8b: find_document + 定位+问答混合同义 → tool_name_with_answer_intent');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '找一下GB/T 4208标准，里面规定了什么要求',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  assertEqual(result.goal_type, 'locate_document', '8b.1 goal_type=locate_document');
  assertEqual(result.goal_type_source, 'tool_name_with_answer_intent', '8b.2 source: 同时有定位+问答信号');
}

// ============================================================
// 场景 9: P1-1 — find_document + 文档名+条款问题 → answer_question (query纠偏)
// ============================================================
function testCase9_GoalTypeDocNameWithClause() {
  console.log('\n📋 场景9: find_document + 文档名+条款问题 → answer_question (query纠偏)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'GB/T 4208 里规定IPX5试验要求是什么',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '9.1 goal_type=answer_question');
  assertEqual(result.goal_type_source, 'query_signal_override', '9.2 source: query覆盖tool先验');
  assertEqual(result.action, 'answer', '9.3 action=answer (单候选 answer_question)');
}

// ============================================================
// 场景 10: P1-1 — find_document + 文档名+计算问题 → answer_question (query纠偏)
// ============================================================
function testCase10_GoalTypeDocNameWithCalc() {
  console.log('\n📋 场景10: find_document + 文档名+费用计算 → answer_question (query纠偏)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '航运价格表里X物品的运费多少钱',
    candidates: [
      { document_id: 'd1', document_title: '航运价格表2025', doc_type: 'price_list', collection_name: '价格库', relevance_score: 0.92 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '10.1 goal_type=answer_question');
  assertEqual(result.goal_type_source, 'query_signal_override', '10.2 source: query覆盖');
  assertEqual(result.action, 'answer', '10.3 action=answer (单候选)');
}

// ============================================================
// 场景 10b: find_document + 显式文档锚点 + 内容问答 → anchored_document_answer_intent
// ============================================================
function testCase10b_AnchoredDocumentAnswerIntent() {
  console.log('\n📋 场景10b: 显式文档锚点 + 内容问答 → anchored_document_answer_intent');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '在文档集合里，帮我看一下审稿人回信2里的回复都做了什么修改',
    candidates: [
      { document_id: 'd1', document_title: '审稿人回信2', doc_type: 'reply_letter', collection_name: '投稿文档', relevance_score: 0.96 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '10b.1 goal_type=answer_question');
  assertEqual(result.goal_type_source, 'anchored_document_answer_intent', '10b.2 source=anchored_document_answer_intent');
  assertEqual(result.action, 'answer', '10b.3 action=answer');
}

// ============================================================
// 场景 10c: 文件A里...怎么规定 → anchored_document_answer_intent
// ============================================================
function testCase10c_FileAAnswerIntent() {
  console.log('\n📋 场景10c: 文件A里内容提问 → anchored_document_answer_intent');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '文件A里延期违约金怎么规定',
    candidates: [
      { document_id: 'd1', document_title: '文件A', doc_type: 'contract', collection_name: '合同库', relevance_score: 0.94 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '10c.1 goal_type=answer_question');
  assertEqual(result.goal_type_source, 'anchored_document_answer_intent', '10c.2 source=anchored_document_answer_intent');
  assertEqual(result.action, 'answer', '10c.3 action=answer');
}

// ============================================================
// 场景 10d: 文件A这份文件，如果... → anchored_document_answer_intent
// ============================================================
function testCase10d_FileAThisDocumentAnswerIntent() {
  console.log('\n📋 场景10d: 文件A这份文件，如果项目延期了... → anchored_document_answer_intent');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '帮我看一下文档平台里文件A这份文件，如果项目延期了，每天具体要扣多少比例的违约金？请把计算基数也一并告诉我。',
    candidates: [
      { document_id: 'd1', document_title: '文件A', doc_type: 'contract', collection_name: '合同库', relevance_score: 0.94 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '10d.1 goal_type=answer_question');
  assertEqual(result.goal_type_source, 'anchored_document_answer_intent', '10d.2 source=anchored_document_answer_intent');
  assertEqual(result.action, 'answer', '10d.3 action=answer');
}

// ============================================================
// 场景 11: P1-2 — 同集合内类型互斥 → conflicting
// ============================================================
function testCase11_ConflictingTypesInSameCollection() {
  console.log('\n📋 场景11: 同集合不同类型(非互补) → conflicting');

  const result = orchestrationService.orchestrate({
    toolName: 'answer_from_documents',
    query: '合同条款是否合规',
    candidates: [
      { document_id: 'd1', document_title: '采购合同A', doc_type: 'contract', collection_name: '合同库', relevance_score: 0.82, candidate_confidence: 'high' },
      { document_id: 'd2', document_title: '相关标准', doc_type: 'standard', collection_name: '合同库', relevance_score: 0.78, candidate_confidence: 'medium' },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '11.1 goal_type=answer_question');
  assertEqual(result.candidate_resolution, 'conflicting', '11.2 candidate_resolution=conflicting');
  assertEqual(result.action, 'conservative_answer', '11.3 action=conservative_answer');
  assert(result.reason_codes.includes('conflicting_types_in_same_collection'), '11.4 含conflicting类型理由');
}

// ============================================================
// 场景 12: P1-2 — 高分散多来源 → conflicting
// ============================================================
function testCase12_ConflictingDispersedSources() {
  console.log('\n📋 场景12: 3+不同集合高置信候选 → conflicting');

  const result = orchestrationService.orchestrate({
    toolName: 'answer_from_documents',
    query: '这个规定有没有依据',
    candidates: [
      { document_id: 'd1', document_title: '法规A', doc_type: 'regulation', collection_name: '法规库', relevance_score: 0.9, candidate_confidence: 'high' },
      { document_id: 'd2', document_title: '标准B', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.85, candidate_confidence: 'high' },
      { document_id: 'd3', document_title: '合同C', doc_type: 'contract', collection_name: '合同库', relevance_score: 0.8, candidate_confidence: 'high' },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '12.1 goal_type=answer_question');
  assertEqual(result.candidate_resolution, 'conflicting', '12.2 candidate_resolution=conflicting');
  assertEqual(result.action, 'conservative_answer', '12.3 action=conservative_answer');
  assert(result.reason_codes.includes('dispersed_high_confidence_sources'), '12.4 含dispersed信号');
}

// ============================================================
// 场景 13-16: P1-3 集成路径 — tool-manager response 映射校验
//  模拟 _handleFindDocument 中 orchestration → response 的映射逻辑
// ============================================================

/**
 * 模拟 tool-manager._handleFindDocument 中的 orchestration→mode 映射
 * audit-round08 P1: 增加 identity_resolved / evidence_resolved 阶段字段
 */
function simulateResponseMapping(orchestrationResult, candidates) {
  const modeByAction = {
    answer: candidates.length === 1 ? 'single_document' : 'answer_with_citation',
    candidate_list: 'candidate_list',
    clarify: 'clarify',
    conservative_answer: 'conservative_answer',
  };

  return {
    suggested_response_mode: modeByAction[orchestrationResult.action] || 'clarify',
    short_circuit: orchestrationResult.action === 'candidate_list' || orchestrationResult.action === 'clarify',
    mergeable_hint: orchestrationResult.mergeable_hint || false,
    // audit-round08 P1: 阶段字段
    identity_resolved: candidates.length > 0,
    evidence_resolved: orchestrationResult.evidence_capability === 'chunk_evidence',
  };
}

// 场景 13: find_document + single → single_document (不短路)
function testCase13_IntegrationSingleDocument() {
  console.log('\n📋 场景13: find_document+single → single_document (不短路)');

  const orch = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'GB/T 4208',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  const mapped = simulateResponseMapping(orch, [{ document_id: 'd1' }]);

  assertEqual(mapped.suggested_response_mode, 'single_document', '13.1 mode=single_document');
  assertEqual(mapped.short_circuit, false, '13.2 不短路 (LLM继续处理)');
  assertEqual(mapped.mergeable_hint, false, '13.3 不触发mergeable_hint');
}

// 场景 14: find_document + mergeable → candidate_list (短路, mergeable_hint)
function testCase14_IntegrationMergeableShortCircuit() {
  console.log('\n📋 场景14: find_document+mergeable → candidate_list (短路, mergeable_hint)');

  const orch = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'IP防护等级试验条件',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017 第1部分', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.88 },
      { document_id: 'd2', document_title: 'GB/T 4208-2017 第2部分', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.85 },
    ],
  });

  const mapped = simulateResponseMapping(orch, [{ document_id: 'd1' }, { document_id: 'd2' }]);

  assertEqual(mapped.suggested_response_mode, 'candidate_list', '14.1 mode=candidate_list (短路)');
  assertEqual(mapped.short_circuit, true, '14.2 短路 (展示候选列表)');
  assertEqual(mapped.mergeable_hint, true, '14.3 mergeable_hint=true (提示可合并消费)');
}

// 场景 15: find_document + ambiguous → candidate_list (短路, 无mergeable_hint)
function testCase15_IntegrationAmbiguousShortCircuit() {
  console.log('\n📋 场景15: find_document+ambiguous → candidate_list (短路, 无mergeable_hint)');

  const orch = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '合同',
    candidates: [
      { document_id: 'd1', document_title: '采购合同A', doc_type: 'contract', collection_name: '合同库A', relevance_score: 0.75 },
      { document_id: 'd2', document_title: '销售合同B', doc_type: 'contract', collection_name: '合同库B', relevance_score: 0.72 },
    ],
  });

  const mapped = simulateResponseMapping(orch, [{ document_id: 'd1' }, { document_id: 'd2' }]);

  assertEqual(mapped.suggested_response_mode, 'candidate_list', '15.1 mode=candidate_list');
  assertEqual(mapped.short_circuit, true, '15.2 短路');
  assertEqual(mapped.mergeable_hint, false, '15.3 无mergeable_hint');
}

// 场景 16: find_document + 0 → clarify (短路)
function testCase16_IntegrationZeroClarify() {
  console.log('\n📋 场景16: find_document+0 → clarify (短路)');

  const orch = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '不存在的文档xyz',
    candidates: [],
  });

  const mapped = simulateResponseMapping(orch, []);

  assertEqual(mapped.suggested_response_mode, 'clarify', '16.1 mode=clarify (短路)');
  assertEqual(mapped.short_circuit, true, '16.2 短路');
  assertEqual(mapped.mergeable_hint, false, '16.3 无mergeable_hint');
}

// ============================================================
// 场景 17-19: P1-2 — 关键组合路径：query override × mergeable × find_document
// audit-round03: 封死旁路：find_document + answer_question + mergeable → answer_with_citation
// ============================================================

// 场景 17: find_document + query_signal_override + mergeable + 多候选
// 这是 round02 遗留的最危险旁路 — tool guard 必须降级为 candidate_list
function testCase17_QueryOverrideMergeableMultiCandidate() {
  console.log('\n📋 场景17: find_document+query_override+mergeable+多候选 → candidate_list (tool guard)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'GB/T 4208 里规定IPX5试验要求是什么',  // 触发 query_signal_override
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017 第1部分', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.88 },
      { document_id: 'd2', document_title: 'GB/T 4208-2017 第2部分', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.85 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '17.1 goal_type=answer_question (query覆盖)');
  assertEqual(result.goal_type_source, 'query_signal_override', '17.2 source=query_signal_override');
  assertEqual(result.candidate_resolution, 'mergeable', '17.3 candidate_resolution=mergeable');
  // 关键断言：tool guard 强制降级为 candidate_list
  assertEqual(result.action, 'candidate_list', '17.4 action=candidate_list (tool guard 降级!)');
  assert(result.reason_codes.includes('tool_guard_find_document_multi_candidate'), '17.5 含 tool_guard 标记');
  assertEqual(result.evidence_capability, 'identity_only', '17.6 evidence_capability=identity_only');

  // 映射验证：不会走到 answer_with_citation
  const mapped = simulateResponseMapping(result, [{ document_id: 'd1' }, { document_id: 'd2' }]);
  assert(mapped.suggested_response_mode !== 'answer_with_citation', '17.7 不是 answer_with_citation!');
  assertEqual(mapped.suggested_response_mode, 'candidate_list', '17.8 mode=candidate_list');
}

// 场景 18: find_document + tool_name_with_answer_intent + mergeable + 多候选
// 同时有定位和问答信号时仍为 locate_document，但也必须被 tool guard 保护
function testCase18_AnswerIntentMergeableMultiCandidate() {
  console.log('\n📋 场景18: find_document+answer_intent+mergeable+多候选 → candidate_list (tool guard)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '找一下GB/T 4208标准，里面规定了什么要求',  // 同时有定位+问答信号
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017 第1部分', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.88 },
      { document_id: 'd2', document_title: 'GB/T 4208-2017 第2部分', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.85 },
    ],
  });

  assertEqual(result.goal_type, 'locate_document', '18.1 goal_type=locate_document');
  assertEqual(result.goal_type_source, 'tool_name_with_answer_intent', '18.2 source=tool_name_with_answer_intent');
  assertEqual(result.candidate_resolution, 'mergeable', '18.3 candidate_resolution=mergeable');
  // round02 已经修正的路径：locate_document + mergeable → candidate_list
  assertEqual(result.action, 'candidate_list', '18.4 action=candidate_list');
  assert(result.reason_codes.includes('same_collection'), '18.5 含 mergeable 信号');
  assertEqual(result.evidence_capability, 'identity_only', '18.6 evidence_capability=identity_only');
  assertEqual(result.mergeable_hint, true, '18.7 mergeable_hint=true');

  // 映射验证
  const mapped = simulateResponseMapping(result, [{ document_id: 'd1' }, { document_id: 'd2' }]);
  assert(mapped.suggested_response_mode !== 'answer_with_citation', '18.8 不是 answer_with_citation!');
}

// 场景 19: answer_from_documents + mergeable → answer（正例：有 chunk 证据，可以放行）
// 验证 tool guard 不影响 answer_from_documents 的正常行为
function testCase19_AnswerFromDocsMergeableWithEvidence() {
  console.log('\n📋 场景19: answer_from_documents+mergeable → answer (正例：有chunk证据)');

  const result = orchestrationService.orchestrate({
    toolName: 'answer_from_documents',
    query: 'X物品物流成本怎么算',
    candidates: [
      { document_id: 'd1', document_title: '物品分类标准', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.9 },
      { document_id: 'd2', document_title: '航运价格表', doc_type: 'price_list', collection_name: '价格库', relevance_score: 0.85 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '19.1 goal_type=answer_question');
  assertEqual(result.candidate_resolution, 'mergeable', '19.2 candidate_resolution=mergeable');
  // answer_from_documents 有 chunk 证据，tool guard 不触发
  assertEqual(result.action, 'answer', '19.3 action=answer (有chunk证据，可以放行)');
  assertEqual(result.evidence_capability, 'chunk_evidence', '19.4 evidence_capability=chunk_evidence');
  // 确认 reason_codes 不含 tool_guard
  const hasToolGuard = result.reason_codes.some(c => c.startsWith('tool_guard'));
  assert(!hasToolGuard, '19.5 不含 tool_guard (answer_from_documents 有 chunk 证据)');

  // 映射验证：多候选 answer → answer_with_citation（有 chunk 证据，正确）
  const mapped = simulateResponseMapping(result, [{ document_id: 'd1' }, { document_id: 'd2' }]);
  assertEqual(mapped.suggested_response_mode, 'answer_with_citation', '19.6 mode=answer_with_citation (正确)');
}

// 场景 19b: find_document + anchored_document_answer_intent + same_collection mergeable → answer
function testCase19b_AnchoredBridgeMergeableAnswer() {
  console.log('\n📋 场景19b: 文件A点名 + 同集合文件B承载答案 → answer (桥接放行)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '帮我看一下文档平台里文件A这份文件，如果项目延期了，每天具体要扣多少比例的违约金？请把计算基数也一并告诉我。',
    candidates: [
      { document_id: 'd1', document_title: '文件A', doc_type: 'contract', collection_name: 'test0701', relevance_score: 0.82, candidate_confidence: 'medium' },
      { document_id: 'd2', document_title: '文件B', doc_type: 'contract', collection_name: 'test0701', relevance_score: 0.79, candidate_confidence: 'medium' },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '19b.1 goal_type=answer_question');
  assertEqual(result.goal_type_source, 'anchored_document_answer_intent', '19b.2 source=anchored_document_answer_intent');
  assertEqual(result.candidate_resolution, 'mergeable', '19b.3 candidate_resolution=mergeable');
  assertEqual(result.action, 'answer', '19b.4 action=answer (桥接放行)');
  assert(result.reason_codes.includes('same_collection'), '19b.5 含 same_collection');
  assertEqual(result.evidence_capability, 'identity_only', '19b.6 evidence_capability=identity_only');

  const mapped = simulateResponseMapping(result, [{ document_id: 'd1' }, { document_id: 'd2' }]);
  assertEqual(mapped.suggested_response_mode, 'answer_with_citation', '19b.7 mode=answer_with_citation');
  assertEqual(mapped.short_circuit, false, '19b.8 不短路');
}

// ============================================================
// 场景 20-22: P1-2 单候选 answer-intent 边界测试
// audit-round04: 单候选 + answer_intent + identity_only 仍需走 single_document，
// 但 chat-service 应注入 identity-only 守卫约束，防止 LLM 过度回答
// ============================================================

// 场景 20: find_document + query_signal_override + single_candidate
// 最危险的单候选边界：query 明显是问答型，但 tool 只有 identity 证据
function testCase20_SingleCandidateQueryOverride() {
  console.log('\n📋 场景20: find_document+query_override+single → single_document (identity_only)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'GB/T 4208 里规定IPX5试验要求是什么',  // 触发 query_signal_override
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '20.1 goal_type=answer_question (query覆盖)');
  assertEqual(result.goal_type_source, 'query_signal_override', '20.2 source=query_signal_override');
  assertEqual(result.candidate_resolution, 'single', '20.3 single candidate');
  // 单候选不触发 tool guard（guard 只保护多候选）
  assertEqual(result.action, 'answer', '20.4 action=answer (单候选，tool guard 不触发)');
  assertEqual(result.evidence_capability, 'identity_only', '20.5 evidence_capability=identity_only');

  // 映射验证：单候选 answer → single_document
  const mapped = simulateResponseMapping(result, [{ document_id: 'd1' }]);
  assertEqual(mapped.suggested_response_mode, 'single_document', '20.6 mode=single_document');

  // 关键：evidence_capability=identity_only 且 goal_type_source=query_signal_override
  // 这个组合应触发 chat-service 的 identity-only 守卫约束
  // （守卫逻辑在 buildEvidenceInjection 中，此处只验证编排信号正确传递）
  const needsIdentityGuard = (
    result.evidence_capability === 'identity_only' &&
    result.goal_type_source === 'query_signal_override'
  );
  assert(needsIdentityGuard, '20.7 此组合需 identity-only 守卫约束');
}

// 场景 21: find_document + tool_name_with_answer_intent + single_candidate
// 混合意图 + 单候选 — 同样需要约束但不能阻断
function testCase21_SingleCandidateAnswerIntent() {
  console.log('\n📋 场景21: find_document+answer_intent+single → single_document (约束但不阻断)');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '找一下GB/T 4208标准，里面规定了什么要求',  // 同时有定位+问答信号
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  assertEqual(result.goal_type, 'locate_document', '21.1 goal_type=locate_document');
  assertEqual(result.goal_type_source, 'tool_name_with_answer_intent', '21.2 answer_intent');
  assertEqual(result.candidate_resolution, 'single', '21.3 single candidate');
  assertEqual(result.action, 'answer', '21.4 action=answer');
  assertEqual(result.evidence_capability, 'identity_only', '21.5 identity_only');

  const mapped = simulateResponseMapping(result, [{ document_id: 'd1' }]);
  assertEqual(mapped.suggested_response_mode, 'single_document', '21.6 mode=single_document');

  // tool_name_with_answer_intent 也表示存在问答意图，约束应生效
  const hasAnswerIntent = (
    result.evidence_capability === 'identity_only' &&
    (result.goal_type_source === 'query_signal_override' ||
     result.goal_type_source === 'tool_name_with_answer_intent')
  );
  assert(hasAnswerIntent, '21.7 answer_intent + identity_only 应触发约束');
}

// 场景 22: answer_from_documents + single_candidate + answer_question → answer（正例）
// 有 chunk 证据的单候选回答 — 不需要 identity 守卫
function testCase22_AnswerFromDocsSingleWithEvidence() {
  console.log('\n📋 场景22: answer_from_docs+single → answer (正例：chunk_evidence，不受限)');

  const result = orchestrationService.orchestrate({
    toolName: 'answer_from_documents',
    query: 'IPX5试验条件是什么',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  assertEqual(result.goal_type, 'answer_question', '22.1 goal_type=answer_question');
  assertEqual(result.candidate_resolution, 'single', '22.2 single');
  assertEqual(result.action, 'answer', '22.3 action=answer');
  assertEqual(result.evidence_capability, 'chunk_evidence', '22.4 chunk_evidence');

  // chunk_evidence 不应触发 identity-only 守卫
  const needsIdentityGuard = (
    result.evidence_capability === 'identity_only' &&
    result.goal_type_source === 'query_signal_override'
  );
  assert(!needsIdentityGuard, '22.5 chunk_evidence 不需要 identity 守卫');

  const mapped = simulateResponseMapping(result, [{ document_id: 'd1' }]);
  assertEqual(mapped.suggested_response_mode, 'single_document', '22.6 mode=single_document');
}

// ============================================================
// audit-round07 P0: shouldAutoChainContent 决策逻辑
// ============================================================

function testCase23_ShouldAutoChainQueryOverride() {
  console.log('\n📋 场景23: shouldAutoChainContent — query_signal_override + 单候选 → 应触发');

  assert(
    shouldAutoChainContent(
      { evidence_capability: 'identity_only', goal_type_source: 'query_signal_override' },
      1
    ),
    '23.1 identity_only + query_signal_override + 1 candidate → true'
  );

  assert(
    !shouldAutoChainContent(
      { evidence_capability: 'identity_only', goal_type_source: 'query_signal_override' },
      2
    ),
    '23.2 identity_only + query_signal_override + 2 candidates → false'
  );

  assert(
    !shouldAutoChainContent(
      { evidence_capability: 'chunk_evidence', goal_type_source: 'query_signal_override' },
      1
    ),
    '23.3 chunk_evidence 不需要 auto-chain（已有内容证据）'
  );
}

function testCase24_ShouldAutoChainMixedIntent() {
  console.log('\n📋 场景24: shouldAutoChainContent — tool_name_with_answer_intent + 单候选 → 应触发');

  assert(
    shouldAutoChainContent(
      { evidence_capability: 'identity_only', goal_type_source: 'tool_name_with_answer_intent' },
      1
    ),
    '24.1 identity_only + mixed_intent + 1 candidate → true'
  );
}

function testCase25_ShouldAutoChainPureLocate() {
  console.log('\n📋 场景25: shouldAutoChainContent — tool_name(纯定位) → 不触发');

  assert(
    !shouldAutoChainContent(
      { evidence_capability: 'identity_only', goal_type_source: 'tool_name' },
      1
    ),
    '25.1 identity_only + tool_name + 1 candidate → false（纯定位不触发）'
  );
}

function testCase26_ShouldAutoChainMultiCandidate() {
  console.log('\n📋 场景26: shouldAutoChainContent — 多候选 → 不触发');

  assert(
    !shouldAutoChainContent(
      { evidence_capability: 'identity_only', goal_type_source: 'tool_name_with_answer_intent' },
      3
    ),
    '26.1 identity_only + mixed_intent + 3 candidates → false'
  );
}

function testCase27_ShouldAutoChainChunkEvidence() {
  console.log('\n📋 场景27: shouldAutoChainContent — chunk_evidence → 不触发');

  assert(
    !shouldAutoChainContent(
      { evidence_capability: 'chunk_evidence', goal_type_source: 'tool_name_with_answer_intent' },
      1
    ),
    '27.1 chunk_evidence + mixed_intent + 1 candidate → false（已有证据）'
  );
}

// ============================================================
// audit-round08 P1: identity_resolved / evidence_resolved 阶段字段
// ============================================================

function testCase28_StageFieldsFindDocumentSingle() {
  console.log('\n📋 场景28: find_document 单候选 → identity_resolved=true, evidence_resolved=false');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: 'GB/T 4208',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  const mapped = simulateResponseMapping(result, [{ document_id: 'd1' }]);
  assert(mapped.identity_resolved, '28.1 identity_resolved=true');
  assert(!mapped.evidence_resolved, '28.2 evidence_resolved=false（identity_only）');
}

function testCase29_StageFieldsAnswerFromDocsWithEvidence() {
  console.log('\n📋 场景29: answer_from_documents 单候选 → identity_resolved=true, evidence_resolved=true');

  const result = orchestrationService.orchestrate({
    toolName: 'answer_from_documents',
    query: 'IPX5试验条件',
    candidates: [
      { document_id: 'd1', document_title: 'GB/T 4208-2017', doc_type: 'standard', collection_name: '标准库', relevance_score: 0.95 },
    ],
  });

  const mapped = simulateResponseMapping(result, [{ document_id: 'd1' }]);
  assert(mapped.identity_resolved, '29.1 identity_resolved=true');
  assert(mapped.evidence_resolved, '29.2 evidence_resolved=true（chunk_evidence）');
}

function testCase30_StageFieldsFindDocumentZero() {
  console.log('\n📋 场景30: find_document 0 候选 → identity_resolved=false, evidence_resolved=false');

  const result = orchestrationService.orchestrate({
    toolName: 'find_document',
    query: '不存在的文档',
    candidates: [],
  });

  const mapped = simulateResponseMapping(result, []);
  assert(!mapped.identity_resolved, '30.1 identity_resolved=false');
  assert(!mapped.evidence_resolved, '30.2 evidence_resolved=false');
  assertEqual(mapped.suggested_response_mode, 'clarify', '30.3 mode=clarify');
}

// audit-round08 P1: identity_resolved / evidence_resolved 阶段字段
testCase28_StageFieldsFindDocumentSingle();
testCase29_StageFieldsAnswerFromDocsWithEvidence();
testCase30_StageFieldsFindDocumentZero();

console.log('╔══════════════════════════════════════╗');
console.log('║  Document Orchestration 测试        ║');
console.log('╚══════════════════════════════════════╝');

testCase1_FindDocumentSingle();
testCase2_FindDocumentMergeableSameCollection();
testCase3_FindDocumentComplementaryTypes();
testCase4_FindDocumentAmbiguous();
testCase5_FindDocumentZero();
testCase6_AnswerFromDocumentsMergeable();
testCase7_AnswerFromDocumentsAmbiguous();
// audit-round02 新增
testCase8_GoalTypePureLocate();
testCase8b_GoalTypeLocateWithAnswerIntent();
testCase9_GoalTypeDocNameWithClause();
testCase10_GoalTypeDocNameWithCalc();
testCase10b_AnchoredDocumentAnswerIntent();
testCase10c_FileAAnswerIntent();
testCase10d_FileAThisDocumentAnswerIntent();
testCase11_ConflictingTypesInSameCollection();
testCase12_ConflictingDispersedSources();
testCase13_IntegrationSingleDocument();
testCase14_IntegrationMergeableShortCircuit();
testCase15_IntegrationAmbiguousShortCircuit();
testCase16_IntegrationZeroClarify();
// audit-round03 P1-2: 关键组合路径
testCase17_QueryOverrideMergeableMultiCandidate();
testCase18_AnswerIntentMergeableMultiCandidate();
testCase19_AnswerFromDocsMergeableWithEvidence();
testCase19b_AnchoredBridgeMergeableAnswer();
// audit-round04 P1-2: 单候选 answer-intent 边界
testCase20_SingleCandidateQueryOverride();
testCase21_SingleCandidateAnswerIntent();
testCase22_AnswerFromDocsSingleWithEvidence();
// audit-round07 P0: auto content chain 决策逻辑
testCase23_ShouldAutoChainQueryOverride();
testCase24_ShouldAutoChainMixedIntent();
testCase25_ShouldAutoChainPureLocate();
testCase26_ShouldAutoChainMultiCandidate();
testCase27_ShouldAutoChainChunkEvidence();

console.log(`\n${'='.repeat(40)}`);
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) process.exit(1);
