<template>
  <div class="model-provider-tab">
    <div class="split-panel">
      <div class="panel provider-panel">
        <div class="panel-header">
          <h3 class="panel-title">{{ $t('settings.providerManagement') }}</h3>
          <el-button @click="openProviderDialog()" :title="$t('settings.addProvider')">
            + {{ $t('settings.addProvider') }}
          </el-button>
        </div>

        <div v-if="providerStore.isLoading" class="loading-state">
          {{ $t('common.loading') }}
        </div>

        <div v-else-if="providerStore.providers.length === 0" class="empty-state">
          {{ $t('settings.noProviders') }}
        </div>

        <div v-else class="provider-list-container">
          <div class="provider-list">
            <div
              v-for="provider in paginatedProviders"
              :key="provider.id"
              class="provider-item"
              :class="{
                active: selectedProvider?.id === provider.id,
                inactive: !provider.is_active
              }"
            >
              <button
                class="provider-name-btn"
                @click="selectProvider(provider)"
              >
                <span class="provider-name">{{ provider.name }}</span>
                <span v-if="!provider.is_active" class="badge inactive">
                  {{ $t('settings.inactive') }}
                </span>
              </button>
              <el-button size="small" @click.stop="openProviderDialog(provider)">
                {{ $t('common.edit') }}
              </el-button>
            </div>
          </div>

          <Pagination
            v-if="providerTotalPages > 1"
            :current-page="providerPage"
            :total-pages="providerTotalPages"
            :total="providerStore.providers.length"
            @change="(page) => providerPage = page"
          />
        </div>
      </div>

      <div class="panel model-panel">
        <div class="panel-header">
          <h3 class="panel-title">
            {{ selectedProvider
              ? $t('settings.modelsOfProvider', { name: selectedProvider.name })
              : $t('settings.modelManagement')
            }}
          </h3>
          <el-button
            v-if="selectedProvider"
            @click="openModelDialog()"
            :title="$t('settings.addModel')"
          >
            + {{ $t('settings.addModel') }}
          </el-button>
        </div>

        <div v-if="!selectedProvider" class="empty-state select-provider-hint">
          {{ $t('settings.selectProviderHint') }}
        </div>

        <div v-else-if="modelStore.isLoading" class="loading-state">
          {{ $t('common.loading') }}
        </div>

        <div v-else-if="filteredModels.length === 0" class="empty-state">
          {{ $t('settings.noModelsForProvider') }}
        </div>

        <div v-else class="model-list-container">
          <div class="model-list">
            <div
              v-for="model in paginatedModels"
              :key="model.id"
              class="model-item"
              :class="{
                inactive: !model.is_active
              }"
            >
              <div class="model-info">
                <span class="model-name">{{ model.name }}</span>
                <span v-if="model.model_type === 'embedding'" class="badge embedding">
                  {{ $t('settings.modelTypeEmbedding') }}
                </span>
                <span v-if="!model.is_active" class="badge inactive">
                  {{ $t('settings.inactive') }}
                </span>
              </div>
              <el-button size="small" @click.stop="openModelDialog(model)">
                {{ $t('common.edit') }}
              </el-button>
            </div>
          </div>

          <Pagination
            v-if="modelTotalPages > 1"
            :current-page="modelPage"
            :total-pages="modelTotalPages"
            :total="filteredModels.length"
            @change="(page) => modelPage = page"
          />
        </div>
      </div>
    </div>

    <el-dialog
      v-model="showProviderDialog"
      :title="editingProvider ? $t('settings.editProvider') : $t('settings.addProvider')"
      width="500px"
    >
      <el-form label-width="100px">
        <el-form-item :label="$t('settings.providerName')" required>
          <el-input v-model="providerForm.name" :placeholder="$t('settings.providerNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('settings.baseUrl')" required>
          <el-input v-model="providerForm.base_url" :placeholder="$t('settings.baseUrlPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('settings.apiKey')">
          <el-input v-model="providerForm.api_key" type="password" :placeholder="$t('settings.apiKeyPlaceholder')" show-password />
          <div v-if="editingProvider" class="el-form-item__tip">{{ $t('settings.apiKeyHint') }}</div>
        </el-form-item>
        <el-form-item :label="$t('settings.timeout') + ' (秒)'">
          <el-input-number v-model="providerForm.timeout" :min="5" :max="300" />
        </el-form-item>
        <el-form-item :label="$t('settings.userAgent')">
          <el-input v-model="providerForm.user_agent" :placeholder="$t('settings.userAgentPlaceholder')" />
          <div class="el-form-item__tip">{{ $t('settings.userAgentHint') }}</div>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="providerForm.is_active">{{ $t('settings.isActive') }}</el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="editingProvider" type="danger" @click="confirmDeleteProviderFromDialog">{{ $t('common.delete') }}</el-button>
        <el-button @click="closeProviderDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isProviderFormValid" @click="saveProvider">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showModelDialog"
      :title="editingModel ? $t('settings.editModel') : $t('settings.addModel')"
      width="600px"
    >
      <el-form label-width="120px">
        <el-form-item :label="$t('settings.modelName')" required>
          <el-input v-model="modelForm.name" :placeholder="$t('settings.modelNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('settings.modelIdentifier')" required>
          <el-input v-model="modelForm.model_name" :placeholder="$t('settings.modelIdentifierPlaceholder')" />
          <div class="el-form-item__tip">{{ $t('settings.modelIdentifierHint') }}</div>
        </el-form-item>
        <el-form-item :label="$t('settings.provider')" required>
          <el-select v-model="modelForm.provider_id" clearable>
            <el-option label="" value="" />
            <el-option v-for="provider in providerStore.providers" :key="provider.id" :value="provider.id" :label="provider.name" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('settings.modelType')">
          <el-select v-model="modelForm.model_type">
            <el-option value="text" :label="$t('settings.modelTypeText')" />
            <el-option value="multimodal" :label="$t('settings.modelTypeMultimodal')" />
            <el-option value="embedding" :label="$t('settings.modelTypeEmbedding')" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="modelForm.model_type === 'text' || modelForm.model_type === 'multimodal'" :label="$t('settings.maxTokens')">
          <el-input-number v-model="modelForm.max_tokens" :placeholder="$t('settings.maxTokensPlaceholder')" />
          <div class="el-form-item__tip">{{ $t('settings.maxTokensHint') }}</div>
        </el-form-item>

        <el-form-item v-if="modelForm.model_type === 'text' || modelForm.model_type === 'multimodal'" :label="$t('settings.maxOutputTokens')">
          <el-input-number v-model="modelForm.max_output_tokens" :placeholder="$t('settings.maxOutputTokensPlaceholder')" />
          <div class="el-form-item__tip">{{ $t('settings.maxOutputTokensHint') }}</div>
        </el-form-item>

        <el-form-item v-if="modelForm.model_type === 'embedding'" :label="$t('settings.embeddingDim')">
          <el-input-number v-model="modelForm.embedding_dim" :placeholder="$t('settings.embeddingDimPlaceholder')" />
        </el-form-item>

        <el-form-item :label="$t('settings.costPer1kInput') + ' (USD)'">
          <el-input-number v-model="modelForm.cost_per_1k_input" :precision="4" :step="0.0001" :placeholder="$t('settings.costPlaceholder')" />
        </el-form-item>

        <el-form-item :label="$t('settings.costPer1kOutput') + ' (USD)'">
          <el-input-number v-model="modelForm.cost_per_1k_output" :precision="4" :step="0.0001" :placeholder="$t('settings.costPlaceholder')" />
        </el-form-item>

        <el-form-item :label="$t('settings.modelDescription')">
          <el-input v-model="modelForm.description" type="textarea" :rows="3" :placeholder="$t('settings.descriptionPlaceholder')" />
        </el-form-item>

        <el-divider v-if="modelForm.model_type === 'text' || modelForm.model_type === 'multimodal'">{{ $t('settings.thinkingConfig') }}</el-divider>

        <el-form-item v-if="modelForm.model_type === 'text' || modelForm.model_type === 'multimodal'">
          <el-checkbox v-model="modelForm.supports_reasoning">{{ $t('settings.supportsReasoning') }}</el-checkbox>
          <div class="el-form-item__tip">{{ $t('settings.supportsReasoningHint') }}</div>
        </el-form-item>

        <el-form-item v-if="(modelForm.model_type === 'text' || modelForm.model_type === 'multimodal') && modelForm.supports_reasoning" :label="$t('settings.thinkingFormat')">
          <el-select v-model="modelForm.thinking_format">
            <el-option value="none" :label="$t('settings.thinkingFormatNone')" />
            <el-option value="openai" :label="$t('settings.thinkingFormatOpenai')" />
            <el-option value="glm" :label="$t('settings.thinkingFormatGlm')" />
            <el-option value="qwen" :label="$t('settings.thinkingFormatQwen')" />
            <el-option value="deepseek" :label="$t('settings.thinkingFormatDeepseek')" />
          </el-select>
          <div class="el-form-item__tip">{{ $t('settings.thinkingFormatHint') }}</div>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="modelForm.is_active">{{ $t('settings.isActive') }}</el-checkbox>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button v-if="editingModel" type="danger" @click="confirmDeleteModelFromDialog">{{ $t('common.delete') }}</el-button>
        <el-button @click="closeModelDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isModelFormValid" @click="saveModel">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import Pagination from '@/components/Pagination.vue'
