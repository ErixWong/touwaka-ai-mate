<template>
  <div class="document-workspace">
    <div class="doc-breadcrumb">
      <router-link to="/docs" class="breadcrumb-link">{{ $t('docs.workspace.detail.breadcrumb.platform') }}</router-link>
      <span class="breadcrumb-sep">/</span>
      <router-link v-if="collectionId" :to="`/docs/collections/${collectionId}`" class="breadcrumb-link">
        {{ $t('docs.workspace.detail.breadcrumb.collection') }}
      </router-link>
      <span v-if="collectionId" class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">{{ displayDocumentTitle }}</span>
    </div>

    <div v-if="docStore.isLoading && !docStore.currentResult" class="loading-state">{{ $t('common.loading') }}</div>
    <div v-else-if="docStore.error" class="error-state">{{ docStore.error }}</div>

    <template v-else-if="docStore.currentResult">
      <div class="doc-header">
        <div class="doc-header-main">
          <div class="doc-header-info">
            <h1 class="doc-title">{{ displayDocumentTitle }}</h1>
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
              <span class="doc-updated">{{ fmt(docStore.currentResult.document.updated_at) }}</span>
            </div>
          </div>
          <el-button type="danger" plain size="small" @click="onDeleteDocument">{{ $t('docs.workspace.detail.deleteDoc') }}</el-button>
        </div>
      </div>

      <div class="doc-content-layout">
        <div class="doc-main-area">
          <DocContentPanel
            :content="markdownPreview"
            :chunks="docStore.contentTree"
            :loading="markdownLoading"
            :is-polling="docStore.isPolling"
            :image-attachments="docStore.currentResult?.image_attachments || []"
          />
        </div>

        <div class="doc-sidebar">
          <DocSidebarPanel
            :processing-status="docStore.currentResult?.processing?.status"
            :ocr-status="docStore.currentResult?.ocr_result?.status"
            :task-id="docStore.currentResult?.ocr_result?.task_id"
            :progress="docStore.currentResult?.ocr_result?.progress"
            :has-preview="docStore.currentResult?.document?.has_preview_result"
            :error-message="displayErrorMessage"
            :updated-at="docStore.currentResult?.processing?.updated_at"
            :title="docStore.currentResult?.document?.title"
            :mime-type="docStore.currentResult?.source_attachment?.mime_type"
            :file-size="docStore.currentResult?.source_attachment?.file_size"
            :uploader="docStore.currentResult?.revision?.uploader?.username"
            :revision-label="revisionLabel"
            :created-at="docStore.currentResult?.document?.created_at"
            :retry-action="retryAction"
            :retry-loading="retryLoadingComputed"
            :is-action-complete="isProcessingActionComplete"
            :attachment-download-url="docStore.currentResult?.source_attachment?.download_url"
            :markdown-download-url="markdownAttachmentFromWorkspace?.download_url"
            :raw-markdown-download-url="rawMarkdownAttachmentFromWorkspace?.download_url"
            :raw-result-download-url="docStore.currentResult?.ocr_result?.raw_result_attachment?.download_url"
            :image-attachments="displayedImageAttachments"
            :error-code="docStore.currentResult?.processing?.error_code"
            @retry="onRetryAction"
            @download="downloadAttachment"
          />
        </div>
      </div>

      <DocVersionPanel
        :document-id="docStore.currentResult.document.id"
        :resolved-current-id="docStore.currentResult.document.resolved_current_revision_id"
        :versions="docStore.versions"
        @version-changed="onVersionChanged"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDocStore } from '@/stores/doc'
import apiClient from '@/api/client'
import {
  getDocProcessingStatusTagType,
  isTerminalDocProcessingStatus,
} from '@/api/docs'
import { ElMessage, ElMessageBox } from 'element-plus'
import DocContentPanel from '@/components/docs/DocContentPanel.vue'
import DocSidebarPanel from '@/components/docs/DocSidebarPanel.vue'
import DocVersionPanel from '@/components/docs/DocVersionPanel.vue'
import { useDocumentWorkspace } from '@/composables/useDocumentWorkspace'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const docStore = useDocStore()
const markdownPreview = ref('')
const markdownLoading = ref(false)
const outlineLoading = ref(false)
const chunkLoading = ref(false)
const retryProcessingLoading = ref(false)

const processingErrorCode = computed(() => docStore.currentResult?.processing?.error_code || null)
const processingErrorMessage = computed(() => docStore.currentResult?.processing?.error_message || '')
const displayDocumentTitle = computed(() => docStore.currentResult?.source_attachment?.file_name || docStore.currentResult?.document.title || '文档')

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
const displayedImageAttachments = workspace.displayedImageAttachments
const retryAction = computed(() => workspace.retryAction.value)
const isProcessingActionComplete = computed(() => workspace.isProcessingActionComplete.value)
const displayErrorMessage = computed(() => workspace.displayErrorMessage.value)
const revisionLabel = computed(() => workspace.revisionLabel.value)
const markdownAttachmentFromWorkspace = computed(() => workspace.markdownAttachment.value)
const rawMarkdownAttachmentFromWorkspace = computed(() => workspace.rawMarkdownAttachment.value)

const retryLoadingComputed = computed(() => {
  if (retryAction.value?.type === 'outline') return outlineLoading.value
  if (retryAction.value?.type === 'chunk') return chunkLoading.value
  if (retryAction.value?.type === 'clean' || retryAction.value?.type === 'metadata' || retryAction.value?.type === 'embedding' || retryAction.value?.type === 'ocr') return retryProcessingLoading.value
  return false
})

