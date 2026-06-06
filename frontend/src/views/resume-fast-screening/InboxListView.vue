<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore, type ResumeParseStatus } from '@/stores/resume-screening'
import ManualCompareView from './ManualCompareView.vue'

const { t } = useI18n()
const store = useResumeScreeningStore()
const parseStatusFilter = ref<ResumeParseStatus | ''>('')
const keyword = ref('')
const showCompare = ref(false)
const compareTarget = ref<{ resumeId: string; candidateId: string; jobId: string } | null>(null)

const statusOptions = computed(() => [
  { label: t('resumeScreening.inbox.parseStatusAll'), value: '' },
  { label: t('resumeScreening.inbox.parsePending'), value: 'pending' },
  { label: t('resumeScreening.inbox.parseProcessing'), value: 'processing' },
  { label: t('resumeScreening.inbox.parseSuccess'), value: 'success' },
  { label: t('resumeScreening.inbox.parseFailed'), value: 'failed' },
  { label: t('resumeScreening.inbox.parseNeedsReview'), value: 'needs_review' },
])

const parsedResumes = computed(() => {
  let list = store.resumes.map(r => ({ ...r, candidate: store.candidateById(r.candidate_id) }))
  if (parseStatusFilter.value) list = list.filter(r => r.parse_status === parseStatusFilter.value)
  if (keyword.value) {
    const kw = keyword.value.toLowerCase()
    list = list.filter(r =>
      r.file_name.toLowerCase().includes(kw) ||
      r.candidate?.name.toLowerCase().includes(kw)
    )
  }
  return list
})

function statusLabel(s: ResumeParseStatus) {
  return t('resumeScreening.statusLabels.parse.' + s)
}

function statusTagType(s: ResumeParseStatus) {
  return { pending: 'info', processing: 'warning', success: 'success', failed: 'danger', needs_review: 'warning' }[s] ?? 'info'
}

function openManualCompare(resume: (typeof parsedResumes.value)[number]) {
  compareTarget.value = {
    resumeId: resume.id,
    candidateId: resume.candidate_id,
    jobId: '',
  }
  showCompare.value = true
}

function onCompareDone() {
  showCompare.value = false
  compareTarget.value = null
}
</script>

<template>
  <div class="inbox-page">
    <div class="page-header">
      <h2 class="page-title">{{ $t('resumeScreening.inbox.title') }}</h2>
    </div>

    <div class="filters">
      <el-input v-model="keyword" :placeholder="$t('resumeScreening.inbox.searchPlaceholder')" clearable style="width:240px" />
      <el-select v-model="parseStatusFilter">
        <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
    </div>

    <el-table :data="parsedResumes" :empty-text="$t('common.empty')">
      <el-table-column prop="file_name" :label="$t('resumeScreening.inbox.columns.fileName')" min-width="180" />
      <el-table-column :label="$t('resumeScreening.inbox.columns.candidate')" min-width="120">
        <template #default="{ row }">{{ row.candidate?.name ?? row.candidate_id }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.inbox.columns.parseStatus')" width="120">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.parse_status)" size="small">{{ statusLabel(row.parse_status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.inbox.columns.completeness')" width="100">
        <template #default="{ row }">
          <el-progress :percentage="row.candidate?.data_completeness_score ?? 0" :stroke-width="8" />
        </template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.inbox.columns.uploadTime')" width="180">
        <template #default="{ row }">{{ row.uploaded_at }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.inbox.columns.source')" width="100">
        <template #default="{ row }">{{ row.candidate?.source_channel ?? '-' }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="200">
        <template #default="{ row }">
          <el-button size="small" @click="openManualCompare(row)" :disabled="row.parse_status !== 'success'">
            {{ $t('resumeScreening.inbox.enterCompare') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      :model-value="showCompare"
      :title="$t('resumeScreening.inbox.enterCompare')"
      width="90%"
      top="2vh"
      destroy-on-close
      @close="onCompareDone"
    >
      <ManualCompareView
        v-if="showCompare && compareTarget"
        :resume-id="compareTarget.resumeId"
        :candidate-id="compareTarget.candidateId"
        @done="onCompareDone"
      />
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 16px; }
.page-title { font-size: 20px; }
.filters { display: flex; gap: 12px; margin-bottom: 16px; }
</style>
