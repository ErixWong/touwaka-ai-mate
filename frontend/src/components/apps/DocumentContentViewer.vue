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
          />
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
          <div v-else class="full-text">
            <div
              v-for="(section, index) in sections"
              :key="section.id || index"
              :id="`section-${section.id || index}`"
              class="text-section"
            >
              <h3 v-if="section.title" class="section-title">{{ section.title }}</h3>
              <div class="section-content">{{ section.content || '' }}</div>
            </div>
            <div v-if="!sections || sections.length === 0" class="plain-text">{{ contentText }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

interface Section {
  id?: string
  title?: string
  content?: string
  position?: number
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

const treeData = computed(() => {
  if (!props.sections || props.sections.length === 0) return []
  
  return props.sections.map((section, index) => ({
    id: section.id || `sec-${index}`,
    label: section.title || t('apps.documentContent.section', { index: index + 1 }),
    children: []
  }))
})

function toggleNav() {
  isNavCollapsed.value = !isNavCollapsed.value
}

function handleNodeClick(data: { id: string }) {
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
  height: 100%;
  display: flex;
}

.content-layout {
  display: flex;
  height: 100%;
  width: 100%;
}

.nav-panel {
  width: 200px;
  min-width: 200px;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  transition: width 0.3s;
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
  border-bottom: 1px solid #e4e7ed;
  font-weight: 500;
}

.nav-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.content-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid #e4e7ed;
}

.content-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.empty-content {
  color: #909399;
  text-align: center;
  padding: 40px;
}

.full-text {
  font-size: 14px;
  line-height: 1.6;
}

.text-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #303133;
}

.section-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.plain-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.highlight {
  background-color: #fef0f0;
  color: #f56c6c;
  padding: 0 2px;
  border-radius: 2px;
}
</style>