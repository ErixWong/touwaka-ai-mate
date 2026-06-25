import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  currentFeatureAnalyzerApi,
  type BatchSession,
  type SessionFileItem,
  type RuleSetItem,
  type RuleSetDetail,
  type BatchStatus,
  type BatchSummary,
  type AppConfig,
  type FileAnalysisResult,
} from '@/api/current-feature-analyzer'
import { APIError } from '@/api/client'
import { useCurrentFeatureAnalyzerPolling } from '@/composables/useCurrentFeatureAnalyzerPolling'
import { normalizeApiError, enhanceApiError } from '@/composables/useCurrentFeatureAnalyzerError'

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

  /**
   * 当前选中文件的详情缓存
   *
   * 背景：getBatch() 已剥离 raw_data / result 以减小轮询 payload。
   * 文件详情（原始曲线、压缩图表、阶段指标等）通过 getFileDetail() 按需拉取并缓存于此。
   *
   * 缓存策略：
   * - 按 file_id 缓存最近一次的 getFileDetail() 结果
   * - 切换文件时命中缓存则不重复请求
   * - 文件分析状态变化时（watch 触发）自动失效并刷新
   */
  const fileDetailCache = ref<Map<string, { raw_data?: unknown; result?: FileAnalysisResult | null; _duplicate_diagnosis?: unknown; [k: string]: unknown }>>(new Map())
  const fileDetailLoading = ref(false)

  const { startPolling, stopPolling } = useCurrentFeatureAnalyzerPolling(
    batchId, batchStatus, files, summary, loading
  )

  /**
   * 当前选中文件（合并轻量列表数据 + 按需详情数据）
   *
   * getBatch() 返回的 files[*] 仅含元信息（file_id / file_name / analysis_status 等），
   * 不含 raw_data / result。选中文件时通过 getFileDetail() 加载完整数据并合并。
   */
  const currentFile = computed(() => {
    const base = files.value.find(f => f.file_id === selectedFileId.value) || null
    if (!base) return null
    const detail = fileDetailCache.value.get(base.file_id)
    if (!detail) return base
    return { ...base, ...detail }
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
        // 上传后立即加载详情（含 raw_data）
        if (selectedFileId.value && batchId.value) {
          loadFileDetail(batchId.value, selectedFileId.value)
        }
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
    if (id && batchId.value) {
      loadFileDetail(batchId.value, id)
    }
  }

  /**
   * 按需加载当前选中文件的完整详情（raw_data / result）
   *
   * 调用时机：
   * - selectFile() 切换文件时
   * - uploadFiles() / runAnalysis() 自动选中文件后
   * - 轮询中检测到当前文件分析状态变化时（通过 watch 自动触发）
   *
   * 缓存策略：已加载过的 file_id 不重复请求；状态变化时先失效缓存再重新加载。
   */
  async function loadFileDetail(bid: string, fid: string, forceRefresh = false) {
    if (!forceRefresh && fileDetailCache.value.has(fid)) return
    if (fileDetailLoading.value) return
    fileDetailLoading.value = true
    try {
      const detail = await currentFeatureAnalyzerApi.getFileDetail(bid, fid)
      fileDetailCache.value.set(fid, detail as unknown as Exclude<typeof fileDetailCache.value.get, undefined>)
    } catch {
      // 详情加载失败不阻塞：基础文件信息仍可展示（文件名、状态等）
    } finally {
      fileDetailLoading.value = false
    }
  }

  // 监听当前文件状态变化，自动刷新详情
  // 场景：轮询中文件从 analyzing → completed/failed，需重新拉取完整 result
  watch(
    () => {
      const f = files.value.find(x => x.file_id === selectedFileId.value)
      return f?.analysis_status ?? null
    },
    (newStatus, oldStatus) => {
      if (newStatus && newStatus !== oldStatus && batchId.value && selectedFileId.value) {
        // 状态变化时先失效缓存，再强制刷新
        fileDetailCache.value.delete(selectedFileId.value)
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
      // 后端现在立即返回，不等待 LLM
      files.value = batch.files || []
      batchStatus.value = batch.batch_status || 'analyzing'
      summary.value = batch.summary

      // 自动选中第一个文件
      if (files.value.length > 0 && !selectedFileId.value) {
        const first = files.value.find(f => f.analysis_status !== 'failed')
        selectedFileId.value = first?.file_id || files.value[0].file_id
        if (selectedFileId.value && batchId.value) {
          loadFileDetail(batchId.value, selectedFileId.value)
        }
      }

      // 开始轮询获取中间结果
      if (batchStatus.value === 'analyzing') {
        startPolling()
      } else {
        loading.value = false
      }
    } catch (err: unknown) {
      stopPolling()
      const msg = enhanceApiError(err, { batchId: batchId.value })

      if (err instanceof APIError && err.status === 404 && batchId.value) {
        sessionExpired.value = true
        reset()
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
    fileDetailCache.value.clear()
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
