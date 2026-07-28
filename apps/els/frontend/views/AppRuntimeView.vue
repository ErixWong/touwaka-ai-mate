<template>
  <ELSStudyView />
</template>

<script setup lang="ts">
import ELSStudyView from '@/views/els/ELSStudyView.vue'
import type { MiniApp } from '@/api/mini-apps'

defineProps<{ app: MiniApp }>()
</script>

