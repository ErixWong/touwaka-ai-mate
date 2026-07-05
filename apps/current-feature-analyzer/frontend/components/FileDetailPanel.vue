<template>
  <div class="cfa-file-detail">
    <el-collapse v-if="ruleSetDetail" class="cfa-ruleset-info">
      <el-collapse-item :title="`当前规则集：${ruleSetDetail.rule_set_name}`">
        <div v-if="ruleSetDetail.description" class="cfa-ruleset-desc">{{ ruleSetDetail.description }}</div>
        <div v-if="ruleSetDetail.business_context" class="cfa-ruleset-ctx">{{ ruleSetDetail.business_context }}</div>
        <div v-if="ruleSetDetail.stages?.length" class="cfa-ruleset-stages">
          <span class="cfa-ruleset-stages-label">识别阶段：</span>
          <el-tag
            v-for="s in ruleSetDetail.stages"
            :key="s.stage_code"
            size="small"
            type="info"
            style="margin-right: 6px; margin-bottom: 4px"
          >
            {{ s.stage_name }}
          </el-tag>
        </div>
      </el-collapse-item>
    </el-collapse>

    <FileSummaryCard v-if="file" :file="file" />

    <template v-if="file.result && ['completed', 'failed'].includes(file.analysis_status)">
      <RawCurrentChart
        :file-name="file.file_name"
        :result="file.result"
        :raw-data="file.raw_data"
        :chart-height="rawChartHeight"
      />
      <div v-if="showChartResizer" class="cfa-chart-resizer" @pointerdown="startChartResize">
        <span class="cfa-chart-resizer-handle" />
      </div>
      <CompressedCurrentChart
        :file-name="file.file_name"
        :result="file.result"
        :chart-height="compressedChartHeight"
      />

      <el-tabs v-model="activeResultTab" class="cfa-result-tabs">
        <el-tab-pane label="概览" name="overview">
          <StageSummaryCard :metrics="file.result.stage_metrics || []" />
          <CompressionStatsCard
            :raw-point-count="file.raw_data?.length ?? file.row_count ?? 0"
            :segments="file.result.segments"
            :events="file.result.events"
            :globals="file.result.globals"
            :duplicate-diagnosis="file._duplicate_diagnosis"
            :compression-meta="file.result.compression_meta"
          />
        </el-tab-pane>

        <el-tab-pane label="压缩段" name="segments">
          <CompressedSegmentsTable
            v-if="file.result.segments?.length"
            :segments="file.result.segments"
          />
          <div v-else class="cfa-pending-block">
            <span>暂无压缩段结果</span>
          </div>
        </el-tab-pane>

        <el-tab-pane label="阶段指标" name="metrics">
          <StageMetricsTable
            v-if="file.result.stage_metrics?.length"
            :metrics="file.result.stage_metrics"
          />
          <AuxiliaryMetricsPanel
            v-if="file.result.stage_metrics?.length"
          />
          <div v-if="!file.result.stage_metrics?.length" class="cfa-pending-block">
            <span>暂无阶段指标</span>
          </div>
        </el-tab-pane>

        <el-tab-pane label="LLM 结果" name="llm">
          <LlmResultPanel
            v-if="file.result.llm_result"
            :llm-result="file.result.llm_result"
            :show-reason="appConfig?.ui?.show_llm_reason !== false"
          />
          <div v-else class="cfa-pending-block">
            <span>暂无 LLM 识别结果</span>
          </div>
        </el-tab-pane>
      </el-tabs>

      <div v-if="file.analysis_status === 'failed'" class="cfa-error-block">
        <el-alert
          type="error"
          :title="'分析失败'"
          :description="file.error_message || file.result.llm_result?._error || '未知错误'"
          show-icon
          :closable="false"
        />
      </div>
    </template>

    <template v-else-if="['analyzing', 'compressing', 'llm_recognizing', 'stage_metrics'].includes(file.analysis_status)">
      <RawCurrentChart
        :file-name="file.file_name"
        :raw-data="file.raw_data"
        :result="file.result || {}"
        :chart-height="rawChartHeight"
      />

      <div v-if="showChartResizer" class="cfa-chart-resizer" @pointerdown="startChartResize">
        <span class="cfa-chart-resizer-handle" />
      </div>

      <CompressedCurrentChart
        v-if="file.result?.segments?.length"
        :file-name="file.file_name"
        :result="file.result"
        :chart-height="compressedChartHeight"
      />

      <el-tabs v-model="activeResultTab" class="cfa-result-tabs">
        <el-tab-pane label="统计" name="overview">
          <CompressionStatsCard
            v-if="file.result?.segments?.length"
            :raw-point-count="file.raw_data?.length ?? file.row_count ?? 0"
            :segments="file.result.segments"
            :events="file.result.events"
            :globals="file.result.globals"
            :duplicate-diagnosis="file._duplicate_diagnosis"
            :compression-meta="file.result.compression_meta"
          />
          <div v-else class="cfa-pending-block">
            <span>正在等待压缩统计结果...</span>
          </div>
        </el-tab-pane>
      </el-tabs>

      <div class="cfa-loading-block">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>{{ file.analysis_status === 'compressing' ? '正在前端压缩分析...' : 'AI 正在分析识别阶段...' }}</span>
      </div>
    </template>

    <div v-else-if="file.analysis_status === 'failed'" class="cfa-error-block">
      <el-alert
        type="error"
        :title="'分析失败'"
        :description="file.error_message || '未知错误'"
        show-icon
        :closable="false"
      />
    </div>
    <div v-else-if="file.analysis_status === 'pending'" class="cfa-pending-block">
      <span>等待分析</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import type { SessionFileItem, RuleSetDetail, AppConfig } from '../api/current-feature-analyzer'