import { useModelStore } from '@/stores/model'
import { useProviderStore } from '@/stores/provider'
import { useToastStore } from '@/stores/toast'
import type { AIModel, ModelFormData, ModelProvider, ProviderFormData } from '@/types'

const { t } = useI18n()
const modelStore = useModelStore()
const providerStore = useProviderStore()
const toast = useToastStore()

const selectedProvider = ref<ModelProvider | null>(null)
const providerPage = ref(1)
const PROVIDER_PAGE_SIZE = 10

const providerTotalPages = computed(() =>
  Math.ceil(providerStore.providers.length / PROVIDER_PAGE_SIZE)
)

const paginatedProviders = computed(() => {
  const start = (providerPage.value - 1) * PROVIDER_PAGE_SIZE
  return providerStore.providers.slice(start, start + PROVIDER_PAGE_SIZE)
})

const selectProvider = (provider: ModelProvider) => {
  selectedProvider.value = provider
  modelPage.value = 1
}

const modelPage = ref(1)
const MODEL_PAGE_SIZE = 10

const filteredModels = computed(() => {
  if (!selectedProvider.value) return []
  return modelStore.models.filter(m => m.provider_id === selectedProvider.value!.id)
})

const modelTotalPages = computed(() =>
  Math.ceil(filteredModels.value.length / MODEL_PAGE_SIZE)
)

