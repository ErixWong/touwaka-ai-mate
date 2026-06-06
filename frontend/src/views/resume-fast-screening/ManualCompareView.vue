<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore, type MatchResult } from '@/stores/resume-screening'

const { t } = useI18n()
const props = defineProps<{ resumeId: string; candidateId: string }>()
const emit = defineEmits<{ done: [] }>()

const store = useResumeScreeningStore()
const candidate = computed(() => store.candidateById(props.candidateId))

const selectedJobId = ref('')
const overallScore = ref(0)
const decision = ref<'pending_review' | 'interview' | 'hold' | 'reject'>('pending_review')
const decisionReason = ref('')
const scoreBreakdown = reactive({
  skill_score: 0,
  project_score: 0,
  industry_score: 0,
  education_score: 0,
  constraint_score: 0,
  completeness_score: 0,
})

const openJobs = computed(() => store.jobs.filter(j => j.status === 'open'))
const selectedJob = computed(() => openJobs.value.find(j => j.id === selectedJobId.value))
const canSubmit = computed(() =>
  selectedJobId.value &&
  decisionReason.value.length >= 10 &&
  overallScore.value >= 0 && overallScore.value <= 100
)

const scoreMaxMap = { skill_score: 40, project_score: 25, industry_score: 10, education_score: 10, constraint_score: 10, completeness_score: 5 }

const scoreLabelMap: Record<string, string> = {
  skill_score: t('resumeScreening.compare.skillScore'),
  project_score: t('resumeScreening.compare.projectScore'),
  industry_score: t('resumeScreening.compare.industryScore'),
  education_score: t('resumeScreening.compare.educationScore'),
  constraint_score: t('resumeScreening.compare.constraintScore'),
  completeness_score: t('resumeScreening.compare.completenessScore'),
}

function recalcTotal() {
  overallScore.value =
    scoreBreakdown.skill_score +
    scoreBreakdown.project_score +
    scoreBreakdown.industry_score +
    scoreBreakdown.education_score +
    scoreBreakdown.constraint_score +
    scoreBreakdown.completeness_score
}

function fitLevel(score: number) {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  return 'D'
}

function submitCompare() {
  if (!canSubmit.value || !candidate.value) return
  const mr: MatchResult = {
    id: 'mr_' + Date.now(),
    job_id: selectedJobId.value,
    candidate_id: props.candidateId,
    overall_score: overallScore.value,
    fit_level: fitLevel(overallScore.value),
    score_breakdown: { ...scoreBreakdown },
    highlights: [],
    risks: [],
    evidence: [],
    decision: decision.value,
    decision_reason: decisionReason.value,
    matched_at: new Date().toISOString(),
  }
  store.addMatchResult(mr)
  emit('done')
}
</script>

