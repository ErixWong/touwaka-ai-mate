<template>
  <div class="expert-settings-tab">
    <div class="panel-header">
      <h3 class="panel-title">{{ $t('settings.expertManagement') }}</h3>
      <el-button @click="openExpertDialog()">
        + {{ $t('settings.addExpert') }}
      </el-button>
    </div>

    <div v-if="expertStore.isLoading" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="expertStore.experts.length === 0" class="empty-state">
      {{ $t('settings.noExperts') }}
    </div>

    <div v-else class="expert-list-container">
      <div class="expert-list">
        <div
          v-for="expert in paginatedExperts"
          :key="expert.id"
          class="expert-item"
          :class="{
            inactive: !expert.is_active
          }"
        >
          <div class="expert-header">
            <div class="expert-info">
              <span class="expert-name">{{ expert.name }}</span>
              <span v-if="!expert.is_active" class="badge inactive">
                {{ $t('settings.inactive') }}
              </span>
            </div>
            <div class="expert-actions">
              <el-button size="small" @click="openSkillsDialog(expert)">
                ⚡ {{ $t('settings.skills') }}
              </el-button>
              <el-button size="small" @click="openExpertDialog(expert)">
                {{ $t('common.edit') }}
              </el-button>
              <el-button size="small" type="danger" @click="confirmDeleteExpert(expert)">
                {{ $t('common.delete') }}
              </el-button>
            </div>
          </div>
          <p v-if="expert.introduction" class="expert-intro">{{ expert.introduction }}</p>
        </div>
      </div>

      <Pagination
        v-if="expertTotalPages > 1"
        :current-page="expertPage"
        :total-pages="expertTotalPages"
        :total="expertStore.experts.length"
        @change="(page) => expertPage = page"
      />
    </div>

    <el-dialog
      v-model="showExpertDialog"
      :title="editingExpert ? $t('settings.editExpert') : $t('settings.addExpert')"
      width="800px"
      class="expert-dialog"
    >
      <el-tabs v-model="expertActiveTab">
        <el-tab-pane :label="$t('settings.expertBasicInfo')" name="basic">
          <el-row :gutter="20">
            <el-col :span="18">
              <el-form-item :label="$t('settings.expertName')" required>
                <el-input v-model="expertForm.name" :placeholder="$t('settings.expertNamePlaceholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-checkbox v-model="expertForm.is_active">{{ $t('settings.isActive') }}</el-checkbox>
            </el-col>
          </el-row>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertAvatar')">
                <div class="avatar-upload">
                  <div class="avatar-preview" :style="expertForm.avatar_base64 ? { backgroundImage: `url(${expertForm.avatar_base64})` } : {}">
                    <span v-if="!expertForm.avatar_base64">🤖</span>
                  </div>
                  <div class="avatar-actions">
                    <input type="file" accept="image/*" ref="smallAvatarInput" @change="handleSmallAvatarUpload" style="display: none" />
                    <el-button size="small" @click="smallAvatarInput?.click()">{{ $t('settings.uploadAvatar') }}</el-button>
                    <el-button v-if="expertForm.avatar_base64" size="small" type="danger" @click="expertForm.avatar_base64 = ''">{{ $t('common.delete') }}</el-button>
                  </div>
                </div>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertAvatarLarge')">
                <div class="avatar-upload">
                  <div class="avatar-preview large" :style="expertForm.avatar_large_base64 ? { backgroundImage: `url(${expertForm.avatar_large_base64})` } : {}">
                    <span v-if="!expertForm.avatar_large_base64">🖼️</span>
                  </div>
                  <div class="avatar-actions">
                    <input type="file" accept="image/*" ref="largeAvatarInput" @change="handleLargeAvatarUpload" style="display: none" />
                    <el-button size="small" @click="largeAvatarInput?.click()">{{ $t('settings.uploadAvatar') }}</el-button>
                    <el-button v-if="expertForm.avatar_large_base64" size="small" type="danger" @click="expertForm.avatar_large_base64 = ''">{{ $t('common.delete') }}</el-button>
                  </div>
                </div>
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item :label="$t('settings.expertIntroduction')">
            <el-input v-model="expertForm.introduction" type="textarea" :rows="3" :placeholder="$t('settings.expertIntroductionPlaceholder')" />
          </el-form-item>
        </el-tab-pane>

        <el-tab-pane :label="$t('settings.expertPersonality')" name="personality">
          <el-form-item :label="$t('settings.expertCoreValues')">
            <el-input v-model="expertForm.core_values" type="textarea" :rows="3" :placeholder="$t('settings.expertCoreValuesPlaceholder')" />
          </el-form-item>

          <el-form-item :label="$t('settings.expertBehavioralGuidelines')">
            <el-input v-model="expertForm.behavioral_guidelines" type="textarea" :rows="4" :placeholder="$t('settings.expertBehavioralGuidelinesPlaceholder')" />
          </el-form-item>

          <el-form-item :label="$t('settings.expertTaboos')">
            <el-input v-model="expertForm.taboos" type="textarea" :rows="3" :placeholder="$t('settings.expertTaboosPlaceholder')" />
          </el-form-item>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertSpeakingStyle')">
                <el-input v-model="expertForm.speaking_style" :placeholder="$t('settings.expertSpeakingStylePlaceholder')" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertEmotionalTone')">
                <el-input v-model="expertForm.emotional_tone" :placeholder="$t('settings.expertEmotionalTonePlaceholder')" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-tab-pane>

        <el-tab-pane :label="$t('settings.expertModelConfig')" name="model">
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertExpressiveModel')">
                <el-select v-model="expertForm.expressive_model_id" clearable>
                  <el-option label="" value="" />
                  <el-option v-for="model in expertAvailableModels" :key="model.id" :value="model.id" :label="model.name" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.expertReflectiveModel')">
                <el-select v-model="expertForm.reflective_model_id" clearable>
                  <el-option label="" value="" />
                  <el-option v-for="model in expertAvailableModels" :key="model.id" :value="model.id" :label="model.name" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item :label="$t('settings.expertPromptTemplate')">
            <el-input v-model="expertForm.prompt_template" type="textarea" :rows="5" :placeholder="$t('settings.expertPromptTemplatePlaceholder')" />
          </el-form-item>

          <el-divider>{{ $t('settings.contextCompression') }}</el-divider>

          <el-form-item :label="$t('settings.contextStrategy')">
            <el-select v-model="expertForm.context_strategy">
              <el-option value="full" :label="$t('settings.contextStrategyFull')" />
              <el-option value="simple" :label="$t('settings.contextStrategySimple')" />
              <el-option value="minimal" :label="$t('settings.contextStrategyMinimal')" />
            </el-select>
            <div class="el-form-item__tip">{{ $t('settings.contextStrategyHint') }}</div>
          </el-form-item>

          <PsycheConfigPanel
            v-if="expertForm.context_strategy === 'minimal'"
            v-model="expertForm.psyche_config"
          />

          <el-form-item :label="$t('settings.contextThreshold')">
            <el-input-number v-model="expertForm.context_threshold" :precision="2" :step="0.05" :min="0.3" :max="0.95" />
            <div class="el-form-item__tip">{{ $t('settings.contextThresholdHint') }}</div>
          </el-form-item>

          <el-divider>{{ $t('settings.llmParams') }}</el-divider>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.temperature')">
                <el-input-number v-model="expertForm.temperature" :precision="1" :step="0.1" :min="0" :max="2" />
                <div class="el-form-item__tip">{{ $t('settings.temperatureHint') }}</div>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.reflectiveTemperature')">
                <el-input-number v-model="expertForm.reflective_temperature" :precision="1" :step="0.1" :min="0" :max="2" />
                <div class="el-form-item__tip">{{ $t('settings.reflectiveTemperatureHint') }}</div>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.topP')">
                <el-input-number v-model="expertForm.top_p" :precision="1" :step="0.1" :min="0" :max="1" />
                <div class="el-form-item__tip">{{ $t('settings.topPHint') }}</div>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="$t('settings.frequencyPenalty')">
                <el-input-number v-model="expertForm.frequency_penalty" :precision="1" :step="0.1" :min="-2" :max="2" />
                <div class="el-form-item__tip">{{ $t('settings.frequencyPenaltyHint') }}</div>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="$t('settings.presencePenalty')">
                <el-input-number v-model="expertForm.presence_penalty" :precision="1" :step="0.1" :min="-2" :max="2" />
                <div class="el-form-item__tip">{{ $t('settings.presencePenaltyHint') }}</div>
              </el-form-item>
            </el-col>
          </el-row>

          <el-divider>{{ $t('settings.toolCallConfig') }}</el-divider>

          <el-form-item :label="$t('settings.maxToolRounds')">
            <el-input-number v-model="expertForm.max_tool_rounds" :min="1" :max="50" :placeholder="$t('settings.maxToolRoundsPlaceholder')" />
            <div class="el-form-item__tip">{{ $t('settings.maxToolRoundsExpertHint') }}</div>
          </el-form-item>
        </el-tab-pane>
      </el-tabs>

      <template #footer>
        <el-button v-if="editingExpert" type="danger" @click="confirmDeleteExpertFromDialog">{{ $t('common.delete') }}</el-button>
        <el-button @click="closeExpertDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isExpertFormValid" @click="saveExpert">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showSkillsDialog"
      :title="$t('settings.manageSkillsFor', { name: currentExpertForSkills?.name })"
      width="600px"
    >
      <el-input
        v-model="skillsSearchQuery"
        :placeholder="$t('settings.searchSkillsPlaceholder')"
        clearable
      />

      <div v-if="skillsLoading" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <el-empty
        v-else-if="filteredSkills.length === 0"
        :description="skillsSearchQuery ? $t('settings.noSkillsFound') : $t('settings.noSkillsAvailable')"
      />

      <div v-else class="skills-list">
        <div
          v-for="skill in filteredSkills"
          :key="skill.id"
          class="skill-item"
          :class="{ builtin: skill.is_builtin }"
        >
          <div class="skill-info">
            <div class="skill-header">
              <span class="skill-name">{{ skill.name }}</span>
              <el-tag v-if="skill.is_builtin" type="info" size="small">
                {{ $t('settings.builtinSkill') }}
              </el-tag>
            </div>
            <p v-if="skill.description" class="skill-description">
              {{ skill.description }}
            </p>
          </div>
          <el-switch
            v-model="skill.is_enabled"
            @change="handleSkillToggle(skill)"
          />
        </div>
      </div>

      <template #footer>
        <span class="skills-count">
          {{ $t('settings.enabledSkillsCount', { count: enabledSkillsCount }) }}
        </span>
        <el-button @click="closeSkillsDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveSkills">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { expertApi } from '@/api/services'
