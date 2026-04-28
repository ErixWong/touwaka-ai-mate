<template>
  <div v-if="visible" class="dialog-overlay" @click.self="close">
    <div class="dialog dialog-xl">
      <div class="dialog-header">
        <h3>{{ $t('apps.compare.title') }}</h3>
        <el-button @click="close">×</el-button>
      </div>
      <div class="dialog-body">

        <template v-if="phase === 'config'">
          <div class="compare-records-info">
            <div class="record-card">
              <div class="record-label">📄 {{ $t('apps.compare.baseContract') }}</div>
              <div class="record-detail">{{ recordADisplay }}</div>
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
          <div class="loading-section">
            <div class="loading-spinner">
              <el-icon class="is-loading" :size="32"><Loading /></el-icon>
              <p>{{ $t('apps.compare.processing') }}</p>
              <p class="loading-hint">{{ $t('apps.compare.processingHint') }}</p>
            </div>
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
          <el-button @click="close">{{ $t('common.close') }}</el-button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toast'
import { Loading } from '@element-plus/icons-vue'
import {
  compareRecords,
  getAvailableResources,
  type MiniApp,
  type MiniAppRecord,
  type InternalLlmModel,
  type CompareSectionResult,
} from '@/api/mini-apps'

const props = defineProps<{
  visible: boolean
  app: MiniApp
  records: MiniAppRecord[]
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
const reportData = ref<{ results: CompareSectionResult[]; summary: { total: number; identical: number; modified: number; added: number; removed: number } }>({ results: [], summary: { total: 0, identical: 0, modified: 0, added: 0, removed: 0 } })
const reportFilter = ref<'all' | 'diff' | 'high'>('all')
const expandedSections = ref<Set<string>>(new Set())

const recordA = computed(() => props.records[0] || null)
const recordB = computed(() => props.records[1] || null)

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
      modelId.value = models.value[0].id
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

function close() {
  phase.value = 'config'
  emit('close')
}

watch(() => props.visible, (val) => {
  if (val) {
    phase.value = 'config'
    reportData.value = { results: [], summary: { total: 0, identical: 0, modified: 0, added: 0, removed: 0 } }
    expandedSections.value = new Set()
    reportFilter.value = 'all'
    loadModels()
  }
})
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
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
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
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 20px;
}

.loading-spinner {
  text-align: center;
}

.loading-spinner p {
  margin: 12px 0 0;
  font-size: 14px;
  color: var(--color-text-secondary, #666);
}

.loading-hint {
  font-size: 12px;
  color: var(--color-text-tertiary, #999);
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
