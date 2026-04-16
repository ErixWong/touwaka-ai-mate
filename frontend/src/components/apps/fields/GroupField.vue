<template>
  <fieldset class="group-field">
    <legend class="group-legend">{{ field.label }}</legend>
    <div class="group-fields">
      <div v-for="subField in field.fields" :key="subField.name" class="group-field-item">
        <label v-if="subField.label" class="field-label">
          {{ subField.label }}
          <span v-if="subField.required" class="required-mark">*</span>
        </label>
        <FieldRenderer
          :field="subField"
          :model-value="modelValue?.[subField.name]"
          :readonly="readonly"
          @update:model-value="handleSubFieldUpdate(subField.name, $event)"
        />
      </div>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import type { AppField } from '@/api/mini-apps'
import FieldRenderer from '@/components/apps/FieldRenderer.vue'

const props = defineProps<{
  field: AppField
  modelValue: Record<string, any>
  readonly?: boolean
}>()

const emit = defineEmits(['update:model-value'])

function handleSubFieldUpdate(name: string, value: any) {
  const current = { ...(props.modelValue || {}) }
  current[name] = value
  emit('update:model-value', current)
}
</script>

<style scoped>
.group-field {
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  padding: 12px 16px;
  margin: 0;
}

.group-legend {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary, #666);
  padding: 0 8px;
}

.group-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group-field-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary, #333);
}

.required-mark {
  color: #e53935;
}
</style>
