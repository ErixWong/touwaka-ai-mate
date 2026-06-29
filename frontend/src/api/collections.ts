import apiClient, { apiRequest } from './client'
import type { DocDocument } from './docs'

export interface DocCollection {
  id: string
  name: string
  description: string | null
  owner_id: string
  created_by: string
  department_id: string
  visibility: 'private' | 'department' | 'public'
  department_scope: 'self' | 'self_and_descendants' | null
  embedding_model_id: string
  metadata: Record<string, unknown> | null
  doc_count?: number
  needs_revectorize?: boolean
  created_at: string
  updated_at: string
}

export interface CollectionListResult {
  items: DocCollection[]
  total: number
  page: number
  page_size: number
}

export interface CollectionDocumentItem {
  id: string
  title: string
  doc_type: string
  processing_status: string | null
  current_revision_id: string | null
  created_at: string
  updated_at: string
  current_revision: {
    id: string
    revision_no: number
    revision_label: string | null
  } | null
  source_attachment: {
    id: string
    file_name: string | null
    mime_type: string
    file_size: number
    created_at: string
  } | null
  ocr_status: string | null
  has_preview_result: boolean
  source_system?: string
  source_ref_id?: string
  owner_id?: string
  department_id?: string
  visibility?: string
  collection_id?: string | null
  current_version_id?: string | null
  ocr_task_id?: string | null
  processing_error_code?: string | null
  lifecycle_status?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export interface CollectionDocumentListResult {
  items: CollectionDocumentItem[]
  total: number
  page: number
  page_size: number
}

export { type DocDocument }

export interface CreateCollectionRequest {
  name: string
  description?: string
  visibility?: 'private' | 'department' | 'public'
  department_id?: string
  department_scope?: 'self' | 'self_and_descendants'
  embedding_model_id: string
  metadata?: Record<string, unknown>
}

export interface UpdateCollectionRequest {
  name?: string
  description?: string
  visibility?: 'private' | 'department' | 'public'
  department_id?: string
  department_scope?: 'self' | 'self_and_descendants'
  embedding_model_id?: string
  owner_id?: string
  metadata?: Record<string, unknown>
}

export interface CollectionActionResult {
  success?: boolean
  message?: string
  [key: string]: unknown
}

export interface MoveDocumentRequest {
  target_collection_id: string
  request_id?: string
}

export async function listCollections(params?: {
  page?: number
  size?: number
  query?: string
}): Promise<CollectionListResult> {
  return apiRequest<CollectionListResult>(apiClient.get('/docs/collections', { params }))
}

export async function getCollection(id: string): Promise<DocCollection> {
  return apiRequest<DocCollection>(apiClient.get(`/docs/collections/${id}`))
}

export async function createCollection(data: CreateCollectionRequest): Promise<DocCollection> {
  return apiRequest<DocCollection>(apiClient.post('/docs/collections', data))
}

export async function updateCollection(id: string, data: UpdateCollectionRequest): Promise<DocCollection> {
  return apiRequest<DocCollection>(apiClient.patch(`/docs/collections/${id}`, data))
}

export async function deleteCollection(id: string): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(apiClient.delete(`/docs/collections/${id}`))
}

export async function revealectorizeCollection(id: string): Promise<CollectionActionResult> {
  return apiRequest<CollectionActionResult>(apiClient.post(`/docs/collections/${id}/revectorize`))
}

export async function listCollectionDocuments(id: string, params?: {
  page?: number
  size?: number
  keyword?: string
  processing_status?: string
}): Promise<CollectionDocumentListResult> {
  return apiRequest<CollectionDocumentListResult>(apiClient.get(`/docs/collections/${id}/documents`, { params }))
}

export async function addDocumentToCollection(collectionId: string, documentId: string): Promise<CollectionActionResult> {
  return apiRequest<CollectionActionResult>(apiClient.post(`/docs/collections/${collectionId}/documents`, { document_id: documentId }))
}

export async function removeDocumentFromCollection(collectionId: string, documentId: string): Promise<CollectionActionResult> {
  return apiRequest<CollectionActionResult>(apiClient.delete(`/docs/collections/${collectionId}/documents/${documentId}`))
}

export async function moveDocumentToCollection(documentId: string, data: MoveDocumentRequest): Promise<CollectionActionResult> {
  return apiRequest<CollectionActionResult>(apiClient.post(`/docs/documents/${documentId}/move-collection`, data))
}
