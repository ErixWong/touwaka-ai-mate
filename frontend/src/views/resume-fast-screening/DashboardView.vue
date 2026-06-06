<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore } from '@/stores/resume-screening'

const { t } = useI18n()
const store = useResumeScreeningStore()
const stats = computed(() => store.dashboardStats)
const openJobs = computed(() => store.jobs.filter(j => j.status === 'open'))
const recentMatches = computed(() =>
  [...store.matchResults].sort((a, b) => b.matched_at.localeCompare(a.matched_at)).slice(0, 5)
)

const i18nFunnel = computed(() => {
  const labels = [
    t('resumeScreening.dashboard.funnelSubmitted'),
    t('resumeScreening.dashboard.funnelParsed'),
    t('resumeScreening.dashboard.funnelShortlisted'),
    t('resumeScreening.dashboard.funnelInterview'),
    t('resumeScreening.dashboard.funnelOffer'),
  ]
  return stats.value.funnel.map((item, i) => ({
    count: item.count,
    label: labels[i] ?? item.label,
  }))
})

function fitLabel(level: string) {
  return (
    {
      A: t('resumeScreening.statusLabels.fitLevel.A'),
      B: t('resumeScreening.statusLabels.fitLevel.B'),
      C: t('resumeScreening.statusLabels.fitLevel.C'),
      D: t('resumeScreening.statusLabels.fitLevel.D'),
    }[level] ?? level
  )
}

function fitColor(level: string) {
  return { A: '#67c23a', B: '#409eff', C: '#e6a23c', D: '#f56c6c' }[level] ?? '#909399'
}
</script>

<template>
  <div class="dashboard">
    <h2 class="page-title">{{ $t('resumeScreening.dashboard.title') }}</h2>

    <section class="stat-cards">
      <div class="stat-card">
        <div class="stat-icon">📝</div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.pendingParseResumes }}</span>
          <span class="stat-label">{{ $t('resumeScreening.dashboard.pendingParse') }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🔍</div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.pendingManualCompare }}</span>
          <span class="stat-label">{{ $t('resumeScreening.dashboard.pendingCompare') }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⏳</div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.pendingAutoResults }}</span>
          <span class="stat-label">{{ $t('resumeScreening.dashboard.pendingResults') }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⚡</div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.avgProcessTime }}{{ $t('resumeScreening.dashboard.minUnit') }}</span>
          <span class="stat-label">{{ $t('resumeScreening.dashboard.avgTime') }}</span>
        </div>
      </div>
    </section>

    <div class="dashboard-grid">
      <section class="panel">
        <h3>{{ $t('resumeScreening.dashboard.funnel') }}</h3>
        <div class="funnel">
          <div v-for="(item, idx) in i18nFunnel" :key="idx" class="funnel-row">
            <span class="funnel-label">{{ item.label }}</span>
            <div class="funnel-bar-wrap">
              <div class="funnel-bar" :style="{ width: Math.max((item.count / (i18nFunnel[0]?.count || 1)) * 100, 2) + '%' }" />
            </div>
            <span class="funnel-count">{{ item.count }}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <h3>{{ $t('resumeScreening.dashboard.activeJobs') }}</h3>
        <div v-if="openJobs.length === 0" class="empty-hint">{{ $t('resumeScreening.dashboard.noActiveJobs') }}</div>
        <ul v-else class="job-list">
          <li v-for="job in openJobs" :key="job.id" class="job-item">
            <span class="job-title">{{ job.title }}</span>
            <span class="job-dept">{{ job.dept_name }}</span>
            <el-tag size="small" type="success">Open</el-tag>
          </li>
        </ul>
      </section>

      <section class="panel">
        <h3>{{ $t('resumeScreening.dashboard.quality') }}</h3>
        <div class="quality-metrics">
          <div class="metric-row">
            <span>{{ $t('resumeScreening.dashboard.top10Rate') }}</span>
            <strong>{{ stats.top10AcceptRate }}%</strong>
          </div>
          <div class="metric-row">
            <span>{{ $t('resumeScreening.dashboard.parseFailRate') }}</span>
            <strong>{{ stats.parseFailRate }}%</strong>
          </div>
          <div class="metric-row">
            <span>{{ $t('resumeScreening.dashboard.avgProcess') }}</span>
            <strong>{{ stats.avgProcessTime }}{{ $t('resumeScreening.dashboard.minutes') }}</strong>
          </div>
        </div>
      </section>

      <section class="panel">
        <h3>{{ $t('resumeScreening.dashboard.recentMatches') }}</h3>
        <div v-if="recentMatches.length === 0" class="empty-hint">{{ $t('resumeScreening.dashboard.noMatches') }}</div>
        <ul v-else class="match-list">
          <li v-for="mr in recentMatches" :key="mr.id" class="match-item">
            <span class="match-candidate">{{ store.candidateById(mr.candidate_id)?.name ?? mr.candidate_id }}</span>
            <el-tag size="small" :color="fitColor(mr.fit_level)" style="color:#fff">{{ fitLabel(mr.fit_level) }}</el-tag>
            <span class="match-score">{{ mr.overall_score }}{{ $t('resumeScreening.dashboard.score') }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dashboard { max-width: 1200px; }
.page-title { margin-bottom: 20px; font-size: 20px; }

.stat-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card { display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 8px; background: var(--el-fill-color-lighter, #f5f7fa); }
.stat-icon { font-size: 28px; }
.stat-info { display: flex; flex-direction: column; }
.stat-value { font-size: 24px; font-weight: 700; color: var(--el-color-primary, #409eff); }
.stat-label { font-size: 13px; color: var(--el-text-color-secondary, #909399); }

.dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.panel { padding: 16px; border-radius: 8px; border: 1px solid var(--el-border-color-lighter, #ebeef5); }
.panel h3 { margin: 0 0 12px; font-size: 15px; }

.funnel-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.funnel-label { width: 72px; font-size: 13px; color: var(--el-text-color-secondary); }
.funnel-bar-wrap { flex: 1; height: 20px; background: var(--el-fill-color, #f0f2f5); border-radius: 4px; overflow: hidden; }
.funnel-bar { height: 100%; background: var(--el-color-primary, #409eff); border-radius: 4px; transition: width .3s; }
.funnel-count { width: 32px; text-align: right; font-size: 13px; font-weight: 500; }

.job-list, .match-list { list-style: none; padding: 0; margin: 0; }
.job-item, .match-item { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--el-border-color-extra-light); font-size: 13px; }
.job-item:last-child, .match-item:last-child { border-bottom: none; }
.job-title, .match-candidate { flex: 1; }
.job-dept { color: var(--el-text-color-secondary); }

.quality-metrics { display: flex; flex-direction: column; gap: 8px; }
.metric-row { display: flex; justify-content: space-between; font-size: 13px; }
.metric-row strong { color: var(--el-color-primary); }

.match-score { color: var(--el-text-color-secondary); font-size: 12px; }

.empty-hint { color: var(--el-text-color-placeholder); font-size: 13px; text-align: center; padding: 24px 0; }
</style>
