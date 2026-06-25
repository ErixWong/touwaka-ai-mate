import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { currentFeatureAnalyzerApi, type BatchSession, type SessionFileItem, type RuleSetItem, type RuleSetDetail, type BatchStatus } from '@/api/current-feature-analyzer'

export const useCurrentFeatureAnalyzerStore = defineStore('currentFeatureAnalyzer', () => {
  const batchId = ref<string | null>(null)
  const batchStatus = ref<BatchStatus>('idle')
  const selectedRuleSetId = ref<string | null>(null)
  const selectedRuleSetDetail = ref<RuleSetDetail | null>(null)
  const selectedFileId = ref<string | null>(null)
  const files = ref<SessionFileItem[]>([])
  const summary = ref<any>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const sessionExpired = ref(false)
  const ruleSets = ref<RuleSetItem[]>([])
  const appConfig = ref<any>(null)

  const currentFile = computed(() =>
    files.value.find(f => f.file_id === selectedFileId.value) || null
  )

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

  async function uploadFiles(fileList: File[], ruleSetId?: string) {
    loading.value = true
    batchStatus.value = 'uploading'
    error.value = null
    sessionExpired.value = false
    try {
      const batch = await currentFeatureAnalyzerApi.upload(fileList, ruleSetId)
      batchId.value = batch.batch_id
      batchStatus.value = batch.batch_status
      files.value = batch.files || []
      selectedRuleSetId.value = batch.selected_rule_set_id || ruleSetId || null
      const first_file = files.value[0]
      if (first_file) {
        selectedFileId.value = first_file.file_id
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '上传失败'
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
            // detail fetch optional
          }
        }
      }
    } catch {
      // noop
    }
  }

  async function selectRuleSet(id: string) {
    selectedRuleSetId.value = id
    selectedRuleSetDetail.value = null
    try {
      selectedRuleSetDetail.value = await currentFeatureAnalyzerApi.getRuleSet(id)
    } catch {
      // noop
    }
  }

  function selectFile(id: string) {
    selectedFileId.value = id
  }

  function jumpToFirstFailed() {
    const first = files.value.find(f => f.analysis_status === 'failed')
    if (first) selectedFileId.value = first.file_id
  }

  function jumpToFirstWarning() {
    const first = files.value.find(f => f.analysis_status === 'completed' && f.warning_count > 0)
    if (first) selectedFileId.value = first.file_id
  }

  async function runAnalysis() {
    if (!batchId.value || !selectedRuleSetId.value) return
    loading.value = true
    batchStatus.value = 'analyzing'
    error.value = null
    sessionExpired.value = false
    try {
      const batch = await currentFeatureAnalyzerApi.runAnalysis(batchId.value, selectedRuleSetId.value)
      batchStatus.value = batch.batch_status
      files.value = batch.files || []
      summary.value = batch.summary
      const first_file = files.value[0]
      if (first_file && !selectedFileId.value) {
        selectedFileId.value = first_file.file_id
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '分析失败'
      if (err?.response?.status === 404 && batchId.value) {
        sessionExpired.value = true
        reset()
      }
      setError(msg)
      batchStatus.value = 'failed'
    } finally {
      loading.value = false
    }
  }

  async function exportReport() {
    if (!batchId.value) return
    try {
      const response = await currentFeatureAnalyzerApi.exportReport(batchId.value)
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `current-feature-analysis-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError('导出失败')
    }
  }

  async function loadConfig() {
    try {
      const config = await currentFeatureAnalyzerApi.getConfig()
      appConfig.value = config
    } catch {
      // noop
    }
  }

  function reset() {
    batchId.value = null
    batchStatus.value = 'idle'
    selectedFileId.value = null
    selectedRuleSetDetail.value = null
    files.value = []
    summary.value = null
    error.value = null
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
    uploadFiles,
    loadRuleSets,
    selectRuleSet,
    selectFile,
    jumpToFirstFailed,
    jumpToFirstWarning,
    runAnalysis,
    exportReport,
    loadConfig,
    reset,
  }
})
