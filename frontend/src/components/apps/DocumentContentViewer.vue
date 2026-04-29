<template>
  <div class="document-content-viewer">
    <div class="content-layout">
      <div class="nav-panel" :class="{ collapsed: isNavCollapsed }">
        <div class="nav-header">
          <span v-if="!isNavCollapsed">{{ $t('apps.documentContent.sections') }}</span>
          <el-button size="small" @click="toggleNav">
            {{ isNavCollapsed ? '▶' : '◀' }}
          </el-button>
        </div>
        <div v-if="!isNavCollapsed" class="nav-tree">
          <el-tree
            ref="treeRef"
            :data="treeData"
            :props="{ label: 'label', children: 'children' }"
            :highlight-current="true"
            :expand-on-click-node="false"
            @node-click="handleNodeClick"
          >
            <template #default="{ data }">
              <span class="nav-node">
                <span v-if="data.startLine !== undefined" class="nav-line">L{{ data.startLine }}</span>
                <span class="nav-label">{{ data.label }}</span>
              </span>
            </template>
          </el-tree>
        </div>
      </div>
      <div class="content-panel">
        <div class="content-toolbar">
          <el-button size="small" @click="scrollToTop">{{ $t('apps.documentContent.scrollToTop') }}</el-button>
        </div>
        <div ref="contentRef" class="content-body">
          <div v-if="!contentText" class="empty-content">
            {{ $t('apps.documentContent.noContent') }}
          </div>
          <div v-else class="full-text markdown-body" v-html="renderedContent"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface Section {
  id?: string
  title?: string
  content?: string
  position?: number
  level?: number
  start_line?: number
  end_line?: number
  type?: string
  children?: Section[]
}

interface Props {
  kbId?: string
  contentText?: string
  sections?: Section[]
  highlights?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  kbId: '',
  contentText: '',
  sections: () => [],
  highlights: () => []
})

const { t } = useI18n()
const isNavCollapsed = ref(false)
const contentRef = ref<HTMLElement | null>(null)
const treeRef = ref()

marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      const slug = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
      return `<h${depth} id="heading-${slug}">${text}</h${depth}>\n`
    }
  }
})

const lines = computed(() => {
  if (!props.contentText) return []
  return props.contentText.split('\n')
})

const sectionsWithContent = computed(() => {
  if (!props.sections || props.sections.length === 0) return []
  
  return props.sections.map(section => {
    let content = ''
    if (section.start_line !== undefined && section.end_line !== undefined && lines.value.length > 0) {
      content = lines.value.slice(section.start_line, section.end_line + 1).join('\n')
    } else if (section.content) {
      content = section.content
    }
    console.debug(`[DocumentContentViewer] section="${section.title}", lines=${section.start_line}-${section.end_line}, totalLines=${lines.value.length}, contentLen=${content.length}`)
    return {
      ...section,
      content
    }
  })
})

const renderedContent = computed(() => {
  if (!props.contentText) return ''
  const rawHtml = marked.parse(props.contentText) as string
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr', 'div', 'span',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'id',
    ],
  })
})

const renderedSections = computed(() => {
  return sectionsWithContent.value.map(section => ({
    ...section,
    renderedContent: section.content ? marked.parse(section.content) as string : ''
  }))
})

const treeData = computed(() => {
  if (!props.sections || props.sections.length === 0) return []
  
  return props.sections.map((section, index) => ({
    id: section.id || `sec-${index}`,
    label: section.title || t('apps.documentContent.section', { index: index + 1 }),
    startLine: section.start_line,
    children: section.children?.map((child, childIndex) => ({
      id: child.id || `sec-${index}-${childIndex}`,
      label: child.title || t('apps.documentContent.section', { index: index + 1 }),
      startLine: child.start_line
    })) || []
  }))
})

function toggleNav() {
  isNavCollapsed.value = !isNavCollapsed.value
}

