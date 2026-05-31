import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  listDocuments,
  getDocument,
  listVersions,
  getContentTree,
  recall,
  setCurrentVersion,
  transitionVersion
} from '@/api/docs'
import type {
  DocDocument,
  DocVersion,
  DocContentUnit,
  DocRecallItem,
  DocListResult
} from '@/api/docs'

export const useDocStore = defineStore('doc', () => {
  const documents = ref<DocDocument[]>([])
  const total = ref(0)
  const currentPage = ref(1)
  const pageSize = ref(20)

  const currentDoc = ref<DocDocument | null>(null)
  const versions = ref<DocVersion[]>([])
  const contentTree = ref<DocContentUnit[]>([])
  const recallResults = ref<DocRecallItem[]>([])

  const isLoading = ref(false)
  const error = ref<string | null>(null)

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

  return {
    documents,
    total,
    currentPage,
    pageSize,
    currentDoc,
    versions,
    contentTree,
    recallResults,
    isLoading,
    error,
    fetchDocuments,
    fetchDocument,
    fetchVersions,
    fetchContentTree,
    docRecall,
    setCurrent,
    transition,
  }
})
