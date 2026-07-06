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

// ── 文件分析状态 ──────────────────────────────────────────
export const FILE_ANALYSIS_STATUS = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  COMPRESSING: 'compressing',
  LLM_RECOGNIZING: 'llm_recognizing',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时
