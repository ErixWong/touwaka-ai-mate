<template>
  <el-card v-if="hasData" shadow="never">
    <template #header>
      <span class="card-title">电流曲线（原始数据）</span>
      <el-tag v-if="isSampled" size="small" type="info" style="margin-left: 8px">已采样 {{ sampledCount }} / {{ totalCount }} 点</el-tag>
    </template>
    <div ref="chartRef" class="cfa-chart" :style="chartStyle"></div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import * as echarts from 'echarts'
import type { FileAnalysisResult } from '../api/current-feature-analyzer'

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

const MAX_POINTS = 3000
const chartStyle = computed(() => ({ height: `${props.chartHeight ?? 250}px` }))

function getPoints(): number[][] {
  if (props.rawData && Array.isArray(props.rawData) && props.rawData.length > 0) {
    totalCount.value = props.rawData.length
    if (props.rawData.length <= MAX_POINTS) {
      isSampled.value = false
      return props.rawData
    }
    const step = props.rawData.length / MAX_POINTS
    const sampled: number[][] = []
    for (let i = 0; i < MAX_POINTS; i++) {
      const point = props.rawData[Math.floor(i * step)]
      if (point) {
        sampled.push(point)
      }
    }
    isSampled.value = true
    sampledCount.value = sampled.length
    return sampled
  }

  const segs = props.result?.segments || []
  const allPoints: [number, number][] = []
  for (const seg of segs) {
    if (seg.polyline_points) {
      for (const point of seg.polyline_points) {
        const time = point?.[0]
        const current = point?.[1]
        if (typeof time === 'number' && typeof current === 'number') {
          allPoints.push([time, current])
        }
      }
    }
  }
  if (allPoints.length > 0) {
    totalCount.value = allPoints.length
    isSampled.value = false
  }
  return allPoints
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

function renderRaw() {
  if (!chartRef.value) return
  disposeChart()
  const allPoints = getPoints()
  hasData.value = allPoints.length > 0
  if (!hasData.value) return

  chartInstance = echarts.init(chartRef.value)
  resizeHandler = () => chartInstance?.resize()
  window.addEventListener('resize', resizeHandler)

  chartInstance.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value', name: '时间 (s)' },
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
</script>

<style scoped>
.cfa-chart { height: 250px; }
</style>