const collectionId = computed(() => {
  const q = route.query.fromCollection as string
  if (q) return q
  return docStore.currentResult?.document?.collection_id || null
})

function docTypeTag(type: string) {
  const m: Record<string, string> = { knowledge: '', contract: 'warning', department_doc: 'info', standard: 'success' }
  return m[type] || ''
}

function docTypeLabel(type: string) {
  const m: Record<string, string> = { knowledge: 'KB', contract: 'Contract', department_doc: 'Dept', standard: 'Std' }
  return m[type] || type
}

function fmt(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')
}

function downloadAttachment(url?: string) {
  if (!url) return
  window.open(url, '_blank')
}

function processingLabel(status?: string) {
  if (!status) return '-'
  return t(`contractV2.processingStatus.${status}`)
}

function processingTagType(status?: string) {
  return getDocProcessingStatusTagType(status)
}

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
    const cid = collectionId.value
    if (cid) {
      router.push(`/docs/collections/${cid}`)
    } else {
      router.push('/docs')
    }
  } catch (error: unknown) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(docStore.error || t('docs.workspace.detail.deleteFailed'))
  }
}

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

  async function onExtractOutline() {
    const revId = docStore.currentResult?.revision?.id
    if (!revId) return
    outlineLoading.value = true
    try {
      const result = await docStore.extractOutlineAction(revId)
      if (result) {
        if (result.status === 'already_running') {
          ElMessage.info(t('docs.workspace.detail.outlineRunning') || '章节提取正在进行中')
        } else {
          ElMessage.success(t('docs.workspace.detail.submitOutline'))
        }
        // 不再立即加载 markdown——轮询结束时自动刷新
      } else {
        ElMessage.error(docStore.error || t('docs.workspace.detail.outlineFailed'))
      }
    } finally {
      outlineLoading.value = false
    }
  }

  async function onGenerateChunks() {
    const revId = docStore.currentResult?.revision?.id
    if (!revId) return
    chunkLoading.value = true
    try {
      const result = await docStore.generateChunksAction(revId)
      if (result) {
        ElMessage.success(t('docs.workspace.detail.submitChunk', { count: result.chunk_count }))
        await loadMarkdownPreview()
      } else {
        ElMessage.error(docStore.error || t('docs.workspace.detail.chunkFailed'))
      }
    } finally {
      chunkLoading.value = false
    }
  }

  async function onRetryAction(type: string) {
    if (type === 'outline') {
      await onExtractOutline()
      return
    }
    if (type === 'chunk') {
      await onGenerateChunks()
      return
    }
    const documentId = docStore.currentResult?.document?.id
    if (!documentId) return
    retryProcessingLoading.value = true
    try {
      const result = await docStore.retryProcessingAction(documentId)
      if (result) {
        ElMessage.success(t('docs.workspace.detail.submitRetry'))
        await loadMarkdownPreview()
      } else {
        ElMessage.error(docStore.error || t('docs.workspace.detail.retryFailed', { action: retryAction.value?.label || t('docs.workspace.detail.submitRetry') }))
      }
    } finally {
      retryProcessingLoading.value = false
    }
  }

  async function onVersionChanged() {
    const documentId = docStore.currentResult?.document?.id
    if (!documentId) return
    await docStore.fetchVersions(documentId)
    await docStore.fetchDocumentResult(documentId)
    await loadMarkdownPreview()
  }

  onMounted(async () => {
  const documentId = route.params.documentId as string
  if (documentId) {
    const document = await docStore.fetchDocument(documentId)
    if (!document) {
      docStore.stopPolling()
      return
    }

    const result = await docStore.fetchDocumentResult(documentId)
    if (!result) {
      docStore.stopPolling()
      return
    }

    await docStore.fetchProcessing(documentId)
    await loadMarkdownPreview()

    const revId = docStore.currentResult?.revision?.id
    if (revId) {
      await docStore.fetchContentTree(documentId, revId)
    }

    // 加载版本列表
    await docStore.fetchVersions(documentId)

    const currentStatus = docStore.currentResult?.processing?.status
    if (!isTerminalDocProcessingStatus(currentStatus)) {
      await docStore.startPolling(documentId)
      if (docStore.currentResult?.document?.id === documentId) {
        await docStore.fetchDocumentResult(documentId)
        await loadMarkdownPreview()
      }
    }
  }
})

onBeforeUnmount(() => {
  docStore.stopPolling()
})
</script>

<style scoped>
.document-workspace { max-width: 1100px; margin: 0 auto; padding: 24px; }

.doc-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #909399; margin-bottom: 16px; }
.breadcrumb-sep { color: #c0c4cc; }
.breadcrumb-link { color: #909399; text-decoration: none; }
.breadcrumb-link:hover { color: #409eff; }
.breadcrumb-current { color: #303133; font-weight: 500; }

.doc-header { margin-bottom: 24px; }
.doc-header-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.doc-title { margin: 0; font-size: 22px; font-weight: 600; }
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

.doc-content-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
.doc-main-area { min-width: 0; }
.doc-sidebar { display: flex; flex-direction: column; gap: 16px; }

.loading-state, .error-state, .empty-state { padding: 40px 0; text-align: center; color: #999; }

@media (max-width: 768px) {
  .document-workspace { padding: 16px; max-width: none; }
  .doc-content-layout { grid-template-columns: 1fr; }
  .doc-sidebar { order: -1; }
  .doc-header-main { flex-direction: column; }
}
</style>
