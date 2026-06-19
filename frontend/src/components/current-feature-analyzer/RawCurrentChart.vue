<template>
  <el-card v-if="hasData" shadow="never">
    <template #header><span class="card-title">原始电流曲线</span></template>
    <div ref="chartRef" class="cfa-chart"></div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps<{ fileName: string; result: any }>()

const chartRef = ref<HTMLElement | null>(null)
const hasData = ref(false)
let chartInstance: any = null

function getPoints() {
  const raw = props.result?.file_metrics
  if (raw && raw._points) return raw._points
  return null
}

onMounted(() => {
  hasData.value = !!props.result?.segments?.length
  if (hasData.value) {
    nextTick(() => renderRaw())
  }
})

function renderRaw() {
  if (!chartRef.value) return
  chartInstance = echarts.init(chartRef.value)
  const segs = props.result.segments || []
  const allPoints: any[] = []
  for (const seg of segs) {
    if (seg.polyline_points) {
      for (const [t, c] of seg.polyline_points) {
        allPoints.push([t, c])
      }
    }
  }

  chartInstance.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value', name: '时间 (s)' },
    yAxis: { type: 'value', name: '电流 (A)' },
    series: [{
      type: 'line',
      data: allPoints.length > 0 ? allPoints : [[0, 0]],
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#409eff', width: 1 },
    }],
  })
}
</script>

<style scoped>
.cfa-chart { height: 250px; }
</style>
