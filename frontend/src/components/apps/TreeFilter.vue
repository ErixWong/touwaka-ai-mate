<template>
  <div class="tree-filter">
    <div v-for="field in filterFields" :key="field.name" class="filter-item">
      <div class="filter-label">{{ field.label || field.name }}</div>
      <el-tree
        ref="treeRefs[field.name]"
        :data="treeData[field.name]"
        :props="{ label: 'label', children: 'children' }"
        :show-checkbox="true"
        :check-on-click-node="true"
        @check="handleCheck(field.name, $event)"
      />
    </div>
    <div class="filter-actions">
      <el-button size="small" @click="resetFilters">{{ $t('apps.reset') }}</el-button>
      <el-button size="small" type="primary" @click="applyFilters">{{ $t('apps.filter') }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { getDistinctValues } from '@/api/mini-apps'

interface FilterField {
  name: string
  label?: string
}

interface TreeNode {
  id: string
  label: string
  value: string
}

interface TreeCheckEvent {
  checkedNodes: TreeNode[]
}

interface Props {
  appId: string
  filterFields: FilterField[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'filter-change', filters: Record<string, string[]>): void
}>()

const { t } = useI18n()
const treeData = ref<Record<string, TreeNode[]>>({})
const selectedFilters = ref<Record<string, string[]>>({})

onMounted(async () => {
  await loadDistinctValues()
})

async function loadDistinctValues() {
  const fieldNames = props.filterFields.map(f => f.name)
  
  try {
    const response = await getDistinctValues(props.appId, fieldNames)
    
    for (const [field, values] of Object.entries(response)) {
      treeData.value[field] = values.map(v => ({
        id: v.value,
        label: v.value || t('apps.treeFilter.emptyValue'),
        value: v.value
      }))
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : t('apps.treeFilter.loadFailed')
    ElMessage.error(errorMsg)
    for (const field of fieldNames) {
      treeData.value[field] = []
    }
  }
}

function handleCheck(field: string, event: TreeCheckEvent) {
  selectedFilters.value[field] = event.checkedNodes.map((n) => n.value)
}

function resetFilters() {
  selectedFilters.value = {}
  for (const field of props.filterFields) {
    selectedFilters.value[field.name] = []
  }
  emit('filter-change', {})
}

function applyFilters() {
  emit('filter-change', { ...selectedFilters.value })
}

watch(() => props.filterFields, loadDistinctValues)
</script>

<style scoped>
.tree-filter {
  padding: 12px;
}

.filter-item {
  margin-bottom: 16px;
}

.filter-label {
  font-weight: 500;
  margin-bottom: 8px;
  color: #303133;
}

.filter-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>