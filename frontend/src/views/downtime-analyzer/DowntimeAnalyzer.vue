<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'

const { t } = useI18n()
const router = useRouter()
const rawInput = ref('')
const errorMessage = ref('')
const hasResult = computed(() => groupedData.value.length > 0)

interface GroupedRow {
  accountCategory: string
  directWage: number
  surcharge: number
  totalLaborCost: number
}

const groupedData = ref<GroupedRow[]>([])
const totalRow = ref<GroupedRow | null>(null)

function parseNumber(val: string): number {
  const cleaned = val.replace(/\s/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function extractCategory(account: string): string {
  const parts = account.split('-')
  if (parts.length >= 3 && parts[1]) return parts[1]
  return account
}

function analyze() {
  errorMessage.value = ''
  const lines = rawInput.value.split('\n').filter(line => line.trim())
  if (lines.length === 0) {
    groupedData.value = []
    totalRow.value = null
    return
  }

  const groups: Record<string, { directWage: number; surcharge: number }> = {}
  let validRowCount = 0

  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 5) continue

    const firstCol = cols[0].trim()
    if (firstCol === '合计' || firstCol === '总计' || firstCol === '共计') continue
    if (firstCol === '车间' && cols[1]?.trim() === '上班误工工时') continue

    const account = cols[3]?.trim() || ''
    if (!account) continue

    validRowCount++
    const category = extractCategory(account)
    const wage = parseNumber(cols[4] || '0')
    const surcharge = cols.length >= 6 ? parseNumber(cols[5] || '0') : 0

    if (!groups[category]) {
      groups[category] = { directWage: 0, surcharge: 0 }
    }
    groups[category].directWage += wage
    groups[category].surcharge += surcharge
  }

  if (validRowCount === 0) {
    errorMessage.value = t('downtimeAnalyzer.noValidData')
    ElMessage.warning(t('downtimeAnalyzer.noValidData'))
    groupedData.value = []
    totalRow.value = null
    return
  }

  const sorted = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, data]) => ({
      accountCategory: category,
      directWage: Math.round(data.directWage * 100) / 100,
      surcharge: Math.round(data.surcharge * 100) / 100,
      totalLaborCost: Math.round((data.directWage + data.surcharge) * 100) / 100,
    }))

  groupedData.value = sorted

  if (sorted.length > 0) {
    const totalWage = sorted.reduce((s, r) => s + r.directWage, 0)
    const totalSurcharge = sorted.reduce((s, r) => s + r.surcharge, 0)
    totalRow.value = {
      accountCategory: t('downtimeAnalyzer.total'),
      directWage: Math.round(totalWage * 100) / 100,
      surcharge: Math.round(totalSurcharge * 100) / 100,
      totalLaborCost: Math.round((totalWage + totalSurcharge) * 100) / 100,
    }
    ElMessage.success(t('downtimeAnalyzer.analysisComplete'))
  } else {
    totalRow.value = null
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(rawInput, (newVal) => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  if (newVal.trim()) {
    debounceTimer = setTimeout(() => {
      analyze()
    }, 500)
  } else {
    groupedData.value = []
    totalRow.value = null
    errorMessage.value = ''
    debounceTimer = null
  }
})

function goBack() {
  router.push('/apps')
}

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function clearInput() {
  rawInput.value = ''
  groupedData.value = []
  totalRow.value = null
  errorMessage.value = ''
}
</script>

<template>
  <div class="downtime-analyzer">
    <div class="app-header">
      <div class="header-left">
        <el-button @click="goBack">{{ t('common.back') }}</el-button>
        <span class="app-icon">📊</span>
        <h1 class="app-name">{{ t('downtimeAnalyzer.title') }}</h1>
      </div>
      <div class="header-right">
        <el-button @click="clearInput" :disabled="!rawInput">{{ t('common.reset') }}</el-button>
        <el-button type="primary" @click="analyze" :disabled="!rawInput">{{ t('downtimeAnalyzer.analyze') }}</el-button>
      </div>
    </div>

    <div class="main-content">
      <div class="input-section">
        <label class="section-label">{{ t('downtimeAnalyzer.inputLabel') }}</label>
        <el-input
          v-model="rawInput"
          type="textarea"
          :rows="12"
          :placeholder="t('downtimeAnalyzer.inputPlaceholder')"
          class="input-textarea"
        />
      </div>

      <el-alert
        v-if="errorMessage"
        type="warning"
        :title="errorMessage"
        show-icon
        class="error-alert"
      />

      <div v-if="hasResult" class="result-section">
        <label class="section-label">{{ t('downtimeAnalyzer.resultLabel') }}</label>
        <table class="result-table">
          <thead>
            <tr>
              <th>{{ t('downtimeAnalyzer.accountCategory') }}</th>
              <th>{{ t('downtimeAnalyzer.directWage') }}</th>
              <th>{{ t('downtimeAnalyzer.surcharge') }}</th>
              <th>{{ t('downtimeAnalyzer.totalLaborCost') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in groupedData" :key="row.accountCategory">
              <td>{{ row.accountCategory }}</td>
              <td class="num">{{ fmt(row.directWage) }}</td>
              <td class="num">{{ fmt(row.surcharge) }}</td>
              <td class="num highlight">{{ fmt(row.totalLaborCost) }}</td>
            </tr>
          </tbody>
          <tfoot v-if="totalRow">
            <tr class="total-row">
              <td>{{ totalRow.accountCategory }}</td>
              <td class="num">{{ fmt(totalRow.directWage) }}</td>
              <td class="num">{{ fmt(totalRow.surcharge) }}</td>
              <td class="num highlight">{{ fmt(totalRow.totalLaborCost) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div v-if="!hasResult && rawInput && !errorMessage" class="empty-hint">
        {{ t('downtimeAnalyzer.emptyHint') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.downtime-analyzer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-primary, #fff);
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-icon {
  font-size: 28px;
}

.app-name {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary, #333);
}

.main-content {
  flex: 1;
  overflow: auto;
  padding: 24px;
}

.input-section {
  margin-bottom: 24px;
}

.section-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary, #666);
  margin-bottom: 8px;
}

.input-textarea {
  font-family: 'Consolas', 'Monaco', monospace;
}

.input-textarea :deep(.el-textarea__inner) {
  font-family: 'Consolas', 'Monaco', monospace;
  min-height: 200px;
}

.error-alert {
  margin-bottom: 24px;
}

.result-section {
  margin-top: 24px;
}

.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.result-table th,
.result-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #eee);
}

.result-table th {
  font-weight: 600;
  color: var(--color-text-secondary, #666);
  background: var(--color-bg-secondary, #f8f9fa);
  white-space: nowrap;
}

.result-table tbody tr:hover {
  background: var(--color-bg-secondary, #f8f9fa);
}

.result-table td.num {
  text-align: right;
  font-family: 'Consolas', 'Monaco', monospace;
}

.result-table td.highlight {
  font-weight: 700;
  color: var(--el-color-primary, #409eff);
}

.total-row {
  background: var(--color-bg-secondary, #f8f9fa);
  font-weight: 600;
}

.total-row td {
  border-top: 2px solid var(--color-border, #d0d0d0);
}

.empty-hint {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary, #999);
  font-size: 14px;
}
</style>