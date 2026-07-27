<template>
  <ResumeScreeningView />
</template>

<script setup lang="ts">
import ResumeScreeningView from '@/views/resume-fast-screening/ResumeScreeningView.vue'
import type { MiniApp } from '@/api/mini-apps'

defineProps<{ app: MiniApp }>()
</script>

