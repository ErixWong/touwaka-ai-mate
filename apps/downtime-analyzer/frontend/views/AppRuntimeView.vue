<template>
  <DowntimeAnalyzer />
</template>

<script setup lang="ts">
import DowntimeAnalyzer from '@/views/downtime-analyzer/DowntimeAnalyzer.vue'
import type { MiniApp } from '@/api/mini-apps'

defineProps<{ app: MiniApp }>()
</script>

