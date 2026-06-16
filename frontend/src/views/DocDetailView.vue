<template>
  <div class="document-workspace">
    <div class="doc-breadcrumb">
      <router-link to="/docs" class="breadcrumb-link">文档平台</router-link>
      <span class="breadcrumb-sep">/</span>
      <router-link v-if="collectionId" :to="`/docs/collections/${collectionId}`" class="breadcrumb-link">
        集合详情
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
          <el-button type="danger" plain size="small" @click="onDeleteDocument">删除文档</el-button>
        </div>
      </div>

      <div class="doc-content-layout">
        <div class="doc-main-area">
          <div class="section-card">
            <h3>正文预览</h3>
            <div v-if="markdownLoading" class="loading-state small">加载中...</div>
            <div v-else-if="markdownPreview" class="markdown-preview">{{ markdownPreview }}</div>
            <div v-else class="empty-state small">
              暂无预览结果，文档可能仍在处理中
              <el-tag v-if="docStore.isPolling" type="warning" size="small" class="polling-tag">轮询中</el-tag>
            </div>
          </div>

          <div v-if="docStore.contentTree.length > 0" class="section-card">
            <h3>分块列表 ({{ docStore.contentTree.length }})</h3>
            <div class="chunk-list">
              <div v-for="(chunk, idx) in docStore.contentTree" :key="chunk.id" class="chunk-item">
                <div class="chunk-header">
                  <span class="chunk-seq">#{{ idx + 1 }}</span>
                  <span v-if="chunk.title" class="chunk-title">{{ chunk.title }}</span>
                  <span class="chunk-meta">
                    行 {{ chunk.from_line ?? '-' }}-{{ chunk.to_line ?? '-' }}
                    · {{ chunk.token_count ?? '-' }} tokens
                  </span>
                </div>
                <div class="chunk-content">{{ chunk.content }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="doc-sidebar">
          <div class="sidebar-section">
            <h4 class="sidebar-title">处理状态</h4>
            <div class="sidebar-status">
              <div class="status-row">
                <span class="status-label">处理状态</span>
                <span class="status-value">
                  <el-tag size="small" :type="processingTagType(docStore.currentResult.processing.status)">
                    {{ processingLabel(docStore.currentResult.processing.status) }}
                  </el-tag>
                  <span v-if="isLongRunning" class="duration-warn">{{ processingDuration }}</span>
                </span>
              </div>
              <div class="status-row">
                <span class="status-label">OCR 状态</span>
                <span class="status-value">{{ docStore.currentResult.ocr_result?.status || '-' }}</span>
              </div>
              <div v-if="docStore.currentResult.ocr_result?.task_id" class="status-row">
                <span class="status-label">Task ID</span>
                <span class="status-value task-id-value">{{ docStore.currentResult.ocr_result.task_id }}</span>
              </div>
              <div v-if="docStore.currentResult.ocr_result?.progress !== undefined" class="status-row">
                <span class="status-label">进度</span>
                <span class="status-value">
                  <el-progress :percentage="docStore.currentResult.ocr_result.progress" :stroke-width="6" />
                </span>
              </div>
              <div class="status-row">
                <span class="status-label">可预览</span>
                <span class="status-value">{{ docStore.currentResult.document.has_preview_result ? '是' : '否' }}</span>
              </div>
            </div>
            <div v-if="displayErrorMessage" class="error-box">
              {{ displayErrorMessage }}
            </div>
          </div>

          <div class="sidebar-section">
            <h4 class="sidebar-title">基本信息</h4>
            <div class="sidebar-status">
              <div class="status-row">
                <span class="status-label">文档编号</span>
                <span class="status-value task-id-value">{{ docStore.currentResult.document.title || '-' }}</span>
              </div>
              <div class="status-row">
                <span class="status-label">文件类型</span>
                <span class="status-value">{{ docStore.currentResult.source_attachment?.mime_type || '-' }}</span>
              </div>
              <div class="status-row">
                <span class="status-label">大小</span>
                <span class="status-value">{{ formatFileSize(docStore.currentResult.source_attachment?.file_size) }}</span>
              </div>
              <div class="status-row">
                <span class="status-label">上传人</span>
                <span class="status-value">{{ docStore.currentResult.revision?.uploader?.username || '-' }}</span>
              </div>
              <div class="status-row">
                <span class="status-label">版本</span>
                <span class="status-value">{{ revisionLabel }}</span>
              </div>
              <div class="status-row">
                <span class="status-label">创建时间</span>
                <span class="status-value">{{ fmt(docStore.currentResult.document.created_at) }}</span>
              </div>
            </div>
          </div>

          <div class="sidebar-section">
            <h4 class="sidebar-title">处理操作</h4>
            <div class="sidebar-actions">
              <el-button
                v-if="retryAction"
                type="primary"
                size="small"
                :loading="retryLoading"
                @click="onRetryAction"
              >
                {{ retryAction.label }}
              </el-button>
              <el-tag v-else-if="isProcessingActionComplete" type="success" size="small">
                已完成
              </el-tag>
              <span v-else class="empty-state tiny">当前步骤无需手动操作</span>
            </div>
          </div>

          <div class="sidebar-section">
            <h4 class="sidebar-title">下载</h4>
            <div class="sidebar-actions">
              <el-button v-if="docStore.currentResult.source_attachment?.download_url" size="small" @click="downloadAttachment(docStore.currentResult.source_attachment?.download_url)">
                原始文件
              </el-button>
              <el-button v-if="docStore.currentResult.ocr_result?.main_markdown_attachment?.download_url" size="small" type="primary" @click="downloadAttachment(docStore.currentResult.ocr_result?.main_markdown_attachment?.download_url)">
                Markdown
              </el-button>
              <el-button v-if="docStore.currentResult.ocr_result?.raw_result_attachment?.download_url" size="small" @click="downloadAttachment(docStore.currentResult.ocr_result?.raw_result_attachment?.download_url)">
                原始结果
              </el-button>
            </div>
          </div>

          <div class="sidebar-section">
            <h4 class="sidebar-title">附件</h4>
            <div v-if="docStore.currentResult.image_attachments.length === 0" class="empty-state tiny">暂无图片附件</div>
            <div v-else class="attachment-list">
              <div v-for="(item, index) in docStore.currentResult.image_attachments" :key="item.id" class="attachment-item">
                <div class="attachment-name">附件 {{ index + 1 }}</div>
                <div class="attachment-meta">{{ item.attachment?.mime_type || item.media_type || '-' }} · {{ formatFileSize(item.attachment?.file_size) }}</div>
                <el-button v-if="item.attachment?.download_url" size="small" text type="primary" @click="downloadAttachment(item.attachment?.download_url)">下载</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDocStore } from '@/stores/doc'
