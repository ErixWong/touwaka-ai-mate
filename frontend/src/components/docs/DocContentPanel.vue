<template>
  <div class="doc-content-panel">
    <!-- 正文预览区域 -->
    <div class="section-card">
      <h3>{{ $t('docs.workspace.panel.contentPreview') }}</h3>
      <div v-if="loading" class="loading-state small">{{ $t('docs.workspace.panel.loading') }}</div>
      <div v-else-if="content" class="markdown-preview markdown-body" v-html="renderedContent"></div>
      <div v-else class="empty-state small">
        {{ $t('docs.workspace.panel.noPreview') }}
        <el-tag v-if="isPolling" type="warning" size="small" class="polling-tag">{{ $t('docs.workspace.panel.polling') }}</el-tag>
      </div>
    </div>

    <!-- 分块列表区域 -->
    <div v-if="chunks.length > 0" class="section-card">
      <h3>{{ $t('docs.workspace.panel.chunkList') }} ({{ chunks.length }})</h3>
      <div class="chunk-list">
        <div v-for="(chunk, idx) in chunks" :key="chunk.id" class="chunk-item">
          <div class="chunk-header">
            <span class="chunk-seq">#{{ idx + 1 }}</span>
            <span v-if="chunk.title" class="chunk-title">{{ chunk.title }}</span>
            <span class="chunk-meta">
              {{ $t('docs.workspace.panel.lines') }} {{ chunk.from_line ?? '-' }}-{{ chunk.to_line ?? '-' }}
              · {{ chunk.token_count ?? '-' }} {{ $t('docs.workspace.panel.tokens') }}
            </span>
          </div>
          <div class="chunk-content">{{ chunk.content }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useMarkdownFormatter } from '@/composables/useMarkdownFormatter'
import type { DocChunk } from '@/api/docs'

interface Props {
  content?: string
  chunks?: DocChunk[]
  loading?: boolean
  isPolling?: boolean
  imageAttachments?: Array<{
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
  }> | null
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  chunks: () => [],
  loading: false,
  isPolling: false,
  imageAttachments: null,
})

const markdownFormatter = useMarkdownFormatter()

// 构建图片URL映射
const imageUrlMap = computed(() => {
  const map = new Map<string, string>()
  const imageItems = props.imageAttachments || []
  
  for (const item of imageItems) {
    const resolvedUrl = item.attachment?.preview_url || item.attachment?.download_url || ''
    if (!resolvedUrl) continue

    const candidates = [
      item.markdown_path,
      item.filename,
    ].filter(Boolean) as string[]

    for (const candidate of candidates) {
      const normalized = candidate.replace(/^\.\//, '').trim()
      if (!normalized) continue
      map.set(normalized, resolvedUrl)
      map.set(`./${normalized}`, resolvedUrl)
      const fileNameOnly = normalized.split('/').pop()?.trim()
      if (fileNameOnly) {
        map.set(fileNameOnly, resolvedUrl)
        map.set(`./${fileNameOnly}`, resolvedUrl)
        map.set(`images/${fileNameOnly}`, resolvedUrl)
        map.set(`./images/${fileNameOnly}`, resolvedUrl)
      }
    }
  }
  
  return map
})

// 解析Markdown内容中的图片路径
const renderedContent = computed(() => {
  if (!props.content) return ''
  
  const resolvedMarkdown = props.content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt: string, rawPath: string) => {
    const cleanPath = rawPath.trim().replace(/^<|>$/g, '')
    if (/^(?:https?:|data:|blob:|\/attach\/|\/api\/attachments\/)/i.test(cleanPath)) {
      return match
    }
    const normalizedPath = cleanPath.replace(/^\.\//, '')
    const resolvedUrl = imageUrlMap.value.get(cleanPath) || imageUrlMap.value.get(normalizedPath)
    if (!resolvedUrl) return match
    return `![${alt}](${resolvedUrl})`
  })

  return markdownFormatter.formatMessage(resolvedMarkdown)
})
</script>

<style scoped>
.doc-content-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-card { background: #fff; border: 1px solid #ebeef5; border-radius: 10px; padding: 20px; }
.section-card h3 { margin: 0 0 16px; font-size: 16px; }

.markdown-preview { line-height: 1.8; color: #303133; background: #fafafa; border-radius: 8px; padding: 20px; min-height: 200px; max-height: 70vh; overflow-y: auto; font-size: 14px; }

.markdown-body :deep(h1) { font-size: 24px; font-weight: 700; margin: 16px 0 8px; }
.markdown-body :deep(h2) { font-size: 20px; font-weight: 600; margin: 14px 0 6px; }
.markdown-body :deep(h3) { font-size: 16px; font-weight: 600; margin: 12px 0 4px; }
.markdown-body :deep(h4) { font-size: 14px; font-weight: 600; margin: 10px 0 4px; }
.markdown-body :deep(p) { margin: 8px 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 8px 0; padding-left: 24px; }
.markdown-body :deep(li) { margin: 4px 0; }
.markdown-body :deep(blockquote) { border-left: 4px solid var(--el-border-color); padding-left: 12px; margin: 12px 0; color: var(--el-text-color-secondary); }
.markdown-body :deep(pre) { background: var(--el-fill-color-lighter); padding: 12px; border-radius: var(--el-border-radius-base); overflow-x: auto; }
.markdown-body :deep(code) { background: var(--el-fill-color-lighter); padding: 2px 6px; border-radius: var(--el-border-radius-base); font-family: monospace; }
.markdown-body :deep(pre code) { background: none; padding: 0; }
.markdown-body :deep(img) { display: block; max-width: 100%; height: auto; margin: 12px auto; border-radius: 6px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08); }
.markdown-body :deep(table) { display: block; border-collapse: collapse; min-width: 100%; width: auto; margin: 12px 0; background: #fff; overflow-x: auto; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid var(--el-border-color-lighter); padding: 8px 10px; vertical-align: top; }
.markdown-body :deep(th) { background: var(--el-fill-color-lighter); font-weight: 600; }
.markdown-body :deep(a) { color: var(--el-color-primary); text-decoration: none; }
.markdown-body :deep(a:hover) { text-decoration: underline; }

.chunk-list { display: flex; flex-direction: column; gap: 12px; }
.chunk-item { border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden; }
.chunk-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f5f7fa; border-bottom: 1px solid #f0f0f0; }
.chunk-seq { font-size: 13px; font-weight: 600; color: #409eff; }
.chunk-title { font-size: 13px; font-weight: 500; color: #303133; }
.chunk-meta { font-size: 11px; color: #909399; margin-left: auto; }
.chunk-content { padding: 14px; font-size: 13px; color: #606266; white-space: pre-wrap; line-height: 1.7; max-height: 300px; overflow-y: auto; }

.loading-state, .empty-state { padding: 40px 0; text-align: center; color: #999; }
.small { padding: 16px 0; }
.tiny { padding: 8px 0; font-size: 12px; }
.polling-tag { margin-left: 8px; }
</style>