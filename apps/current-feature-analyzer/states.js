/**
 * current-feature-analyzer 状态常量与辅助方法
 *
 * 集中管理批次 / 文件分析状态语义，避免分散在各 service 中的魔法字符串。
 * 当前仅做轻量常量集中，不引入平台级状态机框架。
 */

// ── 批次状态 ──────────────────────────────────────────────
export const BATCH_STATUS = Object.freeze({
  IDLE: 'idle',
  UPLOADING: 'uploading',
  READY: 'ready',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  PARTIAL_FAILED: 'partial_failed',
  FAILED: 'failed',
});

/** 批次已进入终态（不可再修改分析结果） */
export function isBatchTerminal(status) {
  return status === BATCH_STATUS.COMPLETED
    || status === BATCH_STATUS.PARTIAL_FAILED
    || status === BATCH_STATUS.FAILED;
}

/** 批次仍在处理中 */
export function isBatchActive(status) {
  return !isBatchTerminal(status);
}

// ── 文件分析状态 ──────────────────────────────────────────
export const FILE_ANALYSIS_STATUS = Object.freeze({
  PENDING: 'pending',
  PARSING: 'parsing',
  READY: 'ready',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

/** 文件分析已结束（成功或失败） */
export function isFileAnalysisDone(status) {
  return status === FILE_ANALYSIS_STATUS.COMPLETED
    || status === FILE_ANALYSIS_STATUS.FAILED;
}

/** 文件分析正在进行中 */
export function isFileAnalysisActive(status) {
  return !isFileAnalysisDone(status);
}

// ── LLM 错误码 ────────────────────────────────────────────
export const LLM_ERROR_CODES = Object.freeze({
  NO_MODEL_AVAILABLE: 'no_model_available',
  INVALID_JSON_RESPONSE: 'invalid_json_response',
});

// ── 默认配置 ──────────────────────────────────────────────
export const DEFAULT_VC_OPTIONS = Object.freeze({
  absolute_resolution: 0.03,
  relative_resolution: 0.02,
  merge_gap_ratio: 0.6,
  min_transition_points: 3,
});

export const DEFAULT_LLM_OPTIONS = Object.freeze({
  temperature: 0.2,
  max_tokens: 8000,
  timeout_ms: 120000,
  retry_times: 2,
});

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时
