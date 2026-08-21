import {
  CONTRACT_LLM_COMPARE_DEFAULT_CONCURRENCY,
  CONTRACT_LLM_COMPARE_DEFAULT_TEMPERATURE,
  CONTRACT_LLM_COMPARE_TIMEOUT_MS,
} from '@/api/contract-v2'

/** 通用状态标签字典值类型：复用于 ContractDetail / ContractList 的字典与 el-tag type 绑定 */
export interface StatusTagEntry {
  label: string
  type: 'success' | 'warning' | 'info' | 'danger' | ''
}

/** 章节预估耗时：每章节分钟数 */
export const COMPARE_ESTIMATE_MIN_MINUTES_PER_SECTION = 0.5
export const COMPARE_ESTIMATE_MAX_MINUTES_PER_SECTION = 0.8

/** 置信度阈值 */
export const CONFIDENCE_HIGH_THRESHOLD = 0.8
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.5

/** 比对弹窗并发数滑块 */
export const COMPARE_CONCURRENCY_MIN = 1
export const COMPARE_CONCURRENCY_MAX = 10
export const COMPARE_CONCURRENCY_DEFAULT = 6

/** LLM 比对默认参数（从 api 层透传，避免组件与 api 层默认值二义） */
export {
  CONTRACT_LLM_COMPARE_DEFAULT_CONCURRENCY as DEFAULT_LLM_COMPARE_CONCURRENCY,
  CONTRACT_LLM_COMPARE_DEFAULT_TEMPERATURE as DEFAULT_LLM_COMPARE_TEMPERATURE,
  CONTRACT_LLM_COMPARE_TIMEOUT_MS as LLM_COMPARE_TIMEOUT_MS,
}

/** 元数据渲染已知字段白名单 */
export const METADATA_DISPLAY_FIELDS: string[] = [
  'contract_number',
  'contract_type',
  'contract_date',
  'parent_company',
  'party_a',
  'party_b',
  'contract_amount',
]

/** 轻量 HTML 转义，避免把后端/模型返回内容直接拼接到 HTML */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
