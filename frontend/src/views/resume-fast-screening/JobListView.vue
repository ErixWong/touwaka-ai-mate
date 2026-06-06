<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore, type Job, type JobStatus } from '@/stores/resume-screening'
import JobCreateEditView from './JobCreateEditView.vue'

const { t } = useI18n()
const store = useResumeScreeningStore()
const keyword = ref('')
const statusFilter = ref<JobStatus | ''>('')
const showCreate = ref(false)
const editingJob = ref<Job | null>(null)

const statusOptions = computed(() => [
  { label: t('resumeScreening.statusLabels.job.all'), value: '' },
  { label: t('resumeScreening.statusLabels.job.draft'), value: 'draft' },
  { label: t('resumeScreening.statusLabels.job.open'), value: 'open' },
  { label: t('resumeScreening.statusLabels.job.paused'), value: 'paused' },
  { label: t('resumeScreening.statusLabels.job.closed'), value: 'closed' },
])

const filteredJobs = computed(() => {
  let list = store.jobs
  if (keyword.value) {
    const kw = keyword.value.toLowerCase()
    list = list.filter(j => j.title.toLowerCase().includes(kw) || j.job_code.toLowerCase().includes(kw))
  }
  if (statusFilter.value) {
    list = list.filter(j => j.status === statusFilter.value)
  }
  return list
})

function statusLabel(s: JobStatus) {
  return t('resumeScreening.statusLabels.job.' + s) ?? s
}

function statusTagType(s: JobStatus) {
  return { draft: 'info', open: 'success', paused: 'warning', closed: 'danger' }[s] ?? 'info'
}

function matchCount(jobId: string) {
  return store.matchResultsByJob(jobId).length
}

function openCreate() {
  editingJob.value = null
  showCreate.value = true
}

function openEdit(job: Job) {
  editingJob.value = { ...job }
  showCreate.value = true
}

function onSaved(job: Job) {
  if (editingJob.value) {
    store.updateJob(job.id, job)
  } else {
    store.addJob(job)
  }
  showCreate.value = false
}

function transitionLabel(ts: JobStatus) {
  const map: Partial<Record<JobStatus, string>> = {
    open: 'resumeScreening.job.publish',
    paused: 'resumeScreening.job.pause',
    closed: 'resumeScreening.job.close',
  }
  return t(map[ts] ?? ts)
}

function changeStatus(job: Job, toStatus: JobStatus) {
  if (toStatus === 'open' && job.status === 'closed') return
  const updates: Partial<Job> = { status: toStatus }
  if (toStatus === 'open') updates.opened_at = new Date().toISOString()
  if (toStatus === 'closed') updates.closed_at = new Date().toISOString()
  store.updateJob(job.id, updates)
}

const transitions: Record<JobStatus, JobStatus[]> = {
  draft: ['open'],
  open: ['paused', 'closed'],
  paused: ['open', 'closed'],
  closed: [],
}
</script>

<template>
  <div class="job-list-page">
    <div class="page-header">
      <h2 class="page-title">{{ $t('resumeScreening.job.title') }}</h2>
      <el-button type="primary" @click="openCreate">{{ $t('resumeScreening.job.create') }}</el-button>
    </div>

    <div class="filters">
      <el-input v-model="keyword" :placeholder="$t('resumeScreening.job.searchPlaceholder')" clearable style="width:240px" />
      <el-select v-model="statusFilter" :placeholder="$t('resumeScreening.job.columns.status')">
        <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
    </div>

    <el-table :data="filteredJobs" style="width:100%" :empty-text="$t('resumeScreening.job.emptyText')">
      <el-table-column prop="title" :label="$t('resumeScreening.job.columns.name')" min-width="180" />
      <el-table-column prop="dept_name" :label="$t('resumeScreening.job.columns.dept')" width="140" />
      <el-table-column :label="$t('resumeScreening.job.columns.status')" width="100">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="location_city" :label="$t('resumeScreening.job.columns.city')" width="100" />
      <el-table-column :label="$t('resumeScreening.job.columns.pool')" width="80">
        <template #default="{ row }">{{ matchCount(row.id) }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.job.columns.actions')" width="280">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">{{ $t('resumeScreening.job.edit') }}</el-button>
          <template v-for="ts in transitions[(row as Job).status]" :key="ts">
            <el-button size="small" @click="changeStatus(row, ts)">
              {{ transitionLabel(ts) }}
            </el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      :model-value="showCreate"
      :title="editingJob ? $t('resumeScreening.job.editTitle') : $t('resumeScreening.job.createTitle')"
      width="680px"
      destroy-on-close
      @close="showCreate = false"
    >
      <JobCreateEditView
        v-if="showCreate"
        :job="editingJob"
        @save="onSaved"
        @cancel="showCreate = false"
      />
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 20px; }
.filters { display: flex; gap: 12px; margin-bottom: 16px; }
</style>
