/**
 * standard-mgr API 模块
 *
 * 照仓库惯例：const PREFIX = '/apps/standard-mgr'，不从 prop 推导
 */

import apiClient, { apiRequest } from '@/api/client'

const PREFIX = '/apps/standard-mgr'

// ============================================================
// 类型定义（全栈 snake_case）
// ============================================================

export type StandardType = 'national' | 'industry' | 'enterprise' | 'international'
export type AnchorBuildStatus = 'pending' | 'processing' | 'done' | 'error'
export type RefStatus = 'valid' | 'suspected' | 'gap' | 'invalid'
export type RefSource = 'auto' | 'user_confirmed' | 'manual' | 'auto_backfill'

export interface StandardItem {
  id: string
  document_id: string
  standard_type: StandardType
  standard_code: string
  standard_name: string
  enterprise_id: string | null
  current_revision_id: string | null
  is_active: boolean
  anchor_build_status: AnchorBuildStatus
  last_anchor_build_at: string | null
  last_anchor_build_error: string | null
  needs_review: boolean
  reference_count: number
  valid_reference_count: number
  suspected_reference_count: number
  gap_reference_count: number
  invalid_reference_count: number
  has_manual_fix: boolean
  manual_fix_count: number
  last_manual_fix_at: string | null
  last_manual_fix_by: string | null
  /** R2-8: 文档平台当前版本 ID，用于检测是否有新版本待清洗 */
  document_current_revision_id: string | null
  created_at: string
  updated_at: string
}

export interface AnchoredSection {
  outline_id: string
  revision_id: string
  seq: number
  title: string
  description: string
  original_text: string
  text_hash: string
  anchor_count: number
  has_anchored: boolean
  anchored_text: string
}

/** 附件上传结果 */
export interface AttachmentInfo {
  id: string
  filename: string
  size: number
  mime_type: string
}

/** 文档集合 */
export interface DocCollection {
  id: string
  name: string
  description: string | null
  doc_count: number
}

/** 文档纳管结果 */
export interface IntakeResult {
  document_id: string
  revision_id: string
  processing_status: string
  source_ref_id: string | null
  attachment_count: number
}

/** 文档处理状态 */
export interface ProcessingStatus {
  processing_status: string
  error_message?: string | null
}

