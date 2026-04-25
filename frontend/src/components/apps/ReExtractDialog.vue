<template>
  <div v-if="visible" class="dialog-overlay" @click.self="handleClose">
    <div class="dialog dialog-large">
      <div class="dialog-header">
        <h3>{{ $t('apps.reExtract.title') }}</h3>
        <el-button @click="handleClose">×</el-button>
      </div>
      
      <div class="dialog-body">
        <el-tabs v-model="activeTab">
          <el-tab-pane :label="$t('apps.reExtract.lastPrompt')" name="prompt">
            <div class="prompt-section">
              <div class="prompt-label">{{ $t('apps.reExtract.lastPrompt') }}</div>
              <div class="prompt-box">{{ lastPrompt }}</div>
            </div>
            
            <div class="prompt-section">
              <div class="prompt-label">{{ $t('apps.reExtract.newPrompt') }}</div>
              <el-input
                v-model="newPrompt"
                type="textarea"
                :rows="6"
                :placeholder="$t('apps.reExtract.useLast')"
              />
            </div>
            
            <div class="prompt-section">
              <div class="prompt-label">{{ $t('apps.reExtract.lastResult') }}</div>
              <div class="result-box">
                <pre>{{ formatJson(lastResult) }}</pre>
              </div>
            </div>
            
            <div class="text-preview">
              <div class="preview-label">{{ $t('apps.documentContent.filteredText') || '过滤后文本' }}</div>
              <div class="preview-box">{{ previewText }}</div>
            </div>
          </el-tab-pane>
          
          <el-tab-pane v-if="comparisonMode" :label="$t('apps.reExtract.comparison')" name="comparison">
            <div class="comparison-layout">
              <div class="comparison-side">
                <div class="comparison-header">{{ $t('apps.reExtract.last') }}</div>
                <div class="comparison-content">
                  <pre>{{ formatJson(lastResult) }}</pre>
                </div>
              </div>
              <div class="comparison-side">
                <div class="comparison-header">{{ $t('apps.reExtract.current') }}</div>
                <div class="comparison-content">
                  <pre>{{ formatJson(currentResult) }}</pre>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
      
      <div class="dialog-footer">
        <el-button @click="handleClose">{{ $t('common.cancel') }}</el-button>
        <el-button
          v-if="!comparisonMode"
          type="primary"
          :loading="isProcessing"
          @click="handleExtract"
        >
          {{ isProcessing ? $t('apps.reExtract.processing') : $t('apps.reExtract.useLast') }}
        </el-button>
        <el-button
          v-if="comparisonMode"
          type="primary"
          @click="handleConfirm"
        >
          {{ $t('apps.reExtract.confirm') }}
        </el-button>
        <el-button
          v-if="comparisonMode"
          type="warning"
          @click="handleAbandon"
        >
          {{ $t('apps.reExtract.abandon') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import apiClient, { apiRequest } from '@/api/client'

interface Props {
  visible: boolean
  appId: string
  recordId: string
  lastPrompt?: string
  lastResult?: Record<string, unknown>
  filteredText?: string
}

const props = withDefaults(defineProps<Props>(), {
  lastPrompt: '',
  lastResult: () => {},
  filteredText: ''
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', result: Record<string, unknown>): void
}>()

const { t } = useI18n()
const activeTab = ref('prompt')
const newPrompt = ref('')
const comparisonMode = ref(false)
const currentResult = ref<Record<string, unknown> | null>(null)
const isProcessing = ref(false)

const previewText = computed(() => {
  return props.filteredText || t('apps.documentContent.noContent')
})

watch(() => props.visible, (val) => {
  if (val) {
    activeTab.value = 'prompt'
    newPrompt.value = props.lastPrompt
    comparisonMode.value = false
    currentResult.value = null
  }
})

function formatJson(obj: Record<string, unknown> | null | undefined): string {
  if (!obj) return ''
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

async function handleExtract() {
  isProcessing.value = true
  try {
    const promptToUse = newPrompt.value.trim() || props.lastPrompt
    const result = await apiRequest<{ data: Record<string, unknown> }>(
      apiClient.post(`/mini-apps/${props.appId}/rows/${props.recordId}/re-extract`, {
        prompt: promptToUse
      })
    )
    currentResult.value = result.data || result
    comparisonMode.value = true
    activeTab.value = 'comparison'
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : t('apps.reExtract.processing')
    ElMessage.error(errorMsg)
  } finally {
    isProcessing.value = false
  }
}

function handleConfirm() {
  if (currentResult.value) {
    emit('confirm', currentResult.value)
  }
}

function handleAbandon() {
  comparisonMode.value = false
  activeTab.value = 'prompt'
  currentResult.value = null
}

function handleClose() {
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
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.dialog {
  background: white;
  border-radius: 8px;
  max-width: 800px;
  width: 90%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.dialog-large {
  max-width: 900px;
  width: 95%;
}

.dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
}

.dialog-body {
  padding: 20px;
  flex: 1;
  overflow-y: auto;
}

.dialog-footer {
  padding: 16px 20px;
  border-top: 1px solid #e4e7ed;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.prompt-section {
  margin-bottom: 16px;
}

.prompt-label {
  font-weight: 500;
  margin-bottom: 8px;
  color: #303133;
}

.prompt-box,
.result-box,
.preview-box {
  padding: 12px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}

.result-box pre {
  margin: 0;
  font-family: 'Courier New', monospace;
}

.text-preview {
  margin-top: 16px;
}

.preview-label {
  font-weight: 500;
  margin-bottom: 8px;
  color: #303133;
}

.comparison-layout {
  display: flex;
  gap: 16px;
}

.comparison-side {
  flex: 1;
}

.comparison-header {
  font-weight: 500;
  margin-bottom: 8px;
  padding: 8px;
  background: #ecf5ff;
  border-radius: 4px;
}

.comparison-content {
  padding: 12px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  max-height: 400px;
  overflow-y: auto;
}

.comparison-content pre {
  margin: 0;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}
</style>