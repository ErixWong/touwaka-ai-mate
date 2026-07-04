<template>
  <div class="cfa-file-list">
    <BatchOverviewCard v-if="fileStats.total > 0" :stats="fileStats" />
    <div class="cfa-file-list-header">
      <span>分析任务</span>
      <span class="cfa-file-stats">
        {{ completed }}/{{ total }}
      </span>
    </div>
    <div class="cfa-file-list-body">
      <FileListItem
        v-for="file in files"
        :key="file.file_id"
        :file="file"
        :selected="file.file_id === selectedFileId"
        @select="$emit('select', file.file_id)"
      />
      <div v-if="files.length === 0" class="cfa-file-list-empty">
        暂无文件
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionFileItem } from '../api/current-feature-analyzer'
import FileListItem from './FileListItem.vue'
import BatchOverviewCard from './BatchOverviewCard.vue'

const props = defineProps<{
  files: SessionFileItem[]
  selectedFileId: string | null
  batchStatus: string
}>()

const total = computed(() => props.files.length)
const completed = computed(() => props.files.filter(file => file.analysis_status === 'completed').length)
const failed = computed(() => props.files.filter(file => file.analysis_status === 'failed').length)
const analyzing = computed(() => props.files.filter(file => file.analysis_status === 'analyzing').length)
const warningCount = computed(() => props.files.filter(file => file.warning_count > 0).length)

const fileStats = computed(() => ({
  total: total.value,
  completed: completed.value,
  failed: failed.value,
  analyzing: analyzing.value,
  warning_count: warningCount.value,
  pending: props.files.filter(f => f.analysis_status === 'pending' || f.analysis_status === 'ready').length,
}))

defineEmits<{
  select: [id: string]
}>()
</script>
