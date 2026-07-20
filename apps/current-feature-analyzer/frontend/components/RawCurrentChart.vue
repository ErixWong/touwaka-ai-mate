<template>
  <el-card shadow="never">
    <template #header>
      <span class="card-title">电流曲线（原始数据）</span>
      <el-tag v-if="hasData" size="small" type="info" style="margin-left: 8px">
        {{ isSampled ? `当前窗口已采样 ${sampledCount} / ${totalCount} 点` : `当前窗口显示 ${sampledCount} / ${totalCount} 点` }}
      </el-tag>
    </template>
    <div class="cfa-chart-wrap" :style="chartStyle">
      <div ref="chartRef" class="cfa-chart" :style="chartStyle" v-show="hasData"></div>
      <div v-if="!hasData" class="cfa-chart-empty" :style="chartStyle">暂无原始数据曲线</div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import { use, init } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
} from 'echarts/components'
import type { FileAnalysisResult } from '../api/current-feature-analyzer'
import { decimateMinMax } from '../utils/local-analysis'

use([
  CanvasRenderer,
  LineChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
])

const props = defineProps<{
  fileName: string
  result: FileAnalysisResult | null
  rawData?: number[][] | null
  chartHeight?: number
  focusRange?: [number, number] | null
}>()

const chartRef = ref<HTMLElement | null>(null)
const hasData = ref(false)
const isSampled = ref(false)
const sampledCount = ref(0)
const totalCount = ref(0)
let chartInstance: any = null
let resizeHandler: (() => void) | null = null
let focusRangeTimer: ReturnType<typeof setTimeout> | null = null

const MAX_POINTS = 3000
const chartStyle = computed(() => ({ height: `${props.chartHeight ?? 250}px` }))

function lowerBound(points: number[][], target: number) {
  let left = 0
  let right = points.length
  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if ((points[mid]?.[0] ?? 0) < target) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  return left
}

function upperBound(points: number[][], target: number) {
  let left = 0
  let right = points.length
  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if ((points[mid]?.[0] ?? 0) <= target) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  return left
}

function sampleWindow(points: number[][], startIndex = 0, endExclusive = points.length): number[][] {
  const count = Math.max(0, endExclusive - startIndex)
  if (count <= MAX_POINTS) return points.slice(startIndex, endExclusive)
  // min-max 分桶抽取：包络无损，全景/缩放任何级别都不会藏住尖峰；
  // O(窗口点数) 单遍扫描，缩放重采样开销可忽略
  return decimateMinMax(points.slice(startIndex, endExclusive) as [number, number][], MAX_POINTS)
}

function getPoints(): number[][] {
  const raw = props.rawData
  if (raw && Array.isArray(raw) && raw.length > 0) {
    const range = getNormalizedFocusRange()
    const startIndex = range ? lowerBound(raw, range[0]) : 0
    const endExclusive = range ? upperBound(raw, range[1]) : raw.length
    totalCount.value = Math.max(0, endExclusive - startIndex)
    const points = sampleWindow(raw, startIndex, endExclusive)
    sampledCount.value = points.length
    isSampled.value = totalCount.value > points.length
    return points
  }

  totalCount.value = 0
  sampledCount.value = 0
  isSampled.value = false
  return []
}

function disposeChart() {
  if (focusRangeTimer) {
    clearTimeout(focusRangeTimer)
    focusRangeTimer = null
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
}

function getNormalizedFocusRange() {
  const range = props.focusRange
  if (!range || range.length !== 2) return null
  const [start, end] = range
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return [start, end] as [number, number]
}

function applyFocusRange() {
  if (focusRangeTimer) {
    clearTimeout(focusRangeTimer)
  }
  focusRangeTimer = setTimeout(() => {
    focusRangeTimer = null
    nextTick(() => renderRaw())
  }, 80)
}

async function renderRaw() {
  const allPoints = getPoints()
  hasData.value = allPoints.length > 0
  if (!hasData.value) return
  await nextTick()
  if (!chartRef.value) return

  if (!chartInstance) {
    chartInstance = init(chartRef.value)
    resizeHandler = () => chartInstance?.resize()
    window.addEventListener('resize', resizeHandler)
  }

  chartInstance.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: {
      type: 'value',
      name: '时间 (s)',
      min: getNormalizedFocusRange()?.[0] ?? null,
      max: getNormalizedFocusRange()?.[1] ?? null,
    },
    yAxis: { type: 'value', name: '电流 (A)' },
    series: [{
      type: 'line',
      data: allPoints,
      smooth: false,
      symbol: 'none',
      lineStyle: { color: 'rgba(45, 156, 219, 1)', width: 1.4 },
      areaStyle: { color: 'rgba(45, 156, 219, 0.12)' },
    }],
  })
}

onMounted(() => {
  nextTick(() => renderRaw())
})

onBeforeUnmount(() => {
  disposeChart()
})

watch([() => props.rawData, () => props.result], () => {
  nextTick(() => renderRaw())
})

watch(() => props.chartHeight, () => {
  nextTick(() => chartInstance?.resize())
})

watch(() => props.focusRange, () => {
  applyFocusRange()
})
</script>

<style scoped>
.cfa-chart { height: 250px; }
.cfa-chart-wrap { min-height: 250px; }
.cfa-chart-empty {
  height: 250px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
