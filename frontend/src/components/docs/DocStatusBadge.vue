<template>
  <el-tag size="small" :type="tagType">
    {{ label }}
  </el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getDocProcessingStatusTagType } from '@/api/docs'

const { t } = useI18n()

const props = defineProps<{
  status?: string | null
  ocrStatus?: string | null
}>()

const label = computed(() => {
  const s = props.status
  if (!s) return t('contractV2.processingStatus.unknown')
  // OCR processing has special handling
  if (s === 'ocr_processing') {
    return props.ocrStatus === 'completed' 
      ? t('contractV2.processingStatus.ocrCompleted')
      : t(`contractV2.processingStatus.${s}`)
  }
  return t(`contractV2.processingStatus.${s}`)
})

const tagType = computed(() => {
  return getDocProcessingStatusTagType(props.status)
})
</script>
