<template>
  <div
    class="cfa-file-item"
    :class="{ selected, error: file.analysis_status === 'failed', warning: file.warning_count > 0 }"
    @click="$emit('select')"
  >
    <div class="cfa-file-item-name" :title="file.file_name">
      {{ file.file_name }}
    </div>
    <div class="cfa-file-item-meta">
      <el-tag :type="statusTagType" size="small">{{ statusLabel }}</el-tag>
      <span v-if="file.warning_count > 0" class="cfa-file-warn">⚠{{ file.warning_count }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionFileItem } from '@/api/current-feature-analyzer'

const props = defineProps<{
  file: SessionFileItem
  selected: boolean
}>()

defineEmits<{
  select: []
}>()

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    pending: '待处理',
    parsing: '解析中',
    ready: '就绪',
    analyzing: '分析中',
    completed: '已完成',
    failed: '失败',
  }
  return map[props.file.analysis_status] || props.file.analysis_status
})

const statusTagType = computed(() => {
  const map: Record<string, string> = {
    pending: 'info',
    parsing: 'warning',
    ready: '',
    analyzing: 'warning',
    completed: 'success',
    failed: 'danger',
  }
  return map[props.file.analysis_status] || 'info'
})
</script>

<style scoped>
.cfa-file-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--el-border-color-lighter);
  transition: background 0.15s;
}
.cfa-file-item:hover { background: var(--el-fill-color-light); }
.cfa-file-item.selected { background: var(--el-color-primary-light-9); }
.cfa-file-item.error { border-left: 3px solid var(--el-color-danger); }
.cfa-file-item-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}
.cfa-file-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cfa-file-warn {
  color: var(--el-color-warning);
  font-size: 11px;
}
</style>
