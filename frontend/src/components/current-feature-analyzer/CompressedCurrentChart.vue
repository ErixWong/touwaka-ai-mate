<template>
  <el-card v-if="hasData" shadow="never">
    <template #header><span class="card-title">压缩分段曲线</span></template>
    <div ref="chartRef" class="cfa-chart"></div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

interface CompressedSegment {
  kind: string
  segment_index: number
  polyline_points?: [number, number][]
}

const props = defineProps<{ fileName: string; result: any }>()

const chartRef = ref<HTMLElement | null>(null)
const hasData = ref(false)
let chartInstance: any = null
let resizeHandler: (() => void) | null = null

// 颜色方案 — 给散点类型用
const kindColors: Record<string, string> = {
  stable:        '#94a3b8',
  normal:        '#60a5fa',
  transition:    '#6366f1',
  spike:         '#8b5cf6',
  drop:          '#ef4444',
  surge:         '#f59e0b',
  off:           '#94a3b8',
  'plateau-low': '#94a3b8',
  'plateau-mid':'#60a5fa',
  'plateau-high':'#f59e0b',
  rising:        '#22c55e',
  'rising-fast': '#15803d',
  falling:       '#ef4444',
  'falling-fast':'#b91c1c',
  burst:         '#7c3aed',
}

const kindLabels: Record<string, string> = {
  stable: '稳定', normal: '常态', transition: '过渡',
  spike: '尖峰', drop: '跌落', surge: '浪涌', off: '关断',
  'plateau-low': '低平台', 'plateau-mid': '中平台', 'plateau-high': '高平台',
  rising: '上升', 'rising-fast': '快升', falling: '下降', 'falling-fast': '快降',
  burst: '脉冲',
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
  disposeChart()
  chartInstance = echarts.init(chartRef.value)
  resizeHandler = () => chartInstance?.resize()
  window.addEventListener('resize', resizeHandler)

  const segs = props.result?.segments || []
  if (!segs.length) return

  // 数据集 1：所有 polyline_points 拼成一条紫色折线（无点标记）
  const lineData: [number, number][] = []
  // 数据集 2：每个段的中点 + 颜色映射
  const pointData: [number, number][] = []
  const pointColors: string[] = []

  for (const seg of segs) {
    const pts = seg.polyline_points
    if (pts && pts.length > 0) {
      for (const [t, c] of pts) {
        lineData.push([t, c])
      }
    } else {
      // 没有折线点则用起止代表值连一条线
      if (seg.start_time != null && seg.end_time != null) {
        const c = seg.mean_current ?? 0
        lineData.push([seg.start_time, c], [seg.end_time, c])
      }
    }

    // 中点标记
    const midT = seg.start_time != null && seg.end_time != null
      ? (seg.start_time + seg.end_time) / 2
      : 0
    const midC = seg.mean_current ?? 0
    pointData.push([midT, midC])
    pointColors.push(kindColors[seg.kind] || '#aaa')
  }

  const series: any[] = [
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
      // 用 visualMap 做不了离散颜色 → 直接逐点设 itemStyle
    },
  ]

  chartInstance.setOption({
    tooltip: {
      trigger: 'axis',
    },
    legend: {
      show: false,
    },
    grid: { left: 50, right: 20, top: 10, bottom: 10 },
    xAxis: { type: 'value', name: '时间 (s)' },
    yAxis: { type: 'value', name: '电流 (A)' },
    series,
  })
}

onMounted(() => {
  hasData.value = !!(props.result?.segments?.length)
  if (hasData.value) {
    nextTick(() => renderCompressed())
  }
})

onBeforeUnmount(() => {
  disposeChart()
})

// 支持 result 异步更新
watch(() => props.result?.segments, (newVal) => {
  if (newVal?.length) {
    hasData.value = true
    nextTick(() => renderCompressed())
  }
})
</script>

<style scoped>
.cfa-chart { height: 280px; }
</style>
