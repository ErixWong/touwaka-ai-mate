<template>
  <select
    :value="modelValue"
    :disabled="readonly"
    class="field-select"
    @change="$emit('update:model-value', ($event.target as HTMLSelectElement).value)"
  >
    <option value="">{{ t('apps.pleaseSelect') }}</option>
    <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
  </select>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AppField } from '@/api/mini-apps'

const { t } = useI18n()

defineProps<{
  field: AppField
  modelValue: string | number | boolean | null
  readonly?: boolean
}>()

defineEmits(['update:model-value'])
</script>

<style scoped>
.field-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 6px;
  font-size: 14px;
  background: var(--color-bg-primary, #fff);
}

.field-select:disabled {
  background: var(--color-bg-secondary, #f5f5f5);
}
</style>
