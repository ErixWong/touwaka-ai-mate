<template>
  <div v-if="visible" class="dialog-overlay" @click.self="close">
    <div class="dialog">
      <h3 class="dialog-title">
        {{ $t('skills.parameters.title') }}: {{ skill?.name }}
      </h3>
      
      <div class="dialog-body">
        <!-- 参数列表 -->
        <div v-if="parameters.length > 0" class="parameters-list">
          <div 
            v-for="(param, index) in parameters" 
            :key="index" 
            class="parameter-item"
          >
            <div class="parameter-fields">
              <div class="field-group">
                <label class="field-label">{{ $t('skills.parameters.paramName') }}</label>
                <input
                  v-model="param.param_name"
                  type="text"
                  class="field-input"
                  :placeholder="$t('skills.parameters.paramNamePlaceholder')"
                />
              </div>
              
              <div class="field-group">
                <label class="field-label">{{ $t('skills.parameters.paramValue') }}</label>
                <input
                  v-if="!param.is_secret || param._showValue"
                  v-model="param.param_value"
                  type="text"
                  class="field-input"
                  :placeholder="$t('skills.parameters.paramValuePlaceholder')"
                />
                <input
                  v-else
                  :value="'••••••••'"
                  type="text"
                  class="field-input"
                  readonly
                  @click="param._showValue = true"
                />
                <button 
                  v-if="param.is_secret" 
                  class="btn-toggle-visibility"
                  @click="param._showValue = !param._showValue"
                >
                  {{ param._showValue ? '🙈' : '👁️' }}
                </button>
              </div>
              
              <div class="field-group checkbox-group">
                <label class="checkbox-label">
                  <input
                    v-model="param.is_secret"
                    type="checkbox"
                  />
                  <span>{{ $t('skills.parameters.isSecret') }}</span>
                </label>
                <span class="checkbox-hint">{{ $t('skills.parameters.isSecretHint') }}</span>
              </div>
            </div>
            
            <button 
              class="btn-remove" 
              @click="removeParameter(index)"
              :title="$t('common.delete')"
            >
              ✕
            </button>
          </div>
        </div>
        
        <!-- 空状态 -->
        <div v-else class="empty-parameters">
          <p>{{ $t('skills.parameters.empty') }}</p>
        </div>
        
        <!-- 添加参数按钮 -->
        <button class="btn-add-param" @click="addParameter">
          <span class="icon">+</span>
          {{ $t('skills.parameters.addParam') }}
        </button>
        
        <!-- 保存状态 -->
        <div v-if="saveStatus" class="save-status" :class="saveStatus.type">
          <span class="status-icon">
            {{ saveStatus.type === 'success' ? '✅' : saveStatus.type === 'error' ? '❌' : '⏳' }}
          </span>
          {{ saveStatus.message }}
        </div>
      </div>
      
      <div class="dialog-footer">
        <button class="btn-cancel" @click="close">
          {{ $t('common.cancel') }}
        </button>
        <button 
          class="btn-confirm" 
          :disabled="isSaving"
          @click="saveParameters"
        >
          {{ isSaving ? $t('common.loading') : $t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Skill } from '@/types'
import apiClient from '@/api/client'

interface SkillParameter {
  id?: number
  param_name: string
  param_value: string
  is_secret: boolean
  _showValue?: boolean
  _isNew?: boolean
}

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  skill: {
    type: Object as PropType<Skill | null>,
    default: null
  }
})

const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()

const parameters = ref<SkillParameter[]>([])
const isSaving = ref(false)
const saveStatus = ref<{ type: 'success' | 'error' | 'loading'; message: string } | null>(null)

// 加载参数
const loadParameters = async () => {
  if (!props.skill?.id) return
  
  try {
    const response = await apiClient.get(`/skills/${props.skill.id}/parameters`)
    parameters.value = (response.data || []).map((p: SkillParameter) => ({
      ...p,
      _showValue: false,
      _isNew: false
    }))
  } catch (error) {
    console.error('Failed to load parameters:', error)
    parameters.value = []
  }
}

// 监听 visible 变化，加载参数
watch(() => props.visible, (newVal) => {
  if (newVal) {
    loadParameters()
    saveStatus.value = null
  }
})

// 添加参数
const addParameter = () => {
  parameters.value.push({
    param_name: '',
    param_value: '',
    is_secret: false,
    _showValue: true,
    _isNew: true
  })
}

// 删除参数
const removeParameter = (index: number) => {
  parameters.value.splice(index, 1)
}

// 保存参数
const saveParameters = async () => {
  if (!props.skill?.id) return
  
  // 验证参数名不能为空
  const invalidParams = parameters.value.filter(p => !p.param_name.trim())
  if (invalidParams.length > 0) {
    saveStatus.value = {
      type: 'error',
      message: t('skills.parameters.errorNameRequired')
    }
    return
  }
  
  // 验证参数名格式（只允许字母、数字、下划线，不能以数字开头）
  const paramNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
  const invalidNames = parameters.value.filter(p => !paramNamePattern.test(p.param_name))
  if (invalidNames.length > 0) {
    saveStatus.value = {
      type: 'error',
      message: t('skills.parameters.errorInvalidName')
    }
    return
  }
  
  isSaving.value = true
  saveStatus.value = {
    type: 'loading',
    message: t('common.loading')
  }
  
  try {
    // 准备数据，移除临时字段
    const data = parameters.value.map(p => ({
      param_name: p.param_name.trim(),
      param_value: p.param_value,
      is_secret: p.is_secret
    }))
    
    await apiClient.post(`/skills/${props.skill.id}/parameters`, data)
    
    saveStatus.value = {
      type: 'success',
      message: t('settings.saveSuccess')
    }
    
    // 通知父组件
    emit('saved')
    
    // 1.5秒后关闭
    setTimeout(() => {
      close()
    }, 1500)
  } catch (error: unknown) {
    console.error('Failed to save parameters:', error)
    saveStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : t('error.unknownError')
    }
  } finally {
    isSaving.value = false
  }
}

// 关闭对话框
const close = () => {
  emit('close')
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

.dialog {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-primary, #333);
}

.dialog-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.parameters-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}

.parameter-item {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.parameter-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #666);
}

.field-input {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  width: 100%;
}

.field-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.field-group.checkbox-group {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary, #333);
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.checkbox-hint {
  font-size: 11px;
  color: var(--text-tertiary, #999);
}

.btn-toggle-visibility {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
}

.field-group:nth-child(2) {
  position: relative;
}

.btn-remove {
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 4px;
}

.btn-remove:hover {
  background: var(--error-color, #ffebee);
  border-color: var(--error-color, #ef5350);
  color: var(--error-color, #c62828);
}

.empty-parameters {
  text-align: center;
  padding: 32px;
  color: var(--text-secondary, #666);
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
  margin-bottom: 16px;
}

.btn-add-param {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 12px;
  background: transparent;
  border: 2px dashed var(--border-color, #e0e0e0);
  border-radius: 8px;
  color: var(--primary-color, #2196f3);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-add-param:hover {
  border-color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
}

.btn-add-param .icon {
  font-size: 18px;
}

.save-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  margin-top: 16px;
  font-size: 14px;
}

.save-status.success {
  background: #e8f5e9;
  color: #2e7d32;
}

.save-status.error {
  background: #ffebee;
  color: #c62828;
}

.save-status.loading {
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.btn-cancel {
  padding: 8px 16px;
  background: white;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-cancel:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.btn-confirm {
  padding: 8px 16px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-confirm:hover:not(:disabled) {
  background: var(--primary-hover, #1976d2);
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
