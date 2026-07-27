<template>
  <div class="doc-sidebar-panel">
    <!-- 处理状态 -->
    <div class="sidebar-section">
      <h4 class="sidebar-title">{{ $t('docs.workspace.panel.processingStatus') }}</h4>
      <div class="sidebar-status">
        <div class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.processingStatus') }}</span>
          <span class="status-value">
            <el-tag size="small" :type="processingTagType(processingStatus)">
              {{ processingLabel(processingStatus) }}
            </el-tag>
            <span v-if="isLongRunning" class="duration-warn">{{ processingDuration }}</span>
          </span>
        </div>
        <div class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.ocrStatus') }}</span>
          <span class="status-value">{{ ocrStatus || '-' }}</span>
        </div>
        <div v-if="taskId" class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.taskId') }}</span>
          <span class="status-value task-id-value">{{ taskId }}</span>
        </div>
        <div v-if="progress !== undefined" class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.progress') }}</span>
          <span class="status-value">
            <el-progress :percentage="progress" :stroke-width="6" />
          </span>
        </div>
        <div class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.canPreview') }}</span>
          <span class="status-value">{{ hasPreview ? $t('docs.workspace.panel.yes') : $t('docs.workspace.panel.no') }}</span>
        </div>
      </div>
      <div v-if="errorMessage" class="error-box">
        {{ errorMessage }}
      </div>
    </div>

    <!-- 基本信息 -->
    <div class="sidebar-section">
      <h4 class="sidebar-title">{{ $t('docs.workspace.panel.basicInfo') }}</h4>
      <div class="sidebar-status">
        <div class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.docTitle') }}</span>
          <span class="status-value task-id-value">{{ title || '-' }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.fileType') }}</span>
          <span class="status-value">{{ mimeType || '-' }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.size') }}</span>
          <span class="status-value">{{ formatFileSize(fileSize) }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.uploader') }}</span>
          <span class="status-value">{{ uploader || '-' }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.version') }}</span>
          <span class="status-value">{{ revisionLabel }}</span>
        </div>
        <div class="status-row">
          <span class="status-label">{{ $t('docs.workspace.panel.createdAt') }}</span>
          <span class="status-value">{{ formattedCreatedAt }}</span>
        </div>
      </div>
    </div>

    <!-- 处理操作 -->
    <div class="sidebar-section">
      <h4 class="sidebar-title">{{ $t('docs.workspace.panel.processingActions') }}</h4>
      <div class="sidebar-actions">
        <el-button
          v-if="retryAction"
          type="primary"
          size="small"
          :loading="retryLoading"
          @click="$emit('retry', retryAction.type)"
        >
          {{ retryAction.label }}
        </el-button>
        <el-tag v-else-if="isActionComplete" type="success" size="small">
          {{ $t('docs.workspace.panel.completed') }}
        </el-tag>
        <span v-else class="empty-state tiny">{{ $t('docs.workspace.panel.noActionNeeded') }}</span>
      </div>
    </div>

    <!-- 版本管理 -->
    <div class="sidebar-section version-management-section">
      <DocVersionPanel
        :document-id="documentId || ''"
        :resolved-current-id="resolvedCurrentId"
        :versions="versions || []"
        compact
        @version-changed="$emit('versionChanged')"
      />
    </div>

    <!-- 下载 -->
    <div class="sidebar-section">
      <h4 class="sidebar-title">{{ $t('docs.workspace.panel.download') }}</h4>
      <div class="sidebar-actions">
        <el-button v-if="attachmentDownloadUrl" size="small" @click="$emit('download', attachmentDownloadUrl)">
          {{ $t('docs.workspace.panel.rawFile') }}
        </el-button>
        <el-button v-if="markdownDownloadUrl" size="small" type="primary" @click="$emit('download', markdownDownloadUrl)">
          {{ $t('docs.workspace.panel.markdown') }}
        </el-button>
        <el-button v-if="rawMarkdownDownloadUrl && rawMarkdownDownloadUrl !== markdownDownloadUrl" size="small" @click="$emit('download', rawMarkdownDownloadUrl)">
          {{ $t('docs.workspace.panel.rawMarkdown') }}
        </el-button>
        <el-button v-if="rawResultDownloadUrl" size="small" @click="$emit('download', rawResultDownloadUrl)">
          {{ $t('docs.workspace.panel.rawResult') }}
        </el-button>
      </div>
    </div>

    <!-- 附件 -->
    <div class="sidebar-section">
      <h4 class="sidebar-title">{{ $t('docs.workspace.panel.attachments') }}</h4>
      <div v-if="!imageAttachments || imageAttachments.length === 0" class="empty-state tiny">{{ $t('docs.workspace.panel.noImageAttachments') }}</div>
      <div v-else class="attachment-list">
        <div v-for="(item, index) in imageAttachments" :key="item.id" class="attachment-item">
          <div class="attachment-name">{{ $t('docs.workspace.panel.attachment') }} {{ index + 1 }}</div>
          <div class="attachment-meta">{{ item.attachment?.mime_type || item.media_type || '-' }} · {{ formatFileSize(item.attachment?.file_size) }}</div>
          <el-button v-if="item.attachment?.download_url" size="small" text type="primary" @click="$emit('download', item.attachment?.download_url)">{{ $t('docs.workspace.panel.download') }}</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getDocProcessingStatusTagType } from '@/api/docs'
import DocVersionPanel from '@/components/docs/DocVersionPanel.vue'

const { t, locale } = useI18n()

interface RetryAction {
  type: string
  label: string
}

interface ImageAttachment {
  id: string
  markdown_path?: string | null
  filename?: string | null
  attachment?: {
    preview_url?: string | null
    download_url?: string | null
    mime_type?: string | null
    file_size?: number | null
  } | null
  media_type?: string | null
  referenced_in_markdown?: boolean | number | null
}

interface Props {
  // 处理状态
  processingStatus?: string | null
  ocrStatus?: string | null
  taskId?: string | null
  progress?: number
  hasPreview?: boolean
  errorMessage?: string | null
  updatedAt?: string | null
  
  // 基本信息
  title?: string | null
  mimeType?: string | null
  fileSize?: number | null
  uploader?: string | null
  revisionLabel?: string | null
  createdAt?: string | null
  
  // 操作
  retryAction?: RetryAction | null
  retryLoading?: boolean
  isActionComplete?: boolean

  // 版本管理
  documentId?: string | null
  resolvedCurrentId?: string | null
  versions?: any[] | null
  
  // 下载链接
  attachmentDownloadUrl?: string | null
  markdownDownloadUrl?: string | null
  rawMarkdownDownloadUrl?: string | null
  rawResultDownloadUrl?: string | null
  
  // 附件
  imageAttachments?: ImageAttachment[] | null
  
  // 错误码
  errorCode?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  processingStatus: null,
  ocrStatus: null,
  taskId: null,
  progress: undefined,
  hasPreview: false,
  errorMessage: null,
  updatedAt: null,
  title: null,
  mimeType: null,
  fileSize: undefined,
  uploader: null,
  revisionLabel: '-',
  createdAt: null,
  retryAction: null,
  retryLoading: false,
  isActionComplete: false,
  documentId: null,
  resolvedCurrentId: null,
  versions: null,
  attachmentDownloadUrl: null,
  markdownDownloadUrl: null,
  rawMarkdownDownloadUrl: null,
  rawResultDownloadUrl: null,
  imageAttachments: null,
  errorCode: null,
})

defineEmits<{
  retry: [type: string]
  download: [url: string]
  versionChanged: []
}>()

const LONG_RUNNING_THRESHOLD_MS = 20 * 60 * 1000

const isLongRunning = computed(() => {
  if (!props.processingStatus || !props.updatedAt) return false
  if (isTerminalStatus(props.processingStatus)) return false
  return Date.now() - new Date(props.updatedAt).getTime() > LONG_RUNNING_THRESHOLD_MS
})

const processingDuration = computed(() => {
  if (!props.updatedAt) return ''
  const ms = Date.now() - new Date(props.updatedAt).getTime()
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}min`
})

function isTerminalStatus(status?: string): boolean {
  const terminalStatuses = ['ready', 'error', 'failed']
  return status ? terminalStatuses.includes(status) : false
}

function processingTagType(status?: string | null): string {
  return getDocProcessingStatusTagType(status ?? undefined)
}

function processingLabel(status?: string | null): string {
  if (!status) return '-'
  return t(`contractV2.processingStatus.${status}`)
}

function formatFileSize(size?: number | null): string {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function fmt(t?: string | null): string {
  if (!t) return ''
  return new Date(t).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')
}

const formattedCreatedAt = computed(() => fmt(props.createdAt))
</script>

<style scoped>
.doc-sidebar-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar-section { background: #fff; border: 1px solid #ebeef5; border-radius: 8px; padding: 16px; }
.sidebar-title { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #303133; }
.sidebar-status { display: flex; flex-direction: column; gap: 8px; }

.status-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.status-label { font-size: 12px; color: #909399; flex-shrink: 0; }
.status-value { font-size: 13px; color: #303133; text-align: right; }
.task-id-value { word-break: break-all; font-family: Consolas, 'Courier New', monospace; font-size: 12px; }

.sidebar-actions { display: flex; flex-direction: column; gap: 6px; }
.attachment-list { display: flex; flex-direction: column; gap: 8px; }
.attachment-item { border: 1px solid #f0f0f0; border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px; }
.attachment-name { font-size: 13px; font-weight: 500; }
.attachment-meta { font-size: 11px; color: #909399; margin: 2px 0; }
.version-management-section { padding: 0; overflow: hidden; }

.error-box { margin-top: 8px; padding: 8px 12px; border-radius: 6px; background: #fef0f0; color: #c45656; font-size: 12px; }

.duration-warn { display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 4px; background: #f56c6c; color: #fff; font-size: 11px; font-weight: 600; vertical-align: middle; }

.empty-state { padding: 40px 0; text-align: center; color: #999; }
.tiny { padding: 8px 0; font-size: 12px; }
</style>
