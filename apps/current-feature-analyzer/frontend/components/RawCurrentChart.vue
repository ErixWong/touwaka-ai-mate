<template>
  <el-card shadow="never">
    <template #header>
      <span class="card-title">电流曲线（原始数据，滚轮缩放 / 拖动平移）</span>
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

function getPoints(): number[][] {
  const raw = props.rawData
  if (raw && Array.isArray(raw) && raw.length > 0) {
    const range = currentWindow
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

  // 接近全范围则视为无窗口
  if (dataExtent) {
    const span = dataExtent.max - dataExtent.min
    if (start <= dataExtent.min + span * 0.005 && end >= dataExtent.max - span * 0.005) {
      return null
    }
  }
  return [start, end]
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
        startValue: currentWindow?.[0],
        endValue: currentWindow?.[1],
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
        startValue: currentWindow?.[0],
        endValue: currentWindow?.[1],
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
