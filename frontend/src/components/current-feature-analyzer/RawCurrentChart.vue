<template>
  <el-card v-if="hasData" shadow="never">
    <template #header>
      <span class="card-title">电流曲线（原始数据）</span>
      <el-tag v-if="isSampled" size="small" type="info" style="margin-left: 8px">已采样 {{ sampledCount }} / {{ totalCount }} 点</el-tag>
    </template>
    <div ref="chartRef" class="cfa-chart"></div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps<{ fileName: string; result: any; rawData?: number[][] | null }>()

const chartRef = ref<HTMLElement | null>(null)
const hasData = ref(false)
const isSampled = ref(false)
const sampledCount = ref(0)
const totalCount = ref(0)
let chartInstance: any = null
let resizeHandler: (() => void) | null = null

const MAX_POINTS = 3000

function getPoints(): number[][] {
  // 优先使用 rawData（原始 CSV 数据点）
  if (props.rawData && Array.isArray(props.rawData) && props.rawData.length > 0) {
    totalCount.value = props.rawData.length
    if (props.rawData.length <= MAX_POINTS) {
      isSampled.value = false
      return props.rawData
    }
    // 均匀采样
    const step = props.rawData.length / MAX_POINTS
    const sampled: number[][] = []
    for (let i = 0; i < MAX_POINTS; i++) {
      sampled.push(props.rawData[Math.floor(i * step)])
    }
    isSampled.value = true
    sampledCount.value = sampled.length
    return sampled
  }

  // 回退：使用压缩段的 polyline_points 拼接
  const segs = props.result?.segments || []
  const allPoints: any[] = []
  for (const seg of segs) {
    if (seg.polyline_points) {
      for (const [t, c] of seg.polyline_points) {
        allPoints.push([t, c])
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
  chartInstance = echarts.init(chartRef.value)
  resizeHandler = () => chartInstance?.resize()
  window.addEventListener('resize', resizeHandler)

  const allPoints = getPoints()

  chartInstance.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value', name: '时间 (s)' },
    yAxis: { type: 'value', name: '电流 (A)' },
    series: [{
      type: 'line',
      data: allPoints.length > 0 ? allPoints : [[0, 0]],
      smooth: false,
      symbol: 'none',
      lineStyle: { color: 'rgba(45, 156, 219, 1)', width: 1.4 },
      areaStyle: { color: 'rgba(45, 156, 219, 0.12)' },
    }],
  })
}

onMounted(() => {
  hasData.value = true
  nextTick(() => renderRaw())
})

onBeforeUnmount(() => {
  disposeChart()
})

// 同时监听 rawData 和 result，两者任一变化都重绘
watch([() => props.rawData, () => props.result], () => {
  hasData.value = true
  nextTick(() => renderRaw())
})
</script>

<style scoped>
.cfa-chart { height: 250px; }
</style>
