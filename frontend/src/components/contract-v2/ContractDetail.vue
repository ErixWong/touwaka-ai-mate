<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useContractV2Store, getProcessingStatusLabel } from '@/stores/contract-v2'
import type { ContractVersion, LlmCompareRunResponse, LlmCompareStoredResult } from '@/api/contract-v2'
import { getVersionContent, CONTRACT_LLM_COMPARE_MODEL_ID } from '@/api/contract-v2'
import {
  type StatusTagEntry,
  DEFAULT_LLM_COMPARE_TEMPERATURE,
  COMPARE_CONCURRENCY_MIN,
  COMPARE_CONCURRENCY_MAX,
  COMPARE_CONCURRENCY_DEFAULT,
  COMPARE_ESTIMATE_MIN_MINUTES_PER_SECTION,
  COMPARE_ESTIMATE_MAX_MINUTES_PER_SECTION,
  CONFIDENCE_HIGH_THRESHOLD,
  CONFIDENCE_MEDIUM_THRESHOLD,
  METADATA_DISPLAY_FIELDS,
  escapeHtml,
} from './constants'
import { uploadAttachmentFormData } from '@/api/attachment'
import { getRevisions, getDocumentPermissions, type DocRevision, type DocPermissions } from '@/api/docs'
import { getAvailableResources } from '@/api/mini-apps'
import DocumentContentViewer from '@/components/apps/DocumentContentViewer.vue'

const APP_ID = 'contract-mgr-v2'
const { t } = useI18n()

const emit = defineEmits<{
  back: []
}>()

const store = useContractV2Store()

const contract = computed(() => store.currentContract)
const versions = computed(() => store.currentContractVersions)

const uploading = ref(false)
const uploadingType = ref('sales')
const uploadDocumentMode = ref<'new' | 'existing'>('new')
const selectedExistingDocumentId = ref('')
const showUploadDialog = ref(false)
const showContentDialog = ref(false)
const documentContent = ref<{
  has_content: boolean
  ocr_text?: string | null
  filtered_text?: string | null
  sections?: Array<{ title: string; content: string }> | null
  extract_json?: Record<string, unknown> | null
} | null>(null)
const contentLoading = ref(false)
const contentVersionName = ref('')

const docRevisions = ref<DocRevision[]>([])
const docRevisionsLoading = ref(false)
const docCurrentRevisionId = ref<string | null>(null)
const docPermissions = ref<DocPermissions | null>(null)

const retryingProcessing = ref(false)
const versionProcessingStatus = ref<Record<string, {
  status: string
  label: string
  type: string
  // 该版本绑定的 revision 是否为 document 当前 revision；
  // false 时 processing_status 仅反映 document 最新 revision 进度，不直接等于该历史版本事实
  isCurrentRevision?: boolean
}>>({})
const selectedVersionsForCompare = ref<string[]>([])
const showCompareDialog = ref(false)
const comparePhase = ref<'config' | 'running' | 'result'>('config')
const compareModels = ref<Array<{ id: string; name: string; provider_name?: string }>>([])
const compareModelId = ref('')
const compareSwapped = ref(false)
const compareTemperature = ref(DEFAULT_LLM_COMPARE_TEMPERATURE)
const compareConcurrency = ref(COMPARE_CONCURRENCY_DEFAULT)
const sortedCompareVersions = ref<ContractVersion[]>([])
const compareVersionA = computed(() => sortedCompareVersions.value[compareSwapped.value ? 1 : 0] || null)
const compareVersionB = computed(() => sortedCompareVersions.value[compareSwapped.value ? 0 : 1] || null)
const selectedModelName = computed(() => {
  const m = compareModels.value.find(m => m.id === compareModelId.value)
  return m ? `${m.name} (${m.provider_name || ''})` : ''
})
const compareRunId = ref('')
const compareResultLoading = ref(false)
const compareResult = ref<null | LlmCompareRunResponse>(null)
const compareSectionCount = ref<number | null>(null)
const compareStartedAt = ref<number | null>(null)
const compareElapsedSeconds = ref(0)
let compareTimer: ReturnType<typeof setInterval> | null = null

function formatCompareVersion(version: ContractVersion | null) {
  if (!version) return '-'
  return [version.version_number, version.version_name].filter(Boolean).join(' ') || '-'
}

const compareDirectionLabel = computed(() => t('contractV2.compare.direction', {
  version_a: formatCompareVersion(compareVersionA.value),
  version_b: formatCompareVersion(compareVersionB.value),
}))

const compareEstimatedDuration = computed(() => {
  const section_count = compareSectionCount.value
  if (!section_count) return t('contractV2.compare.estimatedDurationUnknown')

  const min_minutes = Math.max(1, Math.ceil(section_count * COMPARE_ESTIMATE_MIN_MINUTES_PER_SECTION))
  const max_minutes = Math.max(min_minutes + 2, Math.ceil(section_count * COMPARE_ESTIMATE_MAX_MINUTES_PER_SECTION))
  return t('contractV2.compare.estimatedDuration', {
    minutes: `${min_minutes}-${max_minutes}`,
    sections: section_count,
  })
})

function formatElapsedTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remaining_seconds = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remaining_seconds}`
}

function formatDuration(duration_ms: number) {
  const total_seconds = Math.max(0, Math.round(duration_ms / 1000))
  const minutes = Math.floor(total_seconds / 60)
  const seconds = total_seconds % 60
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function stopCompareTimer() {
  if (compareTimer) {
    clearInterval(compareTimer)
    compareTimer = null
  }
}

function updateCompareElapsed() {
  if (compareStartedAt.value === null) return
  compareElapsedSeconds.value = Math.floor((Date.now() - compareStartedAt.value) / 1000)
}

function startCompareTimer() {
  stopCompareTimer()
  compareStartedAt.value = Date.now()
  compareElapsedSeconds.value = 0
  compareTimer = setInterval(updateCompareElapsed, 1000)
}

async function loadCompareSectionEstimate() {
  const version_a = compareVersionA.value
  const version_b = compareVersionB.value
  if (!version_a?.id || !version_b?.id) return

  const version_a_id = version_a.id
  const version_b_id = version_b.id
  try {
    const [content_a, content_b] = await Promise.all([
      getVersionContent(version_a_id),
      getVersionContent(version_b_id),
    ])
    if (compareVersionA.value?.id !== version_a_id || compareVersionB.value?.id !== version_b_id) return

    const section_counts = [
      content_a.sections?.length || 0,
      content_b.sections?.length || 0,
    ]
    compareSectionCount.value = Math.max(...section_counts)
  } catch (e: unknown) {
    compareSectionCount.value = null
    console.warn('Failed to load compare section estimate:', e)
  }
}

onBeforeUnmount(stopCompareTimer)

// 元数据编辑相关
const showMetadataDialog = ref(false)
const metadataLoading = ref(false)
const metadataVersionId = ref<string>('')
const editableMetadata = ref({
  contract_number: '',
  party_a: '',
  party_b: '',
  contract_amount: null as number | null,
})
const savingMetadata = ref(false)

const versionTypeLabels = computed<Record<string, string>>(() => ({
  draft: t('contractV2.versionTypes.draft'),
  signed: t('contractV2.versionTypes.signed'),
  amendment: t('contractV2.versionTypes.amendment'),
  supplement: t('contractV2.versionTypes.supplement'),
}))

// 合同类型字典：与 ContractList.vue / manifest.json fields.contract_type.options 保持一致
// 复用 contractTypeLabels 作为单一字典来源，避免上传弹窗与系统字典分叉
const contractTypeLabels = computed<Record<string, string>>(() => ({
  strategy: t('contractV2.contractTypes.strategy'),
  framework: t('contractV2.contractTypes.framework'),
  development: t('contractV2.contractTypes.development'),
  sales: t('contractV2.contractTypes.sales'),
  supply: t('contractV2.contractTypes.supply'),
  purchase: t('contractV2.contractTypes.purchase'),
  quality: t('contractV2.contractTypes.quality'),
  nda: t('contractV2.contractTypes.nda'),
  technical: t('contractV2.contractTypes.technical'),
  other: t('contractV2.contractTypes.other'),
}))
const contractTypeOptions = computed(() =>
  Object.entries(contractTypeLabels.value).map(([value, label]) => ({ value, label }))
)

const versionStatusLabels = computed<Record<string, StatusTagEntry>>(() => ({
  draft: { label: t('contractV2.versionStatuses.draft'), type: 'info' },
  reviewing: { label: t('contractV2.versionStatuses.reviewing'), type: 'warning' },
  approved: { label: t('contractV2.versionStatuses.approved'), type: 'success' },
  rejected: { label: t('contractV2.versionStatuses.rejected'), type: 'danger' },
  archived: { label: t('contractV2.versionStatuses.archived'), type: '' },
}))

const processingStatusLabels = computed<Record<string, StatusTagEntry>>(() => ({
  pending_ocr: { label: t('contractV2.processingStatuses.processing'), type: 'info' },
  ocr_processing: { label: t('contractV2.processingStatuses.processing'), type: 'warning' },
  pending_clean: { label: t('contractV2.processingStatuses.processing'), type: 'info' },
  pending_outline: { label: t('contractV2.processingStatuses.processing'), type: 'info' },
  pending_chunk: { label: t('contractV2.processingStatuses.processing'), type: 'info' },
  pending_embedding: { label: t('contractV2.processingStatuses.processing'), type: 'info' },
  ready: { label: t('contractV2.processingStatuses.ready'), type: 'success' },
  error: { label: t('contractV2.processingStatuses.error'), type: 'danger' },
}))

const revisionStatusLabels = computed<Record<string, StatusTagEntry>>(() => ({
  draft: { label: t('contractV2.revisionStatuses.draft'), type: 'info' },
  review: { label: t('contractV2.revisionStatuses.review'), type: 'warning' },
  approved: { label: t('contractV2.revisionStatuses.approved'), type: 'success' },
  effective: { label: t('contractV2.revisionStatuses.effective'), type: 'success' },
  expired: { label: t('contractV2.revisionStatuses.expired'), type: 'info' },
  archived: { label: t('contractV2.revisionStatuses.archived'), type: '' },
}))

const compareChangeTypeLabels = computed<Record<string, StatusTagEntry>>(() => ({
  identical: { label: t('contractV2.compareChangeTypes.identical'), type: 'success' },
  modified: { label: t('contractV2.compareChangeTypes.modified'), type: 'warning' },
  semantic_change: { label: t('contractV2.compareChangeTypes.semantic_change'), type: 'danger' },
  added: { label: t('contractV2.compareChangeTypes.added'), type: 'info' },
  removed: { label: t('contractV2.compareChangeTypes.removed'), type: 'danger' },
}))

const compareRiskLevelLabels = computed<Record<string, StatusTagEntry>>(() => ({
  none: { label: t('contractV2.compareRiskLevels.none'), type: '' },
  low: { label: t('contractV2.compareRiskLevels.low'), type: 'info' },
  medium: { label: t('contractV2.compareRiskLevels.medium'), type: 'warning' },
  high: { label: t('contractV2.compareRiskLevels.high'), type: 'danger' },
}))

const classificationItems = computed(() => {
  return contract.value?.classification_json || []
})

const processingInfo = computed(() => {
  if (!contract.value?.document_id) return null
  const map = store.processingStatusMap
  const entry = map[contract.value.document_id]
  const status = entry?.status || contract.value.processing_status
  if (!status) return null
  const label = processingStatusLabels.value[status] || ({ label: status, type: 'info' } as StatusTagEntry)
  return {
    status,
    label: label.label,
    type: label.type,
    errorCode: entry?.errorCode || contract.value.processing_error_code,
  }
})

const classificationConfidenceType = (confidence: number): StatusTagEntry['type'] => {
  if (confidence >= CONFIDENCE_HIGH_THRESHOLD) return 'success'
  if (confidence >= CONFIDENCE_MEDIUM_THRESHOLD) return 'warning'
  return 'info'
}

async function loadDocRevisions() {
  if (!contract.value?.document_id) return
  docRevisionsLoading.value = true
  try {
    const result = await getRevisions(contract.value.document_id)
    docCurrentRevisionId.value = result.current_revision_id
    docRevisions.value = result.items
  } catch {
    docRevisions.value = []
  } finally {
    docRevisionsLoading.value = false
  }
}

async function loadDocPermissions() {
  if (!contract.value?.document_id) return
  try {
    docPermissions.value = await getDocumentPermissions(contract.value.document_id)
  } catch {
    docPermissions.value = null
  }
}

watch(() => contract.value?.id, () => {
  docRevisions.value = []
  docPermissions.value = null
  versionProcessingStatus.value = {}
  if (contract.value) {
    loadDocRevisions()
    loadDocPermissions()
    if (contract.value.document_id) {
      store.fetchProcessingStatus(contract.value.document_id)
    }
  }
}, { immediate: true })

// 监听 versions 变化，加载文档处理状态
watch(() => versions.value, (newVersions) => {
  if (!newVersions?.length) return

  void Promise.all(
    newVersions
      .filter(version => version.document_id && !versionProcessingStatus.value[version.id])
      .map(async (version) => {
        try {
          const status = await store.fetchVersionProcessingStatus(version.id)
          if (status.has_document && status.processing_status) {
            const statusInfo = getProcessingStatusLabel(status.processing_status)
            versionProcessingStatus.value[version.id] = {
              status: status.processing_status,
              label: statusInfo.label,
              type: statusInfo.type,
              // status_scope: document_current_revision 表示该版本 revision 即为 document 当前 revision
              isCurrentRevision: status.status_scope === 'document_current_revision',
            }
          }
        } catch (e) {
          console.error('Failed to load processing status:', e)
        }
      }),
  )
}, { immediate: true })

async function handleSetCurrent(revisionId: string) {
  try {
    await ElMessageBox.confirm(t('contractV2.revisions.confirmSetCurrentMessage'), t('common.confirm'), {
      confirmButtonText: t('contractV2.revisions.setCurrent'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    })
  } catch {
    // 用户取消确认，正常行为
    return
  }
  try {
    await store.setDocRevisionCurrent(revisionId)
    await loadDocRevisions()
  } catch {
    ElMessage.error(t('common.operationFailed'))
  }
}

async function handleRetryProcessing() {
  if (!contract.value?.document_id) return
  retryingProcessing.value = true
  try {
    await store.retryDocProcessing(contract.value.document_id)
  } finally {
    retryingProcessing.value = false
  }
}

async function handleRefreshStatus() {
  if (contract.value?.document_id) {
    await store.fetchProcessingStatus(contract.value.document_id)
  }
  await refreshVersionStatuses()
}

async function refreshVersionStatuses() {
  const terminalStatuses = ['ready', 'error', 'failed']
  const versionsToRefresh = (versions.value || []).filter(v =>
    v.document_id && (
      !versionProcessingStatus.value[v.id] ||
      !terminalStatuses.includes(versionProcessingStatus.value[v.id].status)
    ),
  )
  if (!versionsToRefresh.length) return

  await Promise.all(
    versionsToRefresh.map(async (version) => {
      try {
        const status = await store.fetchVersionProcessingStatus(version.id)
        if (status.has_document && status.processing_status) {
          const statusInfo = getProcessingStatusLabel(status.processing_status)
          versionProcessingStatus.value[version.id] = {
            status: status.processing_status,
            label: statusInfo.label,
            type: statusInfo.type,
            isCurrentRevision: status.status_scope === 'document_current_revision',
          }
        }
      } catch (e) {
        console.error('Failed to refresh processing status:', e)
      }
    }),
  )
}

async function handleSetBusinessCurrent(versionId: string) {
  await store.setVersionCurrent(versionId)
}

async function handleApprove(versionId: string) {
  await store.approveVersionAction(versionId)
}

async function handleDeleteVersion(versionId: string) {
  try {
    await ElMessageBox.confirm(t('contractV2.businessVersions.confirmDeleteMessage'), t('common.confirm'), {
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    })
    await store.removeVersion(versionId)
  } catch {
    // 用户取消或删除失败；ElMessageBox.confirm 取消时 throw，不需要额外提示
  }
}

async function handleExtractMetadata(versionId: string) {
  try {
    const result = await store.doExtractMetadata(versionId)
    if (result?.metadata) {
      // 仅展示已知业务字段，不暴露 document_id/revision_id 等内部 ID；对象值 JSON.stringify，纯文本展示
      const metaLines = METADATA_DISPLAY_FIELDS
        .filter(key => Object.prototype.hasOwnProperty.call(result.metadata, key))
        .map((key) => {
          const raw = result.metadata[key]
          let text: string
          if (raw === null || raw === undefined) {
            text = '-'
          } else if (typeof raw === 'object') {
            text = JSON.stringify(raw)
          } else {
            text = String(raw)
          }
          const label = (() => {
            switch (key) {
              case 'contract_number': return t('contractV2.metadata.contractNumber')
              case 'contract_type': return t('contractV2.contractType')
              case 'contract_date': return t('contractV2.metadata.contractDate')
              case 'parent_company': return t('contractV2.metadata.parentCompany')
              case 'party_a': return t('contractV2.metadata.partyA')
              case 'party_b': return t('contractV2.metadata.partyB')
              case 'contract_amount': return t('contractV2.metadata.contractAmount')
              default: return key
            }
          })()
          return `${label}: ${escapeHtml(text)}`
        })
      await ElMessageBox.alert(
        metaLines.join('\n'),
        t('contractV2.businessVersions.extractResultTitle'),
        { confirmButtonText: t('common.confirm') }
      )
    }
  } catch {
    ElMessage.error(t('common.operationFailed'))
  }
}

async function handleEditMetadata(versionId: string) {
  metadataVersionId.value = versionId
  metadataLoading.value = true
  showMetadataDialog.value = true
  try {
    const metadata = await store.doGetVersionMetadata(versionId)
    editableMetadata.value = {
      contract_number: metadata.contract_number || '',
      party_a: metadata.party_a || '',
      party_b: metadata.party_b || '',
      contract_amount: metadata.contract_amount,
    }
  } catch {
    editableMetadata.value = {
      contract_number: '',
      party_a: '',
      party_b: '',
      contract_amount: null,
    }
  } finally {
    metadataLoading.value = false
  }
}

async function handleSaveMetadata() {
  if (!metadataVersionId.value) return
  savingMetadata.value = true
  try {
    await store.doUpdateVersionMetadata(metadataVersionId.value, {
      contract_number: editableMetadata.value.contract_number || null,
      party_a: editableMetadata.value.party_a || null,
      party_b: editableMetadata.value.party_b || null,
      contract_amount: editableMetadata.value.contract_amount,
    })
    showMetadataDialog.value = false
  } catch {
    ElMessage.error(t('common.operationFailed'))
  } finally {
    savingMetadata.value = false
  }
}

function toggleVersionForCompare(versionId: string) {
  const idx = selectedVersionsForCompare.value.indexOf(versionId)
  if (idx >= 0) {
    selectedVersionsForCompare.value.splice(idx, 1)
  } else if (selectedVersionsForCompare.value.length < 2) {
    selectedVersionsForCompare.value.push(versionId)
  }
}

function versionNumberToNum(vn: string): number {
  const m = String(vn || '').match(/v?(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}

async function handleStartCompare() {
  if (selectedVersionsForCompare.value.length !== 2) {
    return
  }
  const vs = versions.value.filter(v => selectedVersionsForCompare.value.includes(v.id))
  if (vs.length !== 2) return
  // 旧版本为基准 A，新版本为对比 B（可交换）
  vs.sort((x, y) => versionNumberToNum(x.version_number) - versionNumberToNum(y.version_number))
  sortedCompareVersions.value = vs
  compareSwapped.value = false
  compareResult.value = null
  compareResultLoading.value = false
  compareSectionCount.value = null
  compareStartedAt.value = null
  compareElapsedSeconds.value = 0
  stopCompareTimer()
  comparePhase.value = 'config'
  showCompareDialog.value = true
  void loadCompareSectionEstimate()
  // 拉取可用的内部 LLM 模型（优先使用后端指定的默认比对模型）
  try {
    const resources = await getAvailableResources(APP_ID)
    compareModels.value = resources.internal_llm?.models || []
    const defaultModelId = resources.default_compare_model_id
    const qwen = compareModels.value.find(m => m.id === CONTRACT_LLM_COMPARE_MODEL_ID)
    compareModelId.value = defaultModelId || qwen?.id || compareModels.value[0]?.id || ''
  } catch {
    compareModels.value = []
    compareModelId.value = ''
  }
}

function swapCompare() {
  compareSwapped.value = !compareSwapped.value
}

async function startCompareRun() {
  if (!compareVersionA.value?.row_id || !compareVersionB.value?.row_id) return
  comparePhase.value = 'running'
  compareResultLoading.value = true
  startCompareTimer()
  void loadCompareSectionEstimate()
  try {
    const result = await store.doCompareVersionsWithLlm(
      compareVersionA.value.row_id,
      compareVersionB.value.row_id,
      { model_id: compareModelId.value || undefined, temperature: compareTemperature.value, concurrency: compareConcurrency.value },
    )
    compareRunId.value = compareVersionA.value.row_id
    compareResult.value = result
    comparePhase.value = 'result'
  } catch (e: unknown) {
    console.error('Compare failed:', e)
    comparePhase.value = 'config'
  } finally {
    stopCompareTimer()
    compareResultLoading.value = false
  }
}

async function loadCompareResult() {
  if (!compareRunId.value) return
  compareResultLoading.value = true
  try {
    const r = await store.doGetVersionCompareResult(compareRunId.value)
    if (r) {
      compareResult.value = r
      comparePhase.value = 'result'
      const currentTargetRowId = compareVersionB.value?.row_id
      const resultTargetRowId = (r as { target_row_id?: string }).target_row_id
      if (currentTargetRowId && resultTargetRowId && resultTargetRowId !== currentTargetRowId) {
        ElMessage.warning(t('contractV2.compare.staleResultWarning'))
      }
    }
  } finally {
    compareResultLoading.value = false
  }
}

const isExporting = ref(false)

async function exportCompareExcel() {
  if (!compareResult.value) return
  isExporting.value = true
  try {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.default.Workbook()
    const detailSheet = workbook.addWorksheet(t('contractV2.compare.sheetDetail'))
    detailSheet.columns = [
      { header: t('contractV2.compare.colSection'), key: 'section', width: 30 },
      { header: t('contractV2.compare.colChangeType'), key: 'change_type', width: 14 },
      { header: t('contractV2.compare.colRiskLevel'), key: 'risk_level', width: 12 },
      { header: t('contractV2.compare.colSummary'), key: 'summary', width: 50 },
      { header: t('contractV2.compare.colChanges'), key: 'changes', width: 40 },
      { header: t('contractV2.compare.colBase'), key: 'base', width: 30 },
      { header: t('contractV2.compare.colTarget'), key: 'target', width: 30 },
    ]
    const storedCompareResult = compareResult.value as LlmCompareRunResponse | LlmCompareStoredResult
    const compare_time = storedCompareResult.compared_at
      ? new Date(storedCompareResult.compared_at).toLocaleString()
      : new Date(compareStartedAt.value || Date.now()).toLocaleString()
    const metadata_text = t('contractV2.compare.exportMetadata', {
      compare_time,
      model_name: selectedModelName.value || t('contractV2.compare.defaultModel'),
      version_a: formatCompareVersion(compareVersionA.value),
      version_b: formatCompareVersion(compareVersionB.value),
      duration: formatDuration(compareResult.value.duration_ms),
    })
    detailSheet.insertRow(1, [metadata_text])
    detailSheet.mergeCells(1, 1, 1, 7)
    const metadata_row = detailSheet.getRow(1)
    metadata_row.font = { bold: true }
    metadata_row.alignment = { vertical: 'middle', wrapText: true }
    metadata_row.height = 30

    const headerRow = detailSheet.getRow(2)
    headerRow.font = { bold: true }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }
    const changeTypeMap: Record<string, string> = {
      identical: t('contractV2.compare.typeIdentical'),
      modified: t('contractV2.compare.typeModified'),
      semantic_change: t('contractV2.compare.typeSemanticChange'),
      added: t('contractV2.compare.typeAdded'),
      removed: t('contractV2.compare.typeRemoved'),
      error: t('contractV2.compare.typeError'),
    }
    const changeColors: Record<string, string> = {
      identical: 'FFE8F5E9',
      modified: 'FFFFF3E0',
      semantic_change: 'FFFFF3E0',
      added: 'FFE3F2FD',
      removed: 'FFFCE4EC',
      error: 'FFEFEBE9',
    }
    for (const item of compareResult.value.results) {
      const changes = (item.key_changes || []).map(c => c.description).join('; ')
      const baseParts = (item.key_changes || []).filter(c => c.old).map(c => c.old).join('\n')
      const targetParts = (item.key_changes || []).filter(c => c.new).map(c => c.new).join('\n')
      const row = detailSheet.addRow({
        section: String(item.title || '').replace(/^##\s*/, ''),
        change_type: changeTypeMap[item.change_type] || item.change_type,
        risk_level: item.risk_level || 'low',
        summary: item.summary,
        changes: changes || '',
        base: baseParts,
        target: targetParts,
      })
      const fillColor = changeColors[item.change_type]
      if (fillColor) {
        for (let col = 1; col <= 7; col++) {
          row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } }
        }
      }
    }
    const summarySheet = workbook.addWorksheet(t('contractV2.compare.sheetSummary'))
    summarySheet.columns = [
      { header: t('contractV2.compare.colMetric'), key: 'metric', width: 20 },
      { header: t('contractV2.compare.colValue'), key: 'value', width: 12 },
    ]
    const s = compareResult.value.summary
    summarySheet.addRow({ metric: t('contractV2.compare.typeTotal'), value: s.total })
    summarySheet.addRow({ metric: t('contractV2.compare.typeIdentical'), value: s.identical })
    summarySheet.addRow({ metric: t('contractV2.compare.typeModified'), value: s.modified })
    summarySheet.addRow({ metric: t('contractV2.compare.typeAdded'), value: s.added })
    summarySheet.addRow({ metric: t('contractV2.compare.typeRemoved'), value: s.removed })
    const buf = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contract-compare-${(compareResult.value.target_row_id || compareRunId.value || 'result').slice(0, 8)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('Export failed:', e)
    ElMessage.error(t('contractV2.compare.exportFailed'))
  } finally {
    isExporting.value = false
  }
}

function openUploadDialog() {
  uploadDocumentMode.value = 'new'
  selectedExistingDocumentId.value = contract.value?.document_id || ''
  showUploadDialog.value = true
}

async function handleViewContent(row: ContractVersion) {
  if (!row.id) return
  contentLoading.value = true
  contentVersionName.value = row.version_name || `V${row.version_number}`
  showContentDialog.value = true
  try {
    // 使用新的 app 内 API，不再依赖 mini-apps
    documentContent.value = await getVersionContent(row.id)
  } catch {
    documentContent.value = null
  } finally {
    contentLoading.value = false
  }
}

async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !contract.value) return
  const file = input.files[0]!
  input.value = ''

  uploading.value = true
  try {
    const att = await uploadAttachmentFormData({
      source_tag: 'mini_app_file',
      source_id: APP_ID,
      file,
    })

    // 使用新接口，不依赖 mini-app.service.js
    // 版本号按已有最大版本号 + 1 生成，避免删除中间版本后冲突
    const nextNum = versions.value.length
      ? Math.max(...versions.value.map(v => versionNumberToNum(v.version_number))) + 1
      : 1
    const nextVerNum = String(nextNum)
    await store.addVersionFromAttachment(contract.value.id, {
      file_id: att.id,
      contract_type: uploadingType.value,
      version_number: nextVerNum,
      version_name: file.name,
      version_type: 'draft',
      document_mode: uploadDocumentMode.value,
      existing_document_id: uploadDocumentMode.value === 'existing' ? selectedExistingDocumentId.value : undefined,
    })

    showUploadDialog.value = false
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : t('contractV2.upload.failed')
    console.error('Upload failed:', msg)
    ElMessageBox.alert(msg, t('contractV2.upload.failed'), { type: 'error' })
  } finally {
    uploading.value = false
  }
}

</script>

<template>
  <div class="contract-detail" v-if="contract">
    <div class="contract-detail-header">
      <el-button text @click="emit('back')">
        <el-icon><ArrowLeft /></el-icon> {{ $t('common.back') }}
      </el-button>
    </div>

    <div class="contract-detail-info">
      <h2 class="contract-detail-title">{{ contract.contract_name }}</h2>
      <div class="contract-detail-meta">
        <el-tag v-if="contract.contract_type">
          {{ contractTypeLabels[contract.contract_type] || contract.contract_type }}
        </el-tag>
        <span class="contract-detail-versions">{{ $t('contractV2.list.versionsCount', { count: versions.length }) }}</span>
      </div>
    </div>

    <el-divider />

    <div v-if="contract.document_id" class="contract-detail-section">
      <div class="contract-detail-section-header">
        <h3>{{ $t('contractV2.processing.title') }}</h3>
        <el-button size="small" text @click="handleRefreshStatus">
          <el-icon><Refresh /></el-icon> {{ $t('contractV2.processing.refresh') }}
        </el-button>
      </div>
      <div v-if="processingInfo" class="processing-status-area">
        <div class="processing-status-row">
          <el-tag :type="processingInfo.type" size="large" effect="plain">
            {{ processingInfo.label }}
          </el-tag>
          <el-button
            v-if="processingInfo.status === 'error'"
            type="danger"
            size="small"
            :loading="retryingProcessing"
            @click="handleRetryProcessing"
            style="margin-left: 12px;"
          >
            {{ $t('contractV2.processing.retry') }}
          </el-button>
        </div>
        <div v-if="processingInfo.errorCode" class="processing-error-info">
          <span class="processing-error-label">{{ $t('contractV2.processing.errorCode') }}：</span>
          <span class="processing-error-code">{{ processingInfo.errorCode }}</span>
        </div>
        <div v-if="processingInfo.status !== 'ready' && processingInfo.status !== 'error'" class="processing-pending-hint">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>{{ $t('contractV2.processing.hint') }}，{{ processingInfo.label }}...</span>
        </div>
      </div>
      <div v-else class="processing-status-area">
        <el-tag type="info" size="large" effect="plain">{{ $t('contractV2.processing.notStarted') }}</el-tag>
      </div>
    </div>

    <div v-if="docRevisions.length > 0" class="contract-detail-section">
      <div class="contract-detail-section-header">
        <h3>{{ $t('contractV2.revisions.title') }}</h3>
      </div>
      <el-table :data="docRevisions" stripe v-loading="docRevisionsLoading">
        <el-table-column prop="revision_no" :label="$t('contractV2.businessVersions.columnVersionNo')" width="100" />
        <el-table-column prop="revision_label" :label="$t('contractV2.businessVersions.columnVersionLabel')" min-width="150">
          <template #default="{ row }">
            {{ row.revision_label || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="is_current" :label="$t('contractV2.businessVersions.columnCurrentVersion')" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_current" type="success" size="small" effect="dark">{{ $t('contractV2.revisions.current') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="effective_from" :label="$t('contractV2.revisions.effectiveFrom')" width="120">
          <template #default="{ row }">
            {{ row.effective_from || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="revision_status" :label="$t('contractV2.businessVersions.columnVersionStatus')" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="revisionStatusLabels[row.revision_status]?.type || ''" disable-transitions>
              {{ revisionStatusLabels[row.revision_status]?.label || row.revision_status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('contractV2.businessVersions.columnActions')" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="!row.is_current"
              size="small"
              text
              type="primary"
              @click="handleSetCurrent(row.id)"
            >{{ $t('contractV2.revisions.setCurrent') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="classificationItems.length > 0" class="contract-detail-section">
      <div class="contract-detail-section-header">
        <h3>{{ $t('contractV2.classification.title') }}</h3>
      </div>
      <div class="classification-list">
        <div
          v-for="(item, idx) in classificationItems"
          :key="idx"
          class="classification-item"
        >
          <div class="classification-item-header">
            <span class="classification-title">{{ item.title }}</span>
            <el-tag :type="classificationConfidenceType(item.confidence)" size="small" effect="plain">
              {{ (item.confidence * 100).toFixed(0) }}%
            </el-tag>
          </div>
          <div class="classification-reasons">
            <span
              v-for="(reason, rIdx) in item.reasons"
              :key="rIdx"
              class="classification-reason-tag"
            >{{ reason }}</span>
          </div>
        </div>
      </div>
    </div>

    <el-divider />

    <div class="contract-detail-section">
      <div class="contract-detail-section-header">
        <h3>{{ $t('contractV2.businessVersions.title') }}</h3>
        <div>
          <el-button
            v-if="selectedVersionsForCompare.length > 0"
            size="small"
            @click="selectedVersionsForCompare = []"
          >{{ $t('contractV2.businessVersions.clearSelection', { count: selectedVersionsForCompare.length }) }}</el-button>
          <el-button
            v-if="selectedVersionsForCompare.length === 2"
            type="primary"
            size="small"
            @click="handleStartCompare"
          >{{ $t('contractV2.businessVersions.compareSelected') }}</el-button>
          <el-button type="primary" size="small" @click="openUploadDialog">
            {{ $t('contractV2.uploadNewVersion') }}
          </el-button>
        </div>
      </div>
      <el-table :data="versions" stripe>
        <el-table-column prop="version_number" :label="$t('contractV2.businessVersions.columnVersionNo')" width="100" />
        <el-table-column prop="version_name" :label="$t('contractV2.businessVersions.columnVersionName')" min-width="150">
          <template #default="{ row }">
            {{ row.version_name || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="version_type" :label="$t('contractV2.businessVersions.columnVersionType')" width="100">
          <template #default="{ row }">
            {{ versionTypeLabels[row.version_type] || row.version_type || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="version_status" :label="$t('contractV2.businessVersions.columnVersionStatus')" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="versionStatusLabels[row.version_status]?.type || ''" disable-transitions>
              {{ versionStatusLabels[row.version_status]?.label || row.version_status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="document_id" :label="$t('contractV2.businessVersions.columnDocumentProcessing')" width="120" align="center">
          <template #default="{ row }">
            <template v-if="row.document_id">
              <el-tooltip
                v-if="versionProcessingStatus[row.id]"
                :disabled="versionProcessingStatus[row.id]?.isCurrentRevision !== false"
                placement="top"
              >
                <template #content>
                  {{ $t('contractV2.businessVersions.statusScopeSharedTooltip') }}
                </template>
                <el-tag
                  size="small"
                  :type="versionProcessingStatus[row.id]?.type ?? ''"
                  disable-transitions
                >
                  {{ versionProcessingStatus[row.id]?.label ?? $t('contractV2.businessVersions.loading') }}
                </el-tag>
              </el-tooltip>
              <el-tag v-else size="small" type="info">{{ $t('contractV2.businessVersions.loading') }}</el-tag>
            </template>
            <span v-else class="text-gray">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="is_current" :label="$t('contractV2.businessVersions.columnCurrentVersion')" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_current" type="success" size="small" effect="dark">{{ $t('contractV2.revisions.current') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="contract_number" :label="$t('contractV2.businessVersions.columnContractNumber')" width="130">
          <template #default="{ row }">
            {{ row.contract_number || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="party_a" :label="$t('contractV2.businessVersions.columnPartyA')" width="130">
          <template #default="{ row }">
            {{ row.party_a || '-' }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('contractV2.businessVersions.columnActions')" width="430" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.document_id"
              size="small"
              text
              type="warning"
              @click="handleExtractMetadata(row.id)"
            >{{ $t('contractV2.businessVersions.extractMetadata') }}</el-button>
            <el-button
              v-if="row.row_id"
              size="small"
              text
              type="primary"
              @click="handleEditMetadata(row.id)"
            >{{ $t('contractV2.businessVersions.editMetadata') }}</el-button>
            <el-button
              size="small"
              text
              type="info"
              @click="toggleVersionForCompare(row.id)"
            >{{ selectedVersionsForCompare.includes(row.id) ? $t('contractV2.businessVersions.cancelSelect') : $t('contractV2.businessVersions.selectForCompare') }}</el-button>
            <el-button
              v-if="row.row_id"
              size="small"
              text
              @click="handleViewContent(row)"
            >{{ $t('contractV2.actions.view') }}</el-button>
            <el-button
              v-if="!row.is_current"
              size="small"
              text
              type="primary"
              @click="handleSetBusinessCurrent(row.id)"
            >{{ $t('contractV2.revisions.setCurrent') }}</el-button>
            <el-button
              v-if="row.version_status === 'draft' || row.version_status === 'reviewing'"
              size="small"
              text
              type="success"
              @click="handleApprove(row.id)"
            >{{ $t('contractV2.actions.approve') }}</el-button>
            <el-button
              size="small"
              text
              type="danger"
              @click="handleDeleteVersion(row.id)"
            >{{ $t('contractV2.actions.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="showUploadDialog" :title="$t('contractV2.upload.title')" width="480px" destroy-on-close>
      <div class="upload-zone">
        <div class="form-item">
          <label class="form-label">{{ $t('contractV2.upload.contractType') }}</label>
          <el-select v-model="uploadingType" :placeholder="$t('contractV2.upload.contractTypePlaceholder')" style="width: 100%;">
            <el-option
              v-for="item in contractTypeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>
        <div class="form-item">
          <label class="form-label">{{ $t('contractV2.upload.documentOwnership') }}</label>
          <el-radio-group v-model="uploadDocumentMode">
            <el-radio value="new">{{ $t('contractV2.upload.createNew') }}</el-radio>
            <el-radio value="existing" :disabled="!contract.document_id">{{ $t('contractV2.upload.reuseExisting') }}</el-radio>
          </el-radio-group>
        </div>
        <div v-if="uploadDocumentMode === 'existing'" class="form-item">
          <label class="form-label">{{ $t('contractV2.upload.reuseExisting') }}</label>
          <el-input v-model="selectedExistingDocumentId" readonly />
          <div class="upload-hint">{{ $t('contractV2.upload.reuseHint') }}</div>
        </div>
        <div v-if="uploading" class="upload-loading">
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          <span>{{ $t('contractV2.upload.uploading') }}</span>
        </div>
        <div v-else class="upload-drop">
          <p>{{ $t('contractV2.upload.selectHint') }}</p>
          <p class="upload-hint">{{ $t('contractV2.upload.formatHint') }}</p>
          <label class="upload-btn">
            {{ $t('contractV2.upload.selectBtn') }}
            <input type="file" accept=".pdf,.docx,.doc,.jpg,.png" @change="handleFileUpload" class="hidden-input" />
          </label>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="showCompareDialog"
      :title="$t('contractV2.compare.title')"
      width="900px"
      destroy-on-close
    >
      <!-- 配置阶段：选择基准/对比方向 + 模型 -->
      <div v-if="comparePhase === 'config'">
        <div class="compare-config-row">
          <div class="compare-side">
            <div class="compare-side-label">📄 {{ $t('contractV2.compare.baseVersion') }}</div>
            <div class="compare-side-value">{{ compareVersionA ? (compareVersionA.version_number + ' ' + (compareVersionA.version_name || '')) : '-' }}</div>
          </div>
          <el-button circle size="small" :title="$t('contractV2.compare.swap')" @click="swapCompare">⇄</el-button>
          <div class="compare-side">
            <div class="compare-side-label">📄 {{ $t('contractV2.compare.targetVersion') }}</div>
            <div class="compare-side-value">{{ compareVersionB ? (compareVersionB.version_number + ' ' + (compareVersionB.version_name || '')) : '-' }}</div>
          </div>
        </div>
        <el-form label-width="110px" style="margin-top: 16px;">
          <el-form-item :label="$t('contractV2.compare.model')">
            <el-select v-model="compareModelId" placeholder="" style="width: 320px;">
              <el-option v-for="m in compareModels" :key="m.id" :value="m.id" :label="`${m.name} (${m.provider_name || ''})`" />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('contractV2.compare.temperature')">
            <el-slider v-model="compareTemperature" :min="0" :max="1" :step="0.1" style="width: 320px;" />
          </el-form-item>
          <el-form-item :label="$t('contractV2.compare.concurrency')">
            <el-slider v-model="compareConcurrency" :min="COMPARE_CONCURRENCY_MIN" :max="COMPARE_CONCURRENCY_MAX" :step="1" show-stops style="width: 320px;" />
          </el-form-item>
        </el-form>
        <div style="text-align: right;">
          <el-button type="primary" @click="startCompareRun">{{ $t('contractV2.compare.startCompare') }}</el-button>
        </div>
      </div>

      <!-- 比对中 -->
      <div v-else-if="comparePhase === 'running'" class="compare-running-state">
        <el-icon class="is-loading" :size="28"><Loading /></el-icon>
        <div class="compare-running-content">
          <div class="compare-running-primary">
            {{ $t('contractV2.compare.runningMessage', {
              model: selectedModelName || $t('contractV2.compare.defaultModel'),
              version_a: formatCompareVersion(compareVersionA),
              version_b: formatCompareVersion(compareVersionB)
            }) }}
          </div>
          <div class="compare-running-elapsed">
            {{ $t('contractV2.compare.elapsed', { time: formatElapsedTime(compareElapsedSeconds) }) }}
          </div>
          <div class="compare-running-hint">{{ compareEstimatedDuration }}</div>
        </div>
      </div>

      <!-- 结果阶段 -->
      <div v-else-if="comparePhase === 'result' && compareResult">
        <el-alert :title="compareDirectionLabel" type="info" :closable="false" show-icon class="compare-direction-alert" />
        <div class="contract-detail-section-header">
          <div class="compare-summary">
            {{ $t('contractV2.compare.summaryResult', {
              total: compareResult.summary.total,
              identical: compareResult.summary.identical,
              modified: compareResult.summary.modified
            }) }}
            <span v-if="compareResult.duration_ms" class="compare-duration">{{ $t('contractV2.compare.duration', { seconds: (compareResult.duration_ms / 1000).toFixed(0) }) }}</span>
          </div>
          <el-button size="small" @click="loadCompareResult" :loading="compareResultLoading">{{ $t('contractV2.compare.refreshResult') }}</el-button>
          <el-button size="small" type="primary" @click="exportCompareExcel" :loading="isExporting">{{ $t('contractV2.compare.exportExcel') }}</el-button>
        </div>
        <el-table :data="compareResult.results" stripe v-loading="compareResultLoading">
          <el-table-column prop="title" :label="$t('contractV2.compare.columnTitle')" width="240">
            <template #default="{ row }">
              {{ String(row.title || '').replace(/^##\s*/, '') || '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="change_type" :label="$t('contractV2.compare.columnChangeType')" width="130">
            <template #default="{ row }">
              <el-tag size="small" :type="compareChangeTypeLabels[row.change_type]?.type || ''" disable-transitions>
                {{ compareChangeTypeLabels[row.change_type]?.label || row.change_type }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="risk_level" :label="$t('contractV2.compare.columnRiskLevel')" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.risk_level" size="small" :type="compareRiskLevelLabels[row.risk_level]?.type || ''" disable-transitions>
                {{ compareRiskLevelLabels[row.risk_level]?.label || row.risk_level }}
              </el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('contractV2.compare.columnSummary')" min-width="360">
            <template #default="{ row }">
              <div style="white-space: normal; line-height: 1.6;">{{ row.summary || '-' }}</div>
              <el-collapse v-if="row.key_changes && row.key_changes.length" style="margin-top: 6px;">
                <el-collapse-item v-for="(kc, kci) in row.key_changes" :key="kci">
                  <template #title>
                    <span class="kc-title">{{ kc.description || ('变更 ' + (kci + 1)) }}</span>
                  </template>
                  <div class="kc-body">
                    <div v-if="kc.old" class="kc-old">旧：{{ kc.old }}</div>
                    <div v-if="kc.new" class="kc-new">新：{{ kc.new }}</div>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>

    <el-dialog
      v-model="showContentDialog"
      :title="$t('contractV2.content.dialogTitle', { versionName: contentVersionName })"
      width="1200px"
      top="5vh"
      destroy-on-close
    >
      <div v-if="contentLoading" style="text-align: center; padding: 60px 0;">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <p>{{ $t('common.loading') }}</p>
      </div>
      <div v-else-if="documentContent && documentContent.has_content">
        <el-tabs>
          <el-tab-pane :label="$t('contractV2.content.basicInfo')">
            <div class="detail-grid">
              <template v-if="documentContent.extract_json">
                <div v-for="(val, key) in documentContent.extract_json" :key="key" class="detail-row">
                  <span class="detail-label">{{ key }}</span>
                  <span class="detail-value">{{ val ?? '-' }}</span>
                </div>
              </template>
            </div>
          </el-tab-pane>
          <el-tab-pane :label="$t('contractV2.content.documentContent')">
            <DocumentContentViewer
              :content-text="documentContent.filtered_text || documentContent.ocr_text || ''"
              :sections="documentContent.sections || []"
            />
          </el-tab-pane>
        </el-tabs>
      </div>
      <div v-else style="text-align: center; padding: 60px 0; color: var(--el-text-color-placeholder);">
        {{ $t('contractV2.content.noContent') }}
      </div>
    </el-dialog>

    <!-- 元数据编辑对话框 -->
    <el-dialog v-model="showMetadataDialog" :title="$t('contractV2.metadata.title')" width="480px" destroy-on-close>
      <div v-if="metadataLoading" style="text-align: center; padding: 40px 0;">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <p>{{ $t('contractV2.metadata.loading') }}</p>
      </div>
      <el-form v-else label-width="80px">
        <el-form-item :label="$t('contractV2.metadata.contractNumber')">
          <el-input v-model="editableMetadata.contract_number" :placeholder="$t('contractV2.metadata.contractNumberPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('contractV2.metadata.partyA')">
          <el-input v-model="editableMetadata.party_a" :placeholder="$t('contractV2.metadata.partyAPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('contractV2.metadata.partyB')">
          <el-input v-model="editableMetadata.party_b" :placeholder="$t('contractV2.metadata.partyBPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('contractV2.metadata.contractAmount')">
          <el-input-number v-model="editableMetadata.contract_amount" :min="0" :precision="2" :placeholder="$t('contractV2.metadata.contractAmountPlaceholder')" style="width: 100%;" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showMetadataDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="savingMetadata" @click="handleSaveMetadata">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.contract-detail {
  padding: 0 4px;
}

.contract-detail-header {
  margin-bottom: 12px;
}

.contract-detail-info {
  margin-bottom: 8px;
}

.contract-detail-title {
  margin: 0 0 8px 0;
  font-size: 20px;
}

.contract-detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.contract-detail-versions {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.contract-detail-section {
  margin-top: 16px;
}

.contract-detail-section h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
}

.contract-detail-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.contract-detail-section-header h3 {
  margin: 0;
}

.processing-status-area {
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
}

.processing-status-row {
  display: flex;
  align-items: center;
}

.processing-error-info {
  margin-top: 8px;
  font-size: 13px;
}

.processing-error-label {
  color: var(--el-text-color-secondary);
}

.processing-error-code {
  color: var(--el-color-danger);
  font-family: monospace;
}

.processing-pending-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.classification-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.classification-item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 12px 16px;
}

.classification-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.classification-title {
  font-size: 14px;
  font-weight: 500;
}

.classification-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.classification-reason-tag {
  display: inline-block;
  padding: 2px 8px;
  font-size: 12px;
  background: var(--el-fill-color);
  border-radius: 4px;
  color: var(--el-text-color-secondary);
}

.upload-zone {
  padding: 20px;
  text-align: center;
}

.form-item {
  margin-bottom: 16px;
  text-align: left;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.upload-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 30px 0;
  color: var(--el-text-color-secondary);
}

.upload-drop {
  padding: 20px 0;
}

.upload-drop p {
  margin: 0 0 8px;
  color: var(--el-text-color-regular);
}

.upload-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 16px !important;
}

.upload-btn {
  display: inline-block;
  padding: 8px 24px;
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.hidden-input {
  display: none;
}

.detail-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px 16px;
  padding: 8px 0;
}

.detail-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.detail-value {
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.compare-summary {
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.compare-direction-alert {
  margin-bottom: 12px;
}

.compare-duration {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}

.compare-running-state {
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.compare-running-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.compare-running-primary {
  color: var(--el-text-color-primary);
}

.compare-running-elapsed {
  color: var(--el-color-primary);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.compare-running-hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.mono-text {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
}

.kc-title {
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.kc-body {
  font-size: 12px;
  line-height: 1.7;
  padding: 4px 8px;
}
.kc-old {
  color: var(--el-color-danger);
  margin-bottom: 6px;
}
.kc-new {
  color: var(--el-color-success);
}
.compare-summary-extra {
  margin-left: 8px;
  color: var(--el-color-warning);
}
.compare-config-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}
.compare-side {
  flex: 1;
  min-width: 0;
}
.compare-side-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.compare-side-value {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
