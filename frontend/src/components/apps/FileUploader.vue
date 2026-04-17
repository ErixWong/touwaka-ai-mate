<template>
  <div class="file-uploader">
    <div class="drop-zone" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="handleDrop">
      <p>{{ $t('apps.dragFile') }}</p>
      <label class="upload-btn">
        {{ $t('apps.selectFile') }}
        <input type="file" multiple :accept="acceptFormats" @change="handleFileSelect" class="hidden-input" />
      </label>
    </div>
    <div v-if="uploadingFiles.length > 0" class="upload-list">
      <div v-for="item in uploadingFiles" :key="item.name" class="upload-item">
        <span class="file-name">{{ item.name }}</span>
        <span v-if="item.status === 'uploading'" class="file-status">{{ $t('apps.uploading') }}</span>
        <span v-else-if="item.status === 'done'" class="file-status done">✓</span>
        <span v-else-if="item.status === 'error'" class="file-status error">✗ {{ item.error }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { MiniApp } from '@/api/mini-apps'
import { uploadAttachment } from '@/api/attachment'

const props = defineProps<{
  app: MiniApp
}>()

const emit = defineEmits<{
  uploaded: [attachmentIds: string[]]
}>()

const dragging = ref(false)
const uploadingFiles = ref<{ name: string; status: string; error?: string }[]>([])

const acceptFormats = computed(() => {
  return (props.app.config?.supported_formats || []).join(',')
})

async function handleDrop(event: DragEvent) {
  dragging.value = false
  const files = event.dataTransfer?.files
  if (files) await processFiles(Array.from(files))
}

async function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) await processFiles(Array.from(input.files))
  input.value = ''
}

async function processFiles(files: File[]) {
  const items = files.map(f => ({ name: f.name, status: 'uploading' as string, error: undefined as string | undefined }))
  uploadingFiles.value = items
  const attachmentIds: string[] = []

  for (let i = 0; i < files.length; i++) {
    try {
      const file = files[i]!
      const base64Data = await fileToBase64(file)
      const att = await uploadAttachment({
        source_tag: 'mini_app_file',
        source_id: props.app.id,
        file_name: file.name,
        mime_type: file.type,
        base64_data: base64Data,
      })
      attachmentIds.push(att.id)
      items[i]!.status = 'done'
    } catch (error) {
      items[i]!.status = 'error'
      items[i]!.error = (error as Error).message
    }
  }

  if (attachmentIds.length > 0) {
    emit('uploaded', attachmentIds)
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]!
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
</script>

<style scoped>
.file-uploader {
  margin-top: 8px;
}

.drop-zone {
  border: 2px dashed var(--color-border, #ddd);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.drop-zone.dragging {
  border-color: var(--color-primary, #4a90d9);
  background: rgba(74, 144, 217, 0.05);
}

.drop-zone p {
  margin: 0 0 12px;
  color: var(--color-text-secondary, #666);
}

.upload-btn {
  display: inline-block;
  padding: 8px 20px;
  background: var(--color-primary, #4a90d9);
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.hidden-input {
  display: none;
}

.upload-list {
  margin-top: 12px;
}

.upload-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--color-border, #eee);
}

.file-status.done {
  color: var(--color-success, #28a745);
}

.file-status.error {
  color: var(--color-danger, #e74c3c);
}
</style>
