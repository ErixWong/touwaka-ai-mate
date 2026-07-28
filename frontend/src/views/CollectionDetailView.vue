<template>
  <div class="collection-workspace">
    <ContextHeader
      :breadcrumbs="breadcrumbs"
      :title="store.currentCollection?.name || $t('docs.workspace.collection.collectionName')"
      :description="store.currentCollection?.description || undefined"
    >
      <template #meta>
        <VisibilityTag :visibility="store.currentCollection?.visibility || ''" />
        <span>{{ store.currentCollection?.doc_count || 0 }} {{ $t('docs.workspace.collection.docCount') }}</span>
        <span v-if="store.currentCollection?.updated_at" class="update-time">
          {{ $t('docs.workspace.collection.updatedAt') }} {{ formatDate(store.currentCollection.updated_at) }}
        </span>
      </template>
      <template #actions>
        <el-button type="primary" :loading="store.isUploadingDocument" @click="openUploadDialog">{{ $t('docs.workspace.collection.uploadDoc') }}</el-button>
        <el-button @click="goSettings">{{ $t('docs.workspace.collection.settings') }}</el-button>
      </template>
    </ContextHeader>

    <el-dialog
      v-model="uploadDialogVisible"
      :title="$t('docs.workspace.collection.uploadDialogTitle')"
      width="480px"
      destroy-on-close
    >
      <div class="upload-source-switch">
        <div
          class="source-option"
          :class="{ active: uploadSource === 'local' }"
          @click="uploadSource = 'local'"
        >
          <div class="source-title">{{ $t('docs.workspace.collection.uploadLocal') }}</div>
          <div class="source-desc">{{ $t('docs.workspace.collection.uploadLocalDesc') }}</div>
        </div>
        <div
          class="source-option"
          :class="{ active: uploadSource === 'taskid' }"
          @click="uploadSource = 'taskid'"
        >
          <div class="source-title">{{ $t('docs.workspace.collection.uploadTaskId') }}</div>
          <div class="source-desc">{{ $t('docs.workspace.collection.uploadTaskIdDesc') }}</div>
        </div>
      </div>

      <el-form v-if="uploadSource === 'local'" label-position="top">
        <el-form-item :label="$t('docs.workspace.versionPanel.file')">
          <el-upload
            :show-file-list="true"
            :auto-upload="false"
            :limit="1"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
            drag
          >
            <div class="el-upload__text">{{ $t('docs.workspace.versionPanel.dragOrClick') }}</div>
          </el-upload>
        </el-form-item>
        <el-form-item :label="$t('docs.workspace.collection.initialVersionLabel')">
          <el-input v-model="newDocumentRevisionLabel" :placeholder="$t('docs.workspace.collection.initialVersionPlaceholder')" maxlength="20" />
        </el-form-item>
      </el-form>

      <div v-else class="upload-taskid-body">
        <div class="taskid-input-row">
          <el-input
            v-model="taskIdInput"
            :placeholder="$t('docs.workspace.collection.taskIdPlaceholder')"
            clearable
            @keyup.enter="probeTaskId"
          />
          <el-button :loading="taskIdProbing" @click="probeTaskId">{{ $t('docs.workspace.collection.taskIdQuery') }}</el-button>
        </div>

        <el-alert v-if="taskIdError" :title="taskIdError" type="warning" :closable="false" show-icon class="taskid-alert" />

        <div v-if="taskIdProbe?.status === 'completed'" class="taskid-result">
          <div class="taskid-result-row">
            <span class="taskid-label">{{ $t('docs.workspace.collection.taskIdFileName') }}</span>
            <span class="taskid-value">{{ taskIdProbe.filename || taskIdProbe.artifact_name || taskIdProbe.task_id.slice(0, 8) }}</span>
          </div>
          <div class="taskid-result-row">
            <span class="taskid-label">{{ $t('docs.workspace.collection.taskIdStatus') }}</span>
            <el-tag type="success" size="small">{{ $t('docs.workspace.collection.taskIdStatusCompleted') }}</el-tag>
          </div>
          <div v-if="taskIdProbe.completed_at" class="taskid-result-row">
            <span class="taskid-label">{{ $t('docs.workspace.collection.taskIdCompletedAt') }}</span>
            <span class="taskid-value">{{ formatDateTime(taskIdProbe.completed_at) }}</span>
          </div>
          <div class="taskid-result-row">
            <span class="taskid-label">{{ $t('docs.workspace.collection.taskIdImageCount') }}</span>
            <span class="taskid-value">{{ taskIdProbe.image_count ?? 0 }}</span>
          </div>
          <el-input v-model="taskIdDocTitle" class="taskid-title-input">
            <template #prepend>{{ $t('docs.workspace.collection.docNameLabel') }}</template>
          </el-input>
          <el-input
            v-model="newDocumentRevisionLabel"
            class="taskid-title-input"
            :placeholder="$t('docs.workspace.collection.initialVersionPlaceholder')"
            maxlength="20"
          >
            <template #prepend>{{ $t('docs.workspace.collection.initialVersionLabel') }}</template>
          </el-input>
          <el-alert
            v-if="taskIdProbe.already_imported"
            type="warning"
            :closable="false"
            show-icon
            class="taskid-alert"
            :title="$t('docs.workspace.collection.alreadyImportedTip', { title: taskIdProbe.existing_document?.title || '' })"
          />
        </div>
      </div>
      <template #footer>
        <el-button @click="uploadDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button
          v-if="uploadSource === 'local'"
          type="primary"
          :loading="store.isUploadingDocument"
          :disabled="!pendingUploadFile"
          @click="submitUploadDocument"
        >
          {{ $t('docs.workspace.collection.confirmUpload') }}
        </el-button>
        <el-button
          v-else
          type="primary"
          :disabled="taskIdProbe?.status !== 'completed'"
          :loading="store.isUploadingDocument"
          @click="confirmTaskIdImport"
        >
          {{ taskIdProbe?.already_imported ? $t('docs.workspace.collection.confirmImportAgain') : $t('docs.workspace.collection.confirmImport') }}
        </el-button>
      </template>
    </el-dialog>

    <div v-if="store.isLoading && !store.currentCollection" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <template v-else-if="store.currentCollection">
      <!-- 三栏工作区布局 -->
      <div class="workspace-layout">
        <!-- 左栏：文档清单 -->
        <div class="workspace-left">
          <div class="doc-toolbar">
            <el-input
              v-model="docSearch"
              :placeholder="$t('docs.workspace.collection.searchPlaceholder')"
              class="toolbar-search"
              clearable
              @input="doSearch"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-select v-model="statusFilter" :placeholder="$t('docs.workspace.collection.filterStatus')" clearable class="toolbar-select" @change="doSearch">
              <el-option :label="$t('docs.workspace.collection.allStatus')" value="" />
              <el-option :label="$t('docs.workspace.collection.pendingOcr')" value="pending_ocr" />
              <el-option :label="$t('docs.workspace.collection.ocrProcessing')" value="ocr_processing" />
              <el-option :label="$t('docs.workspace.collection.pendingClean')" value="pending_clean" />
              <el-option :label="$t('docs.workspace.collection.ready')" value="ready" />
              <el-option :label="$t('docs.workspace.collection.error')" value="error" />
              <el-option :label="$t('contractV2.processingStatus.failed')" value="failed" />
            </el-select>
          </div>

          <div v-if="store.isLoading && store.collectionDocuments.length === 0" class="loading-state">
            {{ $t('common.loading') }}
          </div>

          <div v-else-if="hasActiveFilter && store.collectionDocuments.length === 0" class="empty-state">
            <p>{{ $t('docs.workspace.collection.noMatchDoc') }}</p>
            <el-button text type="primary" @click="clearFilters">{{ $t('docs.workspace.collection.clearFilter') }}</el-button>
          </div>

          <div v-else-if="store.collectionDocuments.length === 0" class="empty-state">
            <p>{{ $t('docs.workspace.collection.noDoc') }}</p>
          </div>

          <div v-else class="doc-list">
            <div
              v-for="doc in store.collectionDocuments"
              :key="doc.id"
              class="doc-list-item"
              :class="{ active: selectedDocId === doc.id }"
              @click="selectDocument(doc.id)"
            >
              <div class="doc-list-title">
                <el-icon v-if="selectedDocId === doc.id" class="active-indicator"><ArrowRight /></el-icon>
                <span class="doc-list-title-text">{{ doc.source_attachment?.file_name || doc.title }}</span>
                <el-tag v-if="doc.import_source === 'taskid'" size="small" effect="plain" class="import-source-tag">{{ $t('docs.workspace.collection.taskIdImportTag') }}</el-tag>
              </div>
              <div class="doc-list-meta">
                <DocStatusBadge :status="doc.processing_status" :ocr-status="doc.ocr_status" size="small" />
                <span class="doc-list-time">{{ formatTime(doc.source_attachment?.created_at || doc.created_at) }}</span>
              </div>
            </div>

            <div class="pagination-wrap" v-if="store.docTotal > store.pageSize">
              <el-pagination
                v-model:current-page="store.docPage"
                :page-size="store.pageSize"
                :total="store.docTotal"
                layout="prev, pager, next"
                @current-change="onDocPageChange"
                small
              />
            </div>
          </div>
        </div>

        <!-- 中栏：文档内容预览 -->
        <div class="workspace-main">
          <div v-if="!selectedDocId" class="empty-state">
            <p>{{ $t('docs.workspace.collection.selectDoc') }}</p>
          </div>
          <template v-else-if="docStore.isLoading && !docStore.currentResult">
            <div class="loading-state">{{ $t('common.loading') }}</div>
          </template>
          <template v-else-if="docStore.error">
            <div class="error-state">{{ docStore.error }}</div>
          </template>
          <template v-else-if="docStore.currentResult">
            <!-- 文档头部信息 -->
            <div class="doc-header">
              <div class="doc-header-main">
                <div class="doc-header-info">
                  <h2 class="doc-title">{{ displayDocumentTitle }}</h2>
                  <div class="doc-id-line">
                    <span class="doc-id-label">{{ $t('docs.workspace.panel.docId') }}</span>
                    <span class="doc-id-value">{{ docStore.currentResult.document.id }}</span>
                  </div>
                  <div class="doc-meta">
                    <el-tag size="small" :type="processingTagType(docStore.currentResult.processing.status)">
                      {{ processingLabel(docStore.currentResult.processing.status) }}
                    </el-tag>
                    <el-tag size="small" :type="docTypeTag(docStore.currentResult.document.doc_type)">
                      {{ docTypeLabel(docStore.currentResult.document.doc_type) }}
                    </el-tag>
                    <span class="doc-updated">{{ formatDateTime(docStore.currentResult.document.updated_at) }}</span>
                  </div>
                </div>
                <el-button type="danger" plain size="small" @click="onDeleteDocument">{{ $t('docs.workspace.collection.deleteDoc') }}</el-button>
              </div>
            </div>

            <!-- 内容面板 -->
            <DocContentPanel
              :content="markdownPreview"
              :chunks="docStore.contentTree"
              :loading="markdownLoading"
              :is-polling="docStore.isPolling"
              :image-attachments="docStore.currentResult.image_attachments || []"
            />
          </template>
        </div>

        <!-- 右栏：文档信息与操作 -->
        <div class="workspace-sidebar">
          <template v-if="selectedDocId && docStore.currentResult">
            <DocSidebarPanel
              :processing-status="docStore.currentResult.processing.status"
              :ocr-status="docStore.currentResult.ocr_result?.status"
              :task-id="docStore.currentResult.ocr_result?.task_id"
              :progress="docStore.currentResult.ocr_result?.progress"
              :has-preview="docStore.currentResult.document.has_preview_result"
              :error-message="displayErrorMessage"
              :updated-at="docStore.currentResult.processing.updated_at"
              :title="docStore.currentResult.document.title"
              :mime-type="docStore.currentResult.source_attachment?.mime_type"
              :file-size="docStore.currentResult.source_attachment?.file_size"
              :uploader="docStore.currentResult.revision?.uploader?.username"
              :revision-id="docStore.currentResult.revision?.id"
              :revision-label="revisionLabel"
              :created-at="docStore.currentResult.document.created_at"
              :retry-action="retryAction"
              :retry-loading="retryLoading"
              :is-action-complete="isProcessingActionComplete"
              :document-id="docStore.currentResult.document.id"
              :resolved-current-id="docStore.currentResult.document.resolved_current_revision_id"
              :versions="docStore.versions"
              :attachment-download-url="docStore.currentResult.source_attachment?.download_url"
              :markdown-download-url="markdownAttachmentFromWorkspace?.download_url"
              :raw-markdown-download-url="rawMarkdownAttachmentFromWorkspace?.download_url"
              :raw-result-download-url="docStore.currentResult.ocr_result?.raw_result_attachment?.download_url"
              :image-attachments="displayedImageAttachments"
              :error-code="docStore.currentResult.processing.error_code"
              @retry="onRetryAction"
              @download="downloadAttachment"
              @version-changed="onVersionChanged"
              @previewVersion="onPreviewVersion"
            />
          </template>
          <template v-else-if="selectedDocId">
            <div class="sidebar-empty">
              <p>{{ $t('docs.workspace.collection.loadDocInfo') }}</p>
            </div>
          </template>
          <template v-else>
            <div class="sidebar-empty">
              <p>{{ $t('docs.workspace.collection.viewDetails') }}</p>
            </div>
          </template>
        </div>
      </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, toRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCollectionStore } from '@/stores/collection'
