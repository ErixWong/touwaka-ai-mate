<template>
  <ContractV2View />
</template>

<script setup lang="ts">
import ContractV2View from '@/views/contract-v2/ContractV2View.vue'
import type { MiniApp } from '@/api/mini-apps'

defineProps<{ app: MiniApp }>()
</script>

