import { computed, type Ref } from 'vue'
import {
  isActionCompleteDocProcessingStatus,
  isFailedDocProcessingStatus,
} from '@/api/docs'
import type { DocResultImageAttachment, DocResultDetail } from '@/api/docs'

export interface RetryAction {
  type: string
  label: string
}

export interface UseDocumentWorkspaceOptions {
  // The document result object from the store
  currentResult: Ref<DocResultDetail | null>
  // The markdown preview content
  markdownPreview: Ref<string>
  // Processing error code
  processingErrorCode: Ref<string | null>
  // Processing error message
  processingErrorMessage: Ref<string>
  // i18n translate function
  t: (key: string, params?: Record<string, unknown>) => string
}

export function useDocumentWorkspace(options: UseDocumentWorkspaceOptions) {
  const { currentResult, markdownPreview, processingErrorCode, processingErrorMessage, t } = options

  // Markdown 引用图片路径
  // 注：后端不返回 preview_markdown_content（task-20260814 审计 P0-4.1 删除假字段），
  // 图片路径解析只基于已加载的 markdownPreview 内容
  const markdownReferencedImagePaths = computed(() => {
    const content = markdownPreview.value || ''
    const pathSet = new Set<string>()
    if (!content) return pathSet

    const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g
    let match: RegExpExecArray | null
    while ((match = imageRegex.exec(content)) !== null) {
      const rawPath = match[1]?.trim().replace(/^<|>$/g, '')
      if (!rawPath) continue
      const normalized = rawPath.replace(/^\.\//, '').trim()
      if (!normalized) continue
      pathSet.add(normalized)
      pathSet.add(`./${normalized}`)
    }

    return pathSet
  })

  // 显示的图片附件（过滤和排序）
  const displayedImageAttachments = computed(() => {
    const items = currentResult.value?.image_attachments || []
    const referencedPathSet = markdownReferencedImagePaths.value
    const referencedItems = items.filter((item) => {
      if (!item.referenced_in_markdown) return false
      const candidates = [item.markdown_path, item.filename]
        .filter(Boolean)
        .map(value => String(value).replace(/^\.\//, '').trim())

      if (referencedPathSet.size === 0) return true
      return candidates.some(candidate => referencedPathSet.has(candidate) || referencedPathSet.has(`./${candidate}`))
    })
    const sourceItems = referencedItems.length > 0 ? referencedItems : items
    const deduped = new Map<string, DocResultImageAttachment>()

    for (const item of sourceItems) {
      const normalizedMarkdownPath = item.markdown_path?.replace(/^\.\//, '').trim() || ''
      const normalizedFilename = item.filename?.replace(/^\.\//, '').trim() || ''
      const key = normalizedMarkdownPath || normalizedFilename || item.attachment_id || item.id

      if (!deduped.has(key)) {
        deduped.set(key, item)
      }
    }

    return Array.from(deduped.values()).sort((a, b) => {
      const sortA = typeof a.sort_order === 'number' ? a.sort_order : Number.MAX_SAFE_INTEGER
      const sortB = typeof b.sort_order === 'number' ? b.sort_order : Number.MAX_SAFE_INTEGER
      if (sortA !== sortB) return sortA - sortB
      return (a.line_number || 0) - (b.line_number || 0)
    })
  })

  // 重试操作
  const retryAction = computed(() => {
    const status = currentResult.value?.processing?.status
    const errorCode = processingErrorCode.value

    if (status === 'pending_outline') {
      return { type: 'outline', label: t('docs.workspace.detail.startOutline') }
    }

    if (status === 'pending_chunk') {
      return { type: 'chunk', label: t('docs.workspace.detail.startChunk') }
    }

    if (errorCode === 'outline_extraction_failed') {
      return { type: 'outline', label: t('docs.workspace.detail.retryOutline') }
    }

    if (errorCode === 'chunk_generation_failed') {
      return { type: 'processing', label: t('docs.workspace.detail.retryChunk') }
    }

    if (isFailedDocProcessingStatus(status)) {
      if (errorCode === 'clean_failed' || errorCode === 'clean_timeout' || errorCode === 'pending_clean_timeout') return { type: 'clean', label: t('docs.workspace.detail.retryClean') }
      if (errorCode === 'embedding_failed') return { type: 'embedding', label: t('docs.workspace.detail.retryEmbedding') }
      if (errorCode === 'ocr_failed') return { type: 'ocr', label: t('docs.workspace.detail.retryOcr') }
    }

    return null
  })

  // 处理是否已完成
  const isProcessingActionComplete = computed(() => {
    const status = currentResult.value?.processing?.status
    return isActionCompleteDocProcessingStatus(status)
  })

  // 显示错误信息
  const displayErrorMessage = computed(() => {
    const status = currentResult.value?.processing?.status
    if (isFailedDocProcessingStatus(status) && processingErrorMessage.value) {
      return processingErrorMessage.value
    }
    return currentResult.value?.ocr_result?.error_message || ''
  })

  // 版本标签
  const revisionLabel = computed(() => {
    const r = currentResult.value?.revision
    if (!r) return '-'
    return r.revision_label || `r${r.revision_no}`
  })

  // Markdown 附件
  const markdownAttachment = computed(() => {
    return currentResult.value?.ocr_result?.preview_markdown_attachment || null
  })

  const rawMarkdownAttachment = computed(() => {
    return currentResult.value?.ocr_result?.raw_markdown_attachment || null
  })

  return {
    markdownReferencedImagePaths,
    displayedImageAttachments,
    retryAction,
    isProcessingActionComplete,
    displayErrorMessage,
    revisionLabel,
    markdownAttachment,
    rawMarkdownAttachment,
  }
}
