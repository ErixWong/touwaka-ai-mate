<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResumeScreeningStore, type CandidateExperience, type CandidateEducation } from '@/stores/resume-screening'

const { t } = useI18n()

const props = defineProps<{ candidateId: string }>()
const store = useResumeScreeningStore()

const candidate = computed(() => store.candidateById(props.candidateId))
const exps = computed(() => store.experiencesByCandidate(props.candidateId))
const edus = computed(() => store.educationsByCandidate(props.candidateId))
const res = computed(() => store.resumesByCandidate(props.candidateId))
const mrs = computed(() => store.matchResultsByCandidate(props.candidateId))

const activeTab = ref('info')

const showExpForm = ref(false)
const editingExp = ref<CandidateExperience | null>(null)
const expForm = ref<Partial<CandidateExperience>>({})

const showEduForm = ref(false)
const editingEdu = ref<CandidateEducation | null>(null)
const eduForm = ref<Partial<CandidateEducation>>({})

function openExpForm(exp?: CandidateExperience) {
  if (exp) {
    editingExp.value = exp
    expForm.value = { ...exp }
  } else {
    editingExp.value = null
    expForm.value = {
      id: 'exp_' + Date.now(),
      candidate_id: props.candidateId,
      project_name: '',
      role: '',
      start_date: '',
      end_date: null,
      is_current: false,
      description: '',
      responsibilities: [],
      tech_stack: [],
      industry_tags: [],
      team_size: 0,
      outcome: '',
    }
  }
  showExpForm.value = true
}

function saveExp() {
  if (editingExp.value) {
    store.updateExperience(editingExp.value.id, expForm.value as CandidateExperience)
  } else {
    store.addExperience(expForm.value as CandidateExperience)
  }
  showExpForm.value = false
}

function removeExp(id: string) {
  store.deleteExperience(id)
}

function openEduForm(edu?: CandidateEducation) {
  if (edu) {
    editingEdu.value = edu
    eduForm.value = { ...edu }
  } else {
    editingEdu.value = null
    eduForm.value = {
      id: 'edu_' + Date.now(),
      candidate_id: props.candidateId,
      school_name: '',
      degree: '',
      major: '',
      start_date: '',
      end_date: '',
      gpa: '',
      courses: [],
      honors: [],
    }
  }
  showEduForm.value = true
}

function saveEdu() {
  if (editingEdu.value) {
    store.updateEducation(editingEdu.value.id, eduForm.value as CandidateEducation)
  } else {
    store.addEducation(eduForm.value as CandidateEducation)
  }
  showEduForm.value = false
}

function removeEdu(id: string) {
  store.deleteEducation(id)
}
</script>

