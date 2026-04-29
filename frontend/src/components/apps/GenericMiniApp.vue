<template>
  <div class="generic-mini-app">
    <div class="app-header">
      <div class="header-left">
        <el-button @click="goBack">← {{ $t('apps.back') }}</el-button>
        <span class="app-icon">{{ app.icon }}</span>
        <h1 class="app-name">{{ app.name }}</h1>
      </div>
      <div class="header-right">
        <el-button @click="showStepConfig = true">⚙ {{ $t('apps.stepConfig.title') }}</el-button>
        <el-button
          type="warning"
          :disabled="selectedRows.length !== 2"
          @click="openCompare"
        >
          ⚖ {{ $t('apps.compare.title') }}
          <span v-if="selectedRows.length > 0 && selectedRows.length !== 2" class="compare-hint">
            ({{ $t('apps.compare.selectTwo') }})
          </span>
        </el-button>
        <el-button v-if="canCreate" type="primary" @click="openCreateDialog">
          <span class="icon">+</span>
          {{ $t('common.create') }}
        </el-button>
      </div>
    </div>

    <div class="filter-panel">
      <div class="filter-row">
        <div class="filter-item">
          <label>{{ $t('apps.status') }}</label>
          <el-select v-model="filters.status" @change="handleFilterChange" clearable>
            <el-option value="" :label="$t('apps.all')" />
            <el-option v-for="state in app.states || []" :key="state.name" :value="state.name" :label="state.label || state.name" />
          </el-select>
        </div>
        <div class="filter-actions">
          <el-button @click="resetFilters">{{ $t('apps.reset') }}</el-button>
        </div>
      </div>
    </div>

    <div class="list-content">
      <div v-if="isLoading" class="loading-state">{{ $t('common.loading') }}</div>
      
      <div v-else-if="records.length === 0" class="empty-state">
        <div class="empty-icon">📄</div>
        <p>{{ $t('apps.emptyRecords') }}</p>
        <el-button v-if="canCreate" type="primary" @click="openCreateDialog">{{ $t('apps.createFirst') }}</el-button>
      </div>

      <table v-else class="record-table">
        <thead>
          <tr>
            <th class="checkbox-col">
              <input type="checkbox" :checked="isAllSelected" :indeterminate.prop="isPartialSelected" @change="toggleAll" />
            </th>
            <th v-for="col in listColumns" :key="col.name">{{ col.label }}</th>
            <th>{{ $t('apps.status') }}</th>
            <th>{{ $t('apps.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id" :class="{ 'row-selected': isSelected(record) }">
            <td class="checkbox-col">
              <input type="checkbox" :checked="isSelected(record)" @change="toggleRow(record)" />
            </td>
            <td v-for="col in listColumns" :key="col.name">
              {{ formatFieldValue(col._isExtension ? record[col.name] : record.data?.[col.name], col) }}
            </td>
            <td>
              <StateBadge :status="record.status" :states="app.states || []" />
            </td>
            <td class="actions-cell">
              <el-button size="small" @click="viewRecord(record)">{{ $t('apps.view') }}</el-button>
              <el-button v-if="canEdit(record)" size="small" @click="editRecord(record)">{{ $t('apps.edit') }}</el-button>
              <el-button v-if="canDelete(record)" size="small" type="danger" @click="handleDelete(record)">{{ $t('apps.delete') }}</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pagination.pages > 1" class="pagination">
      <el-button size="small" :disabled="pagination.page <= 1" @click="loadPage(pagination.page - 1)">← {{ $t('apps.prevPage') }}</el-button>
      <div class="page-numbers">
        <el-button size="small" :type="page === pagination.page ? 'primary' : ''" v-for="page in visiblePages" :key="page" @click="loadPage(page)">{{ page }}</el-button>
      </div>
      <el-button size="small" :disabled="pagination.page >= pagination.pages" @click="loadPage(pagination.page + 1)">{{ $t('apps.nextPage') }} →</el-button>
      <span class="page-info">{{ $t('apps.totalRecords', { count: pagination.total }) }}</span>
    </div>

    <el-dialog v-model="showDialog" :title="dialogTitle" width="680px" destroy-on-close @close="closeDialog">
      <div class="form-grid">
        <div v-for="field in editableFields" :key="field.name" class="form-field" :class="{ 'field-full': field.type === 'textarea' || field.type === 'file' }">
          <label class="field-label">
            {{ field.label }}
            <span v-if="field.required" class="required">*</span>
          </label>
          <FieldRenderer :field="field" :model-value="formData[field.name]" :app="app" :record-id="dialogMode === 'create' ? newRecordId : selectedRecord?.id" @update:model-value="formData[field.name] = $event" />
        </div>
      </div>
      <template #footer>
        <el-button @click="closeDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveRecord" :disabled="isSaving">{{ isSaving ? $t('common.saving') : $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showDetail"
      :title="$t('apps.recordDetail')"
      width="1200px"
      top="5vh"
      destroy-on-close
    >
      <el-tabs v-model="detailTab">
        <el-tab-pane label="基础信息" name="basic">
          <div class="detail-grid">
            <div v-for="field in allFields" :key="field.name" class="detail-field">
              <label class="field-label">{{ field.label }}</label>
              <div class="field-value">
                {{ formatFieldValue(field._isExtension ? selectedRecord?.[field.name] : selectedRecord?.data?.[field.name], field) }}
              </div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane :label="ocrSourceLabel" name="ocr">
          <DocumentContentViewer
            :content-text="documentContent?.filtered_text || documentContent?.ocr_text || ''"
            :sections="documentContent?.sections || []"
            :highlights="[]"
          />
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="closeDetail">{{ $t('common.close') }}</el-button>
        <el-button v-if="documentContent?.has_content" @click="openReExtract">{{ $t('apps.reExtract.title') }}</el-button>
        <el-button v-if="canEdit(selectedRecord)" type="primary" @click="editFromDetail">{{ $t('apps.edit') }}</el-button>
      </template>
    </el-dialog>

    <ReExtractDialog
      :visible="showReExtract"
      :app-id="app.id"
      :record-id="selectedRecord?.id || ''"
      :last-prompt="documentContent?.extract_prompt || ''"
      :last-result="documentContent?.extract_json"
      :filtered-text="documentContent?.filtered_text || ''"
      @close="closeReExtract"
      @confirm="handleReExtractConfirm"
    />

    <ContractCompareDialog
      :visible="showCompare"
      :app="app"
      :records="selectedRows"
      @close="closeCompare"
    />

    <el-dialog v-model="showConfirm" :title="$t('apps.confirmDelete')" width="420px" destroy-on-close>
      <p>{{ $t('apps.confirmDeleteMessage') }}</p>
      <template #footer>
        <el-button @click="showConfirm = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="danger" @click="confirmDelete">{{ $t('common.delete') }}</el-button>
      </template>
    </el-dialog>

    <AppStepConfig :visible="showStepConfig" :app="app" @close="showStepConfig = false" @saved="loadRecords" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toast'
import {
  getRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  getDocumentContent,
  newID,
  type MiniApp,
  type MiniAppRecord,
  type AppField,
  type AppConfig,
  type DocumentContent,
} from '@/api/mini-apps'
import StateBadge from './StateBadge.vue'
import FieldRenderer from './FieldRenderer.vue'
import AppStepConfig from './AppStepConfig.vue'
import DocumentContentViewer from './DocumentContentViewer.vue'
import ReExtractDialog from './ReExtractDialog.vue'
import ContractCompareDialog from './ContractCompareDialog.vue'

const props = defineProps<{ app: MiniApp }>()
const router = useRouter()
const { t } = useI18n()
const toast = useToastStore()

// State
const records = ref<MiniAppRecord[]>([])
const selectedRecord = ref<MiniAppRecord | null>(null)
const formData = ref<Record<string, unknown>>({})
const isLoading = ref(false)
const isSaving = ref(false)
const showDialog = ref(false)
const showDetail = ref(false)
const showConfirm = ref(false)
const showStepConfig = ref(false)
const showReExtract = ref(false)
const confirmTarget = ref<MiniAppRecord | null>(null)
const dialogMode = ref<'create' | 'edit'>('create')
const detailTab = ref('basic')
const documentContent = ref<DocumentContent | null>(null)
const newRecordId = ref('')
const selectedRows = ref<MiniAppRecord[]>([])
const showCompare = ref(false)

const pagination = ref({
  page: 1,
  size: 10,
  total: 0,
  pages: 0
})

const filters = ref({ status: '' })

// Computed
const listColumns = computed(() => {
  let fields = props.app.fields
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields) } catch { return [] }
  }
  if (!fields || !Array.isArray(fields)) return []
  
  let config: Partial<AppConfig> = props.app.config || {}
  if (typeof config === 'string') {
    try { config = JSON.parse(config) as Partial<AppConfig> } catch { config = {} }
  }
  const extTables = config?.extension_tables || []
  const primaryTable = extTables.find(t => t.type === 'primary')
  const extFields: AppField[] = (primaryTable?.fields || []).map(f => ({
    name: f.name,
    label: f.label || f.name,
    type: 'text' as const,
    _isExtension: true
  }))
  
  const allFields: AppField[] = [...extFields, ...fields]
  
  let viewsObj = props.app.views
  if (typeof viewsObj === 'string') {
    try { viewsObj = JSON.parse(viewsObj) } catch { viewsObj = {} }
  }
  if (viewsObj?.list?.columns) {
    return viewsObj.list.columns
      .map((name: string) => allFields.find(f => f.name === name))
      .filter(Boolean) as AppField[]
  }
  return fields.slice(0, 5)
})

const editableFields = computed(() => {
  let fields = props.app.fields
  if (typeof fields === 'string') {
    try {
      fields = JSON.parse(fields)
    } catch {
      console.error('Failed to parse fields')
      return []
    }
  }
  if (!fields || !Array.isArray(fields)) {
    console.warn('Fields is not an array:', fields)
    return []
  }

  let config: Partial<AppConfig> = props.app.config || {}
  if (typeof config === 'string') {
    try { config = JSON.parse(config) as Partial<AppConfig> } catch { config = {} }
  }
  const extTables = config?.extension_tables || []
  const primaryTable = extTables.find(t => t.type === 'primary')
  const extFields: AppField[] = (primaryTable?.fields || []).map(f => ({
    name: f.name,
    label: f.label || f.name,
    type: (f.type === 'DECIMAL(15,2)' ? 'number' : f.type.startsWith('DATE') ? 'date' : 'text') as AppField['type'],
    required: f.required,
    _isExtension: true
  }))

  return [...extFields, ...fields].filter(f => {
    if (f.type === 'group' || f.type === 'repeating') return false
    if (dialogMode.value === 'create') {
      if (f.type === 'file') return true
      if (f.ai_extractable || f._isExtension) return false
    }
    return true
  })
})

const allFields = computed(() => {
  let fields = props.app.fields
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields) } catch { return [] }
  }
  if (!fields || !Array.isArray(fields)) return []
  
  let config: Partial<AppConfig> = props.app.config || {}
  if (typeof config === 'string') {
    try { config = JSON.parse(config) as Partial<AppConfig> } catch { config = {} }
  }
  const extTables = config?.extension_tables || []
  const primaryTable = extTables.find(t => t.type === 'primary')
  const extFields: AppField[] = (primaryTable?.fields || []).map(f => ({
    name: f.name,
    label: f.label || f.name,
    type: 'text' as const,
    _isExtension: true
  }))
  
  return [...extFields, ...fields]
})

