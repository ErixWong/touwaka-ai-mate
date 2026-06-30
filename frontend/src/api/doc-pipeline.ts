import apiClient, { apiRequest } from './client'

export interface ParamSourceAttachment {
  group: 'attachment'
  field: string
}

export interface ParamSourceSetting {
  group: 'setting'
  value: boolean | string | null
  enabled?: boolean
}

export type ParamSource = ParamSourceAttachment | ParamSourceSetting

export interface DocPipelineJudge {
  model_id: string | null
  temperature: number
  prompt_template: string
  output_schema: Record<string, unknown>
}

export interface DocPipelineMcpStage {
  enabled: boolean
  type: string
  mcp: {
    server: string
    tool: string
    params_mapping: Record<string, string>
    param_sources?: Record<string, ParamSource>
    params?: Record<string, unknown>
  }
  judge: DocPipelineJudge
  provider_name?: string
  // 阶段字段优先，系统设置兜底：pending_ocr 使用 MCP 内部超时，ocr_processing 使用 poll_interval_ms
}

// OCR 轮询阶段专用类型（包含 poll_interval_ms）
export interface DocPipelineOcrProcessingStage {
  enabled: boolean
  type: string
  mcp: {
    server: string
    tool: string
    params_mapping: Record<string, string>
    params?: Record<string, unknown>
  }
  judge: DocPipelineJudge
  // 轮询间隔毫秒数
  poll_interval_ms: number
}

export interface DocPipelineOcrFinalize {
  enabled: boolean
  mcp: {
    server: string
  }
  default_deliverable_tool: string
  list_deliverables_tool: string
  image_deliverables_tool: string
  download_deliverable_tool: string | null
  persist_raw_result: boolean
  persist_image_attachments: boolean
  // 阶段字段优先，系统设置兜底：使用 MCP 内部超时
  judge: DocPipelineJudge
}

export interface DocPipelineCleanStage {
  enabled: boolean
  type: string
  model_id: string | null
  temperature: number
  chunk_max_length: number
  prompt_template: string
  rules: {
    remove_page_number: boolean
    remove_watermark: boolean
    remove_garbled_text: boolean
    remove_header_footer: boolean
  }
  // 统一使用 llm_timeout_ms 作为主字段
  llm_timeout_ms: number
  // timeout_ms 仅保留兼容（旧数据迁移用），不再作为主字段
  timeout_ms?: number
}

export interface DocPipelineOutlineStage {
  enabled: boolean
  type: string
  strategy: string
  model_id: string | null
  temperature: number
  window_size: number
  step_size: number
  max_heading_level: number
  preserve_line_info: boolean
  deduplicate_titles: boolean
  // 统一使用 llm_timeout_ms 作为主字段
  llm_timeout_ms: number
  // timeout_ms 仅保留兼容（旧数据迁移用），不再作为主字段
  timeout_ms?: number
}

export interface DocPipelineChunkStage {
  enabled: boolean
  type: string
  chunk_mode: string
  max_length: number
  overlap_length: number
  keep_heading: boolean
  merge_small_chunks: boolean
}

export interface DocPipelineEmbeddingStage {
  enabled: boolean
  embedding_model_id: string | null
  batch_size: number
  skip_empty_chunks: boolean
  retry_times: number
  // 统一使用 embedding_timeout_ms 作为主字段
  embedding_timeout_ms: number
  // timeout_ms 仅保留兼容（旧数据迁移用），不再作为主字段
  timeout_ms?: number
}

export interface DocPipelineMeta {
  version: number
  enabled: boolean
}

export interface DocPipelineConfig {
  meta: DocPipelineMeta
  pending_ocr: DocPipelineMcpStage
  ocr_processing: DocPipelineOcrProcessingStage
  ocr_finalize: DocPipelineOcrFinalize
  pending_clean: DocPipelineCleanStage
  pending_outline: DocPipelineOutlineStage
  pending_chunk: DocPipelineChunkStage
  pending_embedding: DocPipelineEmbeddingStage
}

export interface McpServerItem {
  id: string
  name: string
  is_enabled: boolean
}

export interface ModelItem {
  id: string
  model_name: string
  display_name?: string
}

export const docPipelineApi = {
  getConfig: () =>
    apiRequest<DocPipelineConfig>(apiClient.get('/system-settings/doc-pipeline')),

  saveConfig: (config: DocPipelineConfig) =>
    apiRequest<DocPipelineConfig>(apiClient.put('/system-settings/doc-pipeline', config)),

  resetConfig: (keys?: string[]) =>
    apiRequest<DocPipelineConfig>(apiClient.post('/system-settings/doc-pipeline/reset', { keys })),

  getMcpServers: () =>
    apiRequest<{ servers: McpServerItem[] }>(apiClient.get('/mcp/servers')),

  getModels: () =>
    apiRequest<ModelItem[]>(apiClient.get('/models')),
}
