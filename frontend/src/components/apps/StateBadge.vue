<template>
  <el-tooltip v-if="isStuck" placement="top" :content="stuckTooltip">
    <span class="state-badge" :class="badgeClass">
      {{ label }}
      <span class="timeout-indicator"> ⚠ {{ displayMinutes }}min</span>
    </span>
  </el-tooltip>
  <span v-else class="state-badge" :class="badgeClass">
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppState } from '@/api/mini-apps'

const PROCESSING_TIMEOUT_MINUTES = 15

const props = defineProps<{
  status?: string
  states: AppState[]
  processingStartedAt?: string
}>()

const { t } = useI18n()

const stateDef = computed(() => {
  if (!props.status) return null
  return props.states.find(s => s.name === props.status)
})

const label = computed(() => {
  if (stateDef.value) return stateDef.value.label
  if (!props.status) return '-'
  return props.status
})

const isProcessingState = computed(() => {
  const processingStates = ['ocr_processing', 'cleaning', 'extract_processing', 'section_processing']
  return processingStates.includes(props.status || '')
})

const rawElapsedMinutes = computed(() => {
  if (!props.processingStartedAt) return 0
  const startedAt = new Date(props.processingStartedAt).getTime()
  return (Date.now() - startedAt) / 60000
})

const displayMinutes = computed(() => Math.round(rawElapsedMinutes.value))

const isStuck = computed(() => {
  if (!isProcessingState.value || !props.processingStartedAt) return false
  return rawElapsedMinutes.value > PROCESSING_TIMEOUT_MINUTES
})

const stuckTooltip = computed(() => {
  return t('apps.processingStuck', { minutes: displayMinutes.value })
})

const badgeClass = computed(() => {
  if (!props.status) return 'default'
  if (stateDef.value?.is_error) return 'error'
  if (stateDef.value?.is_terminal) return 'success'
  if (isStuck.value) return 'stuck'
  if (isProcessingState.value) return 'processing'
  if (props.status === 'pending_review') return 'review'
  return 'pending'
})
</script>

<style scoped>
.state-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: default;
}

.state-badge.pending {
  background: #fff3cd;
  color: #856404;
}

.state-badge.processing {
  background: #cce5ff;
  color: #004085;
}

.state-badge.stuck {
  background: #f8d7da;
  color: #721c24;
}

.state-badge.review {
  background: #d4edda;
  color: #155724;
}

.state-badge.success {
  background: #d4edda;
  color: #155724;
}

.state-badge.error {
  background: #f8d7da;
  color: #721c24;
}

.state-badge.default {
  background: #e9ecef;
  color: #495057;
}

.timeout-indicator {
  font-size: 11px;
  margin-left: 2px;
}
</style>