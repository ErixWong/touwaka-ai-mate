<template>
  <component
    :is="fieldComponent"
    :field="field"
    :model-value="modelValue"
    :readonly="readonly"
    @update:model-value="$emit('update:model-value', $event)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AppField } from '@/api/mini-apps'
import TextField from './fields/TextField.vue'
import TextAreaField from './fields/TextAreaField.vue'
import NumberField from './fields/NumberField.vue'
import DateField from './fields/DateField.vue'
import SelectField from './fields/SelectField.vue'
import BooleanField from './fields/BooleanField.vue'
import GroupField from './fields/GroupField.vue'
import RepeatingField from './fields/RepeatingField.vue'

const props = defineProps<{
  field: AppField
  modelValue: any
  readonly?: boolean
}>()

defineEmits(['update:model-value'])

const FIELD_MAP: Record<string, any> = {
  text: TextField,
  textarea: TextAreaField,
  number: NumberField,
  date: DateField,
  select: SelectField,
  boolean: BooleanField,
  group: GroupField,
  repeating: RepeatingField,
}

const fieldComponent = computed(() => {
  return FIELD_MAP[props.field.type] || TextField
})
</script>
