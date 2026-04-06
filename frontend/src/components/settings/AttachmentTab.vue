<template>
  <div class="attachment-tab">
    <!-- 搜索过滤栏 -->
    <div class="filter-bar">
      <div class="filter-row">
        <div class="filter-item">
          <label class="filter-label">{{ $t('attachment.sourceTag') }}</label>
          <select v-model="filters.source_tag" class="filter-select" @change="handleFilterChange">
            <option value="">{{ $t('attachment.allSources') }}</option>
            <option value="kb_article_image">{{ $t('attachment.sourceKbArticle') }}</option>
            <option value="task_export">{{ $t('attachment.sourceTaskExport') }}</option>
            <option value="chat_attachment">{{ $t('attachment.sourceChatAttachment') }}</option>
          </select>
        </div>
        <div class="filter-item">
          <label class="filter-label">{{ $t('attachment.mimeType') }}</label>
          <select v-model="filters.mime_type" class="filter-select" @change="handleFilterChange">
            <option value="">{{ $t('attachment.allTypes') }}</option>
            <option value="image">{{ $t('attachment.typeImage') }}</option>
            <option value="document">{{ $t('attachment.typeDocument') }}</option>
            <option value="video">{{ $t('attachment.typeVideo') }}</option>
          </select>
        </div>
        <div class="filter-item">
          <label class="filter-label">{{ $t('attachment.dateRange') }}</label>
          <div class="date-range">
            <input
              v-model="filters.start_date"
              type="date"
              class="filter-date"
              @change="handleFilterChange"
            />
            <span class="date-separator">—</span>
            <input
              v-model="filters.end_date"
              type="date"
              class="filter-date"
              @change="handleFilterChange"
            />
          </div>
        </div>
      </div>
      <div class="filter-actions">
        <button class="btn-reset" @click="resetFilters">
          {{ $t('attachment.resetFilters') }}
        </button>
      </div>
    </div>

    <!-- 统计信息 -->
    <div class="stats-bar">
      <span class="stats-text">
        {{ $t('attachment.totalCount', { count: pagination.total }) }}
      </span>
    </div>

    <!-- 附件列表 -->
    <div class="list-container">
      <div v-if="loading" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="attachments.length === 0" class="empty-state">
        <span class="empty-icon">📎</span>
        <span>{{ $t('attachment.noAttachments') }}</span>
      </div>

      <div v-else class="attachments-table">
        <!-- 表头 -->
        <div class="table-header">
          <span class="col-preview">{{ $t('attachment.preview') }}</span>
          <span class="col-filename">{{ $t('attachment.filename') }}</span>
          <span class="col-type">{{ $t('attachment.type') }}</span>
          <span class="col-size">{{ $t('attachment.size') }}</span>
          <span class="col-source">{{ $t('attachment.source') }}</span>
          <span class="col-uploader">{{ $t('attachment.uploader') }}</span>
          <span class="col-time">{{ $t('attachment.uploadTime') }}</span>
          <span class="col-actions">{{ $t('common.actions') }}</span>
        </div>

        <!-- 列表项 -->
        <div
          v-for="attachment in attachments"
          :key="attachment.id"
          class="attachment-row"
        >
          <div class="col-preview">
            <div class="preview-thumb" @click="previewAttachment(attachment)">
              <img
                v-if="isImage(attachment.mime_type)"
                :src="getPreviewUrl(attachment)"
                alt="preview"
                class="thumb-image"
              />
              <span v-else class="thumb-icon">{{ getFileIcon(attachment.mime_type) }}</span>
            </div>
          </div>
          <div class="col-filename">
            <span class="filename-text" :title="attachment.filename">{{ attachment.filename }}</span>
          </div>
          <div class="col-type">
            <span class="type-badge">{{ getMimeTypeLabel(attachment.mime_type) }}</span>
          </div>
          <div class="col-size">
            <span class="size-text">{{ formatSize(attachment.size) }}</span>
          </div>
          <div class="col-source">
            <span class="source-tag">{{ getSourceLabel(attachment.source_tag) }}</span>
          </div>
          <div class="col-uploader">
            <span class="uploader-text">{{ attachment.uploader_name || '—' }}</span>
          </div>
          <div class="col-time">
            <span class="time-text">{{ formatDate(attachment.created_at) }}</span>
          </div>
          <div class="col-actions">
            <button
              class="btn-icon-action preview"
              :title="$t('attachment.preview')"
              @click="previewAttachment(attachment)"
            >
              👁️
            </button>
            <button
              class="btn-icon-action delete"
              :title="$t('common.delete')"
              @click="handleDelete(attachment)"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="pagination.pages > 1" class="pagination-bar">
      <button
        class="btn-page"
        :disabled="pagination.page <= 1"
        @click="changePage(pagination.page - 1)"
      >
        {{ $t('pagination.prev') }}
      </button>
      <span class="page-info">
        {{ pagination.page }} / {{ pagination.pages }}
      </span>
      <button
        class="btn-page"
        :disabled="pagination.page >= pagination.pages"
        @click="changePage(pagination.page + 1)"
      >
        {{ $t('pagination.next') }}
      </button>
    </div>

    <!-- 预览弹窗 -->
    <div v-if="showPreviewModal" class="modal-overlay" @click.self="closePreviewModal">
      <div class="modal-content preview-modal">
        <div class="modal-header">
          <h3>{{ previewingAttachment?.filename }}</h3>
          <button class="btn-close" @click="closePreviewModal">×</button>
        </div>
        <div class="modal-body preview-body">
          <img
            v-if="isImage(previewingAttachment?.mime_type)"
            :src="getPreviewUrl(previewingAttachment)"
            alt="preview"
            class="preview-image"
          />
          <div v-else class="preview-placeholder">
            <span class="preview-icon">{{ getFileIcon(previewingAttachment?.mime_type) }}</span>
            <p>{{ $t('attachment.noPreviewAvailable') }}</p>
          </div>
        </div>
        <div class="modal-footer">
          <div class="preview-meta">
            <span>{{ $t('attachment.size') }}: {{ formatSize(previewingAttachment?.size) }}</span>
            <span>{{ $t('attachment.type') }}: {{ previewingAttachment?.mime_type }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="closeDeleteModal">
      <div class="modal-content delete-modal">
        <div class="modal-header">
          <h3>{{ $t('attachment.deleteConfirmTitle') }}</h3>
          <button class="btn-close" @click="closeDeleteModal">×</button>
        </div>
        <div class="modal-body">
          <p>{{ $t('attachment.deleteConfirmMessage', { filename: deletingAttachment?.filename }) }}</p>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="closeDeleteModal">
            {{ $t('common.cancel') }}
          </button>
          <button class="btn-confirm delete" @click="confirmDelete">
            {{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toast'
import {
  getAttachments,
  deleteAttachment,
  generateAttachmentToken,
  getAttachmentUrl,
  type Attachment,
  type AttachmentListParams,
} from '@/api/attachment'

const { t } = useI18n()
const toast = useToastStore()

const attachments = ref<Attachment[]>([])
const loading = ref(false)

const filters = reactive<AttachmentListParams>({
  page: 1,
  size: 20,
  source_tag: '',
  mime_type: '',
  start_date: '',
  end_date: '',
})

const pagination = reactive({
  total: 0,
  page: 1,
  size: 20,
  pages: 0,
})

// 预览弹窗
const showPreviewModal = ref(false)
const previewingAttachment = ref<Attachment | null>(null)
const previewToken = ref('')

// 删除确认弹窗
const showDeleteModal = ref(false)
const deletingAttachment = ref<Attachment | null>(null)

// 加载附件列表
const loadAttachments = async () => {
  loading.value = true
  try {
    const params: AttachmentListParams = {
      page: filters.page,
      size: filters.size,
    }
    if (filters.source_tag) params.source_tag = filters.source_tag
    if (filters.mime_type) params.mime_type = filters.mime_type
    if (filters.start_date) params.start_date = filters.start_date
    if (filters.end_date) params.end_date = filters.end_date

    const response = await getAttachments(params)
    attachments.value = response.items
    pagination.total = response.total
    pagination.page = response.page
    pagination.size = response.size
    pagination.pages = response.pages
  } catch (err) {
    console.error('Failed to load attachments:', err)
    toast.error(t('attachment.loadError'))
  } finally {
    loading.value = false
  }
}

// 处理过滤变化
const handleFilterChange = () => {
  filters.page = 1
  loadAttachments()
}

// 重置过滤
const resetFilters = () => {
  filters.source_tag = ''
  filters.mime_type = ''
  filters.start_date = ''
  filters.end_date = ''
  filters.page = 1
  loadAttachments()
}

// 分页
const changePage = (page: number) => {
  filters.page = page
  loadAttachments()
}

// 判断是否为图片
const isImage = (mime_type?: string): boolean => {
  if (!mime_type) return false
  return mime_type.startsWith('image/')
}

// 获取文件图标
const getFileIcon = (mime_type?: string): string => {
  if (!mime_type) return '📄'
  if (mime_type.startsWith('image/')) return '🖼️'
  if (mime_type.startsWith('video/')) return '🎬'
  if (mime_type.startsWith('audio/')) return '🎵'
  if (mime_type.includes('pdf')) return '📕'
  if (mime_type.includes('word') || mime_type.includes('document')) return '📘'
  if (mime_type.includes('excel') || mime_type.includes('spreadsheet')) return '📊'
  if (mime_type.includes('powerpoint') || mime_type.includes('presentation')) return '📙'
  if (mime_type.includes('zip') || mime_type.includes('archive')) return '📦'
  return '📄'
}

// 获取 MIME 类型标签
const getMimeTypeLabel = (mime_type: string): string => {
  const types: Record<string, string> = {
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'video/mp4': 'MP4',
    'video/webm': 'WebM',
    'application/pdf': 'PDF',
    'application/zip': 'ZIP',
  }
  return types[mime_type] || mime_type.split('/')[1]?.toUpperCase() || mime_type
}

// 获取来源标签
const getSourceLabel = (source_tag: string): string => {
  const labels: Record<string, string> = {
    'kb_article_image': t('attachment.sourceKbArticle'),
    'task_export': t('attachment.sourceTaskExport'),
    'chat_attachment': t('attachment.sourceChatAttachment'),
  }
  return labels[source_tag] || source_tag
}

// 格式化文件大小
const formatSize = (size?: number): string => {
  if (!size) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  if (size < 1024 * 1024 * 1024) return `${Math.round(size / (1024 * 1024))} MB`
  return `${Math.round(size / (1024 * 1024 * 1024))} GB`
}

// 格式化日期
const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 获取预览 URL
const getPreviewUrl = (attachment?: Attachment | null): string => {
  if (!attachment) return ''
  if (previewToken.value) {
    return getAttachmentUrl(attachment.id, previewToken.value)
  }
  return ''
}

// 预览附件
const previewAttachment = async (attachment: Attachment) => {
  previewingAttachment.value = attachment
  showPreviewModal.value = true

  // 生成访问 Token
  try {
    const result = await generateAttachmentToken(attachment.source_tag, attachment.source_id)
    previewToken.value = result.token
  } catch (err) {
    console.error('Failed to generate token:', err)
    toast.error(t('attachment.tokenError'))
  }
}

// 关闭预览弹窗
const closePreviewModal = () => {
  showPreviewModal.value = false
  previewingAttachment.value = null
  previewToken.value = ''
}

// 删除附件
const handleDelete = (attachment: Attachment) => {
  deletingAttachment.value = attachment
  showDeleteModal.value = true
}

// 关闭删除弹窗
const closeDeleteModal = () => {
  showDeleteModal.value = false
  deletingAttachment.value = null
}

// 确认删除
const confirmDelete = async () => {
  if (!deletingAttachment.value) return

  try {
    await deleteAttachment(deletingAttachment.value.id)
    toast.success(t('attachment.deleteSuccess'))
    closeDeleteModal()
    loadAttachments()
  } catch (err) {
    console.error('Failed to delete attachment:', err)
    toast.error(t('attachment.deleteError'))
  }
}

// 初始化
onMounted(() => {
  loadAttachments()
})
</script>

<style scoped>
.attachment-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* 过滤栏 */
.filter-bar {
  padding: 16px;
  background: var(--secondary-bg, #f8f9fa);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.filter-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #666);
}

.filter-select,
.filter-date {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  background: white;
  min-width: 140px;
}

.filter-select:focus,
.filter-date:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.date-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-separator {
  color: var(--text-tertiary, #999);
}

.filter-actions {
  margin-top: 12px;
}

.btn-reset {
  padding: 8px 16px;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-reset:hover {
  background: var(--hover-bg, #e8e8e8);
}

/* 统计栏 */
.stats-bar {
  padding: 12px 16px;
  background: var(--card-bg, #fff);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.stats-text {
  font-size: 13px;
  color: var(--text-secondary, #666);
}

/* 列表容器 */
.list-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--text-secondary, #888);
  gap: 12px;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
}

/* 表格样式 */
.attachments-table {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--border-color, #e8e8e8);
  border-radius: 8px;
  overflow: hidden;
}

.table-header {
  display: grid;
  grid-template-columns: 60px 1fr 80px 80px 120px 100px 140px 80px;
  gap: 8px;
  padding: 10px 12px;
  background: var(--secondary-bg, #f5f5f5);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.attachment-row {
  display: grid;
  grid-template-columns: 60px 1fr 80px 80px 120px 100px 140px 80px;
  gap: 8px;
  padding: 10px 12px;
  background: var(--card-bg, white);
  align-items: center;
  transition: background 0.15s;
}

.attachment-row:hover {
  background: var(--hover-bg, #fafafa);
}

/* 列样式 */
.col-preview {
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-thumb {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: var(--secondary-bg, #f0f0f0);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.2s;
}

.preview-thumb:hover {
  background: var(--hover-bg, #e0e0e0);
  transform: scale(1.05);
}

.thumb-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-icon {
  font-size: 20px;
}

.col-filename {
  overflow: hidden;
}

.filename-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-type {
  display: flex;
  align-items: center;
}

.type-badge {
  padding: 4px 8px;
  background: var(--secondary-bg, #e8e8e8);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary, #666);
}

.col-size {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.col-source {
  display: flex;
  align-items: center;
}

.source-tag {
  padding: 4px 8px;
  background: var(--primary-light, #e3f2fd);
  border-radius: 4px;
  font-size: 11px;
  color: var(--primary-color, #2196f3);
}

.col-uploader {
  font-size: 12px;
  color: var(--text-secondary, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-time {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.col-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.btn-icon-action {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.btn-icon-action:hover {
  background: var(--hover-bg, #f0f0f0);
  transform: scale(1.1);
}

.btn-icon-action.preview:hover {
  background: var(--primary-light, #e3f2fd);
}

.btn-icon-action.delete:hover {
  background: var(--error-bg, #ffebee);
}

/* 分页 */
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px;
  background: var(--card-bg, #fff);
  border-top: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}

.btn-page {
  padding: 8px 16px;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-page:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--primary-color, #2196f3);
}

.btn-page:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-info {
  font-size: 13px;
  color: var(--text-secondary, #666);
}

/* Modal */
.modal-overlay {
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
  padding: 16px;
}

.modal-content {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #eee);
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.btn-close {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-tertiary, #999);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-close:hover {
  background: var(--hover-bg, #f5f5f5);
  color: var(--text-primary, #333);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #eee);
}

/* 预览弹窗 */
.preview-modal {
  max-width: 720px;
}

.preview-body {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  background: var(--secondary-bg, #f8f9fa);
}

.preview-image {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
}

.preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: var(--text-secondary, #666);
}

.preview-icon {
  font-size: 64px;
}

.preview-meta {
  display: flex;
  gap: 24px;
  font-size: 12px;
  color: var(--text-secondary, #666);
}

/* 删除弹窗 */
.delete-modal {
  max-width: 400px;
}

.btn-cancel {
  padding: 8px 16px;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-cancel:hover {
  background: var(--hover-bg, #f5f5f5);
}

.btn-confirm.delete {
  padding: 8px 16px;
  background: var(--error-color, #c62828);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.btn-confirm.delete:hover {
  background: var(--error-hover, #b71c1c);
}

/* 响应式 */
@media (max-width: 1024px) {
  .table-header {
    display: none;
  }

  .attachment-row {
    display: grid;
    grid-template-columns: 60px 1fr auto;
    grid-template-rows: auto auto auto;
    gap: 8px;
    padding: 12px;
  }

  .col-preview {
    grid-column: 1;
    grid-row: 1 / 3;
  }

  .col-filename {
    grid-column: 2;
    grid-row: 1;
  }

  .col-type,
  .col-size {
    grid-column: 2;
    grid-row: 2;
    display: inline-flex;
    gap: 8px;
  }

  .col-source,
  .col-uploader,
  .col-time {
    grid-column: 1 / 3;
    grid-row: 3;
    display: inline-flex;
    gap: 12px;
    padding-top: 8px;
    border-top: 1px dashed var(--border-color, #eee);
  }

  .col-actions {
    grid-column: 3;
    grid-row: 1 / 3;
    flex-direction: column;
  }
}

/* Scrollbar */
.list-container::-webkit-scrollbar {
  width: 6px;
}

.list-container::-webkit-scrollbar-track {
  background: transparent;
}

.list-container::-webkit-scrollbar-thumb {
  background: var(--border-color, #ddd);
  border-radius: 3px;
}

.list-container::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary, #ccc);
}
</style>