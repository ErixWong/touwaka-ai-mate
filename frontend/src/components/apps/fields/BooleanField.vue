<template>
  <label class="field-boolean">
    <input
      type="checkbox"
      :checked="!!modelValue"
      :disabled="readonly"
      @change="$emit('update:model-value', ($event.target as HTMLInputElement).checked)"
    />
    <span>{{ field.label }}</span>
  </label>
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
.field-boolean {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 8px 0;
}
</style>
