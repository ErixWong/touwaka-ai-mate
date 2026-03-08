<template>
  <div class="tree-node">
    <div
      class="node-content"
      :style="{ paddingLeft: level * 16 + 'px' }"
      :class="{ selected: selectedId === node.id, expanded: isExpanded }"
      @click.stop="emit('select', node)"
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

      <!-- Icon based on level -->
      <span class="node-icon">
        {{ getNodeIcon() }}
      </span>

      <!-- Title -->
      <span class="node-title">{{ node.title }}</span>

      <!-- Paragraph Count -->
      <span v-if="node.paragraph_count" class="paragraph-count">
        {{ node.paragraph_count }}
      </span>
    </div>

    <!-- Children -->
    <div v-if="hasChildren && isExpanded" class="node-children">
      <SectionTreeNode
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { KbSection } from '@/types'

const props = defineProps<{
  node: KbSection
  level: number
  selectedId?: string | number
  forceExpand?: boolean | null
}>()

const emit = defineEmits<{
  select: [section: KbSection]
  edit: [section: KbSection]
  delete: [section: KbSection]
  'add-child': [parent: KbSection]
}>()

// State
const isExpanded = ref(true)

// Watch for forceExpand prop changes
watch(() => props.forceExpand, (newVal) => {
  if (newVal !== null && newVal !== undefined) {
    isExpanded.value = newVal
  }
}, { immediate: true })

// Computed
const hasChildren = computed(() => {
  return props.node.children && props.node.children.length > 0
})

// Methods
const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
}

const getNodeIcon = () => {
  // 根据层级返回不同图标
  switch (props.node.level) {
    case 1: return '📕'// 章
    case 2: return '📖'// 节
    case 3: return '📄'// 小节
    default: return '📝' // 更深层级
  }
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

.paragraph-count {
  font-size: 11px;
  color: var(--text-tertiary, #999);
  background: var(--secondary-bg, #f0f0f0);
  padding: 2px 6px;
  border-radius: 10px;
}

.node-children {
  /* Children styling handled by recursion */
}
</style>
