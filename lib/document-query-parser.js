/**
 * Document Query Parser - 文档查询轻量结构化解析器
 *
 * 在 find_document 检索链路中作为第一层，对用户 query 进行轻量结构化解析：
 * - 抽取检索真正需要的槽位（主题词、类型偏好、编号线索）
 * - 生成清洗后的检索 query 与主题扩召 query
 * - 判断用户是否在"找文档身份"（lookup_intent）
 *
 * 设计原则：
 * - 纯规则驱动，不依赖 LLM 调用，零延迟
 * - 输出可审计、可观测、可增量维护
 * - query 生成主权归本模块，recall 层原则上只消费不隐式改写
 *
 * 使用方式：
 *   import { parseDocumentQuery } from './document-query-parser.js';
 *   const parsed = parseDocumentQuery(rawQuery);
 *
 * 输出契约（DocumentQueryParseResult）：
 *   lookup_intent:       boolean   - 是否在找文档身份
 *   topic_terms:         string[]  - 主题词列表
 *   doc_type_hints:      string[]  - 文档类型偏好（国家标准/合同/制度等）
 *   identifier_hints:    string[]  - 标准号/合同号/文号等
 *   cleaned_query:       string    - 清洗后的主检索 query（仅含主题词）
 *   expanded_topic_queries: string[] - 主题放宽扩召 query 列表
 *   noise_terms:         string[]  - 被剔除的口语化噪音词
 */

import logger from './logger.js';

// ============================================================
// 噪音词模式：口语化表达，检索时应当剔除
// ============================================================
const NOISE_PATTERNS = [
  // 口语化指代
  /有一个/g, /有一份/g, /有一篇/g, /有一个叫/g,
  /规定了/g, /规定了什么/g, /说的是/g, /讲的是/g,
  /主要讲的是什么/g, /主要讲什么/g, /主要讲的是/g,
  /主要内容是什么/g, /主要内容/g,
  /是啥来着/g, /是什么来着/g, /叫什么来着/g,
  /文件/g, /那个文件/g, /那份文件/g, /那份文档/g,
  /帮我找/g, /帮我查/g, /帮我看看/g, /帮我看一下/g,
  /找一下/g, /查一下/g, /看一下/g, /搜一下/g,
  /请问/g, /我想问/g, /我想知道/g, /我想了解/g,
  /能不能/g, /可不可以/g, /可以吗/g,
  /在哪里/g, /在哪/g, /哪里找/g, /怎么找/g,
  /来着/g, /对吧/g, /对不/g, /是不是/g,
  // 口语动词补语碎片（audit-round04 P1-1）
  /一下/g,
  // 疑问词（audit-round03 P1-2）
  /哪些/g, /哪个/g, /哪里/g, /什么/g, /怎么/g,
  /有没有/g, /有没有关于/g, /有没有一个/g,
  // 口语后缀（audit-round03 P1-2）
  /那份/g, /那个/g, /那[份个]/g, /这[份个]/g,
  // 语气/疑问词
  /吗[\?？]*$/g, /呢[\?？]*$/g, /吧[\?？]*$/g, /啊[\?？]*$/g, /[\?？]/g,
];

// ============================================================
// 文档类型提示词 → 标准类型 → 用于剥离的关键词集合
// ============================================================
const DOC_TYPE_HINT_MAP = [
  // 国家标准
  { patterns: [/国家标准/, /国标/, /国家规范/, /强制性标准/, /推荐性标准/, /^标准$/, /标准号/, /标准名称/], type: '国家标准' },
  // 行业标准
  { patterns: [/行业标准/, /行标/, /团体标准/, /企业标准/, /企标/], type: '行业标准' },
  // 合同/协议
  { patterns: [/合同/, /协议/, /契约/, /合约/], type: '合同协议' },
  // 制度/办法/规定 — 注意：不使用裸 /规定/，避免把"规定了"动词误判为文档类型
  { patterns: [/(?:管理制度|管理规定|暂行规定|试行规定|实施办法|管理办法|暂行条例)/, /制度/, /办法/, /条例/, /章程/, /细则/, /规程/], type: '制度规章' },
  // 手册/指南
  { patterns: [/手册/, /指南/, /说明书/, /操作指引/, /作业指导/], type: '手册指南' },
  // 报告
  { patterns: [/报告/, /报表/, /分析报告/, /评估报告/], type: '报告' },
  // 法律文件
  { patterns: [/法律/, /法规/, /法令/, /司法解释/], type: '法律法规' },
  // 技术文档
  { patterns: [/技术文档/, /技术规范/, /技术方案/, /技术规格书/], type: '技术文档' },
];

