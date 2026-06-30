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
      <StageSummaryCard :metrics="file.result.stage_metrics || []" />

      <RawCurrentChart :file-name="file.file_name" :result="file.result" :raw-data="file.raw_data" />
      <CompressedCurrentChart :file-name="file.file_name" :result="file.result" />

      <CompressionStatsCard
        :raw-point-count="file.raw_data?.length ?? file.row_count ?? 0"
        :segments="file.result.segments"
        :events="file.result.events"
        :globals="file.result.globals"
        :duplicate-diagnosis="file._duplicate_diagnosis"
      />

      <CompressedSegmentsTable
        v-if="file.result.segments?.length"
        :segments="file.result.segments"
      />

      <StageMetricsTable
        v-if="file.result.stage_metrics?.length"
        :metrics="file.result.stage_metrics"
      />

      <AuxiliaryMetricsPanel
        v-if="appConfig?.ui?.show_ripple_rate !== false && file.result.stage_metrics?.length"
        :metrics="file.result.stage_metrics"
      />

      <LlmResultPanel
        v-if="file.result.llm_result"
        :llm-result="file.result.llm_result"
        :show-reason="appConfig?.ui?.show_llm_reason !== false"
      />

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

    <!-- 分析中：先画可用的图，LLM 结果区域显示等待 -->
    <template v-else-if="file.analysis_status === 'analyzing'">
      <RawCurrentChart
        v-if="file.raw_data?.length"
        :file-name="file.file_name"
        :raw-data="file.raw_data"
        :result="file.result"
        :result="file.result || {}"
      />

      <CompressedCurrentChart
        v-if="file.result?.segments?.length"
        :file-name="file.file_name"
        :result="file.result"
      />

      <CompressionStatsCard
        v-if="file.result?.segments?.length"
        :raw-point-count="file.raw_data?.length ?? file.row_count ?? 0"
        :segments="file.result.segments"
        :events="file.result.events"
        :globals="file.result.globals"
        :duplicate-diagnosis="file._duplicate_diagnosis"
      />

      <div class="cfa-loading-block">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>AI 正在分析识别阶段...</span>
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

defineProps<{
  file: SessionFileItem
  appConfig: AppConfig | null
  ruleSetDetail: RuleSetDetail | null
}>()
</script>

<style scoped>
.cfa-file-detail > * { margin-bottom: 16px; }
.cfa-ruleset-info { margin-bottom: 16px; }
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
</style>
