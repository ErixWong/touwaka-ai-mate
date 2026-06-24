import apiClient, { apiRequest } from './client'

export type DocProcessingStage = 'pending_ocr' | 'ocr_processing' | 'pending_clean' | 'pending_outline' | 'pending_chunk' | 'pending_embedding' | 'ready' | 'error'
export type DocRevisionStatus = 'draft' | 'review' | 'approved' | 'effective' | 'expired' | 'archived'
export type DocOcrStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown' | string

export interface DocDocument {
  id: string
  doc_type: 'knowledge' | 'contract' | 'department_doc' | 'standard'
  source_system: string
  source_ref_id: string
  title: string
  owner_id: string
  department_id: string
  visibility: 'private' | 'department' | 'public'
  collection_id: string | null
  current_version_id: string | null
  current_revision_id: string | null
  ocr_task_id?: string | null
  processing_status: DocProcessingStage | null
  processing_error_code: string | null
  lifecycle_status: string
  metadata: Record<string, unknown>
  classification_json?: Array<{
    document_id: string
    title: string
    confidence: number
    reasons: string[]
  }>
  created_at: string
  updated_at: string
}

export interface DocVersion {
  id: string
  revision_no: number
  revision_label: string | null
  revision_status: DocRevisionStatus
  is_current: boolean
  diff_status: string | null
  created_by: string
  effective_from: string | null
  effective_to: string | null
  created_at: string
  updated_at: string
}

