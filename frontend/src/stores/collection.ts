import { ref } from 'vue'
import { defineStore } from 'pinia'
import { uploadAttachmentFormData } from '@/api/attachment'
import { createDocIntake, submitOcr, importGatewayTask } from '@/api/docs'
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

  function getErrorMessage(cause: unknown, fallback: string) {
    return cause instanceof Error ? cause.message : fallback
  }

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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load collections')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load collection')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to create collection')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to update collection')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to delete collection')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load documents')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to add document')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to remove document')
      return false
    }
  }

  async function moveDocument(documentId: string, data: MoveDocumentRequest) {
    error.value = null
    try {
      const result = await moveDocumentToCollection(documentId, data)
      return result
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to move document')
      return null
    }
  }

  async function revectorize(id: string) {
    error.value = null
    try {
      const result = await revealectorizeCollection(id)
      return result
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to trigger revectorization')
      return null
    }
  }

  async function uploadDocumentToCollection(collectionId: string, file: File, options?: {
    app_id?: string
    schema_id?: string | null
    lang?: string
    image_analysis?: boolean
    formula_enable?: boolean
    table_enable?: boolean
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
        ...options?.lang !== undefined && { lang: options.lang },
        ...options?.image_analysis !== undefined && { image_analysis: options.image_analysis },
        ...options?.formula_enable !== undefined && { formula_enable: options.formula_enable },
        ...options?.table_enable !== undefined && { table_enable: options.table_enable },
      })

      await fetchCollectionDocuments(collectionId)
      await fetchCollection(collectionId)

      return { attachment, intake, submit }
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to upload document')
      return null
    } finally {
      isUploadingDocument.value = false
    }
  }

  async function importGatewayTaskToCollection(collectionId: string, taskId: string, title?: string) {
    isUploadingDocument.value = true
    error.value = null
    try {
      const result = await importGatewayTask({
        collection_id: collectionId,
        task_id: taskId,
        ...(title ? { title } : {}),
      })
      await fetchCollectionDocuments(collectionId)
      await fetchCollection(collectionId)
      return result
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to import gateway task')
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
    revectorize, uploadDocumentToCollection, importGatewayTaskToCollection,
  }
})
