<template>
  <div v-if="visible" class="dialog-overlay" @click.self="close">
    <div class="dialog dialog-xl" :class="{ 'dialog-fullscreen': isFullscreen }">
      <div class="dialog-header">
        <h3>{{ $t('apps.compare.title') }}</h3>
        <div class="header-actions">
          <el-button @click="isFullscreen = !isFullscreen" size="small" circle :title="$t('apps.compare.fullscreen')">
            {{ isFullscreen ? '⧉' : '⛶' }}
          </el-button>
          <el-button @click="close">×</el-button>
        </div>
      </div>
      <div class="dialog-body">

        <template v-if="phase === 'config'">
          <div class="compare-records-info">
            <div class="record-card">
              <div class="record-label">📄 {{ $t('apps.compare.baseContract') }}</div>
              <div class="record-detail">{{ recordADisplay }}</div>
            </div>
            <div class="swap-btn-wrapper">
              <el-button @click="swapRecords" circle size="small" :title="$t('apps.compare.swap')">
                ⇄
              </el-button>
            </div>
            <div class="record-card">
              <div class="record-label">📄 {{ $t('apps.compare.targetContract') }}</div>
              <div class="record-detail">{{ recordBDisplay }}</div>
            </div>
          </div>

          <div class="config-section">
            <div class="config-row">
              <label class="config-label">{{ $t('apps.compare.model') }}</label>
              <el-select v-model="modelId" clearable :placeholder="$t('apps.compare.modelPlaceholder')" style="flex: 1">
                <el-option v-for="m in models" :key="m.id" :value="m.id" :label="`${m.name} (${m.provider_name})`" />
              </el-select>
            </div>
            <div class="config-row">
              <label class="config-label">{{ $t('apps.compare.temperature') }}</label>
              <el-slider v-model="temperature" :min="0" :max="1" :step="0.1" show-input style="flex: 1" />
            </div>
            <div class="config-row">
              <label class="config-label">{{ $t('apps.compare.concurrency') }}</label>
              <el-input-number v-model="concurrency" :min="1" :max="10" :step="1" style="flex: 1" />
              <span class="config-hint">{{ $t('apps.compare.concurrencyHint') }}</span>
            </div>
          </div>
        </template>

        <template v-if="phase === 'loading'">
          <div class="loading-section" v-loading="true" :element-loading-text="$t('apps.compare.processing')" element-loading-background="transparent">
          </div>
        </template>

        <template v-if="phase === 'report'">
          <div class="report-header">
            <div class="report-summary">
              <span class="summary-item">📊 {{ $t('apps.compare.totalSections', { count: reportData.summary.total }) }}</span>
              <span class="summary-item identical">🟢 {{ reportData.summary.identical }}</span>
              <span class="summary-item modified">🟡 {{ reportData.summary.modified }}</span>
              <span class="summary-item added">🔵 {{ reportData.summary.added }}</span>
              <span class="summary-item removed">🔴 {{ reportData.summary.removed }}</span>
              <span v-if="reportData.duration_ms" class="summary-item">⏱ {{ (reportData.duration_ms / 1000).toFixed(1) }}s</span>
            </div>
            <div class="report-filter">
              <el-radio-group v-model="reportFilter" size="small">
                <el-radio-button value="all">{{ $t('apps.compare.filterAll') }}</el-radio-button>
                <el-radio-button value="diff">{{ $t('apps.compare.filterDiff') }}</el-radio-button>
                <el-radio-button value="high">{{ $t('apps.compare.filterHigh') }}</el-radio-button>
              </el-radio-group>
            </div>
          </div>

          <div class="report-sections">
            <div
              v-for="(item, idx) in filteredResults"
              :key="`${idx}-${item.change_type}`"
              class="report-section-item"
              :class="{ collapsed: !expandedSections.has(String(idx)) }"
            >
              <div class="section-header" @click="toggleSection(String(idx))">
                <span class="collapse-toggle">{{ expandedSections.has(String(idx)) ? '▼' : '▶' }}</span>
                <span class="section-title">{{ item.title }}</span>
                <span :class="['change-badge', `change-${item.change_type}`]">{{ getChangeTypeLabel(item.change_type) }}</span>
                <span v-if="item.risk_level && item.risk_level !== 'low'" :class="['risk-badge', `risk-${item.risk_level}`]">
                  {{ item.risk_level }}
                </span>
              </div>
              <div v-if="expandedSections.has(String(idx))" class="section-body">
                <p class="section-summary">{{ item.summary }}</p>
                <div v-if="item.key_changes && item.key_changes.length > 0" class="key-changes">
                  <div v-for="(change, cidx) in item.key_changes" :key="cidx" class="change-item">
                    <p class="change-desc">{{ change.description }}</p>
                    <div v-if="change.old || change.new" class="change-diff">
                      <div v-if="change.old" class="diff-old">
                        <span class="diff-label">{{ $t('apps.compare.base') }}：</span>{{ change.old }}
                      </div>
                      <div v-if="change.new" class="diff-new">
                        <span class="diff-label">{{ $t('apps.compare.target') }}：</span>{{ change.new }}
                      </div>
                    </div>
                  </div>
                </div>
                <div v-if="item.content_preview" class="content-preview">
                  <p class="preview-text">{{ item.content_preview }}<template v-if="item.content_preview.length >= 200">...</template></p>
                </div>
              </div>
            </div>
          </div>
        </template>

      </div>
      <div class="dialog-footer">
        <template v-if="phase === 'config'">
          <el-button @click="close">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" @click="startCompare" :disabled="isComparing">{{ $t('apps.compare.startCompare') }}</el-button>
        </template>
        <template v-if="phase === 'loading'">
          <el-button @click="cancelCompare">{{ $t('common.cancel') }}</el-button>
        </template>
        <template v-if="phase === 'report'">
          <el-button @click="exportExcel" :loading="isExporting">{{ $t('apps.compare.exportExcel') }}</el-button>
          <el-button @click="close">{{ $t('common.close') }}</el-button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toast'
