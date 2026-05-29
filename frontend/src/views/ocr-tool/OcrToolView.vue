<template>
  <div class="ocr-tool-page">
    <!-- 复制成功浮窗 -->
    <Teleport to="body">
      <div v-if="showToast" class="toast-overlay" @click="closeToast">
        <div class="toast-popup" @click.stop>
          <span class="toast-icon">✓</span>
          <span class="toast-message">复制成功</span>
          <button class="toast-close" @click="closeToast">×</button>
        </div>
      </div>
    </Teleport>

    <!-- 配置对话框 -->
    <Teleport to="body">
      <div v-if="showConfigDialog" class="config-overlay" @click.self="showConfigDialog = false">
        <div class="config-dialog">
          <div class="config-header">
            <h3>OCR 配置</h3>
            <button class="btn-close" @click="showConfigDialog = false">×</button>
          </div>
          <div class="config-body">
            <div class="config-field">
              <label>VLM 模型</label>
              <el-select v-model="configData.vlm_model_id" clearable placeholder="自动选择">
                <el-option v-for="m in multimodalModels" :key="m.id" :value="m.id" :label="m.name" />
              </el-select>
              <span class="hint">未选择时自动使用第一个可用的多模态模型</span>
            </div>
            <div class="config-field">
              <label>识别温度</label>
              <el-slider v-model="configData.vlm_temperature" :min="0" :max="1" :step="0.1" show-input />
              <span class="hint">较低值输出更稳定，较高值更有创意</span>
            </div>
            <div class="config-field">
              <label>超时时间 (秒)</label>
              <el-input-number v-model="configData.vlm_timeout_sec" :min="30" :max="300" :step="10" />
            </div>
          </div>
          <div class="config-footer">
            <el-button @click="showConfigDialog = false">取消</el-button>
            <el-button type="primary" @click="saveConfig">保存</el-button>
          </div>
        </div>
      </div>
    </Teleport>

<!-- 识别中提示 -->
    <Teleport to="body">
      <div v-if="isProcessing" class="processing-overlay">
        <div class="processing-modal">
          <div class="processing-spinner">
            <el-icon class="spin-icon"><Loading /></el-icon>
          </div>
          <p class="processing-text">识别中，请稍候 <span class="processing-time">{{ elapsedTime }}s</span></p>
          <p class="processing-dots">{{ pollingDots }}</p>
        </div>
      </div>
    </Teleport>

<!-- 全屏预览图片 -->
    <Teleport to="body">
      <div v-if="showFullscreen && previewUrl" class="fullscreen-overlay" @click="showFullscreen = false">
        <div class="fullscreen-content" @click.stop>
          <img :src="previewUrl" alt="preview" />
          <el-icon class="close-btn" @click="showFullscreen = false"><Close /></el-icon>
        </div>
      </div>
    </Teleport>

    <section class="hero">
      <div class="hero-left">
        <p class="eyebrow">OCR TOOL</p>
        <h1><el-icon class="title-icon"><Camera /></el-icon> 文本提取器</h1>
      </div>
      <div class="hero-right">
        <span>支持 JPG/PNG/WEBP 图片，自动提取文字内容</span>
        <span class="hint-text">不记录识别历史，请及时保存 · 识别结果仅供参考</span>
      </div>
      <button v-if="isAdmin" class="config-btn" @click="openConfigDialog" title="配置">
        <el-icon><Setting /></el-icon>
      </button>
    </section>

    <section class="workspace">
      <el-card class="panel upload-panel">
        <template #header>
          <div class="panel-header">
            <span>上传图片</span>
            <span class="panel-hint">支持 JPG / PNG / JPEG / WEBP</span>
          </div>
        </template>

        <div class="dropzone-wrapper">
          <label class="dropzone" :class="{ filled: !!previewUrl }">
            <input type="file" accept="image/*" @change="handleFileChange" />
            <div v-if="!previewUrl" class="placeholder">
              <el-icon class="upload-icon"><Upload /></el-icon>
              <div>
                <strong>选择图片</strong>
                <p>或拖拽到此处</p>
                <p class="paste-hint">或点击按钮从剪贴板粘贴</p>
              </div>
            </div>
            <img v-else :src="previewUrl" alt="preview" />
          </label>
          <div class="dropzone-actions">
            <el-button type="info" plain size="small" @click="handlePasteFromClipboard">
              <el-icon><Document /></el-icon>
              剪贴板粘贴
            </el-button>
            <el-button v-if="previewUrl" size="small" @click="showFullscreen = true">
              <el-icon><ZoomIn /></el-icon>
              放大
            </el-button>
          </div>
        </div>

        <div class="field">
          <label>输出格式</label>
          <el-select v-model="selectedPresetId" class="preset-select" placeholder="选择输出格式">
            <el-option
              v-for="preset in promptPresets"
              :key="preset.id"
              :label="preset.label"
              :value="preset.id"
            />
          </el-select>
        </div>

        <div class="actions">
          <el-button type="primary" :loading="isSubmitting" :disabled="!previewUrl" @click="submit">
            {{ isSubmitting ? '提交中...' : '开始识别' }}
          </el-button>
          <el-button :disabled="!previewUrl && !taskId" @click="reset">
            重置
          </el-button>
        </div>
      </el-card>

      <el-card class="panel result-panel">
        <template #header>
          <div class="panel-header">
            <span>识别结果</span>
            <span v-if="elapsedTime > 0" class="elapsed-time">用时 {{ elapsedTime }} 秒</span>
            <el-button v-if="result" link type="primary" size="small" @click="copyResult">复制文本</el-button>
            <el-button v-if="showCopyAsExcel && result" link type="primary" size="small" @click="copyAsExcel">复制表格</el-button>
          </div>
        </template>

        <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />

        <div v-if="result" class="result-markdown" v-html="renderedResult"></div>
        <div v-else class="result-placeholder">识别结果会显示在这里...</div>
      </el-card>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { marked } from 'marked'