import apiClient from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const docStore = useDocStore()
const markdownPreview = ref('')
const markdownLoading = ref(false)
const outlineLoading = ref(false)
const chunkLoading = ref(false)
const retryProcessingLoading = ref(false)

const processingErrorCode = computed(() => docStore.currentResult?.processing?.error_code || null)
const processingErrorMessage = computed(() => docStore.currentResult?.processing?.error_message || '')
const displayDocumentTitle = computed(() => docStore.currentResult?.source_attachment?.file_name || docStore.currentResult?.document.title || '文档')

const retryAction = computed(() => {
  const status = docStore.currentResult?.processing?.status
  const errorCode = processingErrorCode.value

  if (errorCode === 'outline_extraction_failed') {
    return { type: 'outline', label: '重试章节提取' }
  }

  if (errorCode === 'chunk_generation_failed') {
    return { type: 'chunk', label: '重试文本分块' }
  }

  if (status === 'error') {
    if (errorCode === 'clean_failed') return { type: 'clean', label: '重试数据清洗' }
    if (errorCode === 'metadata_failed') return { type: 'metadata', label: '重试元数据提取' }
    if (errorCode === 'embedding_failed') return { type: 'embedding', label: '重试向量化' }
    if (errorCode === 'ocr_failed') return { type: 'ocr', label: '重试OCR' }
  }

  return null
})

const isProcessingActionComplete = computed(() => {
  const status = docStore.currentResult?.processing?.status
  return status === 'ready'
    || status === 'pending_embedding'
    || status === 'pending_relocate'
    || status === 'pending_chunk'
    || status === 'pending_outline'
})

