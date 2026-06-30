<template>
  <div class="collection-card" @click="$emit('open', collection)">
    <div class="card-header">
      <div class="card-name">{{ collection.name }}</div>
      <div class="card-actions">
        <el-button v-if="showSettings" size="small" text @click.stop="$emit('settings', collection)" :title="$t('docs.settings')">
          <el-icon class="settings-icon"><RefreshRight /></el-icon>
        </el-button>
      </div>
    </div>
    <div v-if="collection.description" class="card-desc">{{ collection.description }}</div>
    
    <div class="card-stats-row">
      <div class="stat-item doc-count">
        <el-icon><Document /></el-icon>
        <span>{{ collection.doc_count || 0 }} {{ $t('docs.workspace.collection.docCount') }}</span>
      </div>
      <div v-if="collection.needs_revectorize" class="stat-item needs-vectorize" :title="$t('docs.workspace.collection.needsRevectorize')">
        <el-icon><RefreshRight /></el-icon>
        <span>{{ $t('docs.workspace.collection.pendingUpdate') }}</span>
      </div>
    </div>
    
    <div class="card-meta-row">
      <span class="card-time">{{ formatRelativeTime(collection.updated_at) }}</span>
      <VisibilityTag :visibility="collection.visibility" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Document, RefreshRight } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import type { DocCollection } from '@/api/collections'
import VisibilityTag from './VisibilityTag.vue'

defineProps<{
  collection: DocCollection
  showSettings?: boolean
}>()

defineEmits<{
  open: [collection: DocCollection]
  settings: [collection: DocCollection]
}>()

const { t } = useI18n()

function formatRelativeTime(timeStr: string) {
  if (!timeStr) return ''
  const now = new Date()
  const updated = new Date(timeStr)
  const diffMs = now.getTime() - updated.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return t('docs.workspace.relativeTime.justNow')
  if (diffMins < 60) return `${diffMins} ${t('docs.workspace.relativeTime.minutesAgo')}`
  if (diffHours < 24) return `${diffHours} ${t('docs.workspace.relativeTime.hoursAgo')}`
  if (diffDays < 7) return `${diffDays} ${t('docs.workspace.relativeTime.daysAgo')}`
  
  return updated.toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.collection-card {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.2s;
  background: #fff;
}
.collection-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
.card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.card-name { font-size: 16px; font-weight: 600; flex: 1; margin-right: 8px; line-height: 1.4; }
.settings-icon { font-size: 16px; }
.card-desc { font-size: 13px; color: #909399; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5; }

.card-stats-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #606266;
}
.stat-item.doc-count {
  color: #409eff;
  font-weight: 500;
}
.stat-item.needs-vectorize {
  color: #e6a23c;
  font-size: 12px;
}
.stat-item.needs-vectorize .el-icon {
  font-weight: 600;
}

.card-meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.card-time { font-size: 12px; color: #c0c4cc; }
</style>
