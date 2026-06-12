<template>
  <div class="doc-detail-view">
    <div class="back-row">
      <el-button text @click="goBack">← 返回上一页</el-button>
    </div>

    <div v-if="docStore.isLoading && !docStore.currentResult" class="loading-state">{{ $t('common.loading') }}</div>
    <div v-else-if="docStore.error" class="error-state">{{ docStore.error }}</div>

    <template v-else-if="docStore.currentResult">
      <div class="doc-header">
        <div class="doc-header-main">
          <div>
            <h1>{{ docStore.currentResult.document.title }}</h1>
            <div class="doc-meta">
              <el-tag :type="docTypeTag(docStore.currentResult.document.doc_type)">{{ docTypeLabel(docStore.currentResult.document.doc_type) }}</el-tag>
              <span>{{ docStore.currentResult.document.source_system }}</span>
              <span>{{ fmt(docStore.currentResult.document.updated_at) }}</span>
            </div>
          </div>
          <el-button type="danger" plain @click="onDeleteDocument">删除文档</el-button>
        </div>
      </div>

      <div class="section-card">
        <h3>基本信息</h3>
        <div class="info-grid">
          <div><span class="label">文档标题</span><span>{{ docStore.currentResult.document.title }}</span></div>
          <div><span class="label">文件名</span><span>{{ docStore.currentResult.source_attachment?.file_name || '-' }}</span></div>
          <div><span class="label">文件类型</span><span>{{ docStore.currentResult.source_attachment?.mime_type || '-' }}</span></div>
          <div><span class="label">大小</span><span>{{ formatFileSize(docStore.currentResult.source_attachment?.file_size) }}</span></div>
          <div><span class="label">上传人</span><span>{{ docStore.currentResult.revision?.uploader?.username || '-' }}</span></div>
          <div><span class="label">创建时间</span><span>{{ fmt(docStore.currentResult.document.created_at) }}</span></div>
          <div><span class="label">当前 revision</span><span>{{ revisionLabel }}</span></div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-title-row">
          <h3>处理状态</h3>
          <el-tag v-if="docStore.isPolling" type="warning">轮询中</el-tag>
        </div>
        <div class="info-grid">
          <div><span class="label">处理状态</span><span>{{ processingLabel }}</span></div>
          <div><span class="label">OCR 状态</span><span>{{ docStore.currentResult.ocr_result?.status || '-' }}</span></div>
          <div><span class="label">真实 OCR Task ID</span><span class="task-id-value">{{ docStore.currentResult.ocr_result?.task_id || '-' }}</span></div>
          <div><span class="label">进度</span><span>{{ progressLabel }}</span></div>
          <div><span class="label">可预览结果</span><span>{{ docStore.currentResult.document.has_preview_result ? '是' : '否' }}</span></div>
        </div>
        <div v-if="docStore.currentResult.processing.error_message || docStore.currentResult.ocr_result?.error_message" class="error-box">
          {{ docStore.currentResult.processing.error_message || docStore.currentResult.ocr_result?.error_message }}
        </div>
      </div>

      <div class="section-card">
        <h3>主结果预览</h3>
        <div v-if="markdownLoading" class="loading-state small">加载 markdown 中...</div>
        <div v-else-if="markdownPreview" class="markdown-preview">{{ markdownPreview }}</div>
        <div v-else class="empty-state small">暂无预览结果，可能仍在处理中</div>
      </div>

      <div class="section-card">
        <h3>下载结果</h3>
        <div class="download-actions">
          <el-button v-if="docStore.currentResult.source_attachment" @click="downloadAttachment(docStore.currentResult.source_attachment.download_url)">下载原始文件</el-button>
          <el-button v-if="docStore.currentResult.ocr_result?.main_markdown_attachment" type="primary" @click="downloadAttachment(docStore.currentResult.ocr_result.main_markdown_attachment.download_url)">下载 Markdown</el-button>
          <el-button v-if="docStore.currentResult.ocr_result?.raw_result_attachment" @click="downloadAttachment(docStore.currentResult.ocr_result.raw_result_attachment.download_url)">下载原始结果</el-button>
        </div>
      </div>

      <div class="section-card">
        <h3>图片附件列表</h3>
        <div v-if="docStore.currentResult.image_attachments.length === 0" class="empty-state small">暂无图片附件</div>
        <div v-else class="image-list">
          <div v-for="item in docStore.currentResult.image_attachments" :key="item.id" class="image-item">
            <div class="image-name">{{ item.attachment?.file_name || item.filename || '未命名图片' }}</div>
            <div class="image-meta">{{ item.attachment?.mime_type || item.media_type || '-' }} · {{ formatFileSize(item.attachment?.file_size) }}</div>
            <el-button size="small" @click="downloadAttachment(item.attachment?.download_url)">下载</el-button>
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