// ============================================================
// 类型关键词剥离模式（从 cleaned_query 中剔除已识别的类型词）
// 基于 DOC_TYPE_HINT_MAP 的 patterns，提取可剥离的关键词片段
// ============================================================
const TYPE_STRIP_PATTERNS = [
  /国家标准/g, /国标/g, /国家规范/g, /强制性标准/g, /推荐性标准/g,
  /行业标准/g, /行标/g, /团体标准/g, /企业标准/g, /企标/g,
  /合同/g, /协议/g, /契约/g, /合约/g,
  /管理制度/g, /管理规定/g, /暂行规定/g, /试行规定/g, /实施办法/g, /管理办法/g, /暂行条例/g,
  /制度/g, /办法/g, /条例/g, /章程/g, /细则/g, /规程/g,
  /手册/g, /指南/g, /说明书/g, /操作指引/g, /作业指导/g,
  /报告/g, /报表/g, /分析报告/g, /评估报告/g,
  /法律/g, /法规/g, /法令/g, /司法解释/g,
  /技术文档/g, /技术规范/g, /技术方案/g, /技术规格书/g,
];

// ============================================================
// 结构助词：用于拆分主题词时清理的虚词/连接词
// ============================================================
const STRUCTURAL_PARTICLES = /[的之与和及或关于有关涉及对]+/g;

// ============================================================
// 标准号/编号模式
// ============================================================
const IDENTIFIER_PATTERNS = [
  // GB/T 12345-2020, GB 12345
  /\bGB[\/\sT]*\d[\d.]*(-\d{2,4})?\b/gi,
  // ISO 9001:2015
  /\bISO[\/\s]*\d[\d.:]+\b/gi,
  // 行业标准号：YY/T, HJ, DB, QB 等
  /\b(?:YY\/T|HJ|DB\d|\bQB)\s*\d[\d.]*\b/gi,
  // 合同编号：HT-2024-001
  /\b(?:HT|CONT|CONTRACT)[-\s]*\d{2,4}[-\s]*\d+\b/gi,
  // 文件号/文号：国发〔2024〕1号
  /[〔\[]?\d{4}[〕\]]?\d+\s*号/gi,
];

// ============================================================
// 文档定位信号：用户明确在找"文档身份"
// ============================================================
const LOOKUP_INTENT_PATTERNS = [
  /找.*(?:文档|文件|资料|合同|标准|制度|手册|指南|报告)/,
  /(?:文档|文件|资料|合同|标准|制度|手册|指南|报告).*(?:在哪|叫啥|叫什么|是啥|是什么)/,
  /有没有.*(?:文档|文件|资料|合同|标准|制度)/,
  /哪个.*(?:文档|文件|合同|标准|制度)/,
  /《[^》]+》/,
  // 编号查询
  /\bGB[\/\sT]*\d/,
  /\bISO[\/\s]*\d/,
  /[〔\[]?\d{4}[〕\]]?\d+\s*号/,
];

// ============================================================
// 同义词归一表（主题词扩展用）
// ============================================================
const SYNONYM_MAP = {
  '汽车': ['车辆', '机动车'],
  '车身': ['车体'],
  '术语': ['词汇', '用语', '名词'],
  '定义': ['释义', '含义'],
  '标准': ['规范', '准则'],
  '合同': ['协议'],
  '制度': ['规章', '规定'],
  '指南': ['手册', '指引'],
};

