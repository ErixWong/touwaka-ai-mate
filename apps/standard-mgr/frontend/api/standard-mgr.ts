/**
 * standard-mgr API 模块
 *
 * 照仓库惯例：const PREFIX = '/apps/standard-mgr'，不从 prop 推导
 *
 * ## 平台端点复合响应约定
 *
 * 部分平台 /api/docs/* 端点返回复合结构 `{ items: T[], ...meta }`（listDocuments,
 * listVersions, listCollections 等），而非裸数组。本模块调用此类端点后**必须解包 .items**。
 *
 * 对应摘要：
 * - **searchDocuments** → `{ items: DocumentInfo[], pagination: {...} }` → caller 取 .items ✅
 * - **getDocumentRevisions** → `{ document_id, current_revision_id, items: DocumentRevision[] }` → unwrapItems()
 * - **listCollections** → `{ items: DocCollection[] }` → 反回 .items ⚠️ (R5 已手动解包)
 *
 * 新增平台端点时请参照此表，不确定时优先用 unwrapItems() 兜底。
 */

import apiClient, { apiRequest } from '@/api/client'

const PREFIX = '/apps/standard-mgr'

// ============================================================
// 工具
// ============================================================

/**
 * 解包复合端点响应的 `.items` 数组，同时兜底裸数组/非数组输入。
 *
 * - res 是数组 → 直接返回
 * - res 有 .items（数组）→ 返回 res.items
 * - 其他 → 返回空数组
 */
function unwrapItems<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[]
  const obj = res as Record<string, unknown> | null
  if (obj && Array.isArray(obj.items)) return obj.items as T[]
  // 极端兜底：某些端点返回 { items: undefined } 或裸 null
  return []
}

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
  /** 基础信息展示：文档标题（documents.title） */
  document_title?: string | null
  /** 基础信息展示：当前版本标签（document_revisions.revision_label，如 2022①/2022） */
  current_revision_label?: string | null
  /** 纳管时文档是否已完成处理 */
  document_ready?: boolean
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
// R11: 企业花名册 & 归属推断
// ============================================================

export interface EnterpriseItem {
  id: string
  name: string
  name_en: string | null
  description: string | null
  /** 标准编号前缀（逗号分隔，如 Q-JL, Q-JLY）；用于企业标准识别与归属推断 */
  code_prefixes: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  /** listEnterprises 时返回 */
  standard_count?: number
}

export interface ClassifyPreviewResult {
  standard_type: string
  standard_code: string
  standard_name: string
  enterprise_id: string | null
  enterprise_name: string | null
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
  /** R11-3: 可选企业归属 */
  enterprise_id?: string | null
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
    /** R11-5: 企业归属 */
    enterprise_id?: string | null
  },
): Promise<StandardItem> {
  return apiRequest<StandardItem>(apiClient.put(`${PREFIX}/standards/${standardId}`, data))
}

/** R19: 删除标准（含全部引用锚点，不影响文档平台内容） */
export async function deleteStandard(
  standardId: string,
): Promise<{ deleted: boolean; standard_id: string; deleted_anchors: number; deleted_sections: number }> {
  return apiRequest<{ deleted: boolean; standard_id: string; deleted_anchors: number; deleted_sections: number }>(
    apiClient.delete(`${PREFIX}/standards/${standardId}`),
  )
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

/** R13-1: 触发服务端锚点清洗（异步，立即返回） */
export async function startCleaning(standardId: string): Promise<{ accepted: boolean; standard_id: string }> {
  return apiRequest<{ accepted: boolean; standard_id: string }>(
    apiClient.post(`${PREFIX}/standards/${standardId}/clean`),
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
  const res = await apiRequest<unknown>(apiClient.get('/docs/collections'))
  return unwrapItems<DocCollection>(res)
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

/** 获取文档的版本列表（已标记 is_current） */
export async function getDocumentRevisions(documentId: string): Promise<DocumentRevision[]> {
  const res = await apiRequest<{
    resolved_current_revision_id: string | null
    items: DocumentRevision[]
  }>(apiClient.get(`/docs/documents/${documentId}/revisions`))
  const items = res.items ?? []
  // 标记当前版本，供 UI 默认选中
  if (res.resolved_current_revision_id) {
    const curId = res.resolved_current_revision_id
    for (const item of items) {
      if (item.id === curId) {
        item.is_current = true
        break
      }
    }
  }
  return items
}

// ============================================================
// R11: 企业花名册 & 归属推断 API
// ============================================================

/** 企业列表（含标准计数） */
export async function listEnterprises(): Promise<EnterpriseItem[]> {
  return apiRequest<EnterpriseItem[]>(apiClient.get(`${PREFIX}/enterprises`))
}

/** 新建企业 */
export async function createEnterprise(data: {
  name: string
  name_en?: string | null
  description?: string | null
  code_prefixes?: string | null
}): Promise<EnterpriseItem> {
  return apiRequest<EnterpriseItem>(apiClient.post(`${PREFIX}/enterprises`, data))
}

/** 更新企业 */
export async function updateEnterprise(
  enterpriseId: string,
  data: {
    name?: string
    name_en?: string | null
    description?: string | null
    code_prefixes?: string | null
    is_active?: boolean
  },
): Promise<EnterpriseItem> {
  return apiRequest<EnterpriseItem>(apiClient.put(`${PREFIX}/enterprises/${enterpriseId}`, data))
}

/** 停用企业（软删除，is_active=0） */
export async function deleteEnterprise(enterpriseId: string): Promise<{ id: string; name: string; is_active: boolean }> {
  return apiRequest<{ id: string; name: string; is_active: boolean }>(
    apiClient.delete(`${PREFIX}/enterprises/${enterpriseId}`),
  )
}

/** 归属推断预览 */
export async function classifyPreview(data: {
  document_id: string
  revision_id: string
}): Promise<ClassifyPreviewResult> {
  return apiRequest<ClassifyPreviewResult>(apiClient.post(`${PREFIX}/standards/classify-preview`, data))
}

// ============================================================
// 应用配置（设置大模型）
// ============================================================

export interface StandardMgrConfig {
  /** LLM 模型 ID（null = 使用专家绑定/系统默认模型） */
  llm_model_id: string | null
  temperature?: number
}

/** 读取应用配置（登录即可） */
export async function getConfig(): Promise<StandardMgrConfig> {
  return apiRequest<StandardMgrConfig>(apiClient.get(`${PREFIX}/config`))
}

/** 保存应用配置（需管理员） */
export async function saveConfig(config: StandardMgrConfig): Promise<StandardMgrConfig> {
  return apiRequest<StandardMgrConfig>(apiClient.put(`${PREFIX}/config`, config))
}

