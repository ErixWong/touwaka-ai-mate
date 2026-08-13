<template>
  <el-dialog
    :model-value="true"
    :title="$t('apps.standardMgr.configTitle')"
    width="560px"
    @close="$emit('close')"
  >
    <el-form :model="form" label-width="140px" @submit.prevent>
      <el-form-item :label="$t('apps.standardMgr.configLLMModel')">
        <el-select
          v-model="form.llm_model_id"
          :placeholder="$t('apps.standardMgr.configLLMPlaceholder')"
          clearable
          filterable
          style="width: 100%"
        >
          <el-option :label="$t('apps.standardMgr.configUseDefault')" :value="null" />
          <el-option
            v-for="m in models"
            :key="m.id"
            :label="`${m.model_name} (${m.provider_name || ''})`"
            :value="m.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item :label="$t('apps.standardMgr.configTemperature')">
        <el-input-number v-model="form.temperature" :min="0" :max="2" :step="0.1" />
      </el-form-item>

      <div class="config-help-text">
        {{ $t('apps.standardMgr.configHelpText') }}
      </div>
    </el-form>

    <template #footer>
      <el-button @click="$emit('close')">{{ $t('apps.standardMgr.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">
        {{ $t('apps.standardMgr.save') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { modelApi } from '@/api/services'
import type { AIModel } from '@/types'
import { useToastStore } from '@/stores/toast'
import { i18n } from '@/i18n'
import { getConfig, saveConfig, type StandardMgrConfig } from '../api/standard-mgr'

const props = defineProps<{ config: StandardMgrConfig | null }>()
const emit = defineEmits<{
  close: []
  saved: [config: StandardMgrConfig]
}>()

const toast = useToastStore()
const form = reactive<StandardMgrConfig>({
  llm_model_id: props.config?.llm_model_id ?? null,
  temperature: props.config?.temperature ?? 0,
})
const models = ref<AIModel[]>([])
const saving = ref(false)

onMounted(async () => {
  try {
    const all = await modelApi.getModels()
    models.value = (all || []).filter(
      m => m.is_active !== false && (m.model_type === 'text' || m.model_type === 'multimodal'),
    )
  } catch {
    // 模型列表加载失败不阻塞弹窗
  }
})

watch(
  () => props.config,
  config => {
    if (config) {
      form.llm_model_id = config.llm_model_id ?? null
      form.temperature = config.temperature ?? 0
    }
  },
  { immediate: true },
)

async function onSave() {
  saving.value = true
  try {
    const saved = await saveConfig({ ...form })
    toast.success(i18n.global.t('apps.standardMgr.configSaved'))
    emit('saved', saved)
    emit('close')
  } catch (err: any) {
    toast.error(err?.message || i18n.global.t('apps.standardMgr.configSaveFailed'))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.config-help-text {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
</style>