import FileSummaryCard from './FileSummaryCard.vue'
import StageSummaryCard from './StageSummaryCard.vue'
import RawCurrentChart from './RawCurrentChart.vue'
import CompressedCurrentChart from './CompressedCurrentChart.vue'
import CompressionStatsCard from './CompressionStatsCard.vue'
import CompressedSegmentsTable from './CompressedSegmentsTable.vue'
import StageMetricsTable from './StageMetricsTable.vue'
import AuxiliaryMetricsPanel from './AuxiliaryMetricsPanel.vue'
import LlmResultPanel from './LlmResultPanel.vue'

const props = defineProps<{
  file: SessionFileItem
  appConfig: AppConfig | null
  ruleSetDetail: RuleSetDetail | null
}>()

const activeResultTab = ref('overview')

const DESKTOP_CHART_TOTAL_HEIGHT = 560
const MOBILE_CHART_TOTAL_HEIGHT = 440
const RAW_CHART_MIN_HEIGHT = 220
const COMPRESSED_CHART_MIN_HEIGHT = 140
const RAW_CHART_DEFAULT_RATIO = 0.57

const canResizeCharts = computed(() => (props.file.result?.segments?.length ?? 0) > 0)
const hasRawRenderableData = computed(() => {
  if (props.file.raw_data?.length) return true
  return !!props.file.result?.segments?.some((seg) => (seg.polyline_points?.length ?? 0) > 0)
})
const showChartResizer = computed(() => canResizeCharts.value && hasRawRenderableData.value)

const chartTotalHeight = ref(RAW_CHART_MIN_HEIGHT + COMPRESSED_CHART_MIN_HEIGHT)
const rawChartHeight = ref(Math.round(chartTotalHeight.value * RAW_CHART_DEFAULT_RATIO))
const compressedChartHeight = ref(chartTotalHeight.value - rawChartHeight.value)

let isResizing = false
let startY = 0
let startRawHeight = RAW_CHART_MIN_HEIGHT
let activePointerId: number | null = null

