<template>
  <el-checkbox
    :model-value="!!modelValue"
    :disabled="readonly"
    @update:model-value="$emit('update:model-value', $event)"
  >
    {{ field.label }}
  </el-checkbox>
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
