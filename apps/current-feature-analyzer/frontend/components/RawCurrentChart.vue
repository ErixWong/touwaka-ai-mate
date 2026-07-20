<template>
  <el-card shadow="never">
    <template #header>
      <div class="cfa-chart-header">
        <div>
          <span class="card-title">电流曲线（原始数据，滚轮缩放 / 拖动平移）</span>
          <el-tag v-if="hasData" size="small" type="info" style="margin-left: 8px">
            {{ isSampled ? `当前窗口已采样 ${sampledCount} / ${totalCount} 点` : `当前窗口显示 ${sampledCount} / ${totalCount} 点` }}
          </el-tag>
        </div>
        <el-button link type="primary" :disabled="!hasData" @click="resetZoom">重置缩放</el-button>
      </div>
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
  DataZoomComponent,
} from 'echarts/components'
import type { FileAnalysisResult } from '../api/current-feature-analyzer'
import { decimateMinMax } from '../utils/local-analysis'

use([
  CanvasRenderer,
  LineChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  DataZoomComponent,
])

const props = defineProps<{
  fileName: string
  result: FileAnalysisResult | null
  rawData?: number[][] | null
  chartHeight?: number
}>()

const chartRef = ref<HTMLElement | null>(null)
const hasData = ref(false)
const isSampled = ref(false)
const sampledCount = ref(0)
const totalCount = ref(0)
let chartInstance: any = null
let resizeHandler: (() => void) | null = null
let renderTimer: ReturnType<typeof setTimeout> | null = null

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

// 当前缩放窗口（null = 全范围），由本图 dataZoom 自管，无需跨组件联动
let currentWindow: [number, number] | null = null
let dataExtent: { min: number; max: number } | null = null
let isSyncingZoom = false

let fullSampleCache: { raw: number[][]; sample: number[][] } | null = null

function getFullSample(): number[][] {
  const raw = props.rawData
  if (!raw || !Array.isArray(raw) || raw.length === 0) return []
  if (fullSampleCache?.raw === raw) return fullSampleCache.sample
  const sample = decimateMinMax(raw as [number, number][], MAX_POINTS)
  fullSampleCache = { raw, sample }
  return sample
}

function getPoints(): number[][] {
  const raw = props.rawData
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    totalCount.value = 0
    sampledCount.value = 0
    isSampled.value = false
    return []
  }

  // 全景骨架 + 窗口精修：series 数据必须始终覆盖全时间轴。
  // 若放大时把数据替换为窗口子集，x 轴范围会收缩到窗口内，
  // 之后缩小会撞上数据边界——用户看到的"缩小回不去"就是这个根因。
  const fullSample = getFullSample()
  if (!currentWindow) {
    totalCount.value = raw.length
    sampledCount.value = fullSample.length
    isSampled.value = totalCount.value > fullSample.length
    return fullSample
  }

  const [windowStart, windowEnd] = currentWindow
  const startIndex = lowerBound(raw, windowStart)
  const endExclusive = upperBound(raw, windowEnd)
  totalCount.value = Math.max(0, endExclusive - startIndex)
  const refined = sampleWindow(raw, startIndex, endExclusive)
  sampledCount.value = refined.length
  isSampled.value = totalCount.value > refined.length

  const merged: number[][] = []
  for (const point of fullSample) {
    if ((point[0] ?? 0) < windowStart) merged.push(point)
  }
  merged.push(...refined)
  for (const point of fullSample) {
    if ((point[0] ?? 0) > windowEnd) merged.push(point)
  }
  return merged
}