import Pagination from '@/components/Pagination.vue'
import PsycheConfigPanel from '@/components/PsycheConfigPanel.vue'
import { useExpertStore } from '@/stores/expert'
import { useModelStore } from '@/stores/model'
import { useToastStore } from '@/stores/toast'
import { compressLargeAvatar, compressSmallAvatar } from '@/utils/imageCompress'
import type { Expert, ExpertSkill, ExpertSkillConfig } from '@/types'

const { t } = useI18n()
const expertStore = useExpertStore()
const modelStore = useModelStore()
const toast = useToastStore()

const expertPage = ref(1)
const EXPERT_PAGE_SIZE = 10

const expertTotalPages = computed(() =>
  Math.ceil(expertStore.experts.length / EXPERT_PAGE_SIZE)
)

const paginatedExperts = computed(() => {
  const start = (expertPage.value - 1) * EXPERT_PAGE_SIZE
  return expertStore.experts.slice(start, start + EXPERT_PAGE_SIZE)
})

const expertAvailableModels = computed(() => {
  return modelStore.models.filter(m =>
    m.is_active &&
    (m.model_type === 'text' || m.model_type === 'multimodal')
  )
})

const showExpertDialog = ref(false)
const editingExpert = ref<Expert | null>(null)
const expertForm = reactive({
  name: '',
  introduction: '',
  speaking_style: '',
  core_values: '',
  behavioral_guidelines: '',
  taboos: '',
  emotional_tone: '',
  expressive_model_id: '',
  reflective_model_id: '',
  prompt_template: '',
  context_strategy: 'full' as 'full' | 'simple' | 'minimal',
  context_threshold: 0.70,
  psyche_config: {} as Record<string, unknown>,
  temperature: 0.70,
  reflective_temperature: 0.30,
  top_p: 1.0,
  frequency_penalty: 0.0,
  presence_penalty: 0.0,
  max_tool_rounds: null as number | null,
  avatar_base64: '',
  avatar_large_base64: '',
  is_active: true,
})