const dialogTitle = computed(() => {
  return dialogMode.value === 'create' ? t('apps.newRecord') : t('apps.editRecord')
})

const canCreate = computed(() => true)

const visiblePages = computed(() => {
  const current = pagination.value.page
  const total = pagination.value.pages
  const delta = 2
  const range = []
  for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) {
    range.push(i)
  }
  return range
})

// Methods
function canEdit(record: MiniAppRecord | null): boolean {
  if (!record) return false
  // TODO: 检查权限
  return true
}

function canDelete(record: MiniAppRecord | null): boolean {
  if (!record) return false
  // TODO: 检查权限
  return true
}

function goBack() {
  router.push('/apps')
}

function formatFieldValue(value: unknown, field: AppField): string {
  if (value === null || value === undefined) return '-'
  if (field.type === 'select' && field.options) return String(value)
  if (field.type === 'date') return String(value)
  if (field.type === 'number') return typeof value === 'number' ? value.toLocaleString() : String(value)
  if (field.type === 'boolean') return value ? t('apps.yes') : t('apps.no')
  return String(value)
}

async function loadRecords() {
  isLoading.value = true
  try {
    const filter: Record<string, string> = {}
    if (filters.value.status) {
      filter.status = filters.value.status
    }
    
    const result = await getRecords(props.app.id, {
      page: pagination.value.page,
      size: pagination.value.size,
      filter: Object.keys(filter).length > 0 ? JSON.stringify(filter) : undefined,
    })
    
    records.value = result.items || []
    if (result.pagination) {
      pagination.value = {
        page: result.pagination.page,
        size: result.pagination.size,
        total: result.pagination.total,
        pages: result.pagination.pages,
      }
    }
  } catch (error) {
    console.error('Failed to load records:', error)
  } finally {
    isLoading.value = false
  }
}

