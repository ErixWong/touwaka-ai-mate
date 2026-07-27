<template>
  <OcrToolView />
</template>

<script setup lang="ts">
import OcrToolView from '@/views/ocr-tool/OcrToolView.vue'
import type { MiniApp } from '@/api/mini-apps'

defineProps<{ app: MiniApp }>()
</script>

