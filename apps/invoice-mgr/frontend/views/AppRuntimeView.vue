<template>
  <InvoiceView />
</template>

<script setup lang="ts">
import InvoiceView from '@/views/invoice/InvoiceView.vue'
import type { MiniApp } from '@/api/mini-apps'

defineProps<{ app: MiniApp }>()
</script>

