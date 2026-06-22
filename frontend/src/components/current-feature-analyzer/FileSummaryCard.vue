<template>
  <el-card shadow="never">
    <template #header><span class="card-title">文件信息</span></template>
    <el-descriptions :column="3" size="small" border>
      <el-descriptions-item label="文件名">{{ file.file_name }}</el-descriptions-item>
      <el-descriptions-item label="记录数">{{ file.row_count ?? '-' }}</el-descriptions-item>
      <el-descriptions-item label="文件大小">{{ formatSize(file.file_size) }}</el-descriptions-item>
      <el-descriptions-item label="时间列">{{ file.time_column || '-' }}</el-descriptions-item>
      <el-descriptions-item label="电流列">{{ file.current_column || '-' }}</el-descriptions-item>
      <el-descriptions-item label="状态">
        <el-tag :type="statusType" size="small">{{ statusLabel }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item v-if="file.result?.globals" label="全局基线均值" :span="3">
        {{ file.result.globals.baseline_mean?.toFixed(4) }} A
      </el-descriptions-item>
    </el-descriptions>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionFileItem } from '@/api/current-feature-analyzer'

const props = defineProps<{ file: SessionFileItem }>()

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    pending: '待处理', parsing: '解析中', ready: '就绪',
    analyzing: '分析中', completed: '已完成', failed: '失败',
  }
  return map[props.file.analysis_status] || props.file.analysis_status
})
const statusType = computed(() => props.file.analysis_status === 'completed' ? 'success' : props.file.analysis_status === 'failed' ? 'danger' : 'warning')
function formatSize(bytes: number) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>
