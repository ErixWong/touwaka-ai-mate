/**
 * Standard Anchor Skill - 标准锚点识别工具集
 *
 * 为标准管理 App 的"锚点识别 agent"（引用清洗 agent）提供最小工具集。
 * 工具运行在 VM 沙箱子进程，无数据库连接，通过 HTTP 调文档平台 API。
 *
 * 环境变量（由 skill-runner 自动注入）：
 * - API_BASE: 文档平台 API 基础 URL（默认 http://localhost:3017）
 * - USER_ACCESS_TOKEN: 用户 JWT
 *
 * @module standard-anchor
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3017';
const AUTH_HEADER = { 'Authorization': `Bearer ${process.env.USER_ACCESS_TOKEN || ''}` };

// ============================================
// 工具实现
// ============================================

/**
 * 解析锚点字符串
 *
 * 格式：<document_id+revision_id(+outline_id)>
 *
 * @param {object} params
 * @param {string} params.anchor - 锚点字符串
 * @returns {object} { document_id, revision_id, outline_id }
 */
async function parseAnchor(params) {
  const { anchor } = params;
  if (!anchor || typeof anchor !== 'string') {
    throw new Error('anchor is required and must be a string');
  }

  // 去掉尖括号
  const inner = anchor.replace(/^<|>$/g, '');
  const parts = inner.split('+');

  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`Invalid anchor format: ${anchor}. Expected <document_id+revision_id> or <document_id+revision_id+outline_id>`);
  }

  const result = {
    document_id: parts[0],
    revision_id: parts[1],
    outline_id: parts[2] || null,
  };

  return result;
}

/**
 * HTTP 请求辅助函数
 */
