<template>
  <div class="assistant-roster">
    <!-- 头部 -->
    <div class="roster-header">
      <h3>{{ $t('assistant.rosterTitle') }}</h3>
      <button class="refresh-btn" :disabled="isLoading" @click="loadAssistants">
        <span class="refresh-icon" :class="{ spinning: isLoading }">🔄</span>
        {{ $t('common.refresh') }}
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-state">
      <span class="loading-spinner"></span>
      <span>{{ $t('common.loading') }}</span>
    </div>

    <!-- 空状态 -->
    <div v-else-if="assistants.length === 0" class="empty-state">
      <div class="empty-icon">🤖</div>
      <p>{{ $t('assistant.noAssistants') }}</p>
    </div>

    <!-- 助理列表 -->
    <div v-else class="assistant-list">
      <div
        v-for="assistant in assistants"
        :key="assistant.assistant_type"
        class="assistant-item"
        :class="{ inactive: !assistant.is_active }"
      >
        <!-- 图标 -->
        <div class="assistant-icon">
          {{ getIcon(assistant.icon, assistant.assistant_type) }}
        </div>

        <!-- 信息 -->
        <div class="assistant-info">
          <div class="assistant-name">
            {{ assistant.name }}
            <span class="assistant-type">({{ assistant.assistant_type }})</span>
          </div>
          <div v-if="assistant.description" class="assistant-description">
            {{ assistant.description }}
          </div>
          <div class="assistant-meta">
            <span class="meta-item">
              <span class="meta-label">{{ $t('assistant.executionMode') }}:</span>
              <span class="meta-value mode-badge" :class="assistant.execution_mode">
                {{ assistant.execution_mode }}
              </span>
            </span>
            <span v-if="assistant.model_id" class="meta-item">
              <span class="meta-label">{{ $t('assistant.model') }}:</span>
              <span class="meta-value">{{ assistant.model_id }}</span>
            </span>
            <span class="meta-item">
              <span class="meta-label">{{ $t('assistant.estimatedTime') }}:</span>
              <span class="meta-value">{{ assistant.estimated_time }}s</span>
            </span>
          </div>
        </div>

        <!-- 状态 -->
        <div class="assistant-status">
          <span class="status-indicator" :class="{ active: assistant.is_active }">
            {{ assistant.is_active ? $t('assistant.active') : $t('assistant.inactive') }}
          </span>
        </div>
      </div>
    </div>

    <!-- 统计 -->
    <div class="roster-footer">
      <span class="stats">
        {{ $t('assistant.totalAssistants', { count: assistants.length }) }}
      </span>
      <span class="stats">
        {{ $t('assistant.activeAssistants', { count: activeCount }) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Assistant } from '@/types'
import { assistantApi } from '@/api/services'

const { t } = useI18n()

const assistants = ref<Assistant[]>([])
const isLoading = ref(false)

// 活跃助理数量
const activeCount = computed(() => {
  return assistants.value.filter((a) => a.is_active).length
})

// 获取图标
function getIcon(icon: string | undefined, type: string): string {
  if (icon) return icon

  const defaultIcons: Record<string, string> = {
    ocr: '📝',
    drawing: '🎨',
    coding: '💻',
    math: '🔢',
    vision: '🖼️',
    translator: '🌐',
    default: '🤖',
  }

  return defaultIcons[type] ?? '🤖'
}

// 加载助理列表
async function loadAssistants() {
  isLoading.value = true
  try {
    assistants.value = await assistantApi.getAssistants()
  } catch (error) {
    console.error('Failed to load assistants:', error)
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  loadAssistants()
})
</script>

<style scoped>
.assistant-roster {
  background: var(--card-bg, #fff);
  border-radius: 8px;
  padding: 16px;
}

.roster-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.roster-header h3 {
  margin: 0;
  font-size: 16px;
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--bg-secondary, #f5f5f5);
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--text-secondary, #666);
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-color, #eee);
  border-top-color: var(--primary-color, #007bff);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 8px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.assistant-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.assistant-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 6px;
  transition: all 0.2s;
}

.assistant-item:hover {
  background: var(--bg-tertiary, #e9e9e9);
}

.assistant-item.inactive {
  opacity: 0.6;
}

.assistant-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.assistant-info {
  flex: 1;
  min-width: 0;
}

.assistant-name {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}

.assistant-type {
  font-size: 12px;
  color: var(--text-secondary, #666);
  font-weight: normal;
}

.assistant-description {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
  line-height: 1.4;
}

.assistant-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.meta-item {
  font-size: 11px;
}

.meta-label {
  color: var(--text-secondary, #666);
}

.meta-value {
  font-weight: 500;
}

.mode-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  text-transform: uppercase;
}

.mode-badge.direct {
  background: #d4edda;
  color: #155724;
}

.mode-badge.llm {
  background: #cce5ff;
  color: #004085;
}

.mode-badge.hybrid {
  background: #fff3cd;
  color: #856404;
}

.assistant-status {
  flex-shrink: 0;
}

.status-indicator {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  background: #f8d7da;
  color: #721c24;
}

.status-indicator.active {
  background: #d4edda;
  color: #155724;
}

.roster-footer {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #eee);
  font-size: 12px;
  color: var(--text-secondary, #666);
}
</style>