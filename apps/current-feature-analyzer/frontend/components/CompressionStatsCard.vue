<template>
  <el-card v-if="visible" shadow="never">
    <template #header><span class="card-title">分析统计</span></template>
    <div class="cfa-stats-grid">
      <div class="cfa-stat-card" style="background:#eef6ff">
        <div class="cfa-stat-value">{{ rawPointCount }}</div>
        <div class="cfa-stat-label">原始点数</div>
      </div>
      <div class="cfa-stat-card" style="background:#eef6ff">
        <div class="cfa-stat-value">{{ baselineMean }}</div>
        <div class="cfa-stat-label">待机基准</div>
      </div>
      <div class="cfa-stat-card" style="background:#eef6ff">
        <div class="cfa-stat-value">{{ maxCurrent }}</div>
        <div class="cfa-stat-label">最大电流</div>
      </div>
      <div class="cfa-stat-card" style="background:#f3e8ff">
        <div class="cfa-stat-value">{{ segmentCount }}</div>
        <div class="cfa-stat-label">压缩段数</div>
      </div>
      <div class="cfa-stat-card" style="background:#f3e8ff">
        <div class="cfa-stat-value">{{ plateauCount }}</div>
        <div class="cfa-stat-label">平台段数量</div>
      </div>
      <div class="cfa-stat-card" style="background:#f3e8ff">
        <div class="cfa-stat-value">{{ trendCount }}</div>
        <div class="cfa-stat-label">趋势段数量</div>
      </div>
      <div class="cfa-stat-card" style="background:#eafaf1">
        <div class="cfa-stat-value">{{ compressionRatio }}</div>
        <div class="cfa-stat-label">压缩比</div>
      </div>
      <div class="cfa-stat-card" style="background:#eafaf1">
        <div class="cfa-stat-value">{{ simplifiedCount }}</div>
        <div class="cfa-stat-label">简化折点数</div>
      </div>
      <div class="cfa-stat-card" style="background:#eafaf1">
        <div class="cfa-stat-value">{{ vectorizationRatio }}</div>
        <div class="cfa-stat-label">向量化比</div>
      </div>
      <div class="cfa-stat-card" style="background:#fef3c7">
        <div class="cfa-stat-value">{{ eventCount }}</div>
        <div class="cfa-stat-label">尖峰/事件数</div>
      </div>
      <div class="cfa-stat-card" style="background:#ffe4e6">
        <div class="cfa-stat-value">{{ duplicateGroups }}</div>
        <div class="cfa-stat-label">冲突Y值组数</div>
      </div>
      <div class="cfa-stat-card" style="background:#ffeef2">
        <div class="cfa-stat-value">{{ duplicateRatio }}</div>
        <div class="cfa-stat-label">冲突Y值占比</div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DuplicateDiagnosis, SegmentItem } from '../api/current-feature-analyzer'

const props = defineProps<{
  rawPointCount: number
  segments?: SegmentItem[]
  events?: Array<Record<string, unknown>>
  globals?: Record<string, number> | null
  duplicateDiagnosis?: DuplicateDiagnosis | null
}>()

const visible = computed(() => props.rawPointCount > 0 || (props.segments?.length ?? 0) > 0)
const segmentCount = computed(() => props.segments?.length ?? 0)
const compressionRatio = computed(() => {
  if (!segmentCount.value) return '-'
  return (props.rawPointCount / segmentCount.value).toFixed(1)
})
const simplifiedCount = computed(() => {
  if (!props.segments) return 0
  return props.segments.reduce((sum, seg) => sum + (seg.polyline_point_count || 0), 0)
})
const vectorizationRatio = computed(() => {
  if (!simplifiedCount.value) return '-'
  return (props.rawPointCount / simplifiedCount.value).toFixed(1)
})
const baselineMean = computed(() => {
  const v = props.globals?.baseline_mean
  return v != null ? `${Number(v).toFixed(3)} A` : '-'
})
const maxCurrent = computed(() => {
  const v = props.globals?.max_current
  return v != null ? `${Number(v).toFixed(2)} A` : '-'
})
const plateauKindSet = new Set(['stable', 'normal', 'off', 'plateau-low', 'plateau-mid', 'plateau-high'])
const trendKindSet = new Set(['transition', 'rising', 'rising-fast', 'falling', 'falling-fast', 'spike', 'surge', 'drop', 'burst'])

const plateauCount = computed(() => {
  if (!props.segments) return 0
  return props.segments.filter(s => plateauKindSet.has(s.kind)).length
})
const trendCount = computed(() => {
  if (!props.segments) return 0
  return props.segments.filter(s => trendKindSet.has(s.kind)).length
})
const eventCount = computed(() => props.events?.length ?? 0)
const duplicateGroups = computed(() => props.duplicateDiagnosis?.duplicate_groups ?? '-')
const duplicateRatio = computed(() => {
  if (!props.rawPointCount || !props.duplicateDiagnosis?.duplicate_groups) return '-'
  return `${((props.duplicateDiagnosis.duplicate_groups / props.rawPointCount) * 100).toFixed(2)}%`
})
</script>

<style scoped>
.cfa-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}
.cfa-stat-card {
  padding: 14px 10px;
  border-radius: 8px;
  text-align: center;
}
.cfa-stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.cfa-stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
</style>