export interface RefAnchor {
  id: string
  standard_id: string
  source_revision_id: string
  source_outline_id: string
  occurrence_index: number
  source_text: string
  context_text: string | null
  ref_type: string
  status: RefStatus
  source: RefSource
  target_document_id: string | null
  target_revision_id: string | null
  target_outline_id: string | null
  /** R9-3: 后端补全的目标文档标题 */
  target_document_title?: string | null
  /** R9-3: 后端补全的目标章节标题 */
  target_outline_title?: string | null
  candidates_json: object | null
  status_reason: string | null
  retry_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface GapItem extends RefAnchor {
  // gap 专用，继承 RefAnchor 所有字段
}

export interface CandidateSection {
  id: string
  revision_id: string
  title: string | null
  seq: number | null
  document_id?: string
}

export interface DocumentInfo {
  id: string
  title: string
  doc_type: string
  processing_status: string
  current_revision_id: string | null
  collection_id?: string
  created_at?: string
  metadata?: object | null
}

/** 文档版本信息 */
export interface DocumentRevision {
  id: string
  revision_no: number
  revision_label: string | null
  is_current?: boolean
  created_at: string
}

// ============================================================
// API 函数
// ============================================================

/** 获取标准列表 */
export async function listStandards(params?: {
  standard_type?: StandardType
  is_active?: number
}): Promise<StandardItem[]> {
  return apiRequest<StandardItem[]>(apiClient.get(`${PREFIX}/standards`, { params }))
}

/** 获取标准详情 */
export async function getStandard(standardId: string): Promise<StandardItem> {
  return apiRequest<StandardItem>(apiClient.get(`${PREFIX}/standards/${standardId}`))
}

/** 纳管新标准 */
export async function createStandard(data: {
  document_id: string
  standard_type: StandardType
  standard_code: string
  standard_name: string
  /** R9-2: 可选指定版本 */
  revision_id?: string
}): Promise<StandardItem> {
  return apiRequest<StandardItem>(apiClient.post(`${PREFIX}/standards`, data))
}

/** 更新标准元数据 */
export async function updateStandard(
  standardId: string,
  data: {
    standard_name?: string
    standard_code?: string
    standard_type?: StandardType
    is_active?: boolean
  },
): Promise<StandardItem> {
  return apiRequest<StandardItem>(apiClient.put(`${PREFIX}/standards/${standardId}`, data))
}

/** 获取带锚点副本列表 */
export async function listAnchoredSections(standardId: string): Promise<AnchoredSection[]> {
  return apiRequest<AnchoredSection[]>(
    apiClient.get(`${PREFIX}/standards/${standardId}/sections`),
  )
}

/** 获取引用锚点列表 */
export async function listRefAnchors(
  standardId: string,
  params?: { status?: RefStatus; ref_type?: string; limit?: number; offset?: number },
): Promise<RefAnchor[]> {
  return apiRequest<RefAnchor[]>(apiClient.get(`${PREFIX}/anchors`, { params: { standard_id: standardId, ...params } }))
}

/** 获取 gap 列表 */
export async function listGaps(
  standardId: string,
  params?: { limit?: number; offset?: number },
): Promise<GapItem[]> {
  return apiRequest<GapItem[]>(apiClient.get(`${PREFIX}/anchors/gaps`, { params: { standard_id: standardId, ...params } }))
}

/** 更新锚点构建状态 */
export async function updateBuildStatus(
  standardId: string,
  status: AnchorBuildStatus,
  error_message?: string,
): Promise<{ standard: StandardItem; rebuild: object | null }> {
  return apiRequest<{ standard: StandardItem; rebuild: object | null }>(
    apiClient.post(`${PREFIX}/standards/${standardId}/build-status`, { status, error_message }),
  )
}

/** 写入锚点结果（人工修正等） */
export async function writeAnchorResult(data: {
  standard_id: string
  source_revision_id: string
  source_outline_id: string
  occurrence_index: number
  source_text: string
  context_text?: string
  ref_type: string
  status: RefStatus
  source: RefSource
  target_document_id?: string
  target_revision_id?: string
  target_outline_id?: string
  status_reason?: string
}): Promise<{ ref_anchor: RefAnchor; anchored_section: object | null; standard: StandardItem }> {
  return apiRequest<{ ref_anchor: RefAnchor; anchored_section: object | null; standard: StandardItem }>(
    apiClient.post(`${PREFIX}/write-anchor-result`, data),
  )
}

/** R2-4: 上传附件（FormData） */
export async function uploadAttachment(file: File): Promise<AttachmentInfo> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('source_tag', 'doc-platform')
  fd.append('source_id', 'temp')
  return apiRequest<AttachmentInfo>(
    apiClient.post('/attachments/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  )
}

/** R2-4: 获取文档集合列表 */
export async function listCollections(): Promise<DocCollection[]> {
  const res = await apiRequest<{ items: DocCollection[] }>(apiClient.get('/docs/collections'))
  return (res as any).items ?? []
}

/** R2-4: 纳管文档到平台 */
export async function intakeDocument(data: {
  app_id: string
  collection_id: string
  attachments: Array<{ id: string }>
}): Promise<IntakeResult> {
  return apiRequest<IntakeResult>(apiClient.post('/docs/intakes', data))
}

/** R2-4: 查询文档处理状态 */
export async function getDocumentStatus(documentId: string): Promise<ProcessingStatus> {
  return apiRequest<ProcessingStatus>(
    apiClient.get(`/docs/documents/${documentId}/processing`),
  )
}

/** 查找候选 section（用于手动修正目标选择） */
export async function findCandidates(data: {
  document_id?: string
  revision_id?: string
  title_hint?: string
  seq_hint?: string
  query_text?: string
}): Promise<CandidateSection[]> {
  return apiRequest<CandidateSection[]>(apiClient.post(`${PREFIX}/sections/find-candidates`, data))
}

// ============================================================
// R8-1: 文档平台选择器
// ============================================================

/** 从文档平台搜索文档 */
export async function searchDocuments(params: {
  keyword?: string
  doc_type?: string
  processing_status?: string
  page?: number
  page_size?: number
}): Promise<{ items: DocumentInfo[]; pagination: { total: number; page: number } }> {
  return apiRequest<{ items: DocumentInfo[]; pagination: { total: number; page: number } }>(
    apiClient.get('/docs/documents', { params }),
  )
}

/** 获取文档的版本列表 */
export async function getDocumentRevisions(documentId: string): Promise<DocumentRevision[]> {
  return apiRequest<DocumentRevision[]>(apiClient.get(`/docs/documents/${documentId}/revisions`))
}