<template>
  <div v-if="candidate" class="talent-detail">
    <el-tabs v-model="activeTab">
      <el-tab-pane :label="t('resumeScreening.talent.tab.info')" name="info">
        <div class="info-grid">
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.name') }}</label><span>{{ candidate.name }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.email') }}</label><span>{{ candidate.email }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.phone') }}</label><span>{{ candidate.phone }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.city') }}</label><span>{{ candidate.location_city }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.company') }}</label><span>{{ candidate.current_company }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.title') }}</label><span>{{ candidate.current_title }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.years') }}</label><span>{{ candidate.total_years_experience }}{{ t('resumeScreening.compare.years') }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.edu') }}</label><span>{{ candidate.highest_education }} / {{ candidate.major }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.targetRoles') }}</label><span>{{ candidate.target_roles?.join('、') }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.targetSalary') }}</label><span>{{ candidate.salary_currency }} {{ candidate.target_salary_min }}-{{ candidate.target_salary_max }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.status') }}</label>
            <el-tag size="small">{{ t('resumeScreening.statusLabels.candidate.' + candidate.status) }}</el-tag>
          </div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.source') }}</label><span>{{ candidate.source_channel }}</span></div>
          <div class="info-item"><label>{{ t('resumeScreening.talent.info.completeness') }}</label>
            <el-progress :percentage="candidate.data_completeness_score" :stroke-width="8" style="width:120px" />
          </div>
          <div class="info-item full-width"><label>{{ t('resumeScreening.talent.info.skills') }}</label>
            <span class="skill-tags">
              <el-tag v-for="s in candidate.skills" :key="s" size="small">{{ s }}</el-tag>
            </span>
          </div>
          <div class="info-item full-width"><label>{{ t('resumeScreening.talent.info.languages') }}</label>
            <span>{{ candidate.languages?.join('、') }}</span>
          </div>
          <div class="info-item full-width"><label>{{ t('resumeScreening.talent.info.summary') }}</label><span>{{ candidate.profile_summary }}</span></div>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('resumeScreening.talent.tab.experiences')" name="experiences">
        <div class="tab-header">
          <el-button size="small" type="primary" @click="openExpForm()">{{ t('resumeScreening.talent.addExp') }}</el-button>
        </div>
        <div v-if="exps.length === 0" class="empty-tab">{{ t('resumeScreening.talent.noExp') }}</div>
        <div v-for="exp in exps" :key="exp.id" class="exp-card">
          <div class="exp-header">
            <strong>{{ exp.project_name }}</strong>
            <span class="exp-role">{{ exp.role }}</span>
            <span class="exp-date">{{ exp.start_date }}{{ t('resumeScreening.talent.dateRange') }}{{ exp.end_date ?? t('resumeScreening.talent.toNow') }}</span>
            <div class="exp-actions">
              <el-button size="small" text @click="openExpForm(exp)">{{ t('common.edit') }}</el-button>
              <el-button size="small" text type="danger" @click="removeExp(exp.id)">{{ t('common.delete') }}</el-button>
            </div>
          </div>
          <p class="exp-desc">{{ exp.description }}</p>
          <div class="exp-tags">
            <el-tag v-for="t in exp.tech_stack" :key="t" size="small" type="info">{{ t }}</el-tag>
          </div>
          <div class="exp-outcome" v-if="exp.outcome">{{ t('resumeScreening.talent.outcome') }}{{ exp.outcome }}</div>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('resumeScreening.talent.tab.educations')" name="educations">
        <div class="tab-header">
          <el-button size="small" type="primary" @click="openEduForm()">{{ t('resumeScreening.talent.addEdu') }}</el-button>
        </div>
        <div v-if="edus.length === 0" class="empty-tab">{{ t('resumeScreening.talent.noEdu') }}</div>
        <div v-for="edu in edus" :key="edu.id" class="edu-card">
          <div class="edu-header">
            <strong>{{ edu.school_name }}</strong>
            <span>{{ edu.degree }} / {{ edu.major }}</span>
            <span class="edu-date">{{ edu.start_date }}{{ t('resumeScreening.talent.dateRange') }}{{ edu.end_date }}</span>
            <div class="edu-actions">
              <el-button size="small" text @click="openEduForm(edu)">{{ t('common.edit') }}</el-button>
              <el-button size="small" text type="danger" @click="removeEdu(edu.id)">{{ t('common.delete') }}</el-button>
            </div>
          </div>
          <div v-if="edu.gpa">GPA: {{ edu.gpa }}</div>
          <div v-if="edu.honors?.length" class="edu-honors">
            {{ t('resumeScreening.talent.honors') }}{{ edu.honors.join('、') }}
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('resumeScreening.talent.tab.resumes')" name="resumes">
        <div v-if="res.length === 0" class="empty-tab">{{ t('resumeScreening.talent.noResume') }}</div>
        <div v-for="r in res" :key="r.id" class="resume-item">
          <span>{{ r.file_name }} ({{ r.file_type }})</span>
          <el-tag size="small" :type="r.parse_status === 'success' ? 'success' : 'warning'">
            {{ t('resumeScreening.statusLabels.parse.' + r.parse_status) }}
          </el-tag>
          <span class="resume-attachment">attachment_id: {{ r.attachment_id }}</span>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('resumeScreening.talent.tab.matches')" name="matches">
        <div v-if="mrs.length === 0" class="empty-tab">{{ t('resumeScreening.talent.noMatches') }}</div>
        <div v-for="mr in mrs" :key="mr.id" class="match-item">
          <span>{{ store.jobById(mr.job_id)?.title ?? mr.job_id }}</span>
          <el-tag size="small" :type="mr.fit_level === 'A' ? 'success' : mr.fit_level === 'B' ? '' : 'warning'">
            {{ mr.fit_level }}{{ t('resumeScreening.compare.level') }}{{ t('resumeScreening.talent.dateRange') }}{{ mr.overall_score }}{{ t('resumeScreening.results.scoreUnit') }}
          </el-tag>
          <span>{{ t('resumeScreening.statusLabels.decision.' + mr.decision) }}</span>
          <span class="match-time">{{ mr.matched_at }}</span>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog :model-value="showExpForm" :title="t('resumeScreening.talent.tab.experiences')" width="560px" @close="showExpForm = false">
      <el-form v-if="showExpForm" label-width="80px">
        <el-form-item label="项目名称"><el-input v-model="expForm.project_name" /></el-form-item>
        <el-form-item label="角色"><el-input v-model="expForm.role" /></el-form-item>
        <el-form-item label="开始日期"><el-input v-model="expForm.start_date" type="date" /></el-form-item>
        <el-form-item label="结束日期"><el-input v-model="expForm.end_date" type="date" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="expForm.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="成果"><el-input v-model="expForm.outcome" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showExpForm = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveExp">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog :model-value="showEduForm" :title="t('resumeScreening.talent.tab.educations')" width="560px" @close="showEduForm = false">
      <el-form v-if="showEduForm" label-width="80px">
        <el-form-item label="学校"><el-input v-model="eduForm.school_name" /></el-form-item>
        <el-form-item label="学历"><el-input v-model="eduForm.degree" /></el-form-item>
        <el-form-item label="专业"><el-input v-model="eduForm.major" /></el-form-item>
        <el-form-item label="开始日期"><el-input v-model="eduForm.start_date" type="date" /></el-form-item>
        <el-form-item label="结束日期"><el-input v-model="eduForm.end_date" type="date" /></el-form-item>
        <el-form-item label="GPA"><el-input v-model="eduForm.gpa" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEduForm = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveEdu">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
  <div v-else class="not-found">{{ t('resumeScreening.talent.notFound') }}</div>
</template>

<style scoped>
.talent-detail { padding: 0; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.info-item { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; }
.info-item label { min-width: 70px; color: var(--el-text-color-secondary); flex-shrink: 0; }
.full-width { grid-column: 1 / -1; }
.skill-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.tab-header { margin-bottom: 12px; }
.empty-tab { text-align: center; padding: 32px; color: var(--el-text-color-placeholder); }
.exp-card, .edu-card { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 12px; margin-bottom: 10px; }
.exp-header, .edu-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.exp-role, .edu-date { color: var(--el-text-color-secondary); font-size: 12px; }
.exp-actions, .edu-actions { margin-left: auto; display: flex; gap: 4px; }
.exp-desc { margin: 8px 0; font-size: 13px; }
.exp-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.exp-outcome, .edu-honors { margin-top: 6px; font-size: 13px; color: var(--el-color-success); }
.resume-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-extra-light); font-size: 13px; }
.resume-attachment { color: var(--el-text-color-placeholder); font-size: 12px; }
.match-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-extra-light); font-size: 13px; }
.match-time { color: var(--el-text-color-placeholder); font-size: 12px; margin-left: auto; }
.not-found { text-align: center; padding: 40px; color: var(--el-text-color-secondary); }
</style>
