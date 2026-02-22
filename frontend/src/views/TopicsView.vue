<template>
  <div class="topics-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('topics.title') }}</h1>
    </div>

    <div class="topics-filter">
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        :placeholder="$t('topics.searchPlaceholder')"
      />
      <select v-model="filterStatus" class="filter-select">
        <option value="">{{ $t('topics.allTopics') }}</option>
        <option value="active">{{ $t('topics.active') }}</option>
        <option value="archived">{{ $t('topics.archived') }}</option>
      </select>
    </div>

    <div class="topics-list">
      <div
        v-for="topic in filteredTopics"
        :key="topic.id"
        class="topic-card"
        :class="{ archived: topic.status === 'archived' }"
      >
        <div class="topic-header">
          <h3 class="topic-title">{{ topic.title }}</h3>
          <span class="topic-status" :class="topic.status">{{ $t(`topics.${topic.status}`) }}</span>
        </div>
        <div class="topic-meta">
          <span>{{ formatDate(topic.updated_at) }}</span>
          <span v-if="topic.message_count">{{ topic.message_count }} {{ $t('topics.messages') }}</span>
        </div>
        <div class="topic-actions">
          <button class="btn-action" @click="openTopic(topic.id)">
            {{ $t('topics.continue') }}
          </button>
          <button
            v-if="topic.status === 'active'"
            class="btn-action secondary"
            @click="archiveTopic(topic.id)"
          >
            {{ $t('topics.archive') }}
          </button>
          <button
            v-else
            class="btn-action secondary"
            @click="unarchiveTopic(topic.id)"
          >
            {{ $t('topics.unarchive') }}
          </button>
          <button class="btn-action danger" @click="deleteTopic(topic.id)">
            {{ $t('topics.delete') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="filteredTopics.length === 0" class="empty-state">
      <p>{{ searchQuery ? $t('topics.noResults') : $t('topics.empty') }}</p>
    </div>

    <div v-if="chatStore.hasMoreTopics" class="load-more">
      <button
        class="btn-load-more"
        :disabled="chatStore.isLoadingMore"
        @click="loadMore"
      >
        {{ chatStore.isLoadingMore ? $t('common.loading') : $t('topics.loadMore') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'

const router = useRouter()
const { t } = useI18n()
const chatStore = useChatStore()

const searchQuery = ref('')
const filterStatus = ref('')

const filteredTopics = computed(() => {
  let topics = chatStore.topics

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    topics = topics.filter(t => t.title.toLowerCase().includes(query))
  }

  if (filterStatus.value) {
    topics = topics.filter(t => t.status === filterStatus.value)
  }

  return topics
})

const openTopic = (topicId: string) => {
  router.push({ name: 'chat', params: { topicId } })
}

const archiveTopic = async (topicId: string) => {
  await chatStore.updateTopic(topicId, { status: 'archived' })
}

const unarchiveTopic = async (topicId: string) => {
  await chatStore.updateTopic(topicId, { status: 'active' })
}

const deleteTopic = async (topicId: string) => {
  if (confirm(t('topics.confirmDelete'))) {
    await chatStore.deleteTopic(topicId)
  }
}

const loadMore = () => {
  chatStore.loadNextPage()
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString()
}

onMounted(() => {
  chatStore.loadTopics()
})
</script>

<style scoped>
.topics-view {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.view-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.topics-filter {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.search-input {
  flex: 1;
  padding: 10px 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
}

.filter-select {
  padding: 10px 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  background: white;
  min-width: 120px;
}

.topics-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.topic-card {
  padding: 16px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
}

.topic-card.archived {
  opacity: 0.7;
  background: var(--secondary-bg, #f5f5f5);
}

.topic-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.topic-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.topic-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
}

.topic-status.active {
  background: #e8f5e9;
  color: #2e7d32;
}

.topic-status.archived {
  background: #f5f5f5;
  color: #666;
}

.topic-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-bottom: 12px;
}

.topic-actions {
  display: flex;
  gap: 8px;
}

.btn-action {
  padding: 6px 12px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.btn-action.secondary {
  background: var(--secondary-bg, #f5f5f5);
  color: var(--text-secondary, #666);
}

.btn-action.danger {
  background: #ef5350;
  color: white;
}

.btn-action:hover {
  opacity: 0.9;
}

.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-secondary, #666);
}

.load-more {
  text-align: center;
  padding: 24px;
}

.btn-load-more {
  padding: 10px 24px;
  background: var(--secondary-bg, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-load-more:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
}

.btn-load-more:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
