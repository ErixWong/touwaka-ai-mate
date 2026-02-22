<template>
  <div class="debug-tab">
    <!-- 当前消息统计 -->
    <div v-if="lastMessage" class="debug-section">
      <h4>{{ $t('debug.tokenCount') }}</h4>
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

    <!-- 模型信息 -->
    <div class="debug-section">
      <h4>{{ $t('debug.model') }}</h4>
      <div class="stat-row">
        <span class="stat-label">{{ $t('model.title') }}</span>
        <span class="stat-value">{{ currentModel?.name || '-' }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{{ $t('model.provider') }}</span>
        <span class="stat-value">{{ currentModel?.provider_id || '-' }}</span>
      </div>
      <!-- temperature 不在 AIModel 类型中，暂时隐藏 -->
    </div>

    <!-- 会话统计 -->
    <div class="debug-section">
      <h4>{{ $t('debug.sessionStats') }}</h4>
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

    <!-- 原始数据 -->
    <div class="debug-section">
      <h4>{{ $t('debug.rawData') }}</h4>
      <details v-if="lastMessage">
        <summary>{{ $t('debug.lastMessage') }}</summary>
        <pre class="raw-data">{{ JSON.stringify(lastMessage, null, 2) }}</pre>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useModelStore } from '@/stores/model'
import { useExpertStore } from '@/stores/expert'

const chatStore = useChatStore()
const modelStore = useModelStore()
const expertStore = useExpertStore()

// 从当前专家获取模型
const currentModel = computed(() => {
  const expert = expertStore.currentExpert
  if (expert?.expressive_model_id) {
    return modelStore.getModelById(expert.expressive_model_id)
  }
  return undefined
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
</style>
