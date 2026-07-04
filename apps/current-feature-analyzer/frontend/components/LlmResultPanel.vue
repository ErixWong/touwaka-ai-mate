<template>
  <el-card shadow="never">
    <template #header><span class="card-title">LLM 识别详情</span></template>
    <div v-if="llmResult.summary" class="llm-summary">
      {{ llmResult.summary }}
    </div>
    <div v-if="cycleMeta" class="llm-cycle-hint">
      已按 {{ cycleMeta.cycleCount }} 个循环标记阶段结果
    </div>
    <template v-if="cycleGroups.length">
      <div
        v-for="group in cycleGroups"
        :key="group.cycleIndex"
        class="llm-cycle-group"
      >
        <div class="llm-cycle-group-title">第 {{ group.cycleIndex }} 次循环</div>
        <el-table
          :data="group.rows"
          stripe
          size="small"
          class="llm-stage-table"
        >
          <el-table-column label="序号" width="80">
            <template #default="{ row }">
              {{ row.cycle_stage_index ?? '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="stage_name" label="阶段名称" min-width="140" />
          <el-table-column prop="stage_code" label="阶段标识" min-width="120" />
          <el-table-column label="开始时间" width="110">
            <template #default="{ row }">
              {{ formatNumber(row.start_time) }} s
            </template>
          </el-table-column>
          <el-table-column label="结束时间" width="110">
            <template #default="{ row }">
              {{ formatNumber(row.end_time) }} s
            </template>
          </el-table-column>
          <el-table-column label="持续时长" width="110">
            <template #default="{ row }">
              {{ formatNumber((row.end_time ?? 0) - (row.start_time ?? 0)) }} s
            </template>
          </el-table-column>
          <el-table-column label="置信度" width="90">
            <template #default="{ row }">
              {{ formatConfidence(row.confidence) }}
            </template>
          </el-table-column>
          <el-table-column label="识别说明" min-width="220">
            <template #default="{ row }">
              {{ row.reason || '-' }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
    <el-table
      v-else-if="stageRows.length"
      :data="stageRows"
      stripe
      size="small"
      class="llm-stage-table"
    >
      <el-table-column prop="stage_name" label="阶段名称" min-width="140" />
      <el-table-column prop="stage_code" label="阶段标识" min-width="120" />
      <el-table-column label="开始时间" width="110">
        <template #default="{ row }">
          {{ formatNumber(row.start_time) }} s
        </template>
      </el-table-column>
      <el-table-column label="结束时间" width="110">
        <template #default="{ row }">
          {{ formatNumber(row.end_time) }} s
        </template>
      </el-table-column>
      <el-table-column label="持续时长" width="110">
        <template #default="{ row }">
          {{ formatNumber((row.end_time ?? 0) - (row.start_time ?? 0)) }} s
        </template>
      </el-table-column>
      <el-table-column label="置信度" width="90">
        <template #default="{ row }">
          {{ formatConfidence(row.confidence) }}
        </template>
      </el-table-column>
      <el-table-column label="识别说明" min-width="220">
        <template #default="{ row }">
          {{ row.reason || '-' }}
        </template>
      </el-table-column>
    </el-table>
    <div v-if="llmResult.warnings?.length" class="llm-warnings">
      <el-tag
        v-for="(w, i) in llmResult.warnings"
        :key="i"
        type="warning"
        size="small"
        style="margin-right: 8px; margin-bottom: 4px"
      >
        {{ w.message || w }}
      </el-tag>
    </div>
    <div v-if="llmResult._debug?.content || llmResult._debug?.reasoning_content" class="llm-raw-block">
      <el-collapse>
        <el-collapse-item title="📄 查看 LLM 原始返回" name="raw">
          <div class="llm-raw-meta">
            <span>content 长度: {{ llmResult._debug.content_length ?? 0 }} 字符</span>
            <span>reasoning 长度: {{ llmResult._debug.reasoning_length ?? 0 }} 字符</span>
            <span>解析来源: {{ llmResult._debug.parsed_from ?? '-' }}</span>
          </div>
          <div v-if="llmResult._debug.content" class="llm-raw-section">
            <div class="llm-raw-label">content（模型正式输出）</div>
            <pre class="llm-raw-pre">{{ llmResult._debug.content }}</pre>
          </div>
          <div v-if="llmResult._debug.reasoning_content" class="llm-raw-section">
            <div class="llm-raw-label">reasoning_content（思考过程）</div>
            <pre class="llm-raw-pre">{{ llmResult._debug.reasoning_content }}</pre>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
    <div v-if="llmResult._error" class="llm-debug-block">
      <el-alert
        type="warning"
        :title="`兜底解析：${llmResult._error}`"
        :closable="false"
        show-icon
      />
    </div>
    <div v-if="llmResult._debug && !llmResult._debug.content && !llmResult._debug.reasoning_content" class="llm-debug-block">
      <div class="llm-debug-title">调试信息</div>
      <div class="llm-debug-meta">
        <span>attempt: {{ llmResult._debug.attempt ?? '-' }}</span>
        <span>content_length: {{ llmResult._debug.content_length ?? 0 }}</span>
      </div>
      <div v-if="llmResult._debug.content_preview" class="llm-debug-section">
        <div class="llm-debug-label">content_preview</div>
        <pre class="llm-debug-pre">{{ llmResult._debug.content_preview }}</pre>
      </div>
      <div v-if="llmResult._debug.reasoning_preview" class="llm-debug-section">
        <div class="llm-debug-label">reasoning_preview</div>
        <pre class="llm-debug-pre">{{ llmResult._debug.reasoning_preview }}</pre>
      </div>
    </div>
    <div v-if="!llmResult.stages?.length && !llmResult.summary" class="llm-empty">
      无 LLM 识别结果
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LlmResult } from '../api/current-feature-analyzer'

const props = defineProps<{
  llmResult: LlmResult
  showReason?: boolean
}>()

type StageRow = NonNullable<LlmResult['stages']>[number] & {
  cycle_index?: number
  cycle_stage_index?: number
}

const cycleMeta = computed(() => {
  const stages = Array.isArray(props.llmResult.stages) ? props.llmResult.stages : []
  const cycleIndices = [...new Set(stages.map(stage => Number(stage.cycle_index)).filter(Number.isFinite))]
  if (cycleIndices.length <= 1) {
    return null
  }

  return {
    cycleCount: cycleIndices.length,
  }
})

const stageRows = computed<StageRow[]>(() => {
  const stages = Array.isArray(props.llmResult.stages) ? props.llmResult.stages : []
  return stages
})

const cycleGroups = computed(() => {
  if (!cycleMeta.value) {
    return [] as Array<{ cycleIndex: number; rows: StageRow[] }>
  }

  const groups = new Map<number, StageRow[]>()
  for (const row of stageRows.value) {
    const cycleIndex = Number(row.cycle_index)
    if (!Number.isFinite(cycleIndex)) {
      continue
    }
    if (!groups.has(cycleIndex)) {
      groups.set(cycleIndex, [])
    }
    groups.get(cycleIndex)?.push(row)
  }

  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([cycleIndex, rows]) => ({ cycleIndex, rows }))
})

function formatNumber(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4) : '-'
}

