import type { AnalysisStatus } from '../api/current-feature-analyzer'

export const ANALYSIS_STATUS_LABELS: Record<AnalysisStatus, string> = {
  pending: '待处理',
  ready: '就绪',
  compressing: '压缩中',
  llm_recognizing: '阶段识别中',
  analyzing: '分析中',
  completed: '已完成',
  failed: '失败',
}

export const ANALYSIS_STATUS_TAG_TYPES: Partial<Record<AnalysisStatus, string>> = {
  pending: 'info',
  ready: '',
  compressing: 'warning',
  llm_recognizing: 'warning',
  analyzing: 'warning',
  completed: 'success',
  failed: 'danger',
}
