<template>
  <div class="target-section">
    <div class="target-header">
      <label class="field-label">{{ label }}</label>
      <el-switch v-if="optional" v-model="enabled" @change="onToggle" />
    </div>

    <template v-if="!optional || enabled">
      <div class="target-form">
        <div class="form-field">
          <label class="field-label">{{ $t('apps.stepConfig.primaryServer') }}</label>
          <el-select :model-value="target?.server" @change="onServerChange">
            <el-option v-for="s in mcpServers" :key="s.name" :value="s.name" :label="s.display_name || s.name" />
          </el-select>
        </div>
        <div class="form-field">
          <label class="field-label">{{ $t('apps.stepConfig.primaryTool') }}</label>
          <el-select :model-value="target?.tool" @change="onToolChange">
            <el-option v-for="t in currentTools" :key="t.name" :value="t.name" :label="t.name" />
          </el-select>
        </div>
      </div>

      <div v-if="currentToolParams.length > 0 && handlerOutputs.length > 0" class="params-mapping">
        <h5 class="mapping-title">{{ $t('apps.stepConfig.paramsMapping') }}</h5>
        <div class="mapping-grid">
          <div v-for="param in currentToolParams" :key="param.name" class="mapping-row">
            <div class="mapping-tool-param">
              <span class="param-name">{{ param.name }}</span>
              <span v-if="param.required" class="param-required">{{ $t('apps.stepConfig.required') }}</span>
              <span class="param-type">{{ $t('apps.stepConfig.paramType', { type: param.type || 'string' }) }}</span>
            </div>
            <span class="mapping-arrow">{{ $t('apps.stepConfig.mappingArrow') }}</span>
            <div class="mapping-handler-output">
              <el-select
                :model-value="getMapping(param.name)"
                @change="setMapping(param.name, $event)"
                clearable
                :placeholder="$t('apps.stepConfig.selectMapping')"
              >
                <el-option v-for="out in handlerOutputs" :key="out.key" :value="out.key" :label="out.label" />
              </el-select>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="target?.server && target?.tool && currentToolParams.length === 0" class="no-params-hint">
        {{ $t('apps.stepConfig.noToolParams') }}
      </div>
      <div v-else-if="target?.server && target?.tool && handlerOutputs.length === 0" class="no-params-hint">
        {{ $t('apps.stepConfig.noHandlerOutputs') }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { McpServerResource, McpResourceTarget, HandlerOutput } from '@/api/mini-apps'

const props = defineProps<{
  label: string
  target?: McpResourceTarget
  mcpServers: McpServerResource[]
  handlerOutputs: HandlerOutput[]
  optional?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:target', value: McpResourceTarget): void
  (e: 'server-change', serverName: string): void
  (e: 'tool-change'): void
}>()

const enabled = ref(!!props.target?.server)

const currentTools = computed(() => {
  if (!props.target?.server) return []
  const server = props.mcpServers.find(s => s.name === props.target!.server)
  return server?.tools || []
})

const currentToolParams = computed(() => {
  if (!props.target?.tool) return []
  const tool = currentTools.value.find(t => t.name === props.target!.tool)
  if (!tool?.input_schema?.properties) return []
  const required = tool.input_schema.required || []
  return Object.entries(tool.input_schema.properties).map(([name, schema]) => ({
    name,
    type: (schema as Record<string, string>).type || 'string',
    required: required.includes(name),
    description: (schema as Record<string, string>).description,
  }))
})

function getMapping(toolParamName: string): string {
  return props.target?.params_mapping?.[toolParamName] || ''
}

function setMapping(toolParamName: string, handlerKey: string) {
  const current = { ...props.target } as McpResourceTarget
  if (!current.params_mapping) current.params_mapping = {}
  if (handlerKey) {
    current.params_mapping[toolParamName] = handlerKey
  } else {
    delete current.params_mapping[toolParamName]
  }
  emit('update:target', current)
}

function onServerChange(serverName: string) {
  const current = { ...props.target } as McpResourceTarget
  current.server = serverName
  current.tool = ''
  current.params_mapping = {}
  emit('update:target', current)
  emit('server-change', serverName)
}

function onToolChange(toolName: string) {
  const current = { ...props.target } as McpResourceTarget
  current.tool = toolName
  current.params_mapping = {}
  emit('update:target', current)
  emit('tool-change')
}

function onToggle(val: boolean) {
  if (val) {
    emit('update:target', { server: '', tool: '', params_mapping: {} })
  } else {
    emit('update:target', { server: '', tool: '', params_mapping: {} })
  }
}

watch(() => props.target?.server, (val) => {
  if (val) enabled.value = true
})
</script>

<style scoped>
.target-section {
  border: 1px solid var(--color-border, #eee);
  border-radius: 8px;
  padding: 16px;
}

.target-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.target-header .field-label {
  margin-bottom: 0;
  font-weight: 600;
  font-size: 14px;
}

.target-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.form-field {
  display: flex;
  flex-direction: column;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--color-text-secondary, #555);
}

.params-mapping {
  border-top: 1px solid var(--color-border, #eee);
  padding-top: 12px;
}

.mapping-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 10px 0;
  color: var(--color-text-secondary, #666);
}

.mapping-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mapping-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mapping-tool-param {
  min-width: 140px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.param-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary, #333);
}

.param-required {
  color: var(--color-danger, #e74c3c);
  font-size: 12px;
}

.param-type {
  font-size: 11px;
  color: var(--color-text-secondary, #999);
  background: var(--color-bg-secondary, #f5f5f5);
  padding: 1px 6px;
  border-radius: 3px;
}

.mapping-arrow {
  color: var(--color-text-secondary, #999);
  font-size: 14px;
}

.mapping-handler-output {
  flex: 1;
}

.no-params-hint {
  font-size: 12px;
  color: var(--color-text-secondary, #999);
  font-style: italic;
}
</style>
