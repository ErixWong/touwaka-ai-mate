<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore, type MatchDecision } from '@/stores/resume-screening'

const { t } = useI18n()

const props = defineProps<{ resultId: string }>()

const store = useResumeScreeningStore()
const result = computed(() => store.matchResults.find(m => m.id === props.resultId) ?? null)
const candidate = computed(() => result.value ? store.candidateById(result.value.candidate_id) : null)
const job = computed(() => result.value ? store.jobById(result.value.job_id) : null)

const newDecision = ref<MatchDecision | ''>('')
const feedbackText = ref('')

function applyFeedback() {
  if (result.value && newDecision.value) {
    store.updateMatchResult(result.value.id, { decision: newDecision.value as MatchDecision, decision_reason: feedbackText.value })
    newDecision.value = ''
    feedbackText.value = ''
  }
}

function scoreLabel(key: string, val: number) {
  const map: Record<string, string> = {
    skill_score: t('resumeScreening.compare.skillScore'),
    project_score: t('resumeScreening.compare.projectScore'),
    industry_score: t('resumeScreening.compare.industryScore'),
    education_score: t('resumeScreening.compare.educationScore'),
    constraint_score: t('resumeScreening.compare.constraintScore'),
    completeness_score: t('resumeScreening.compare.completenessScore'),
  }
  const maxMap: Record<string, number> = {
    skill_score: 40,
    project_score: 25,
    industry_score: 10,
    education_score: 10,
    constraint_score: 10,
    completeness_score: 5,
  }
  const label = map[key] ?? key
  const max = maxMap[key] ?? 100
  return { label, max, val, pct: Math.round((val / max) * 100) }
}
</script>

<template>
  <div v-if="result" class="result-detail">
    <div class="detail-header">
      <h3>{{ candidate?.name ?? result.candidate_id }} — {{ job?.title ?? result.job_id }}</h3>
      <div class="total-score">
        <span class="score-num">{{ result.overall_score }}</span>
        <span class="score-unit">{{ $t('resumeScreening.results.scoreUnit') }}</span>
        <el-tag :type="result.fit_level === 'A' ? 'success' : result.fit_level === 'B' ? '' : result.fit_level === 'C' ? 'warning' : 'danger'" size="small">
          {{ result.fit_level }}{{ $t('resumeScreening.compare.level') }}
        </el-tag>
      </div>
    </div>

    <div class="breakdown">
      <h4>{{ $t('resumeScreening.results.subtotalTitle') }}</h4>
      <div v-for="(info, key) in Object.entries(result.score_breakdown).map(([k, v]) => scoreLabel(k, v as number))" :key="key" class="score-bar-row">
        <span class="score-bar-label">{{ info.label }} ({{ info.val }}/{{ info.max }})</span>
        <el-progress :percentage="info.pct" :stroke-width="10" :color="info.pct >= 80 ? '#67c23a' : info.pct >= 60 ? '#409eff' : info.pct >= 40 ? '#e6a23c' : '#f56c6c'" />
      </div>
    </div>

    <div v-if="result.highlights.length" class="section">
      <h4>{{ $t('resumeScreening.results.highlights') }}</h4>
      <ul>
        <li v-for="h in result.highlights" :key="h">{{ h }}</li>
      </ul>
    </div>

    <div v-if="result.risks.length" class="section">
      <h4>{{ $t('resumeScreening.results.risks') }}</h4>
      <ul>
        <li v-for="r in result.risks" :key="r">{{ r }}</li>
      </ul>
    </div>

    <div v-if="result.evidence.length" class="section">
      <h4>{{ $t('resumeScreening.results.evidence') }}</h4>
      <ul>
        <li v-for="e in result.evidence" :key="e">{{ e }}</li>
      </ul>
    </div>

    <div class="section">
      <h4>{{ $t('resumeScreening.results.currentDecision') }}</h4>
      <p class="decision-display">
        <el-tag size="small">{{ t('resumeScreening.statusLabels.decision.' + result.decision) }}</el-tag>
        <span v-if="result.decision_reason">— {{ result.decision_reason }}</span>
      </p>
    </div>

    <div class="section feedback-section">
      <h4>{{ $t('resumeScreening.results.feedback') }}</h4>
      <div class="feedback-row">
        <el-select v-model="newDecision" :placeholder="$t('resumeScreening.results.updateDecision')" style="width:140px">
          <el-option :label="$t('resumeScreening.statusLabels.decision.interview')" value="interview" />
          <el-option :label="$t('resumeScreening.statusLabels.decision.hold')" value="hold" />
          <el-option :label="$t('resumeScreening.statusLabels.decision.reject')" value="reject" />
        </el-select>
        <el-input v-model="feedbackText" :placeholder="$t('resumeScreening.results.feedbackPlaceholder')" style="flex:1" />
        <el-button type="primary" @click="applyFeedback" :disabled="!newDecision">{{ $t('resumeScreening.results.submitFeedback') }}</el-button>
      </div>
    </div>
  </div>
  <div v-else class="not-found">{{ $t('resumeScreening.results.notFound') }}</div>
</template>

<style scoped>
.result-detail { padding: 4px 0; }
.detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.detail-header h3 { margin: 0; }
.total-score { display: flex; align-items: baseline; gap: 4px; }
.score-num { font-size: 28px; font-weight: 700; color: var(--el-color-primary); }
.score-unit { font-size: 14px; color: var(--el-text-color-secondary); }
.breakdown { margin-bottom: 16px; }
.breakdown h4, .section h4 { margin: 0 0 10px; font-size: 14px; }
.score-bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.score-bar-label { width: 140px; font-size: 13px; text-align: right; flex-shrink: 0; }
.score-bar-row :deep(.el-progress) { flex: 1; }
.section { margin-bottom: 16px; padding: 12px; background: var(--el-fill-color-lighter); border-radius: 6px; }
.section ul { margin: 0; padding-left: 20px; font-size: 13px; }
.section li { margin-bottom: 4px; }
.decision-display { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.feedback-row { display: flex; gap: 8px; align-items: center; }
.not-found { text-align: center; padding: 40px; color: var(--el-text-color-secondary); }
</style>
