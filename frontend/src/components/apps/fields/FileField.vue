<template>
  <div class="file-field">
    <div v-if="modelValue" class="file-preview">
      <div class="file-info">
        <span class="file-icon">📄</span>
        <span class="file-name">{{ (modelValue as any).name || modelValue }}</span>
      </div>
      <button class="btn-remove" @click="clearFile" type="button">×</button>
    </div>
    <div v-else class="file-upload">
      <input
        ref="fileInput"
        type="file"
        :accept="accept"
        @change="handleFileChange"
        class="file-input"
      />
      <div class="upload-trigger" @click="triggerUpload">
        <span class="upload-icon">+</span>
        <span class="upload-text">{{ placeholder || '点击上传文件' }}</span>
      </div>
    </div>
    <div v-if="uploading" class="upload-progress">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <span class="progress-text">{{ progress }}%</span>
    </div>
    <div v-if="error" class="upload-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useToastStore } from '@/stores/toast'
import apiClient from '@/api/client'
import type { AppField } from '@/api/mini-apps'

const props = defineProps<{
  field: AppField
  modelValue: unknown
  readonly?: boolean
  app?: { id: string }
  recordId?: string
}>()

const emit = defineEmits(['update:model-value'])

const toast = useToastStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const progress = ref(0)
const error = ref('')

const accept = computed(() => {
  // 从 App config 中获取支持的格式
  return '.pdf,.docx,.doc,.jpg,.png'
})

const placeholder = computed(() => {
  return (props.field as any).placeholder || '点击上传合同文件 (PDF/DOC/图片)'
})

function triggerUpload() {
  if (props.readonly) return
  fileInput.value?.click()
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      if (!base64) {
        reject(new Error('Failed to convert file to base64'))
        return
      }
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  // 检查文件大小 (20MB)
  const maxSize = 20 * 1024 * 1024
  if (file.size > maxSize) {
    error.value = `文件大小超过限制 (最大 20MB)`
    toast.error(error.value)
    return
  }

  error.value = ''
  uploading.value = true
  progress.value = 0

  try {
    // 模拟进度
    const progressInterval = setInterval(() => {
      if (progress.value < 90) {
        progress.value += Math.floor(Math.random() * 10) + 5
      }
    }, 200)

    // 转换为 base64
    const base64Data = await fileToBase64(file)

    // 调用附件上传 API
    const response = await apiClient.post('/attachments', {
      source_tag: 'mini_app',
      source_id: props.recordId || props.app?.id || 'temp',
      file_name: file.name,
      mime_type: file.type,
      base64_data: base64Data,
    })

    clearInterval(progressInterval)
    progress.value = 100

    const result = response.data.data

    emit('update:model-value', {
      attachment_id: result.id,
      name: result.file_name || file.name,
      url: result.data_url,
      size: result.file_size,
      mimeType: result.mime_type,
      file_path: result.file_path,
    })

    toast.success('文件上传成功')
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : '上传失败'
    error.value = errorMsg
    toast.error(error.value)
  } finally {
    uploading.value = false
    // 清空 input 以便可以重复选择同一文件
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  }
}

function clearFile() {
  if (props.readonly) return
  emit('update:model-value', null)
}
</script>

<style scoped>
.file-field {
  width: 100%;
}

.file-input {
  display: none;
}

.file-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 8px;
  background: var(--color-bg-secondary, #f8f9fa);
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.file-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.file-name {
  font-size: 14px;
  color: var(--color-text-primary, #333);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-remove {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--color-text-secondary, #999);
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.btn-remove:hover {
  color: var(--color-danger, #e74c3c);
}

.file-upload {
  border: 2px dashed var(--color-border, #ddd);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.file-upload:hover {
  border-color: var(--color-primary, #4a90d9);
  background: var(--color-bg-secondary, #f8f9fa);
}

.upload-trigger {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  gap: 8px;
}

.upload-icon {
  font-size: 32px;
  color: var(--color-text-secondary, #999);
}

.upload-text {
  font-size: 14px;
  color: var(--color-text-secondary, #666);
}

.upload-progress {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: var(--color-border, #e0e0e0);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary, #4a90d9);
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: var(--color-text-secondary, #666);
  min-width: 36px;
  text-align: right;
}

.upload-error {
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-danger, #e74c3c);
}
</style>
