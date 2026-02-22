<template>
  <div class="topic-list">
    <!-- 头部 -->
    <div class="topic-list-header">
      <h2 class="title">{{ $t('topic.title') }}</h2>
    </div>

    <!-- 搜索框 -->
    <div class="search-box">
      <input
        v-model="searchQuery"
        type="text"
        :placeholder="$t('topic.searchPlaceholder')"
        class="search-input"
      />
    </div>

    <!-- 话题列表 -->
    <div class="topic-items" ref="topicListRef">
      <div v-if="chatStore.isLoading && chatStore.topics.length === 0" class="loading">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="filteredTopics.length === 0" class="empty">
        {{ searchQuery ? $t('common.empty') : $t('topic.empty') }}
      </div>

      <template v-else>
        <div
          v-for="topic in filteredTopics"
          :key="topic.id"
          class="topic-item"
          :class="{ active: topic.id === chatStore.currentTopicId }"
          @click="selectTopic(topic.id)"
        >
          <div class="topic-title">{{ topic.title }}</div>
          <div class="topic-meta">
            <span class="topic-date">{{ formatDate(topic.updated_at) }}</span>
            <span v-if="topic.message_count > 0" class="topic-count">
              {{ topic.message_count }}
            </span>
          </div>
        </div>
      </template>
    </div>

    <!-- 用户信息 -->
    <div class="user-info" v-if="userStore.isLoggedIn">
      <div class="user-name">{{ userStore.user?.nickname }}</div>
      <button class="btn-logout" @click="logout">
        {{ $t('nav.logout') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const { t } = useI18n()
const chatStore = useChatStore()
const userStore = useUserStore()

const searchQuery = ref('')
const topicListRef = ref<HTMLElement | null>(null)

const filteredTopics = computed(() => {
  if (!searchQuery.value.trim()) {
    return chatStore.topics
  }
  const query = searchQuery.value.toLowerCase()
  return chatStore.topics.filter(topic =>
    topic.title.toLowerCase().includes(query) ||
    topic.description?.toLowerCase().includes(query)
  )
})

const selectTopic = (id: string) => {
  chatStore.setCurrentTopic(id)
  router.push({ name: 'chat', params: { topicId: id } })
}

const logout = async () => {
  await userStore.logout()
  router.push({ name: 'login' })
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return t('topic.today')
  } else if (days === 1) {
    return t('topic.yesterday')
  } else if (days < 7) {
    return t('topic.last7Days')
  } else if (days < 30) {
    return t('topic.last30Days')
  } else {
    return date.toLocaleDateString()
  }
}

onMounted(() => {
  chatStore.loadTopics()
})
</script>

<style scoped>
.topic-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--sidebar-bg, #f5f5f5);
}

.topic-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

.search-box {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 14px;
  background: var(--input-bg, #fff);
  color: var(--text-primary, #333);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.topic-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.loading,
.empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
}

.topic-item {
  padding: 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.topic-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.topic-item.active {
  background: var(--active-bg, #e3f2fd);
}

.topic-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.topic-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.topic-count {
  background: var(--badge-bg, #e0e0e0);
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 11px;
}

.user-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  background: var(--user-bg, #e8e8e8);
}

.user-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.btn-logout {
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.btn-logout:hover {
  background: var(--hover-bg, #ddd);
}
</style>
