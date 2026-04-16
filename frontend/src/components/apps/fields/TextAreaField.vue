<template>
  <textarea
    :value="modelValue"
    :readonly="readonly"
    class="field-textarea"
    :placeholder="field.label"
    rows="3"
    @input="$emit('update:model-value', ($event.target as HTMLTextAreaElement).value)"
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
.field-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 6px;
  font-size: 14px;
  resize: vertical;
  min-height: 60px;
  background: var(--color-bg-primary, #fff);
}

.field-textarea[readonly] {
  background: var(--color-bg-secondary, #f5f5f5);
}
</style>