import {
  compareRecords,
  getAvailableResources,
  type MiniApp,
  type MiniAppRecord,
  type InternalLlmModel,
  type CompareSectionResult,
  type SavedCompareResult,
} from '@/api/mini-apps'

const props = defineProps<{
  visible: boolean
  app: MiniApp
  records: MiniAppRecord[]
  savedResult?: SavedCompareResult | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
const toast = useToastStore()

type Phase = 'config' | 'loading' | 'report'
const phase = ref<Phase>('config')
const models = ref<InternalLlmModel[]>([])
const modelId = ref<string>('')
const temperature = ref(0.3)
const concurrency = ref(3)
const isComparing = ref(false)
const cancelled = ref(false)
const abortController = ref<AbortController | null>(null)
const reportData = ref<{ results: CompareSectionResult[]; summary: { total: number; identical: number; modified: number; added: number; removed: number }; duration_ms?: number }>({ results: [], summary: { total: 0, identical: 0, modified: 0, added: 0, removed: 0 } })
const reportFilter = ref<'all' | 'diff' | 'high'>('all')
const expandedSections = ref<Set<string>>(new Set())
const isFullscreen = ref(false)
const isExporting = ref(false)

const swapped = ref(false)

const recordA = computed(() => swapped.value ? (props.records[1] || null) : (props.records[0] || null))
const recordB = computed(() => swapped.value ? (props.records[0] || null) : (props.records[1] || null))

function swapRecords() {
  swapped.value = !swapped.value
}

const recordADisplay = computed(() => {
  if (!recordA.value) return ''
  const d = recordA.value
  return [d.contract_number, d.party_a, d.contract_amount].filter(Boolean).join(' | ') || d.title || d.id
})

const recordBDisplay = computed(() => {
  if (!recordB.value) return ''
  const d = recordB.value
  return [d.contract_number, d.party_a, d.contract_amount].filter(Boolean).join(' | ') || d.title || d.id
})

const filteredResults = computed(() => {
  const results = reportData.value.results
  if (reportFilter.value === 'diff') {
    return results.filter(r => r.change_type !== 'identical')
  }
  if (reportFilter.value === 'high') {
    return results.filter(r => r.risk_level === 'high')
  }
  return results
})

function getChangeTypeLabel(type: string): string {
  const map: Record<string, string> = {
    identical: t('apps.compare.typeIdentical'),
    modified: t('apps.compare.typeModified'),
    semantic_change: t('apps.compare.typeSemanticChange'),
    added: t('apps.compare.typeAdded'),
    removed: t('apps.compare.typeRemoved'),
    error: t('apps.compare.typeError'),
  }
  return map[type] || type
}

function toggleSection(title: string) {
  if (expandedSections.value.has(title)) {
    expandedSections.value.delete(title)
  } else {
    expandedSections.value.add(title)
  }
}

async function loadModels() {
  try {
    const resources = await getAvailableResources(props.app.id)
    models.value = resources.internal_llm?.models || []
    if (models.value.length > 0 && !modelId.value) {
      modelId.value = models.value[0]?.id || ''
    }
  } catch {
    models.value = []
  }
}

async function startCompare() {
  if (!recordA.value || !recordB.value) return
  isComparing.value = true
  cancelled.value = false
  phase.value = 'loading'

  const ac = new AbortController()
  abortController.value = ac

  try {
    const result = await compareRecords(props.app.id, recordA.value.id, recordB.value.id, {
      model_id: modelId.value,
      temperature: temperature.value,
      concurrency: concurrency.value,
    }, ac.signal)

    if (!cancelled.value) {
      reportData.value = result
      phase.value = 'report'
      expandedSections.value = new Set(result.results.map((r, i) => r.change_type !== 'identical' ? String(i) : '').filter(Boolean))
    }
  } catch (error) {
    if (ac.signal.aborted) {
      phase.value = 'config'
    } else if (!cancelled.value) {
      toast.error(error instanceof Error ? error.message : t('apps.compare.compareFailed'))
      phase.value = 'config'
    }
  } finally {
    isComparing.value = false
    abortController.value = null
  }
}

function cancelCompare() {
  cancelled.value = true
  abortController.value?.abort()
  phase.value = 'config'
}

async function exportExcel() {
  isExporting.value = true
  try {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.default.Workbook()

    const detailSheet = workbook.addWorksheet(t('apps.compare.sheetDetail'))
    detailSheet.columns = [
      { header: t('apps.compare.colSection'), key: 'section', width: 30 },
      { header: t('apps.compare.colChangeType'), key: 'changeType', width: 14 },
      { header: t('apps.compare.colRiskLevel'), key: 'riskLevel', width: 12 },
      { header: t('apps.compare.colSummary'), key: 'summary', width: 50 },
      { header: t('apps.compare.colChanges'), key: 'changes', width: 40 },
      { header: t('apps.compare.colBase'), key: 'base', width: 30 },
      { header: t('apps.compare.colTarget'), key: 'target', width: 30 },
    ]

    const headerRow = detailSheet.getRow(1)
    headerRow.font = { bold: true }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }

    const changeTypeMap: Record<string, string> = {
      identical: t('apps.compare.typeIdentical'),
      modified: t('apps.compare.typeModified'),
      semantic_change: t('apps.compare.typeSemanticChange'),
      added: t('apps.compare.typeAdded'),
      removed: t('apps.compare.typeRemoved'),
      error: t('apps.compare.typeError'),
    }

    const changeColors: Record<string, string> = {
      identical: 'FFE8F5E9',
      modified: 'FFFFF3E0',
      semantic_change: 'FFFFF3E0',
      added: 'FFE3F2FD',
      removed: 'FFFCE4EC',
      error: 'FFEFEBE9',
    }

    for (const item of reportData.value.results) {
      const changes = (item.key_changes || [])
        .map(c => c.description)
        .join('; ')
      const baseParts = (item.key_changes || [])
        .filter(c => c.old)
        .map(c => c.old)
        .join('\n')
      const targetParts = (item.key_changes || [])
        .filter(c => c.new)
        .map(c => c.new)
        .join('\n')

      const row = detailSheet.addRow({
        section: item.title,
        changeType: changeTypeMap[item.change_type] || item.change_type,
        riskLevel: item.risk_level || 'low',
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

    const summarySheet = workbook.addWorksheet(t('apps.compare.sheetSummary'))
    summarySheet.columns = [
      { header: t('apps.compare.colMetric'), key: 'metric', width: 20 },
      { header: t('apps.compare.colValue'), key: 'value', width: 12 },
    ]

    const summaryHeaderRow = summarySheet.getRow(1)
    summaryHeaderRow.font = { bold: true }
    summaryHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }

    const s = reportData.value.summary
    summarySheet.addRow({ metric: t('apps.compare.totalSections', { count: '' }).replace(/\s*$/, ''), value: s.total })
    summarySheet.addRow({ metric: t('apps.compare.typeIdentical'), value: s.identical })
    summarySheet.addRow({ metric: t('apps.compare.typeModified'), value: s.modified })
    summarySheet.addRow({ metric: t('apps.compare.typeAdded'), value: s.added })
    summarySheet.addRow({ metric: t('apps.compare.typeRemoved'), value: s.removed })

    if (reportData.value.duration_ms) {
      summarySheet.addRow({ metric: t('apps.compare.duration'), value: `${(reportData.value.duration_ms / 1000).toFixed(1)}s` })
    }

    const nameA = recordADisplay.value || 'A'
    const nameB = recordBDisplay.value || props.savedResult?.target_row_id || 'B'
    const filename = `compare_${nameA}_vs_${nameB}.xlsx`.replace(/[\\/:*?"<>|]/g, '_')

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)

    toast.success(t('apps.compare.exportSuccess'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('apps.compare.exportFailed'))
  } finally {
    isExporting.value = false
  }
}

function close() {
  phase.value = 'config'
  emit('close')
}

watch(() => props.visible, (val) => {
  if (val) {
    if (props.savedResult) {
      phase.value = 'report'
      reportData.value = {
        results: props.savedResult.results || [],
        summary: props.savedResult.summary || { total: 0, identical: 0, modified: 0, added: 0, removed: 0 },
        duration_ms: props.savedResult.duration_ms || undefined,
      }
      expandedSections.value = new Set(
        (props.savedResult.results || [])
          .map((r, i) => r.change_type !== 'identical' ? String(i) : '')
          .filter(Boolean)
      )
    } else {
      phase.value = 'config'
      reportData.value = { results: [], summary: { total: 0, identical: 0, modified: 0, added: 0, removed: 0 } }
      expandedSections.value = new Set()
      loadModels()
    }
    reportFilter.value = 'all'
    isFullscreen.value = false
  }
})

function preventEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    e.preventDefault()
    e.stopPropagation()
  }
}

onMounted(() => document.addEventListener('keydown', preventEsc, true))
onUnmounted(() => document.removeEventListener('keydown', preventEsc, true))
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.dialog {
  background: var(--color-bg-primary, #fff);
  border-radius: 12px;
  width: 100%;
  max-width: 640px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.dialog-xl {
  max-width: 960px;
  max-height: 85vh;
}

.dialog-fullscreen {
  max-width: 100vw;
  max-height: 100vh;
  width: 100vw;
  height: 100vh;
  border-radius: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.dialog-body {
  padding: 20px;
  overflow: auto;
  flex: 1;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border, #e0e0e0);
}

.compare-records-info {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 20px;
}

.record-card {
  padding: 12px;
  background: var(--color-bg-secondary, #f5f7fa);
  border-radius: 8px;
}

.record-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}

.record-detail {
  font-size: 13px;
  color: var(--color-text-secondary, #666);
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.config-label {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  min-width: 60px;
}

.config-hint {
  font-size: 11px;
  color: var(--color-text-tertiary, #999);
  margin-left: 8px;
}

.loading-section {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.report-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.report-summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
}

.summary-item {
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--color-bg-secondary, #f5f7fa);
}

.report-sections {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.report-section-item {
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  background: var(--color-bg-secondary, #f8f9fa);
  user-select: none;
}

.section-header:hover {
  background: var(--color-bg-tertiary, #eee);
}

.collapse-toggle {
  font-size: 11px;
  color: var(--color-text-secondary, #999);
}

.section-title {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}

.change-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}

.change-identical { background: #e8f5e9; color: #2e7d32; }
.change-modified, .change-semantic_change { background: #fff3e0; color: #ef6c00; }
.change-added { background: #e3f2fd; color: #1565c0; }
.change-removed { background: #fce4ec; color: #c62828; }
.change-error { background: #efebe9; color: #795548; }

.risk-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}

.risk-medium { background: #fff3e0; color: #ef6c00; }
.risk-high { background: #fce4ec; color: #c62828; }

.section-body {
  padding: 12px 14px;
}

.section-summary {
  font-size: 13px;
  margin: 0 0 10px 0;
  color: var(--color-text-primary, #333);
}

.key-changes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.change-item {
  padding: 8px 12px;
  background: var(--color-bg-secondary, #f5f7fa);
  border-radius: 6px;
}

.change-desc {
  font-size: 13px;
  margin: 0 0 6px 0;
  font-weight: 500;
}

.change-diff {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.diff-old, .diff-new {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
}

.diff-old {
  background: #fce4ec;
}

.diff-new {
  background: #e8f5e9;
}

.diff-label {
  font-weight: 600;
  color: var(--color-text-secondary, #666);
}

.content-preview {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--color-bg-secondary, #f5f7fa);
  border-radius: 6px;
}

.preview-text {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary, #666);
  white-space: pre-wrap;
}
</style>
