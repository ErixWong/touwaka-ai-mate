<template>
  <div class="generic-mini-app">
    <div class="app-header">
      <div class="header-left">
        <button class="btn-back" @click="goBack">← {{ $t('apps.back') }}</button>
        <span class="app-icon">{{ app.icon }}</span>
        <h1 class="app-name">{{ app.name }}</h1>
      </div>
      <div class="header-right">
        <button v-if="canCreate" class="btn-primary" @click="openCreateDialog">
          <span class="icon">+</span>
          {{ $t('common.create') }}
        </button>
      </div>
    </div>

    <div class="filter-panel">
      <div class="filter-row">
        <div class="filter-item">
          <label>{{ $t('apps.status') }}</label>
          <select v-model="filters.status" @change="handleFilterChange">
            <option value="">{{ $t('apps.all') }}</option>
            <option v-for="state in app.states || []" :key="state.name" :value="state.name">
              {{ state.label || state.name }}
            </option>
          </select>
        </div>
        <div class="filter-actions">
          <button class="btn-reset" @click="resetFilters">{{ $t('apps.reset') }}</button>
        </div>
      </div>
    </div>

    <div class="list-content">
      <div v-if="isLoading" class="loading-state">{{ $t('common.loading') }}</div>
      
      <div v-else-if="records.length === 0" class="empty-state">
        <div class="empty-icon">📄</div>
        <p>{{ $t('apps.emptyRecords') }}</p>
        <button v-if="canCreate" class="btn-primary" @click="openCreateDialog">
          {{ $t('apps.createFirst') }}
        </button>
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
              {{ formatFieldValue(record.data?.[col.name], col) }}
            </td>
            <td>
              <StateBadge :status="record.data?._status" :states="app.states || []" />
            </td>
            <td class="actions-cell">
              <button class="btn-action" @click="viewRecord(record)">{{ $t('apps.view') }}</button>
              <button v-if="canEdit(record)" class="btn-action" @click="editRecord(record)">{{ $t('apps.edit') }}</button>
              <button v-if="canDelete(record)" class="btn-action btn-danger" @click="handleDelete(record)">{{ $t('apps.delete') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pagination.pages > 1" class="pagination">
      <button class="page-btn" :disabled="pagination.page <= 1" @click="loadPage(pagination.page - 1)">
        ← {{ $t('apps.prevPage') }}
      </button>
      <div class="page-numbers">
        <button v-for="page in visiblePages" :key="page" class="page-num" :class="{ active: page === pagination.page }"
          @click="loadPage(page)"
        >
          {{ page }}
        </button>
      </div>
      <button class="page-btn" :disabled="pagination.page >= pagination.pages" @click="loadPage(pagination.page + 1)">
        {{ $t('apps.nextPage') }} →
      </button>
      <span class="page-info">{{ $t('apps.totalRecords', { count: pagination.total }) }}</span>
    </div>

    <div v-if="showDialog" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog">
        <div class="dialog-header">
          <h3>{{ dialogTitle }}</h3>
          <button class="btn-close" @click="closeDialog">×</button>
        </div>
        <div class="dialog-body">
          <div class="form-grid">
            <div v-for="field in editableFields" :key="field.name" class="form-field" :class="{ 'field-full': field.type === 'textarea' || field.type === 'file' }">
              <label class="field-label">
                {{ field.label }}
                <span v-if="field.required" class="required">*</span>
              </label>
              <FieldRenderer :field="field" :model-value="formData[field.name]" @update:model-value="formData[field.name] = $event" />
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDialog">{{ $t('common.cancel') }}</button>
          <button class="btn-primary" @click="saveRecord" :disabled="isSaving">
            {{ isSaving ? $t('common.saving') : $t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showDetail" class="dialog-overlay" @click.self="closeDetail">
      <div class="dialog dialog-large">
        <div class="dialog-header">
          <h3>{{ $t('apps.recordDetail') }}</h3>
          <button class="btn-close" @click="closeDetail">×</button>
        </div>
        <div class="dialog-body">
          <div class="detail-grid">
            <div v-for="field in allFields" :key="field.name" class="detail-field">
              <label class="field-label">{{ field.label }}</label>
              <div class="field-value">
                {{ formatFieldValue(selectedRecord?.data?.[field.name], field) }}
              </div>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDetail">{{ $t('common.close') }}</button>
          <button v-if="canEdit(selectedRecord)" class="btn-primary" @click="editFromDetail">{{ $t('apps.edit') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showConfirm" class="dialog-overlay" @click.self="cancelConfirm">
      <div class="dialog dialog-small">
        <div class="dialog-header">
          <h3>{{ $t('apps.confirmDelete') }}</h3>
          <button class="btn-close" @click="cancelConfirm">×</button>
        </div>
        <div class="dialog-body">
          <p>{{ $t('apps.confirmDeleteMessage') }}</p>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="cancelConfirm">{{ $t('common.cancel') }}</button>
          <button class="btn-danger" @click="confirmDelete">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </div>
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
  type MiniApp,
  type MiniAppRecord,
  type AppField,
} from '@/api/mini-apps'
import StateBadge from './StateBadge.vue'
import FieldRenderer from './FieldRenderer.vue'

const props = defineProps<{ app: MiniApp }>()
const router = useRouter()
const { t } = useI18n()
const toast = useToastStore()

// State
const records = ref<MiniAppRecord[]>([])
const selectedRecord = ref<MiniAppRecord | null>(null)
const formData = ref<Record<string, any>>({})
const isLoading = ref(false)
const isSaving = ref(false)
const showDialog = ref(false)
const showDetail = ref(false)
const showConfirm = ref(false)
const confirmTarget = ref<MiniAppRecord | null>(null)
const dialogMode = ref<'create' | 'edit'>('create')

const pagination = ref({
  page: 1,
  size: 10,
  total: 0,
  pages: 0
})

const filters = ref({ status: '' })

// Computed
const listColumns = computed(() => {
  const fields = props.app.fields
  if (!fields || !Array.isArray(fields)) return []
  const views = props.app.views
  if (views?.list?.columns) {
    return views.list.columns
      .map((name: string) => fields.find(f => f.name === name))
      .filter(Boolean) as AppField[]
  }
  return fields.slice(0, 5)
})

const editableFields = computed(() => {
  const fields = props.app.fields
  if (!fields || !Array.isArray(fields)) return []
  return fields.filter(f =>
    f.type !== 'file' && f.type !== 'group' && f.type !== 'repeating'
  )
})

const allFields = computed(() => {
  const fields = props.app.fields
  if (!fields || !Array.isArray(fields)) return []
  return fields
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

function formatFieldValue(value: any, field: AppField): string {
  if (value === null || value === undefined) return '-'
  if (field.type === 'select' && field.options) return value
  if (field.type === 'date') return value
  if (field.type === 'number') return typeof value === 'number' ? value.toLocaleString() : value
  if (field.type === 'boolean') return value ? t('apps.yes') : t('apps.no')
  return String(value)
}

async function loadRecords() {
  isLoading.value = true
  try {
    const filter: any = {}
    if (filters.value.status) {
      filter._status = filters.value.status
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

function openCreateDialog() {
  dialogMode.value = 'create'
  formData.value = {}
  selectedRecord.value = null
  showDialog.value = true
}

function viewRecord(record: MiniAppRecord) {
  selectedRecord.value = record
  showDetail.value = true
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

async function saveRecord() {
  if (!formData.value) return
  
  isSaving.value = true
  try {
    if (dialogMode.value === 'create') {
      await createRecord(props.app.id, formData.value)
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

.btn-filter,
.btn-reset {
  padding: 6px 16px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  background: var(--color-bg-primary, #fff);
}

.btn-filter {
  background: var(--color-primary, #4a90d9);
  color: #fff;
  border-color: var(--color-primary, #4a90d9);
}

.btn-filter:hover,
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

/* Dialog */
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
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.dialog-large {
  max-width: 800px;
}

.dialog-small {
  max-width: 400px;
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

.btn-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--color-text-secondary, #666);
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.btn-close:hover {
  background: var(--color-bg-secondary, #f0f0f0);
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

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.form-field {
  display: flex;
  flex-direction: column;
}

.form-field.field-full {
  grid-column: span 2;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--color-text-secondary, #555);
}

.required {
  color: var(--color-danger, #e74c3c);
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
  background: var(--color-bg-secondary, #f8f9fa);
  border-radius: 4px;
  font-size: 14px;
  color: var(--color-text-primary, #333);
  min-height: 36px;
}

.btn-cancel {
  padding: 8px 20px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 6px;
  background: var(--color-bg-primary, #fff);
  cursor: pointer;
  font-size: 14px;
}

.btn-cancel:hover {
  background: var(--color-bg-secondary, #f0f0f0);
}

.btn-danger {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  background: var(--color-danger, #e74c3c);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-danger:hover {
  opacity: 0.9;
}
</style>
