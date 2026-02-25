<template>
  <div class="debug-tab">
    <!-- 管理员操作区 -->
    <div v-if="isAdmin" class="debug-section admin-section">
      <h4>{{ $t('debug.adminOperations') }}</h4>
      <button class="clear-history-btn" @click="handleClearHistory" :disabled="isClearing || !currentExpertId">
        <span v-if="isClearing">{{ $t('debug.clearing') }}</span>
        <span v-else>{{ $t('debug.clearHistory') }}</span>
      </button>
    </div>

    <!-- 使用模型（移到顶部） -->
    <div class="debug-section">
      <h4>{{ $t('debug.model') }}</h4>
      <div class="stat-row">
        <span class="stat-label">{{ $t('model.title') }}</span>
        <span class="stat-value">{{ currentModel?.name || '-' }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{{ $t('model.provider') }}</span>
        <span class="stat-value">{{ providerName }}</span>
      </div>
      <!-- temperature 不在 AIModel 类型中，暂时隐藏 -->
    </div>

    <!-- 本次会话（原 TOKEN 消耗） -->
    <div v-if="lastMessage" class="debug-section">
      <h4>{{ $t('debug.currentSession') }}</h4>
      <div class="stat-row">
        <span class="stat-label">{{ $t('debug.promptTokens') }}</span>
        <span class="stat-value">{{ lastMessage.metadata?.tokens?.prompt_tokens || 0 }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{{ $t('debug.completionTokens') }}</span>
        <span class="stat-value">{{ lastMessage.metadata?.tokens?.completion_tokens || 0 }}</span>
      </div>
      <div class="stat-row total">
        <span class="stat-label">{{ $t('debug.totalTokens') }}</span>
        <span class="stat-value">{{ lastMessage.metadata?.tokens?.total_tokens || 0 }}</span>
      </div>
      <div class="stat-row" v-if="lastMessage.metadata?.cost">
        <span class="stat-label">{{ $t('debug.cost') }}</span>
        <span class="stat-value">${{ lastMessage.metadata.cost.toFixed(4) }}</span>
      </div>
    </div>

    <!-- 响应时间 -->
    <div v-if="lastMessage?.metadata?.latency" class="debug-section">
      <h4>{{ $t('debug.responseTime') }}</h4>
      <div class="stat-row">
        <span class="stat-label">{{ $t('debug.latency') }}</span>
        <span class="stat-value">{{ lastMessage.metadata.latency }}ms</span>
      </div>
      <div class="stat-row" v-if="lastMessage.metadata.cached">
        <span class="stat-label">{{ $t('debug.cached') }}</span>
        <span class="stat-value">✓</span>
      </div>
    </div>

    <!-- 历史总计（原会话统计） -->
    <div class="debug-section">
      <h4>{{ $t('debug.historyTotal') }}</h4>
      <div class="stat-row">
        <span class="stat-label">{{ $t('debug.messageCount') }}</span>
        <span class="stat-value">{{ chatStore.messages.length }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{{ $t('debug.totalTokens') }}</span>
        <span class="stat-value">{{ totalTokens }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{{ $t('debug.estimatedCost') }}</span>
        <span class="stat-value">${{ totalCost.toFixed(4) }}</span>
      </div>
    </div>

    <!-- Payload（原 LLM Payload） -->
    <div class="debug-section">
      <div class="section-header">
        <h4>{{ $t('debug.payload') }}</h4>
        <button
          class="icon-btn"
          @click="loadLLMPayload"
          :disabled="isLoadingPayload || !currentExpertId"
          :title="$t('debug.refreshPayload')"
        >
          <span v-if="isLoadingPayload" class="loading-icon">⟳</span>
          <span v-else>🔄</span>
        </button>
      </div>
      <div v-if="llmPayload" class="payload-info">
        <div class="stat-row">
          <span class="stat-label">Model</span>
          <span class="stat-value">{{ llmPayload.model }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Messages</span>
          <span class="stat-value">{{ llmPayload.messages?.length || 0 }} 条</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Temperature</span>
          <span class="stat-value">{{ llmPayload.temperature }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Tools</span>
          <span class="stat-value">{{ llmPayload.tools?.length || 0 }} 个</span>
        </div>
        <div class="stat-row" v-if="llmPayload.cached_at">
          <span class="stat-label">缓存时间</span>
          <span class="stat-value">{{ formatTime(llmPayload.cached_at) }}</span>
        </div>
        <details class="payload-details">
          <summary>{{ $t('common.expand') }}</summary>
          <pre class="raw-data">{{ JSON.stringify(llmPayload, null, 2) }}</pre>
        </details>
      </div>
      <div v-else class="no-payload">
        <span v-if="!currentExpertId">{{ $t('debug.selectExpertFirst') }}</span>
        <span v-else>{{ $t('debug.noPayload') }}</span>
      </div>
    </div>

    <!-- Response（原原始数据） -->
    <div class="debug-section">
      <div class="section-header">
        <h4>{{ $t('debug.response') }}</h4>
      </div>
      <details v-if="lastMessage" class="response-details">
        <summary>{{ $t('common.expand') }}</summary>
        <pre class="raw-data">{{ JSON.stringify(lastMessage, null, 2) }}</pre>
      </details>
      <div v-else class="no-payload">
        <span>暂无响应数据</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/model'
import { useExpertStore } from '@/stores/expert'
import { useUserStore } from '@/stores/user'
import { useProviderStore } from '@/stores/provider'
import { messageApi, debugApi } from '@/api/services'

const chatStore = useChatStore()
const modelStore = useModelStore()
const expertStore = useExpertStore()
const userStore = useUserStore()
const providerStore = useProviderStore()

const isAdmin = computed(() => userStore.isAdmin)
const currentExpertId = computed(() => expertStore.currentExpert?.id)
const isClearing = ref(false)

// LLM Payload 相关状态
const llmPayload = ref<Record<string, unknown> | null>(null)
const isLoadingPayload = ref(false)

// 加载 LLM Payload
const loadLLMPayload = async () => {
  if (!currentExpertId.value) return
  
  isLoadingPayload.value = true
  try {
    const result = await debugApi.getLLMPayload(currentExpertId.value)
    llmPayload.value = result.payload
  } catch (error) {
    console.error('加载 LLM Payload 失败:', error)
    llmPayload.value = null
  } finally {
    isLoadingPayload.value = false
  }
}

// 格式化时间
const formatTime = (isoString: string) => {
  const date = new Date(isoString)
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// 监听专家切换，自动加载 Payload
watch(currentExpertId, (newId) => {
  if (newId) {
    loadLLMPayload()
  } else {
    llmPayload.value = null
  }
})

// 监听聊天消息变化，自动刷新 Payload（当有新消息时）
watch(() => chatStore.messages.length, () => {
  if (currentExpertId.value) {
    // 延迟刷新，等待后端缓存完成
    setTimeout(loadLLMPayload, 500)
  }
})

const handleClearHistory = async () => {
  if (!currentExpertId.value) return
  
  if (!confirm('确定要清空与当前专家的所有对话历史和话题吗？此操作不可恢复。')) {
    return
  }
  
  isClearing.value = true
  try {
    const result = await messageApi.clearMessagesByExpert(currentExpertId.value)
    // 清空本地消息列表
    chatStore.messages = []
    // 清空本地话题列表
    chatStore.topics = []
    // 清空 Payload
    llmPayload.value = null
    alert(`对话历史和话题已清空\n删除消息: ${result.deleted_messages_count} 条\n删除话题: ${result.deleted_topics_count} 个`)
  } catch (error) {
    alert('清空对话历史失败: ' + (error instanceof Error ? error.message : '未知错误'))
  } finally {
    isClearing.value = false
  }
}

// 从当前专家获取模型
const currentModel = computed(() => {
  const expert = expertStore.currentExpert
  if (expert?.expressive_model_id) {
    return modelStore.getModelById(expert.expressive_model_id)
  }
  return undefined
})

// 获取提供商名称（优先使用 model 自带的 provider_name）
const providerName = computed(() => {
  if (!currentModel.value) return '-'
  // 优先使用 model 自带的 provider_name
  if (currentModel.value.provider_name) {
    return currentModel.value.provider_name
  }
  // fallback: 从 provider store 查找
  if (currentModel.value.provider_id) {
    const provider = providerStore.getProviderById(currentModel.value.provider_id)
    return provider?.name || currentModel.value.provider_id
  }
  return '-'
})

const lastMessage = computed(() => {
  const messages = chatStore.sortedMessages
  return messages.length > 0 ? messages[messages.length - 1] : null
})

const totalTokens = computed(() => {
  return chatStore.messages.reduce((sum, msg) => {
    return sum + (msg.metadata?.tokens?.total_tokens || 0)
  }, 0)
})

const totalCost = computed(() => {
  return chatStore.messages.reduce((sum, msg) => {
    return sum + (msg.metadata?.cost || 0)
  }, 0)
})
</script>

<style scoped>
.debug-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 12px;
}

.debug-section {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--card-bg, #fff);
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
}

.debug-section h4 {
  font-size: 12px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--text-secondary, #666);
  text-transform: uppercase;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.section-header h4 {
  margin: 0;
}

.icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.2s;
}

.icon-btn:hover:not(:disabled) {
  background: var(--hover-bg, #f0f0f0);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-icon {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
}

.stat-row.total {
  border-top: 1px solid var(--border-color, #e0e0e0);
  margin-top: 4px;
  padding-top: 8px;
  font-weight: 600;
}

.stat-label {
  color: var(--text-secondary, #666);
}

.stat-value {
  color: var(--text-primary, #333);
  font-family: monospace;
}

.raw-data {
  font-size: 11px;
  background: var(--code-bg, #f5f5f5);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin-top: 8px;
  max-height: 200px;
  overflow-y: auto;
}

details summary {
  font-size: 12px;
  color: var(--text-secondary, #666);
  cursor: pointer;
}

.admin-section {
  border-color: #dc3545;
  background: #fff5f5;
}

.clear-history-btn {
  width: 100%;
  padding: 10px 16px;
  background: #dc3545;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.clear-history-btn:hover:not(:disabled) {
  background: #c82333;
}

.clear-history-btn:disabled {
  background: #6c757d;
  cursor: not-allowed;
}

.payload-info {
  margin-top: 8px;
}

.payload-details,
.response-details {
  margin-top: 12px;
}

.no-payload {
  text-align: center;
  color: var(--text-secondary, #666);
  font-size: 12px;
  padding: 16px;
  background: var(--code-bg, #f5f5f5);
  border-radius: 4px;
}
</style>
