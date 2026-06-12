<template>
  <div class="collection-card" @click="$emit('open', collection)">
    <div class="card-header">
      <div class="card-name">{{ collection.name }}</div>
      <div class="card-actions">
        <el-button v-if="showSettings" size="small" text @click.stop="$emit('settings', collection)" title="设置">
          <span class="settings-icon">⚙</span>
        </el-button>
      </div>
    </div>
    <div v-if="collection.description" class="card-desc">{{ collection.description }}</div>
    <div class="card-stats">
      <span>{{ collection.doc_count || 0 }} 篇文档</span>
      <span class="card-time">{{ formatTime(collection.updated_at) }}</span>
    </div>
    <div class="card-footer">
      <VisibilityTag :visibility="collection.visibility" />
    </div>
  </div>
</template>

<script setup lang="ts">
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

function formatTime(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleDateString('zh-CN')
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
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.card-name { font-size: 16px; font-weight: 600; }
.settings-icon { font-size: 16px; }
.card-desc { font-size: 13px; color: #909399; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-stats { display: flex; justify-content: space-between; font-size: 12px; color: #909399; margin-bottom: 12px; }
.card-footer { display: flex; gap: 8px; }
</style>