<template>
  <div class="manual-compare">
    <div class="compare-top">
      <div class="job-select">
        <label>{{ $t('resumeScreening.compare.selectJob') }}</label>
        <el-select v-model="selectedJobId" :placeholder="$t('resumeScreening.compare.selectJobPlaceholder')" style="width:280px">
          <el-option v-for="j in openJobs" :key="j.id" :label="j.title" :value="j.id" />
        </el-select>
      </div>
    </div>

    <div v-if="selectedJob && candidate" class="compare-content">
      <div class="compare-panel jd-panel">
        <h4>{{ $t('resumeScreening.compare.jdTitle') }}{{ selectedJob.title }}</h4>
        <div class="jd-section">
          <div class="jd-label">{{ $t('resumeScreening.compare.mustSkills') }}</div>
          <div class="skill-tags">
            <el-tag v-for="s in selectedJob.must_have_skills" :key="s" type="danger" size="small">{{ s }}</el-tag>
          </div>
        </div>
        <div class="jd-section">
          <div class="jd-label">{{ $t('resumeScreening.compare.niceSkills') }}</div>
          <div class="skill-tags">
            <el-tag v-for="s in selectedJob.nice_to_have_skills" :key="s" type="success" size="small">{{ s }}</el-tag>
          </div>
        </div>
        <div class="jd-section">
          <div class="jd-label">{{ $t('resumeScreening.compare.minYears') }}{{ selectedJob.min_years_experience }}{{ $t('resumeScreening.compare.years') }}</div>
          <div class="jd-label">{{ $t('resumeScreening.compare.eduReq') }}{{ selectedJob.education_requirement || $t('common.none') }}</div>
          <div class="jd-label">{{ $t('resumeScreening.compare.location') }}{{ selectedJob.location_city }}</div>
        </div>
      </div>

      <div class="compare-panel candidate-panel">
        <h4>{{ $t('resumeScreening.compare.candidateTitle') }}{{ candidate.name }}</h4>
        <div class="cand-section">
          <div class="cand-label">{{ $t('resumeScreening.compare.current') }}{{ candidate.current_title }} @ {{ candidate.current_company }}</div>
          <div class="cand-label">{{ $t('resumeScreening.compare.totalYears') }}{{ candidate.total_years_experience }}{{ $t('resumeScreening.compare.years') }}</div>
          <div class="cand-label">{{ $t('resumeScreening.compare.education') }}{{ candidate.highest_education }} / {{ candidate.major }}</div>
          <div class="cand-label">{{ $t('resumeScreening.compare.location') }}{{ candidate.location_city }}</div>
        </div>
        <div class="cand-section">
          <div class="cand-label">{{ $t('resumeScreening.compare.skills') }}</div>
          <div class="skill-tags">
            <el-tag v-for="s in candidate.skills" :key="s" size="small">{{ s }}</el-tag>
          </div>
        </div>
      </div>

      <div class="compare-panel scoring-panel">
        <h4>{{ $t('resumeScreening.compare.scoringTitle') }}</h4>
        <div class="score-grid">
          <div v-for="(max, key) in scoreMaxMap" :key="key" class="score-item">
            <span class="score-label">{{ scoreLabelMap[key] }}</span>
            <el-slider v-model="scoreBreakdown[key]" :max="max" :step="1" show-input size="small" @input="recalcTotal" />
            <span class="score-max">/ {{ max }}</span>
          </div>
        </div>
        <div class="total-score">
          {{ $t('resumeScreening.compare.totalScore') }}<strong>{{ overallScore }}</strong>{{ $t('resumeScreening.compare.scoreOutOf') }}
          <el-tag :type="overallScore >= 85 ? 'success' : overallScore >= 70 ? '' : overallScore >= 55 ? 'warning' : 'danger'" size="small" style="margin-left:8px">
            {{ fitLevel(overallScore) }}{{ $t('resumeScreening.compare.level') }}
          </el-tag>
        </div>
      </div>

      <div class="compare-panel decision-panel">
        <h4>{{ $t('resumeScreening.compare.conclusion') }}</h4>
        <el-radio-group v-model="decision">
          <el-radio value="interview">{{ $t('resumeScreening.compare.interview') }}</el-radio>
          <el-radio value="hold">{{ $t('resumeScreening.compare.hold') }}</el-radio>
          <el-radio value="reject">{{ $t('resumeScreening.compare.reject') }}</el-radio>
        </el-radio-group>
        <div style="margin-top:12px">
          <el-input
            v-model="decisionReason"
            type="textarea"
            :rows="2"
            :placeholder="$t('resumeScreening.compare.reasonPlaceholder')"
            maxlength="500"
            show-word-limit
          />
        </div>
        <div class="decision-actions">
          <el-button @click="emit('done')">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" @click="submitCompare" :disabled="!canSubmit">
            {{ $t('resumeScreening.compare.submit') }}
          </el-button>
        </div>
      </div>
    </div>
    <div v-else class="empty-compare">
      {{ !candidate ? $t('resumeScreening.compare.noCandidate') : $t('resumeScreening.compare.noJob') }}
    </div>
  </div>
</template>

<style scoped>
.manual-compare { max-height: 75vh; overflow-y: auto; }
.compare-top { margin-bottom: 16px; }
.job-select { display: flex; align-items: center; gap: 8px; }
.compare-content { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.compare-panel { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 16px; }
.compare-panel h4 { margin: 0 0 12px; font-size: 14px; }
.scoring-panel, .decision-panel { grid-column: 1 / -1; }
.jd-section, .cand-section { margin-bottom: 12px; }
.jd-label, .cand-label { font-size: 13px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
.skill-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.score-grid { display: flex; flex-direction: column; gap: 8px; }
.score-item { display: flex; align-items: center; gap: 8px; }
.score-label { width: 50px; font-size: 13px; text-align: right; }
.score-item :deep(.el-slider) { flex: 1; }
.score-max { width: 36px; font-size: 12px; color: var(--el-text-color-secondary); }
.total-score { margin-top: 12px; font-size: 18px; text-align: center; }
.decision-panel { margin-top: 8px; }
.decision-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.empty-compare { text-align: center; padding: 40px; color: var(--el-text-color-secondary); }
</style>
