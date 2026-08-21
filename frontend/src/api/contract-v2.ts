import apiClient, { apiRequest } from './client'

const COMPARE_BASE = '/mini-apps/contract-mgr-v2'

export interface OrgNode {
  id: string
  parent_id: string | null
  node_type: 'group' | 'party' | 'project'
  name: string
  path: string
  level: number
  sort_order: number
  is_active: boolean
  children?: OrgNode[]
  created_at: string
  updated_at: string
}

export interface ContractMainRecord {
  id: string
  org_node_id: string
  contract_name: string
  contract_type: string | null
  current_version_id: string | null
  version_count: number
  status: 'draft' | 'active' | 'expired' | 'terminated'
  party_a?: string | null
  total_amount?: number | null
  document_id?: string
  processing_status?: string
  processing_error_code?: string | null
  classification_json?: Array<{
    document_id: string
    title: string
    confidence: number
    reasons: string[]
  }>
  created_by: string
  created_at: string
  updated_at: string
  versions?: ContractVersion[]
}

export interface ContractVersion {
  id: string
  contract_id: string
  row_id: string
  file_id: string | null
  document_id: string | null
  revision_id: string | null
  version_number: string
  version_name: string | null
  version_type: 'draft' | 'signed' | 'amendment' | 'supplement' | null
  version_status: 'draft' | 'reviewing' | 'approved' | 'rejected' | 'archived'
  effective_date: string | null
  expiry_date: string | null
  contract_number: string | null
  party_a: string | null
  party_b: string | null
  total_amount: number | null
  change_summary: string | null
  is_current: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface ContractListResult {
  items: ContractMainRecord[]
  pagination: {
    page: number
    size: number
    total: number
    pages: number
    has_next: boolean
    has_prev: boolean
  }
}

export interface DashboardData {
  total_contracts: number
  total_versions: number
  total_nodes: number
  by_status: Record<string, number>
  by_type: Record<string, number>
  recent_contracts: ContractMainRecord[]
}

export interface OrgNodeStats {
  node_id: string
  node_name: string
  node_type: string
  direct_contracts: number
  total_contracts: number
}

export async function getOrgTree(): Promise<OrgNode[]> {
  return apiRequest<OrgNode[]>(apiClient.get('/apps/contract-mgr-v2/org-nodes/tree'))
}

export async function createOrgNode(data: { name: string; node_type: string; parent_id?: string }): Promise<OrgNode> {
  return apiRequest<OrgNode>(apiClient.post('/apps/contract-mgr-v2/org-nodes', data))
}

export async function updateOrgNode(nodeId: string, data: { name?: string; sort_order?: number }): Promise<OrgNode> {
  return apiRequest<OrgNode>(apiClient.put(`/apps/contract-mgr-v2/org-nodes/${nodeId}`, data))
}

export async function deleteOrgNode(nodeId: string): Promise<void> {
  return apiRequest<void>(apiClient.delete(`/apps/contract-mgr-v2/org-nodes/${nodeId}`))
}

export async function getOrgNodeStats(nodeId: string): Promise<OrgNodeStats> {
  return apiRequest<OrgNodeStats>(apiClient.get(`/apps/contract-mgr-v2/org-nodes/${nodeId}/stats`))
}

export async function listContracts(params?: {
  org_node_id?: string
  include_children?: boolean
  contract_type?: string
  status?: string
  keyword?: string
  page?: number
  page_size?: number
}): Promise<ContractListResult> {
  return apiRequest<ContractListResult>(apiClient.get('/apps/contract-mgr-v2/contracts', { params }))
}

export async function getContract(contractId: string): Promise<ContractMainRecord> {
  return apiRequest<ContractMainRecord>(apiClient.get(`/apps/contract-mgr-v2/contracts/${contractId}`))
}

export async function createContract(data: {
  org_node_id: string
  contract_name: string
  contract_type?: string
}): Promise<ContractMainRecord> {
  return apiRequest<ContractMainRecord>(apiClient.post('/apps/contract-mgr-v2/contracts', data))
}

export async function updateContract(contractId: string, data: {
  contract_name?: string
  contract_type?: string
  status?: string
}): Promise<ContractMainRecord> {
  return apiRequest<ContractMainRecord>(apiClient.put(`/apps/contract-mgr-v2/contracts/${contractId}`, data))
}

export async function deleteContract(contractId: string): Promise<void> {
  return apiRequest<void>(apiClient.delete(`/apps/contract-mgr-v2/contracts/${contractId}`))
}

/**
 * 从已上传的附件创建版本
 * 不依赖 mini-app.service.js 和 mini_app_rows
 */
export async function createVersionFromAttachment(contractId: string, data: {
  file_id: string
  contract_type: string  // 必填：sales(销售合同) | supply(供货合同)
  version_number?: string
  version_name?: string
  version_type?: string
  document_mode?: 'new' | 'existing'
  existing_document_id?: string
}): Promise<ContractVersion> {
  return apiRequest<ContractVersion>(apiClient.post(`/apps/contract-mgr-v2/contracts/${contractId}/versions/from-attachment`, data))
}

export async function listVersions(contractId: string): Promise<ContractVersion[]> {
  return apiRequest<ContractVersion[]>(apiClient.get(`/apps/contract-mgr-v2/contracts/${contractId}/versions`))
}

export async function updateVersion(versionId: string, data: Record<string, unknown>): Promise<ContractVersion> {
  return apiRequest<ContractVersion>(apiClient.put(`/apps/contract-mgr-v2/versions/${versionId}`, data))
}

export async function approveVersion(versionId: string): Promise<ContractVersion> {
  return apiRequest<ContractVersion>(apiClient.put(`/apps/contract-mgr-v2/versions/${versionId}/approve`))
}

export async function setCurrentVersion(versionId: string): Promise<ContractVersion> {
  return apiRequest<ContractVersion>(apiClient.put(`/apps/contract-mgr-v2/versions/${versionId}/current`))
}

export async function deleteVersion(versionId: string): Promise<void> {
  return apiRequest<void>(apiClient.delete(`/apps/contract-mgr-v2/versions/${versionId}`))
}

export async function getDashboard(): Promise<DashboardData> {
  return apiRequest<DashboardData>(apiClient.get('/apps/contract-mgr-v2/dashboard'))
}

export interface ProcessingStatus {
  has_document: boolean
  document_id?: string
  revision_id?: string | null
  /**
   * document 维度的处理状态（平台状态机当前口径）。
   * 多 revision 场景下反映的是 document 最新 revision 的处理进度。
   */
  document_processing_status?: string
  /**
   * 兼容字段：与 document_processing_status 相同，供现有前端继续使用。
   */
  processing_status?: string
  processing_error_code?: string | null
  processing_error_message?: string | null
  /**
   * 状态口径标识：
   * - none: 未关联文档
   * - document_current_revision: 该版本绑定的 revision 即为 document 当前 revision，状态可直接代表该版本
   * - document_shared: 该版本绑定的 revision 不是 document 当前 revision，状态为 document 维度共享值
   */
  status_scope?: 'none' | 'document_current_revision' | 'document_shared'
  status_scope_note?: string
}

export async function getVersionProcessingStatus(versionId: string): Promise<ProcessingStatus> {
  return apiRequest<ProcessingStatus>(apiClient.get(`/apps/contract-mgr-v2/versions/${versionId}/processing-status`))
}

export interface ExtractMetadataResult {
  success: boolean
  metadata: Record<string, unknown>
  fields: string[]
  /** 本次提取读取的 revision_id（= 该版本绑定的 revision_id） */
  revision_id?: string
  /** 回填目标 row_id（= 该版本自己的 row_id） */
  row_id?: string
}

export async function extractMetadata(versionId: string): Promise<ExtractMetadataResult> {
  return apiRequest<ExtractMetadataResult>(apiClient.post(`/apps/contract-mgr-v2/versions/${versionId}/extract-metadata`))
}

export interface VersionMetadata {
  has_metadata: boolean
  contract_number: string | null
  party_a: string | null
  party_b: string | null
  contract_amount: number | null
}

export async function getVersionMetadata(versionId: string): Promise<VersionMetadata> {
  return apiRequest<VersionMetadata>(apiClient.get(`/apps/contract-mgr-v2/versions/${versionId}/metadata`))
}

export async function updateVersionMetadata(versionId: string, metadata: {
  contract_number?: string | null
  party_a?: string | null
  party_b?: string | null
  contract_amount?: number | null
}): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(apiClient.put(`/apps/contract-mgr-v2/versions/${versionId}/metadata`, metadata))
}

