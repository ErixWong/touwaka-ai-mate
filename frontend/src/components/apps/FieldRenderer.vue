<template>
  <component
    :is="fieldComponent"
    :field="field"
    :model-value="modelValue"
    :readonly="readonly"
    :app="app"
    @update:model-value="$emit('update:model-value', $event)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import type { AppField, MiniApp } from '@/api/mini-apps'
import TextField from './fields/TextField.vue'
import TextAreaField from './fields/TextAreaField.vue'
import NumberField from './fields/NumberField.vue'
import DateField from './fields/DateField.vue'
import SelectField from './fields/SelectField.vue'
import BooleanField from './fields/BooleanField.vue'
import GroupField from './fields/GroupField.vue'
import RepeatingField from './fields/RepeatingField.vue'
import FileField from './fields/FileField.vue'

const props = defineProps<{
  field: AppField
  modelValue: unknown
  readonly?: boolean
  app?: MiniApp
  recordId?: string
}>()

defineEmits(['update:model-value'])

const FIELD_MAP: Record<string, Component> = {
  text: TextField,
  textarea: TextAreaField,
  number: NumberField,
  date: DateField,
  select: SelectField,
  boolean: BooleanField,
  group: GroupField,
  repeating: RepeatingField,
  file: FileField,
}

const fieldComponent = computed(() => {
  return FIELD_MAP[props.field.type] || TextField
})
</script>