import { ElMessage } from 'element-plus'
import { Upload, WarningFilled, InfoFilled, Setting, Loading, Camera, ZoomIn, Close, Document } from '@element-plus/icons-vue'
import { analyzeOcrImage, getOcrStatus, getOcrPromptPresets, type OcrPromptPreset } from '@/api/ocr-tool'
import { getAppConfig, updateAppConfig } from '@/api/mini-apps'
import { modelApi } from '@/api/services'
import { useRoute } from 'vue-router'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const toast = useToastStore()
const userStore = useUserStore()
const appId = route.params.appId as string

const isAdmin = computed(() => userStore.isAdmin)
const pollingDots = computed(() => '.'.repeat(Math.min(pollingCount.value, 6)))

const previewUrl = ref('')
const taskId = ref('')
const status = ref<'idle' | 'pending' | 'processing' | 'done' | 'error'>('idle')
const result = ref('')
const promptPresets = ref<OcrPromptPreset[]>([])
const selectedPresetId = ref('text')
const error = ref('')
const isSubmitting = ref(false)
const isProcessing = ref(false)
const pollingCount = ref(0)
const elapsedTime = ref(0)
const showToast = ref(false)
const showConfigDialog = ref(false)
const showFullscreen = ref(false)
let defaultPresetId = 'text'
const multimodalModels = ref<{ id: string; name: string }[]>([])
const configData = ref({
  vlm_model_id: '',
  vlm_temperature: 0.2,
  vlm_timeout_sec: 120,
})

let pollTimer: number | null = null
let toastTimer: number | null = null
let elapsedTimer: number | null = null

function showCopySuccess() {
  showToast.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    showToast.value = false
  }, 1500)
}

function closeToast() {
  showToast.value = false
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

const statusLabel = computed(() => {
  switch (status.value) {
    case 'pending': return '排队中'
    case 'processing': return '识别中'
    case 'done': return '已完成'
    case 'error': return '失败'
    default: return '等待上传'
  }
})

const statusTagType = computed(() => {
  switch (status.value) {
    case 'pending': return 'info'
    case 'processing': return 'warning'
    case 'done': return 'success'
    case 'error': return 'danger'
    default: return 'info'
  }
})

// 只有选择表格格式时才显示"复制为表格"按钮
const showCopyAsExcel = computed(() => {
  return selectedPresetId.value === 'table'
})

// 配置 marked 选项
marked.setOptions({
  breaks: true,
  gfm: true,
})

// 渲染 Markdown 结果
const renderedResult = computed(() => {
  if (!result.value) return ''
  
  // 去掉 VLM 返回的代码块标记 ```markdown 和 ```
  let text = result.value
  text = text.replace(/^```markdown\s*/g, '').replace(/```$/g, '').trim()
  
  return marked.parse(text) as string
})

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

function loadImageFile(file: File) {
  const reader = new FileReader()
  reader.onerror = () => {
    ElMessage.error('图片读取失败，请重试')
  }
  reader.onload = () => {
    previewUrl.value = String(reader.result || '')
    result.value = ''
    error.value = ''
    status.value = 'idle'
    taskId.value = ''
  }
  reader.readAsDataURL(file)
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件')
    return
  }

  if (file.size > MAX_IMAGE_SIZE) {
    ElMessage.error('图片大小不能超过 5MB，请压缩后重试')
    return
  }

  loadImageFile(file)
}

