<template>
  <el-card v-if="hasData" shadow="never">
    <template #header><span class="card-title">压缩曲线</span></template>
    <div ref="chartRef" class="cfa-chart"></div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps<{ fileName: string; result: any }>()

const chartRef = ref<HTMLElement | null>(null)
const hasData = ref(false)

onMounted(() => {
  hasData.value = !!props.result?.segments?.length
  if (hasData.value) {
    nextTick(() => renderCompressed())
  }
})

const kindColors: Record<string, string> = {
  'plateau-low': '#91cc75', 'plateau-mid': '#73c0de', 'plateau-high': '#5470c6',
  'transition': '#fac858', 'spike': '#ee6666', 'burst': '#fc8452',
  'rising': '#3ba272', 'rising-fast': '#3ba272', 'falling': '#ee6666', 'falling-fast': '#ee6666',
}

function renderCompressed() {
  if (!chartRef.value) return
  const instance = echarts.init(chartRef.value)
  const segs = props.result.segments || []
  const series = segs.map(seg => ({
    type: 'line',
    name: `${seg.kind} (${seg.segment_index})`,
    data: seg.polyline_points || [],
    smooth: false,
    symbol: 'circle',
    symbolSize: 3,
    lineStyle: { width: 2, color: kindColors[seg.kind] || '#aaa' },
    itemStyle: { color: kindColors[seg.kind] || '#aaa' },
  }))

  instance.setOption({
    tooltip: { trigger: 'axis' },
    legend: { show: false },
    grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value', name: '时间 (s)' },
    yAxis: { type: 'value', name: '电流 (A)' },
    series: series.length > 0 ? series : [{ type: 'line', data: [[0, 0]] }],
  })
}
</script>

<style scoped>
.cfa-chart { height: 250px; }
</style>
