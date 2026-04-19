<template>
  <div class="home-view">
    <div class="welcome-section">
      <h1 class="welcome-title">{{ $t('experts.title') }}</h1>
      <p class="welcome-subtitle">{{ $t('experts.subtitle') }}</p>
    </div>

    <div class="quick-start">
      <h2 class="section-title">{{ $t('experts.quickStart') }}</h2>
      
      <!-- 加载状态 -->
      <div v-if="expertStore.isLoading" class="loading-state">
        <div class="loading-spinner"></div>
        <span>{{ $t('common.loading') }}</span>
      </div>
      
      <!-- 空状态 -->
      <div v-else-if="!expertStore.activeExperts || expertStore.activeExperts.length === 0" class="empty-state">
        <p>{{ $t('experts.noExperts') }}</p>
        <button class="btn-go-settings" @click="router.push('/system/experts')">
          {{ $t('experts.goAddExpert') }}
        </button>
      </div>
      
      <!-- 专家列表 -->
      <div v-else class="expert-grid">
        <div
          v-for="expert in (expertStore.activeExperts || []).slice(0, 6)"
          :key="expert.id"
          class="expert-card"
          :class="{ 'is-starting': startingExpertId === expert.id }"
          @click="startWithExpert(expert.id)"
        >
          <div 
            class="expert-icon" 
            :style="expert.avatar_base64 ? { backgroundImage: `url(${expert.avatar_base64})` } : {}"
          >
            <span v-if="!expert.avatar_base64">🤖</span>
          </div>
          <div class="expert-name">{{ expert.name }}</div>
          <div class="expert-desc">{{ (expert.introduction || '').slice(0, 50) }}{{ (expert.introduction || '').length > 50 ? '...' : '' }}</div>
          <div v-if="startingExpertId === expert.id" class="card-loading-overlay">
            <div class="loading-spinner small"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMessage" class="error-toast">
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useExpertStore } from '@/stores/expert'

/**
 * HomeView - 首页/专家选择页
 * 
 * 核心设计：
 * - 入口是选择 expert，点击后跳转到 /chat/:expertId
 * - topic 不再是入口，只是对话历史的阶段性总结
 * - 移除了"最近话题"部分，因为话题不能作为 session 入口
 */

const router = useRouter()
const { t } = useI18n()
const expertStore = useExpertStore()

// 正在启动的专家 ID（用于显示加载状态）
const startingExpertId = ref<string | null>(null)
// 错误信息
const errorMessage = ref<string | null>(null)

const startWithExpert = async (expertId: string) => {
  // 如果已经在加载中，直接返回
  if (startingExpertId.value) return
  
  startingExpertId.value = expertId
  errorMessage.value = null
  
  try {
    // 设置当前专家
    expertStore.setCurrentExpert(expertId)
    // 跳转到聊天页面，使用 expertId 作为参数
    router.push({ name: 'chat', params: { expertId } })
  } catch (err) {
    console.error('Failed to start with expert:', err)
    errorMessage.value = err instanceof Error ? err.message : 'Failed to start chat'
    // 3秒后自动清除错误信息
    setTimeout(() => {
      errorMessage.value = null
    }, 3000)
  } finally {
    startingExpertId.value = null
  }
}

onMounted(async () => {
  try {
    await expertStore.loadExperts({ is_active: true })
  } catch (err) {
    console.error('Failed to load experts:', err)
  }
})
</script>

<style scoped>
.home-view {
  padding: 32px;
  max-width: 800px;
  margin: 0 auto;
}

.welcome-section {
  text-align: center;
  margin-bottom: 48px;
}

.welcome-title {
  font-size: 32px;
  font-weight: 700;
  margin: 0 0 12px 0;
  color: var(--text-primary, #333);
}

.welcome-subtitle {
  font-size: 16px;
  color: var(--text-secondary, #666);
  margin: 0;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px 0;
  color: var(--text-primary, #333);
}

.quick-start {
  margin-bottom: 48px;
}

.expert-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 768px) {
  .expert-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .expert-grid {
    grid-template-columns: 1fr;
  }
}

.expert-card {
  padding: 16px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.expert-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.expert-icon {
  width: 48px;
  height: 48px;
  font-size: 28px;
  margin-bottom: 8px;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  background-color: var(--secondary-bg, #f8f9fa);
  display: flex;
  align-items: center;
  justify-content: center;
}

.expert-name {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-primary, #333);
}

.expert-desc {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

/* 加载状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: var(--text-secondary, #666);
  gap: 12px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color, #e0e0e0);
  border-top-color: var(--primary-color, #2196f3);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-spinner.small {
  width: 20px;
  height: 20px;
  border-width: 2px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-secondary, #666);
}

.empty-state p {
  margin: 0 0 16px 0;
}

.btn-go-settings {
  padding: 10px 24px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-go-settings:hover {
  background: var(--primary-hover, #1976d2);
}

/* 专家卡片加载状态 */
.expert-card {
  position: relative;
}

.expert-card.is-starting {
  pointer-events: none;
  opacity: 0.7;
}

.card-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 12px;
}

/* 错误提示 */
.error-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background: var(--error-color, #c62828);
  color: white;
  border-radius: 8px;
  font-size: 14px;
  z-index: 1000;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>
