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
            <th v-for="col in listColumns" :key="col.name">{{ col.label }}</th>
            <th>{{ $t('apps.status') }}</th>
            <th>{{ $t('apps.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id">
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

    <div v-if="showDialog" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog">
        <div class="dialog-header">
          <h3>{{ dialogTitle }}</h3>
          <el-button @click="closeDialog">×</el-button>
        </div>
        <div class="dialog-body">
          <div class="form-grid">
            <div v-for="field in editableFields" :key="field.name" class="form-field" :class="{ 'field-full': field.type === 'textarea' || field.type === 'file' }">
              <label class="field-label">
                {{ field.label }}
                <span v-if="field.required" class="required">*</span>
              </label>
              <FieldRenderer :field="field" :model-value="formData[field.name]" :app="app" :record-id="dialogMode === 'create' ? newRecordId : selectedRecord?.id" @update:model-value="formData[field.name] = $event" />
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <el-button @click="closeDialog">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" @click="saveRecord" :disabled="isSaving">{{ isSaving ? $t('common.saving') : $t('common.save') }}</el-button>
        </div>
      </div>
    </div>

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
        <el-tab-pane label="OCR原文" name="ocr">
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

    <div v-if="showConfirm" class="dialog-overlay" @click.self="cancelConfirm">
      <div class="dialog dialog-small">
        <div class="dialog-header">
          <h3>{{ $t('apps.confirmDelete') }}</h3>
          <el-button @click="cancelConfirm">×</el-button>
        </div>
        <div class="dialog-body">
          <p>{{ $t('apps.confirmDeleteMessage') }}</p>
        </div>
        <div class="dialog-footer">
          <el-button @click="cancelConfirm">{{ $t('common.cancel') }}</el-button>
          <el-button type="danger" @click="confirmDelete">{{ $t('common.delete') }}</el-button>
        </div>
      </div>
    </div>

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
  return fields.filter(f => {
    if (f.type === 'group' || f.type === 'repeating') return false
    if (dialogMode.value === 'create' && f.ai_extractable && f.type !== 'file') return false
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
  // 初始化所有字段的默认值
    const initialData: Record<string, unknown> = {}
  let fields = props.app.fields || []
  // 处理后端返回的 JSON 字符串
  if (typeof fields === 'string') {
    try {
      fields = JSON.parse(fields)
    } catch {
      fields = []
    }
  }
  for (const field of fields) {
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
  formData.value = { ...record.data }
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

function cancelConfirm() {
  showConfirm.value = false
  confirmTarget.value = null
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
    cancelConfirm()
  }
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

/* Header */
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

.btn-back {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-secondary, #666);
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-back:hover {
  color: var(--color-primary, #4a90d9);
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

.btn-primary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: var(--color-primary, #4a90d9);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary .icon {
  font-size: 16px;
}

/* Filter Panel */
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

.filter-item select,
.filter-item input {
  padding: 6px 12px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  font-size: 14px;
  background: var(--color-bg-primary, #fff);
  min-width: 120px;
}

.filter-item input {
  min-width: 200px;
}

.filter-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.btn-reset {
  padding: 6px 16px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  background: var(--color-bg-primary, #fff);
}

.btn-reset:hover {
  opacity: 0.9;
}

/* List Content */
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

/* Table */
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

.record-table td {
  color: var(--color-text-primary, #333);
}

.actions-cell {
  white-space: nowrap;
}

.btn-action {
  padding: 4px 10px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  background: var(--color-bg-primary, #fff);
  cursor: pointer;
  font-size: 13px;
  margin-right: 6px;
  color: var(--color-text-secondary, #666);
}

.btn-action:hover {
  border-color: var(--color-primary, #4a90d9);
  color: var(--color-primary, #4a90d9);
}

.btn-action.btn-danger {
  color: var(--color-danger, #e74c3c);
  border-color: var(--color-danger, #e74c3c);
}

.btn-action.btn-danger:hover {
  background: var(--color-danger, #e74c3c);
  color: #fff;
}

/* Pagination */
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

.page-btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  background: var(--color-bg-primary, #fff);
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-secondary, #666);
}

.page-btn:hover:not(:disabled) {
  border-color: var(--color-primary, #4a90d9);
  color: var(--color-primary, #4a90d9);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-numbers {
  display: flex;
  gap: 4px;
}

.page-num {
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  background: var(--color-bg-primary, #fff);
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-num:hover {
  border-color: var(--color-primary, #4a90d9);
  color: var(--color-primary, #4a90d9);
}

.page-num.active {
  background: var(--color-primary, #4a90d9);
  color: #fff;
  border-color: var(--color-primary, #4a90d9);
}

.page-info {
  font-size: 13px;
  color: var(--color-text-secondary, #666);
  margin-left: 12px;
}

/* Detail Dialog */
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

.btn-cancel {
  padding: 8px 20px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  cursor: pointer;
  font-size: var(--el-font-size-base);
}

.btn-cancel:hover {
  background: var(--el-fill-color-light);
}

.btn-danger {
  padding: 8px 20px;
  border: none;
  border-radius: var(--el-border-radius-base);
  background: var(--el-color-danger);
  color: #fff;
  cursor: pointer;
  font-size: var(--el-font-size-base);
  font-weight: 500;
}

.btn-danger:hover {
  opacity: 0.9;
}
</style>
