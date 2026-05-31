import apiClient, { apiRequest } from './client'

export interface DocDocument {
  id: string
  doc_type: 'knowledge' | 'contract' | 'department_doc' | 'standard'
  source_system: string
  source_ref_id: string
  title: string
  owner_id: string
  org_id: string
  visibility: 'private' | 'org' | 'public'
  current_version_id: string | null
  lifecycle_status: string
  metadata: any
  created_at: string
  updated_at: string
}

export interface DocVersion {
  id: string
  document_id: string
  version_no: number
  version_label: string | null
  version_status: 'draft' | 'review' | 'approved' | 'effective' | 'expired' | 'archived'
  is_current: number | boolean
  change_summary: string | null
  created_by: string
  approved_by: string | null
  approved_at: string | null
  effective_from: string | null
  effective_to: string | null
  published_at: string | null
  metadata: any
  created_at: string
  updated_at: string
}

export interface DocContentUnit {
  id: string
  version_id: string
  parent_id: string | null
  unit_type: string
  title: string | null
  content: string | null
  position: number
  level: number
  path: string | null
  token_count: number | null
  children?: DocContentUnit[]
}

export interface DocRecallParams {
  query: string
  scope?: 'all' | 'knowledge' | 'contract' | 'department' | 'standard'
  doc_types?: string[]
  top_k?: number
  threshold?: number
}

export interface DocRecallItem {
  score: number
  content_unit: {
    id: string
    title: string
    content: string
    unit_type: string
  }
  version: {
    id: string
    version_no: number
    version_label: string
    status: string
  }
  document: {
    id: string
    title: string
    doc_type: string
  }
}

export interface DocCompareRun {
  id: string
  document_id: string
  base_version_id: string
  target_version_id: string
  status: string
  summary_json: any
  model_info: any
  duration_ms: number
  created_by: string
  created_at: string
}

export interface DocListResult {
  items: DocDocument[]
  total: number
  page: number
  page_size: number
}

export async function listDocuments(params?: {
  doc_type?: string
  page?: number
  size?: number
}): Promise<DocListResult> {
  return apiRequest<DocListResult>(apiClient.get('/docs', { params }))
}

export async function getDocument(documentId: string): Promise<DocDocument> {
  return apiRequest<DocDocument>(apiClient.get(`/docs/${documentId}`))
}

export async function listVersions(documentId: string): Promise<DocVersion[]> {
  return apiRequest<DocVersion[]>(apiClient.get(`/docs/${documentId}/versions`))
}

export async function getContentTree(documentId: string, versionId: string): Promise<DocContentUnit[]> {
  return apiRequest<DocContentUnit[]>(apiClient.get(`/docs/${documentId}/versions/${versionId}/content-tree`))
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

export async function setCurrentVersion(documentId: string, versionId: string): Promise<void> {
  return apiRequest<void>(apiClient.post(`/docs/${documentId}/versions/${versionId}/set-current`))
}

export async function transitionVersion(documentId: string, versionId: string, to_status: string): Promise<void> {
  return apiRequest<void>(apiClient.post(`/docs/${documentId}/versions/${versionId}/transition`, { to_status }))
}