const retryLoading = computed(() => {
  if (retryAction.value?.type === 'outline') return outlineLoading.value
  if (retryAction.value?.type === 'chunk') return chunkLoading.value
  if (retryAction.value?.type === 'clean' || retryAction.value?.type === 'metadata' || retryAction.value?.type === 'embedding' || retryAction.value?.type === 'ocr') return retryProcessingLoading.value
  return false
})

const displayErrorMessage = computed(() => {
  const status = docStore.currentResult?.processing?.status
  if (status === 'error' && processingErrorMessage.value) {
    return processingErrorMessage.value
  }
  return docStore.currentResult?.ocr_result?.error_message || ''
})

const LONG_RUNNING_THRESHOLD_MS = 20 * 60 * 1000
const NON_TERMINAL_STATUSES = ['pending_ocr', 'ocr_processing', 'pending_clean', 'pending_metadata', 'pending_outline', 'pending_chunk', 'pending_embedding', 'pending_relocate']

const isLongRunning = computed(() => {
  const status = docStore.currentResult?.processing?.status
  const updatedAt = docStore.currentResult?.processing?.updated_at
  if (!status || !updatedAt) return false
  if (!NON_TERMINAL_STATUSES.includes(status)) return false
  return Date.now() - new Date(updatedAt).getTime() > LONG_RUNNING_THRESHOLD_MS
})

