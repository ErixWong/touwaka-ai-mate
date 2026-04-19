<template>
  <!-- Element Plus ElMessage 不需要模板，由 store 直接调用 -->
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useToastStore } from '@/stores/toast'
import type { ToastItem } from '@/types/toast'

const toastStore = useToastStore()

// 监听 store 变化，使用 ElMessage 显示
watch(
  () => toastStore.items,
  (items) => {
    // 只处理新增的 toast
    items.forEach((item: ToastItem) => {
      showMessage(item)
    })
  },
  { deep: true }
)

function showMessage(item: ToastItem) {
  const typeMap = {
    success: 'success',
    error: 'error',
    warning: 'warning',
    info: 'info'
  }
  
  ElMessage({
    message: item.message,
    type: typeMap[item.type] as 'success' | 'error' | 'warning' | 'info',
    duration: item.duration || 3000,
    showClose: item.closable,
    onClose: () => {
      toastStore.remove(item.id)
    }
  })
}
</script>

<style scoped>
/* ElMessage 由 Element Plus 内置样式处理 */
</style>