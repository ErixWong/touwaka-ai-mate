/**
 * 文档预处理流水线默认配置
 * 保存位置：system_settings 表 doc_pipeline.* 命名空间
 */

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
    timeout_ms: 120000,
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
    timeout_ms: 120000,
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
    timeout_ms: 120000,
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
    timeout_ms: 120000,
  },

  pending_metadata: {
    enabled: true,
    type: 'internal_llm',
    model_id: null,
    temperature: 0.3,
    schema_json: {},
    prompt_template: '',
    timeout_ms: 120000,
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
    timeout_ms: 120000,
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
    timeout_ms: 120000,
  },

  pending_relocate: {
    enabled: true,
    target_strategy: 'current_collection',
    tag_strategy: 'none',
    metadata_writeback: false,
    auto_publish: false,
  },
};

const PIPELINE_STAGE_KEYS = [
  'pending_ocr',
  'ocr_processing',
  'ocr_finalize',
  'pending_clean',
  'pending_metadata',
  'pending_outline',
  'pending_chunk',
  'pending_embedding',
  'pending_relocate',
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
      result[key] = normalizeParamSources(stored[key], key);
    } else {
      result[key] = getStageDefault(key);
    }
  }
  return result;
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

/**
 * 创建 LLM 调用函数
 * 用于 DocumentOcrService 的 callLlm 选项，消除 app-clock / doc-controller 中的重复代码
 *
 * 通过 db.getModelConfig() 获取完整模型配置（含 provider 信息），确保 base_url / api_key 不丢失。
 *
 * @param {Object} db - 数据库实例
 * @returns {Function} callLlm(opts) - opts: { model_id, temperature, messages, output_schema }
 */
function createCallLlmFn(db) {
  return async (opts) => {
    let modelConfig;
    if (opts.model_id) {
      modelConfig = await db.getModelConfig(opts.model_id);
    } else {
      const ModelRegistry = db.getModel('ai_model');
      const defaultRow = await ModelRegistry.findOne({
        where: { is_active: true, model_type: 'text' },
        order: [['created_at', 'DESC']],
        raw: true,
        attributes: ['id'],
      });
      if (!defaultRow) {
        throw new Error(
          'No active text model found for judge normalization. ' +
          'Please configure model_id in doc_pipeline stage settings or activate a text model.'
        );
      }
      modelConfig = await db.getModelConfig(defaultRow.id);
    }

    if (!modelConfig) throw new Error('No LLM model available for judge normalization');

    const { call } = await import('./chat/base-llm.js');
    const callOptions = { temperature: opts.temperature ?? 0.1 };
    if (opts.output_schema && typeof opts.output_schema === 'object' && Object.keys(opts.output_schema).length > 0) {
      callOptions.response_format = { type: 'json_object' };
    }
    const response = await call(modelConfig, opts.messages || [], callOptions);
    const content = response.content || '';
    try {
      return JSON.parse(content);
    } catch {
      return { _raw: content };
    }
  };
}

export {
  DOC_PIPELINE_DEFAULTS,
  DOC_PIPELINE_KEYS,
  PIPELINE_STAGE_KEYS,
  getStageDefault,
  getAllDefaults,
  mergeWithDefaults,
  normalizeParamSources,
  isOcrStage,
  createCallLlmFn,
};
