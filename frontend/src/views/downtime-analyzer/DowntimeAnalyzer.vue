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

interface DataRow {
  account: string
  category: string
  directWage: number
  surcharge: number
  totalLaborCost: number
}

interface CategoryGroup {
  category: string
  rows: DataRow[]
  subtotal: {
    directWage: number
    surcharge: number
    totalLaborCost: number
  }
}

const groupedData = ref<CategoryGroup[]>([])
const grandTotal = ref<{ directWage: number; surcharge: number; totalLaborCost: number } | null>(null)

const CATEGORY_ORDER = ['LH', 'DM', 'ME', 'SH']

function parseNumber(val: string): number {
  const cleaned = (val || '').replace(/\s/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function extractCategory(account: string): string {
  const parts = account.split('-')
  if (parts.length >= 2 && parts[1]) return parts[1]
  return ''
}

function analyze() {
  errorMessage.value = ''
  const lines = rawInput.value.split('\n').filter(line => line.trim())
  if (lines.length === 0) {
    groupedData.value = []
    grandTotal.value = null
    return
  }

  const accountMap = new Map<string, { category: string; directWage: number; surcharge: number }>()
  let validRowCount = 0

  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 5) continue

    const firstCol = (cols[0] || '').trim()
    if (firstCol === '合计' || firstCol === '总计' || firstCol === '共计') continue
    if (firstCol === '车间' && (cols[1] || '').trim() === '上班误工工时') continue
    if (firstCol === '审核') continue

    const account = cols[3]?.trim() || ''
    if (!account) continue

    validRowCount++
    const category = extractCategory(account)
    const wage = parseNumber(cols[4] || '0')
    const surcharge = cols.length >= 6 ? parseNumber(cols[5] || '0') : 0

    if (accountMap.has(account)) {
      const existing = accountMap.get(account)!
      existing.directWage += wage
      existing.surcharge += surcharge
    } else {
      accountMap.set(account, { category, directWage: wage, surcharge })
    }
  }

  if (validRowCount === 0) {
    errorMessage.value = t('downtimeAnalyzer.noValidData')
    ElMessage.warning(t('downtimeAnalyzer.noValidData'))
    groupedData.value = []
    grandTotal.value = null
    return
  }

  const categoryMap = new Map<string, DataRow[]>()
  for (const [account, data] of accountMap) {
    const category = data.category || 'OTHER'
    const row: DataRow = {
      account,
      category,
      directWage: Math.round(data.directWage * 100) / 100,
      surcharge: Math.round(data.surcharge * 100) / 100,
      totalLaborCost: Math.round((data.directWage + data.surcharge) * 100) / 100,
    }
    if (!categoryMap.has(category)) {
      categoryMap.set(category, [])
    }
    categoryMap.get(category)!.push(row)
  }

  const sortedCategories = CATEGORY_ORDER.filter(cat => categoryMap.has(cat))
  const result: CategoryGroup[] = []
  let totalWage = 0
  let totalSurcharge = 0

  for (const category of sortedCategories) {
    const rows = categoryMap.get(category)!.sort((a, b) => a.account.localeCompare(b.account))
    const subtotalWage = rows.reduce((s, r) => s + r.directWage, 0)
    const subtotalSurcharge = rows.reduce((s, r) => s + r.surcharge, 0)

    result.push({
      category,
      rows,
      subtotal: {
        directWage: Math.round(subtotalWage * 100) / 100,
        surcharge: Math.round(subtotalSurcharge * 100) / 100,
        totalLaborCost: Math.round((subtotalWage + subtotalSurcharge) * 100) / 100,
      },
    })

    totalWage += subtotalWage
    totalSurcharge += subtotalSurcharge
  }

  groupedData.value = result
  grandTotal.value = {
    directWage: Math.round(totalWage * 100) / 100,
    surcharge: Math.round(totalSurcharge * 100) / 100,
    totalLaborCost: Math.round((totalWage + totalSurcharge) * 100) / 100,
  }

  ElMessage.success(t('downtimeAnalyzer.analysisComplete'))
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
    grandTotal.value = null
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
  grandTotal.value = null
  errorMessage.value = ''
}

