<template>
  <div class="handler-management-tab">
    <div class="panel-header">
      <h3 class="panel-title">{{ $t('settings.handlerManagement', '处理脚本管理') }}</h3>
      <button class="btn-icon-add" @click="openHandlerDialog()" :title="$t('settings.handlerManagement.addHandler', '添加脚本')">
        <span class="icon">+</span>
      </button>
    </div>

    <div v-if="loading" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="handlers.length === 0" class="empty-state">
      <div class="empty-icon">⚙️</div>
      <p>{{ $t('settings.handlerManagement.noHandlers', '暂无处理脚本') }}</p>
    </div>

    <div v-else class="handler-list-container">
      <div class="handler-list">
        <div
          v-for="handler in handlers"
          :key="handler.id"
          class="handler-item"
          :class="{ inactive: !handler.is_active }"
        >
          <div class="handler-info">
            <div class="handler-header-row">
              <span class="handler-name">{{ handler.name }}</span>
              <span v-if="!handler.is_active" class="badge inactive">{{ $t('settings.inactive') }}</span>
            </div>
            <p v-if="handler.description" class="handler-desc">{{ handler.description }}</p>
            <div class="handler-meta">
              <span class="meta-item">{{ handler.handler }}</span>
              <span class="meta-separator">·</span>
              <span class="meta-item">{{ $t('settings.handlerManagement.concurrency', '并发') }}: {{ handler.concurrency }}</span>
              <span class="meta-separator">·</span>
              <span class="meta-item">{{ $t('settings.handlerManagement.timeout', '超时') }}: {{ handler.timeout }}s</span>
            </div>
          </div>
          <div class="handler-actions">
            <button class="btn-edit" @click="openHandlerDialog(handler)" :title="$t('common.edit')">
              {{ $t('common.edit') }}
            </button>
            <button class="btn-view-logs" @click="viewLogs(handler)" :title="$t('settings.handlerManagement.viewLogs', '查看日志')">
              {{ $t('settings.handlerManagement.logs', '日志') }}
            </button>
            <button class="btn-delete-small" @click="confirmDeleteHandler(handler)" :title="$t('common.delete')">
              {{ $t('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Handler 编辑对话框 -->
    <div v-if="showHandlerDialog" class="dialog-overlay" @click.self="closeHandlerDialog">
      <div class="dialog dialog-large">
        <h3 class="dialog-title">
          {{ editingHandler ? $t('settings.handlerManagement.editHandler', '编辑脚本') : $t('settings.handlerManagement.addHandler', '添加脚本') }}
        </h3>
        <div class="dialog-body">
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.handlerManagement.handlerName', '脚本名称') }} *</label>
              <input v-model="handlerForm.name" type="text" class="form-input" :placeholder="$t('settings.handlerManagement.handlerNamePlaceholder', 'OCR 识别')" />
            </div>
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.handlerManagement.description', '描述') }}</label>
            <textarea v-model="handlerForm.description" class="form-input" rows="2" :placeholder="$t('settings.handlerManagement.descriptionPlaceholder', '脚本功能描述')"></textarea>
          </div>
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.handlerManagement.handlerPath', '处理函数路径') }} *</label>
              <input v-model="handlerForm.handler" type="text" class="form-input" placeholder="scripts/ocr-service" />
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('settings.handlerManagement.handlerFunction', '函数名') }}</label>
              <input v-model="handlerForm.handler_function" type="text" class="form-input" placeholder="process" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-item">
              <label class="form-label">{{ $t('settings.handlerManagement.concurrency', '最大并发数') }}</label>
              <input v-model.number="handlerForm.concurrency" type="number" class="form-input" min="1" max="20" />
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('settings.handlerManagement.timeout', '超时（秒）') }}</label>
              <input v-model.number="handlerForm.timeout" type="number" class="form-input" min="5" max="600" />
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('settings.handlerManagement.maxRetries', '最大重试次数') }}</label>
              <input v-model.number="handlerForm.max_retries" type="number" class="form-input" min="0" max="10" />
            </div>
          </div>
          <div class="form-item checkbox">
            <label class="form-label">
              <input v-model="handlerForm.is_active" type="checkbox" />
              {{ $t('settings.isActive') }}
            </label>
          </div>
        </div>
        <div class="dialog-footer">
          <div class="footer-left">
            <button v-if="editingHandler" class="btn-delete" @click="confirmDeleteFromDialog">
              {{ $t('common.delete') }}
            </button>
          </div>
          <div class="footer-right">
            <button class="btn-cancel" @click="closeHandlerDialog">{{ $t('common.cancel') }}</button>
            <button class="btn-confirm" :disabled="!isHandlerFormValid" @click="saveHandler">
              {{ $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 日志查看对话框 -->
    <div v-if="showLogsDialog" class="dialog-overlay" @click.self="showLogsDialog = false">
      <div class="dialog dialog-large">
        <h3 class="dialog-title">
          {{ $t('settings.handlerManagement.logsFor', '执行日志') }} - {{ logsHandler?.name }}
        </h3>
        <div class="dialog-body logs-body">
          <div v-if="logsLoading" class="loading-state">
            {{ $t('common.loading') }}
          </div>
          <div v-else-if="logs.length === 0" class="empty-state">
            {{ $t('settings.handlerManagement.noLogs', '暂无执行日志') }}
          </div>
          <div v-else class="logs-table">
            <div class="logs-header">
              <span class="col-time">{{ $t('settings.handlerManagement.colTime', '时间') }}</span>
              <span class="col-status">{{ $t('settings.handlerManagement.colStatus', '状态') }}</span>
              <span class="col-trigger">{{ $t('settings.handlerManagement.colTrigger', '触发状态') }}</span>
              <span class="col-duration">{{ $t('settings.handlerManagement.colDuration', '耗时') }}</span>
              <span class="col-actions">{{ $t('settings.handlerManagement.colDetail', '详情') }}</span>
            </div>
            <div v-for="log in logs" :key="log.id" class="log-row">
              <span class="col-time">{{ formatTime(log.created_at) }}</span>
              <span class="col-status">
                <span class="badge" :class="log.success ? 'success' : 'failed'">
                  {{ log.success ? '✓' : '✗' }}
                </span>
              </span>
              <span class="col-trigger">{{ log.trigger_status }}</span>
              <span class="col-duration">{{ log.duration ? (log.duration / 1000).toFixed(1) + 's' : '-' }}</span>
              <span class="col-actions">
                <button class="btn-tiny" @click="viewLogDetail(log)">···</button>
              </span>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <div class="footer-right">
            <button class="btn-cancel" @click="showLogsDialog = false">{{ $t('common.cancel', '关闭') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 日志详情对话框 -->
    <div v-if="showLogDetailDialog" class="dialog-overlay" @click.self="showLogDetailDialog = false">
      <div class="dialog">
        <h3 class="dialog-title">{{ $t('settings.handlerManagement.logDetail', '日志详情') }}</h3>
        <div class="dialog-body">
          <div class="log-detail">
            <div class="log-detail-row">
              <span class="log-detail-label">{{ $t('settings.handlerManagement.colStatus', '状态') }}:</span>
              <span :class="logDetail?.success ? 'text-success' : 'text-failed'">
                {{ logDetail?.success ? '✓ 成功' : '✗ 失败' }}
              </span>
            </div>
            <div class="log-detail-row">
              <span class="log-detail-label">{{ $t('settings.handlerManagement.colTrigger', '触发状态') }}:</span>
              <span>{{ logDetail?.trigger_status }}</span>
            </div>
            <div v-if="logDetail?.result_status" class="log-detail-row">
              <span class="log-detail-label">{{ $t('settings.handlerManagement.resultStatus', '结果状态') }}:</span>
              <span>{{ logDetail.result_status }}</span>
            </div>
            <div class="log-detail-row">
              <span class="log-detail-label">{{ $t('settings.handlerManagement.colDuration', '耗时') }}:</span>
              <span>{{ logDetail?.duration ? (logDetail.duration / 1000).toFixed(2) + 's' : '-' }}</span>
            </div>
            <div v-if="logDetail && logDetail.retry_count > 0" class="log-detail-row">
              <span class="log-detail-label">{{ $t('settings.handlerManagement.retryCount', '重试次数') }}:</span>
              <span>{{ logDetail.retry_count }}</span>
            </div>
            <div v-if="logDetail && logDetail.error_message" class="log-detail-section">
              <span class="log-detail-label">{{ $t('settings.handlerManagement.errorMessage', '错误信息') }}:</span>
              <pre class="log-detail-pre error">{{ logDetail.error_message }}</pre>
            </div>
            <div v-if="logDetail && logDetail.output_data" class="log-detail-section">
              <span class="log-detail-label">{{ $t('settings.handlerManagement.outputData', '输出数据') }}:</span>
              <pre class="log-detail-pre">{{ JSON.stringify(logDetail.output_data, null, 2) }}</pre>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <div class="footer-right">
            <button class="btn-cancel" @click="showLogDetailDialog = false">{{ $t('common.cancel', '关闭') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="showDeleteDialog" class="dialog-overlay">
      <div class="dialog dialog-confirm">
        <h3 class="dialog-title">{{ $t('common.confirmDelete') }}</h3>
        <p class="dialog-message">
          {{ $t('settings.handlerManagement.deleteConfirm', '确定删除脚本') }} "{{ deletingHandler?.name }}"?
        </p>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="showDeleteDialog = false">{{ $t('common.cancel') }}</button>
          <button class="btn-confirm delete" @click="deleteHandler">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toast'
import { getHandlers, getHandlerLogs, createHandler, updateHandler, deleteHandler as deleteHandlerApi } from '@/api/mini-apps'
import type { AppRowHandler, AppActionLog } from '@/api/mini-apps'

const { t } = useI18n()
const toast = useToastStore()

const loading = ref(false)
const handlers = ref<AppRowHandler[]>([])
const showHandlerDialog = ref(false)
const showDeleteDialog = ref(false)
const showLogsDialog = ref(false)
const showLogDetailDialog = ref(false)
const editingHandler = ref<AppRowHandler | null>(null)
const deletingHandler = ref<AppRowHandler | null>(null)
const logsHandler = ref<AppRowHandler | null>(null)
const logs = ref<AppActionLog[]>([])
const logsLoading = ref(false)
const logDetail = ref<AppActionLog | null>(null)

const handlerForm = reactive({
  name: '',
  description: '',
  handler: '',
  handler_function: 'process',
  concurrency: 3,
  timeout: 60,
  max_retries: 2,
  is_active: true,
})

const isHandlerFormValid = computed(() => {
  return handlerForm.name.trim().length > 0 && handlerForm.handler.trim().length > 0
})

function openHandlerDialog(handler?: AppRowHandler) {
  if (handler) {
    editingHandler.value = handler
    handlerForm.name = handler.name
    handlerForm.description = handler.description || ''
    handlerForm.handler = handler.handler
    handlerForm.handler_function = handler.handler_function || 'process'
    handlerForm.concurrency = handler.concurrency
    handlerForm.timeout = handler.timeout
    handlerForm.max_retries = handler.max_retries
    handlerForm.is_active = handler.is_active
  } else {
    editingHandler.value = null
    handlerForm.name = ''
    handlerForm.description = ''
    handlerForm.handler = ''
    handlerForm.handler_function = 'process'
    handlerForm.concurrency = 3
    handlerForm.timeout = 60
    handlerForm.max_retries = 2
    handlerForm.is_active = true
  }
  showHandlerDialog.value = true
}

function closeHandlerDialog() {
  showHandlerDialog.value = false
  editingHandler.value = null
}

function confirmDeleteHandler(handler: AppRowHandler) {
  deletingHandler.value = handler
  showDeleteDialog.value = true
}

function confirmDeleteFromDialog() {
  if (editingHandler.value) {
    showHandlerDialog.value = false
    confirmDeleteHandler(editingHandler.value)
  }
}

async function viewLogs(handler: AppRowHandler) {
  logsHandler.value = handler
  showLogsDialog.value = true
  logsLoading.value = true
  try {
    logs.value = await getHandlerLogs(handler.id, 50)
  } catch (error: any) {
    toast.error(t('settings.handlerManagement.loadLogsFailed', '加载日志失败') + ': ' + error.message)
    logs.value = []
  } finally {
    logsLoading.value = false
  }
}

function viewLogDetail(log: AppActionLog) {
  logDetail.value = log
  showLogDetailDialog.value = true
}

function formatTime(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function loadHandlers() {
  loading.value = true
  try {
    handlers.value = await getHandlers()
  } catch (error: any) {
    toast.error(t('settings.handlerManagement.loadFailed', '加载脚本失败') + ': ' + error.message)
  } finally {
    loading.value = false
  }
}

async function saveHandler() {
  try {
    const data = { ...handlerForm }
    if (editingHandler.value) {
      await updateHandler(editingHandler.value.id, data)
      toast.success(t('settings.handlerManagement.updateSuccess', '脚本更新成功'))
    } else {
      await createHandler(data)
      toast.success(t('settings.handlerManagement.createSuccess', '脚本创建成功'))
    }
    closeHandlerDialog()
    await loadHandlers()
  } catch (error: any) {
    toast.error(t('settings.handlerManagement.saveFailed', '保存失败') + ': ' + error.message)
  }
}

async function deleteHandler() {
  if (!deletingHandler.value) return
  try {
    await deleteHandlerApi(deletingHandler.value.id)
    toast.success(t('settings.handlerManagement.deleteSuccess', '脚本已删除'))
    showDeleteDialog.value = false
    deletingHandler.value = null
    await loadHandlers()
  } catch (error: any) {
    toast.error(t('settings.handlerManagement.deleteFailed', '删除失败') + ': ' + error.message)
  }
}

onMounted(() => {
  loadHandlers()
})
</script>

<style scoped>
.handler-management-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.handler-list-container {
  display: flex;
  flex-direction: column;
}

.handler-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.handler-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
  transition: border-color 0.2s;
}

.handler-item:hover {
  border-color: var(--primary-color, #2196f3);
}

.handler-item.inactive {
  opacity: 0.6;
}

.handler-info {
  flex: 1;
  min-width: 0;
}

.handler-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.handler-name {
  font-weight: 500;
  font-size: 14px;
  color: var(--text-primary, #333);
}

.handler-desc {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin: 4px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.handler-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary, #999);
}

.meta-separator {
  color: var(--border-color, #e0e0e0);
}

.handler-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}

.badge.inactive { background: #fafafa; color: #999; }
.badge.success { background: #e8f5e9; color: #2e7d32; }
.badge.failed { background: #ffebee; color: #c62828; }

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
}

.btn-icon-add {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px dashed var(--border-color, #e0e0e0);
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color, #2196f3);
}

.btn-icon-add:hover {
  border-color: var(--primary-color, #2196f3);
  background: var(--primary-color-light, rgba(33, 150, 243, 0.05));
}

.btn-edit {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #e0e0e0);
  background: white;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary, #333);
}

.btn-edit:hover {
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.btn-view-logs {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #e0e0e0);
  background: white;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary, #333);
}

.btn-view-logs:hover {
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.btn-delete-small {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #e0e0e0);
  background: white;
  cursor: pointer;
  font-size: 12px;
  color: #e53935;
}

.btn-delete-small:hover {
  background: #ffebee;
  border-color: #e53935;
}

.btn-tiny {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
}

.btn-tiny:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 520px;
  max-height: 80vh;
  overflow-y: auto;
}

.dialog-large {
  max-width: 720px;
}

.dialog-confirm {
  max-width: 400px;
}

.dialog-title {
  font-size: 16px;
  font-weight: 500;
  padding: 16px 20px;
  margin: 0;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.dialog-body {
  padding: 16px 20px;
}

.logs-body {
  min-height: 200px;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.dialog-footer .footer-left {
  flex: 1;
}

.dialog-footer .footer-right {
  display: flex;
  gap: 8px;
}

.dialog-message {
  padding: 16px 20px;
  color: var(--text-secondary, #666);
}

.btn-cancel {
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #e0e0e0);
  background: white;
  cursor: pointer;
  font-size: 13px;
}

.btn-confirm {
  padding: 6px 16px;
  border-radius: 6px;
  border: none;
  background: var(--primary-color, #2196f3);
  color: white;
  cursor: pointer;
  font-size: 13px;
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-confirm.delete {
  background: #e53935;
}

.btn-delete {
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid #e53935;
  background: white;
  cursor: pointer;
  font-size: 13px;
  color: #e53935;
}

.btn-delete:hover {
  background: #ffebee;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-tertiary, #999);
}

.empty-icon {
  font-size: 36px;
  margin-bottom: 8px;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-item.checkbox {
  flex-direction: row;
  align-items: center;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.form-input {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: var(--primary-color, #2196f3);
}

.logs-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.logs-header {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.log-row {
  display: flex;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-primary, #333);
  border-radius: 4px;
}

.log-row:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.col-time { flex: 2; }
.col-status { flex: 1; }
.col-trigger { flex: 2; }
.col-duration { flex: 1; }
.col-actions { flex: 0 0 30px; }

.log-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-detail-row {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.log-detail-label {
  color: var(--text-secondary, #666);
  min-width: 80px;
}

.log-detail-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.log-detail-pre {
  background: var(--bg-secondary, #f5f5f5);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  overflow-x: auto;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
}

.log-detail-pre.error {
  background: #fff3e0;
  color: #e65100;
}

.text-success { color: #2e7d32; }
.text-failed { color: #c62828; }
</style>
