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
      <el-tooltip v-if="file._duplicate_diagnosis" :content="duplicateDiagnosisText" placement="top">
        <el-icon class="cfa-file-warn-icon"><WarningFilled /></el-icon>
      </el-tooltip>
      <el-tooltip v-if="file.error_message && file.analysis_status === 'failed'" :content="file.error_message" placement="top">
        <el-icon class="cfa-file-err-icon"><WarningFilled /></el-icon>
      </el-tooltip>
    </div>
    <div v-if="file.result?.stage_metrics?.length" class="cfa-file-item-summary">
      <span class="summary-tag">阶段: {{ file.result.stage_metrics.length }}</span>
      <span v-if="file.warning_count > 0" class="summary-tag warning">告警: {{ file.warning_count }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'
import type { SessionFileItem } from '../api/current-feature-analyzer'

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

const duplicateDiagnosisText = computed(() => {
  const diagnosis = props.file._duplicate_diagnosis
  if (!diagnosis) return ''
  return `重复时间组数: ${diagnosis.duplicate_groups}，重复行数: ${diagnosis.duplicate_rows}，冲突组数: ${diagnosis.conflict_groups}，最大同时间行数: ${diagnosis.max_same_time_rows}，冲突比例: ${(diagnosis.conflict_ratio * 100).toFixed(2)}%`
})
</script>

<style scoped>
.cfa-file-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--el-border-color-lighter);
  transition: all 0.15s;
  margin: 4px 8px;
  border-radius: 6px;
  border-left: 3px solid transparent;
}
.cfa-file-item:hover { background: var(--el-fill-color-light); }
.cfa-file-item.selected {
  background: var(--el-color-primary-light-9);
  border-left-color: var(--el-color-primary);
}
.cfa-file-item.selected .cfa-file-item-name {
  font-weight: 600;
  color: var(--el-color-primary);
}
.cfa-file-item.error { border-left-color: var(--el-color-danger); }
.cfa-file-item.warning { border-left-color: var(--el-color-warning); }
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
.cfa-file-item-summary {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.summary-tag {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  padding: 2px 6px;
  border-radius: 3px;
}
.summary-tag.warning {
  color: var(--el-color-warning);
}
.cfa-file-warn {
  color: var(--el-color-warning);
  font-size: 11px;
}
.cfa-file-warn-icon {
  color: var(--el-color-warning);
  font-size: 14px;
  cursor: help;
}
.cfa-file-err-icon {
  color: var(--el-color-danger);
  font-size: 14px;
  cursor: help;
}
</style>
