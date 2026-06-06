<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore, type CandidateStatus } from '@/stores/resume-screening'
import TalentDetailView from './TalentDetailView.vue'

const { t } = useI18n()
const store = useResumeScreeningStore()
const keyword = ref('')
const statusFilter = ref<CandidateStatus | ''>('')
const showingDetail = ref(false)
const detailCandidateId = ref('')

const statusOptions = computed(() => [
  { label: t('resumeScreening.talent.statusAll'), value: '' },
  { label: t('resumeScreening.talent.statusNew'), value: 'new' },
  { label: t('resumeScreening.talent.statusActive'), value: 'active' },
  { label: t('resumeScreening.talent.statusOnHold'), value: 'on_hold' },
  { label: t('resumeScreening.talent.statusHired'), value: 'hired' },
  { label: t('resumeScreening.talent.statusArchived'), value: 'archived' },
])

const filteredCandidates = computed(() => {
  let list = store.candidates
  if (keyword.value) {
    const kw = keyword.value.toLowerCase()
    list = list.filter(c =>
      c.name.toLowerCase().includes(kw) ||
      c.skills.some(s => s.toLowerCase().includes(kw)) ||
      c.current_title.toLowerCase().includes(kw)
    )
  }
  if (statusFilter.value) list = list.filter(c => c.status === statusFilter.value)
  return list
})

function statusLabel(s: CandidateStatus) {
  return t('resumeScreening.statusLabels.candidate.' + s)
}

function openDetail(id: string) {
  detailCandidateId.value = id
  showingDetail.value = true
}

function matchCount(candidateId: string) {
  return store.matchResultsByCandidate(candidateId).length
}
</script>

<template>
  <div class="talent-page">
    <div class="page-header">
      <h2 class="page-title">{{ $t('resumeScreening.talent.title') }}</h2>
    </div>

    <div class="filters">
      <el-input v-model="keyword" :placeholder="$t('resumeScreening.talent.searchPlaceholder')" clearable style="width:280px" />
      <el-select v-model="statusFilter">
        <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
    </div>

    <el-table :data="filteredCandidates" :empty-text="$t('common.empty')">
      <el-table-column prop="name" :label="$t('resumeScreening.talent.columns.name')" min-width="100" />
      <el-table-column prop="current_title" :label="$t('resumeScreening.talent.columns.title')" min-width="140" />
      <el-table-column prop="total_years_experience" :label="$t('resumeScreening.talent.columns.years')" width="80" />
      <el-table-column :label="$t('resumeScreening.talent.columns.targetRoles')" min-width="160">
        <template #default="{ row }">{{ row.target_roles?.join('、') ?? '-' }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.talent.columns.status')" width="80">
        <template #default="{ row }">{{ statusLabel(row.status) }}</template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.talent.columns.completeness')" width="120">
        <template #default="{ row }">
          <el-progress :percentage="row.data_completeness_score" :stroke-width="8" />
        </template>
      </el-table-column>
      <el-table-column :label="$t('resumeScreening.talent.columns.matchCount')" width="80">
        <template #default="{ row }">{{ matchCount(row.id) }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="120">
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row.id)">{{ $t('resumeScreening.talent.detail') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      :model-value="showingDetail"
      :title="$t('resumeScreening.talent.detail')"
      size="720px"
      destroy-on-close
      @close="showingDetail = false"
    >
      <TalentDetailView v-if="showingDetail" :candidate-id="detailCandidateId" />
    </el-drawer>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 16px; }
.page-title { font-size: 20px; }
.filters { display: flex; gap: 12px; margin-bottom: 16px; }
</style>
