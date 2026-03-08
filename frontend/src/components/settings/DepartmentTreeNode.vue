<template>
  <div class="tree-node" :style="{ paddingLeft: (level * 16) + 'px' }">
    <div 
      class="node-content"
      :class="{ selected: selectedId === department.id }"
      @click="$emit('select', department)"
    >
      <!-- 展开/折叠按钮 -->
      <span 
        class="expand-btn"
        :class="{ expanded: isExpanded, hidden: !hasChildren }"
        @click.stop="toggleExpand"
      >
        ▶
      </span>
      
      <!-- 部门名称 -->
      <span class="node-name">{{ department.name }}</span>
      
      <!-- 操作按钮 -->
      <div class="node-actions">
        <button 
          class="btn-small btn-add"
          v-if="level < 4"
          @click.stop="$emit('add-child', undefined, department.id)"
          :title="$t('settings.addChildDepartment')"
        >
          +
        </button>
        <button 
          class="btn-small btn-edit"
          @click.stop="$emit('edit', department)"
          :title="$t('common.edit')"
        >
          ✎
        </button>
        <button 
          class="btn-small btn-delete"
          @click.stop="$emit('delete', department)"
          :title="$t('common.delete')"
        >
          ×
        </button>
      </div>
    </div>
    
    <!-- 子节点 -->
    <div v-if="isExpanded && hasChildren" class="children">
      <DepartmentTreeNode
        v-for="child in department.children"
        :key="child.id"
        :department="child"
        :level="level + 1"
        :selected-id="selectedId"
        @select="$emit('select', $event)"
        @edit="$emit('edit', $event)"
        @delete="$emit('delete', $event)"
        @add-child="(dept, parentId) => $emit('add-child', dept, parentId)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Department } from '@/types'

const props = defineProps<{
  department: Department
  level?: number
  selectedId?: string
}>()

defineEmits<{
  select: [department: Department]
  edit: [department: Department]
  delete: [department: Department]
  'add-child': [department: undefined, parentId: string]
}>()

const { t } = useI18n()

const level = props.level || 1
const isExpanded = ref(true)

const hasChildren = computed(() => {
  return props.department.children && props.department.children.length > 0
})

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
}
</script>

<style scoped>
.tree-node {
  user-select: none;
}

.node-content {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.node-content:hover {
  background: var(--bg-secondary);
}

.node-content.selected {
  background: var(--primary-color-light);
}

.expand-btn {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--text-secondary);
  transition: transform 0.2s;
}

.expand-btn.expanded {
  transform: rotate(90deg);
}

.expand-btn.hidden {
  visibility: hidden;
}

.node-name {
  flex: 1;
  font-size: 14px;
}

.node-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.node-content:hover .node-actions {
  opacity: 1;
}

.btn-small {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-add {
  background: var(--success-color);
  color: white;
}

.btn-add:hover {
  background: var(--success-color-dark);
}

.btn-edit {
  background: var(--primary-color);
  color: white;
}

.btn-edit:hover {
  background: var(--primary-color-dark);
}

.btn-delete {
  background: var(--danger-color);
  color: white;
}

.btn-delete:hover {
  background: var(--danger-color-dark);
}

.children {
  margin-left: 0;
}
</style>
