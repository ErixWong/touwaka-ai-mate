<template>
  <div v-if="visible" class="dialog-overlay" @click.self="close">
    <div class="dialog dialog-large">
      <div class="dialog-header">
        <h3>{{ $t('apps.stepConfig.title') }}</h3>
        <el-button @click="close">×</el-button>
      </div>
      <div class="dialog-body">
        <div v-if="isLoading" class="loading-state">{{ $t('common.loading') }}</div>
        <template v-else>
          <div v-for="step in handlerSteps" :key="step.name" class="step-section">
            <h4 class="step-title">{{ step.label }}</h4>
            <div class="step-form">
              <div class="form-field span-2">
                <label class="field-label">{{ $t('apps.stepConfig.resourceType') }}</label>
                <el-select v-model="formData[step.name].type" @change="onTypeChange(step.name)">
                  <el-option value="mcp" :label="$t('apps.stepConfig.mcp')" />
                  <el-option value="internal_llm" :label="$t('apps.stepConfig.internalLlm')" />
                </el-select>
              </div>

              <template v-if="formData[step.name].type === 'mcp'">
                <McpTargetConfig
                  :label="$t('apps.stepConfig.primaryServer')"
                  :target="formData[step.name].primary"
                  :mcp-servers="mcpServers"
                  :handler-outputs="getHandlerOutputs(step)"
                  @update:target="formData[step.name].primary = $event"
                  @server-change="onServerChange(step.name, 'primary', $event)"
                  @tool-change="onToolChange(step.name, 'primary')"
                />
                <McpTargetConfig
                  :label="$t('apps.stepConfig.fallbackServer')"
                  :target="formData[step.name].fallback"
                  :mcp-servers="mcpServers"
                  :handler-outputs="getHandlerOutputs(step)"
                  :optional="true"
                  @update:target="formData[step.name].fallback = $event"
                  @server-change="onServerChange(step.name, 'fallback', $event)"
                  @tool-change="onToolChange(step.name, 'fallback')"
                />
              </template>

              <template v-if="formData[step.name].type === 'internal_llm'">
                <div class="form-field span-2">
                  <label class="field-label">{{ $t('apps.stepConfig.temperature') }}</label>
                  <el-slider v-model="formData[step.name].temperature" :min="0" :max="1" :step="0.1" show-input />
                </div>
              </template>
            </div>
          </div>

          <div v-if="handlerSteps.length === 0" class="empty-state">
            <p>{{ $t('apps.stepConfig.noHandlerSteps') }}</p>
          </div>
        </template>
      </div>
      <div class="dialog-footer">
        <el-button @click="close">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="save" :disabled="isSaving">{{ isSaving ? $t('common.saving') : $t('common.save') }}</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useToastStore } from '@/stores/toast'
import { useI18n } from 'vue-i18n'
import {
  getAppConfig,
  updateAppConfig,
  getAvailableResources,
  type MiniApp,
  type AppState,
  type StepResourceConfig,
  type McpServerResource,
  type McpResourceTarget,
  type HandlerOutput,
} from '@/api/mini-apps'
import McpTargetConfig from './McpTargetConfig.vue'

const props = defineProps<{
  visible: boolean
  app: MiniApp
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const { t } = useI18n()
const toast = useToastStore()

const isLoading = ref(false)
const isSaving = ref(false)
const mcpServers = ref<McpServerResource[]>([])
const handlerOutputsMap = ref<Record<string, HandlerOutput[]>>({})
const formData = ref<Record<string, StepResourceConfig>>({})

const states = computed<AppState[]>(() => {
  return props.app.states || []
})

const handlerSteps = computed(() => {
  return states.value.filter(s => s.handler_id)
})

function getHandlerOutputs(step: AppState): HandlerOutput[] {
  if (!step.handler_id) return []
  return handlerOutputsMap.value[step.handler_id] || []
}

function getToolsForServer(serverName: string) {
  const server = mcpServers.value.find(s => s.name === serverName)
  return server?.tools || []
}

function onTypeChange(stepName: string) {
  const cfg = formData.value[stepName]
  if (cfg.type === 'mcp') {
    cfg.primary = cfg.primary || { server: '', tool: '', params_mapping: {} }
    cfg.fallback = cfg.fallback || { server: '', tool: '', params_mapping: {} }
  }
}

function onServerChange(stepName: string, role: 'primary' | 'fallback', serverName: string) {
  const cfg = formData.value[stepName]
  const target = role === 'primary' ? cfg.primary : cfg.fallback
  if (!target) return
  target.server = serverName
  const tools = getToolsForServer(serverName)
  target.tool = tools.length > 0 ? tools[0].name : ''
  target.params_mapping = {}
}

function onToolChange() {
  // tool changed, params_mapping will be re-evaluated by McpTargetConfig
}

function ensureTarget(target: McpResourceTarget | undefined): McpResourceTarget {
  return target || { server: '', tool: '', params_mapping: {} }
}

async function loadData() {
  isLoading.value = true
  try {
    const [config, resources] = await Promise.all([
      getAppConfig(props.app.id),
      getAvailableResources(props.app.id),
    ])

    mcpServers.value = resources.mcp_servers || []
    handlerOutputsMap.value = resources.handler_outputs || {}

    const stepResources = config.step_resources || {}
    const initial: Record<string, StepResourceConfig> = {}
    for (const step of handlerSteps.value) {
      const saved = stepResources[step.name]
      if (saved) {
        if (saved.primary) saved.primary = ensureTarget(saved.primary)
        if (saved.fallback) saved.fallback = ensureTarget(saved.fallback)
      }
      initial[step.name] = saved || {
        type: 'mcp',
        primary: { server: '', tool: '', params_mapping: {} },
        fallback: { server: '', tool: '', params_mapping: {} },
      }
    }
    formData.value = initial
  } catch (error) {
    console.error('Failed to load step config:', error)
  } finally {
    isLoading.value = false
  }
}

async function save() {
  isSaving.value = true
  try {
    await updateAppConfig(props.app.id, { step_resources: formData.value })
    toast.success(t('apps.stepConfig.saveSuccess'))
    emit('saved')
    close()
  } catch (error) {
    console.error('Failed to save step config:', error)
    toast.error(t('apps.stepConfig.saveFailed'))
  } finally {
    isSaving.value = false
  }
}

function close() {
  emit('close')
}

watch(() => props.visible, (val) => {
  if (val) {
    loadData()
  }
})
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.dialog {
  background: var(--color-bg-primary, #fff);
  border-radius: 12px;
  width: 100%;
  max-width: 640px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.dialog-large {
  max-width: 800px;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.dialog-body {
  padding: 20px;
  overflow: auto;
  flex: 1;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border, #e0e0e0);
}

.step-section {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--color-border, #eee);
}

.step-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.step-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: var(--color-text-primary, #333);
}

.step-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-field {
  display: flex;
  flex-direction: column;
}

.form-field.span-2 {
  width: 100%;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--color-text-secondary, #555);
}

.loading-state {
  text-align: center;
  padding: 40px;
  color: var(--color-text-secondary, #666);
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--color-text-secondary, #666);
}
</style>
