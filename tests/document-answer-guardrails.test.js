/**
 * 文档回答护栏测试
 *
 * 目标：确保标准参数类问答必须依据原文参数回答，
 * 不允许把证据中的明确数值改写成经验性描述。
 *
 * 运行：node tests/document-answer-guardrails.test.js
 */

import { buildEvidenceContextMessage } from '../lib/evidence-formatter.js';
import DocumentEvidencePacker from '../lib/document-evidence-packer.js';

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

function assertIncludes(text, expected, label) {
  assert(text.includes(expected), `${label} | 缺少: ${expected}`);
}

class ChatServiceLike {
  _buildResponseModeConstraint(mode) {
    switch (mode) {
      case 'clarify':
        return `## ⚠️ 强制回答约束：澄清模式`;

      case 'candidate_list':
        return `## ⚠️ 强制回答约束：候选列表模式（fallback）`;

      case 'conservative_answer':
        return `## ⚠️ 强制回答约束：保守回答模式

**你必须遵守以下规则，不得违反：**

1. **禁止给确定性的结论。** 证据不足时，不要用"根据文档..."开头来伪装确定性。
2. **明确告知依据有限。** 使用"目前检索到的信息有限""未找到明确依据"等表述。
3. **可以给出参考信息**，但必须注明证据强度较弱，仅供参考。
4. **不要补充超出检索结果的内容。** 如果你不了解某事，直接说"根据当前文档资料，我无法确认这一点"。
5. **如果证据中已经出现明确参数，就必须逐项照证据回答。** 禁止把“30min”改写成“通常至少1分钟”，禁止把“顶部以上0.15m、底面下1m”改成模糊说法。

## 输出模板（请严格按照以下结构输出）

**⚠️ 依据有限声明：** 目前从文档平台检索到的信息有限，以下回答仅供参考，可能存在不完整之处。

**参考信息：**
[基于检索到的证据片段，整理可提供的参考内容]

**不确定性提示：** [明确指出哪些部分缺乏充分证据支撑，建议用户进一步核实]`;

      case 'answer_with_citation':
        return `## ⚠️ 强制回答约束：引用回答模式

**你必须遵守以下规则，不得违反：**

1. **优先回答证据中已经明确写出的事实。** 尤其是数值、时长、距离、流量、章节号、表格项。
2. **禁止把原文参数改写成经验性表述。** 例如原文写“30min”，就不能说“通常至少1分钟”；原文写“顶部以上至少0.15m”，就不能说“在规定水深下”。
3. **若问题询问“代表什么/做什么实验/条件是什么”这类标准参数问题，回答时应分点列出：含义、试验装置、关键参数、对应条款。**
4. **如果证据没有覆盖某个细节，就明确说当前证据未显示该细节，不得脑补。**
5. **回答后附来源指向。** 至少指出文档名及证据对应的表/章/条（若证据中可见）。`;

      default:
        return '';
    }
  }
}

function testCase1_AnswerWithCitationConstraintContainsNoRewriteRule() {
  console.log('\n📋 场景1: answer_with_citation 约束禁止改写原文参数');
  const svc = new ChatServiceLike();
  const text = svc._buildResponseModeConstraint('answer_with_citation');

  assertIncludes(text, '禁止把原文参数改写成经验性表述', '1.1 应明确禁止经验性改写');
  assertIncludes(text, '30min', '1.2 应包含 30min 反例');
  assertIncludes(text, '顶部以上至少0.15m', '1.3 应包含 0.15m 反例');
  assertIncludes(text, '含义、试验装置、关键参数、对应条款', '1.4 应要求参数类问题按结构回答');
}

function testCase2_ConservativeConstraintContainsNoHallucinationRule() {
  console.log('\n📋 场景2: conservative_answer 约束禁止把参数说模糊');
  const svc = new ChatServiceLike();
  const text = svc._buildResponseModeConstraint('conservative_answer');

  assertIncludes(text, '如果证据中已经出现明确参数，就必须逐项照证据回答', '2.1 应要求逐项照证据回答');
  assertIncludes(text, '通常至少1分钟', '2.2 应覆盖错误示例');
  assertIncludes(text, '顶部以上0.15m、底面下1m', '2.3 应覆盖深度示例');
}