// ============================================================
// Query Facet 抽取 — audit-round01 P1-1
// 供 evidence rerank / coverage 校验消费，避免各模块重复拆词
// ============================================================
const PROCEDURE_TERM_PATTERNS = [
  /试验/g, /实验/g, /测试/g, /检测/g, /检验/g,
  /条件/g, /方法/g, /步骤/g, /流程/g, /要求/g, /规定/g, /规范/g,
  /怎么做/g, /如何做/g, /怎么测/g, /如何测/g,
];

const ATTRIBUTE_TERM_PATTERNS = [
  /是什么/g, /什么是/g, /代表什么/g, /含义/g, /定义/g,
  /等级/g, /级别/g, /分类/g, /类型/g,
  /多少/g, /多大/g, /多长/g, /多重/g,
];

/**
 * 从原始 query 提取结构化 facets（轻量规则驱动）
 * @param {string} rawQuery
 * @param {string[]} identifierHints
 * @returns {Object} facets
 */
function _extractQueryFacets(rawQuery, identifierHints) {
  const trimmed = rawQuery.trim();

  // entity_terms：标识符 + 数字编码 + 专有名词型实体
  const entityTerms = [];

  // 标识符直接作为实体
  for (const id of identifierHints) {
    entityTerms.push(id);
  }

  // 数字编码型实体（如 IPX5、IPX7、14.2.5、第二位数字为5）
  const codePatterns = [
    /\b[A-Z]{2,}[\s-]*\d[\d.]*\b/gi,      // IPX5, GB/T 12345
    /\b\d+(?:\.\d+)+\b/g,                    // 14.2.5
    /第[一二三四五六七八九十\d]+位数字为\d+/g,  // 第二位数字为5
    /第[一二三四五六七八九十\d]+[章节条款项]/g, // 第二章、第3条
  ];
  for (const pattern of codePatterns) {
    const matches = trimmed.match(pattern);
    if (matches) {
      for (const m of matches) {
        const clean = m.replace(/\s+/g, ' ').trim();
        if (!entityTerms.some(e => e === clean)) {
          entityTerms.push(clean);
        }
      }
    }
  }

  // 专有名词型实体（由大写字母起头的中英混合词，如 "IP 防护"）
  const properNounPattern = /\b[A-Z]{2,}(?:[\s/-]*[^\s,，。；;、]{1,6}){0,3}/g;
  const properMatches = trimmed.match(properNounPattern);
  if (properMatches) {
    for (const m of properMatches) {
      const clean = m.replace(/\s+/g, ' ').trim();
      if (clean.length >= 2 && !entityTerms.some(e => e === clean) && !/^[A-Z]+$/.test(clean)) {
        entityTerms.push(clean);
      }
    }
  }

  // procedure_terms
  const procedureTerms = [];
  for (const pattern of PROCEDURE_TERM_PATTERNS) {
    const matches = trimmed.match(new RegExp(pattern.source, 'g'));
    if (matches) {
      for (const m of matches) {
        if (!procedureTerms.includes(m)) procedureTerms.push(m);
      }
    }
  }

  // attribute_terms
  const attributeTerms = [];
  for (const pattern of ATTRIBUTE_TERM_PATTERNS) {
    const matches = trimmed.match(new RegExp(pattern.source, 'g'));
    if (matches) {
      for (const m of matches) {
        if (!attributeTerms.includes(m)) attributeTerms.push(m);
      }
    }
  }

  // normalized_lookup_query：实体 + 程序词拼接
  const normalizedParts = [...new Set([...entityTerms, ...procedureTerms])];
  const normalizedLookupQuery = normalizedParts.join(' ') || trimmed;

  return {
    entity_terms: [...new Set(entityTerms)],
    procedure_terms: [...new Set(procedureTerms)],
    attribute_terms: [...new Set(attributeTerms)],
    normalized_lookup_query: normalizedLookupQuery,
  };
}

