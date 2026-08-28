<template>
  <div class="collection-card" @click="$emit('open', collection)">
    <div class="card-main">
      <div class="card-icon" :style="iconStyle">
        <el-icon :size="20"><Folder /></el-icon>
      </div>

      <div class="card-info">
        <el-tooltip :content="collection.name" placement="top-start" :disabled="!nameOverflow">
          <div ref="nameEl" class="card-name">{{ collection.name }}</div>
        </el-tooltip>
        <div v-if="collection.description" class="card-desc">{{ collection.description }}</div>
      </div>

      <el-tooltip :content="$t('docs.settings')" placement="top">
        <el-button
          v-if="showSettings"
          class="settings-btn"
          text
          circle
          size="small"
          @click.stop="$emit('settings', collection)"
        >
          <el-icon><Setting /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <div class="card-footer">
      <span class="doc-count">
        <el-icon><Document /></el-icon>
        {{ collection.doc_count || 0 }} {{ $t('docs.workspace.collection.docCount') }}
      </span>
      <span
        v-if="collection.needs_revectorize"
        class="needs-vectorize"
        :title="$t('docs.workspace.collection.needsRevectorize')"
      >
        <el-icon><RefreshRight /></el-icon>
        {{ $t('docs.workspace.collection.pendingUpdate') }}
      </span>
      <span class="card-time">
        <el-icon><Clock /></el-icon>
        {{ formatRelativeTime(collection.updated_at) }}
      </span>
      <VisibilityTag :visibility="collection.visibility" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Document, Folder, RefreshRight, Clock, Setting } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import type { DocCollection } from '@/api/collections'
import VisibilityTag from './VisibilityTag.vue'

const props = defineProps<{
  collection: DocCollection
  showSettings?: boolean
}>()

defineEmits<{
  open: [collection: DocCollection]
  settings: [collection: DocCollection]
}>()

const { t } = useI18n()

const nameEl = ref<HTMLElement>()
const nameOverflow = ref(false)
let resizeObserver: ResizeObserver | null = null

function checkNameOverflow() {
  nameOverflow.value = nameEl.value
    ? nameEl.value.scrollWidth > nameEl.value.clientWidth
    : false
}

const ICON_PALETTES = [
  'linear-gradient(135deg, #6ea8fe 0%, #3b6ef5 100%)',
  'linear-gradient(135deg, #34d399 0%, #0ea878 100%)',
  'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
  'linear-gradient(135deg, #a78bfa 0%, #7c5cf0 100%)',
  'linear-gradient(135deg, #f87171 0%, #ef4444 100%)',
  'linear-gradient(135deg, #22d3ee 0%, #0ea5e9 100%)',
  'linear-gradient(135deg, #f472b6 0%, #ec4899 100%)',
  'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)',
]

function hashString(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

const iconStyle = computed(() => ({
  background: ICON_PALETTES[hashString(props.collection.id) % ICON_PALETTES.length],
}))

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

onMounted(() => {
  checkNameOverflow()
  if (nameEl.value) {
    resizeObserver = new ResizeObserver(checkNameOverflow)
    resizeObserver.observe(nameEl.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<style scoped>
.collection-card {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e5e8ef;
  border-radius: 12px;
  padding: 16px 16px 12px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}
.collection-card:hover {
  border-color: #b9cbff;
  box-shadow: 0 6px 18px rgba(59, 110, 245, 0.10);
  transform: translateY(-2px);
}

.card-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
}

.card-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-desc {
  margin-top: 4px;
  font-size: 12.5px;
  color: #8a919f;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.settings-btn {
  flex-shrink: 0;
  margin-left: 2px;
  color: #9aa2b1;
}
.settings-btn:hover {
  color: #4a7dff;
  background: #f0f4ff;
}

.card-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed #eef0f4;
  font-size: 12px;
  color: #6b7280;
}

.doc-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  color: #4a5568;
}
.doc-count .el-icon {
  color: #4a7dff;
}

.needs-vectorize {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #e6a23c;
}

.card-time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  color: #8a93a5;
}
</style>
