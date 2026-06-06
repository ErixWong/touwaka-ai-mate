<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore, type FitLevel, type MatchDecision } from '@/stores/resume-screening'

const { t } = useI18n()
const store = useResumeScreeningStore()
const keyword = ref('')
const scoreMinFilter = ref<number | null>(null)
const scoreMaxFilter = ref<number | null>(null)
const decisionFilter = ref<MatchDecision | ''>('')

const filteredResults = computed(() => {
  let list = store.matchResults
  if (keyword.value) {
    const kw = keyword.value.toLowerCase()
    list = list.filter(m => {
      const cand = store.candidateById(m.candidate_id)
      const job = store.jobById(m.job_id)
      return cand?.name.toLowerCase().includes(kw) || job?.title.toLowerCase().includes(kw)
    })
  }
  if (scoreMinFilter.value != null) list = list.filter(m => m.overall_score >= scoreMinFilter.value!)
  if (scoreMaxFilter.value != null) list = list.filter(m => m.overall_score <= scoreMaxFilter.value!)
  if (decisionFilter.value) list = list.filter(m => m.decision === decisionFilter.value)
  return [...list].sort((a, b) => b.matched_at.localeCompare(a.matched_at))
})

function fitTagType(level: FitLevel) {
  return { A: 'success', B: '', C: 'warning', D: 'danger' }[level] ?? 'info'
}

function decisionLabel(d: MatchDecision) {
  const map: Record<MatchDecision, string> = {
    pending_review: t('resumeScreening.statusLabels.decision.pending_review'),
    interview: t('resumeScreening.statusLabels.decision.interview'),
    hold: t('resumeScreening.statusLabels.decision.hold'),
    reject: t('resumeScreening.statusLabels.decision.reject'),
  }
  return map[d]
}
</script>

<template>
  <div class="history-page">
    <div class="page-header">
      <h2 class="page-title">{{ $t('resumeScreening.history.title') }}</h2>
    </div>

    <div class="filters">
      <el-input v-model="keyword" :placeholder="$t('resumeScreening.history.searchPlaceholder')" clearable style="width:240px" />
      <el-input-number v-model="scoreMinFilter" :min="0" :max="100" :placeholder="$t('resumeScreening.history.minScore')" />
      <el-input-number v-model="scoreMaxFilter" :min="0" :max="100" :placeholder="$t('resumeScreening.history.maxScore')" />
      <el-select v-model="decisionFilter" :placeholder="$t('resumeScreening.history.decision')" clearable style="width:120px">
        <el-option :label="$t('resumeScreening.statusLabels.decision.pending_review')" value="pending_review" />
        <el-option :label="$t('resumeScreening.statusLabels.decision.interview')" value="interview" />
        <el-option :label="$t('resumeScreening.statusLabels.decision.hold')" value="hold" />
        <el-option :label="$t('resumeScreening.statusLabels.decision.reject')" value="reject" />
      </el-select>
    </div>

    <el-table :data="filteredResults" :empty-text="$t('resumeScreening.history.noRecords')">
      <el-table-column :label="$t('resumeScreening.history.columns.time')" width="180">
        <template #default="{ row }">{{ row.matched_at }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.history.columns.candidate')" min-width="120">
        <template #default="{ row }">{{ store.candidateById(row.candidate_id)?.name ?? row.candidate_id }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.history.columns.job')" min-width="160">
        <template #default="{ row }">{{ store.jobById(row.job_id)?.title ?? row.job_id }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.history.columns.score')" width="80">
        <template #default="{ row }">{{ row.overall_score }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.history.columns.level')" width="80">
        <template #default="{ row }">
          <el-tag :type="fitTagType(row.fit_level)" size="small">{{ row.fit_level }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.history.columns.decision')" width="80">
        <template #default="{ row }">{{ decisionLabel(row.decision) }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.history.columns.subscores')" min-width="260">
        <template #default="{ row }">
          <span class="sub-score">{{ $t('resumeScreening.history.subLabels.skill') }}{{ row.score_breakdown.skill_score }}</span>
          <span class="sub-score">{{ $t('resumeScreening.history.subLabels.project') }}{{ row.score_breakdown.project_score }}</span>
          <span class="sub-score">{{ $t('resumeScreening.history.subLabels.industry') }}{{ row.score_breakdown.industry_score }}</span>
          <span class="sub-score">{{ $t('resumeScreening.history.subLabels.education') }}{{ row.score_breakdown.education_score }}</span>
          <span class="sub-score">{{ $t('resumeScreening.history.subLabels.constraint') }}{{ row.score_breakdown.constraint_score }}</span>
          <span class="sub-score">{{ $t('resumeScreening.history.subLabels.complete') }}{{ row.score_breakdown.completeness_score }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="decision_reason" :label="$t('resumeScreening.history.columns.reason')" min-width="200">
        <template #default="{ row }">{{ row.decision_reason || '-' }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 16px; }
.page-title { font-size: 20px; }
.filters { display: flex; gap: 12px; margin-bottom: 16px; }
.sub-score { display: inline-block; margin-right: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
