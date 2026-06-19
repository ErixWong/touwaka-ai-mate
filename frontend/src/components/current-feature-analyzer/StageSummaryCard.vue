<template>
  <el-card v-if="metrics.length" shadow="never">
    <template #header><span class="card-title">阶段识别结果</span></template>
    <div class="stage-summary-grid">
      <div class="stage-stat">
        <span class="stage-stat-value">{{ metrics.length }}</span>
        <span class="stage-stat-label">识别阶段数</span>
      </div>
      <div class="stage-stat">
        <span class="stage-stat-value">{{ avgDuration }}s</span>
        <span class="stage-stat-label">平均时长</span>
      </div>
      <div class="stage-stat">
        <span class="stage-stat-value">{{ avgCurrent }}A</span>
        <span class="stage-stat-label">平均电流</span>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ metrics: any[] }>()

const avgDuration = computed(() => {
  if (!props.metrics.length) return '-'
  const sum = props.metrics.reduce((s, m) => s + (m.duration || 0), 0)
  return (sum / props.metrics.length).toFixed(3)
})
const avgCurrent = computed(() => {
  if (!props.metrics.length) return '-'
  const sum = props.metrics.reduce((s, m) => s + (m.avg_current || 0), 0)
  return (sum / props.metrics.length).toFixed(3)
})
</script>

<style scoped>
.stage-summary-grid {
  display: flex;
  gap: 24px;
}
.stage-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stage-stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--el-color-primary);
}
.stage-stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