function clampHeight(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function calcResponsiveChartTotalHeight() {
  const minTotal = RAW_CHART_MIN_HEIGHT + COMPRESSED_CHART_MIN_HEIGHT
  const preferred = window.innerWidth <= 768 ? MOBILE_CHART_TOTAL_HEIGHT : DESKTOP_CHART_TOTAL_HEIGHT
  const maxByViewport = Math.round(window.innerHeight * 0.62)
  return clampHeight(preferred, minTotal, Math.max(minTotal, maxByViewport))
}

function ensureChartBounds() {
  if (!canResizeCharts.value) {
    compressedChartHeight.value = 0
    rawChartHeight.value = Math.max(RAW_CHART_MIN_HEIGHT, chartTotalHeight.value)
    return
  }

  const minRaw = RAW_CHART_MIN_HEIGHT
  const maxRaw = chartTotalHeight.value - COMPRESSED_CHART_MIN_HEIGHT
  rawChartHeight.value = clampHeight(rawChartHeight.value, minRaw, maxRaw)
  compressedChartHeight.value = chartTotalHeight.value - rawChartHeight.value
}

function updateChartTotalHeight() {
  const nextTotal = calcResponsiveChartTotalHeight()

  if (!canResizeCharts.value) {
    chartTotalHeight.value = nextTotal
    ensureChartBounds()
    return
  }

  const ratio = rawChartHeight.value / chartTotalHeight.value
  chartTotalHeight.value = nextTotal
  rawChartHeight.value = Math.round(nextTotal * ratio)
  ensureChartBounds()
}

function resetChartHeights() {
  if (canResizeCharts.value) {
    rawChartHeight.value = Math.round(chartTotalHeight.value * RAW_CHART_DEFAULT_RATIO)
    compressedChartHeight.value = chartTotalHeight.value - rawChartHeight.value
    ensureChartBounds()
    return
  }

  ensureChartBounds()
}

function stopChartResize() {
  if (!isResizing) return

  isResizing = false
  activePointerId = null
  document.removeEventListener('pointermove', onChartResize)
  document.removeEventListener('pointerup', stopChartResize)
  document.removeEventListener('pointercancel', stopChartResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function onChartResize(event: PointerEvent) {
  if (!isResizing || !canResizeCharts.value || activePointerId !== event.pointerId) return

  const deltaY = event.clientY - startY
  const nextRaw = clampHeight(
    startRawHeight - deltaY,
    RAW_CHART_MIN_HEIGHT,
    chartTotalHeight.value - COMPRESSED_CHART_MIN_HEIGHT,
  )

  rawChartHeight.value = nextRaw
  compressedChartHeight.value = chartTotalHeight.value - nextRaw
}

function startChartResize(event: PointerEvent) {
  if (!canResizeCharts.value || isResizing) return

  isResizing = true
  activePointerId = event.pointerId
  startY = event.clientY
  startRawHeight = rawChartHeight.value

  document.addEventListener('pointermove', onChartResize)
  document.addEventListener('pointerup', stopChartResize)
  document.addEventListener('pointercancel', stopChartResize)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  event.preventDefault()
}

watch(
  () => [props.file.file_id, canResizeCharts.value],
  () => {
    activeResultTab.value = 'overview'
    resetChartHeights()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopChartResize()
  window.removeEventListener('resize', updateChartTotalHeight)
})

onMounted(() => {
  updateChartTotalHeight()
  resetChartHeights()
  window.addEventListener('resize', updateChartTotalHeight)
})
</script>

<style scoped>
.cfa-file-detail > * { margin-bottom: 16px; }
.cfa-ruleset-info { margin-bottom: 16px; }
.cfa-result-tabs { margin-bottom: 16px; }
.cfa-ruleset-desc { font-size: 13px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
.cfa-ruleset-ctx { font-size: 13px; color: var(--el-text-color-regular); margin-bottom: 8px; line-height: 1.5; }
.cfa-ruleset-stages { margin-top: 6px; }
.cfa-ruleset-stages-label { font-size: 12px; color: var(--el-text-color-secondary); margin-right: 4px; }
.cfa-error-block, .cfa-loading-block, .cfa-pending-block {
  padding: 40px;
  text-align: center;
  font-size: 15px;
  color: var(--el-text-color-secondary);
}
.cfa-chart-resizer {
  height: 14px;
  margin: -2px 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
  touch-action: none;
}
.cfa-chart-resizer-handle {
  display: block;
  width: 56px;
  height: 4px;
  border-radius: 4px;
  background: var(--el-border-color);
  transition: background-color 0.2s ease;
}
.cfa-chart-resizer:hover .cfa-chart-resizer-handle {
  background: var(--el-color-primary);
}
</style>