function testCase3_EvidenceContextContainsVerbatimAnswerRule() {
  console.log('\n📋 场景3: 证据注入文本应强调按原文参数作答');
  const packet = {
    strategy: 'document_first',
    meta: {
      evidence_sufficiency: 'medium',
      suggested_response_mode: 'answer_with_citation',
      reason_codes: ['medium_anchor_detected'],
    },
    documents: [
      {
        document_id: 'd-ip',
        document_title: 'GB/T 4208-2017 外壳防护等级(IP代码)',
        doc_type: 'standard',
        collection_name: '标准库',
        relevance_score: 0.88,
        candidate_confidence: 'high',
        evidence: [
          {
            score: 0.91,
            content: '表8 防水试验法和主要试验条件：第二位特征数字7，使用潜水箱，水面在外壳顶部以上至少0.15m，外壳底面在水面下至少1m，30min，14.2.7。',
          },
        ],
      },
    ],
  };

  const text = buildEvidenceContextMessage(packet, { maxTokens: 3000 });

  assertIncludes(text, '回答原则: 若证据中出现明确数值、时间、距离、章节号、表格参数，回答时必须优先逐项引用这些原文参数', '3.1 应有总则');
  assertIncludes(text, '不得补写证据中未出现的试验时长、深度、流量、步骤', '3.2 应禁止补写');
  assertIncludes(text, '30min', '3.3 证据应带出原文时长');
  assertIncludes(text, '0.15m', '3.4 证据应带出原文水深参数');
  assertIncludes(text, '14.2.7', '3.5 证据应带出条款');
}

function testCase4_CoverageNotCoveredOutput() {
  console.log('\n📋 场景4: not_covered 时输出 coverage 状态与原因');

  const packet = {
    strategy: 'degrade',
    meta: {
      evidence_sufficiency: 'weak',
      coverage_status: 'not_covered',
      coverage_reason_codes: ['coverage_miss_core_entity', 'no_evidence'],
      suggested_response_mode: 'conservative_answer',
      reason_codes: ['weak_evidence_degrade', 'fallback_blocked_by_coverage'],
    },
    documents: [
      {
        document_id: 'd1',
        document_title: '前言文档',
        doc_type: 'standard',
        collection_name: '标准库',
        relevance_score: 0.3,
        candidate_confidence: 'low',
        evidence: [
          { score: 0.3, content: '前言内容...' },
        ],
      },
    ],
  };

  const text = buildEvidenceContextMessage(packet, { maxTokens: 3000 });

  assertIncludes(text, '覆盖状态: not_covered', '4.1 应输出 coverage_status');
  assertIncludes(text, '覆盖原因: coverage_miss_core_entity', '4.2 应输出 coverage_reason_codes');
  assertIncludes(text, 'no_evidence', '4.3 应包含所有 coverage reason');
  assertIncludes(text, '流程原因: weak_evidence_degrade', '4.4 流程原因单独列出');
  assertIncludes(text, 'fallback_blocked_by_coverage', '4.5 fallback 被阻止的原因可见');
}

function testCase5_CoveragePartialOutput() {
  console.log('\n📋 场景5: partial 时输出覆盖原因');

  const packet = {
    strategy: 'document_first',
    meta: {
      evidence_sufficiency: 'medium',
      coverage_status: 'partial',
      coverage_reason_codes: ['coverage_partial_entity_match', 'coverage_no_chunk_overlap'],
      suggested_response_mode: 'conservative_answer',
      reason_codes: ['medium_anchor_detected'],
    },
    documents: [
      {
        document_id: 'd1',
        document_title: 'GB/T 4208',
        doc_type: 'standard',
        collection_name: '标准库',
        relevance_score: 0.7,
        candidate_confidence: 'medium',
        evidence: [
          { score: 0.6, content: '试验方法...' },
          { score: 0.5, content: 'IPX5 等级...' },
        ],
      },
    ],
  };

  const text = buildEvidenceContextMessage(packet, { maxTokens: 3000 });

  assertIncludes(text, '覆盖状态: partial', '5.1 partial 覆盖');
  assertIncludes(text, 'coverage_no_chunk_overlap', '5.2 chunk overlap 原因');
  assertIncludes(text, 'coverage_partial_entity_match', '5.3 partial entity 原因');
}

