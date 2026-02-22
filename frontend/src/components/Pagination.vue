<template>
  <div class="pagination" v-if="totalPages > 1">
    <button 
      class="page-btn prev" 
      :disabled="currentPage <= 1"
      @click="goToPage(currentPage - 1)"
      :title="$t('pagination.prev')"
    >
      ‹
    </button>
    
    <button
      v-for="page in visiblePages"
      :key="page"
      class="page-btn"
      :class="{ active: page === currentPage }"
      @click="goToPage(page)"
    >
      {{ page }}
    </button>
    
    <button 
      class="page-btn next" 
      :disabled="currentPage >= totalPages"
      @click="goToPage(currentPage + 1)"
      :title="$t('pagination.next')"
    >
      ›
    </button>
    
    <span class="page-info">
      {{ $t('pagination.info', { total }) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  currentPage: number
  totalPages: number
  total: number
  maxVisible?: number
}

const props = withDefaults(defineProps<Props>(), {
  maxVisible: 5
})

const emit = defineEmits<{
  change: [page: number]
}>()

const visiblePages = computed(() => {
  const pages: number[] = []
  const half = Math.floor(props.maxVisible / 2)
  let start = Math.max(1, props.currentPage - half)
  let end = Math.min(props.totalPages, start + props.maxVisible - 1)
  
  if (end - start < props.maxVisible - 1) {
    start = Math.max(1, end - props.maxVisible + 1)
  }
  
  for (let i = start; i <= end; i++) {
    pages.push(i)
  }
  return pages
})

const goToPage = (page: number) => {
  if (page >= 1 && page <= props.totalPages && page !== props.currentPage) {
    emit('change', page)
  }
}
</script>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 0;
  border-top: 1px solid var(--border-color, #e0e0e0);
  margin-top: auto;
}

.page-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary, #333);
  cursor: pointer;
  transition: all 0.2s;
}

.page-btn:hover:not(:disabled) {
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-btn.active {
  background: var(--primary-color, #2196f3);
  border-color: var(--primary-color, #2196f3);
  color: white;
}

.page-info {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-left: 8px;
}
</style>