async function handlePasteFromClipboard() {
  if (navigator.clipboard && navigator.clipboard.read) {
    try {
      const clipboardItems = await navigator.clipboard.read()
      for (const item of clipboardItems) {
        const imageType = item.types.find(t => t.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          if (blob.size > MAX_IMAGE_SIZE) {
            ElMessage.error('图片大小不能超过 5MB，请压缩后重试')
            return
          }
          const file = new File([blob], 'clipboard-image.png', { type: imageType })
          loadImageFile(file)
          return
        }
      }
      ElMessage.warning('剪贴板中没有图片')
      return
    } catch {
      // Clipboard API 失败，继续尝试 paste 事件
    }
  }

  ElMessage.info('请在页面任意位置按 Ctrl+V 粘贴图片')
  const pasteHandler = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) return
        if (file.size > MAX_IMAGE_SIZE) {
          ElMessage.error('图片大小不能超过 5MB，请压缩后重试')
          return
        }
        loadImageFile(file)
        document.removeEventListener('paste', pasteHandler)
        return
      }
    }
  }
  document.addEventListener('paste', pasteHandler)
  setTimeout(() => document.removeEventListener('paste', pasteHandler), 10000)
}

// 处理粘贴事件，支持 Ctrl+V 粘贴图片
async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) return

      if (file.size > MAX_IMAGE_SIZE) {
        ElMessage.error('图片大小不能超过 5MB，请压缩后重试')
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        previewUrl.value = String(reader.result || '')
        result.value = ''
        error.value = ''
        status.value = 'idle'
        taskId.value = ''
      }
      reader.readAsDataURL(file)
      return
    }
  }
}