const isExpertFormValid = computed(() => {
  return expertForm.name?.trim()
})

const expertActiveTab = ref<'basic' | 'personality' | 'model'>('basic')

const showSkillsDialog = ref(false)
const currentExpertForSkills = ref<Expert | null>(null)
const skillsList = ref<ExpertSkill[]>([])
const skillsLoading = ref(false)
const skillsSearchQuery = ref('')
const skillsChanged = ref(false)

const smallAvatarInput = ref<HTMLInputElement | null>(null)
const largeAvatarInput = ref<HTMLInputElement | null>(null)

const openExpertDialog = (expert?: Expert) => {
  expertActiveTab.value = 'basic'

  if (expert) {
    editingExpert.value = expert
    expertForm.name = expert.name
    expertForm.introduction = expert.introduction || ''
    expertForm.speaking_style = expert.speaking_style || ''
    expertForm.core_values = expert.core_values || ''
    expertForm.behavioral_guidelines = expert.behavioral_guidelines || ''
    expertForm.taboos = expert.taboos || ''
    expertForm.emotional_tone = expert.emotional_tone || ''
    expertForm.expressive_model_id = expert.expressive_model_id || ''
    expertForm.reflective_model_id = expert.reflective_model_id || ''
    expertForm.prompt_template = expert.prompt_template || ''
    expertForm.context_strategy = expert.context_strategy ?? 'full'
    expertForm.context_threshold = expert.context_threshold ?? 0.70
    expertForm.psyche_config = expert.psyche_config || {}
    expertForm.temperature = expert.temperature ?? 0.70
    expertForm.reflective_temperature = expert.reflective_temperature ?? 0.30
    expertForm.top_p = expert.top_p ?? 1.0
    expertForm.frequency_penalty = expert.frequency_penalty ?? 0.0
    expertForm.presence_penalty = expert.presence_penalty ?? 0.0
    expertForm.max_tool_rounds = expert.max_tool_rounds ?? null
    expertForm.avatar_base64 = expert.avatar_base64 || ''
    expertForm.avatar_large_base64 = expert.avatar_large_base64 || ''
    expertForm.is_active = expert.is_active
  } else {
    editingExpert.value = null
    expertForm.name = ''
    expertForm.introduction = ''
    expertForm.speaking_style = ''
    expertForm.core_values = ''
    expertForm.behavioral_guidelines = ''
    expertForm.taboos = ''
    expertForm.emotional_tone = ''
    expertForm.expressive_model_id = ''
    expertForm.reflective_model_id = ''
    expertForm.prompt_template = ''
    expertForm.context_strategy = 'full'
    expertForm.context_threshold = 0.70
    expertForm.psyche_config = {}
    expertForm.temperature = 0.70
    expertForm.reflective_temperature = 0.30
    expertForm.top_p = 1.0
    expertForm.frequency_penalty = 0.0
    expertForm.presence_penalty = 0.0
    expertForm.max_tool_rounds = null
    expertForm.avatar_base64 = ''
    expertForm.avatar_large_base64 = ''
    expertForm.is_active = true
  }
  showExpertDialog.value = true
}

