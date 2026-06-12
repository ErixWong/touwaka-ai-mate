<template>
  <el-tag size="small" :type="tagType">
    {{ label }}
  </el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  visibility: string
}>()

const label = computed(() => {
  const map: Record<string, string> = { private: '私有', department: '部门', public: '公开' }
  return map[props.visibility] || props.visibility
})

const tagType = computed(() => {
  const map: Record<string, string> = { private: 'info', department: 'warning', public: 'success' }
  return map[props.visibility] || 'info'
})
</script>