function handleNodeClick(data: { id: string; startLine?: number; label?: string }) {
  if (data.label) {
    const slug = data.label.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
    const element = document.getElementById(`heading-${slug}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
  }
  if (data.startLine !== undefined) {
    const element = document.getElementById(`line-${data.startLine}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
  }
  const element = document.getElementById(`section-${data.id}`)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function scrollToTop() {
  if (contentRef.value) {
    contentRef.value.scrollTop = 0
  }
}

onMounted(() => {
  if (props.highlights && props.highlights.length > 0 && contentRef.value) {
    highlightKeywords()
  }
})

function highlightKeywords() {
  if (!contentRef.value || !props.highlights) return
  
  const walk = document.createTreeWalker(
    contentRef.value,
    NodeFilter.SHOW_TEXT,
    null
  )
  
  const textNodes: Text[] = []
  while (walk.nextNode()) {
    textNodes.push(walk.currentNode as Text)
  }
  
  for (const keyword of props.highlights) {
    for (const node of textNodes) {
      const text = node.textContent || ''
      if (text.includes(keyword)) {
        const span = document.createElement('span')
        span.className = 'highlight'
        const index = text.indexOf(keyword)
        const before = text.slice(0, index)
        const match = text.slice(index, index + keyword.length)
        const after = text.slice(index + keyword.length)
        
        const parent = node.parentNode
        if (parent) {
          const newSpan = document.createElement('span')
          newSpan.className = 'highlight'
          newSpan.textContent = match
          
          parent.insertBefore(document.createTextNode(before), node)
          parent.insertBefore(newSpan, node)
          node.textContent = after
        }
      }
    }
  }
}
</script>

<style scoped>
.document-content-viewer {
  height: 60vh;
  display: flex;
  flex-direction: column;
}

.content-layout {
  display: flex;
  height: 100%;
  width: 100%;
}

.nav-panel {
  width: 200px;
  min-width: 200px;
  border-right: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex-direction: column;
  transition: width 0.3s;
  flex-shrink: 0;
}

.nav-panel.collapsed {
  width: 40px;
  min-width: 40px;
}

.nav-header {
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-weight: 500;
  flex-shrink: 0;
}

.nav-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.nav-tree :deep(.el-tree-node__content) {
  justify-content: flex-start;
}

.nav-node {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
}

.nav-line {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
  font-family: monospace;
}

.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.content-toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.content-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.empty-content {
  color: var(--el-text-color-placeholder);
  text-align: center;
  padding: 40px;
}

.full-text {
  font-size: var(--el-font-size-base);
  line-height: 1.6;
}

.text-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--el-text-color-primary);
}

.section-title.level-1 {
  font-size: 18px;
  font-weight: 700;
}

.section-title.level-2 {
  font-size: 16px;
  font-weight: 600;
  margin-left: 16px;
}

.section-title.level-3 {
  font-size: 14px;
  font-weight: 500;
  margin-left: 32px;
}

.section-title.type-title {
  color: var(--el-color-primary);
}

.section-title.type-party {
  color: var(--el-color-success);
}

.section-title.type-toc {
  color: var(--el-text-color-placeholder);
}

.section-title.type-clause {
  color: var(--el-text-color-primary);
}

.section-title.type-attachment {
  color: var(--el-color-warning);
}

.section-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.plain-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.markdown-body {
  line-height: 1.6;
}

.markdown-body h1 {
  font-size: 24px;
  font-weight: 700;
  margin: 16px 0 8px 0;
}

.markdown-body h2 {
  font-size: 20px;
  font-weight: 600;
  margin: 14px 0 6px 0;
}

.markdown-body h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 12px 0 4px 0;
}

.markdown-body h4 {
  font-size: 14px;
  font-weight: 600;
  margin: 10px 0 4px 0;
}

.markdown-body p {
  margin: 8px 0;
}

.markdown-body ul, .markdown-body ol {
  margin: 8px 0;
  padding-left: 24px;
}

.markdown-body li {
  margin: 4px 0;
}

.markdown-body code {
  background: var(--el-fill-color-lighter);
  padding: 2px 6px;
  border-radius: var(--el-border-radius-base);
  font-family: monospace;
}

.markdown-body pre {
  background: var(--el-fill-color-lighter);
  padding: 12px;
  border-radius: var(--el-border-radius-base);
  overflow-x: auto;
}

.markdown-body pre code {
  background: none;
  padding: 0;
}

.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.markdown-body th, .markdown-body td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 8px;
}

.markdown-body th {
  background: var(--el-fill-color-lighter);
  font-weight: 600;
}

.markdown-body blockquote {
  border-left: 4px solid var(--el-border-color);
  padding-left: 12px;
  margin: 12px 0;
  color: var(--el-text-color-secondary);
}

.highlight {
  background-color: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  padding: 0 2px;
  border-radius: 2px;
}
</style>