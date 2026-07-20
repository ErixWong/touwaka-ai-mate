<template>
  <el-card v-if="hasData" shadow="never">
    <template #header>
      <div class="cfa-chart-header">
        <span class="card-title">压缩分段曲线（全景）</span>
      </div>
    </template>
    <div ref="chartRef" class="cfa-chart" :style="chartStyle"></div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import { use, init } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, ScatterChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components'
import type { FileAnalysisResult } from '../api/current-feature-analyzer'

use([
  CanvasRenderer,
  LineChart,
  ScatterChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
])

const props = defineProps<{
  fileName: string
  result: FileAnalysisResult | null
  chartHeight?: number
}>()

const chartRef = ref<HTMLElement | null>(null)
const hasData = ref(false)
let chartInstance: any = null
let resizeHandler: (() => void) | null = null
const chartStyle = computed(() => ({ height: `${props.chartHeight ?? 280}px` }))
const xExtent = ref<{ min: number; max: number } | null>(null)
const chartDataCache = new Map<string, {
  lineData: [number, number][]
  pointData: [number, number][]
  pointColors: string[]
  xExtent: { min: number; max: number }
}>()

const kindColors: Record<string, string> = {
  stable: '#94a3b8', normal: '#60a5fa', transition: '#6366f1', spike: '#8b5cf6',
  drop: '#ef4444', surge: '#f59e0b', off: '#94a3b8', 'plateau-low': '#94a3b8',
  'plateau-mid': '#60a5fa', 'plateau-high': '#f59e0b', rising: '#22c55e',
  'rising-fast': '#15803d', falling: '#ef4444', 'falling-fast': '#b91c1c', burst: '#7c3aed',
}

function disposeChart() {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
}

function renderCompressed() {
  if (!chartRef.value) return
  if (!chartInstance) {
    chartInstance = init(chartRef.value)
    resizeHandler = () => chartInstance?.resize()
    window.addEventListener('resize', resizeHandler)
  }

  const segs = props.result?.segments || []
  if (!segs.length) return

   const cacheKey = `${props.fileName}::${segs.length}::${segs[0]?.start_time ?? 0}::${segs[segs.length - 1]?.end_time ?? 0}::${props.result?.contour?.values?.length ?? 0}`
   const cached = chartDataCache.get(cacheKey)

   let lineData: [number, number][]
   let pointData: [number, number][]
   let pointColors: string[]

  if (cached) {
    lineData = cached.lineData
    pointData = cached.pointData
    pointColors = cached.pointColors
    xExtent.value = cached.xExtent
  } else {
    lineData = []
    pointData = []
    pointColors = []

    // 优先按等距轮廓渲染（与发给 LLM 的数据同源，所见即所发），缺失时回退 polyline
    const contour = props.result?.contour
    const hasContour = !!contour && Number.isFinite(contour.start) && Number.isFinite(contour.step) && contour.step > 0 && Array.isArray(contour.values) && contour.values.length > 0
    if (hasContour) {
      for (let i = 0; i < contour.values.length; i++) {
        const current = contour.values[i]
        if (typeof current === 'number') {
          lineData.push([contour.start + (i + 0.5) * contour.step, current])
        }
      }
    }

    for (const seg of segs) {
      if (!hasContour) {
        const pts = seg.polyline_points
        if (pts && pts.length > 0) {
          for (const point of pts) {
            const time = point?.[0]
            const current = point?.[1]
            if (typeof time === 'number' && typeof current === 'number') {
              lineData.push([time, current])
            }
          }
        } else if (seg.start_time != null && seg.end_time != null) {
          const c = seg.mean_current ?? 0
          lineData.push([seg.start_time, c], [seg.end_time, c])
        }
      }

      const midT = seg.start_time != null && seg.end_time != null ? (seg.start_time + seg.end_time) / 2 : 0
      const midC = seg.mean_current ?? 0
      pointData.push([midT, midC])
      pointColors.push(kindColors[seg.kind || ''] || '#aaa')
    }

    if (!lineData.length) return
    const times = lineData.map(point => point[0])
    xExtent.value = {
      min: Math.min(...times),
      max: Math.max(...times),
    }
    chartDataCache.set(cacheKey, {
      lineData,
      pointData,
      pointColors,
      xExtent: xExtent.value,
    })
  }

  if (!lineData.length || !xExtent.value) return

  chartInstance.setOption({
    tooltip: { trigger: 'axis' },
    legend: { show: false },
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value', name: '时间 (s)' },
    yAxis: { type: 'value', name: '电流 (A)' },
    series: [
      {
        type: 'line',
        name: '折线',
        data: lineData,
        smooth: false,
        symbol: 'none',
        lineStyle: { color: 'rgba(142, 68, 173, 0.95)', width: 1.6 },
      },
      {
        type: 'scatter',
        name: '分段类型',
        data: pointData.map((pt, i) => ({
          value: pt,
          symbolSize: 5,
          itemStyle: { color: pointColors[i] },
        })),
      },
    ],
  }, true)
}

onMounted(() => {
  hasData.value = !!(props.result?.segments?.length)
  if (hasData.value) nextTick(() => renderCompressed())
})

onBeforeUnmount(() => {
  disposeChart()
})

watch(() => props.result?.segments, (newVal) => {
  if (newVal?.length) {
    hasData.value = true
    nextTick(() => renderCompressed())
  }
})

watch(() => props.chartHeight, () => {
  nextTick(() => chartInstance?.resize())
})
</script>

<style scoped>
.cfa-chart { height: 280px; }
.cfa-chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