function generateTabText(): string {
  if (!hasResult.value) return ''
  const headers = [t('downtimeAnalyzer.account'), t('downtimeAnalyzer.directWage'), t('downtimeAnalyzer.surcharge'), t('downtimeAnalyzer.totalLaborCost')]
  const lines: string[] = [headers.join('\t')]

  for (const group of groupedData.value) {
    for (const row of group.rows) {
      const surchargeStr = row.surcharge > 0 ? row.surcharge.toFixed(2) : ''
      lines.push([row.account, row.directWage.toFixed(2), surchargeStr, row.totalLaborCost.toFixed(2)].join('\t'))
    }
    const sub = group.subtotal
    const subSurchargeStr = sub.surcharge > 0 ? sub.surcharge.toFixed(2) : ''
    lines.push([`${t('downtimeAnalyzer.subtotal')}(${group.category})`, sub.directWage.toFixed(2), subSurchargeStr, sub.totalLaborCost.toFixed(2)].join('\t'))
  }

  if (grandTotal.value) {
    const gt = grandTotal.value
    const gtSurchargeStr = gt.surcharge > 0 ? gt.surcharge.toFixed(2) : ''
    lines.push([t('downtimeAnalyzer.grandTotal'), gt.directWage.toFixed(2), gtSurchargeStr, gt.totalLaborCost.toFixed(2)].join('\t'))
  }

  return lines.join('\n')
}

async function copyToClipboard() {
  const text = generateTabText()
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(t('downtimeAnalyzer.copySuccess'))
  } catch {
    ElMessage.error(t('downtimeAnalyzer.copyFailed'))
  }
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
        <div class="result-header">
          <label class="section-label">{{ t('downtimeAnalyzer.resultLabel') }}</label>
          <el-button size="small" @click="copyToClipboard">{{ t('downtimeAnalyzer.copyToExcel') }}</el-button>
        </div>
        <table class="result-table">
          <thead>
            <tr>
              <th>{{ t('downtimeAnalyzer.account') }}</th>
              <th>{{ t('downtimeAnalyzer.directWage') }}</th>
              <th>{{ t('downtimeAnalyzer.surcharge') }}</th>
              <th>{{ t('downtimeAnalyzer.totalLaborCost') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(group, idx) in groupedData" :key="group.category">
              <tr v-for="(row, rowIdx) in group.rows" :key="`${group.category}-${rowIdx}`">
                <td>{{ row.account }}</td>
                <td class="num">{{ fmt(row.directWage) }}</td>
                <td class="num">{{ row.surcharge > 0 ? fmt(row.surcharge) : '' }}</td>
                <td class="num highlight">{{ fmt(row.totalLaborCost) }}</td>
              </tr>
              <tr class="subtotal-row">
                <td>{{ t('downtimeAnalyzer.subtotal') }}({{ group.category }})</td>
                <td class="num">{{ fmt(group.subtotal.directWage) }}</td>
                <td class="num">{{ group.subtotal.surcharge > 0 ? fmt(group.subtotal.surcharge) : '' }}</td>
                <td class="num highlight">{{ fmt(group.subtotal.totalLaborCost) }}</td>
              </tr>
            </template>
          </tbody>
          <tfoot v-if="grandTotal">
            <tr class="total-row">
              <td>{{ t('downtimeAnalyzer.grandTotal') }}</td>
              <td class="num">{{ fmt(grandTotal.directWage) }}</td>
              <td class="num">{{ grandTotal.surcharge > 0 ? fmt(grandTotal.surcharge) : '' }}</td>
              <td class="num highlight">{{ fmt(grandTotal.totalLaborCost) }}</td>
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

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.result-header .section-label {
  margin-bottom: 0;
}

.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  table-layout: fixed;
}

.result-table th,
.result-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #eee);
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-table th:first-child,
.result-table td:first-child {
  width: 45%;
  text-align: left;
}

.result-table th:nth-child(2),
.result-table td:nth-child(2),
.result-table th:nth-child(3),
.result-table td:nth-child(3),
.result-table th:nth-child(4),
.result-table td:nth-child(4) {
  width: 18.33%;
  text-align: right;
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

.subtotal-row {
  background: var(--color-bg-secondary, #f5f5f5);
  font-weight: 600;
}

.subtotal-row td {
  border-top: 1px solid var(--color-border, #ddd);
  color: var(--color-text-primary, #333);
}

.empty-hint {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary, #999);
  font-size: 14px;
}
</style>