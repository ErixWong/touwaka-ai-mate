import { defineStore } from 'pinia'
import { ref, computed, watch, nextTick } from 'vue'
import {
  currentFeatureAnalyzerApi,
  type SessionFileItem,
  type RuleSetItem,
  type RuleSetDetail,
  type BatchStatus,
  type BatchSummary,
  type AppConfig,
  type CompressionAlgorithmKey,
  type FileAnalysisResult,
  type FileAnalysisSubmitItem,
} from '../api/current-feature-analyzer'
import { APIError } from '@/api/client'
import { normalizeApiError, enhanceApiError } from '../composables/useCurrentFeatureAnalyzerError'
import { runLocalCurrentFeatureAnalysis } from '../utils/local-analysis'
import { runLocalCurrentFeatureAnalysisAsync } from '../utils/local-analysis-worker'

type FileDetailData = Pick<SessionFileItem, 'raw_data' | 'result' | '_duplicate_diagnosis'>

function yieldToMainThread() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

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
  const selectedCompressionAlgorithm = ref<CompressionAlgorithmKey>('adaptive_v2')
  const analysisTransitionVisible = ref(false)
  const analysisTransitionStage = ref<'syncing' | 'compressing' | 'recognizing'>('syncing')
  let scheduledAnalysisToken = 0
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
      analyzing: files.value.filter(f => ['compressing', 'llm_recognizing', 'analyzing'].includes(f.analysis_status)).length,
      pending: files.value.filter(f => ['pending', 'ready'].includes(f.analysis_status)).length,
    }
  })

  function setError(msg: string) {
    error.value = msg
    setTimeout(() => { error.value = null }, 5000)
  }

  function logError(scope: string, err: unknown, extra?: Record<string, unknown>) {
    console.error(`[current-feature-analyzer] ${scope}`, {
      error: err,
      ...extra,
    })
  }

  function clearSessionState() {
    batchId.value = null
    batchStatus.value = 'idle'
    selectedFileId.value = null
    selectedRuleSetDetail.value = null
    files.value = []
    fileDetailCache.value.clear()
    pendingFileDetailId = null
    summary.value = null
    analysisTransitionVisible.value = false
    analysisTransitionStage.value = 'syncing'
    loading.value = false
    error.value = null
  }

  function hasActiveSession() {
    return batchStatus.value !== 'idle' || files.value.length > 0 || !!batchId.value
  }

  async function launchAnalysisTask(fileList: File[], ruleSetId: string, compressionAlgorithm: CompressionAlgorithmKey, overwriteCurrentSession = true) {
    const preservedRuleSetDetail = selectedRuleSetDetail.value
    const preservedRuleSetId = selectedRuleSetId.value
    if (overwriteCurrentSession && hasActiveSession()) {
      clearSessionState()
      sessionExpired.value = false
    }

    selectedRuleSetId.value = preservedRuleSetId || ruleSetId
    selectedRuleSetDetail.value = preservedRuleSetDetail
    selectedCompressionAlgorithm.value = compressionAlgorithm

    await uploadFiles(fileList, ruleSetId)

    if (batchId.value && selectedRuleSetId.value) {
      scheduleAnalysisStart()
    }
  }

  function scheduleAnalysisStart() {
    const token = ++scheduledAnalysisToken
    batchStatus.value = 'preparing_analysis'
    analysisTransitionVisible.value = true
    analysisTransitionStage.value = 'syncing'

    void (async () => {
      await nextTick()
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      })

      if (token !== scheduledAnalysisToken) {
        return
      }

      await runAnalysis()
    })()
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
      for (const file of batch.files || []) {
        if (file.raw_data?.length) {
          fileDetailCache.value.set(file.file_id, {
            raw_data: file.raw_data,
            result: file.result,
            _duplicate_diagnosis: file._duplicate_diagnosis,
          })
        }
      }
      selectedRuleSetId.value = batch.selected_rule_set_id || ruleSetId || null
      if (files.value.length > 0) {
        const firstOk = files.value.find(f => f.analysis_status !== 'failed')
        const fallbackFile = files.value[0]
        if (!fallbackFile) return
        selectedFileId.value = firstOk ? firstOk.file_id : fallbackFile.file_id
        if (selectedFileId.value && batchId.value) {
          void loadFileDetail(batchId.value, selectedFileId.value)
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
      logError('uploadFiles failed', err, { ruleSetId, fileCount: fileList.length })
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
        if (targetFile.raw_data !== detail.raw_data) targetFile.raw_data = detail.raw_data
        if (targetFile.result !== detail.result) targetFile.result = detail.result
        if (targetFile._duplicate_diagnosis !== detail._duplicate_diagnosis) targetFile._duplicate_diagnosis = detail._duplicate_diagnosis
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

  async function ensureRawDataLoaded(bid: string, fid: string) {
    const cachedDetail = fileDetailCache.value.get(fid)
    if (cachedDetail?.raw_data?.length) {
      return cachedDetail.raw_data
    }

    const detail = await currentFeatureAnalyzerApi.getFileDetail(bid, fid)
    if (!detail.raw_data?.length) {
      throw new Error('文件详情未返回原始数据')
    }
    const targetFile = files.value.find(file => file.file_id === fid)
    fileDetailCache.value.set(fid, {
      raw_data: detail.raw_data,
      result: detail.result,
      _duplicate_diagnosis: detail._duplicate_diagnosis,
    })
    if (targetFile) {
      if (targetFile.raw_data !== detail.raw_data) targetFile.raw_data = detail.raw_data
      if (targetFile.result !== detail.result) targetFile.result = detail.result
      if (targetFile._duplicate_diagnosis !== detail._duplicate_diagnosis) targetFile._duplicate_diagnosis = detail._duplicate_diagnosis
    }
    return detail.raw_data
  }

  async function preloadRawDataForAnalysis(bid: string) {
    const pendingFiles = files.value.filter(file => file.analysis_status !== 'failed' && !file.raw_data?.length)
    await Promise.all(pendingFiles.map(file => ensureRawDataLoaded(bid, file.file_id)))
  }

  watch(
    () => {
      const f = files.value.find(x => x.file_id === selectedFileId.value)
      return f?.analysis_status ?? null
    },
    (newStatus, oldStatus) => {
      if (
        newStatus &&
        newStatus !== oldStatus &&
        batchId.value &&
        selectedFileId.value &&
        ['completed', 'failed'].includes(newStatus)
      ) {
        const targetFile = files.value.find(file => file.file_id === selectedFileId.value)
        if (!targetFile) {
          return
        }

        if (targetFile.raw_data?.length && targetFile.result) {
          return
        }

        fileDetailCache.value.delete(selectedFileId.value)
        loadFileDetail(batchId.value, selectedFileId.value, true)
      }
    }
  )

  async function runAnalysis() {
    if (!batchId.value || !selectedRuleSetId.value) {
      setError('请先选择规则集')
      return
    }

    const currentBatchId = batchId.value
    const currentRuleSetId = selectedRuleSetId.value
    loading.value = true
    batchStatus.value = 'analyzing'
    analysisTransitionVisible.value = true
    analysisTransitionStage.value = 'compressing'
    error.value = null
    sessionExpired.value = false
    try {
      await preloadRawDataForAnalysis(currentBatchId)

      const fileResults: FileAnalysisSubmitItem[] = []

      for (const file of files.value) {
        if (file.analysis_status === 'failed') {
          fileResults.push({
            file_id: file.file_id,
            analysis_status: 'failed',
            error_message: file.error_message,
            warning_count: file.warning_count,
          })
          continue
        }

        try {
          await yieldToMainThread()
          const rawData = file.raw_data?.length ? file.raw_data : await ensureRawDataLoaded(currentBatchId, file.file_id)
          if (!rawData?.length) {
            file.analysis_status = 'failed'
            file.error_message = '文件原始数据缺失，无法在前端完成分析'
            fileResults.push({
              file_id: file.file_id,
              analysis_status: 'failed',
              error_message: file.error_message,
              warning_count: file.warning_count,
            })
            continue
          }

          file.analysis_status = 'compressing'
          analysisTransitionStage.value = 'compressing'
          if (selectedFileId.value === file.file_id) {
            await nextTick()
          }
          const localResult = await runLocalCurrentFeatureAnalysisAsync(rawData, appConfig.value, selectedCompressionAlgorithm.value)
          file.result = localResult
          file.warning_count = 0
          file.error_message = null
          file.analysis_status = 'llm_recognizing'
          analysisTransitionStage.value = 'recognizing'
          fileResults.push({
            file_id: file.file_id,
            analysis_status: 'completed',
            warning_count: 0,
            result: localResult,
          })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : '前端分析失败'
          logError('local analysis failed', err, { batchId: currentBatchId, fileId: file.file_id, fileName: file.file_name })
          file.analysis_status = 'failed'
          file.error_message = message
          fileResults.push({
            file_id: file.file_id,
            analysis_status: 'failed',
            error_message: message,
            warning_count: file.warning_count,
          })
        }
      }

      const taskResult = await currentFeatureAnalyzerApi.runAnalysis(currentBatchId, currentRuleSetId, fileResults)
      batchStatus.value = taskResult.batch_status || 'completed'
      if (taskResult.files?.length) {
        mergeFiles(taskResult.files)
      }
      if (taskResult.summary) {
        summary.value = taskResult.summary
      }
      analysisTransitionVisible.value = false
      if (selectedFileId.value && batchId.value) {
        await loadFileDetail(batchId.value, selectedFileId.value, true)
      }
    } catch (err: unknown) {
      const msg = enhanceApiError(err, { batchId: currentBatchId })
      logError('runAnalysis failed', err, { batchId: currentBatchId, ruleSetId: currentRuleSetId })

      if (err instanceof APIError && err.status === 404 && currentBatchId) {
        clearSessionState()
        sessionExpired.value = true
      }
      setError(msg)
      batchStatus.value = 'failed'
      analysisTransitionVisible.value = false
      for (const file of files.value) {
        if (file.analysis_status === 'llm_recognizing') {
          file.analysis_status = 'failed'
          file.error_message = msg
        }
      }
    } finally {
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
      const { exportCurrentFeatureAnalyzerReport } = await import('../utils/export-report')
      await exportCurrentFeatureAnalyzerReport({
        batchId: batchId.value,
        files: files.value,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : normalizeApiError(err, '导出失败')
      logError('exportReport failed', err, { batchId: batchId.value, fileCount: files.value.length })
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
    selectedCompressionAlgorithm,
    analysisTransitionVisible,
    analysisTransitionStage,
    currentFile,
    fileStats,
    hasActiveSession,
    uploadFiles,
    launchAnalysisTask,
    scheduleAnalysisStart,
    loadRuleSets,
    selectRuleSet,
    selectFile,
    runAnalysis,
    exportReport,
    loadConfig,
    reset,
  }
})
