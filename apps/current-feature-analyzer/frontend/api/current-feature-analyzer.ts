import apiClient, { apiRequest } from '@/api/client'

const PREFIX = '/apps/current-feature-analyzer'

const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000

export type BatchStatus = 'idle' | 'uploading' | 'ready' | 'preparing_analysis' | 'analyzing' | 'completed' | 'partial_failed' | 'failed'
export type AnalysisStatus = 'pending' | 'ready' | 'compressing' | 'llm_recognizing' | 'analyzing' | 'completed' | 'failed'
export type CompressionAlgorithmKey = 'adaptive_v2' | 'legacy_v4' | 'adaptive_keypoints_v1' | 'envelope_turning_points_v2' | 'envelope_turning_points_v3' | 'structural_profile_v1' | 'structural_profile_v2' | 'structural_cusum_v1'

export interface DuplicateDiagnosis {
  duplicate_groups: number
  duplicate_rows: number
  conflict_groups: number
  max_same_time_rows: number
  conflict_ratio: number
}

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

export interface LlmStageItem {
  stage_code: string
  stage_name: string
  start_time: number
  end_time: number
  cycle_index?: number | null
  cycle_stage_index?: number | null
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

export interface StageMetric {
  stage_code: string
  stage_name: string
  start_time: number
  end_time: number
  duration: number
  point_count: number
  start_current: number
  end_current: number
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

export interface FileMetrics {
  point_total: number
  valid_point_count: number
  segment_count: number
  polyline_point_count: number
  stage_count: number
  warning_count: number
  warnings: Array<{ message: string }>
}

export interface AppConfig {
  enabled: boolean
  llm_model_id: string | null
  temperature: number
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
  /** 段首原始点电流值，来源 points[start_index][1] */
  start_current?: number
  /** 段尾原始点电流值，来源 points[end_index][1] */
  end_current?: number
  /** end_current - start_current */
  delta_current?: number
}

export interface CompressionMeta {
  algorithm_key?: CompressionAlgorithmKey
  algorithm_label?: string
  compression_mode?: 'segments' | 'key_points'
  absolute_resolution: number
  relative_resolution: number
  merge_gap_ratio: number
  min_transition_points: number
  target_segment_count: number
  selected_segment_count: number
  window_seconds?: number | null
  threshold_percent?: number | null
  selected_key_point_count?: number | null
  target_key_point_min?: number | null
  target_key_point_max?: number | null
  selection_reason?: string | null
  selection_context?: {
    left_resolution: number
    left_points: number
    right_resolution: number
    right_points: number
  } | null
}

export interface FileAnalysisResult {
  globals?: Record<string, number>
  segments?: SegmentItem[]
  events?: Array<Record<string, unknown>>
  compression_meta?: CompressionMeta
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
  stage_count?: number
  created_at: string
  updated_at: string
}

export interface RuleSetStage {
  stage_code?: string
  stage_name: string
  description?: string
  typical_duration?: string
  current_range?: string
}

export interface RuleSetDetail extends RuleSetItem {
  stages?: RuleSetStage[]
}

export interface TaskLaunchResponse {
  batch_id: string
  batch_status: BatchStatus
  selected_rule_set_id?: string | null
  files?: SessionFileItem[]
  summary?: BatchSummary | null
}

export interface FileAnalysisSubmitItem {
  file_id: string
  analysis_status: AnalysisStatus
  warning_count?: number
  error_message?: string | null
  result?: FileAnalysisResult | null
}

export const currentFeatureAnalyzerApi = {
  upload: (files: File[], ruleSetId?: string) => {
    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    if (ruleSetId) formData.append('rule_set_id', ruleSetId)
    return apiRequest<BatchSession>(
      apiClient.post(`${PREFIX}/uploads`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    )
  },

  getBatch: (batchId: string) =>
    apiRequest<BatchSession>(apiClient.get(`${PREFIX}/batches/${batchId}`)),

  getFileDetail: (batchId: string, fileId: string) =>
    apiRequest<SessionFileItem>(apiClient.get(`${PREFIX}/batches/${batchId}/files/${fileId}`)),

  runAnalysis: (batchId: string, ruleSetId: string, fileResults: FileAnalysisSubmitItem[]) =>
    apiRequest<TaskLaunchResponse>(
      apiClient.post(`${PREFIX}/analysis/run`, {
        batch_id: batchId,
        rule_set_id: ruleSetId,
        file_results: fileResults,
      }, {
        timeout: ANALYSIS_TIMEOUT_MS,
      })
    ),

  listRuleSets: () =>
    apiRequest<{ items: RuleSetItem[] }>(apiClient.get(`${PREFIX}/rule-sets`)),

  getRuleSet: (id: string) =>
    apiRequest<RuleSetDetail>(apiClient.get(`${PREFIX}/rule-sets/${id}`)),

  createRuleSet: (data: Record<string, unknown>) =>
    apiRequest<RuleSetDetail>(apiClient.post(`${PREFIX}/rule-sets`, data)),

  updateRuleSet: (id: string, data: Record<string, unknown>) =>
    apiRequest<RuleSetDetail>(apiClient.put(`${PREFIX}/rule-sets/${id}`, data)),

  deleteRuleSet: (id: string) =>
    apiRequest<{ deleted: boolean }>(apiClient.delete(`${PREFIX}/rule-sets/${id}`)),

  copyRuleSet: (id: string) =>
    apiRequest<RuleSetDetail>(apiClient.post(`${PREFIX}/rule-sets/${id}/copy`)),

  getConfig: () =>
    apiRequest<AppConfig>(apiClient.get(`${PREFIX}/config`)),

  saveConfig: (data: AppConfig) =>
    apiRequest<AppConfig>(apiClient.put(`${PREFIX}/config`, data)),
}
