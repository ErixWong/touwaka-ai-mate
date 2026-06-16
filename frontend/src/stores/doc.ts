import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  listDocuments,
  getDocument,
  listVersions,
  getContentTree,
  recall,
  getDocumentResult,
  getProcessingStatus,
  syncOcr,
  deleteDocument,
  setCurrentVersion,
  transitionVersion,
  extractOutline,
  generateChunks,
} from '@/api/docs'
import type {
  DocDocument,
  DocVersion,
  DocChunk,
  DocRecallItem,
  DocListResult,
  DocResultDetail,
  DocProcessingStatus,
  ExtractOutlineResult,
  GenerateChunksResult,
} from '@/api/docs'

export const useDocStore = defineStore('doc', () => {
  const documents = ref<DocDocument[]>([])
  const total = ref(0)
  const currentPage = ref(1)
  const pageSize = ref(20)

  const currentDoc = ref<DocDocument | null>(null)
  const currentResult = ref<DocResultDetail | null>(null)
  const processingStatus = ref<DocProcessingStatus | null>(null)
  const versions = ref<DocVersion[]>([])
  const contentTree = ref<DocChunk[]>([])
  const recallResults = ref<DocRecallItem[]>([])
  const isPolling = ref(false)
  let pollingTimer: number | null = null

  const isLoading = ref(false)
  const error = ref<string | null>(null)

  function shouldStopPollingForError(err: any) {
    const status = err?.response?.status
    const message = String(err?.response?.data?.message || err?.message || '').toLowerCase()
    return status === 403
      || status === 404
      || message.includes('write access denied')
      || message.includes('document not found')
      || message.includes('access denied')
  }

  async function fetchDocuments(params?: { doc_type?: string; page?: number }) {
    isLoading.value = true
    error.value = null
    try {
      const result: DocListResult = await listDocuments({
        doc_type: params?.doc_type,
        page: params?.page ?? currentPage.value,
        size: pageSize.value,
      })
      documents.value = result.items
      total.value = result.total
      if (params?.page) currentPage.value = params.page
    } catch (e: any) {
      error.value = e.message || 'Failed to load documents'
    } finally {
      isLoading.value = false
    }
  }

  async function fetchDocument(documentId: string) {
    isLoading.value = true
    error.value = null
    try {
      currentDoc.value = await getDocument(documentId)
      return currentDoc.value
    } catch (e: any) {
      error.value = e.message || 'Failed to load document'
      return null
    } finally {
      isLoading.value = false
    }
  }

  async function fetchDocumentResult(documentId: string) {
    isLoading.value = true
    error.value = null
    try {
      currentResult.value = await getDocumentResult(documentId)
      return currentResult.value
    } catch (e: any) {
      error.value = e.message || 'Failed to load document result'
      return null
    } finally {
      isLoading.value = false
    }
  }

  async function fetchProcessing(documentId: string) {
    error.value = null
    try {
      processingStatus.value = await getProcessingStatus(documentId)
      return processingStatus.value
    } catch (e: any) {
      error.value = e.message || 'Failed to load processing status'
      return null
    }
  }

  async function syncProcessing(documentId: string) {
    error.value = null
    const status = processingStatus.value?.processing_status
    const isOcrStage = status === 'pending_ocr' || status === 'ocr_processing'
    if (isOcrStage || !processingStatus.value) {
      try {
        await syncOcr(documentId)
      } catch (e: any) {
        if (isOcrStage) {
          error.value = e.message || 'Failed to sync OCR status'
          if (shouldStopPollingForError(e)) {
            stopPolling()
          }
          return null
        }
      }
    }
    try {
      return await fetchProcessing(documentId)
    } catch (e: any) {
      error.value = e.message || 'Failed to load processing status'
      if (shouldStopPollingForError(e)) {
        stopPolling()
      }
      return null
    }
  }

  function stopPolling() {
    isPolling.value = false
    if (pollingTimer) {
      window.clearTimeout(pollingTimer)
      pollingTimer = null
    }
  }

  async function startPolling(documentId: string, intervalMs = 5000) {
    stopPolling()
    isPolling.value = true

    const tick = async () => {
      if (!isPolling.value) return
      const result = await syncProcessing(documentId)
      if (!isPolling.value) return
      await fetchDocumentResult(documentId)

      if (!isPolling.value) return

      if (!result && error.value) {
        stopPolling()
        return
      }

      const status = result?.processing_status
      const terminal = !status || status === 'ready' || status === 'error' || status === 'pending_embedding'
      if (terminal) {
        stopPolling()
        if (currentResult.value?.revision?.id && currentDoc.value?.id) {
          await fetchContentTree(currentDoc.value.id, currentResult.value.revision.id)
        }
        return
      }

      pollingTimer = window.setTimeout(tick, intervalMs)
    }

    await tick()
  }

  async function fetchVersions(documentId: string) {
    isLoading.value = true
    error.value = null
    try {
      versions.value = await listVersions(documentId)
    } catch (e: any) {
      error.value = e.message || 'Failed to load versions'
    } finally {
      isLoading.value = false
    }
  }

  async function fetchContentTree(documentId: string, versionId: string) {
    isLoading.value = true
    error.value = null
    try {
      contentTree.value = await getContentTree(documentId, versionId)
    } catch (e: any) {
      error.value = e.message || 'Failed to load content tree'
    } finally {
      isLoading.value = false
    }
  }

  async function docRecall(params: Parameters<typeof recall>[0]) {
    isLoading.value = true
    error.value = null
    try {
      recallResults.value = await recall(params)
      return recallResults.value
    } catch (e: any) {
      error.value = e.message || 'Recall failed'
      return []
    } finally {
      isLoading.value = false
    }
  }

  async function setCurrent(documentId: string, versionId: string) {
    error.value = null
    try {
      await setCurrentVersion(documentId, versionId)
      await fetchVersions(documentId)
      await fetchDocument(documentId)
    } catch (e: any) {
      error.value = e.message || 'Failed to set current version'
    }
  }

  async function transition(documentId: string, versionId: string, toStatus: string) {
    error.value = null
    try {
      await transitionVersion(documentId, versionId, toStatus)
      await fetchVersions(documentId)
    } catch (e: any) {
      error.value = e.message || 'Failed to transition version'
    }
  }

  async function extractOutlineAction(revisionId: string): Promise<ExtractOutlineResult | null> {
    error.value = null
    try {
      const result = await extractOutline(revisionId)
      if (currentDoc.value) {
        await fetchProcessing(currentDoc.value.id)
        await fetchDocumentResult(currentDoc.value.id)
      }
      return result
    } catch (e: any) {
      error.value = e.message || 'Failed to extract outline'
      return null
    }
  }

  async function generateChunksAction(revisionId: string): Promise<GenerateChunksResult | null> {
    error.value = null
    try {
      const result = await generateChunks(revisionId)
      if (currentDoc.value) {
        await fetchProcessing(currentDoc.value.id)
        await fetchDocumentResult(currentDoc.value.id)
        if (currentResult.value) {
          await fetchContentTree(currentDoc.value.id, revisionId)
        }
      }
      return result
    } catch (e: any) {
      error.value = e.message || 'Failed to generate chunks'
      return null
    }
  }

  async function removeDocument(documentId: string) {
    error.value = null
    try {
      stopPolling()
      await deleteDocument(documentId)
      documents.value = documents.value.filter(item => item.id !== documentId)
      total.value = Math.max(0, total.value - 1)
      if (currentDoc.value?.id === documentId) currentDoc.value = null
      if (currentResult.value?.document?.id === documentId) currentResult.value = null
      if (processingStatus.value?.document_id === documentId) processingStatus.value = null
      return true
    } catch (e: any) {
      error.value = e.message || 'Failed to delete document'
      return false
    }
  }

  return {
    documents,
    total,
    currentPage,
    pageSize,
    currentDoc,
    currentResult,
    processingStatus,
    versions,
    contentTree,
    recallResults,
    isLoading,
    isPolling,
    error,
    fetchDocuments,
    fetchDocument,
    fetchDocumentResult,
    fetchProcessing,
    syncProcessing,
    startPolling,
    stopPolling,
    fetchVersions,
    fetchContentTree,
    docRecall,
    setCurrent,
    transition,
    removeDocument,
    extractOutlineAction,
    generateChunksAction,
  }
})