const closeExpertDialog = () => {
  showExpertDialog.value = false
  editingExpert.value = null
}

const saveExpert = async () => {
  try {
    if (editingExpert.value) {
      await expertStore.updateExpert(editingExpert.value.id, { ...expertForm })
    } else {
      await expertStore.createExpert({ ...expertForm })
    }
    closeExpertDialog()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('settings.saveExpertFailed')
    toast.error(errorMsg)
  }
}

const handleSmallAvatarUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const result = await compressSmallAvatar(file)
    expertForm.avatar_base64 = result.base64
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('settings.imageProcessFailed'))
  } finally {
    input.value = ''
  }
}

const handleLargeAvatarUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const result = await compressLargeAvatar(file)
    expertForm.avatar_large_base64 = result.base64
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('settings.imageProcessFailed'))
  } finally {
    input.value = ''
  }
}

const confirmDeleteExpert = async (expert: Expert) => {
  try {
    await ElMessageBox.confirm(
      t('settings.deleteExpertConfirm', { name: expert.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    await expertStore.deleteExpert(expert.id)
  } catch (err) {
    if (err !== 'cancel') {
      const errorMsg = err instanceof Error ? err.message : t('settings.deleteExpertFailed')
      toast.error(errorMsg)
    }
  }
}

const confirmDeleteExpertFromDialog = async () => {
  if (!editingExpert.value) return

  try {
    await ElMessageBox.confirm(
      t('settings.deleteExpertConfirm', { name: editingExpert.value.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    await expertStore.deleteExpert(editingExpert.value.id)
    closeExpertDialog()
  } catch (err) {
    if (err !== 'cancel') {
      const errorMsg = err instanceof Error ? err.message : t('settings.deleteExpertFailed')
      toast.error(errorMsg)
    }
  }
}

const openSkillsDialog = async (expert: Expert) => {
  currentExpertForSkills.value = expert
  skillsSearchQuery.value = ''
  skillsChanged.value = false
  showSkillsDialog.value = true
  await loadExpertSkills(expert.id)
}

const closeSkillsDialog = () => {
  showSkillsDialog.value = false
  currentExpertForSkills.value = null
  skillsList.value = []
  skillsSearchQuery.value = ''
  skillsChanged.value = false
}

const loadExpertSkills = async (expertId: string) => {
  skillsLoading.value = true
  try {
    const response = await expertApi.getExpertSkills(expertId)
    skillsList.value = response.skills || []
  } catch {
    toast.error(t('settings.loadSkillsFailed'))
  } finally {
    skillsLoading.value = false
  }
}

const handleSkillToggle = (_skill?: ExpertSkill) => {
  void _skill
  skillsChanged.value = true
}

const saveSkills = async () => {
  if (!currentExpertForSkills.value) return

  try {
    const skillConfigs: ExpertSkillConfig[] = skillsList.value.map(skill => ({
      skill_id: skill.id,
      is_enabled: skill.is_enabled
    }))

    await expertApi.updateExpertSkills(currentExpertForSkills.value.id, skillConfigs)
    skillsChanged.value = false
    closeSkillsDialog()
  } catch {
    toast.error(t('settings.saveSkillsFailed'))
  }
}

const filteredSkills = computed(() => {
  if (!skillsSearchQuery.value.trim()) {
    return skillsList.value
  }
  const query = skillsSearchQuery.value.toLowerCase()
  return skillsList.value.filter(skill =>
    skill.name.toLowerCase().includes(query) ||
    (skill.description && skill.description.toLowerCase().includes(query))
  )
})

const enabledSkillsCount = computed(() => {
  return skillsList.value.filter(s => s.is_enabled).length
})

onMounted(() => {
  modelStore.loadModels()
  expertStore.loadExperts({})
})
</script>

<style scoped>
.expert-settings-tab {
  min-height: 500px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.loading-state,
.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-size: 14px;
}

.badge {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
}

.badge.inactive {
  background: var(--error-bg, #ffebee);
  color: var(--error-color, #c62828);
}

.expert-list-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.expert-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.expert-item {
  padding: 16px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: var(--secondary-bg, #f8f9fa);
  border: 1px solid var(--border-color, #e0e0e0);
  transition: all 0.2s;
}

.expert-item:hover {
  background: var(--hover-bg, #f0f0f0);
  border-color: var(--primary-color, #2196f3);
}

.expert-item.inactive {
  opacity: 0.6;
}

.expert-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.expert-info {
  flex: 1;
  min-width: 0;
}

.expert-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.expert-intro {
  margin: 8px 0 0;
  color: var(--text-secondary, #666);
  font-size: 14px;
  line-height: 1.5;
}

.expert-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.avatar-upload {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-preview {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--secondary-bg, #f5f5f5);
  border: 2px dashed var(--border-color, #ddd);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  background-size: cover;
  background-position: center;
}

.avatar-preview.large {
  width: 80px;
  height: 80px;
  border-radius: 8px;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.skills-list {
  max-height: 400px;
  overflow-y: auto;
  margin-top: 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
}

.skill-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  transition: background-color 0.2s;
}

.skill-item:last-child {
  border-bottom: none;
}

.skill-item:hover {
  background: var(--hover-bg, #f5f5f5);
}

.skill-item.builtin {
  background: var(--secondary-bg, #f8f9fa);
}

.skill-item.builtin:hover {
  background: var(--hover-bg, #f0f0f0);
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.skill-name {
  font-weight: 500;
  color: var(--text-primary, #333);
}

.skill-description {
  margin: 0;
  color: var(--text-secondary, #666);
  font-size: 14px;
  line-height: 1.4;
}

.skills-count {
  float: left;
  color: var(--text-secondary, #666);
  font-size: 14px;
  line-height: 32px;
}

@media (max-width: 768px) {
  .expert-header {
    flex-direction: column;
  }

  .expert-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .skill-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
}
</style>
