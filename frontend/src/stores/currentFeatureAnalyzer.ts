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
      batchStatus.value = batch.batch_status || 'ready'
      files.value = batch.files || []
      selectedRuleSetId.value = batch.selected_rule_set_id || ruleSetId || null
      if (files.value.length > 0) {
        // 自动选中第一个未失败的文件
        const firstOk = files.value.find(f => f.analysis_status !== 'failed')
        selectedFileId.value = firstOk ? firstOk.file_id : files.value[0].file_id
      }
      // 检查是否有解析失败的文件
      const failedCount = files.value.filter(f => f.analysis_status === 'failed').length
      if (failedCount > 0) {
        const successCount = files.value.length - failedCount
        if (successCount === 0) {
          setError(`所有文件解析失败，共 ${failedCount} 个`)
        } else {
          setError(`${failedCount} 个文件解析失败，${successCount} 个成功`)
        }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.data?.message || err?.message || '上传失败'
      if (err?.response?.status === 413) {
        setError('文件过大，请确保单个文件不超过 50MB')
      } else {
        setError(msg)
      }
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

  let pollingTimer: ReturnType<typeof setInterval> | null = null

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  function startPolling() {
    stopPolling()
    pollingTimer = setInterval(async () => {
      if (!batchId.value) { stopPolling(); return }
      if (batchStatus.value !== 'analyzing') { stopPolling(); return }
      try {
        const batch = await currentFeatureAnalyzerApi.getBatch(batchId.value)
        files.value = batch.files || []
        batchStatus.value = batch.batch_status || 'analyzing'
        summary.value = batch.summary
        if (batchStatus.value !== 'analyzing') {
          stopPolling()
          loading.value = false
        }
      } catch {
        // 轮询失败不报错，下次重试
      }
    }, 2000)
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
      // 后端现在立即返回，不等待 LLM
      files.value = batch.files || []
      batchStatus.value = batch.batch_status || 'analyzing'
      summary.value = batch.summary

      // 自动选中第一个文件
      if (files.value.length > 0 && !selectedFileId.value) {
        const first = files.value.find(f => f.analysis_status !== 'failed')
        selectedFileId.value = first?.file_id || files.value[0].file_id
      }

      // 开始轮询获取中间结果
      if (batchStatus.value === 'analyzing') {
        startPolling()
      } else {
        loading.value = false
      }
    } catch (err: any) {
      stopPolling()
      let msg = err?.response?.data?.message || err?.response?.data?.data?.message || err?.message || '分析失败'
      if (err?.response?.status === 404 && batchId.value) {
        msg = '分析会话已过期，请重新上传文件'
        sessionExpired.value = true
        reset()
      }
      if (err?.response?.status === 400) {
        msg = `分析请求参数错误: ${msg}`
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
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '导出失败'
      setError(`导出失败: ${msg}`)
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
    stopPolling()
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
    stopPolling,
    exportReport,
    loadConfig,
    reset,
  }
})
