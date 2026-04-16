<template>
  <span class="state-badge" :class="badgeClass">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AppState } from '@/api/mini-apps'

const props = defineProps<{
  status?: string
  states: AppState[]
}>()

const stateDef = computed(() => {
  if (!props.status) return null
  return props.states.find(s => s.name === props.status)
})

const label = computed(() => {
  if (stateDef.value) return stateDef.value.label
  if (!props.status) return '-'
  if (props.status.startsWith('processing_')) return '处理中...'
  return props.status
})

const badgeClass = computed(() => {
  if (!props.status) return 'default'
  if (stateDef.value?.is_error) return 'error'
  if (stateDef.value?.is_terminal) return 'success'
  if (props.status.startsWith('processing_')) return 'processing'
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
}

.state-badge.pending {
  background: #fff3cd;
  color: #856404;
}

.state-badge.processing {
  background: #cce5ff;
  color: #004085;
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
</style>
