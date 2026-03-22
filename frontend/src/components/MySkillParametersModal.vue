<template>
  <div v-if="visible" class="dialog-overlay" @click.self="close">
    <div class="dialog">
      <h3 class="dialog-title">
        {{ $t('skills.myParameters.title') }}: {{ skill?.name }}
      </h3>
      
      <div class="dialog-body">
        <!-- 说明 -->
        <div class="info-banner">
          <span class="info-icon">ℹ️</span>
          <span>{{ $t('skills.myParameters.info') }}</span>
        </div>
        
        <!-- 加载状态 -->
        <div v-if="isLoading" class="loading-state">
          {{ $t('common.loading') }}
        </div>
        
        <!-- 参数列表 -->
        <div v-else-if="parameters.length > 0" class="parameters-list">
          <div 
            v-for="(param, index) in parameters" 
            :key="index" 
            class="parameter-item"
            :class="{ readonly: !param.allow_user_override }"
          >
            <div class="parameter-header">
              <span class="param-name">{{ param.param_name }}</span>
              <span v-if="!param.allow_user_override" class="badge-locked">
                🔒 {{ $t('skills.myParameters.locked') }}
              </span>
              <span v-else-if="param.has_user_override" class="badge-overridden">
                ✓ {{ $t('skills.myParameters.overridden') }}
              </span>
            </div>
            
            <p v-if="param.description" class="param-description">{{ param.description }}</p>
            
            <div class="parameter-fields">
              <!-- 全局值（只读） -->
              <div class="field-group">
                <label class="field-label">{{ $t('skills.myParameters.globalValue') }}</label>
                <div class="field-readonly">
                  <span v-if="param.is_secret && !showGlobalValues[param.param_name]">••••••••</span>
                  <span v-else>{{ param.global_value || '-' }}</span>
                  <button 
                    v-if="param.is_secret" 
                    class="btn-toggle"
                    @click="toggleGlobalValue(param.param_name)"
                  >
                    {{ showGlobalValues[param.param_name] ? '🙈' : '👁️' }}
                  </button>
                </div>
              </div>
              
              <!-- 用户值（可编辑） -->
              <div v-if="param.allow_user_override" class="field-group">
                <label class="field-label">{{ $t('skills.myParameters.myValue') }}</label>
                <div class="field-input-wrapper">
                  <input
                    v-if="!param.is_secret || showUserValues[param.param_name]"
                    v-model="param.param_value"
                    type="text"
                    class="field-input"
                    :placeholder="$t('skills.myParameters.myValuePlaceholder')"
                  />
                  <input
                    v-else
                    :value="param.param_value ? '••••••••' : ''"
                    type="text"
                    class="field-input"
                    readonly
                    :placeholder="$t('skills.myParameters.clickToShow')"
                    @click="showUserValues[param.param_name] = true"
                  />
                  <button 
                    v-if="param.is_secret" 
                    class="btn-toggle"
                    @click="toggleUserValue(param.param_name)"
                  >
                    {{ showUserValues[param.param_name] ? '🙈' : '👁️' }}
                  </button>
                </div>
                <button 
                  v-if="param.has_user_override"
                  class="btn-reset"
                  @click="resetParameter(index)"
                >
                  {{ $t('skills.myParameters.resetToGlobal') }}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 空状态 -->
        <div v-else class="empty-parameters">
          <p>{{ $t('skills.myParameters.empty') }}</p>
        </div>
        
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
import { ref, reactive, watch, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Skill } from '@/types'
import apiClient from '@/api/client'

interface UserParameter {
  id: string
  param_name: string
  param_value: string
  global_value: string
  user_value: string | null
  is_secret: boolean
  allow_user_override: boolean
  description: string
  has_user_override: boolean
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

const parameters = ref<UserParameter[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const saveStatus = ref<{ type: 'success' | 'error' | 'loading'; message: string } | null>(null)

// 控制密码显示
const showGlobalValues = reactive<Record<string, boolean>>({})
const showUserValues = reactive<Record<string, boolean>>({})

// 切换全局值显示
const toggleGlobalValue = (paramName: string) => {
  showGlobalValues[paramName] = !showGlobalValues[paramName]
}

// 切换用户值显示
const toggleUserValue = (paramName: string) => {
  showUserValues[paramName] = !showUserValues[paramName]
}

// 重置参数为全局值
const resetParameter = (index: number) => {
  const param = parameters.value[index]
  if (param) {
    param.param_value = param.global_value
    param.has_user_override = false
  }
}

// 加载参数
const loadParameters = async () => {
  if (!props.skill?.id) return
  
  isLoading.value = true
  try {
    const response = await apiClient.get(`/skills/${props.skill.id}/my-parameters`)
    const params = response.data.data?.parameters || []
    parameters.value = params.map((p: UserParameter) => ({
      ...p,
      // 如果有用户值，使用用户值；否则使用全局值作为编辑初始值
      param_value: p.user_value !== null ? p.user_value : p.global_value
    }))
    
    // 重置显示状态
    Object.keys(showGlobalValues).forEach(key => delete showGlobalValues[key])
    Object.keys(showUserValues).forEach(key => delete showUserValues[key])
  } catch (error) {
    console.error('Failed to load parameters:', error)
    parameters.value = []
    // 显示错误信息给用户
    saveStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : t('skills.myParameters.loadFailed')
    }
  } finally {
    isLoading.value = false
  }
}

// 监听 visible 变化，加载参数
watch(() => props.visible, (newVal) => {
  if (newVal) {
    loadParameters()
    saveStatus.value = null
  }
})

// 保存参数
const saveParameters = async () => {
  if (!props.skill?.id) return
  
  isSaving.value = true
  saveStatus.value = {
    type: 'loading',
    message: t('common.loading')
  }
  
  try {
    // 只保存允许用户覆盖的参数，且值与全局值不同的
    const data = parameters.value
      .filter(p => p.allow_user_override)
      .map(p => ({
        param_name: p.param_name,
        param_value: p.param_value
      }))
    
    await apiClient.post(`/skills/${props.skill.id}/my-parameters`, { parameters: data })
    
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
  max-width: 600px;
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

.info-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--primary-light, #e3f2fd);
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--primary-dark, #1565c0);
}

.info-icon {
  font-size: 16px;
}

.loading-state {
  text-align: center;
  padding: 32px;
  color: var(--text-secondary, #666);
}

.parameters-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.parameter-item {
  padding: 16px;
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.parameter-item.readonly {
  opacity: 0.7;
  background: var(--bg-disabled, #f0f0f0);
}

.parameter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.param-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary, #333);
  font-family: monospace;
}

.badge-locked {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--bg-tertiary, #e0e0e0);
  color: var(--text-secondary, #666);
  border-radius: 4px;
}

.badge-overridden {
  font-size: 11px;
  padding: 2px 8px;
  background: #e8f5e9;
  color: #2e7d32;
  border-radius: 4px;
}

.param-description {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin: 0 0 12px 0;
}

.parameter-fields {
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

.field-readonly {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-secondary, #666);
}

.field-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
}

.field-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.btn-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
}

.btn-reset {
  margin-top: 4px;
  padding: 4px 12px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-reset:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.empty-parameters {
  text-align: center;
  padding: 32px;
  color: var(--text-secondary, #666);
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
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