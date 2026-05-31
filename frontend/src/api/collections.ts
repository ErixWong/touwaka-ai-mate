import apiClient, { apiRequest } from './client'

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
  metadata: any
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
  collection_id: string
  document_id: string
  document: {
    id: string
    title: string
    doc_type: string
    visibility: string
    lifecycle_status: string
    current_version_id: string | null
    created_at: string
    updated_at: string
  }
  created_at: string
}

export interface CollectionDocumentListResult {
  items: CollectionDocumentItem[]
  total: number
  page: number
  page_size: number
}

export interface CreateCollectionRequest {
  name: string
  description?: string
  visibility?: 'private' | 'department' | 'public'
  department_id?: string
  department_scope?: 'self' | 'self_and_descendants'
  embedding_model_id: string
  metadata?: any
}

export interface UpdateCollectionRequest {
  name?: string
  description?: string
  visibility?: 'private' | 'department' | 'public'
  department_id?: string
  department_scope?: 'self' | 'self_and_descendants'
  embedding_model_id?: string
  owner_id?: string
  metadata?: any
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

export async function revealectorizeCollection(id: string): Promise<any> {
  return apiRequest<any>(apiClient.post(`/docs/collections/${id}/revectorize`))
}

export async function listCollectionDocuments(id: string, params?: {
  page?: number
  size?: number
}): Promise<CollectionDocumentListResult> {
  return apiRequest<CollectionDocumentListResult>(apiClient.get(`/docs/collections/${id}/documents`, { params }))
}

export async function addDocumentToCollection(collectionId: string, documentId: string): Promise<any> {
  return apiRequest<any>(apiClient.post(`/docs/collections/${collectionId}/documents`, { document_id: documentId }))
}

export async function removeDocumentFromCollection(collectionId: string, documentId: string): Promise<any> {
  return apiRequest<any>(apiClient.delete(`/docs/collections/${collectionId}/documents/${documentId}`))
}

export async function moveDocumentToCollection(documentId: string, data: MoveDocumentRequest): Promise<any> {
  return apiRequest<any>(apiClient.post(`/docs/documents/${documentId}/move-collection`, data))
}
