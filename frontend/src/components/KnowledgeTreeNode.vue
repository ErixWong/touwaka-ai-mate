<template>
  <div class="tree-node">
    <div
      class="node-content"
      :style="{ paddingLeft: level * 16 + 'px' }"
      :class="{ selected: selectedId === node.id, expanded: isExpanded }"
      @click.stop="emit('select', node)"
      @contextmenu.prevent="showContextMenu"
    >
      <!-- Expand/Collapse Button -->
      <span
        v-if="hasChildren"
        class="node-toggle"
        @click.stop="toggleExpand"
      >
        {{ isExpanded ? '▼' : '▶' }}
      </span>
      <span v-else class="node-toggle placeholder"></span>

      <!-- Icon -->
      <span class="node-icon">
        {{ hasChildren ? '📁' : '📄' }}
      </span>

      <!-- Title -->
      <span class="node-title">{{ node.title }}</span>

      <!-- Status Badge: 只在未完全向量化时显示 -->
      <span v-if="node.status !== 'ready'" class="status-badge" :class="node.status">
        {{ node.status === 'pending' ? '待处理' : node.status === 'processing' ? '处理中' : '失败' }}
      </span>

      <!-- Point Count -->
      <span v-if="node.point_count" class="point-count">
        {{ node.point_count }}
      </span>
    </div>

    <!-- Children -->
    <div v-if="hasChildren && isExpanded" class="node-children">
      <KnowledgeTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-id="selectedId"
        :force-expand="forceExpand"
        @select="emit('select', $event)"
        @edit="emit('edit', $event)"
        @delete="emit('delete', $event)"
        @add-child="emit('add-child', $event)"
      />
    </div>

    <!-- Context Menu -->
    <div
      v-if="contextMenuVisible"
      class="context-menu"
      :style="{ left: contextMenuX + 'px', top: contextMenuY + 'px' }"
    >
      <div class="context-item" @click="handleEdit">
        ✏️ {{ $t('common.edit') }}
      </div>
      <div class="context-item" @click="handleAddChild">
        ➕ {{ $t('knowledgeBase.article.create') }}
      </div>
      <div class="context-item danger" @click="handleDelete">
        🗑️ {{ $t('common.delete') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Knowledge } from '@/types'

const props = defineProps<{
  node: Knowledge
  level: number
  selectedId?: string | number
  forceExpand?: boolean | null
}>()

const emit = defineEmits<{
  select: [knowledge: Knowledge]
  edit: [knowledge: Knowledge]
  delete: [knowledge: Knowledge]
  'add-child': [parent: Knowledge]
}>()

const { t } = useI18n()

// State
const isExpanded = ref(true)

// Watch for forceExpand prop changes
watch(() => props.forceExpand, (newVal) => {
  if (newVal !== null && newVal !== undefined) {
    isExpanded.value = newVal
  }
}, { immediate: true })
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)

// Computed
const hasChildren = computed(() => {
  return props.node.children && props.node.children.length > 0
})

// Methods
const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
}

const showContextMenu = (event: MouseEvent) => {
  contextMenuVisible.value = true
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY

  // Close on next click
  setTimeout(() => {
    document.addEventListener('click', closeContextMenu, { once: true })
  }, 0)
}

const closeContextMenu = () => {
  contextMenuVisible.value = false
}

const handleEdit = () => {
  closeContextMenu()
  emit('edit', props.node)
}

const handleAddChild = () => {
  closeContextMenu()
  emit('add-child', props.node)
}

const handleDelete = () => {
  closeContextMenu()
  emit('delete', props.node)
}
</script>

<style scoped>
.tree-node {
  user-select: none;
}

.node-content {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.node-content:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.node-content.selected {
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
}

.node-toggle {
  width: 16px;
  font-size: 10px;
  color: var(--text-tertiary, #999);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.node-toggle.placeholder {
  visibility: hidden;
}

.node-icon {
  font-size: 14px;
}

.node-title {
  flex: 1;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.status-badge.pending {
  background: #fff3e0;
  color: #ef6c00;
}

.status-badge.processing {
  background: #e3f2fd;
  color: #1976d2;
}

.status-badge.failed {
  background: #ffebee;
  color: #c62828;
}

.point-count {
  font-size: 11px;
  color: var(--text-tertiary, #999);
  background: var(--secondary-bg, #f0f0f0);
  padding: 2px 6px;
  border-radius: 10px;
}

.node-children {
  /* Children styling handled by recursion */
}

/* Context Menu */
.context-menu {
  position: fixed;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  z-index: 1001;
  min-width: 160px;
}

.context-item {
  padding: 10px 16px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.context-item:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.context-item.danger {
  color: #f44336;
}

.context-item.danger:hover {
  background: #ffebee;
}
</style>