import { useDocStore } from '@/stores/doc'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { Search, ArrowRight } from '@element-plus/icons-vue'
import { getDocProcessingStatusTagType, probeGatewayTask } from '@/api/docs'
import type { GatewayTaskProbe } from '@/api/docs'
import apiClient from '@/api/client'
import ContextHeader from '@/components/docs/ContextHeader.vue'
import VisibilityTag from '@/components/docs/VisibilityTag.vue'
import DocStatusBadge from '@/components/docs/DocStatusBadge.vue'
import DocContentPanel from '@/components/docs/DocContentPanel.vue'
import DocSidebarPanel from '@/components/docs/DocSidebarPanel.vue'
import { useDocumentWorkspace } from '@/composables/useDocumentWorkspace'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const store = useCollectionStore()
const docStore = useDocStore()

const collectionId = route.params.id as string
const uploadDialogVisible = ref(false)
const pendingUploadFile = ref<File | null>(null)
const newDocumentRevisionLabel = ref('')
const uploadSource = ref<'local' | 'taskid'>('local')
const docSearch = ref('')
const statusFilter = ref('')
const selectedDocId = ref<string | null>(null)
const taskIdInput = ref('')
const taskIdProbing = ref(false)
const taskIdProbe = ref<GatewayTaskProbe | null>(null)
const taskIdError = ref('')
const taskIdDocTitle = ref('')