function loadPage(page: number) {
  pagination.value.page = page
  loadRecords()
}

function handleFilterChange() {
  pagination.value.page = 1
  loadRecords()
}

function resetFilters() {
  filters.value = { status: '' }
  handleFilterChange()
}

async function openCreateDialog() {
  dialogMode.value = 'create'
  newRecordId.value = await newID(20)
  const initialData: Record<string, unknown> = {}
  for (const field of editableFields.value) {
    if (field.type === 'file') {
      initialData[field.name] = null
    } else if (field.type === 'select') {
      initialData[field.name] = field.default || (field.options?.[0] || '')
    } else {
      initialData[field.name] = field.default || ''
    }
  }
  formData.value = initialData
  selectedRecord.value = null
  showDialog.value = true
}

async function viewRecord(record: MiniAppRecord) {
  selectedRecord.value = record
  showDetail.value = true
  detailTab.value = 'basic'
  documentContent.value = null
  
  try {
    documentContent.value = await getDocumentContent(props.app.id, record.id)
  } catch {
    documentContent.value = { has_content: false }
  }
}

function editRecord(record: MiniAppRecord) {
  dialogMode.value = 'edit'
  selectedRecord.value = record
  const data: Record<string, unknown> = { ...record.data }
  for (const field of editableFields.value) {
    if (field._isExtension && record[field.name] !== undefined) {
      data[field.name] = record[field.name]
    }
  }
  formData.value = data
  showDialog.value = true
}

