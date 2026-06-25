<template>
  <el-dialog
    :model-value="true"
    title="管理员配置"
    width="700px"
    @close="$emit('close')"
  >
    <el-tabs v-model="activeTab">
      <el-tab-pane label="模型配置" name="model">
        <el-form :model="form" label-width="120px">
          <el-form-item label="LLM 模型">
            <el-select v-model="form.llm_model_id" placeholder="选择 LLM 模型" clearable style="width: 100%">
              <el-option label="(使用系统默认)" :value="null" />
              <el-option
                v-for="m in models"
                :key="m.id"
                :label="`${m.model_name} (${m.provider_name || ''})`"
                :value="m.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="Temperature">
            <el-input-number v-model="form.temperature" :min="0" :max="2" :step="0.1" />
          </el-form-item>
          <el-form-item label="Max Tokens">
            <el-input-number v-model="form.max_tokens" :min="100" :max="100000" :step="100" />
          </el-form-item>
          <el-form-item label="超时(ms)">
            <el-input-number v-model="form.timeout_ms" :min="5000" :max="300000" :step="5000" />
          </el-form-item>
          <el-form-item label="重试次数">
            <el-input-number v-model="form.retry_times" :min="0" :max="5" />
          </el-form-item>
          <el-form-item label="JSON 修复">
            <el-switch v-model="form.enable_json_repair" />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="分析参数" name="params">
        <el-form :model="form" label-width="150px">
          <el-form-item label="绝对分辨率">
            <el-input-number v-model="form.absolute_resolution" :min="0.001" :max="1" :step="0.01" />
          </el-form-item>
          <el-form-item label="相对分辨率">
            <el-input-number v-model="form.relative_resolution" :min="0.001" :max="1" :step="0.01" />
          </el-form-item>
          <el-form-item label="合并间隙比例">
            <el-input-number v-model="form.merge_gap_ratio" :min="0.1" :max="1" :step="0.1" />
          </el-form-item>
          <el-form-item label="最小过渡点数">
            <el-input-number v-model="form.min_transition_points" :min="1" :max="20" :step="1" />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="Prompt 与输出约束" name="prompt">
        <el-form :model="form" label-width="120px">
          <el-form-item label="Prompt 模板">
            <el-input v-model="form.analysis_prompt_template" type="textarea" :rows="4" placeholder="自定义分析 Prompt" />
          </el-form-item>
          <el-form-item label="JSON Schema">
            <el-input v-model="form.json_output_schema" type="textarea" :rows="6" placeholder="LLM 输出 JSON Schema" />
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="$emit('close')">取消</el-button>
      <el-button type="primary" @click="onSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { modelApi } from '@/api/services'
import type { AIModel } from '@/types'
import type { AppConfig } from '@/api/current-feature-analyzer'

const props = defineProps<{ config: AppConfig | null }>()
const emit = defineEmits<{ close: []; save: [config: AppConfig] }>()

const activeTab = ref('model')
const form = reactive<Record<string, unknown>>({ ...(props.config || {}) })
const models = ref<AIModel[]>([])

onMounted(async () => {
  try {
    const all = await modelApi.getModels()
    models.value = (all || []).filter(m => m.is_active !== false && m.model_type === 'text')
  } catch {
    // noop
  }
})

watch(
  () => props.config,
  (config) => {
    if (config) {
      Object.assign(form, config)
    }
  },
  { immediate: true }
)

function onSave() {
  emit('save', { ...form })
}
</script>
