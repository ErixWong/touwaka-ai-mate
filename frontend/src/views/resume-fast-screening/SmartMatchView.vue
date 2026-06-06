<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore, type MatchResult } from '@/stores/resume-screening'

const { t } = useI18n()
const store = useResumeScreeningStore()
const selectedJobId = ref('')
const mode = ref('fast')
const taskId = ref<string | null>(null)
const taskStatus = ref<'idle' | 'running' | 'done'>('idle')
const generatedResults = ref<MatchResult[]>([])

const openJobs = computed(() => store.jobs.filter(j => j.status === 'open'))

function startMatch() {
  if (!selectedJobId.value) return
  taskId.value = 'task_' + Date.now()
  taskStatus.value = 'running'

  // Simulate automatic matching for demo
  setTimeout(() => {
    const job = store.jobById(selectedJobId.value)
    if (!job) {
      taskStatus.value = 'idle'
      return
    }

    const results: MatchResult[] = []
    const candidates = store.candidates.filter(c => c.status === 'active' || c.status === 'new')

    for (const cand of candidates) {
      const skillOverlap = cand.skills.filter(s => job.must_have_skills.includes(s)).length / Math.max(job.must_have_skills.length, 1)
      const niceOverlap = cand.skills.filter(s => job.nice_to_have_skills.includes(s)).length / Math.max(job.nice_to_have_skills.length, 1)
      const skillScore = Math.round(skillOverlap * 40)
      const projectScore = Math.round(Math.min(cand.total_years_experience / Math.max(job.min_years_experience || 3, 1) * 25, 25))
      const industryScore = Math.round((0.5 + niceOverlap * 0.5) * 10)
      const educationScore = cand.highest_education ? 8 : 5
      const constraintScore = Math.round(Math.min(cand.total_years_experience / Math.max(job.min_years_experience || 1, 1) * 10, 10))
      const completenessScore = Math.round(cand.data_completeness_score / 100 * 5)
      const overallScore = skillScore + projectScore + industryScore + educationScore + constraintScore + completenessScore

      results.push({
        id: 'mr_auto_' + Date.now() + '_' + cand.id,
        job_id: job.id,
        candidate_id: cand.id,
        overall_score: overallScore,
        fit_level: overallScore >= 85 ? 'A' : overallScore >= 70 ? 'B' : overallScore >= 55 ? 'C' : 'D',
        score_breakdown: { skill_score: skillScore, project_score: projectScore, industry_score: industryScore, education_score: educationScore, constraint_score: constraintScore, completeness_score: completenessScore },
        highlights: [skillScore >= 32 ? t('resumeScreening.match.highlights.skillHighMatch') : t('resumeScreening.match.highlights.skillBasicMatch')],
        risks: overallScore < 70 ? [t('resumeScreening.statusLabels.decision.pending_review')] : [],
        evidence: [`${t('resumeScreening.compare.skillScore')}${Math.round(skillOverlap * 100)}%`],
        decision: 'pending_review',
        decision_reason: t('resumeScreening.statusLabels.decision.pending_review'),
        matched_at: new Date().toISOString(),
      })
    }

    generatedResults.value = results.sort((a, b) => b.overall_score - a.overall_score)
    taskStatus.value = 'done'
  }, 3000)
}

function commitResults() {
  const existingKeys = new Set(store.matchResults.map(m => `${m.job_id}:${m.candidate_id}`))
  for (const r of generatedResults.value) {
    if (existingKeys.has(`${r.job_id}:${r.candidate_id}`)) continue
    existingKeys.add(`${r.job_id}:${r.candidate_id}`)
    store.addMatchResult(r)
  }
  generatedResults.value = []
  taskStatus.value = 'idle'
  selectedJobId.value = ''
}
</script>

<template>
  <div class="smart-match">
    <div class="page-header">
      <h2 class="page-title">{{ $t('resumeScreening.match.title') }}</h2>
    </div>

    <div class="match-form">
      <div class="form-row">
        <label>{{ $t('resumeScreening.match.selectJob') }}</label>
        <el-select v-model="selectedJobId" :placeholder="$t('resumeScreening.compare.selectJobPlaceholder')" style="width:320px" :disabled="taskStatus === 'running'">
          <el-option v-for="j in openJobs" :key="j.id" :label="j.title" :value="j.id" />
        </el-select>
      </div>
      <div class="form-row">
        <label>{{ $t('resumeScreening.match.mode') }}</label>
        <el-radio-group v-model="mode" :disabled="taskStatus === 'running'">
          <el-radio value="fast">{{ $t('resumeScreening.match.modeFast') }}</el-radio>
          <el-radio value="precise">{{ $t('resumeScreening.match.modePrecise') }}</el-radio>
        </el-radio-group>
      </div>
      <el-button
        type="primary"
        :disabled="!selectedJobId || taskStatus === 'running'"
        :loading="taskStatus === 'running'"
        @click="startMatch"
      >
        {{ taskStatus === 'running' ? $t('resumeScreening.match.matching') : $t('resumeScreening.match.startMatch') }}
      </el-button>
    </div>

    <div v-if="generatedResults.length > 0" class="match-results">
      <div class="results-header">
        <h4>{{ $t('resumeScreening.match.resultsTitle') }}{{ generatedResults.length }})</h4>
        <el-button type="success" @click="commitResults">{{ $t('resumeScreening.match.commitAll') }}</el-button>
      </div>
      <el-table :data="generatedResults">
        <el-table-column :label="$t('resumeScreening.match.columns.candidate')" min-width="120">
          <template #default="{ row }">{{ store.candidateById(row.candidate_id)?.name ?? row.candidate_id }}</template>
        </el-table-column>
        <el-table-column :label="$t('resumeScreening.match.columns.score')" width="80">
          <template #default="{ row }">
            <strong :style="{ color: row.overall_score >= 85 ? '#67c23a' : row.overall_score >= 70 ? '#409eff' : row.overall_score >= 55 ? '#e6a23c' : '#f56c6c' }">
              {{ row.overall_score }}
            </strong>
          </template>
        </el-table-column>
        <el-table-column :label="$t('resumeScreening.match.columns.level')" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.fit_level === 'A' ? 'success' : row.fit_level === 'B' ? '' : row.fit_level === 'C' ? 'warning' : 'danger'">
              {{ row.fit_level }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('resumeScreening.match.columns.skill')" width="60">
          <template #default="{ row }">{{ row.score_breakdown.skill_score }}</template>
        </el-table-column>
        <el-table-column :label="$t('resumeScreening.match.columns.project')" width="60">
          <template #default="{ row }">{{ row.score_breakdown.project_score }}</template>
        </el-table-column>
        <el-table-column :label="$t('resumeScreening.match.columns.industry')" width="60">
          <template #default="{ row }">{{ row.score_breakdown.industry_score }}</template>
        </el-table-column>
        <el-table-column :label="$t('resumeScreening.match.columns.education')" width="60">
          <template #default="{ row }">{{ row.score_breakdown.education_score }}</template>
        </el-table-column>
        <el-table-column :label="$t('resumeScreening.match.columns.highlight')" min-width="200">
          <template #default="{ row }">{{ row.highlights?.[0] ?? '-' }}</template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 20px; }
.page-title { font-size: 20px; }
.match-form { padding: 24px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-lighter); }
.form-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.form-row label { width: 80px; font-size: 14px; color: var(--el-text-color-regular); }
.match-results { margin-top: 24px; }
.results-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.results-header h4 { margin: 0; font-size: 15px; }
</style>