const markdownPreview = ref('')
const markdownLoading = ref(false)
const retryLoading = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | undefined

const breadcrumbs = computed(() => [
  { label: t('docs.workspace.detail.breadcrumb.platform'), to: '/docs' },
  { label: store.currentCollection?.name || t('docs.workspace.collection.collectionName') },
])

const hasActiveFilter = computed(() => !!(docSearch.value || statusFilter.value))

// 获取当前选中文档的标题
const displayDocumentTitle = computed(() => {
  return docStore.currentResult?.source_attachment?.file_name || docStore.currentResult?.document.title || t('docs.workspace.collection.document')
})

// 处理错误信息
const processingErrorCode = computed(() => docStore.currentResult?.processing?.error_code || null)
const processingErrorMessage = computed(() => docStore.currentResult?.processing?.error_message || '')

// 使用 composable 共享逻辑
const currentResultRef = toRef(docStore, 'currentResult')
const workspace = useDocumentWorkspace({
  currentResult: currentResultRef,
  markdownPreview,
  processingErrorCode,
  processingErrorMessage,
  t,
})

// 从 composable 获取共享的计算属性
const displayErrorMessage = computed(() => workspace.displayErrorMessage.value)
const retryAction = computed(() => workspace.retryAction.value)
const isProcessingActionComplete = computed(() => workspace.isProcessingActionComplete.value)
const revisionLabel = computed(() => workspace.revisionLabel.value)
const markdownAttachmentFromWorkspace = computed(() => workspace.markdownAttachment.value)
const rawMarkdownAttachmentFromWorkspace = computed(() => workspace.rawMarkdownAttachment.value)
const displayedImageAttachments = computed(() => workspace.displayedImageAttachments.value)

