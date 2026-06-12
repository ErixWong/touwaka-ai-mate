import { ref } from 'vue'
import { defineStore } from 'pinia'
import { uploadAttachmentFormData } from '@/api/attachment'
import { createDocIntake, submitOcr } from '@/api/docs'
import {
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  listCollectionDocuments,
  addDocumentToCollection,
  removeDocumentFromCollection,
  moveDocumentToCollection,
  revealectorizeCollection,
} from '@/api/collections'
import type {
  DocCollection,
  CollectionListResult,
  CollectionDocumentItem,
  CollectionDocumentListResult,
  CreateCollectionRequest,
  UpdateCollectionRequest,
  MoveDocumentRequest,
} from '@/api/collections'
import type { UploadAttachmentResponse } from '@/api/attachment'
import type { DocIntakeResult, SubmitOcrResult } from '@/api/docs'

export const useCollectionStore = defineStore('collection', () => {
  const collections = ref<DocCollection[]>([])
  const total = ref(0)
  const currentPage = ref(1)
  const pageSize = ref(20)

  const currentCollection = ref<DocCollection | null>(null)
  const collectionDocuments = ref<CollectionDocumentItem[]>([])
  const docTotal = ref(0)
  const docPage = ref(1)

  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const isUploadingDocument = ref(false)

  async function fetchCollections(params?: { page?: number; query?: string }) {
    isLoading.value = true
    error.value = null
    try {
      const result: CollectionListResult = await listCollections({
        page: params?.page ?? currentPage.value,
        size: pageSize.value,
        query: params?.query,
      })
      collections.value = result.items
      total.value = result.total
      if (params?.page) currentPage.value = params.page
    } catch (e: any) {
      error.value = e.message || 'Failed to load collections'
    } finally {
      isLoading.value = false
    }
  }

  async function fetchCollection(id: string) {
    isLoading.value = true
    error.value = null
    try {
      currentCollection.value = await getCollection(id)
      return currentCollection.value
    } catch (e: any) {
      error.value = e.message || 'Failed to load collection'
      return null
    } finally {
      isLoading.value = false
    }
  }

  async function addCollection(data: CreateCollectionRequest) {
    error.value = null
    try {
      const collection = await createCollection(data)
      collections.value.unshift(collection)
      total.value++
      return collection
    } catch (e: any) {
      error.value = e.message || 'Failed to create collection'
      return null
    }
  }

  async function editCollection(id: string, data: UpdateCollectionRequest) {
    error.value = null
    try {
      const collection = await updateCollection(id, data)
      if (currentCollection.value?.id === id) {
        currentCollection.value = collection
      }
      const idx = collections.value.findIndex(c => c.id === id)
      if (idx !== -1) {
        collections.value[idx] = collection
      }
      return collection
    } catch (e: any) {
      error.value = e.message || 'Failed to update collection'
      return null
    }
  }

  async function removeCollection(id: string) {
    error.value = null
    try {
      await deleteCollection(id)
      collections.value = collections.value.filter(c => c.id !== id)
      total.value--
      if (currentCollection.value?.id === id) {
        currentCollection.value = null
      }
      return true
    } catch (e: any) {
      error.value = e.message || 'Failed to delete collection'
      return false
    }
  }

  async function fetchCollectionDocuments(collectionId: string, params?: { page?: number; keyword?: string; processing_status?: string }) {
    isLoading.value = true
    error.value = null
    try {
      const result: CollectionDocumentListResult = await listCollectionDocuments(collectionId, {
        page: params?.page ?? docPage.value,
        size: pageSize.value,
        keyword: params?.keyword,
        processing_status: params?.processing_status,
      })
      collectionDocuments.value = result.items
      docTotal.value = result.total
      if (params?.page) docPage.value = params.page
    } catch (e: any) {
      error.value = e.message || 'Failed to load documents'
    } finally {
      isLoading.value = false
    }
  }

  async function addDocument(collectionId: string, documentId: string) {
    error.value = null
    try {
      const result = await addDocumentToCollection(collectionId, documentId)
      if (!result.existing) {
        await fetchCollectionDocuments(collectionId)
        await fetchCollection(collectionId)
      }
      return result
    } catch (e: any) {
      error.value = e.message || 'Failed to add document'
      return null
    }
  }

  async function removeDocument(collectionId: string, documentId: string) {
    error.value = null
    try {
      await removeDocumentFromCollection(collectionId, documentId)
      collectionDocuments.value = collectionDocuments.value.filter(d => d.id !== documentId)
      docTotal.value--
      return true
    } catch (e: any) {
      error.value = e.message || 'Failed to remove document'
      return false
    }
  }

  async function moveDocument(documentId: string, data: MoveDocumentRequest) {
    error.value = null
    try {
      const result = await moveDocumentToCollection(documentId, data)
      return result
    } catch (e: any) {
      error.value = e.message || 'Failed to move document'
      return null
    }
  }

  async function revectorize(id: string) {
    error.value = null
    try {
      const result = await revealectorizeCollection(id)
      return result
    } catch (e: any) {
      error.value = e.message || 'Failed to trigger revectorization'
      return null
    }
  }

  async function uploadDocumentToCollection(collectionId: string, file: File, options?: {
    app_id?: string
    schema_id?: string | null
    lang?: string
  }): Promise<{
    attachment: UploadAttachmentResponse
    intake: DocIntakeResult
    submit: SubmitOcrResult
  } | null> {
    isUploadingDocument.value = true
    error.value = null
    try {
      const attachment = await uploadAttachmentFormData({
        source_tag: 'doc-platform',
        source_id: 'temp',
        file,
      })

      const intake = await createDocIntake({
        app_id: options?.app_id || 'contract-mgr-v2',
        collection_id: collectionId,
        schema_id: options?.schema_id ?? null,
        attachments: [{ id: attachment.id }],
      })

      const submit = await submitOcr(intake.document_id, {
        attachment_id: attachment.id,
        lang: options?.lang || 'ch',
        image_analysis: true,
        formula_enable: true,
        table_enable: true,
      })

      await fetchCollectionDocuments(collectionId)
      await fetchCollection(collectionId)

      return { attachment, intake, submit }
    } catch (e: any) {
      error.value = e.message || 'Failed to upload document'
      return null
    } finally {
      isUploadingDocument.value = false
    }
  }

  return {
    collections, total, currentPage, pageSize,
    currentCollection,
    collectionDocuments, docTotal, docPage,
    isLoading, error, isUploadingDocument,
    fetchCollections, fetchCollection,
    addCollection, editCollection, removeCollection,
    fetchCollectionDocuments, addDocument, removeDocument, moveDocument,
    revectorize, uploadDocumentToCollection,
  }
})