export interface CompareRunResult {
  run_id: string
  status: string
  summary: {
    total: number
    high: number
    medium: number
    low: number
  }
  items: Array<{
    id: string
    run_id: string
    base_unit_id: string | null
    target_unit_id: string | null
    change_type: 'identical' | 'modified' | 'semantic_change' | 'added' | 'removed'
    summary: string | null
    risk_level: 'none' | 'low' | 'medium' | 'high' | null
  }>
  high_severity_items: Array<{
    id: string
    run_id: string
    change_type: string
    summary: string | null
    risk_level: string | null
  }>
  medium_severity_items: Array<{
    id: string
    run_id: string
    change_type: string
    summary: string | null
    risk_level: string | null
  }>
  low_severity_items: Array<{
    id: string
    run_id: string
    change_type: string
    summary: string | null
    risk_level: string | null
  }>
}

export async function createCompareRun(versionIdA: string, versionIdB: string): Promise<{ run_id: string; status: string }> {
  return apiRequest<{ run_id: string; status: string }>(apiClient.post(`/apps/contract-mgr-v2/compare-runs`, {
    version_id_a: versionIdA,
    version_id_b: versionIdB,
  }))
}

export async function getCompareRunResult(runId: string): Promise<CompareRunResult> {
  return apiRequest<CompareRunResult>(apiClient.get(`/apps/contract-mgr-v2/compare-runs/${runId}`))
}