const docTypeTag = (type: string) => {
  const m: Record<string, string> = { knowledge: '', contract: 'warning', department_doc: 'info', standard: 'success' }
  return m[type] || ''
}

const docTypeLabel = (type: string) => {
  const m: Record<string, string> = { knowledge: 'KB', contract: 'Contract', department_doc: 'Dept', standard: 'Std' }
  return m[type] || type
}

function formatDateTime(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')
}

function processingLabel(status?: string) {
  if (!status) return '-'
  return t(`contractV2.processingStatus.${status}`)
}

function processingTagType(status?: string) {
  return getDocProcessingStatusTagType(status)
}

function doSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    store.docPage = 1
    loadDocuments()
  }, 300)
}

watch(docSearch, () => doSearch())
watch(statusFilter, () => doSearch())

function loadDocuments() {
  store.fetchCollectionDocuments(collectionId, {
    page: store.docPage,
    keyword: docSearch.value || undefined,
    processing_status: statusFilter.value || undefined,
  })
}

function clearFilters() {
  docSearch.value = ''
  statusFilter.value = ''
}

function formatDate(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleDateString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')
}

function formatTime(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')
}

function goSettings() {
  router.push(`/docs/collections/${collectionId}/settings`)
}

// 选择文档
async function selectDocument(documentId: string) {
  selectedDocId.value = documentId
  docStore.stopPolling()
  docStore.previewRevisionId = null
  
  // 加载文档详情
  await docStore.fetchDocument(documentId)
  if (!docStore.currentDoc) return
  
  const result = await docStore.fetchDocumentResult(documentId)
  if (!result) return

  await docStore.fetchVersions(documentId)
  
  await docStore.fetchProcessing(documentId)
  await loadMarkdownPreview()
  
  const revId = docStore.currentResult?.revision?.id
  if (revId) {
    await docStore.fetchContentTree(documentId, revId)
  }
  
  // 如果文档还在处理中，启动轮询
  const currentStatus = docStore.currentResult?.processing?.status
  const terminalStatuses = ['ready', 'error', 'failed']
  if (currentStatus && !terminalStatuses.includes(currentStatus)) {
    await docStore.startPolling(documentId)
    await docStore.fetchDocumentResult(documentId)
    await loadMarkdownPreview()
  }
}