const processingDuration = computed(() => {
  const updatedAt = docStore.currentResult?.processing?.updated_at
  if (!updatedAt) return ''
  const ms = Date.now() - new Date(updatedAt).getTime()
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}min`
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
  return t ? new Date(t).toLocaleString('zh-CN') : ''
}

function formatFileSize(size?: number | null) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function downloadAttachment(url?: string) {
  if (!url) return
  window.open(url, '_blank')
}

function processingLabel(status?: string) {
  if (status === 'pending_ocr') return '待OCR'
  if (status === 'ocr_processing') return 'OCR处理中'
  if (status === 'pending_clean') return '待文本清洗'
  if (status === 'pending_metadata') return '待元数据'
  if (status === 'pending_outline') return '待章节提取'
  if (status === 'pending_chunk') return '待文本分块'
  if (status === 'pending_embedding') return '待向量化'
  if (status === 'pending_relocate') return '待迁移'
  if (status === 'ready') return '已就绪'
  if (status === 'error') return '处理失败'
  return status || '-'
}

function processingTagType(status?: string) {
  if (status === 'ready') return 'success'
  if (status === 'ocr_processing' || status === 'pending_ocr') return 'warning'
  if (status === 'pending_outline' || status === 'pending_chunk' || status === 'pending_clean' || status === 'pending_metadata' || status === 'pending_embedding' || status === 'pending_relocate') return 'info'
  if (status === 'error') return 'danger'
  return 'info'
}

const revisionLabel = computed(() => {
  const r = docStore.currentResult?.revision
  if (!r) return '-'
  return r.revision_label || `r${r.revision_no}`
})

async function onDeleteDocument() {
  const current = docStore.currentResult?.document
  if (!current) return

  try {
    await ElMessageBox.confirm(
      `确定删除文档「${current.title}」吗？此操作会同时删除文档记录、OCR结果和附件文件。`,
      '删除文档',
      { type: 'warning' },
    )

    const ok = await docStore.removeDocument(current.id)
    if (!ok) {
      ElMessage.error(docStore.error || '删除文档失败')
      return
    }

    ElMessage.success('文档已删除')
    const cid = collectionId.value
    if (cid) {
      router.push(`/docs/collections/${cid}`)
    } else {
      router.push('/docs')
    }
  } catch (error: unknown) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(docStore.error || '删除文档失败')
  }
}

async function loadMarkdownPreview() {
    const attachment = docStore.currentResult?.ocr_result?.cleaned_markdown_attachment
      || docStore.currentResult?.ocr_result?.main_markdown_attachment
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
        ElMessage.success(`成功提取 ${result.outline_count} 个章节${result.partial ? '（部分成功）' : ''}`)
        await loadMarkdownPreview()
      } else {
        ElMessage.error(docStore.error || '章节提取失败')
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
        ElMessage.success(`成功生成 ${result.chunk_count} 个分块`)
        await loadMarkdownPreview()
      } else {
        ElMessage.error(docStore.error || '分块生成失败')
      }
    } finally {
      chunkLoading.value = false
    }
  }

  async function onRetryAction() {
    if (retryAction.value?.type === 'outline') {
      await onExtractOutline()
      return
    }
    if (retryAction.value?.type === 'chunk') {
      await onGenerateChunks()
      return
    }
    const documentId = docStore.currentResult?.document?.id
    if (!documentId) return
    retryProcessingLoading.value = true
    try {
      const result = await docStore.retryProcessingAction(documentId)
      if (result) {
        ElMessage.success(`${retryAction.value?.label || '重试处理'} 已提交`)
        await loadMarkdownPreview()
      } else {
        ElMessage.error(docStore.error || `${retryAction.value?.label || '重试处理'}失败`)
      }
    } finally {
      retryProcessingLoading.value = false
    }
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

    const completed = docStore.currentResult?.processing?.status === 'ready'
    const failed = docStore.currentResult?.processing?.status === 'error'
    if (!completed && !failed) {
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
.doc-meta { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.doc-updated { font-size: 12px; color: #909399; }

.doc-content-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
.doc-main-area { min-width: 0; }
.doc-sidebar { display: flex; flex-direction: column; gap: 16px; }

.section-card { background: #fff; border: 1px solid #ebeef5; border-radius: 10px; padding: 20px; }
.section-card h3 { margin: 0 0 16px; font-size: 16px; }

.markdown-preview { white-space: pre-wrap; line-height: 1.8; color: #303133; background: #fafafa; border-radius: 8px; padding: 20px; min-height: 200px; max-height: 70vh; overflow-y: auto; font-size: 14px; }

.sidebar-section { background: #fff; border: 1px solid #ebeef5; border-radius: 8px; padding: 16px; }
.sidebar-title { margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #303133; }
.sidebar-status { display: flex; flex-direction: column; gap: 8px; }

.status-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.status-label { font-size: 12px; color: #909399; flex-shrink: 0; }
.status-value { font-size: 13px; color: #303133; text-align: right; }
.task-id-value { word-break: break-all; font-family: Consolas, 'Courier New', monospace; font-size: 12px; }
.text-truncate { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sidebar-actions { display: flex; flex-direction: column; gap: 6px; }
.attachment-list { display: flex; flex-direction: column; gap: 8px; }
.attachment-item { border: 1px solid #f0f0f0; border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px; }
.attachment-name { font-size: 13px; font-weight: 500; }
.attachment-meta { font-size: 11px; color: #909399; margin: 2px 0; }

.error-box { margin-top: 8px; padding: 8px 12px; border-radius: 6px; background: #fef0f0; color: #c45656; font-size: 12px; }

.duration-warn { display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 4px; background: #f56c6c; color: #fff; font-size: 11px; font-weight: 600; vertical-align: middle; }

.chunk-list { display: flex; flex-direction: column; gap: 12px; }
.chunk-item { border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden; }
.chunk-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f5f7fa; border-bottom: 1px solid #f0f0f0; }
.chunk-seq { font-size: 13px; font-weight: 600; color: #409eff; }
.chunk-title { font-size: 13px; font-weight: 500; color: #303133; }
.chunk-meta { font-size: 11px; color: #909399; margin-left: auto; }
.chunk-content { padding: 14px; font-size: 13px; color: #606266; white-space: pre-wrap; line-height: 1.7; max-height: 300px; overflow-y: auto; }

.loading-state, .error-state, .empty-state { padding: 40px 0; text-align: center; color: #999; }
.small { padding: 16px 0; }
.tiny { padding: 8px 0; font-size: 12px; }
.polling-tag { margin-left: 8px; }

@media (max-width: 768px) {
  .document-workspace { padding: 16px; max-width: none; }
  .doc-content-layout { grid-template-columns: 1fr; }
  .doc-sidebar { order: -1; }
  .doc-header-main { flex-direction: column; }
}
</style>
