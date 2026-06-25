import apiClient, { apiRequest } from './client'

const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000

export type BatchStatus = 'idle' | 'uploading' | 'ready' | 'analyzing' | 'completed' | 'partial_failed' | 'failed'
export type AnalysisStatus = 'pending' | 'parsing' | 'ready' | 'analyzing' | 'completed' | 'failed'

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
  _duplicate_diagnosis?: {
    duplicate_count: number
    duplicate_times: number[]
    message: string
  } | null
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
}

export interface FileAnalysisResult {
  globals?: Record<string, number>
  segments?: SegmentItem[]
  events?: any[]
  llm_result?: {
    stages: any[]
    summary?: string
    warnings?: any[]
    _error?: string
    _debug?: {
      attempt?: number
      content_length?: number
      content_preview?: string
      reasoning_preview?: string
    } | null
  }
  stage_metrics?: any[]
  file_metrics?: Record<string, any>
}

export interface BatchSummary {
  file_total: number
  success_count: number
  failed_count: number
  stage_distribution: any[]
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

export interface RuleSetDetail extends RuleSetItem {
  business_context?: string
  prompt_template?: string
  output_json_schema?: string
  llm_instructions?: string
  stages?: any[]
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

  createRuleSet: (data: any) =>
    apiRequest<RuleSetDetail>(apiClient.post('/apps/current-feature-analyzer/rule-sets', data)),

  updateRuleSet: (id: string, data: any) =>
    apiRequest<RuleSetDetail>(apiClient.put(`/apps/current-feature-analyzer/rule-sets/${id}`, data)),

  deleteRuleSet: (id: string) =>
    apiRequest<{ deleted: boolean }>(apiClient.delete(`/apps/current-feature-analyzer/rule-sets/${id}`)),

  copyRuleSet: (id: string) =>
    apiRequest<RuleSetDetail>(apiClient.post(`/apps/current-feature-analyzer/rule-sets/${id}/copy`)),

  getConfig: () =>
    apiRequest<any>(apiClient.get('/apps/current-feature-analyzer/config')),

  saveConfig: (data: any) =>
    apiRequest<any>(apiClient.put('/apps/current-feature-analyzer/config', data)),
}