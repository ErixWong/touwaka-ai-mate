<template>
  <input
    type="number"
    :value="modelValue"
    :readonly="readonly"
    class="field-input"
    :placeholder="field.label"
    @input="$emit('update:model-value', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null)"
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