/**
 * @typedef {Object} DocumentQueryParseResult
 * @property {boolean} lookup_intent - 是否在找文档身份
 * @property {string[]} topic_terms - 主题词列表
 * @property {string[]} doc_type_hints - 文档类型偏好
 * @property {string[]} identifier_hints - 标准号/合同号/文号
 * @property {string} cleaned_query - 清洗后的主检索 query（仅主题词）
 * @property {string[]} expanded_topic_queries - 主题放宽扩召 query
 * @property {string[]} noise_terms - 被剔除的口语化噪音词
 * @property {string} raw_query - 原始 query
 * @property {Object} facets - 查询结构化切面（audit-round01 P1-1）
 * @property {string[]} facets.entity_terms - 核心实体词
 * @property {string[]} facets.procedure_terms - 程序/方法词
 * @property {string[]} facets.attribute_terms - 属性/问法词
 * @property {string} facets.normalized_lookup_query - 归一化查找 query
 */

/**
 * 解析文档查询，提取结构化槽位
 *
 * 处理顺序（关键）：
 *   原 query → 剔除噪音词 → 提取文档类型偏好 → 剔除类型关键词 → 提取主题词
 * 必须先剔除噪音再检测类型，避免"规定了"等噪音词被误判为制度规章。
 * 必须在提取类型后再剔除类型关键词，保证 cleaned_query 不受类型词污染。
 *
 * @param {string} rawQuery - 原始用户查询
 * @returns {DocumentQueryParseResult}
 */