async function onVersionChanged() {
  const documentId = docStore.currentResult?.document?.id
  if (!documentId) return
  await docStore.fetchVersions(documentId)
  await docStore.previewVersion(documentId, null)
  await loadMarkdownPreview()
}

async function onPreviewVersion(revisionId: string) {
  const documentId = docStore.currentResult?.document?.id
  if (!documentId) return
  const result = await docStore.previewVersion(documentId, revisionId)
  if (!result) {
    ElMessage.error(docStore.error || t('docs.workspace.detail.previewFailed'))
    return
  }
  await loadMarkdownPreview()
}

// 加载 Markdown 预览
async function loadMarkdownPreview() {
  const previewContent = docStore.currentResult?.ocr_result?.preview_markdown_content
  if (previewContent) {
    markdownPreview.value = previewContent
    return
  }

  const attachment = markdownAttachmentFromWorkspace.value
  if (!attachment?.id) {
    markdownPreview.value = ''
    return
  }

  markdownLoading.value = true
  try {
    const response = await apiClient.get(`/attachments/${attachment.id}/content`, {
      responseType: 'text',
    })
    markdownPreview.value = response.data || ''
  } catch {
    markdownPreview.value = ''
  } finally {
    markdownLoading.value = false
  }
}

// 删除文档
async function onDeleteDocument() {
  const current = docStore.currentResult?.document
  if (!current) return

  try {
    await ElMessageBox.confirm(
      t('docs.workspace.detail.deleteConfirm', { name: current.title }),
      t('docs.workspace.detail.deleteDoc'),
      { type: 'warning' },
    )

    const ok = await docStore.removeDocument(current.id)
    if (!ok) {
      ElMessage.error(docStore.error || t('docs.workspace.detail.deleteFailed'))
      return
    }

    ElMessage.success(t('docs.workspace.detail.deleteSuccess'))
    selectedDocId.value = null
    docStore.currentResult = null
    await store.fetchCollection(collectionId)
    await loadDocuments()
  } catch (error: unknown) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(docStore.error || t('docs.workspace.detail.deleteFailed'))
  }
}