async function apiGet(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { headers: AUTH_HEADER });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} returned ${res.status}: ${body}`);
  }

  const json = await res.json();

  // 统一响应格式：response.data.data
  if (json && json.code === 200 && json.data) {
    return json.data;
  }

  throw new Error(`Unexpected API response from ${path}: ${JSON.stringify(json)}`);
}

async function apiPost(path, body) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...AUTH_HEADER,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`API ${path} returned ${res.status}: ${bodyText}`);
  }

  const json = await res.json();

  if (json && json.code === 200 && json.data) {
    return json.data;
  }

  throw new Error(`Unexpected API response from ${path}: ${JSON.stringify(json)}`);
}

/**
 * 按 revision_id 列出章节（outline）列表
 *
 * ⚠️ 只返回 id/title/seq 三个字段，故意丢弃 original_text 等大字段。
 * 原因：LLM 上下文窗口有限，Tool 结果超过 10000 字符会被截断，
 * 如果 id 被截断，Agent 会编造不存在的 source_outline_id。
 * 需要正文内容时使用 read_revision_content 或 read_section_context。
 *
 * @param {object} params
 * @param {string} params.revision_id - 版本 ID
 * @returns {Promise<Array>} 章节列表 [{ id, title, seq }]
 */
async function listRevisionSections(params) {
  const { revision_id } = params;
  if (!revision_id) throw new Error('revision_id is required');

  const outlines = await apiGet(`/api/docs/revisions/${revision_id}/outlines`);
  // 只保留 id/title/seq，丢弃 original_text 等大字段，防止 Tool 结果被截断导致 Agent 编造 ID
  return outlines.map(({ id, title, seq }) => ({ id, title, seq }));
}

/**
 * 读取指定 section 正文及上下文（R16-2：按 chunk 翻页）
 *
 * 修订说明（AUDIT-ROUND16 §3 根因 B）：JLY 664F 的 4/5/6 章是巨型单节
 * （14k~18k 字符），整节读取会超过工具结果摘要阈值（5000 字符），agent 只
 * 看到章节前部，尾部引用漏洗。因此改为按 chunk 翻页：服务端把该 outline
 * 下的 document_chunks 展平成页，每页 1 个 chunk（≤4000 字符）。
 *
 * 翻页协议：返回 page_has_more=true 时，必须用 page_next_offset 作为 page
 * 继续调用，直到 page_has_more=false，确保逐字通读整节。返回 chunk_id /
 * chunk_seq / from_line / to_line / overlap_lines（与上一 chunk 的重叠行数，
 * 该重叠是 embedding 上下文连续性设计，写锚点时按 from_line 去重，不要把
 * 重叠处引用写两遍）。
 *
 * @param {object} params
 * @param {string} params.outline_id - 章节 ID
 * @param {number} [params.context_window=0] - 上下文窗口大小（前后各取几个相邻 outline）
 * @param {number} [params.page=0] - chunk 页序号（0 起，翻页用，取上一页的 page_next_offset）
 * @param {number} [params.max_page_chars=4000] - 单页最大字符数（默认 4000，低于摘要阈值 5000）
 * @returns {Promise<object>} { section, context_before, context_after }
 *   section 含 original_text 分页切片 + page_has_more / page_next_offset / chunk 元信息
 */
async function readSectionContext(params) {
  const { outline_id, context_window = 0, page = 0, max_page_chars = 4000 } = params;
  if (!outline_id) throw new Error('outline_id is required');

  // 分页参数透传，避免工具结果超过摘要阈值被上下文管理摘要化
  const pageParams = [];
  if (page > 0) pageParams.push(`page=${page}`);
  if (max_page_chars > 0) pageParams.push(`max_page_chars=${max_page_chars}`);
  const qs = pageParams.length ? `?${pageParams.join('&')}` : '';
  const section = await apiGet(`/api/docs/outlines/${outline_id}/section${qs}`);
  if (!section) throw new Error(`Section not found: ${outline_id}`);

  let context_before = [];
  let context_after = [];

  if (context_window > 0 && section.revision_id) {
    // 获取同 revision 下所有 outline，按 seq 找相邻
    const allOutlines = await apiGet(`/api/docs/revisions/${section.revision_id}/outlines`);
    const idx = allOutlines.findIndex(o => o.id === outline_id);

    if (idx >= 0) {
      const start = Math.max(0, idx - context_window);
      const end = Math.min(allOutlines.length, idx + context_window + 1);

      context_before = allOutlines.slice(start, idx);
      context_after = allOutlines.slice(idx + 1, end);
    }
  }

  return {
    section: {
      id: section.id,
      revision_id: section.revision_id,
      parent_id: section.parent_id || null,
      heading: section.heading || '',
      level: section.level ?? null,
      seq: section.seq ?? null,
      original_text: section.original_text || '',
      page_index: section.page_index ?? 0,
      page_has_more: !!section.page_has_more,
      page_next_offset: section.page_next_offset ?? null,
      page_total_chars: section.page_total_chars ?? 0,
      chunk_count: section.chunk_count ?? 0,
      chunk_id: section.chunk_id || null,
      chunk_seq: section.chunk_seq ?? null,
      from_line: section.from_line ?? null,
      to_line: section.to_line ?? null,
      overlap_lines: section.overlap_lines ?? 0,
      split_page: !!section.split_page,
      sub_split: !!section.sub_split,
    },
    context_before: context_before.map(item => ({
      id: item.id,
      heading: item.heading || '',
      level: item.level ?? null,
      seq: item.seq ?? null,
    })),
    context_after: context_after.map(item => ({
      id: item.id,
      heading: item.heading || '',
      level: item.level ?? null,
      seq: item.seq ?? null,
    })),
  };
}

/**
 * 读取指定 revision 的全文内容（R16-2：支持 offset_chars 翻页）
 *
 * 长文一次读不完时返回 content_has_more=true，agent 必须用 offset_chars
 * 继续翻页直到 content_has_more=false。
 *
 * @param {object} params
 * @param {string} params.revision_id - 版本 ID
 * @param {number} [params.max_chars=20000] - 单页最大字符数（0=不截断）
 * @param {number} [params.offset_chars=0] - 起始字符偏移（翻页用，取上一页 content_offset + 本页长度）
 * @returns {Promise<object>} { text, revision, content_truncated, content_offset, content_has_more, content_total_chars }
 */
async function readRevisionContent(params) {
  const { revision_id, max_chars = 20000, offset_chars = 0 } = params;
  if (!revision_id) throw new Error('revision_id is required');

  // R3-4：始终透传 max_chars，服务端用 undefined 判断
  const qs = `max_chars=${max_chars}${offset_chars > 0 ? `&offset_chars=${offset_chars}` : ''}`;
  const result = await apiGet(`/api/docs/revisions/${revision_id}/content?${qs}`);
  return result;
}

/**
 * 通过 outline_id 反查所属 document 和 revision 信息
 *
 * @param {object} params
 * @param {string} params.outline_id - 章节 ID
 * @returns {Promise<object>} { outline_id, revision_id, document_id, outline, revision, document }
 */
async function getSectionLocator(params) {
  const { outline_id } = params;
  if (!outline_id) throw new Error('outline_id is required');

  const locator = await apiGet(`/api/docs/outlines/${outline_id}/locator`);
  return locator;
}

// ============================================
// P2-1: 定位类工具
// ============================================

/**
 * 按标准编号查找标准
 */
async function findDocumentsByStandardCode(params) {
  const { standard_code } = params;
  if (!standard_code) throw new Error('standard_code is required');

  const standards = await apiGet(`/api/apps/standard-mgr/standards/find?standard_code=${encodeURIComponent(standard_code)}`);
  return standards;
}

/**
 * 按标准名称查找标准
 */
async function findDocumentsByStandardName(params) {
  const { standard_name } = params;
  if (!standard_name) throw new Error('standard_name is required');

  const standards = await apiGet(`/api/apps/standard-mgr/standards/find?standard_name=${encodeURIComponent(standard_name)}`);
  return standards;
}

/**
 * 获取文档的版本列表
 */
async function getDocumentRevisions(params) {
  const { document_id } = params;
  if (!document_id) throw new Error('document_id is required');

  const revisions = await apiGet(`/api/docs/documents/${document_id}/revisions`);
  return revisions;
}

/**
 * 按版本线索筛选 revision 候选（纯函数，不发 IO）
 *
 * 版本比较规则（P3 版本日期规则）：
 * - 有 publish_date 的版本优先按日期比较；源文档 publish_date 已知时，
 *   只保留 publish_date ≤ 源文档发布日期的版本（"最新版只采用比档期文档发布更早的版本"），
 *   再取其中 publish_date 最晚者。
 * - 没有任何 publish_date 时，回退 revision_no 降序（取第一个即最新）。
 *
 * @param {object} params
 * @param {Array} params.revisions - 版本列表（含 revision_label、publish_date）
 * @param {object} [params.hints] - 版本线索
 * @param {string} [params.hints.year] - 年份（如 "2016"）
 * @param {string} [params.hints.revision_label] - 精确 label
 * @param {string} [params.hints.source_publish_date] - 源文档（引用方）发布日期，YYYY-MM-DD
 * @returns {object} { candidates, excluded, match_rule }
 */
async function selectRevisionCandidate(params) {
  const { revisions, hints = {} } = params;

  if (!revisions || !Array.isArray(revisions)) {
    throw new Error('revisions is required and must be an array');
  }

  const hasPublishDates = revisions.some(r => r.publish_date != null && r.publish_date !== '');

  // 无线索："使用最新版"场景 —— 日期优先，无日期回退 revision_no 降序
  if (!hints.year && !hints.revision_label) {
    let candidates = [...revisions];

    if (hasPublishDates) {
      // 过滤：只保留发布日 ≤ 源文档发布日的版本（源文档日期已知时）
      const srcDate = hints.source_publish_date ? new Date(hints.source_publish_date).getTime() : null;
      if (srcDate && !Number.isNaN(srcDate)) {
        const before = candidates.filter(r => {
          const d = r.publish_date ? new Date(r.publish_date).getTime() : null;
          // 无日期的版本保留（回退策略），有日期的必须 ≤ 源文档日期
          return d == null || Number.isNaN(d) || d <= srcDate;
        });
        // 若过滤后为空，说明所有版本都晚于源文档，保持原列表（由调用方判断）
        if (before.length > 0) candidates = before;
      }
      // 按 publish_date 降序，无日期的排最后，再按 revision_no 降序兜底
      candidates.sort((a, b) => {
        const da = a.publish_date ? new Date(a.publish_date).getTime() : -Infinity;
        const db = b.publish_date ? new Date(b.publish_date).getTime() : -Infinity;
        if (db !== da) return db - da;
        return (b.revision_no || 0) - (a.revision_no || 0);
      });
      return {
        candidates,
        excluded: [],
        match_rule: srcDate ? 'no_hints:latest_by_publish_date_lte_source' : 'no_hints:latest_by_publish_date',
      };
    }

    // 无日期：回退 revision_no 降序
    const sorted = [...revisions].sort((a, b) => (b.revision_no || 0) - (a.revision_no || 0));
    return {
      candidates: sorted,
      excluded: [],
      match_rule: 'no_hints:all_desc',
    };
  }

  let candidates = [];
  let excluded = [];
  let matchRule = '';

  if (hints.revision_label) {
    // 精确 label 匹配
    candidates = revisions.filter(r => r.revision_label === hints.revision_label);
    excluded = revisions.filter(r => r.revision_label !== hints.revision_label);
    matchRule = `exact_label:${hints.revision_label}`;
  } else if (hints.year) {
    // 年份匹配：label 中包含年份（如 "2016"）
    candidates = revisions.filter(r => r.revision_label && r.revision_label.includes(hints.year));
    excluded = revisions.filter(r => !r.revision_label || !r.revision_label.includes(hints.year));

    // 同年多版本按 revision_no 降序（日期已知时按日期降序）
    candidates.sort((a, b) => {
      const da = a.publish_date ? new Date(a.publish_date).getTime() : -Infinity;
      const db = b.publish_date ? new Date(b.publish_date).getTime() : -Infinity;
      if (db !== da) return db - da;
      return (b.revision_no || 0) - (a.revision_no || 0);
    });
    matchRule = `year_hint:${hints.year}`;
  }

  return { candidates, excluded, match_rule: matchRule };
}

/**
 * 按节号/标题等线索查找候选 section
 */
async function findSectionCandidates(params) {
  const { document_id, revision_id, title_hint, seq_hint, query_text } = params;

  if (!document_id && !revision_id) {
    throw new Error('document_id or revision_id is required');
  }

  const result = await apiPost('/api/apps/standard-mgr/sections/find-candidates', {
    document_id,
    revision_id,
    title_hint,
    seq_hint,
    query_text,
  });

  return result;
}

/**
 * 列出指定标准的待回填 gap 列表
 */
async function listReferenceGaps(params) {
  const { standard_id, limit = 100, offset = 0 } = params;
  if (!standard_id) throw new Error('standard_id is required');

  const gaps = await apiGet(
    `/api/apps/standard-mgr/anchors/gaps?standard_id=${standard_id}&limit=${limit}&offset=${offset}`
  );
  return gaps;
}

/**
 * 写入一个引用的完整判断结果
 */
async function writeAnchorResult(params) {
  const required = ['standard_id', 'source_revision_id', 'source_outline_id', 'occurrence_index', 'source_text', 'ref_type', 'status', 'source'];
  for (const key of required) {
    if (params[key] == null) throw new Error(`${key} is required`);
  }

  const result = await apiPost('/api/apps/standard-mgr/write-anchor-result', params);
  return result;
}

// ============================================
// 工具定义
// ============================================

function getTools() {
  return [
    {
      name: 'parse_anchor',
      description: '解析锚点字符串 <document_id+revision_id(+outline_id)> 为结构化对象',
      parameters: {
        type: 'object',
        properties: {
          anchor: { type: 'string', description: '锚点字符串，格式 <document_id+revision_id> 或 <document_id+revision_id+outline_id>' },
        },
        required: ['anchor'],
      },
    },
    {
      name: 'list_revision_sections',
      description: '按 revision_id 列出所有章节（outline），返回 title/seq/from_line/to_line/outline_id',
      parameters: {
        type: 'object',
        properties: {
          revision_id: { type: 'string', description: '版本 ID（document_revisions.id）' },
        },
        required: ['revision_id'],
      },
    },
    {
      name: 'read_section_context',
      description: '读取指定 section 正文（按 chunk 翻页）。返回 page_has_more=true 时必须用 page_next_offset 作为 page 继续翻页，直到 page_has_more=false，确保整节逐字读完。每页 1 个 chunk，默认 ≤4000 字符（低于摘要阈值）。返回 overlap_lines 表示与上一 chunk 的行重叠，写锚点时按 from_line 去重。',
      parameters: {
        type: 'object',
        properties: {
          outline_id: { type: 'string', description: '章节 ID（document_outlines.id）' },
          context_window: { type: 'number', description: '上下文窗口大小，前后各取几个相邻 section（默认 0）' },
          page: { type: 'number', description: 'chunk 页序号（0 起），翻页时传上一页的 page_next_offset（默认 0）' },
          max_page_chars: { type: 'number', description: '单页最大字符数（默认 4000，不超过 4000 以免超过工具结果摘要阈值）' },
        },
        required: ['outline_id'],
      },
    },
    {
      name: 'read_revision_content',
      description: '读取指定 revision 的全文文本内容（支持字符分页）。返回 content_has_more=true 时必须用 offset_chars 继续翻页直到 content_has_more=false。适合读取整个 revision 全文或跨章节查找引用。',
      parameters: {
        type: 'object',
        properties: {
          revision_id: { type: 'string', description: '版本 ID（document_revisions.id）' },
          max_chars: { type: 'number', description: '单页最大字符数（默认 20000，0=不截断）' },
          offset_chars: { type: 'number', description: '起始字符偏移，翻页用（默认 0）' },
        },
        required: ['revision_id'],
      },
    },
    {
      name: 'get_section_locator',
      description: '通过 outline_id 反查所属的 document_id 和 revision_id',
      parameters: {
        type: 'object',
        properties: {
          outline_id: { type: 'string', description: '章节 ID（document_outlines.id）' },
        },
        required: ['outline_id'],
      },
    },
    // P2-1 定位类工具
    {
      name: 'find_documents_by_standard_code',
      description: '按标准编号查找已纳管的标准（查 app_standard 表）',
      parameters: {
        type: 'object',
        properties: {
          standard_code: { type: 'string', description: '标准编号，如 GB/T 19001-2016' },
        },
        required: ['standard_code'],
      },
    },
    {
      name: 'find_documents_by_standard_name',
      description: '按标准名称查找已纳管的标准（查 app_standard 表）',
      parameters: {
        type: 'object',
        properties: {
          standard_name: { type: 'string', description: '标准名称，支持模糊匹配' },
        },
        required: ['standard_name'],
      },
    },
    {
      name: 'get_document_revisions',
      description: '获取指定文档的所有版本列表',
      parameters: {
        type: 'object',
        properties: {
          document_id: { type: 'string', description: '文档 ID（documents.id）' },
        },
        required: ['document_id'],
      },
    },
    {
      name: 'select_revision_candidate',
      description: '按版本线索从候选 revision 中筛选最匹配的版本（纯函数，不发 IO）。无线索（"使用最新版"）时：有 publish_date 则按日期取最晚且不晚于源文档发布日的版本（可传 source_publish_date 过滤），无日期则按 revision_no 降序取第一个。',
      parameters: {
        type: 'object',
        properties: {
          revisions: { type: 'array', items: { type: 'object' }, description: '版本列表（含 revision_label、revision_no、publish_date）' },
          hints: {
            type: 'object',
            properties: {
              year: { type: 'string', description: '年份线索，如 "2016"' },
              revision_label: { type: 'string', description: '精确 label 匹配' },
              source_publish_date: { type: 'string', description: '源文档（引用方）发布日期 YYYY-MM-DD；无线索时用于过滤 publish_date ≤ 该日期的版本' },
            },
          },
        },
        required: ['revisions'],
      },
    },
    {
      name: 'find_section_candidates',
      description: '按节号/标题等线索查找候选 section（outline）',
      parameters: {
        type: 'object',
        properties: {
          document_id: { type: 'string', description: '文档 ID' },
          revision_id: { type: 'string', description: '版本 ID（优先于 document_id）' },
          title_hint: { type: 'string', description: '章节标题线索' },
          seq_hint: { type: 'number', description: '章节序号线索' },
          query_text: { type: 'string', description: '语义搜索文本（用于向量召回辅助）' },
        },
        required: [],
      },
    },
    {
      name: 'list_reference_gaps',
      description: '列出指定标准中待回填的引用缺口（status=gap）',
      parameters: {
        type: 'object',
        properties: {
          standard_id: { type: 'string', description: '标准 ID（app_standard.id）' },
          limit: { type: 'number', description: '返回数量上限（默认 100）' },
          offset: { type: 'number', description: '偏移量（默认 0）' },
        },
        required: ['standard_id'],
      },
    },
    {
      name: 'write_anchor_result',
      description: '写入一个引用的完整判断结果（幂等），同时更新带锚点副本和汇总计数',
      parameters: {
        type: 'object',
        properties: {
          standard_id: { type: 'string', description: '标准 ID' },
          source_revision_id: { type: 'string', description: '来源 revision ID' },
          source_outline_id: { type: 'string', description: '来源 outline ID' },
          occurrence_index: { type: 'number', description: '同 section 内出现序号（从 0 开始）' },
          source_text: { type: 'string', description: '原始引用文本（必须是被引章节原文的逐字连续子串，禁止改写、合并、补字或转述）' },
          context_text: { type: 'string', description: '引用上下文' },
          ref_type: { type: 'string', enum: ['explicit', 'implicit'], description: '引用类型' },
          status: { type: 'string', enum: ['valid', 'suspected', 'gap', 'invalid'], description: '引用状态' },
          source: { type: 'string', enum: ['auto', 'user_confirmed', 'manual', 'auto_backfill'], description: '来源' },
          target_document_id: { type: 'string', description: '目标文档 ID' },
          target_revision_id: { type: 'string', description: '目标 revision ID' },
          target_outline_id: { type: 'string', description: '目标 outline ID' },
          candidates_json: { type: 'object', description: '候选列表' },
          status_reason: { type: 'string', description: '状态原因' },
          anchored_text: { type: 'string', description: '带锚点副本的文本' },
          source_text_hash: { type: 'string', description: '来源文本 hash' },
        },
        required: ['standard_id', 'source_revision_id', 'source_outline_id', 'occurrence_index', 'source_text', 'ref_type', 'status', 'source'],
      },
    },
  ];
}

// ============================================
// 执行入口
// ============================================

/**
 * 执行工具
 *
 * @param {string} toolName - 工具名称
 * @param {object} params - 工具参数
 * @returns {Promise<any>} 工具执行结果
 */
async function execute(toolName, params) {
  switch (toolName) {
    case 'parse_anchor':
      return await parseAnchor(params);
    case 'list_revision_sections':
      return await listRevisionSections(params);
    case 'read_section_context':
      return await readSectionContext(params);
    case 'read_revision_content':
      return await readRevisionContent(params);
    case 'get_section_locator':
      return await getSectionLocator(params);
    // P2-1 定位类工具
    case 'find_documents_by_standard_code':
      return await findDocumentsByStandardCode(params);
    case 'find_documents_by_standard_name':
      return await findDocumentsByStandardName(params);
    case 'get_document_revisions':
      return await getDocumentRevisions(params);
    case 'select_revision_candidate':
      return await selectRevisionCandidate(params);
    case 'find_section_candidates':
      return await findSectionCandidates(params);
    case 'list_reference_gaps':
      return await listReferenceGaps(params);
    case 'write_anchor_result':
      return await writeAnchorResult(params);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { execute, getTools };