function resolveWindowFromZoom(): [number, number] | null {
  const option = chartInstance?.getOption?.()
  const zoom = Array.isArray(option?.dataZoom) ? option.dataZoom[0] : null
  if (!zoom) return currentWindow

  let start = typeof zoom.startValue === 'number' ? zoom.startValue : null
  let end = typeof zoom.endValue === 'number' ? zoom.endValue : null
  if ((start == null || end == null) && dataExtent && typeof zoom.start === 'number' && typeof zoom.end === 'number') {
    const span = dataExtent.max - dataExtent.min
    start = dataExtent.min + (span * zoom.start) / 100
    end = dataExtent.min + (span * zoom.end) / 100
  }
  if (start == null || end == null || !(end > start)) return currentWindow

  // 接近全范围则吸附为无窗口（阈值 3%，避免滚轮缩回到 99% 时卡在"几乎全范围"状态）
  if (dataExtent) {
    const span = dataExtent.max - dataExtent.min
    if (start <= dataExtent.min + span * 0.03 && end >= dataExtent.max - span * 0.03) {
      return null
    }
  }
  return [start, end]
}

// 显式复位标志：仅 resetZoom 时强制 dataZoom 回全范围；
// 吸附（zoom 接近全范围 → currentWindow=null）只影响采样口径，不能重置用户的缩放状态
let forceFullZoom = false

function resetZoom() {
  currentWindow = null
  forceFullZoom = true
  renderRaw()
}

function onDataZoomChanged() {
  if (isSyncingZoom) return
  currentWindow = resolveWindowFromZoom()
  scheduleRender()
}

function disposeChart() {
  if (renderTimer) {
    clearTimeout(renderTimer)
    renderTimer = null
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  if (chartInstance) {
    chartInstance.off('datazoom', onDataZoomChanged)
    chartInstance.dispose()
    chartInstance = null
  }
}

function scheduleRender() {
  if (renderTimer) {
    clearTimeout(renderTimer)
  }
  renderTimer = setTimeout(() => {
    renderTimer = null
    nextTick(() => renderRaw())
  }, 150)
}

async function renderRaw() {
  const raw = props.rawData
  if (raw && raw.length > 1) {
    dataExtent = { min: raw[0]![0] ?? 0, max: raw[raw.length - 1]![0] ?? 0 }
  } else {
    dataExtent = null
  }

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

  // 缩放状态策略：有窗口 → 同步窗口值；显式复位 → 强制回全范围；
  // 其余（含全范围吸附）→ 不传缩放字段，merge 模式保留用户当前缩放状态
  const zoomWindow = currentWindow
    ? { startValue: currentWindow[0], endValue: currentWindow[1] }
    : forceFullZoom
      ? { start: 0, end: 100 }
      : {}
  forceFullZoom = false

  isSyncingZoom = true
  chartInstance.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 10, bottom: 56 },
    xAxis: {
      type: 'value',
      name: '时间 (s)',
    },
    yAxis: { type: 'value', name: '电流 (A)' },
    dataZoom: [
      {
        id: 'zoom-inside',
        type: 'inside',
        xAxisIndex: 0,
        ...zoomWindow,
      },
      {
        id: 'zoom-slider',
        type: 'slider',
        xAxisIndex: 0,
        height: 18,
        bottom: 8,
        showDetail: false,
        showDataShadow: true,
        fillerColor: 'rgba(45, 156, 219, 0.18)',
        borderColor: 'rgba(148, 163, 184, 0.5)',
        backgroundColor: 'rgba(148, 163, 184, 0.12)',
        ...zoomWindow,
      },
    ],
    series: [{
      type: 'line',
      data: allPoints,
      smooth: false,
      symbol: 'none',
      lineStyle: { color: 'rgba(45, 156, 219, 1)', width: 1.4 },
      areaStyle: { color: 'rgba(45, 156, 219, 0.12)' },
    }],
  })
  chartInstance.off('datazoom', onDataZoomChanged)
  chartInstance.on('datazoom', onDataZoomChanged)
  requestAnimationFrame(() => {
    isSyncingZoom = false
  })
}

onMounted(() => {
  nextTick(() => renderRaw())
})

onBeforeUnmount(() => {
  disposeChart()
})

watch([() => props.rawData, () => props.result], () => {
  currentWindow = null
  nextTick(() => renderRaw())
})

watch(() => props.chartHeight, () => {
  nextTick(() => chartInstance?.resize())
})
</script>

<style scoped>
.cfa-chart { height: 250px; }
.cfa-chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
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