function formatConfidence(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '-'
}
</script>

<style scoped>
.llm-summary { margin-bottom: 8px; font-size: 14px; }
.llm-cycle-hint {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--el-color-primary);
}
.llm-cycle-group {
  margin-bottom: 16px;
}
.llm-cycle-group-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.llm-stage-table { margin-bottom: 12px; }
.llm-warnings { margin-bottom: 8px; }
.llm-debug-block { margin-bottom: 12px; }
.llm-debug-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.llm-debug-meta { display: flex; gap: 16px; font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.llm-debug-section { margin-bottom: 8px; }
.llm-debug-label { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
.llm-debug-pre { margin: 0; padding: 10px; background: var(--el-fill-color-light); border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; max-height: 240px; overflow: auto; }
.llm-empty { color: var(--el-text-color-placeholder); font-size: 14px; }
.llm-raw-block { margin-bottom: 12px; }
.llm-raw-meta { display: flex; gap: 16px; font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.llm-raw-section { margin-bottom: 10px; }
.llm-raw-label { font-size: 12px; font-weight: 600; color: var(--el-color-warning); margin-bottom: 4px; }
.llm-raw-pre { margin: 0; padding: 10px; background: #fffbe6; border: 1px solid var(--el-color-warning-light-5); border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; max-height: 400px; overflow: auto; }
</style>