const paginatedModels = computed(() => {
  const start = (modelPage.value - 1) * MODEL_PAGE_SIZE
  return filteredModels.value.slice(start, start + MODEL_PAGE_SIZE)
})

const showProviderDialog = ref(false)
const editingProvider = ref<ModelProvider | null>(null)
const providerForm = reactive<ProviderFormData>({
  name: '',
  base_url: '',
  api_key: '',
  timeout: 30,
  user_agent: '',
  is_active: true,
})

const isProviderFormValid = computed(() => {
  return providerForm.name.trim() && providerForm.base_url.trim()
})

const showModelDialog = ref(false)
const editingModel = ref<AIModel | null>(null)
const modelForm = reactive<ModelFormData>({
  name: '',
  model_name: '',
  provider_id: '',
  model_type: 'text',
  max_tokens: undefined,
  max_output_tokens: undefined,
  embedding_dim: undefined,
  cost_per_1k_input: undefined,
  cost_per_1k_output: undefined,
  description: '',
  is_active: true,
  supports_reasoning: false,
  thinking_format: 'none',
})

const isModelFormValid = computed(() => {
  return modelForm.name?.trim() && modelForm.model_name?.trim() && modelForm.provider_id?.trim()
})

const openProviderDialog = (provider?: ModelProvider) => {
  if (provider) {
    editingProvider.value = provider
    providerForm.name = provider.name
    providerForm.base_url = provider.base_url
    providerForm.api_key = ''
    providerForm.timeout = provider.timeout
    providerForm.user_agent = provider.user_agent || ''
    providerForm.is_active = provider.is_active
  } else {
    editingProvider.value = null
    providerForm.name = ''
    providerForm.base_url = ''
    providerForm.api_key = ''
    providerForm.timeout = 30
    providerForm.user_agent = ''
    providerForm.is_active = true
  }
  showProviderDialog.value = true
}

const closeProviderDialog = () => {
  showProviderDialog.value = false
  editingProvider.value = null
}

const saveProvider = async () => {
  try {
    if (editingProvider.value) {
      const updateData: Partial<ProviderFormData> = {
        name: providerForm.name,
        base_url: providerForm.base_url,
        timeout: providerForm.timeout,
        user_agent: providerForm.user_agent || undefined,
        is_active: providerForm.is_active,
      }
      if (providerForm.api_key) {
        updateData.api_key = providerForm.api_key
      }
      await providerStore.updateProvider(editingProvider.value.id, updateData)
    } else {
      const newProvider = await providerStore.createProvider({ ...providerForm })
      selectedProvider.value = newProvider
    }
    closeProviderDialog()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('settings.saveProviderFailed')
    toast.error(errorMsg)
  }
}

