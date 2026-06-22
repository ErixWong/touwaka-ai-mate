<template>
  <el-card shadow="never">
    <template #header><span class="card-title">LLM 识别详情</span></template>
    <div v-if="llmResult.summary" class="llm-summary">
      {{ llmResult.summary }}
    </div>
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
    <div v-if="showReason && llmResult.stages?.length" class="llm-reasons">
      <div v-for="(s, i) in llmResult.stages" :key="i" class="llm-reason-item">
        <strong>{{ s.stage_name }}</strong>
        <span v-if="s.reason">: {{ s.reason }}</span>
      </div>
    </div>
    <div v-if="!llmResult.stages?.length && !llmResult.summary" class="llm-empty">
      无 LLM 识别结果
    </div>
  </el-card>
</template>

<script setup lang="ts">
defineProps<{
  llmResult: any
  showReason?: boolean
}>()
</script>

<style scoped>
.llm-summary { margin-bottom: 8px; font-size: 14px; }
.llm-warnings { margin-bottom: 8px; }
.llm-reasons { font-size: 13px; color: var(--el-text-color-regular); }
.llm-reason-item { margin-bottom: 4px; }
.llm-empty { color: var(--el-text-color-placeholder); font-size: 14px; }
</style>
