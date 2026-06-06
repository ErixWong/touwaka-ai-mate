<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore, type FitLevel, type MatchDecision } from '@/stores/resume-screening'
import MatchResultDetailView from './MatchResultDetailView.vue'

const { t } = useI18n()

const store = useResumeScreeningStore()
const fitLevelFilter = ref<FitLevel | ''>('')
const minScoreFilter = ref<number | null>(null)
const showingDetail = ref(false)
const detailResultId = ref('')
const selectedIds = ref<Set<string>>(new Set())
const bulkDecision = ref<MatchDecision | ''>('')

const fitLevelOptions = [
  { label: t('resumeScreening.results.fitAll'), value: '' },
  { label: t('resumeScreening.results.fitA'), value: 'A' },
  { label: t('resumeScreening.results.fitB'), value: 'B' },
  { label: t('resumeScreening.results.fitC'), value: 'C' },
  { label: t('resumeScreening.results.fitD'), value: 'D' },
]

const filteredResults = computed(() => {
  let list = store.matchResults
  if (fitLevelFilter.value) list = list.filter(m => m.fit_level === fitLevelFilter.value)
  if (minScoreFilter.value != null) list = list.filter(m => m.overall_score >= minScoreFilter.value!)
  return [...list].sort((a, b) => b.overall_score - a.overall_score)
})

function toggleSelect(id: string) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedIds.value = s
}

function toggleAll() {
  if (selectedIds.value.size === filteredResults.value.length) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(filteredResults.value.map(m => m.id))
  }
}

function applyBulkDecision() {
  if (!bulkDecision.value) return
  for (const id of selectedIds.value) {
    store.updateMatchResult(id, { decision: bulkDecision.value })
  }
  selectedIds.value = new Set()
  bulkDecision.value = ''
}

function openDetail(id: string) {
  detailResultId.value = id
  showingDetail.value = true
}

function fitTagType(level: FitLevel) {
  return { A: 'success', B: '', C: 'warning', D: 'danger' }[level] ?? 'info'
}

function decisionLabel(d: MatchDecision) {
  return t('resumeScreening.statusLabels.decision.' + d)
}
</script>

<template>
  <div class="results-page">
    <div class="page-header">
      <h2 class="page-title">{{ $t('resumeScreening.results.title') }}</h2>
    </div>

    <div class="filters">
      <el-select v-model="fitLevelFilter">
        <el-option v-for="o in fitLevelOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-input-number v-model="minScoreFilter" :min="0" :max="100" :placeholder="$t('resumeScreening.results.minScore')" />
    </div>

    <div v-if="selectedIds.size > 0" class="bulk-bar">
      <span>{{ $t('resumeScreening.results.selected') + selectedIds.size + $t('resumeScreening.results.items') }}</span>
      <el-select v-model="bulkDecision" placeholder="批量操作" style="width:140px" @change="applyBulkDecision">
        <el-option :label="$t('resumeScreening.results.bulkInterview')" value="interview" />
        <el-option :label="$t('resumeScreening.results.bulkHold')" value="hold" />
        <el-option :label="$t('resumeScreening.results.bulkReject')" value="reject" />
      </el-select>
    </div>

    <el-table :data="filteredResults" @selection-change="() => {}">
      <el-table-column width="40">
        <template #header>
          <el-checkbox :model-value="selectedIds.size === filteredResults.length && filteredResults.length > 0" @change="toggleAll" />
        </template>
        <template #default="{ row }">
          <el-checkbox :model-value="selectedIds.has(row.id)" @change="toggleSelect(row.id)" />
        </template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.results.columns.candidate')" min-width="120">
        <template #default="{ row }">{{ store.candidateById(row.candidate_id)?.name ?? row.candidate_id }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.results.columns.job')" min-width="160">
        <template #default="{ row }">{{ store.jobById(row.job_id)?.title ?? row.job_id }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.results.columns.score')" width="80">
        <template #default="{ row }">{{ row.overall_score }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.results.columns.level')" width="80">
        <template #default="{ row }">
          <el-tag :type="fitTagType(row.fit_level)" size="small">{{ row.fit_level }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.results.columns.decision')" width="90">
        <template #default="{ row }">{{ decisionLabel(row.decision) }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.results.columns.matchTime')" width="180">
        <template #default="{ row }">{{ row.matched_at }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="100">
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row.id)">{{ $t('resumeScreening.results.detail') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      :model-value="showingDetail"
      :title="$t('resumeScreening.results.detailTitle')"
      width="720px"
      destroy-on-close
      @close="showingDetail = false"
    >
      <MatchResultDetailView v-if="showingDetail" :result-id="detailResultId" />
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 16px; }
.page-title { font-size: 20px; }
.filters { display: flex; gap: 12px; margin-bottom: 16px; }
.bulk-bar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; margin-bottom: 12px; background: var(--el-color-primary-light-9); border-radius: 6px; font-size: 13px; }
</style>