const confirmDeleteProviderFromDialog = async () => {
  if (!editingProvider.value) return

  try {
    await ElMessageBox.confirm(
      t('settings.deleteProviderConfirm', { name: editingProvider.value.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    await providerStore.deleteProvider(editingProvider.value.id)
    if (selectedProvider.value?.id === editingProvider.value.id) {
      selectedProvider.value = null
    }
    closeProviderDialog()
  } catch (err) {
    if (err !== 'cancel') {
      const errorMsg = err instanceof Error ? err.message : t('settings.deleteProviderFailed')
      toast.error(errorMsg)
    }
  }
}

const openModelDialog = (model?: AIModel) => {
  if (model) {
    editingModel.value = model
    modelForm.name = model.name
    modelForm.model_name = model.model_name || ''
    modelForm.provider_id = model.provider_id || ''
    modelForm.model_type = model.model_type || 'text'
    modelForm.max_tokens = model.max_tokens
    modelForm.max_output_tokens = model.max_output_tokens
    modelForm.embedding_dim = model.embedding_dim
    modelForm.cost_per_1k_input = model.cost_per_1k_input
    modelForm.cost_per_1k_output = model.cost_per_1k_output
    modelForm.description = model.description || ''
    modelForm.supports_reasoning = model.supports_reasoning ?? false
    modelForm.thinking_format = model.thinking_format ?? 'none'
    modelForm.is_active = model.is_active
  } else {
    editingModel.value = null
    modelForm.name = ''
    modelForm.model_name = ''
    modelForm.provider_id = selectedProvider.value?.id || ''
    modelForm.model_type = 'text'
    modelForm.max_tokens = undefined
    modelForm.max_output_tokens = undefined
    modelForm.embedding_dim = undefined
    modelForm.cost_per_1k_input = undefined
    modelForm.cost_per_1k_output = undefined
    modelForm.description = ''
    modelForm.supports_reasoning = false
    modelForm.thinking_format = 'none'
    modelForm.is_active = true
  }
  showModelDialog.value = true
}

const closeModelDialog = () => {
  showModelDialog.value = false
  editingModel.value = null
}

const saveModel = async () => {
  try {
    const payload = {
      ...modelForm,
      thinking_format: modelForm.supports_reasoning ? modelForm.thinking_format : 'none',
    }

    if (editingModel.value) {
      await modelStore.updateModel(editingModel.value.id, payload)
    } else {
      await modelStore.createModel(payload)
    }
    closeModelDialog()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : t('settings.saveModelFailed')
    toast.error(errorMsg)
  }
}

const confirmDeleteModelFromDialog = async () => {
  if (!editingModel.value) return

  try {
    await ElMessageBox.confirm(
      t('settings.deleteModelConfirm', { name: editingModel.value.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    await modelStore.deleteModel(editingModel.value.id)
    closeModelDialog()
  } catch (err) {
    if (err !== 'cancel') {
      const errorMsg = err instanceof Error ? err.message : t('settings.deleteModelFailed')
      toast.error(errorMsg)
    }
  }
}

watch(() => providerStore.providers, (newProviders) => {
  if (selectedProvider.value && !newProviders.find(p => p.id === selectedProvider.value!.id)) {
    selectedProvider.value = null
  }
}, { deep: true })

onMounted(() => {
  modelStore.loadModels()
  providerStore.loadProviders()
})
</script>

<style scoped>
.model-provider-tab {
  min-height: 500px;
}

.split-panel {
  display: flex;
  min-height: 500px;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.provider-panel {
  flex: 0 0 320px;
  border-right: 1px solid var(--border-color, #e0e0e0);
  background: var(--secondary-bg, #f8f9fa);
}

.model-panel {
  flex: 1;
  background: var(--card-bg, #fff);
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

.provider-list-container,
.model-list-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.provider-list,
.model-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.provider-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  background: var(--card-bg, #fff);
  border: 1px solid transparent;
  transition: all 0.2s;
}

.provider-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.provider-item.active {
  background: var(--primary-light, #e3f2fd);
  border-color: var(--primary-color, #2196f3);
}

.provider-item.inactive {
  opacity: 0.6;
}

.provider-name-btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  padding: 4px;
  min-width: 0;
}

.provider-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 4px;
  border-radius: 8px;
  background: var(--secondary-bg, #f5f5f5);
  border: 1px solid transparent;
  transition: all 0.2s;
  cursor: pointer;
}

.model-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.model-item.inactive {
  opacity: 0.6;
}

.model-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.model-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.badge.embedding {
  background: var(--primary-light-bg, #e8f4fe);
  color: var(--primary-color, #7c5c3d);
}

.loading-state,
.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-size: 14px;
}

.select-provider-hint {
  color: var(--text-tertiary, #999);
  font-style: italic;
}

@media (max-width: 768px) {
  .split-panel {
    flex-direction: column;
  }

  .provider-panel {
    flex: none;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
    max-height: 300px;
  }

  .model-panel {
    flex: none;
    width: 100%;
    max-height: 400px;
  }
}
</style>
