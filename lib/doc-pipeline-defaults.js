/**
 * 文档预处理流水线默认配置
 * 保存位置：system_settings 表 doc_pipeline.* 命名空间
 */

import { DEFAULT_INTERNAL_LLM_TIMEOUT_MS } from './internal-llm-timeout.js';

const DOC_PIPELINE_DEFAULTS = {
  meta: {
    version: 1,
    enabled: true,
  },

  pending_ocr: {
    enabled: true,
    type: 'mcp',
    mcp: {
      server: 'mineru',
      tool: 'create_task_from_file',
      params_mapping: {
        file_base64: 'file_base64',
        file_name: 'file_name',
        formula_enable: 'formula_enable',
        table_enable: 'table_enable',
        image_analysis: 'image_analysis',
        lang: 'lang',
      },
      param_sources: {
        file_base64: {
          group: 'attachment',
          field: 'file_base64',
        },
        file_name: {
          group: 'attachment',
          field: 'file_name',
        },
        formula_enable: {
          group: 'setting',
          value: true,
        },
        table_enable: {
          group: 'setting',
          value: true,
        },
        image_analysis: {
          group: 'setting',
          value: true,
        },
        lang: {
          group: 'setting',
          value: null,
          enabled: false,
        },
      },
    },
    judge: {
      model_id: null,
      temperature: 0.1,
      prompt_template: '将以下 MCP 返回结果归一化为提交结果 JSON，必须返回 task_id、provider、is_success、message。',
      output_schema: {
        task_id: 'string',
        provider: 'string',
        is_success: true,
        message: 'string',
      },
    },
    provider_name: 'mineru',
    mcp_timeout_ms: 120000,
  },

  ocr_processing: {
    enabled: true,
    type: 'mcp',
    mcp: {
      server: 'mineru',
      tool: 'get_task_status',
      params_mapping: {
        task_id: 'task_id',
      },
      params: {},
    },
    poll_interval_ms: 5000,
    poll_request_timeout_ms: 120000,
    judge: {
      model_id: null,
      temperature: 0.1,
      prompt_template: '将以下 MCP 返回的状态信息归一化为标准状态对象，必须返回 status、progress、is_completed、error_message。',
      output_schema: {
        status: 'pending|processing|completed|failed',
        progress: 0,
        is_completed: false,
        error_message: 'string',
      },
    },
  },

  ocr_finalize: {
    enabled: true,
    mcp: {
      server: 'mineru',
    },
    default_deliverable_tool: 'get_default_deliverable',
    list_deliverables_tool: 'list_deliverables',
    image_deliverables_tool: 'get_image_deliverables',
    download_deliverable_tool: null,
    persist_raw_result: true,
    persist_image_attachments: true,
    mcp_timeout_ms: 120000,
    judge: {
      model_id: null,
      temperature: 0.1,
      prompt_template: '从 MCP 返回结果中提取主 Markdown、交付物清单、下载方式、图片列表。',
      output_schema: {
        main_markdown: 'string',
        deliverables: [
          {
            name: 'string',
            type: 'markdown|json|image|other',
            download_method: 'inline|url|tool',
            download_payload: {},
          },
        ],
        raw_payload: {},
        image_items: [],
        is_success: true,
        error_message: 'string',
      },
    },
  },

  pending_clean: {
    enabled: true,
    type: 'internal_llm',
    model_id: null,
    temperature: 0.3,
    chunk_max_length: 8000,
    prompt_template: '',
    rules: {
      remove_page_number: true,
      remove_watermark: true,
      remove_garbled_text: true,
      remove_header_footer: true,
    },
    // llm_timeout_ms 为主字段，运行时优先从阶段配置读取，系统 task_timeout 作为兜底默认值
    llm_timeout_ms: 300000, // 默认 5 分钟
  },

  pending_outline: {
    enabled: true,
    type: 'internal_llm',
    strategy: 'llm',
    model_id: null,
    temperature: 0.3,
    window_size: 60000,
    step_size: 40000,
    max_heading_level: 3,
    preserve_line_info: true,
    deduplicate_titles: true,
    llm_timeout_ms: DEFAULT_INTERNAL_LLM_TIMEOUT_MS,
  },

  pending_chunk: {
    enabled: true,
    type: 'builtin',
    chunk_mode: 'heading',
    max_length: 1000,
    overlap_length: 100,
    keep_heading: true,
    merge_small_chunks: false,
  },

  pending_embedding: {
    enabled: true,
    embedding_model_id: null,
    batch_size: 20,
    skip_empty_chunks: true,
    retry_times: 3,
    // embedding_timeout_ms 为主字段，运行时优先从阶段配置读取，系统 fast_timeout 作为兜底默认值
    embedding_timeout_ms: 120000,
  },
};

