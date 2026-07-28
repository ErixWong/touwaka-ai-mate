<template>
  <ContractMgrView />
</template>

<script setup lang="ts">
import ContractMgrView from '@/views/contract-mgr/ContractMgrView.vue'
import type { MiniApp } from '@/api/mini-apps'

defineProps<{ app: MiniApp }>()
</script>