function testCase6_ParameterClosurePromotesCitationMode() {
  console.log('\n📋 场景6: 参数证据闭环命中时，不应被 partial+medium 降级');

  const packer = new DocumentEvidencePacker();
  const packet = packer.pack(
    [
      {
        document_id: 'd-ipx7',
        document_title: 'GB/T 4208-2017 外壳防护等级(IP代码)',
        doc_type: 'standard',
        collection_name: '标准库',
        relevance_score: 0.95,
        candidate_confidence: 'high',
      },
    ],
    [
      {
        score: 0.91,
        chunk: {
          id: 'c-ipx7',
          seq: 12,
          content: '表8 防水试验法和主要试验条件：第二位特征数字7，使用潜水箱，水面在外壳顶部以上至少0.15m，外壳底面在水面下至少1m，30min，14.2.7。',
        },
        document: { id: 'd-ipx7' },
      },
    ],
    { recommended_strategy: 'document_first', reason_codes: ['medium_anchor_detected'] },
    'trace-ipx7',
    {
      strategy: 'document_first',
      queryFacets: {
        entity_terms: ['IPX7'],
        procedure_terms: ['试验'],
        attribute_terms: ['是不是', '多少'],
      },
    }
  );

  assert(packet.meta.parameter_evidence_closure === true, '6.1 应识别参数证据闭环');
  assertIncludes(packet.meta.reason_codes.join(','), 'parameter_evidence_closure', '6.2 应记录闭环原因');
  assert(packet.meta.suggested_response_mode === 'answer_with_citation', '6.3 partial/medium 下应提升为 answer_with_citation');
}

function testCase7_ParameterClosureIsGenericForRatioQuestion() {
  console.log('\n📋 场景7: 比例参数问答同样适用闭环提升');

  const packer = new DocumentEvidencePacker();
  const packet = packer.pack(
    [
      {
        document_id: 'd-contract',
        document_title: '施工合同附件A',
        doc_type: 'contract',
        collection_name: '合同库',
        relevance_score: 0.93,
        candidate_confidence: 'high',
      },
    ],
    [
      {
        score: 0.89,
        chunk: {
          id: 'c-delay',
          seq: 5,
          content: '第12.3条：每逾期一日，按合同总价的0.3%支付违约金。',
        },
        document: { id: 'd-contract' },
      },
    ],
    { recommended_strategy: 'document_first', reason_codes: ['medium_anchor_detected'] },
    'trace-contract',
    {
      strategy: 'document_first',
      queryFacets: {
        entity_terms: ['违约金'],
        procedure_terms: [],
        attribute_terms: ['多少', '比例'],
      },
    }
  );

  assert(packet.meta.parameter_evidence_closure === true, '7.1 比例参数也应识别闭环');
  assert(packet.meta.suggested_response_mode === 'answer_with_citation', '7.2 比例参数问答应进入引用回答模式');
}

console.log('╔══════════════════════════════════════╗');
console.log('║  Document Answer Guardrails 测试    ║');
console.log('╚══════════════════════════════════════╝');

testCase1_AnswerWithCitationConstraintContainsNoRewriteRule();
testCase2_ConservativeConstraintContainsNoHallucinationRule();
testCase3_EvidenceContextContainsVerbatimAnswerRule();
testCase4_CoverageNotCoveredOutput();
testCase5_CoveragePartialOutput();
testCase6_ParameterClosurePromotesCitationMode();
testCase7_ParameterClosureIsGenericForRatioQuestion();

console.log(`\n${'='.repeat(40)}`);
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log(`${'='.repeat(40)}`);

if (failed > 0) {
  process.exit(1);
}
