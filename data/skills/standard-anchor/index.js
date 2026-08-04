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
 * @param {object} params
 * @param {string} params.revision_id - 版本 ID
 * @returns {Promise<Array>} 章节列表
 */
async function listRevisionSections(params) {
  const { revision_id } = params;
  if (!revision_id) throw new Error('revision_id is required');

  const outlines = await apiGet(`/api/docs/revisions/${revision_id}/outlines`);
  return outlines;
}

/**
 * 读取指定 section 正文及上下文
 *
 * @param {object} params
 * @param {string} params.outline_id - 章节 ID
 * @param {number} [params.context_window=0] - 上下文窗口大小（前后各取几个相邻 outline）
 * @returns {Promise<object>} { section, context_before, context_after }
 */
async function readSectionContext(params) {
  const { outline_id, context_window = 0 } = params;
  if (!outline_id) throw new Error('outline_id is required');

  // 先获取 section 自身
  const section = await apiGet(`/api/docs/outlines/${outline_id}/section`);
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
    section,
    context_before,
    context_after,
  };
}

/**
 * 读取指定 revision 的全文内容
 *
 * @param {object} params
 * @param {string} params.revision_id - 版本 ID
 * @returns {Promise<object>} { text, revision }
 */
async function readRevisionContent(params) {
  const { revision_id, max_chars = 20000 } = params;
  if (!revision_id) throw new Error('revision_id is required');

  // R3-4：始终透传 max_chars，服务端用 undefined 判断
  const result = await apiGet(`/api/docs/revisions/${revision_id}/content?max_chars=${max_chars}`);
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
 * @param {object} params
 * @param {Array} params.revisions - 版本列表（含 revision_label）
 * @param {object} [params.hints] - 版本线索
 * @param {string} [params.hints.year] - 年份（如 "2016"）
 * @param {string} [params.hints.revision_label] - 精确 label
 * @returns {object} { candidates, excluded, match_rule }
 */
async function selectRevisionCandidate(params) {
  const { revisions, hints = {} } = params;

  if (!revisions || !Array.isArray(revisions)) {
    throw new Error('revisions is required and must be an array');
  }

  if (!hints.year && !hints.revision_label) {
    // 无线索：返回所有，按 revision_no 降序
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

    // 同年多版本按 revision_no 降序
    candidates.sort((a, b) => (b.revision_no || 0) - (a.revision_no || 0));
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
      description: '读取指定 section 正文，可附带前后相邻 section 的上下文',
      parameters: {
        type: 'object',
        properties: {
          outline_id: { type: 'string', description: '章节 ID（document_outlines.id）' },
          context_window: { type: 'number', description: '上下文窗口大小，前后各取几个相邻 section（默认 0）' },
        },
        required: ['outline_id'],
      },
    },
    {
      name: 'read_revision_content',
      description: '读取指定 revision 的全文文本内容',
      parameters: {
        type: 'object',
        properties: {
          revision_id: { type: 'string', description: '版本 ID（document_revisions.id）' },
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
      description: '按版本线索从候选 revision 中筛选最匹配的版本（纯函数，不发 IO）',
      parameters: {
        type: 'object',
        properties: {
          revisions: { type: 'array', items: { type: 'object' }, description: '版本列表（含 revision_label、revision_no）' },
          hints: {
            type: 'object',
            properties: {
              year: { type: 'string', description: '年份线索，如 "2016"' },
              revision_label: { type: 'string', description: '精确 label 匹配' },
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