async function submit() {
  if (!previewUrl.value) return
  isSubmitting.value = true
  isProcessing.value = true
  pollingCount.value = 0
  elapsedTime.value = 0
  error.value = ''
  result.value = ''

  // 启动计时器
  elapsedTimer = window.setInterval(() => {
    elapsedTime.value++
  }, 1000)

  // Get the prompt from selected preset
  const selectedPreset = promptPresets.value.find(p => p.id === selectedPresetId.value)
  const promptText = selectedPreset?.prompt || ''

  try {
    const res = await analyzeOcrImage(previewUrl.value, promptText)
    taskId.value = res.task_id
    status.value = res.status as typeof status.value
    startPolling()
  } catch (err: any) {
    error.value = err?.message || '提交失败'
    status.value = 'error'
    stopPolling()
    stopElapsedTimer()
  } finally {
    isSubmitting.value = false
  }
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    window.clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

function startPolling() {
  stopPolling()
  pollTimer = window.setInterval(async () => {
    if (!taskId.value) return
    pollingCount.value++
    try {
      const res = await getOcrStatus(taskId.value)
      status.value = res.status as typeof status.value
      result.value = res.result || ''
      error.value = res.error || ''
      if (status.value === 'done' || status.value === 'error') {
        stopPolling()
        stopElapsedTimer()
        isProcessing.value = false
      }
    } catch (err: any) {
      error.value = err?.message || '状态查询失败'
      status.value = 'error'
      stopPolling()
      stopElapsedTimer()
      isProcessing.value = false
    }
  }, 2000)
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

function reset() {
  previewUrl.value = ''
  taskId.value = ''
  status.value = 'idle'
  result.value = ''
  error.value = ''
  selectedPresetId.value = defaultPresetId
  stopPolling()
}

function copyToClipboard(text: string): boolean {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => true).catch(() => false)
    return true
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const success = document.execCommand('copy')
  document.body.removeChild(textarea)
  return success
}

async function copyResult() {
  copyToClipboard(result.value)
  showCopySuccess()
}

async function copyAsExcel() {
  let tabSeparated = result.value
  tabSeparated = tabSeparated.replace(/^```markdown\s*/g, '').replace(/```$/g, '').trim()
  
  const lines = tabSeparated.split('\n')
  const processedLines = lines.map(line => {
    if (line.includes('|')) {
      let content = line.trim()
      if (content.startsWith('|')) content = content.slice(1)
      if (content.endsWith('|')) content = content.slice(0, -1)
      return content.split('|').map(s => s.trim()).join('\t')
    }
    return line
  })
  
  tabSeparated = processedLines.join('\n')
  copyToClipboard(tabSeparated)
  showCopySuccess()
}

onBeforeUnmount(() => {
  stopPolling()
  stopElapsedTimer()
  document.removeEventListener('paste', handlePaste)
})

async function openConfigDialog() {
  try {
    const config = await getAppConfig(appId)
    configData.value = {
      vlm_model_id: config.vlm_model_id || '',
      vlm_temperature: config.vlm_temperature ?? 0.2,
      vlm_timeout_sec: Math.floor((config.vlm_timeout_ms ?? 120000) / 1000),
    }
    // 加载可用的 multimodal 模型列表
    const models = await modelApi.getModels()
    multimodalModels.value = models.filter(m => m.model_type === 'multimodal').map(m => ({ id: m.id, name: m.name }))
  } catch (err) {
    console.error('Failed to load config:', err)
  }
  showConfigDialog.value = true
}

async function saveConfig() {
  try {
    await updateAppConfig(appId, {
      vlm_model_id: configData.value.vlm_model_id || undefined,
      vlm_temperature: configData.value.vlm_temperature,
      vlm_timeout_ms: configData.value.vlm_timeout_sec * 1000,
    })
    toast.success('配置已保存')
    showConfigDialog.value = false
  } catch (err: any) {
    toast.error('保存失败: ' + err.message)
  }
}

onMounted(async () => {
  try {
    const res = await getOcrPromptPresets()
    promptPresets.value = res.presets || []
    defaultPresetId = res.defaultId || promptPresets.value[0]?.id || 'text'
    selectedPresetId.value = defaultPresetId
  } catch (err) {
    console.error('Failed to load prompt presets:', err)
  }

  // 监听粘贴事件，支持 Ctrl+V 粘贴图片
  document.addEventListener('paste', handlePaste)
})

watch(showFullscreen, (val) => {
  document.body.style.overflow = val ? 'hidden' : ''
})
</script>

<style scoped>
.ocr-tool-page {
  padding: 24px;
  width: 80%;
  max-width: 1400px;
  margin: 0 auto;
  font-family: "Space Grotesk", "Noto Sans SC", sans-serif;
  color: #1b1f2a;
}

.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 24px;
  border-radius: 12px;
  background: linear-gradient(135deg, #f7f1ff 0%, #eef6ff 100%);
}

.hero-left {
  flex: 0 0 auto;
}

.hero-left h1 {
  margin: 4px 0 0;
  font-size: 24px;
  letter-spacing: -0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-icon {
  font-size: 24px;
  color: #409eff;
}

.eyebrow {
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #7d6a5a;
  margin: 0;
}

.hero-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #666;
  font-size: 13px;
}

.hero-right .hint-text {
  color: #999;
  font-size: 12px;
}

.config-btn {
  background: rgba(255, 255, 255, 0.9);
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.config-btn:hover {
  background: #fff;
  transform: scale(1.1);
}

.config-btn .el-icon {
  font-size: 18px;
  color: #4b566b;
}

.workspace {
  display: flex;
  flex-direction: row;
  gap: 20px;
  margin-top: 20px;
}

.upload-panel {
  flex: 0 0 40%;
  min-width: 300px;
}

.result-panel {
  flex: 1;
  min-width: 400px;
}

.panel {
  animation: fadeIn 0.4s ease;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header span:first-child {
  font-size: 18px;
  font-weight: 600;
}

.panel-hint {
  font-size: 13px;
  color: #909399;
  font-weight: normal;
}

.elapsed-time {
  font-size: 13px;
  color: #67c23a;
  font-weight: 500;
}

.task-id {
  font-size: 12px;
  color: #909399;
  font-family: monospace;
}

.dropzone {
  margin: 16px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed #cdd7ef;
  border-radius: 8px;
  width: 100%;
  height: 350px;
  background: #f7f9ff;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
}

.dropzone:hover {
  border-color: #409eff;
}

.dropzone.filled {
  border-style: solid;
  border-color: #67c23a;
}

.dropzone input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.dropzone img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #fff;
}

.dropzone-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dropzone-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.upload-icon {
  font-size: 48px;
  color: #909399;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #606266;
}

.placeholder strong {
  font-size: 16px;
}

.placeholder p {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

.placeholder .paste-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #c0c4cc;
}

.field {
  margin-top: 16px;
}

.field label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.preset-select {
  width: 100%;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 0 8px;
  flex-shrink: 0;
}

.copy-buttons {
  display: flex;
  gap: 8px;
}

.result-box {
  width: 100%;
  flex: 1;
  min-height: 450px;
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
  margin-top: 10px;
}

/* Markdown 渲染结果样式 */
.result-markdown {
  width: 100%;
  max-height: 500px;
  overflow-y: auto;
  margin-top: 10px;
  padding: 12px;
  background: #fafafa;
  border-radius: 8px;
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
  font-size: 14px;
  line-height: 1.6;
}

.result-placeholder {
  width: 100%;
  height: 100%;
  min-height: 500px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
}

.result-markdown :deep(h1),
.result-markdown :deep(h2),
.result-markdown :deep(h3),
.result-markdown :deep(h4),
.result-markdown :deep(h5),
.result-markdown :deep(h6) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
}

.result-markdown :deep(p) {
  margin: 8px 0;
}

.result-markdown :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.result-markdown :deep(th),
.result-markdown :deep(td) {
  border: 1px solid #ddd;
  padding: 8px 12px;
  text-align: left;
}

.result-markdown :deep(th) {
  background: #f5f5f5;
  font-weight: 600;
}

.result-markdown :deep(code) {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
}

.result-markdown :deep(pre) {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}

.result-markdown :deep(pre code) {
  background: none;
  padding: 0;
}

.result-markdown :deep(ul),
.result-markdown :deep(ol) {
  padding-left: 24px;
  margin: 8px 0;
}

.result-placeholder {
  width: 100%;
  flex: 1;
  min-height: 450px;
  margin-top: 10px;
  padding: 12px;
  background: #fafafa;
  border-radius: 8px;
  color: #999;
  font-size: 14px;
}

/* 底部说明样式 */
.disclaimer {
  margin-top: 16px;
  padding: 16px;
  background: #f8f9fc;
  border-radius: 8px;
  border: 1px solid #e8ecf0;
}

.disclaimer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #666;
  font-size: 13px;
  line-height: 1.8;
}