// 重试操作
async function onRetryAction(type: string) {
  if (type === 'outline' || type === 'chunk') {
    const revId = docStore.currentResult?.revision?.id
    if (!revId) return
    retryLoading.value = true
    try {
      if (type === 'outline') {
        const result = await docStore.extractOutlineAction(revId)
        if (result) {
          ElMessage.success(t('docs.workspace.detail.submitOutline'))
          await loadMarkdownPreview()
        } else {
          ElMessage.error(docStore.error || t('docs.workspace.detail.outlineFailed'))
        }
      } else {
        const result = await docStore.generateChunksAction(revId)
        if (result) {
          ElMessage.success(t('docs.workspace.detail.submitChunk', { count: result.chunk_count }))
          await loadMarkdownPreview()
        } else {
          ElMessage.error(docStore.error || t('docs.workspace.detail.chunkFailed'))
        }
      }
    } finally {
      retryLoading.value = false
    }
    return
  }

  const documentId = docStore.currentResult?.document?.id
  if (!documentId) return
  retryLoading.value = true
  try {
    const result = await docStore.retryProcessingAction(documentId)
    if (result) {
      ElMessage.success(t('docs.workspace.detail.submitRetry'))
      await loadMarkdownPreview()
    } else {
      ElMessage.error(docStore.error || t('docs.workspace.detail.retryFailed', { action: retryAction.value?.label || t('docs.workspace.detail.submitRetry') }))
    }
  } finally {
    retryLoading.value = false
  }
}

// 下载附件
function downloadAttachment(url?: string) {
  if (!url) return
  window.open(url, '_blank')
}

function handleFileChange(file: UploadFile) {
  pendingUploadFile.value = file.raw || null
}

function handleFileRemove() {
  pendingUploadFile.value = null
}

const TASK_ID_RE = /^[0-9a-zA-Z-]{32,40}$/