function docTypeTag(type: string) {
  const m: Record<string, string> = { knowledge: '', contract: 'warning', department_doc: 'info', standard: 'success' }
  return m[type] || ''
}

function docTypeLabel(type: string) {
  const m: Record<string, string> = { knowledge: 'KB', contract: 'Contract', department_doc: 'Dept', standard: 'Std' }
  return m[type] || type
}

function fmt(t: string) {
  return t ? new Date(t).toLocaleString() : ''
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

function goBack() {
  router.back()
}

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
    router.push('/docs')
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(docStore.error || '删除文档失败')
  }
}

const revisionLabel = computed(() => {
  const revision = docStore.currentResult?.revision
  if (!revision) return '-'
  return revision.revision_label || `r${revision.revision_no}`
})

const processingLabel = computed(() => {
  const status = docStore.currentResult?.processing.status
  if (status === 'pending_ocr') return '待 OCR'
  if (status === 'ocr_processing') return 'OCR 处理中'
  if (status === 'pending_clean') return '待文本清洗'
  if (status === 'ready') return '已完成'
  if (status === 'error') return '处理失败'
  return status || '-'
})

const progressLabel = computed(() => {
  const progress = docStore.currentResult?.ocr_result?.progress
  return typeof progress === 'number' ? `${progress}%` : '-'
})

async function loadMarkdownPreview() {
  const url = docStore.currentResult?.ocr_result?.main_markdown_attachment?.download_url
  if (!url) {
    markdownPreview.value = ''
    return
  }

  markdownLoading.value = true
  try {
    const response = await apiClient.get(url.replace(/^\/api/, '' as string))
    const dataUrl = response.data?.data?.data_url as string | undefined
    if (!dataUrl || !dataUrl.startsWith('data:')) {
      markdownPreview.value = ''
      return
    }
    const base64 = dataUrl.split(',')[1] || ''
    markdownPreview.value = atob(base64)
  } catch {
    markdownPreview.value = ''
  } finally {
    markdownLoading.value = false
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

    const completed = docStore.currentResult?.document.has_preview_result
    const failed = docStore.currentResult?.processing.status === 'error'
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
.doc-detail-view { padding: 20px; max-width: 1000px; margin: 0 auto; }
.back-row { margin-bottom: 16px; }
.doc-header { margin-bottom: 24px; }
.doc-header-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.doc-header h1 { margin: 0 0 8px; font-size: 22px; }
.doc-meta { display: flex; gap: 16px; align-items: center; color: #999; font-size: 13px; }
.section-card { background: #fff; border: 1px solid #ebeef5; border-radius: 10px; padding: 20px; margin-bottom: 16px; }
.section-card h3 { margin: 0 0 16px; font-size: 16px; }
.section-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; }
.info-grid > div { display: flex; flex-direction: column; gap: 4px; }
.label { color: #909399; font-size: 12px; }
.task-id-value { font-family: Consolas, 'Courier New', monospace; word-break: break-all; }
.loading-state, .error-state, .empty-state { padding: 60px 0; text-align: center; color: #999; }
.small { padding: 16px 0; }
.error-box { margin-top: 12px; padding: 12px; border-radius: 8px; background: #fef0f0; color: #c45656; }
.markdown-preview { white-space: pre-wrap; line-height: 1.7; color: #303133; background: #fafafa; border-radius: 8px; padding: 16px; max-height: 480px; overflow-y: auto; }
.download-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.image-list { display: flex; flex-direction: column; gap: 12px; }
.image-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; border: 1px solid #f0f0f0; border-radius: 8px; padding: 12px 16px; }
.image-name { font-weight: 500; }
.image-meta { color: #909399; font-size: 12px; margin-top: 4px; }
</style>
