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
  retryProcessing,
  setCurrentVersion,
  transitionVersion,
  deleteRevision,
  extractOutline,
  generateChunks,
  isOcrActiveDocProcessingStatus,
  isTerminalDocProcessingStatus,
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
  const previewRevisionId = ref<string | null>(null)
  const isPolling = ref(false)
  let pollingTimer: number | null = null

  const isLoading = ref(false)
  const error = ref<string | null>(null)

  function getErrorMessage(cause: unknown, fallback: string) {
    return cause instanceof Error ? cause.message : fallback
  }

  function getErrorStatus(cause: unknown) {
    return typeof cause === 'object' && cause !== null && 'status' in cause
      ? Reflect.get(cause, 'status')
      : undefined
  }

  function shouldStopPollingForError(err: unknown) {
    const status = getErrorStatus(err)
    const message = String(causeToMessage(err)).toLowerCase()
    return status === 403
      || status === 404
      || message.includes('write access denied')
      || message.includes('document not found')
      || message.includes('access denied')
  }

  function causeToMessage(cause: unknown) {
    return cause instanceof Error ? cause.message : ''
  }

  function buildFallbackVersionFromResult(): DocVersion[] {
    const revision = currentResult.value?.revision
    if (!revision) return []
    return [{
      id: revision.id,
      revision_no: revision.revision_no,
      revision_label: revision.revision_label,
      revision_status: revision.revision_status,
      is_current: true,
      diff_status: null,
      created_by: revision.created_by,
      effective_from: null,
      effective_to: null,
      created_at: revision.created_at,
      updated_at: revision.created_at,
    }]
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load documents')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load document')
      return null
    } finally {
      isLoading.value = false
    }
  }

  async function fetchDocumentResult(documentId: string, revisionId?: string) {
    isLoading.value = true
    error.value = null
    try {
      currentResult.value = await getDocumentResult(documentId, revisionId ?? previewRevisionId.value ?? undefined)
      return currentResult.value
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load document result')
      return null
    } finally {
      isLoading.value = false
    }
  }

  async function previewVersion(documentId: string, revisionId: string | null) {
    previewRevisionId.value = revisionId
    const result = await fetchDocumentResult(documentId)
    if (!result) {
      previewRevisionId.value = null
      return null
    }
    if (result.revision?.id) {
      await fetchContentTree(documentId, result.revision.id)
    } else {
      contentTree.value = []
    }
    return result
  }

  async function fetchProcessing(documentId: string) {
    error.value = null
    try {
      processingStatus.value = await getProcessingStatus(documentId)
      return processingStatus.value
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load processing status')
      return null
    }
  }

  async function syncProcessing(documentId: string) {
    error.value = null
    const latestProcessing = await fetchProcessing(documentId)
    if (!latestProcessing) {
      return null
    }

    const status = latestProcessing.processing_status
    const isOcrStage = isOcrActiveDocProcessingStatus(status)
    if (isOcrStage) {
      try {
        await syncOcr(documentId)
      } catch (e: unknown) {
        error.value = getErrorMessage(e, 'Failed to sync OCR status')
        if (shouldStopPollingForError(e)) {
          stopPolling()
        }
        return null
      }
    }
    try {
      return await fetchProcessing(documentId)
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load processing status')
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
      const terminal = isTerminalDocProcessingStatus(status)
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
      const items = await listVersions(documentId)
      versions.value = items.length > 0 ? items : buildFallbackVersionFromResult()
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load versions')
      versions.value = buildFallbackVersionFromResult()
    } finally {
      isLoading.value = false
    }
  }

  async function fetchContentTree(documentId: string, versionId: string) {
    isLoading.value = true
    error.value = null
    try {
      contentTree.value = await getContentTree(documentId, versionId)
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to load content tree')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Recall failed')
      return []
    } finally {
      isLoading.value = false
    }
  }

  async function setCurrent(documentId: string, versionId: string) {
    error.value = null
    try {
      await setCurrentVersion(documentId, versionId)
      previewRevisionId.value = null
      await fetchVersions(documentId)
      await fetchDocument(documentId)
      await fetchDocumentResult(documentId)
      return true
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to set current version')
      return false
    }
  }

  async function removeRevision(documentId: string, revisionId: string) {
    error.value = null
    try {
      await deleteRevision(revisionId)
      if (previewRevisionId.value === revisionId) {
        previewRevisionId.value = null
        await fetchDocumentResult(documentId)
      }
      await fetchVersions(documentId)
      return true
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to delete version')
      return false
    }
  }

  async function transition(documentId: string, versionId: string, toStatus: string) {
    error.value = null
    try {
      await transitionVersion(documentId, versionId, toStatus)
      await fetchVersions(documentId)
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to transition version')
    }
  }

  async function extractOutlineAction(revisionId: string): Promise<ExtractOutlineResult | null> {
    error.value = null
    try {
      const result = await extractOutline(revisionId)
      if (currentDoc.value) {
        await fetchProcessing(currentDoc.value.id)
        // 受理成功后立即启动轮询，持续观察状态变化
        startPolling(currentDoc.value.id)
      }
      return result
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to extract outline')
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
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to generate chunks')
      return null
    }
  }

  async function retryProcessingAction(documentId: string) {
    error.value = null
    try {
      const result = await retryProcessing(documentId)
      await fetchProcessing(documentId)
      await fetchDocumentResult(documentId)
      return result
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to retry processing')
      return null
    }
  }

  async function removeDocument(documentId: string) {
    error.value = null
    try {
      stopPolling()
      await deleteDocument(documentId)
      previewRevisionId.value = null
      documents.value = documents.value.filter(item => item.id !== documentId)
      total.value = Math.max(0, total.value - 1)
      if (currentDoc.value?.id === documentId) currentDoc.value = null
      if (currentResult.value?.document?.id === documentId) currentResult.value = null
      if (processingStatus.value?.document_id === documentId) processingStatus.value = null
      return true
    } catch (e: unknown) {
      error.value = getErrorMessage(e, 'Failed to delete document')
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
    previewRevisionId,
    isLoading,
    isPolling,
    error,
    fetchDocuments,
    fetchDocument,
    fetchDocumentResult,
    previewVersion,
    fetchProcessing,
    syncProcessing,
    startPolling,
    stopPolling,
    fetchVersions,
    fetchContentTree,
    docRecall,
    setCurrent,
    removeRevision,
    transition,
    removeDocument,
    extractOutlineAction,
    generateChunksAction,
    retryProcessingAction,
  }
})