function editFromDetail() {
  closeDetail()
  if (selectedRecord.value) {
    editRecord(selectedRecord.value)
  }
}

function closeDialog() {
  showDialog.value = false
  formData.value = {}
  selectedRecord.value = null
}

function closeDetail() {
  showDetail.value = false
  selectedRecord.value = null
}

const ocrSourceLabel = computed(() => {
  if (!documentContent.value) return 'OCR原文'
  if (documentContent.value.filtered_text && documentContent.value.sections?.length > 0) return '文档内容 (filtered_text + sections)'
  if (documentContent.value.filtered_text) return '文档内容 (filtered_text)'
  if (documentContent.value.ocr_text) return 'OCR原文 (ocr_text)'
  return 'OCR原文'
})

function openReExtract() {
  showReExtract.value = true
}

function closeReExtract() {
  showReExtract.value = false
}

async function handleReExtractConfirm(result: Record<string, unknown>) {
  if (selectedRecord.value) {
    try {
      await updateRecord(props.app.id, selectedRecord.value.id, { ...selectedRecord.value.data, ...result })
      toast.success(t('apps.updateSuccess'))
      await loadRecords()
      closeReExtract()
      closeDetail()
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : t('apps.saveFailed')
      toast.error(errorMsg)
    }
  }
}

async function saveRecord() {
  if (!formData.value) return
  
  isSaving.value = true
  try {
    // 收集所有文件字段的 attachment_id
    const attachmentIds: string[] = []
    for (const field of editableFields.value) {
      if (field.type === 'file') {
        const fieldValue = formData.value[field.name] as { attachment_id?: string } | null
        if (fieldValue?.attachment_id) {
          attachmentIds.push(fieldValue.attachment_id)
        }
      }
    }
    
    if (dialogMode.value === 'create') {
      await createRecord(props.app.id, formData.value, attachmentIds, newRecordId.value)
      toast.success(t('apps.createSuccess'))
    } else if (selectedRecord.value) {
      await updateRecord(props.app.id, selectedRecord.value.id, formData.value)
      toast.success(t('apps.updateSuccess'))
    }
    await loadRecords()
    closeDialog()
  } catch (error) {
    console.error('Failed to save record:', error)
    toast.error(t('apps.saveFailed'))
  } finally {
    isSaving.value = false
  }
}

