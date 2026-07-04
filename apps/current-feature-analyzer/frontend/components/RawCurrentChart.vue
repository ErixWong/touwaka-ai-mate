<template>
  <el-card shadow="never">
    <template #header>
      <span class="card-title">电流曲线（原始数据）</span>
      <el-tag v-if="isSampled" size="small" type="info" style="margin-left: 8px">已采样 {{ sampledCount }} / {{ totalCount }} 点</el-tag>
    </template>
    <div class="cfa-chart-wrap">
      <div ref="chartRef" class="cfa-chart" v-show="hasData"></div>
      <div v-if="!hasData" class="cfa-chart-empty">暂无原始数据曲线</div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import type { FileAnalysisResult } from '../api/current-feature-analyzer'

const props = defineProps<{ fileName: string; result: FileAnalysisResult | null; rawData?: number[][] | null }>()

const chartRef = ref<HTMLElement | null>(null)
const hasData = ref(false)
const isSampled = ref(false)
const sampledCount = ref(0)
const totalCount = ref(0)
let chartInstance: any = null
let resizeHandler: (() => void) | null = null

const MAX_POINTS = 3000

function getPoints(): number[][] {
  if (props.rawData && Array.isArray(props.rawData) && props.rawData.length > 0) {
    totalCount.value = props.rawData.length
    if (props.rawData.length <= MAX_POINTS) {
      isSampled.value = false
      sampledCount.value = props.rawData.length
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

  totalCount.value = 0
  sampledCount.value = 0
  isSampled.value = false
  return []
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

async function renderRaw() {
  const allPoints = getPoints()
  hasData.value = allPoints.length > 0
  disposeChart()
  if (!hasData.value) return
  await nextTick()
  if (!chartRef.value) return

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
