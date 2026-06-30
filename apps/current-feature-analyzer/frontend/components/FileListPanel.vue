<template>
  <div class="cfa-file-list">
    <div class="cfa-file-list-header">
      <span>文件列表</span>
      <span class="cfa-file-stats">
        {{ completed }}/{{ total }} 完成
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

const props = defineProps<{
  files: SessionFileItem[]
  selectedFileId: string | null
  batchStatus: string
}>()

const total = computed(() => props.files.length)
const completed = computed(() => props.files.filter(file => file.analysis_status === 'completed').length)

defineEmits<{
  select: [id: string]
}>()
</script>
