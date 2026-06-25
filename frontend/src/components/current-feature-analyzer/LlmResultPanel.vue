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
    <!-- LLM 原始返回内容（无论成功/失败都展示） -->
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
import type { LlmResult } from '@/api/current-feature-analyzer'

defineProps<{
  llmResult: LlmResult | null
  showReason?: boolean
}>()
</script>

<style scoped>
.llm-summary { margin-bottom: 8px; font-size: 14px; }
.llm-warnings { margin-bottom: 8px; }
.llm-debug-block { margin-bottom: 12px; }
.llm-debug-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.llm-debug-meta { display: flex; gap: 16px; font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.llm-debug-section { margin-bottom: 8px; }
.llm-debug-label { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
.llm-debug-pre { margin: 0; padding: 10px; background: var(--el-fill-color-light); border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; max-height: 240px; overflow: auto; }
.llm-reasons { font-size: 13px; color: var(--el-text-color-regular); }
.llm-reason-item { margin-bottom: 4px; }
.llm-empty { color: var(--el-text-color-placeholder); font-size: 14px; }
.llm-raw-block { margin-bottom: 12px; }
.llm-raw-meta { display: flex; gap: 16px; font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.llm-raw-section { margin-bottom: 10px; }
.llm-raw-label { font-size: 12px; font-weight: 600; color: var(--el-color-warning); margin-bottom: 4px; }
.llm-raw-pre { margin: 0; padding: 10px; background: #fffbe6; border: 1px solid var(--el-color-warning-light-5); border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; max-height: 400px; overflow: auto; }
</style>