export interface DocRevision {
  id: string
  revision_no: number
  revision_label: string | null
  revision_status: DocRevisionStatus
  is_current: boolean
  effective_from: string | null
  effective_to: string | null
  diff_status: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface DocRevisionsResponse {
  document_id: string
  current_revision_id: string | null
  items: DocRevision[]
}

export interface DocProcessingStatus {
  document_id: string
  processing_status: DocProcessingStage
  processing_error_code: string | null
  processing_error_message: string | null
  processing_retry_count: number
  processing_updated_at: string
  has_preview_result?: boolean
  ocr_result?: {
    id: string
    revision_id: string
    task_id: string | null
    status: DocOcrStatus
    progress: number
    image_count: number | null
    main_markdown_attachment_id: string | null
    raw_result_attachment_id: string | null
    deliverables_manifest_attachment_id: string | null
    image_manifest_attachment_id: string | null
    line_count: number | null
    error_code: string | null
    error_message: string | null
    started_at: string | null
    completed_at: string | null
    has_preview_result?: boolean
  } | null
}

export interface DocRetryResult {
  document_id: string
  processing_status: DocProcessingStage
}

export interface DocPermissions {
  can_view: boolean
  can_retry_processing: boolean
  can_set_current_revision: boolean
  can_relocate: boolean
}

export interface DocDiffStatus {
  revision_id: string
  status: string
}

export interface DocIntakeResult {
  document_id: string
  revision_id: string
  processing_status: DocProcessingStage
  source_ref_id?: string
  attachment_count?: number
}

export interface DocAttachmentInfo {
  id: string
  file_name: string | null
  mime_type: string
  file_size: number
  access_level: string
  created_at: string
  download_url: string | null
  preview_url: string | null
  requires_auth?: boolean
}

export interface DocResultImageAttachment {
  id: string
  attachment_id: string
  filename: string | null
  media_type: string | null
  sort_order: number
  alt_text: string | null
  description: string | null
  markdown_path?: string | null
  referenced_in_markdown?: number | boolean | null
  line_number?: number | null
  attachment: DocAttachmentInfo | null
}

export interface DocResultDetail {
  document: DocDocument & {
    has_preview_result: boolean
  }
  revision: {
    id: string
    document_id: string
    revision_no: number
    revision_label: string | null
    revision_status: DocRevisionStatus
    created_by: string
    created_at: string
    uploader: {
      id: string
      username: string
    } | null
  } | null
  source_attachment: DocAttachmentInfo | null
  processing: {
    status: DocProcessingStage
    error_code: string | null
    error_message: string | null
    updated_at: string | null
  }
  ocr_result: {
    id: string
    task_id: string | null
    status: DocOcrStatus
    progress: number
    image_count: number | null
    line_count: number | null
    started_at: string | null
    completed_at: string | null
    error_code: string | null
    error_message: string | null
    preview_markdown_content?: string | null
    cleaned_markdown_attachment?: DocAttachmentInfo | null
    main_markdown_attachment: DocAttachmentInfo | null
    raw_result_attachment: DocAttachmentInfo | null
    deliverables_manifest_attachment: DocAttachmentInfo | null
    image_manifest_attachment: DocAttachmentInfo | null
  } | null
  image_attachments: DocResultImageAttachment[]
}

export interface SubmitOcrRequest {
  attachment_id?: string
  backend?: string
  lang?: string
  image_analysis?: boolean
  formula_enable?: boolean
  table_enable?: boolean
}

export interface SubmitOcrResult {
  document_id: string
  ocr_result_id: string
  task_id: string | null
  status: DocOcrStatus
  progress: number
}

export interface SyncOcrResult {
  document_id: string
  ocr_result_id: string
  status: DocOcrStatus
  progress: number
  completed: boolean
}

export interface DocChunk {
  id: string
  version_id: string
  outline_id: string | null
  title: string | null
  content: string | null
  seq: number
  from_line: number | null
  to_line: number | null
  text_hash: string | null
  byte_count: number | null
  token_count: number | null
  embedding_status?: string | null
}

export interface DocRecallParams {
  query: string
  scope?: 'all' | 'knowledge' | 'contract' | 'department' | 'standard'
  doc_types?: string[]
  top_k?: number
  threshold?: number
  context_window?: number
}

export interface DocRecallItem {
  score: number
  chunk: {
    id: string
    title: string
    content: string
    seq: number
  }
  version: {
    id: string
    revision_no: number
    revision_label: string
    status: string
  }
  document: {
    id: string
    title: string
    doc_type: string
    collection_id?: string | null
  }
}

export interface DocCompareRun {
  id: string
  document_id: string
  base_version_id: string
  target_version_id: string
  status: string
  summary_json: Record<string, unknown>
  model_info: Record<string, unknown>
  duration_ms: number
  created_by: string
  created_at: string
}

export interface ExtractOutlineResult {
  revision_id: string
  document_id: string
  outline_count: number
  processing_status: string
  partial: boolean
  failed_chunks: number
  total_chunks: number
}

export interface GenerateChunksResult {
  revision_id: string
  document_id: string
  chunk_count: number
  outline_count: number
  processing_status: string
}

export interface DocListResult {
  items: DocDocument[]
  total: number
  page: number
  page_size: number
}

export interface CreateDocIntakeRequest {
  app_id: string
  collection_id: string
  schema_id?: string | null
  attachments: Array<{ id: string }>
}

export async function listDocuments(params?: {
  doc_type?: string
  collection_id?: string
  processing_status?: string
  keyword?: string
  page?: number
  size?: number
}): Promise<DocListResult> {
  return apiRequest<DocListResult>(apiClient.get('/docs/documents', { params }))
}

export async function getDocument(documentId: string): Promise<DocDocument> {
  return apiRequest<DocDocument>(apiClient.get(`/docs/documents/${documentId}`))
}

export async function deleteDocument(documentId: string): Promise<{ deleted: boolean; document_id: string }> {
  return apiRequest<{ deleted: boolean; document_id: string }>(apiClient.delete(`/docs/documents/${documentId}`))
}

export async function listVersions(documentId: string): Promise<DocVersion[]> {
  const result = await apiRequest<DocRevisionsResponse>(apiClient.get(`/docs/documents/${documentId}/revisions`))
  return result.items
}

export async function getRevisions(documentId: string): Promise<DocRevisionsResponse> {
  return apiRequest<DocRevisionsResponse>(apiClient.get(`/docs/documents/${documentId}/revisions`))
}

export async function getProcessingStatus(documentId: string): Promise<DocProcessingStatus> {
  return apiRequest<DocProcessingStatus>(apiClient.get(`/docs/documents/${documentId}/processing`))
}

export async function createDocIntake(data: CreateDocIntakeRequest): Promise<DocIntakeResult> {
  return apiRequest<DocIntakeResult>(apiClient.post('/docs/intakes', data))
}

export async function submitOcr(documentId: string, data: SubmitOcrRequest = {}): Promise<SubmitOcrResult> {
  return apiRequest<SubmitOcrResult>(apiClient.post(`/docs/documents/${documentId}/ocr/submit`, data))
}

export async function syncOcr(documentId: string): Promise<SyncOcrResult> {
  return apiRequest<SyncOcrResult>(apiClient.post(`/docs/documents/${documentId}/ocr/sync`))
}

export async function getDocumentResult(documentId: string): Promise<DocResultDetail> {
  return apiRequest<DocResultDetail>(apiClient.get(`/docs/documents/${documentId}/result`))
}

export async function retryProcessing(documentId: string, reason?: string): Promise<DocRetryResult> {
  return apiRequest<DocRetryResult>(apiClient.post(`/docs/documents/${documentId}/retry`, { reason: reason || 'manual_retry' }))
}

export async function setCurrentRevision(revisionId: string, reason?: string): Promise<{ document_id: string; current_revision_id: string }> {
  return apiRequest<{ document_id: string; current_revision_id: string }>(
    apiClient.post(`/docs/revisions/${revisionId}/set-current`, { reason: reason || 'manual' })
  )
}

export async function getDocumentPermissions(documentId: string): Promise<DocPermissions> {
  return apiRequest<DocPermissions>(apiClient.get(`/docs/documents/${documentId}/permissions`))
}

export async function getDiffStatus(revisionId: string): Promise<DocDiffStatus> {
  return apiRequest<DocDiffStatus>(apiClient.get(`/docs/revisions/${revisionId}/diff-status`))
}

export async function getContentTree(documentId: string, versionId: string): Promise<DocChunk[]> {
  return apiRequest<DocChunk[]>(apiClient.get(`/docs/documents/${documentId}/revisions/${versionId}/content-tree`))
}

export async function recall(params: DocRecallParams): Promise<DocRecallItem[]> {
  return apiRequest<DocRecallItem[]>(apiClient.post('/docs/recall', params))
}

export async function createCompareRun(data: {
  document_id: string
  base_version_id: string
  target_version_id: string
}): Promise<DocCompareRun> {
  return apiRequest<DocCompareRun>(apiClient.post('/docs/compare-runs', data))
}

export async function getCompareRun(runId: string): Promise<DocCompareRun> {
  return apiRequest<DocCompareRun>(apiClient.get(`/docs/compare-runs/${runId}`))
}

export async function setCurrentVersion(_documentId: string, versionId: string): Promise<void> {
  return apiRequest<void>(apiClient.post(`/docs/revisions/${versionId}/set-current`, { reason: 'manual' }))
}

export async function transitionVersion(_documentId: string, versionId: string, to_status: string): Promise<void> {
  return apiRequest<void>(apiClient.post(`/docs/revisions/${versionId}/transition`, { to_status }))
}

export async function extractOutline(revisionId: string): Promise<ExtractOutlineResult> {
  return apiRequest<ExtractOutlineResult>(apiClient.post(`/docs/revisions/${revisionId}/outline/extract`))
}

export async function generateChunks(revisionId: string): Promise<GenerateChunksResult> {
  return apiRequest<GenerateChunksResult>(apiClient.post(`/docs/revisions/${revisionId}/chunks/generate`))
}
