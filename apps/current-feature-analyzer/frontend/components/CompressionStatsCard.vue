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
        <div class="cfa-stat-label">{{ segmentCountLabel }}</div>
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
        <div class="cfa-stat-label">{{ simplifiedCountLabel }}</div>
      </div>
      <div class="cfa-stat-card" style="background:#eafaf1">
        <div class="cfa-stat-value">{{ vectorizationRatio }}</div>
        <div class="cfa-stat-label">向量化比</div>
      </div>
      <div class="cfa-stat-card" style="background:#eefaf3">
        <div class="cfa-stat-value">{{ absoluteResolution }}</div>
        <div class="cfa-stat-label">绝对电流分辨率</div>
      </div>
      <div class="cfa-stat-card" style="background:#eefaf3">
        <div class="cfa-stat-value">{{ relativeResolution }}</div>
        <div class="cfa-stat-label">相对电流分辨率</div>
      </div>
      <div class="cfa-stat-card" style="background:#eefaf3">
        <div class="cfa-stat-value">{{ mergeGapRatio }}</div>
        <div class="cfa-stat-label">合并间隙比例</div>
      </div>
      <div class="cfa-stat-card" style="background:#eefaf3">
        <div class="cfa-stat-value">{{ minTransitionPoints }}</div>
        <div class="cfa-stat-label">最小过渡点数</div>
      </div>
      <div class="cfa-stat-card" style="background:#eefaf3">
        <div class="cfa-stat-value">{{ targetSegmentCount }}</div>
        <div class="cfa-stat-label">{{ targetSegmentCountLabel }}</div>
      </div>
      <div v-if="keyPointCountVisible" class="cfa-stat-card" style="background:#eefaf3">
        <div class="cfa-stat-value">{{ selectedKeyPointCount }}</div>
        <div class="cfa-stat-label">关键点数量</div>
      </div>
      <div v-if="keyPointCountVisible" class="cfa-stat-card" style="background:#eefaf3">
        <div class="cfa-stat-value">{{ thresholdPercent }}</div>
        <div class="cfa-stat-label">变化阈值</div>
      </div>
      <div class="cfa-stat-card" style="background:#eefaf3">
        <div class="cfa-stat-value cfa-stat-value-text">{{ algorithmLabel }}</div>
        <div class="cfa-stat-label">压缩算法</div>
      </div>
      <div class="cfa-stat-card cfa-stat-card-wide" style="background:#eefaf3">
        <div class="cfa-stat-value cfa-stat-value-text">{{ selectionReason }}</div>
        <div class="cfa-stat-label">自动适配依据</div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CompressionMeta, SegmentItem } from '../api/current-feature-analyzer'

const props = defineProps<{
  rawPointCount: number
  segments?: SegmentItem[]
  globals?: Record<string, number> | null
  compressionMeta?: CompressionMeta | null
}>()

const visible = computed(() => props.rawPointCount > 0 || (props.segments?.length ?? 0) > 0)
const isKeyPointMode = computed(() => props.compressionMeta?.compression_mode === 'key_points')
const segmentCount = computed(() => props.segments?.length ?? 0)
const segmentCountLabel = computed(() => isKeyPointMode.value ? '关键线段数' : '压缩段数')
const compressionRatio = computed(() => {
  if (!segmentCount.value) return '-'
  return (props.rawPointCount / segmentCount.value).toFixed(1)
})
const simplifiedCount = computed(() => {
  if (!props.segments) return 0
  return props.segments.reduce((sum, seg) => sum + (seg.polyline_point_count || 0), 0)
})
const simplifiedCountLabel = computed(() => isKeyPointMode.value ? '折线顶点数' : '简化折点数')
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
const plateauKindSet = new Set<string>(['stable', 'normal', 'off', 'plateau-low', 'plateau-mid', 'plateau-high'])
const trendKindSet = new Set<string>(['transition', 'rising', 'rising-fast', 'falling', 'falling-fast', 'spike', 'surge', 'drop', 'burst'])

const plateauCount = computed(() => {
  if (!props.segments) return 0
  return props.segments.filter(s => typeof s.kind === 'string' && plateauKindSet.has(s.kind)).length
})
const trendCount = computed(() => {
  if (!props.segments) return 0
  return props.segments.filter(s => typeof s.kind === 'string' && trendKindSet.has(s.kind)).length
})
const absoluteResolution = computed(() => props.compressionMeta?.absolute_resolution != null ? `${Number(props.compressionMeta.absolute_resolution).toFixed(6)} A` : '-')
const relativeResolution = computed(() => props.compressionMeta?.relative_resolution != null ? Number(props.compressionMeta.relative_resolution).toFixed(3) : '-')
const mergeGapRatio = computed(() => props.compressionMeta?.merge_gap_ratio != null ? Number(props.compressionMeta.merge_gap_ratio).toFixed(2) : '-')
const minTransitionPoints = computed(() => props.compressionMeta?.min_transition_points != null ? String(props.compressionMeta.min_transition_points) : '-')
const targetSegmentCount = computed(() => props.compressionMeta?.target_segment_count != null ? String(props.compressionMeta.target_segment_count) : '-')
const targetSegmentCountLabel = computed(() => isKeyPointMode.value ? '目标关键点数' : '目标压缩段数')
const selectedKeyPointCount = computed(() => props.compressionMeta?.selected_key_point_count != null ? String(props.compressionMeta.selected_key_point_count) : '-')
const keyPointCountVisible = computed(() => isKeyPointMode.value)
const thresholdPercent = computed(() => props.compressionMeta?.threshold_percent != null ? `${Number(props.compressionMeta.threshold_percent).toFixed(1)} %` : '-')
const algorithmLabel = computed(() => props.compressionMeta?.algorithm_label || '-')
const selectionReason = computed(() => {
  const meta = props.compressionMeta
  if (!meta?.selection_reason) return '-'
  if (meta.selection_reason === 'closest_reachable_target') return '最接近目标段数（已达到目标）'
  if (meta.selection_reason === 'closest_unreachable_target') return '最接近目标段数（当前搜索范围内未达到目标）'
  if (meta.selection_reason === 'cliff_boundary_target_crossing' && meta.selection_context) {
    return `断崖临界值（${meta.selection_context.left_points} -> ${meta.selection_context.right_points} 段）`
  }
  if (meta.selection_reason === 'largest_cliff' && meta.selection_context) {
    return `最大断崖值（${meta.selection_context.left_points} -> ${meta.selection_context.right_points} 段）`
  }
  return meta.selection_reason
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
.cfa-stat-card-wide {
  grid-column: span 2;
}
.cfa-stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.cfa-stat-value-text {
  font-size: 14px;
  line-height: 1.5;
}
.cfa-stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
</style>
