import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  currentFeatureAnalyzerApi,
  type SessionFileItem,
  type RuleSetItem,
  type RuleSetDetail,
  type BatchStatus,
  type BatchSummary,
  type AppConfig,
  type FileAnalysisResult,
} from '../api/current-feature-analyzer'
import { APIError } from '@/api/client'
import { useCurrentFeatureAnalyzerPolling } from '../composables/useCurrentFeatureAnalyzerPolling'
import { normalizeApiError, enhanceApiError } from '../composables/useCurrentFeatureAnalyzerError'

type FileDetailData = Pick<SessionFileItem, 'raw_data' | 'result' | '_duplicate_diagnosis'>

export const useCurrentFeatureAnalyzerStore = defineStore('currentFeatureAnalyzer', () => {
  const batchId = ref<string | null>(null)
  const batchStatus = ref<BatchStatus>('idle')
  const selectedRuleSetId = ref<string | null>(null)
  const selectedRuleSetDetail = ref<RuleSetDetail | null>(null)
  const selectedFileId = ref<string | null>(null)
  const files = ref<SessionFileItem[]>([])
  const summary = ref<BatchSummary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const sessionExpired = ref(false)
  const ruleSets = ref<RuleSetItem[]>([])
  const appConfig = ref<AppConfig | null>(null)
  let pendingFileDetailId: string | null = null

  const fileDetailCache = ref<Map<string, FileDetailData>>(new Map())
  const fileDetailLoading = ref(false)

  function mergeFiles(incomingFiles: SessionFileItem[]) {
    const existingById = new Map(files.value.map(file => [file.file_id, file]))
    const mergedFiles = incomingFiles.map((incomingFile) => {
      const existingFile = existingById.get(incomingFile.file_id)
      if (!existingFile) {
        return incomingFile
      }

      Object.assign(existingFile, incomingFile)
      return existingFile
    })

    files.value.splice(0, files.value.length, ...mergedFiles)
  }

  const { startPolling, stopPolling } = useCurrentFeatureAnalyzerPolling(
    batchId,
    batchStatus,
    files,
    summary,
    loading,
    {
      onSessionExpired: () => {
        clearSessionState()
        sessionExpired.value = true
      },
      onError: (message) => {
        setError(message)
      },
      mergeFiles,
    }
  )

  const currentFile = computed(() => {
    return files.value.find(f => f.file_id === selectedFileId.value) || null
  })

  const fileStats = computed(() => {
    const completed = files.value.filter(f => f.analysis_status === 'completed')
    const failed = files.value.filter(f => f.analysis_status === 'failed')
    return {
      total: files.value.length,
      completed: completed.length,
      failed: failed.length,
      warning_count: completed.filter(f => f.warning_count > 0).length,
      analyzing: files.value.filter(f => f.analysis_status === 'analyzing').length,
      pending: files.value.filter(f => ['pending', 'parsing', 'ready'].includes(f.analysis_status)).length,
    }
  })

  function setError(msg: string) {
    error.value = msg
    setTimeout(() => { error.value = null }, 5000)
  }

  function clearSessionState() {
    stopPolling()
    batchId.value = null
    batchStatus.value = 'idle'
    selectedFileId.value = null
    selectedRuleSetDetail.value = null
    files.value = []
    fileDetailCache.value.clear()
    pendingFileDetailId = null
    summary.value = null
    loading.value = false
    error.value = null
  }

  function hasActiveSession() {
    return batchStatus.value !== 'idle' || files.value.length > 0 || !!batchId.value
  }

  async function launchAnalysisTask(fileList: File[], ruleSetId: string, overwriteCurrentSession = true) {
    if (overwriteCurrentSession && hasActiveSession()) {
      clearSessionState()
      sessionExpired.value = false
    }

    await uploadFiles(fileList, ruleSetId)

    if (batchId.value && selectedRuleSetId.value) {
      await runAnalysis()
    }
  }

  async function uploadFiles(fileList: File[], ruleSetId?: string) {
    loading.value = true
    batchStatus.value = 'uploading'
    error.value = null
    sessionExpired.value = false
    try {
      const batch = await currentFeatureAnalyzerApi.upload(fileList, ruleSetId)
      batchId.value = batch.batch_id
      batchStatus.value = batch.batch_status || 'ready'
      mergeFiles(batch.files || [])
      selectedRuleSetId.value = batch.selected_rule_set_id || ruleSetId || null
      if (files.value.length > 0) {
        const firstOk = files.value.find(f => f.analysis_status !== 'failed')
        const fallbackFile = files.value[0]
        if (!fallbackFile) return
        selectedFileId.value = firstOk ? firstOk.file_id : fallbackFile.file_id
        if (selectedFileId.value && batchId.value) {
          loadFileDetail(batchId.value, selectedFileId.value)
        }
      }
      const failedCount = files.value.filter(f => f.analysis_status === 'failed').length
      if (failedCount > 0) {
        const successCount = files.value.length - failedCount
        if (successCount === 0) {
          setError(`所有文件解析失败，共 ${failedCount} 个`)
        } else {
          setError(`${failedCount} 个文件解析失败，${successCount} 个成功`)
        }
      }
    } catch (err: unknown) {
      const msg = enhanceApiError(err, {})
      setError(msg)
      batchStatus.value = 'idle'
    } finally {
      loading.value = false
    }
  }

  async function loadRuleSets() {
    try {
      const res = await currentFeatureAnalyzerApi.listRuleSets()
      ruleSets.value = res.items || []
      if (!selectedRuleSetId.value) {
        const def = ruleSets.value.find(r => r.is_default && r.is_enabled)
        if (def) {
          selectedRuleSetId.value = def.id
          try {
            selectedRuleSetDetail.value = await currentFeatureAnalyzerApi.getRuleSet(def.id)
          } catch {
          }
        }
      }
    } catch {
    }
  }

  async function selectRuleSet(id: string) {
    selectedRuleSetId.value = id
    selectedRuleSetDetail.value = null
    try {
      selectedRuleSetDetail.value = await currentFeatureAnalyzerApi.getRuleSet(id)
    } catch {
    }
  }

  function selectFile(id: string) {
    selectedFileId.value = id
    if (id && batchId.value) {
      loadFileDetail(batchId.value, id)
    }
  }

  async function loadFileDetail(bid: string, fid: string, forceRefresh = false) {
    if (!forceRefresh && fileDetailCache.value.has(fid)) return
    if (fileDetailLoading.value) {
      pendingFileDetailId = fid
      return
    }
    fileDetailLoading.value = true
    pendingFileDetailId = null
    try {
      const detail = await currentFeatureAnalyzerApi.getFileDetail(bid, fid)
      const targetFile = files.value.find(file => file.file_id === fid)
      fileDetailCache.value.set(fid, {
        raw_data: detail.raw_data,
        result: detail.result,
        _duplicate_diagnosis: detail._duplicate_diagnosis,
      })
      if (targetFile) {
        Object.assign(targetFile, {
          raw_data: detail.raw_data,
          result: detail.result,
          _duplicate_diagnosis: detail._duplicate_diagnosis,
        })
      }
    } catch {
    } finally {
      fileDetailLoading.value = false
      const nextFileId = pendingFileDetailId
      pendingFileDetailId = null
      if (nextFileId && nextFileId !== fid && batchId.value && selectedFileId.value === nextFileId) {
        loadFileDetail(batchId.value, nextFileId)
      }
    }
  }

  watch(
    () => {
      const f = files.value.find(x => x.file_id === selectedFileId.value)
      return f?.analysis_status ?? null
    },
    (newStatus, oldStatus) => {
      if (newStatus && newStatus !== oldStatus && batchId.value && selectedFileId.value) {
        fileDetailCache.value.delete(selectedFileId.value)
        const targetFile = files.value.find(file => file.file_id === selectedFileId.value)
        if (targetFile) {
          delete targetFile.raw_data
          targetFile.result = null
          targetFile._duplicate_diagnosis = null
        }
        loadFileDetail(batchId.value, selectedFileId.value, true)
      }
    }
  )

  function jumpToFirstFailed() {
    const first = files.value.find(f => f.analysis_status === 'failed')
    if (first) selectFile(first.file_id)
  }

  function jumpToFirstWarning() {
    const first = files.value.find(f => f.analysis_status === 'completed' && f.warning_count > 0)
    if (first) selectFile(first.file_id)
  }

  async function runAnalysis() {
    if (!batchId.value || !selectedRuleSetId.value) {
      setError('请先选择规则集')
      return
    }
    loading.value = true
    batchStatus.value = 'analyzing'
    error.value = null
    sessionExpired.value = false
    try {
      const batch = await currentFeatureAnalyzerApi.runAnalysis(batchId.value, selectedRuleSetId.value)
      mergeFiles(batch.files || [])
      batchStatus.value = batch.batch_status || 'analyzing'
      summary.value = batch.summary

      if (files.value.length > 0 && !selectedFileId.value) {
        const first = files.value.find(f => f.analysis_status !== 'failed')
        const fallbackFile = files.value[0]
        if (!fallbackFile) return
        selectedFileId.value = first?.file_id || fallbackFile.file_id
        if (selectedFileId.value && batchId.value) {
          loadFileDetail(batchId.value, selectedFileId.value)
        }
      }

      if (batchStatus.value === 'analyzing') {
        startPolling()
      } else {
        loading.value = false
      }
    } catch (err: unknown) {
      stopPolling()
      const msg = enhanceApiError(err, { batchId: batchId.value })

      if (err instanceof APIError && err.status === 404 && batchId.value) {
        clearSessionState()
        sessionExpired.value = true
      }
      setError(msg)
      batchStatus.value = 'failed'
      loading.value = false
    }
  }

  async function exportReport() {
    if (!batchId.value) {
      setError('没有可导出的批次')
      return
    }
    const completedCount = files.value.filter(f => f.analysis_status === 'completed').length
    if (completedCount === 0) {
      setError('没有成功分析的文件，无法导出')
      return
    }
    try {
      const response = await currentFeatureAnalyzerApi.exportReport(batchId.value)
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `current-feature-analysis-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      const msg = normalizeApiError(err, '导出失败')
      setError(`导出失败: ${msg}`)
    }
  }

  async function loadConfig() {
    try {
      const config = await currentFeatureAnalyzerApi.getConfig()
      appConfig.value = config
    } catch {
    }
  }

  function reset() {
    clearSessionState()
    sessionExpired.value = false
  }

  return {
    batchId,
    batchStatus,
    selectedRuleSetId,
    selectedRuleSetDetail,
    selectedFileId,
    files,
    summary,
    loading,
    error,
    sessionExpired,
    ruleSets,
    appConfig,
    currentFile,
    fileStats,
    hasActiveSession,
    uploadFiles,
    launchAnalysisTask,
    loadRuleSets,
    selectRuleSet,
    selectFile,
    jumpToFirstFailed,
    jumpToFirstWarning,
    runAnalysis,
    stopPolling,
    exportReport,
    loadConfig,
    reset,
  }
})
