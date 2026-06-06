<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Job } from '@/stores/resume-screening'

const { t } = useI18n()

const props = defineProps<{ job: Job | null }>()
const emit = defineEmits<{ save: [job: Job]; cancel: [] }>()

const isEdit = !!props.job

const form = reactive<Job>(props.job ?? {
  id: 'job_' + Date.now(),
  job_code: '',
  title: '',
  dept_name: '',
  employment_type: 'full_time',
  work_mode: 'onsite',
  location_city: '',
  description_md: '',
  must_have_skills: [],
  nice_to_have_skills: [],
  min_years_experience: 0,
  education_requirement: '',
  status: 'draft',
  owner_user_id: 'user_hr_001',
  opened_at: null,
  closed_at: null,
})

const mustSkillInput = ref('')
const niceSkillInput = ref('')

const titleError = ref('')
const mustSkillError = ref('')

const employmentTypeOptions = computed(() => [
  { label: t('resumeScreening.job.empFullTime'), value: 'full_time' },
  { label: t('resumeScreening.job.empPartTime'), value: 'part_time' },
  { label: t('resumeScreening.job.empIntern'), value: 'intern' },
  { label: t('resumeScreening.job.empContract'), value: 'contract' },
])

const workModeOptions = computed(() => [
  { label: t('resumeScreening.job.workOnsite'), value: 'onsite' },
  { label: t('resumeScreening.job.workHybrid'), value: 'hybrid' },
  { label: t('resumeScreening.job.workRemote'), value: 'remote' },
])

function addMustSkill() {
  const v = mustSkillInput.value.trim()
  if (v && !form.must_have_skills.includes(v)) {
    form.must_have_skills.push(v)
    mustSkillInput.value = ''
    mustSkillError.value = ''
  }
}

function removeMustSkill(idx: number) {
  form.must_have_skills.splice(idx, 1)
}

function addNiceSkill() {
  const v = niceSkillInput.value.trim()
  if (v && !form.nice_to_have_skills.includes(v)) {
    form.nice_to_have_skills.push(v)
    niceSkillInput.value = ''
  }
}

function removeNiceSkill(idx: number) {
  form.nice_to_have_skills.splice(idx, 1)
}

function handleSave(publish = false) {
  titleError.value = ''
  mustSkillError.value = ''

  if (!form.title || form.title.length < 2 || form.title.length > 128) {
    titleError.value = t('resumeScreening.job.titleError')
    return
  }
  if (form.must_have_skills.length === 0) {
    mustSkillError.value = t('resumeScreening.job.mustSkillError')
    return
  }
  if (publish) form.status = 'open'
  emit('save', { ...form })
}
</script>

<template>
  <div class="job-form">
    <el-form label-width="100px">
      <el-form-item :label="$t('resumeScreening.job.name')" :error="titleError" required>
        <el-input v-model="form.title" maxlength="128" :placeholder="$t('resumeScreening.job.namePlaceholder')" />
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.code')" required>
        <el-input v-model="form.job_code" :placeholder="$t('resumeScreening.job.codePlaceholder')" :disabled="isEdit" />
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.dept')">
        <el-input v-model="form.dept_name" :placeholder="$t('resumeScreening.job.deptPlaceholder')" />
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.empType')">
        <el-select v-model="form.employment_type">
          <el-option v-for="o in employmentTypeOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.workMode')">
        <el-select v-model="form.work_mode">
          <el-option v-for="o in workModeOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.city')">
        <el-input v-model="form.location_city" :placeholder="$t('resumeScreening.job.cityPlaceholder')" />
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.minYears')">
        <el-input-number v-model="form.min_years_experience" :min="0" :max="30" />
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.eduReq')">
        <el-input v-model="form.education_requirement" :placeholder="$t('resumeScreening.job.eduReqPlaceholder')" />
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.mustSkills')" :error="mustSkillError" required>
        <div class="skill-input-row">
          <el-input v-model="mustSkillInput" :placeholder="$t('resumeScreening.job.mustSkillPlaceholder')" @keyup.enter="addMustSkill" style="flex:1" />
        </div>
        <div class="skill-tags">
          <el-tag v-for="(s, i) in form.must_have_skills" :key="i" closable @close="removeMustSkill(i)" type="danger">{{ s }}</el-tag>
        </div>
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.niceSkills')">
        <div class="skill-input-row">
          <el-input v-model="niceSkillInput" :placeholder="$t('resumeScreening.job.niceSkillPlaceholder')" @keyup.enter="addNiceSkill" style="flex:1" />
        </div>
        <div class="skill-tags">
          <el-tag v-for="(s, i) in form.nice_to_have_skills" :key="i" closable @close="removeNiceSkill(i)" type="success">{{ s }}</el-tag>
        </div>
      </el-form-item>

      <el-form-item :label="$t('resumeScreening.job.jdDesc')">
        <el-input v-model="form.description_md" type="textarea" :rows="3" :placeholder="$t('resumeScreening.job.jdDescPlaceholder')" />
      </el-form-item>
    </el-form>

    <div class="form-actions">
      <el-button @click="emit('cancel')">{{ $t('common.cancel') }}</el-button>
      <el-button @click="handleSave(false)">{{ $t('resumeScreening.job.saveDraft') }}</el-button>
      <el-button type="primary" @click="handleSave(true)">{{ $t('resumeScreening.job.publish') }}</el-button>
    </div>
  </div>
</template>

<style scoped>
.job-form { padding: 4px 0; }
.skill-input-row { margin-bottom: 6px; }
.skill-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