.disclaimer-item .el-icon {
  color: #909399;
  font-size: 16px;
}

/* 复制成功浮窗样式 */
.toast-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.toast-popup {
  background: #ffffff;
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  animation: toastIn 0.2s ease;
}

.toast-icon {
  color: #22c55e;
  font-size: 18px;
  font-weight: bold;
}

.toast-message {
  color: #1b1f2a;
  font-size: 15px;
  font-weight: 500;
}

.toast-close {
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 20px;
  cursor: pointer;
  padding: 0 0 0 12px;
  line-height: 1;
}

.toast-close:hover {
  color: #6b7280;
}

@keyframes toastIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 900px) {
  .ocr-tool-page {
    width: 95%;
  }
  .workspace {
    flex-direction: column;
  }
  .upload-panel {
    flex: none;
    min-width: auto;
  }
  .result-panel {
    min-width: auto;
  }
}

@media (max-width: 720px) {
  .hero {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .hero-right {
    flex-direction: column;
  }
  .dropzone {
    min-height: 220px;
  }
  .result-box {
    min-height: 220px;
  }
}

/* 配置对话框 */

.config-overlay {
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

.config-dialog {
  background: #fff;
  border-radius: 16px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #eee;
}

.config-header h3 {
  margin: 0;
  font-size: 18px;
}

.btn-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #999;
}

.config-body {
  padding: 24px;
}

.config-field {
  margin-bottom: 20px;
}

.config-field label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
}

.config-field .el-select {
  width: 100%;
}

.config-field .hint {
  display: block;
  font-size: 12px;
  color: #999;
  margin-top: 6px;
}

.config-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid #eee;
}

/* 识别中提示 */
.processing-overlay {
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

.processing-modal {
  background: #fff;
  border-radius: 16px;
  padding: 32px 48px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.processing-spinner {
  margin-bottom: 16px;
}

.spin-icon {
  font-size: 48px;
  color: #409eff;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.processing-text {
  font-size: 18px;
  color: #333;
  margin: 0 0 8px 0;
}

.processing-time {
  font-weight: 600;
  color: #409eff;
}

.processing-dots {
  font-size: 24px;
  color: #409eff;
  margin: 0;
  letter-spacing: 4px;
}

/* 全屏预览 */
.fullscreen-preview-dialog :deep(.el-dialog__header) {
  display: none;
}

.fullscreen-preview-dialog :deep(.el-dialog__body) {
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

.fullscreen-content img {
  max-height: 80vh;
  object-fit: contain;
}
</style>
}

.fullscreen-content img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
}
</style>