async function probeTaskId() {
  const taskId = taskIdInput.value.trim()
  taskIdProbe.value = null
  taskIdError.value = ''
  if (!TASK_ID_RE.test(taskId)) {
    taskIdError.value = t('docs.workspace.collection.taskIdInvalid')
    return
  }
  taskIdProbing.value = true
  try {
    const result = await probeGatewayTask(taskId)
    if (result.status === 'completed') {
      taskIdProbe.value = result
      const baseName = (result.filename || result.artifact_name || '').replace(/\.[^.]+$/, '')
      taskIdDocTitle.value = baseName || `Task ${taskId.slice(0, 8)}`
    } else if (result.status === 'not_found') {
      taskIdError.value = t('docs.workspace.collection.taskIdNotFound')
    } else if (result.status === 'cancelled') {
      taskIdError.value = t('docs.workspace.collection.taskIdCancelled')
    } else if (result.status === 'failed') {
      taskIdError.value = t('docs.workspace.collection.taskIdFailed')
    } else {
      taskIdError.value = t('docs.workspace.collection.taskIdProcessing')
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    if (/not found/i.test(message)) {
      taskIdError.value = t('docs.workspace.collection.taskIdNotFound')
    } else if (/cancel/i.test(message)) {
      taskIdError.value = t('docs.workspace.collection.taskIdCancelled')
    } else if (/fail/i.test(message)) {
      taskIdError.value = t('docs.workspace.collection.taskIdFailed')
    } else {
      taskIdError.value = message || t('docs.workspace.collection.taskIdProcessing')
    }
  } finally {
    taskIdProbing.value = false
  }
}

async function confirmTaskIdImport() {
  const probe = taskIdProbe.value
  if (!probe || probe.status !== 'completed') return
  const result = await store.importGatewayTaskToCollection(
    collectionId,
    probe.task_id,
    taskIdDocTitle.value.trim() || undefined,
    newDocumentRevisionLabel.value.trim() || null,
    probe.already_imported === true,
  )
  if (!result) {
    ElMessage.error(store.error || t('docs.workspace.collection.importFailed'))
    return
  }
  uploadDialogVisible.value = false
  ElMessage.success(t('docs.workspace.collection.importSuccess'))
  selectDocument(result.document_id)
  await store.fetchCollection(collectionId)
  await loadDocuments()
}

function openUploadDialog() {
  uploadSource.value = 'local'
  pendingUploadFile.value = null
  newDocumentRevisionLabel.value = ''
  taskIdInput.value = ''
  taskIdProbe.value = null
  taskIdError.value = ''
  taskIdDocTitle.value = ''
  uploadDialogVisible.value = true
}

async function submitUploadDocument() {
  const rawFile = pendingUploadFile.value
  if (!rawFile) return

  const trimmedRevisionLabel = newDocumentRevisionLabel.value.trim()
  const result = await store.uploadDocumentToCollection(collectionId, rawFile, {
    revision_label: trimmedRevisionLabel || null,
  })
  if (!result) {
    ElMessage.error(store.error || t('docs.workspace.detail.uploadFailed'))
    return
  }

  ElMessage.success(t('docs.workspace.detail.uploadSuccess'))
  uploadDialogVisible.value = false
  pendingUploadFile.value = null
  newDocumentRevisionLabel.value = ''
  // 选中新上传的文档
  selectDocument(result.intake.document_id)
  await store.fetchCollection(collectionId)
  await loadDocuments()
}

function onDocPageChange() {
  loadDocuments()
}

onMounted(async () => {
  await store.fetchCollection(collectionId)
  if (store.currentCollection) {
    await loadDocuments()
  }
})

onBeforeUnmount(() => {
  docStore.stopPolling()
})
</script>

<style scoped>
.collection-workspace { padding: 16px; height: calc(100vh - 60px); display: flex; flex-direction: column; }
.loading-state, .empty-state, .error-state { text-align: center; padding: 40px 0; color: #999; }

.upload-source-switch { display: flex; gap: 12px; margin-bottom: 16px; }
.source-option { flex: 1; border: 1px solid var(--el-border-color); border-radius: 8px; padding: 12px 14px; cursor: pointer; transition: border-color .15s, background-color .15s; }
.source-option:hover { border-color: var(--el-color-primary-light-5); }
.source-option.active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.source-title { font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); }
.source-desc { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; line-height: 1.5; }
.upload-local-body { padding: 8px 0 4px; text-align: center; }
.taskid-input-row { display: flex; gap: 8px; }
.taskid-alert { margin-top: 12px; }
.taskid-result { margin-top: 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 12px 14px; background: var(--el-fill-color-lighter); }
.taskid-result-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
.taskid-result-row:last-of-type { margin-bottom: 0; }
.taskid-label { width: 80px; flex-shrink: 0; color: var(--el-text-color-secondary); }
.taskid-value { color: var(--el-text-color-primary); min-width: 0; word-break: break-all; }
.taskid-title-input { margin-top: 12px; }

.workspace-layout {
  display: grid;
  grid-template-columns: 280px 1fr 320px;
  gap: 16px;
  flex: 1;
  min-height: 0;
  margin-top: 16px;
}

/* 左栏：文档清单 */
.workspace-left {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.doc-toolbar {
  padding: 12px;
  border-bottom: 1px solid #ebeef5;
}
.toolbar-left { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.toolbar-search { width: 100%; }
.toolbar-select { width: 100%; }

.doc-list {
  flex: 1;
  overflow-y: auto;
}

.doc-list-item {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background 0.2s;
}
.doc-list-item:hover { background: #f5f7fa; }
.doc-list-item.active { background: #ecf5ff; border-left: 3px solid #409eff; }

.doc-list-title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-list-title-text { overflow: hidden; text-overflow: ellipsis; }
.import-source-tag { flex-shrink: 0; }

.active-indicator { color: #409eff; font-weight: bold; }

.doc-list-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.doc-list-time {
  font-size: 12px;
  color: #c0c4cc;
}

.pagination-wrap {
  padding: 12px;
  display: flex;
  justify-content: center;
  border-top: 1px solid #ebeef5;
}

/* 中栏：文档内容 */
.workspace-main {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow-y: auto;
  padding: 20px;
}

.doc-header { margin-bottom: 20px; }
.doc-header-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.doc-title { margin: 0; font-size: 20px; font-weight: 600; }
.doc-id-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.4;
}
.doc-id-label {
  color: var(--el-text-color-secondary);
}
.doc-id-value {
  color: var(--el-text-color-regular);
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace);
  word-break: break-all;
}
.doc-meta { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.doc-updated { font-size: 12px; color: #909399; }

/* 右栏：侧边栏 */
.workspace-sidebar {
  overflow-y: auto;
}

.sidebar-empty {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 40px 20px;
  text-align: center;
  color: #999;
}

.update-time { color: #c0c4cc; }

@media (max-width: 1200px) {
  .workspace-layout {
    grid-template-columns: 240px 1fr 280px;
  }
}

@media (max-width: 900px) {
  .workspace-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
  }
  .workspace-left { max-height: 300px; }
  .workspace-sidebar { max-height: 300px; }
}
</style>
