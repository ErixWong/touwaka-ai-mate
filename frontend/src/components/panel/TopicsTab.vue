<template>
  <div class="topics-tab">
    <!-- 搜索框和刷新按钮 -->
    <div class="search-box">
      <input
        v-model="searchQuery"
        type="text"
        :placeholder="$t('topic.searchPlaceholder')"
        class="search-input"
      />
      <button
        class="refresh-btn"
        @click="handleRefresh"
        :disabled="isCompressing"
        :title="$t('common.refresh')"
      >
        <span class="refresh-icon" :class="{ spinning: isCompressing }">🔄</span>
      </button>
    </div>
    
    <!-- 加载状态 -->
    <div v-if="chatStore.isLoadingTopics" class="loading-state">
      <span class="loading-spinner"></span>
      {{ $t('common.loading') }}
    </div>
    
    <!-- 空状态 -->
    <div v-else-if="filteredTopics.length === 0" class="empty-state">
      <p>{{ searchQuery ? $t('common.empty') : $t('topics.noTopics') }}</p>
    </div>
    
    <!-- Topics 列表 -->
    <div v-else class="topics-list">
      <div
        v-for="topic in filteredTopics"
        :key="topic.id"
        class="topic-card"
        :class="{
          active: topic.id === activeTopicId,
          expanded: expandedTopics.has(topic.id)
        }"
      >
        <div class="topic-header" @click="selectTopic(topic)">
          <h4 class="topic-title">{{ topic.title }}</h4>
          <button
            class="expand-btn"
            @click.stop="toggleExpand(topic.id)"
            :title="expandedTopics.has(topic.id) ? $t('common.collapse') : $t('common.expand')"
          >
            <span class="expand-icon">{{ expandedTopics.has(topic.id) ? '▼' : '▶' }}</span>
          </button>
        </div>
        <div v-if="expandedTopics.has(topic.id)" class="topic-expanded-content">
          <p v-if="topic.description" class="topic-description-full">{{ topic.description }}</p>
        </div>
        <p v-else-if="topic.description" class="topic-description">{{ topic.description }}</p>
        <div class="topic-meta" @click="selectTopic(topic)">
          <span class="meta-item">
            <span class="meta-icon">📅</span>
            {{ formatDateTime(topic.created_at) }}
          </span>
          <span class="meta-item">
            <span class="meta-icon">💬</span>
            {{ topic.message_count || 0 }}
          </span>
          <span class="meta-item" :class="topic.status">
            {{ $t(`topics.status.${topic.status || 'active'}`) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { topicApi } from '@/api/services'
import type { Topic } from '@/types'

const { t } = useI18n()
const chatStore = useChatStore()

const searchQuery = ref('')
const expandedTopics = ref<Set<string>>(new Set())
const isCompressing = ref(false)

// 当前选中的 topic
const activeTopicId = computed(() => chatStore.currentTopicId)

// 过滤后的话题列表
const filteredTopics = computed(() => {
  const topics = chatStore.topics || []
  if (!searchQuery.value.trim()) {
    return topics
  }
  const query = searchQuery.value.toLowerCase()
  return topics.filter(topic =>
    topic.title?.toLowerCase().includes(query) ||
    topic.description?.toLowerCase().includes(query)
  )
})

// 加载 Topics（按当前 expert 过滤）
const loadTopics = async () => {
  try {
    await chatStore.loadTopics()
  } catch (error) {
    console.error('Failed to load topics:', error)
  }
}

// 手动刷新 - 触发压缩检查并刷新列表
const handleRefresh = async () => {
  try {
    isCompressing.value = true
    // 调用压缩 API
    const result = await topicApi.compress()
    console.log('Compress result:', result)
    // 刷新列表
    await loadTopics()
  } catch (error) {
    console.error('Failed to compress topics:', error)
  } finally {
    isCompressing.value = false
  }
}

// 选择 Topic
const selectTopic = (topic: Topic) => {
  chatStore.setCurrentTopic(topic.id)
  emit('select', topic)
}

// 展开/收起 Topic
const toggleExpand = (topicId: string) => {
  if (expandedTopics.value.has(topicId)) {
    expandedTopics.value.delete(topicId)
  } else {
    expandedTopics.value.add(topicId)
  }
  // 强制触发响应式更新
  expandedTopics.value = new Set(expandedTopics.value)
}

// 分页变化
const handlePageChange = (page: number) => {
  chatStore.loadTopics({ page })
}

// 监听当前 expertId 变化，重新加载 topics
watch(
  () => chatStore.currentExpertId,
  (newId) => {
    if (newId) {
      loadTopics()
    }
  },
  { immediate: true }
)

// 格式化日期时间
const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  
  // 时间部分
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  
  if (days === 0) return `${t('topic.today')} ${time}`
  if (days === 1) return `${t('topic.yesterday')} ${time}`
  if (days < 7) return `${days}${t('topic.daysAgo') || '天前'} ${time}`
  
  // 超过7天显示完整日期
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + time
}

const emit = defineEmits<{
  select: [topic: Topic]
}>()
</script>

<style scoped>
.topics-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
}

.search-box {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
}

.refresh-btn {
  padding: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  background: var(--input-bg, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--hover-bg, #f5f5f5);
  border-color: var(--primary-color, #2196f3);
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.refresh-icon {
  font-size: 14px;
}

.refresh-icon.spinning {
  display: inline-block;
  animation: spin 1s linear infinite;
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--text-secondary, #666);
  gap: 8px;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color, #e0e0e0);
  border-top-color: var(--primary-color, #2196f3);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.topics-list {
  flex: 1;
  overflow-y: auto;
}

.topic-card {
  padding: 12px;
  margin-bottom: 8px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.topic-card:hover {
  border-color: var(--primary-color, #2196f3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.topic-card.active {
  border-color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
}

.topic-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
  cursor: pointer;
}

.topic-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expand-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s;
  margin-left: 8px;
}

.expand-btn:hover {
  background: var(--hover-bg, #f0f0f0);
}

.expand-icon {
  font-size: 10px;
  color: var(--text-secondary, #666);
  transition: transform 0.2s;
}

.topic-card.expanded .topic-title {
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
}

.topic-expanded-content {
  margin-bottom: 8px;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; max-height: 0; }
  to { opacity: 1; max-height: 500px; }
}

.topic-description-full {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0 0 8px 0;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.topic-date {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  flex-shrink: 0;
  margin-left: 8px;
}

.topic-description {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0 0 8px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.topic-meta {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary, #666);
}

.meta-icon {
  font-size: 12px;
}

.meta-item.active {
  color: var(--success-color, #4caf50);
}

.meta-item.archived {
  color: var(--warning-color, #ff9800);
}

.empty-state {
  text-align: center;
  padding: 24px;
  color: var(--text-secondary, #666);
}
</style>
