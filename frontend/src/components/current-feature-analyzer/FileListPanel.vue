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
import type { SessionFileItem } from '@/api/current-feature-analyzer'
import FileListItem from './FileListItem.vue'

defineProps<{
  files: SessionFileItem[]
  selectedFileId: string | null
  batchStatus: string
}>()

defineEmits<{
  select: [id: string]
}>()
</script>

<style scoped>
.cfa-file-list {
  width: 260px;
  min-width: 260px;
  border-right: 1px solid var(--el-border-color-light);
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}
.cfa-file-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.cfa-file-stats {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.cfa-file-list-body {
  flex: 1;
  overflow-y: auto;
}
.cfa-file-list-empty {
  padding: 20px;
  text-align: center;
  color: var(--el-text-color-placeholder);
}
</style>
