<template>
  <div class="expert-tab">
    <!-- 加载状态 -->
    <div v-if="expertStore.isLoading" class="loading-state">
      <span class="loading-spinner"></span>
      <span>{{ $t('common.loading') }}</span>
    </div>

    <!-- 无专家状态 -->
    <div v-else-if="!currentExpert" class="empty-state">
      <div class="empty-icon">👤</div>
      <p>{{ $t('expert.noExpertSelected') }}</p>
    </div>

    <!-- 专家信息 -->
    <div v-else class="expert-content">
      <!-- 头像区域 -->
      <div class="avatar-section">
        <div class="avatar-container">
          <img
            v-if="currentExpert.avatar_base64"
            :src="currentExpert.avatar_base64"
            :alt="currentExpert.name"
            class="expert-avatar-large"
          />
          <div v-else class="avatar-placeholder">
            <span class="placeholder-text">{{ getInitials(currentExpert.name) }}</span>
          </div>
        </div>
      </div>

      <!-- 基本信息区域 -->
      <div class="info-section">
        <!-- 简介 -->
        <div v-if="currentExpert.introduction" class="info-item">
          <h4 class="info-label">{{ $t('expert.introduction') }}</h4>
          <p class="info-content">{{ currentExpert.introduction }}</p>
        </div>

        <!-- 核心价值观 -->
        <div v-if="currentExpert.core_values" class="info-item">
          <h4 class="info-label">{{ $t('expert.coreValues') }}</h4>
          <p class="info-content">{{ currentExpert.core_values }}</p>
        </div>

        <!-- 说话风格 -->
        <div v-if="currentExpert.speaking_style" class="info-item">
          <h4 class="info-label">{{ $t('expert.speakingStyle') }}</h4>
          <p class="info-content">{{ currentExpert.speaking_style }}</p>
        </div>

        <!-- 情感基调 -->
        <div v-if="currentExpert.emotional_tone" class="info-item">
          <h4 class="info-label">{{ $t('expert.emotionalTone') }}</h4>
          <p class="info-content">{{ currentExpert.emotional_tone }}</p>
        </div>

        <!-- 行为准则 -->
        <div v-if="currentExpert.behavioral_guidelines" class="info-item">
          <h4 class="info-label">{{ $t('expert.behavioralGuidelines') }}</h4>
          <p class="info-content">{{ currentExpert.behavioral_guidelines }}</p>
        </div>

        <!-- 禁忌话题 -->
        <div v-if="currentExpert.taboos" class="info-item">
          <h4 class="info-label">{{ $t('expert.taboos') }}</h4>
          <p class="info-content warning">{{ currentExpert.taboos }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useExpertStore } from '@/stores/expert'

const route = useRoute()
const expertStore = useExpertStore()

// 从路由获取当前 expertId
const currentExpertId = computed(() => route.params.expertId as string)

// 当前专家 - 优先从 store 的列表中获取，如果不存在则使用 currentExpert
const currentExpert = computed(() => {
  if (!currentExpertId.value) return null
  // 先从 store 的 experts 列表中查找
  const expert = expertStore.getExpertById(currentExpertId.value)
  if (expert) return expert
  // 如果没有找到，返回 currentExpert（当从专家页面点击进入时）
  return expertStore.currentExpert
})

// 加载专家数据
const loadExpert = async () => {
  if (!currentExpertId.value) return
  
  // 如果 store 中已有该专家数据，不需要重新加载
  if (expertStore.getExpertById(currentExpertId.value)) {
    // 只需设置当前专家
    expertStore.setCurrentExpert(currentExpertId.value)
    return
  }
  
  // 如果专家列表为空，先加载列表
  if (expertStore.experts.length === 0) {
    await expertStore.loadExperts()
  }
  
  // 设置当前专家
  expertStore.setCurrentExpert(currentExpertId.value)
}

// 监听 expertId 变化
watch(currentExpertId, (newId) => {
  if (newId) {
    loadExpert()
  }
}, { immediate: true })

onMounted(() => {
  loadExpert()
})

// 获取名字首字母
const getInitials = (name: string): string => {
  if (!name) return '?'
  return name.slice(0, 2).toUpperCase()
}
</script>

<style scoped>
.expert-tab {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 12px;
  color: var(--text-secondary, #666);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color, #e0e0e0);
  border-top-color: var(--primary-color, #2196f3);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 12px;
  color: var(--text-secondary, #666);
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
}

.expert-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 头像区域 */
.avatar-section {
  display: flex;
  justify-content: center;
  padding: 20px;
}

.avatar-container {
  width: 160px;
  height: 160px;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  background: var(--hover-bg, #f5f5f5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.expert-avatar-large {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--primary-light, #e3f2fd), var(--primary-color, #2196f3));
}

.placeholder-text {
  font-size: 48px;
  font-weight: 600;
  color: white;
}

/* 信息区域 */
.info-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.info-item {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  padding: 12px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.info-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  margin: 0 0 8px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #333);
  margin: 0;
}

.info-content.warning {
  color: var(--error-color, #f44336);
}

/* 滚动条样式 */
.expert-tab::-webkit-scrollbar {
  width: 6px;
}

.expert-tab::-webkit-scrollbar-track {
  background: transparent;
}

.expert-tab::-webkit-scrollbar-thumb {
  background: var(--border-color, #e0e0e0);
  border-radius: 3px;
}

.expert-tab::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary, #999);
}
</style>