const PIPELINE_STAGE_KEYS = [
  'pending_ocr',
  'ocr_processing',
  'ocr_finalize',
  'pending_clean',
  'pending_outline',
  'pending_chunk',
  'pending_embedding',
];

const DOC_PIPELINE_KEYS = ['meta', ...PIPELINE_STAGE_KEYS];

/**
 * 获取单个阶段的默认配置（深拷贝）
 */
function getStageDefault(stageKey) {
  const source = DOC_PIPELINE_DEFAULTS[stageKey];
  if (!source) return null;
  return JSON.parse(JSON.stringify(source));
}

/**
 * 获取完整 doc_pipeline 默认配置（深拷贝）
 */
function getAllDefaults() {
  return JSON.parse(JSON.stringify(DOC_PIPELINE_DEFAULTS));
}

/**
 * 补齐缺失的阶段配置
 * @param {Object} stored - 数据库中读取的已解析配置
 * @returns {Object} 补齐默认值后的完整配置
 */
function mergeWithDefaults(stored) {
  const result = {};
  for (const key of DOC_PIPELINE_KEYS) {
    if (stored && stored[key] && typeof stored[key] === 'object') {
      result[key] = normalizeStageConfig(normalizeParamSources(stored[key], key), key);
    } else {
      result[key] = normalizeStageConfig(getStageDefault(key), key);
    }
  }
  return result;
}

function normalizeStageConfig(stageConfig, stageKey) {
  if (!stageConfig || typeof stageConfig !== 'object') return stageConfig;

  if (stageKey === 'pending_outline') {
    const normalized = { ...stageConfig };
    // 统一使用 llm_timeout_ms 为主字段，删除 timeout_ms 双读逻辑
    // timeout_ms 仅在兼容旧数据时使用
    const timeoutValue = normalized.llm_timeout_ms ?? normalized.timeout_ms ?? DEFAULT_INTERNAL_LLM_TIMEOUT_MS;
    normalized.llm_timeout_ms = timeoutValue;
    // 不再镜像 timeout_ms，保持数据单一来源
    return normalized;
  }

  if (stageKey === 'pending_clean') {
    const normalized = { ...stageConfig };
    // 统一使用 llm_timeout_ms 为主字段
    const timeoutValue = normalized.llm_timeout_ms ?? normalized.timeout_ms;
    if (timeoutValue != null) {
      normalized.llm_timeout_ms = timeoutValue;
    }
    // 不再镜像 timeout_ms，保持数据单一来源
    return normalized;
  }

  return stageConfig;
}

/**
 * 写入收口：清理旧字段，确保新保存只保留主字段
 * 这是 timeout 写入收口的关键 - 新保存不再写回旧字段
 * @param {Object} stageConfig - 阶段配置
 * @param {string} stageKey - 阶段 key
 * @returns {Object} 清理后的配置
 */