async function handleDelete(record: MiniAppRecord) {
  confirmTarget.value = record
  showConfirm.value = true
}

async function confirmDelete() {
  if (!confirmTarget.value) return
  try {
    await deleteRecord(props.app.id, confirmTarget.value.id)
    toast.success(t('apps.deleteSuccess'))
    await loadRecords()
  } catch (error) {
    console.error('Failed to delete record:', error)
    toast.error(t('apps.deleteFailed'))
  } finally {
    showConfirm.value = false
    confirmTarget.value = null
  }
}

function isSelected(record: MiniAppRecord): boolean {
  return selectedRows.value.some(r => r.id === record.id)
}

function toggleRow(record: MiniAppRecord) {
  const idx = selectedRows.value.findIndex(r => r.id === record.id)
  if (idx >= 0) {
    selectedRows.value.splice(idx, 1)
  } else {
    if (selectedRows.value.length < 2) {
      selectedRows.value.push(record)
    }
  }
}

function toggleAll() {
  if (isAllSelected.value) {
    selectedRows.value = []
  } else {
    selectedRows.value = records.value.slice(0, 2)
  }
}

const isAllSelected = computed(() => {
  return records.value.length > 0 && records.value.length <= 2 && selectedRows.value.length === records.value.length
})

const isPartialSelected = computed(() => {
  return selectedRows.value.length > 0 && !isAllSelected.value
})

function openCompare() {
  if (selectedRows.value.length !== 2) return
  showCompare.value = true
}

function closeCompare() {
  showCompare.value = false
}

// Watch
watch(() => props.app.id, () => {
  loadRecords()
}, { immediate: true })
</script>

<style scoped>
.generic-mini-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-primary, #fff);
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
  background: var(--color-bg-primary, #fff);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-icon {
  font-size: 28px;
}

.app-name {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary, #333);
}

.filter-panel {
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
  background: var(--color-bg-secondary, #f8f9fa);
  flex-shrink: 0;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-item label {
  font-size: 14px;
  color: var(--color-text-secondary, #666);
  white-space: nowrap;
}

.filter-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.list-content {
  flex: 1;
  overflow: auto;
  padding: 0;
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-secondary, #666);
}

.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--color-text-secondary, #666);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-state p {
  margin-bottom: 24px;
  font-size: 14px;
}

.record-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.record-table thead {
  position: sticky;
  top: 0;
  z-index: 10;
}

.record-table th,
.record-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #eee);
}

.record-table th {
  font-weight: 600;
  color: var(--color-text-secondary, #666);
  background: var(--color-bg-secondary, #f8f9fa);
  white-space: nowrap;
}

.record-table tbody tr:hover {
  background: var(--color-bg-secondary, #f8f9fa);
}

.record-table tbody tr.row-selected {
  background: var(--el-color-warning-light-9, #fdf6ec);
}

.checkbox-col {
  width: 40px;
  text-align: center;
}

.record-table td {
  color: var(--color-text-primary, #333);
}

.actions-cell {
  white-space: nowrap;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid var(--color-border, #e0e0e0);
  background: var(--color-bg-primary, #fff);
  flex-shrink: 0;
}

.page-numbers {
  display: flex;
  gap: 4px;
}

.page-info {
  font-size: 13px;
  color: var(--color-text-secondary, #666);
  margin-left: 12px;
}

.compare-hint {
  font-size: 12px;
  opacity: 0.7;
  margin-left: 4px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.detail-field {
  display: flex;
  flex-direction: column;
}

.detail-field .field-value {
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
  border-radius: var(--el-border-radius-base);
  font-size: var(--el-font-size-base);
  color: var(--el-text-color-regular);
  min-height: 36px;
}
</style>
