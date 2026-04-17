<template>
  <div class="repeating-field">
    <div class="repeating-header">
      <span class="repeating-label">{{ field.label }}</span>
      <button v-if="!readonly" class="btn-add-row" @click="addRow">+ {{ t('apps.addRow') }}</button>
    </div>

    <div v-if="rows.length === 0" class="repeating-empty">
      {{ t('apps.noData') }}
    </div>

    <div v-else class="repeating-table-wrapper">
      <table class="repeating-table">
        <thead>
          <tr>
            <th v-for="subField in visibleFields" :key="subField.name" class="th-cell">
              {{ subField.label }}
              <span v-if="subField.required" class="required-mark">*</span>
            </th>
            <th v-if="!readonly" class="th-action"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in rows" :key="rowIndex">
            <td v-for="subField in visibleFields" :key="subField.name" class="td-cell">
              <FieldRenderer
                :field="subField"
                :model-value="row[subField.name]"
                :readonly="readonly"
                @update:model-value="handleCellUpdate(rowIndex, subField.name, $event)"
              />
            </td>
            <td v-if="!readonly" class="td-action">
              <button class="btn-remove-row" @click="removeRow(rowIndex)" :title="t('apps.removeRow')">×</button>
            </td>
          </tr>
        </tbody>
        <tfoot v-if="summaryFields.length > 0">
          <tr class="summary-row">
            <td v-for="(subField, idx) in visibleFields" :key="subField.name" class="td-cell">
              <template v-if="idx === 0">{{ t('apps.summary') }}</template>
              <template v-else-if="getSummaryForField(subField.name) !== null">
                {{ formatSummaryValue(getSummaryForField(subField.name)) }}
              </template>
            </td>
            <td v-if="!readonly" class="td-action"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppField } from '@/api/mini-apps'
import FieldRenderer from '@/components/apps/FieldRenderer.vue'

const props = defineProps<{
  field: AppField
  modelValue: any[]
  readonly?: boolean
}>()

const emit = defineEmits(['update:model-value'])
const { t } = useI18n()

const rows = computed(() => props.modelValue || [])

const visibleFields = computed(() => {
  return (props.field.fields || []).filter(f => f.type !== 'file')
})

const summaryFields = computed(() => {
  return props.field.summary_fields || []
})

function addRow() {
  const maxItems = props.field.max_items
  if (maxItems && rows.value.length >= maxItems) return

  const newRow: Record<string, any> = {}
  for (const subField of props.field.fields || []) {
    newRow[subField.name] = subField.default !== undefined ? subField.default : null
  }
  emit('update:model-value', [...rows.value, newRow])
}

function removeRow(index: number) {
  const minItems = props.field.min_items
  if (minItems && rows.value.length <= minItems) return

  const newRows = [...rows.value]
  newRows.splice(index, 1)
  emit('update:model-value', newRows)
}

function handleCellUpdate(rowIndex: number, fieldName: string, value: any) {
  const newRows = [...rows.value]
  newRows[rowIndex] = { ...newRows[rowIndex], [fieldName]: value }
  emit('update:model-value', newRows)
}

function getSummaryForField(fieldName: string): number | null {
  const summary = summaryFields.value.find(s => s.source === fieldName)
  if (!summary) return null

  const items = rows.value
  switch (summary.function) {
    case 'sum':
      return items.reduce((sum, item) => sum + (Number(item[fieldName]) || 0), 0)
    case 'count':
      return items.length
    case 'avg':
      return items.length > 0
        ? items.reduce((sum, item) => sum + (Number(item[fieldName]) || 0), 0) / items.length
        : 0
    default:
      return null
  }
}

function formatSummaryValue(value: number | null): string {
  if (value === null) return ''
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<style scoped>
.repeating-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.repeating-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.repeating-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary, #333);
}

.btn-add-row {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px dashed var(--color-border, #ddd);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-primary, #2196f3);
}

.btn-add-row:hover {
  border-color: var(--color-primary, #2196f3);
  background: rgba(33, 150, 243, 0.05);
}

.repeating-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-text-tertiary, #999);
  border: 1px dashed var(--color-border, #ddd);
  border-radius: 6px;
  font-size: 12px;
}

.repeating-table-wrapper {
  overflow-x: auto;
}

.repeating-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.th-cell {
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary, #666);
  border-bottom: 1px solid var(--color-border, #e0e0e0);
  text-align: left;
  white-space: nowrap;
}

.th-action {
  width: 36px;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
}

.td-cell {
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border, #f0f0f0);
  vertical-align: top;
}

.td-action {
  padding: 4px;
  border-bottom: 1px solid var(--color-border, #f0f0f0);
  text-align: center;
  vertical-align: middle;
}

.btn-remove-row {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid var(--color-border, #e0e0e0);
  background: white;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-tertiary, #999);
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-remove-row:hover {
  background: #ffebee;
  color: #e53935;
  border-color: #e53935;
}

.summary-row {
  background: var(--color-bg-secondary, #f5f5f5);
  font-weight: 500;
}

.summary-row .td-cell {
  border-bottom: none;
  font-size: 12px;
}

.required-mark {
  color: #e53935;
}
</style>
