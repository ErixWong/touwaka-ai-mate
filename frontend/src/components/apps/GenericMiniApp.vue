<template>
  <div class="generic-mini-app">
    <div class="tab-bar">
      <button
        v-for="tab in visibleTabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- List View -->
    <div v-if="activeTab === 'list'" class="tab-content">
      <div class="list-header">
        <h3>{{ $t('apps.recordList', '记录列表') }}</h3>
      </div>
      <div v-if="records.length === 0" class="empty-records">
        暂无记录，请上传文件或手动创建
      </div>
      <table v-else class="record-table">
        <thead>
          <tr>
            <th v-for="col in listColumns" :key="col.name">{{ col.label }}</th>
            <th>{{ $t('apps.status', '状态') }}</th>
            <th>{{ $t('apps.actions', '操作') }}</th>
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
            <td>
              <button class="btn-action" @click="viewRecord(record)">查看</button>
              <button
                v-if="record.data?._status === 'pending_review'"
                class="btn-action btn-primary"
                @click="editRecord(record)"
              >确认</button>
              <button class="btn-action btn-danger" @click="handleDelete(record)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="pagination.pages > 1" class="pagination">
        <button :disabled="pagination.page <= 1" @click="loadPage(pagination.page - 1)">上一页</button>
        <span>{{ pagination.page }} / {{ pagination.pages }}</span>
        <button :disabled="pagination.page >= pagination.pages" @click="loadPage(pagination.page + 1)">下一页</button>
      </div>
    </div>

    <!-- Upload View -->
    <div v-if="activeTab === 'upload'" class="tab-content">
      <div class="upload-section">
        <h3>{{ $t('apps.uploadFiles', '上传文件') }}</h3>
        <p class="upload-hint">支持的格式：{{ (app.config?.supported_formats || []).join(', ') }}</p>
        <FileUploader :app="app" @uploaded="onFilesUploaded" />
      </div>

      <div v-if="batchStatus" class="batch-progress">
        <h4>批量处理进度</h4>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: batchProgressPercent + '%' }"></div>
        </div>
        <div class="progress-stats">
          <span>总计: {{ batchStatus.total }}</span>
          <span>已完成: {{ batchStatus.completed }}</span>
          <span>处理中: {{ batchStatus.processing }}</span>
          <span>失败: {{ batchStatus.failed }}</span>
        </div>
      </div>
    </div>

    <!-- Detail/Edit View -->
    <div v-if="activeTab === 'detail' && selectedRecord" class="tab-content">
      <div class="detail-header">
        <button class="btn-back" @click="closeDetail">← 返回列表</button>
        <div class="detail-status">
          <StateBadge :status="selectedRecord.data?._status" :states="app.states || []" />
        </div>
      </div>

      <div class="form-grid">
        <div
          v-for="field in editableFields"
          :key="field.name"
          class="form-field"
        >
          <label class="field-label">
            {{ field.label }}
            <span v-if="field.required" class="required">*</span>
            <span v-if="isAiExtracted(field.name)" class="ai-badge">🤖</span>
          </label>
          <FieldRenderer
            :field="field"
            :model-value="formData[field.name]"
            @update:model-value="formData[field.name] = $event"
            :readonly="!isEditing"
          />
        </div>
      </div>

      <div v-if="selectedRecord.data?._ocr_text" class="ocr-section">
        <details>
          <summary>查看 OCR 原文</summary>
          <pre class="ocr-text">{{ selectedRecord.data._ocr_text }}</pre>
        </details>
      </div>

      <div v-if="isEditing" class="form-actions">
        <button class="btn-cancel" @click="cancelEdit">取消</button>
        <button class="btn-primary" @click="saveRecord">
          {{ selectedRecord.data?._status === 'pending_review' ? '确认保存' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  getRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  confirmRecord,
  batchUpload,
  getStatusSummary,
  type MiniApp,
  type MiniAppRecord,
  type AppField,
  type StatusSummary,
} from '@/api/mini-apps'
import { uploadAttachment } from '@/api/attachment'
import StateBadge from './StateBadge.vue'
import FieldRenderer from './FieldRenderer.vue'
import FileUploader from './FileUploader.vue'

const props = defineProps<{
  app: MiniApp
}>()

const activeTab = ref('list')
const records = ref<MiniAppRecord[]>([])
const selectedRecord = ref<MiniAppRecord | null>(null)
const formData = ref<Record<string, any>>({})
const isEditing = ref(false)
const isLoading = ref(false)
const pagination = ref({ page: 1, size: 10, total: 0, pages: 0 })
const batchStatus = ref<StatusSummary | null>(null)
const batchUploadTime = ref<string | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

const visibleTabs = computed(() => {
  const features = props.app.config?.features || ['list', 'upload']
  const tabs = []
  if (features.includes('list')) tabs.push({ key: 'list', label: '列表' })
  if (features.includes('upload')) tabs.push({ key: 'upload', label: '上传' })
  tabs.push({ key: 'detail', label: '详情' })
  return tabs
})

const listColumns = computed(() => {
  const views = props.app.views
  if (views?.list?.columns) {
    return views.list.columns
      .map((name: string) => props.app.fields.find(f => f.name === name))
      .filter(Boolean) as AppField[]
  }
  return props.app.fields.filter(f => f.required || f.ai_extractable)
})

const editableFields = computed(() => {
  return props.app.fields.filter(f =>
    f.type !== 'file' && f.type !== 'group' && f.type !== 'repeating'
  )
})

const batchProgressPercent = computed(() => {
  if (!batchStatus.value || batchStatus.value.total === 0) return 0
  return Math.round(((batchStatus.value.completed + batchStatus.value.failed) / batchStatus.value.total) * 100)
})

onMounted(() => {
  loadRecords()
})

onUnmounted(() => {
  stopPolling()
})

function isAiExtracted(fieldName: string): boolean {
  if (!selectedRecord.value?.ai_extracted) return false
  const field = props.app.fields.find(f => f.name === fieldName)
  return !!field?.ai_extractable
}

function formatFieldValue(value: any, field: AppField): string {
  if (value === null || value === undefined) return '-'
  if (field.type === 'select' && field.options) return value
  if (field.type === 'date') return value
  if (field.type === 'number') return typeof value === 'number' ? value.toLocaleString() : value
  return String(value)
}

async function loadRecords() {
  isLoading.value = true
  try {
    const result = await getRecords(props.app.id, {
      page: pagination.value.page,
      size: pagination.value.size,
    })
    records.value = result.items
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

function viewRecord(record: MiniAppRecord) {
  selectedRecord.value = record
  formData.value = { ...record.data }
  isEditing.value = false
  activeTab.value = 'detail'
}

function editRecord(record: MiniAppRecord) {
  selectedRecord.value = record
  formData.value = { ...record.data }
  isEditing.value = true
  activeTab.value = 'detail'
}

function closeDetail() {
  selectedRecord.value = null
  activeTab.value = 'list'
}

function cancelEdit() {
  if (selectedRecord.value) {
    formData.value = { ...selectedRecord.value.data }
  }
  isEditing.value = false
}

async function saveRecord() {
  if (!selectedRecord.value) return

  try {
    const status = selectedRecord.value.data?._status
    const dataToSave = { ...formData.value }

    if (status === 'pending_review') {
      await confirmRecord(props.app.id, selectedRecord.value.id, dataToSave)
    } else {
      await updateRecord(props.app.id, selectedRecord.value.id, dataToSave)
    }

    await loadRecords()
    closeDetail()
  } catch (error) {
    console.error('Failed to save record:', error)
    alert('保存失败：' + (error as Error).message)
  }
}

async function handleDelete(record: MiniAppRecord) {
  if (!confirm('确定要删除此记录吗？')) return

  try {
    await deleteRecord(props.app.id, record.id)
    await loadRecords()
  } catch (error) {
    console.error('Failed to delete record:', error)
  }
}

async function onFilesUploaded(attachmentIds: string[]) {
  try {
    const result = await batchUpload(props.app.id, attachmentIds)
    batchUploadTime.value = result.upload_time
    startPolling()
    await loadRecords()
  } catch (error) {
    console.error('Batch upload error:', error)
    alert('上传失败：' + (error as Error).message)
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (!batchUploadTime.value) return

    try {
      batchStatus.value = await getStatusSummary(props.app.id, batchUploadTime.value)
      await loadRecords()

      if (batchStatus.value.processing === 0 && batchStatus.value.failed === 0) {
        stopPolling()
      }
    } catch (error) {
      console.error('Polling error:', error)
    }
  }, 3000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
</script>

<style scoped>
.generic-mini-app {
  background: var(--color-bg-primary, #fff);
  border-radius: 12px;
  border: 1px solid var(--color-border, #e0e0e0);
  overflow: hidden;
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
  background: var(--color-bg-secondary, #f8f9fa);
}

.tab-btn {
  padding: 12px 24px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-secondary, #666);
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab-btn.active {
  color: var(--color-primary, #4a90d9);
  border-bottom-color: var(--color-primary, #4a90d9);
  font-weight: 600;
}

.tab-content {
  padding: 24px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.empty-records {
  text-align: center;
  padding: 40px;
  color: var(--color-text-secondary, #666);
}

.record-table {
  width: 100%;
  border-collapse: collapse;
}

.record-table th,
.record-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #eee);
  font-size: 13px;
}

.record-table th {
  font-weight: 600;
  color: var(--color-text-secondary, #666);
  background: var(--color-bg-secondary, #f8f9fa);
}

.btn-action {
  padding: 4px 8px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  background: var(--color-bg-primary, #fff);
  cursor: pointer;
  font-size: 12px;
  margin-right: 4px;
}

.btn-action.btn-primary {
  background: var(--color-primary, #4a90d9);
  color: #fff;
  border-color: var(--color-primary, #4a90d9);
}

.btn-action.btn-danger {
  color: var(--color-danger, #e74c3c);
  border-color: var(--color-danger, #e74c3c);
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
}

.pagination button {
  padding: 6px 12px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  background: var(--color-bg-primary, #fff);
  cursor: pointer;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.upload-section h3 {
  margin: 0 0 8px;
}

.upload-hint {
  color: var(--color-text-secondary, #666);
  font-size: 13px;
  margin-bottom: 16px;
}

.batch-progress {
  margin-top: 24px;
  padding: 16px;
  border: 1px solid var(--color-border, #eee);
  border-radius: 8px;
}

.progress-bar {
  height: 8px;
  background: var(--color-bg-secondary, #f0f0f0);
  border-radius: 4px;
  overflow: hidden;
  margin: 12px 0;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary, #4a90d9);
  transition: width 0.3s;
}

.progress-stats {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--color-text-secondary, #666);
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.detail-header .btn-back {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-primary, #4a90d9);
  font-size: 14px;
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

.field-label {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--color-text-secondary, #555);
}

.required {
  color: var(--color-danger, #e74c3c);
}

.ai-badge {
  font-size: 12px;
  margin-left: 4px;
}

.ocr-section {
  margin-top: 24px;
}

.ocr-section details {
  border: 1px solid var(--color-border, #eee);
  border-radius: 8px;
  padding: 12px;
}

.ocr-section summary {
  cursor: pointer;
  font-weight: 500;
  margin-bottom: 8px;
}

.ocr-text {
  max-height: 300px;
  overflow-y: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border, #eee);
}

.btn-cancel {
  padding: 8px 20px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 6px;
  background: var(--color-bg-primary, #fff);
  cursor: pointer;
}

.btn-primary {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  background: var(--color-primary, #4a90d9);
  color: #fff;
  cursor: pointer;
  font-weight: 500;
}

.btn-primary:hover {
  opacity: 0.9;
}
</style>
