<template>
  <el-date-picker
    :model-value="modelValue"
    :disabled="readonly"
    type="date"
    value-format="YYYY-MM-DD"
    @update:model-value="$emit('update:model-value', $event)"
  />
</template>

<script setup lang="ts">
import type { AppField } from '@/api/mini-apps'

defineProps<{
  field: AppField
  modelValue: any
  readonly?: boolean
}>()

defineEmits(['update:model-value'])
</script>

<style scoped>
.field-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 6px;
  font-size: 14px;
  background: var(--color-bg-primary, #fff);
}

.field-input[readonly] {
  background: var(--color-bg-secondary, #f5f5f5);
}
</style>
