<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog-container">
      <div class="dialog-header">
        <h3 class="dialog-title">
          {{ isCreate ? $t('assistant.addAssistant') : `${$t('assistant.editAssistant')} - ${assistant?.name}` }}
        </h3>
        <button class="btn-close" @click="$emit('close')">&times;</button>
      </div>

      <div class="dialog-body">
        <!-- 基本信息 -->
        <div class="form-section">
          <h4 class="section-title">{{ $t('assistant.basicInfo') }}</h4>
          <div class="form-grid">
            <div v-if="isCreate" class="form-item">
              <label class="form-label">{{ $t('assistant.assistantType') }}</label>
              <input
                v-model="form.assistant_type"
                type="text"
                class="form-input"
                :placeholder="$t('assistant.assistantTypePlaceholder')"
                @keydown="handleAssistantTypeKeydown"
              />
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('assistant.name') }}</label>
              <input v-model="form.name" type="text" class="form-input" />
            </div>
          </div>
          <div class="form-item full-width">
            <label class="form-label">{{ $t('assistant.description') }}</label>
            <input v-model="form.description" type="text" class="form-input" />
          </div>
        </div>

        <!-- 执行配置 -->
        <div class="form-section">
          <h4 class="section-title">{{ $t('assistant.executionConfig') }}</h4>
          <div class="form-grid">
            <div class="form-item">
              <label class="form-label">{{ $t('assistant.executionMode') }}</label>
              <select v-model="form.execution_mode" class="form-select">
                <option value="direct">{{ $t('assistant.executionModeDirect') }}</option>
                <option value="llm">{{ $t('assistant.executionModeLlm') }}</option>
                <option value="hybrid">{{ $t('assistant.executionModeHybrid') }}</option>
              </select>
              <span v-if="isDirectMode" class="form-hint">{{ $t('assistant.directModeHint') }}</span>
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('assistant.model') }}</label>
              <select v-model="form.model_id" class="form-select">
                <option value="">{{ $t('common.none') }}</option>
                <option v-for="model in models" :key="model.id" :value="model.id">
                  {{ model.name }}
                </option>
              </select>
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('assistant.maxTokens') }}</label>
              <input v-model.number="form.max_tokens" type="number" class="form-input" min="1" />
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('assistant.temperature') }}</label>
              <div class="slider-group">
                <input
                  v-model.number="form.temperature"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  class="form-slider"
                />
                <span class="slider-value">{{ form.temperature?.toFixed(2) }}</span>
              </div>
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('assistant.timeout') }} ({{ $t('common.seconds') }})</label>
              <input v-model.number="form.timeout" type="number" class="form-input" min="1" />
            </div>
          </div>
        </div>

        <!-- 工具配置（direct 模式专用） -->
        <div v-if="isDirectMode" class="form-section tool-config-section">
          <h4 class="section-title">{{ $t('assistant.toolConfigDirect') }}</h4>
          <div class="form-grid">
            <div class="form-item full-width">
              <label class="form-label">{{ $t('assistant.toolName') }}</label>
              <select v-model="form.tool_name" class="form-select">
                <option value="">{{ $t('common.none') }} - {{ $t('assistant.selectTool') }}</option>
                <option v-for="skill in skillStore.skills" :key="skill.id" :value="skill.id">
                  {{ skill.name }} ({{ skill.id }})
                </option>
              </select>
            </div>
            <div class="form-item full-width">
              <label class="form-label">{{ $t('assistant.toolDescription') }}</label>
              <input
                v-model="form.tool_description"
                type="text"
                class="form-input"
                :placeholder="$t('assistant.toolDescriptionPlaceholder')"
              />
            </div>
            <div class="form-item full-width">
              <label class="form-label">{{ $t('assistant.toolParameters') }} (JSON Schema)</label>
              <textarea
                v-model="form.tool_parameters"
                class="form-textarea"
                rows="4"
                :placeholder="$t('assistant.toolParametersPlaceholder')"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- 提示词配置 -->
        <div class="form-section">
          <h4 class="section-title">{{ $t('assistant.promptTemplate') }}</h4>
          <div class="form-item full-width">
            <textarea
              v-model="form.prompt_template"
              class="form-textarea"
              rows="6"
              :placeholder="$t('assistant.promptPlaceholder')"
            ></textarea>
          </div>
        </div>

        <!-- 高级配置 -->
        <div class="form-section">
          <h4 class="section-title">{{ $t('assistant.advancedConfig') }}</h4>
          <div class="form-checkboxes">
            <label class="checkbox-label">
              <input v-model="form.is_active" type="checkbox" />
              {{ $t('assistant.enableAssistant') }}
            </label>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn-cancel" @click="$emit('close')">
          {{ $t('common.cancel') }}
        </button>
        <button class="btn-save" :disabled="saving" @click="handleSubmit">
          {{ saving ? $t('common.saving') : $t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Assistant, AIModel } from '@/types'
import { useSkillStore } from '@/stores/skill'

const props = defineProps<{
  assistant: Assistant | null
  models: AIModel[]
  isCreate?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [data: Partial<Assistant>]
  create: [data: Partial<Assistant> & { assistant_type: string; name: string }]
}>()

const { t } = useI18n()
const skillStore = useSkillStore()

const saving = ref(false)

// 判断是否为 direct 模式
const isDirectMode = computed(() => form.execution_mode === 'direct')

const form = reactive({
  assistant_type: '',
  name: '',
  description: '',
  execution_mode: 'llm' as 'direct' | 'llm' | 'hybrid',
  model_id: '',
  max_tokens: 4096,
  temperature: 0.7,
  timeout: 120,
  prompt_template: '',
  can_use_skills: false,
  is_active: true,
  // 工具配置（direct 模式用）
  tool_name: '',
  tool_description: '',
  tool_parameters: '',
})

// 监听 assistant 变化，初始化表单
watch(
  () => props.assistant,
  (newAssistant) => {
    if (newAssistant) {
      form.assistant_type = newAssistant.assistant_type || ''
      form.name = newAssistant.name || ''
      form.description = newAssistant.description || ''
      form.execution_mode = newAssistant.execution_mode || 'llm'
      form.model_id = newAssistant.model_id || ''
      form.max_tokens = newAssistant.max_tokens ?? 4096
      form.temperature = Number(newAssistant.temperature) ?? 0.7
      form.timeout = newAssistant.timeout ?? 120
      form.prompt_template = newAssistant.prompt_template || ''
      form.can_use_skills = newAssistant.can_use_skills ?? false
      form.is_active = newAssistant.is_active ?? true
      // 工具配置
      form.tool_name = newAssistant.tool_name || ''
      form.tool_description = newAssistant.tool_description || ''
      form.tool_parameters = newAssistant.tool_parameters || ''
    }
  },
  { immediate: true }
)

// 加载技能列表
if (skillStore.skills.length === 0) {
  skillStore.loadSkills()
}

// 限制 assistant_type 只允许字母和下划线
function handleAssistantTypeKeydown(e: KeyboardEvent) {
  // 允许 Backspace, Delete, Tab, 左右箭头
  if (['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    return
  }
  // 只允许字母和下划线
  if (!/^[a-zA-Z_]$/.test(e.key)) {
    e.preventDefault()
  }
}

async function handleSubmit() {
  // 创建模式验证
  if (props.isCreate && !form.assistant_type) {
    alert(t('assistant.assistantTypeRequired'))
    return
  }
  if (!form.name) {
    alert(t('assistant.nameRequired'))
    return
  }

  // direct 模式必须选择工具
  if (form.execution_mode === 'direct' && !form.tool_name) {
    alert(t('assistant.toolNameRequired'))
    return
  }

  saving.value = true
  try {
    const baseData = {
      name: form.name,
      description: form.description,
      execution_mode: form.execution_mode,
      model_id: form.model_id || undefined,
      max_tokens: form.max_tokens,
      temperature: form.temperature,
      timeout: form.timeout,
      prompt_template: form.prompt_template,
      can_use_skills: form.can_use_skills,
      is_active: form.is_active,
      // 工具配置
      tool_name: form.tool_name || undefined,
      tool_description: form.tool_description || undefined,
      tool_parameters: form.tool_parameters || undefined,
    }

    if (props.isCreate) {
      emit('create', {
        assistant_type: form.assistant_type,
        ...baseData,
      })
    } else {
      emit('save', baseData)
    }
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog-container {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.dialog-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.btn-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary, #666);
  padding: 0;
  line-height: 1;
}

.btn-close:hover {
  color: var(--text-primary, #333);
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.form-section {
  margin-bottom: 24px;
}

.section-title {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary, #666);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-item.full-width {
  grid-column: 1 / -1;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #666);
}

.form-input,
.form-select,
.form-textarea {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 14px;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.form-textarea {
  resize: vertical;
  font-family: inherit;
}

.slider-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.form-slider {
  flex: 1;
}

.slider-value {
  font-size: 13px;
  font-weight: 500;
  min-width: 40px;
  text-align: right;
}

.form-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-hint {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-top: 4px;
}

.tool-config-section {
  background: var(--secondary-bg, #f8f9fa);
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.btn-cancel,
.btn-save {
  padding: 8px 16px;
  font-size: 14px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-primary, #333);
}

.btn-cancel:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.btn-save {
  background: var(--primary-color, #2196f3);
  border: none;
  color: white;
}

.btn-save:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>