// ===== LLM 语义比对（qwen3.6:35b，替代旧 compare-runs 纯文本比对）=====
export interface LlmCompareKeyChange {
  description?: string
  old?: string
  new?: string
}

export interface LlmCompareSectionResult {
  type: 'matched' | 'added' | 'removed'
  title: string
  change_type: 'identical' | 'modified' | 'semantic_change' | 'added' | 'removed' | 'error'
  summary: string
  key_changes?: LlmCompareKeyChange[]
  risk_level?: string
  content_preview?: string
}

export interface LlmCompareData {
  results: LlmCompareSectionResult[]
  summary: {
    total: number
    identical: number
    modified: number
    added: number
    removed: number
  }
  duration_ms: number
}

/** POST /compare 实时运行结果（target_row_id 可选） */
export interface LlmCompareRunResponse extends LlmCompareData {
  target_row_id?: string
}

/** GET /data/:rowId/compare 已存储结果 */
export interface LlmCompareStoredResult extends LlmCompareData {
  target_row_id: string
  model_name?: string
  compared_at?: string
}

// qwen3.6:35b（ErixAI relay）
export const CONTRACT_LLM_COMPARE_MODEL_ID = 'mojfh2d7cvgl6uam7fnx'

/** LLM 语义比对默认参数（组件层应引用这些常量，避免两边默认值分叉） */
export const CONTRACT_LLM_COMPARE_DEFAULT_TEMPERATURE = 0.3
export const CONTRACT_LLM_COMPARE_DEFAULT_CONCURRENCY = 3
export const CONTRACT_LLM_COMPARE_TIMEOUT_MS = 1800000

export async function compareVersionsWithLlm(
  rowIdA: string,
  rowIdB: string,
  options?: { model_id?: string; temperature?: number; concurrency?: number },
): Promise<LlmCompareRunResponse> {
  return apiRequest<LlmCompareRunResponse>(
    apiClient.post(
      `${COMPARE_BASE}/compare`,
      {
        row_id_a: rowIdA,
        row_id_b: rowIdB,
        model_id: options?.model_id || CONTRACT_LLM_COMPARE_MODEL_ID,
        temperature: options?.temperature ?? CONTRACT_LLM_COMPARE_DEFAULT_TEMPERATURE,
        concurrency: options?.concurrency ?? CONTRACT_LLM_COMPARE_DEFAULT_CONCURRENCY,
      },
      { timeout: CONTRACT_LLM_COMPARE_TIMEOUT_MS },
    ),
  )
}

export async function getVersionCompareResult(rowId: string): Promise<LlmCompareStoredResult | null> {
  return apiRequest<LlmCompareStoredResult | null>(
    apiClient.get(`${COMPARE_BASE}/data/${rowId}/compare`),
  )
}

export interface VersionContent {
  has_content: boolean
  row_id?: string
  ocr_text?: string | null
  ocr_service?: string | null
  ocr_at?: string | null
  filtered_text?: string | null
  filter_at?: string | null
  sections?: Array<{ title: string; content: string }> | null
  extract_json?: Record<string, unknown> | null
  extract_at?: string | null
}

export async function getVersionContent(versionId: string): Promise<VersionContent> {
  return apiRequest<VersionContent>(apiClient.get(`/apps/contract-mgr-v2/versions/${versionId}/content`))
}
