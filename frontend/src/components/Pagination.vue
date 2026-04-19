<template>
  <el-pagination
    v-if="totalPages > 1"
    :current-page="currentPage"
    :page-size="pageSize"
    :total="total"
    :pager-count="maxVisible"
    layout="prev, pager, next, total"
    :prev-text="prevText"
    :next-text="nextText"
    @current-change="handlePageChange"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

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

const { t } = useI18n()

const pageSize = computed(() => {
  return Math.ceil(props.total / props.totalPages) || 10
})

const prevText = computed(() => t('pagination.prev'))
const nextText = computed(() => t('pagination.next'))

const handlePageChange = (page: number) => {
  if (page >= 1 && page <= props.totalPages && page !== props.currentPage) {
    emit('change', page)
  }
}
</script>

<style scoped>
.el-pagination {
  justify-content: center;
  padding: 12px 0;
  margin-top: auto;
}
</style>