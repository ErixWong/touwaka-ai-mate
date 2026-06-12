<template>
  <el-tag size="small" :type="tagType">
    {{ label }}
  </el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status?: string | null
  ocrStatus?: string | null
}>()

const label = computed(() => {
  const s = props.status
  if (s === 'pending_ocr') return '待OCR'
  if (s === 'ocr_processing') return props.ocrStatus === 'completed' ? 'OCR完成' : 'OCR处理中'
  if (s === 'pending_clean') return '待文本清洗'
  if (s === 'ready') return '已就绪'
  if (s === 'error') return '处理失败'
  return s || '未知'
})

const tagType = computed(() => {
  const s = props.status
  if (s === 'ready') return 'success'
  if (s === 'pending_clean') return 'info'
  if (s === 'ocr_processing' || s === 'pending_ocr') return 'warning'
  if (s === 'error') return 'danger'
  return 'info'
})
</script>