function cleanupStageConfigForWrite(stageConfig, stageKey) {
  if (!stageConfig || typeof stageConfig !== 'object') return stageConfig;

  const cleaned = { ...stageConfig };

  // pending_clean: 只保留 llm_timeout_ms，删除旧字段 timeout_ms
  if (stageKey === 'pending_clean') {
    delete cleaned.timeout_ms;
    // 确保 llm_timeout_ms 存在
    if (cleaned.llm_timeout_ms == null) {
      cleaned.llm_timeout_ms = 300000; // 默认 5 分钟
    }
    return cleaned;
  }

  // pending_outline: 只保留 llm_timeout_ms，删除旧字段 timeout_ms
  if (stageKey === 'pending_outline') {
    delete cleaned.timeout_ms;
    // 确保 llm_timeout_ms 存在
    if (cleaned.llm_timeout_ms == null) {
      cleaned.llm_timeout_ms = DEFAULT_INTERNAL_LLM_TIMEOUT_MS;
    }
    return cleaned;
  }

  // pending_embedding: 只保留 embedding_timeout_ms
  if (stageKey === 'pending_embedding') {
    delete cleaned.timeout_ms;
    // 确保 embedding_timeout_ms 存在
    if (cleaned.embedding_timeout_ms == null) {
      cleaned.embedding_timeout_ms = 120000; // 默认 2 分钟
    }
    return cleaned;
  }

  // OCR 阶段：清理旧 timeout 字段（保留 poll_interval_ms，因为这是用户可配置的正式字段）
  if (isOcrStage(stageKey)) {
    delete cleaned.mcp_timeout_ms;
    delete cleaned.poll_request_timeout_ms;
    // poll_interval_ms 是 ocr_processing 阶段的正式配置字段，由前端表单暴露给用户，必须保留
    return cleaned;
  }

  return cleaned;
}

function normalizeParamSources(stageConfig, stageKey) {
  if (stageKey !== 'pending_ocr') return stageConfig;

  const defaultPendingOcr = getStageDefault('pending_ocr');
  if (!stageConfig?.mcp) return stageConfig;

  const mcp = stageConfig.mcp;

  const defaultMapping = defaultPendingOcr.mcp.params_mapping;
  if (!mcp.params_mapping) {
    mcp.params_mapping = { ...defaultMapping };
  } else {
    for (const [key, target] of Object.entries(defaultMapping)) {
      if (!(key in mcp.params_mapping)) {
        mcp.params_mapping[key] = target;
      }
    }
  }

  if (mcp.param_sources && typeof mcp.param_sources === 'object') {
    const mergedSources = { ...defaultPendingOcr.mcp.param_sources };
    for (const [key, source] of Object.entries(mcp.param_sources)) {
      if (source && typeof source === 'object') {
        mergedSources[key] = source;
      }
    }
    mcp.param_sources = mergedSources;
    return stageConfig;
  }

  if (mcp.params && typeof mcp.params === 'object') {
    const paramSources = {
      file_base64: { group: 'attachment', field: 'file_base64' },
      file_name: { group: 'attachment', field: 'file_name' },
      formula_enable: { group: 'setting', value: mcp.params.formula_enable ?? true },
      table_enable: { group: 'setting', value: mcp.params.table_enable ?? true },
      image_analysis: { group: 'setting', value: mcp.params.image_analysis ?? true },
      lang: { group: 'setting', value: mcp.params.lang ?? null, enabled: mcp.params.lang !== undefined && mcp.params.lang !== null },
    };
    mcp.param_sources = paramSources;
    delete mcp.params;
  } else {
    mcp.param_sources = { ...defaultPendingOcr.mcp.param_sources };
  }

  return stageConfig;
}

/**
 * 判断是否为 MCP 阶段
 */
function isOcrStage(stageKey) {
  return stageKey === 'pending_ocr' || stageKey === 'ocr_processing' || stageKey === 'ocr_finalize';
}

export {
  DOC_PIPELINE_DEFAULTS,
  DOC_PIPELINE_KEYS,
  PIPELINE_STAGE_KEYS,
  getStageDefault,
  getAllDefaults,
  mergeWithDefaults,
  normalizeStageConfig,
  cleanupStageConfigForWrite,
  normalizeParamSources,
  isOcrStage,
};