export function parseDocumentQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return _emptyResult(rawQuery || '');
  }

  const trimmed = rawQuery
    .replace(/[？]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. 检测文档定位意图（使用原始 query）
  const lookupIntent = LOOKUP_INTENT_PATTERNS.some(p => p.test(trimmed));

  // 2. 提取编号线索（使用原始 query，编号是精确信号）
  const identifierHints = [];
  for (const pattern of IDENTIFIER_PATTERNS) {
    const matches = trimmed.match(pattern);
    if (matches) {
      identifierHints.push(...matches.map(m => m.trim()));
    }
  }

  // 3. 【关键顺序变更】先剔除噪音词，再检测类型偏好
  //    避免"规定了"等口语噪音词被 DOC_TYPE_HINT_MAP 误判为制度规章
  let cleaned = trimmed;
  const noiseTerms = [];

  cleaned = cleaned
    .replace(/主要讲的是什么/g, ' ')
    .replace(/主要讲什么/g, ' ')
    .replace(/主要讲的是/g, ' ')
    .replace(/主要内容是什么/g, ' ')
    .replace(/主要内容/g, ' ')
    .replace(/什么标准/g, ' 标准 ')
    .replace(/什么文件/g, ' 文件 ')
    .replace(/什么文档/g, ' 文档 ')
    .replace(/是什么标准/g, ' 标准 ')
    .replace(/是什么文件/g, ' 文件 ')
    .replace(/是什么文档/g, ' 文档 ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const pattern of NOISE_PATTERNS) {
    const matches = cleaned.match(new RegExp(pattern.source, 'g'));
    if (matches) {
      noiseTerms.push(...matches);
    }
    cleaned = cleaned.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  }

  // 4. 在噪音已剔除的文本上检测文档类型偏好
  //    注意：DOC_TYPE_HINT_MAP 的 patterns 不使用 /g，避免 lastIndex 状态泄漏
  const docTypeHints = [];
  for (const entry of DOC_TYPE_HINT_MAP) {
    for (const p of entry.patterns) {
      if (p.test(cleaned)) {
        const trimmedType = entry.type.trim();
        if (!docTypeHints.includes(trimmedType)) {
          docTypeHints.push(trimmedType);
        }
        break;
      }
    }
  }

  // 5. 【新增】类型关键词剥离：从 cleaned 文本中剔除已识别的类型词
  //    确保 cleaned_query 不受"国标""合同""制度"等类型词污染
  let topicText = cleaned;
  for (const typePattern of TYPE_STRIP_PATTERNS) {
    topicText = topicText.replace(typePattern, ' ').replace(/\s+/g, ' ').trim();
  }

  // 6. 清理结构助词（的、之、与、和、及、或、关于、有关、涉及、对）
  topicText = topicText.replace(STRUCTURAL_PARTICLES, ' ').replace(/\s+/g, ' ').trim();

  // 6.5: 标识符剥离（audit-round04 P1-1）—— 在分词前将已捕获的完整编号从主题文本中移除
  //     防止编号片段（如"一下HT""GB/T"残片）污染 topic_terms
  let topicTextForSegmentation = topicText;
  if (identifierHints.length > 0) {
    for (const id of identifierHints) {
      // 转义标识符中的正则特殊字符
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      topicTextForSegmentation = topicTextForSegmentation
        .replace(new RegExp(escaped, 'gi'), ' ')
        .replace(/\s+/g, ' ').trim();
    }
    // 同时剥离常见标识符前缀碎片（如 "GB/T"、"HT" 等孤立残片）
    topicTextForSegmentation = topicTextForSegmentation
      .replace(/\b(?:GB\/T|GB|ISO|HT|CONT|CONTRACT|YY\/T|HJ|DB\d+|QB)\b\s*/gi, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // 7. 从剥离后的纯主题文本中提取主题词
  const topicTerms = _extractTopicTerms(topicTextForSegmentation || topicText, docTypeHints, identifierHints)
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => !['标准', '文件', '文档', '规范', '资料'].includes(t));

  // 8. 构造 cleaned_query（兼容 merge 前稳定语义）：
  //    - 有编号时：编号优先 + 主题词随后
  //    - 无编号时：优先保留连续主题文本，不强制用空格重组
  let cleanedQuery;
  const dedupedIds = [...new Set(identifierHints)];
  const idPart = dedupedIds.join(' ');
  const cleanTopicTerms = topicTerms.filter(t => {
    // 过滤掉标识符残片（如 "GB/T"、"一下HT"）
    if (/^(?:GB\/T|GB\d*|ISO\d*|HT[-\s]?\d*|CONT[-\s]?\d*|CONTRACT[-\s]?\d*|[A-Z]{2,}\/?\d*)$/i.test(t)) return false;
    // 过滤已在 identifier_hints 中的片段
    if (dedupedIds.some(id => t.includes(id) || id.includes(t))) return false;
    return true;
  });

  const contiguousTopicText = (topicTextForSegmentation || topicText || '')
    .replace(/\s+/g, ' ')
    .trim();

  const topicPart = cleanTopicTerms.join(' ');

  if (idPart && topicPart) {
    cleanedQuery = idPart + ' ' + topicPart;
  } else if (idPart) {
    cleanedQuery = idPart;
  } else if (contiguousTopicText) {
    cleanedQuery = contiguousTopicText.replace(/\s+/g, '');
  } else if (topicPart) {
    cleanedQuery = topicPart;
  } else {
    cleanedQuery = topicText || cleaned;
  }
  // 最终去重空格
  cleanedQuery = cleanedQuery.replace(/\s+/g, ' ').trim();

  // 9. 生成主题扩召 query 列表
  const expandedTopicQueries = _generateExpandedQueries(topicTerms);

  // 10. 提取 query facets（audit-round01 P1-1）
  const facets = _extractQueryFacets(trimmed, identifierHints);

  const result = {
    lookup_intent: lookupIntent || identifierHints.length > 0 || docTypeHints.length > 0,
    topic_terms: topicTerms,
    doc_type_hints: docTypeHints.map(t => t.trim()).filter(Boolean),
    identifier_hints: [...new Set(identifierHints)],
    cleaned_query: cleanedQuery,
    expanded_topic_queries: expandedTopicQueries,
    noise_terms: [...new Set(noiseTerms)],
    raw_query: trimmed,
    facets,
  };

  logger.info('[DocQueryParser] Parsed:', {
    raw_query: trimmed.substring(0, 100),
    lookup_intent: result.lookup_intent,
    topic_terms: result.topic_terms,
    doc_type_hints: result.doc_type_hints,
    cleaned_query: result.cleaned_query,
    expanded_count: result.expanded_topic_queries.length,
  });

  return result;
}

/**
 * 从剥离类型词后的纯主题文本中提取主题词
 *
 * 注意：调用方已通过 TYPE_STRIP_PATTERNS 剥离了类型关键词，
 * 因此本函数不再需要基于 doc_type_hints 做字符级过滤。
 */
function _extractTopicTerms(topicText, _docTypeHints, identifierHints) {
  if (!topicText) return [];

  // 1. 优先按标点/空格分割
  let segments = topicText
    .split(/[,，。；;、\s]+/)
    .map(s => s.trim())
    .filter(Boolean);

  // 2. 中文无空格长文本 → 启发式切分
  if (segments.length <= 1 && topicText.length > 3) {
    segments = _segmentChineseText(topicText);
  }

  // 3. 基础过滤 + 标识符碎片过滤（audit-round04 P1-1）
  return segments.filter(seg => {
    if (seg.length <= 1) return false;
    if (/^[\d.,+\-×÷=<>()（）【】\[\]{}]+$/.test(seg)) return false;
    // 过滤掉纯编号片段
    if (identifierHints.some(id => seg.includes(id))) return false;
    // 过滤标识符残片（如 "一下HT" 中的 "一下HT"、"GB/T" 残片）
    if (/^(?:GB\/T|GB\d*|ISO\d*|HT[-\s]?\d*|CONT[-\s]?\d*|CONTRACT[-\s]?\d*|[A-Z]{2,}\/?\d*)$/i.test(seg)) return false;
    return true;
  });
}

/**
 * 对中文无空格文本做启发式切分
 *
 * 策略（audit-round02 P1 改进）：
 * - 优先用已知类型关键词作为切分边界（"标准""合同""制度""手册"等）
 * - 边界内按 2-4 字滑窗切分
 */
function _segmentChineseText(text) {
  // 先用常见类型关键词作为分割锚点
  const SPLIT_ANCHORS = [
    '国家标准', '行业标准', '团体标准', '企业标准', '强制性标准', '推荐性标准',
    '管理制度', '管理规定', '实施办法', '管理办法', '暂行规定', '暂行条例',
    '技术文档', '技术规范', '技术方案', '技术规格书',
    '操作指引', '作业指导', '分析报告', '评估报告', '司法解释',
  ];

  let working = text;
  const anchorPieces = [];

  for (const anchor of SPLIT_ANCHORS) {
    if (working.includes(anchor)) {
      anchorPieces.push(anchor);
      working = working.replace(anchor, '\n');
    }
  }

  // 对剩余文本做滑窗切分
  const rawSegments = working
    .split(/[\n]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const segments = [];
  for (const raw of rawSegments) {
    // 尝试 4→3→2 字滑窗
    let i = 0;
    while (i < raw.length) {
      let matched = false;
      for (const len of [4, 3, 2]) {
        if (i + len <= raw.length) {
          const candidate = raw.substring(i, i + len);
          if (!/^[\d.,+\-×÷=<>()（）\s]+$/.test(candidate)) {
            segments.push(candidate);
            i += len;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        i++;
      }
    }
  }

  // 把锚点关键词插回合适位置
  segments.push(...anchorPieces);

  return segments;
}

/**
 * 主题词常见边界表 —— 用于长主题词的放宽拆分（audit-round03 P2-1）
 * 键：常见尾词/后缀；值：null 表示仅作拆分锚点
 */
const TOPIC_SPLIT_SUFFIXES = [
  '术语', '定义', '标准', '规范', '指南', '手册', '办法', '规定',
  '制度', '条例', '流程', '方案', '报告', '说明', '要求', '条件',
  '指标', '参数', '方法', '技术', '系统', '管理', '安全', '质量',
  '性能', '设计', '测试', '评估', '分析', '计算', '操作', '维护',
];

/**
 * 生成主题扩召 query 列表
 *
 * 策略：
 * - A) 多词主题，生成部分组合（去尾部修饰）
 * - B) 单词主题，查找同义词表生成替换 query
 * - C) 长单主题词（4+字），按已知词边界拆分放宽（audit-round03 P2-1）
 * - 不做类型收窄（不追加"标准""国标"等类型词）
 *
 * @param {string[]} topicTerms - 主题词列表
 * @returns {string[]} 扩召 query 列表
 */
function _generateExpandedQueries(topicTerms) {
  if (!topicTerms || topicTerms.length === 0) return [];

  const queries = [];

  // 策略 A：多词主题 → 去尾部修饰，逐步放宽
  if (topicTerms.length >= 2) {
    // 去掉最后一个词
    const droppedLast = topicTerms.slice(0, -1).join(' ');
    if (droppedLast.length >= 2) {
      queries.push(droppedLast);
    }
    // 去掉第一个词（常用于剥离泛领域前缀，如“汽车 外壳防护等级” → “外壳防护等级”）
    const droppedFirst = topicTerms.slice(1).join(' ');
    if (droppedFirst.length >= 2) {
      queries.push(droppedFirst);
    }
    // 去掉前两个词之后的部分（保留核心前两词）
    if (topicTerms.length >= 3) {
      const coreTwo = topicTerms.slice(0, 2).join(' ');
      if (coreTwo.length >= 2 && coreTwo !== droppedLast) {
        queries.push(coreTwo);
      }
    }
  }

  // 策略 B：单主题词 → 查找同义词
  for (const term of topicTerms) {
    const synonyms = SYNONYM_MAP[term];
    if (synonyms && synonyms.length > 0) {
      for (const syn of synonyms) {
        const expandedQuery = topicTerms.map(t => t === term ? syn : t).join(' ');
        if (expandedQuery !== topicTerms.join(' ') && !queries.includes(expandedQuery)) {
          queries.push(expandedQuery);
        }
      }
    }
  }

  // 策略 C：长单主题词（4+ 字）→ 按已知词边界拆分放宽（audit-round03 P2-1）
  if (topicTerms.length === 1) {
    const singleTerm = topicTerms[0];
    if (singleTerm.length >= 4) {
      for (const suffix of TOPIC_SPLIT_SUFFIXES) {
        if (singleTerm.endsWith(suffix) && singleTerm.length > suffix.length) {
          const prefix = singleTerm.slice(0, -suffix.length);
          if (prefix.length >= 2) {
            // 拆分：前缀 + 尾词（如 汽车车身 + 术语）
            queries.push(prefix + ' ' + suffix);
            // 进一步放宽：仅前缀（如 汽车车身）
            queries.push(prefix);
          }
          break; // 只取第一个匹配的尾词（最长匹配优先）
        }
      }
    }
  }

  // 去重，限制数量
  return [...new Set(queries)].slice(0, 5);
}

/**
 * 返回空解析结果
 */
function _emptyResult(rawQuery) {
  return {
    lookup_intent: false,
    topic_terms: [],
    doc_type_hints: [],
    identifier_hints: [],
    cleaned_query: rawQuery || '',
    expanded_topic_queries: [],
    noise_terms: [],
    raw_query: rawQuery || '',
    facets: {
      entity_terms: [],
      procedure_terms: [],
      attribute_terms: [],
      normalized_lookup_query: rawQuery || '',
    },
  };
}

export default { parseDocumentQuery };
