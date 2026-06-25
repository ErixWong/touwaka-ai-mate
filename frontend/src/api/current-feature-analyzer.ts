import apiClient, { apiRequest } from './client'

const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000

export type BatchStatus = 'idle' | 'uploading' | 'ready' | 'analyzing' | 'completed' | 'partial_failed' | 'failed'
export type AnalysisStatus = 'pending' | 'parsing' | 'ready' | 'analyzing' | 'completed' | 'failed'

// ── 领域类型（逐字段对照后端真实返回结构） ──────────────

/** csv-parse.service.js checkDuplicateTimes() 输出 */
export interface DuplicateDiagnosis {
  duplicate_groups: number
  duplicate_rows: number
  conflict_groups: number
  max_same_time_rows: number
  conflict_ratio: number
}

/** llm-stage-recognition.service.js 调试信息（两种形态：成功路径 vs 重试路径） */
export interface LlmDebugInfo {
  content?: string
  reasoning_content?: string
  content_length?: number
  reasoning_length?: number
  parsed_from?: string
  attempt?: number
  content_preview?: string
  reasoning_preview?: string
}

/** llm-stage-recognition.service.js 返回的 stage 元素 */
export interface LlmStageItem {
  stage_code: string
  stage_name: string
  start_time: number
  end_time: number
  confidence?: number | null
  reason?: string | null
}

export interface LlmResult {
  stages: LlmStageItem[]
  summary?: string
  warnings?: Array<{ message: string }>
  _error?: string
  _debug?: LlmDebugInfo | null
}

/** stage-metrics.service.js calculate() 输出 */
export interface StageMetric {
  stage_code: string
  stage_name: string
  start_time: number
  end_time: number
  duration: number
  point_count: number
  min_current: number
  max_current: number
  avg_current: number
  jitter_rate: number
  std_current: number
  peak_to_peak: number
  ripple_rate: number
  confidence: number | null
  reason: string | null
  _low_base_warning?: string | null
}

/** stage-metrics.service.js buildFileMetrics() 输出 */
export interface FileMetrics {
  point_total: number
  valid_point_count: number
  segment_count: number
  polyline_point_count: number
  stage_count: number
  warning_count: number
  warnings: Array<{ message: string }>
}

/** config.service.js DEFAULT_CONFIG 完整结构 */
export interface AppConfig {
  enabled: boolean
  llm_model_id: string | null
  temperature: number
  max_tokens: number
  timeout_ms: number
  retry_times: number
  enable_json_repair: boolean
  default_rule_set_id: string | null
  absolute_resolution: number
  relative_resolution: number
  merge_gap_ratio: number
  min_transition_points: number
  analysis_prompt_template: string
  json_output_schema: string
  ui: {
    show_ripple_rate: boolean
    show_llm_reason: boolean
    auto_select_first_file: boolean
  }
  export: {
    format: string
    sheet_stage_detail_name: string
    sheet_summary_name: string
  }
}

export interface SessionFileItem {
  file_id: string
  file_name: string
  file_size: number
  row_count: number | null
  time_column: string | null
  current_column: string | null
  rule_set_id: string | null
  analysis_status: AnalysisStatus
  warning_count: number
  error_message: string | null
  raw_data?: number[][] | null
  result: FileAnalysisResult | null
  _duplicate_diagnosis?: DuplicateDiagnosis | null
}

export interface SegmentItem {
  segment_index: number
  start_index?: number
  end_index?: number
  start_time: number
  end_time: number
  duration: number
  point_count: number
  min_current?: number
  max_current?: number
  mean_current?: number
  representative_current?: number
  bandwidth?: number
  baseline_ratio?: number
  slope?: number
  line_fit_error?: number
  kind?: string | null
  polyline_points?: number[][] | null
  polyline_point_count?: number
}

export interface FileAnalysisResult {
  globals?: Record<string, number>
  segments?: SegmentItem[]
  events?: Array<Record<string, unknown>>
  llm_result?: LlmResult
  stage_metrics?: StageMetric[]
  file_metrics?: FileMetrics | null
}

export interface BatchSummary {
  file_total: number
  success_count: number
  failed_count: number
  stage_distribution: Array<{ stage_name: string; count: number }>
}

export interface BatchSession {
  batch_id: string
  batch_status: BatchStatus
  selected_rule_set_id: string | null
  files: SessionFileItem[]
  summary: BatchSummary | null
}

export interface RuleSetItem {
  id: string
  rule_set_name: string
  description: string
  is_default: boolean
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface RuleSetStage {
  stage_name: string
  description?: string
  typical_duration?: string
  current_range?: string
}

export interface RuleSetDetail extends RuleSetItem {
  business_context?: string
  prompt_template?: string
  output_json_schema?: string
  llm_instructions?: string
  stages?: RuleSetStage[]
}

export const currentFeatureAnalyzerApi = {
  upload: (files: File[], ruleSetId?: string) => {
    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    if (ruleSetId) formData.append('rule_set_id', ruleSetId)
    return apiRequest<BatchSession>(
      apiClient.post('/apps/current-feature-analyzer/uploads', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    )
  },

  getBatch: (batchId: string) =>
    apiRequest<BatchSession>(apiClient.get(`/apps/current-feature-analyzer/batches/${batchId}`)),

  getFileDetail: (batchId: string, fileId: string) =>
    apiRequest<SessionFileItem>(
      apiClient.get(`/apps/current-feature-analyzer/batches/${batchId}/files/${fileId}`)
    ),

  runAnalysis: (batchId: string, ruleSetId: string, options?: Record<string, number>) =>
    apiRequest<BatchSession>(
      apiClient.post('/apps/current-feature-analyzer/analysis/run', {
        batch_id: batchId,
        rule_set_id: ruleSetId,
        analysis_options: options,
      }, {
        timeout: ANALYSIS_TIMEOUT_MS,
      })
    ),

  getReport: (batchId: string) =>
    apiRequest<BatchSession>(apiClient.get(`/apps/current-feature-analyzer/reports/${batchId}`)),

  exportReport: (batchId: string) =>
    apiClient.post(`/apps/current-feature-analyzer/reports/${batchId}/export`, {}, {
      responseType: 'blob',
    }),

  listRuleSets: () =>
    apiRequest<{ items: RuleSetItem[] }>(apiClient.get('/apps/current-feature-analyzer/rule-sets')),

  getRuleSet: (id: string) =>
    apiRequest<RuleSetDetail>(apiClient.get(`/apps/current-feature-analyzer/rule-sets/${id}`)),

  createRuleSet: (data: Record<string, unknown>) =>
    apiRequest<RuleSetDetail>(apiClient.post('/apps/current-feature-analyzer/rule-sets', data)),

  updateRuleSet: (id: string, data: Record<string, unknown>) =>
    apiRequest<RuleSetDetail>(apiClient.put(`/apps/current-feature-analyzer/rule-sets/${id}`, data)),

  deleteRuleSet: (id: string) =>
    apiRequest<{ deleted: boolean }>(apiClient.delete(`/apps/current-feature-analyzer/rule-sets/${id}`)),

  copyRuleSet: (id: string) =>
    apiRequest<RuleSetDetail>(apiClient.post(`/apps/current-feature-analyzer/rule-sets/${id}/copy`)),

  getConfig: () =>
    apiRequest<AppConfig>(apiClient.get('/apps/current-feature-analyzer/config')),

  saveConfig: (data: AppConfig) =>
    apiRequest<AppConfig>(apiClient.put('/apps/current-feature-analyzer/config', data)),
}