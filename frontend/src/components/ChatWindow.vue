<template>
  <div class="chat-window">
    <!-- 专家大头像背景 -->
    <div 
      v-if="props.expertAvatarLarge" 
      class="messages-bg-avatar"
      :style="{ backgroundImage: `url(${props.expertAvatarLarge})` }"
    ></div>
    <!-- 消息列表 -->
    <div ref="messagesContainer" class="messages-container" @scroll="handleScroll">
      <!-- 加载更多历史消息（顶部） -->
      <div v-if="props.hasMoreMessages" class="load-more-top">
        <button
          class="btn-load-more"
          :disabled="props.isLoadingMore"
          @click="handleLoadMore"
        >
          {{ props.isLoadingMore ? $t('common.loading') : $t('chat.loadMoreHistory') }}
        </button>
      </div>
      <div v-if="messages.length === 0" class="empty-state">
        <p>{{ $t('chat.emptyState') }}</p>
      </div>
      <div
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="message.role"
      >
        <!-- tool 消息的特殊渲染 -->
        <template v-if="message.role === 'tool'">
          <div class="tool-message-card" :class="{ expanded: isToolExpanded(message.id) }">
            <!-- 收缩状态：一行显示 -->
            <div class="tool-header" @click="toggleToolExpand(message.id)">
              <span class="tool-icon">🔧</span>
              <span class="tool-name">{{ getToolName(message) }}</span>
              <span class="tool-status" :class="getToolStatus(message) ? 'success' : 'error'">
                {{ getToolStatus(message) ? '✅' : '❌' }}
              </span>
              <span v-if="getToolDuration(message)" class="tool-duration">
                {{ getToolDuration(message) }}ms
              </span>
              <span class="tool-expand-btn" :class="{ expanded: isToolExpanded(message.id) }">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
            </div>
            <!-- 展开状态：显示上下文、参数和结果 -->
            <div v-if="isToolExpanded(message.id)" class="tool-details">
              <div v-if="getToolContext(message)" class="tool-section context-section">
                <div class="tool-section-title">{{ $t('chat.toolContext') || '上下文' }}</div>
                <div class="tool-context-text">{{ getToolContext(message) }}</div>
              </div>
              <div v-if="getToolArguments(message)" class="tool-section">
                <div class="tool-section-title">{{ $t('chat.toolArguments') || '参数' }}</div>
                <pre class="tool-section-content">{{ formatToolArguments(message) }}</pre>
              </div>
              <div v-if="message.content" class="tool-section">
                <div class="tool-section-title">{{ $t('chat.toolResult') || '结果' }}</div>
                <pre class="tool-section-content">{{ formatToolResult(message) }}</pre>
              </div>
            </div>
          </div>
        </template>
        <!-- 普通 user/assistant 消息 -->
        <template v-else>
          <div class="message-avatar">
            <span v-if="message.role === 'user'">👤</span>
            <div
              v-else
              class="avatar-image"
              :style="props.expertAvatar ? { backgroundImage: `url(${props.expertAvatar})` } : {}"
            >
              <span v-if="!props.expertAvatar">🤖</span>
            </div>
          </div>
          <div class="message-content">
            <div class="message-text" v-html="formatMessage(message.content)"></div>
            <div v-if="message.status === 'streaming'" class="streaming-indicator">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
            <div v-if="message.status === 'error'" class="error-text">
              {{ $t('chat.sendError') }}
              <button class="retry-btn" @click="$emit('retry', message)">
                {{ $t('chat.retrySend') }}
              </button>
            </div>
            <div v-if="message.created_at && message.status !== 'streaming'" class="message-time">
              {{ formatTime(message.created_at) }}
            </div>
          </div>
        </template>
      </div>
      <div v-if="isLoading" class="message assistant">
        <div class="message-avatar">
          <div 
            class="avatar-image"
            :style="props.expertAvatar ? { backgroundImage: `url(${props.expertAvatar})` } : {}"
          >
            <span v-if="!props.expertAvatar">🤖</span>
          </div>
        </div>
        <div class="message-content">
          <div class="thinking-indicator">{{ $t('chat.thinking') }}</div>
        </div>
      </div>
    </div>

    <!-- 滚动到底部按钮 -->
    <button
      v-if="showScrollToBottom"
      class="scroll-to-bottom-btn"
      @click="handleScrollToBottom"
      :title="$t('chat.scrollToBottom') || '滚动到底部'"
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 16L6 10H18L12 16Z" fill="currentColor"/>
      </svg>
    </button>

    <!-- 快捷指令提示 (skill-studio 模式) -->
    <div v-if="showCommandHints && filteredCommands.length > 0" class="command-hints">
      <div 
        v-for="cmd in filteredCommands" 
        :key="cmd.command"
        class="command-item"
        @click="applyCommand(cmd)"
      >
        <span class="command-name">{{ cmd.command }}</span>
        <span class="command-desc">{{ cmd.description }}</span>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <div class="input-row">
        <textarea
          ref="inputRef"
          v-model="inputText"
          :placeholder="placeholderText"
          :disabled="isLoading || disabled"
          @keydown.enter.exact="handleEnterKey"
          @compositionstart="isComposing = true"
          @compositionend="isComposing = false"
          @blur="isComposing = false"
          @input="handleInput"
          rows="1"
          class="message-input"
        ></textarea>
        <!-- 停止按钮（加载中显示） -->
        <button
          v-if="isLoading"
          class="stop-button"
          @click="handleStop"
          :title="$t('chat.stopGenerate') || '停止生成'"
        >
          <svg class="stop-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
          </svg>
        </button>
        <!-- 发送按钮 -->
        <button
          v-else
          class="send-button"
          :disabled="!inputText.trim() || disabled"
          @click="handleSend"
        >
          <span>📤</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Message } from '@/types'

export type ChatMessage = Pick<Message, 'id' | 'role' | 'content' | 'status'> & {
  created_at?: string
  tool_calls?: string | Record<string, unknown>  // 工具调用信息（直接字段，不在 metadata 中）
  metadata?: {
    [key: string]: unknown
  }
}

const props = defineProps<{
  messages: ChatMessage[]
  isLoading?: boolean
  disabled?: boolean
  hasMoreMessages?: boolean
  isLoadingMore?: boolean
  expertAvatar?: string
  expertAvatarLarge?: string
  showCommandHints?: boolean
  customPlaceholder?: string
}>()

const emit = defineEmits<{
  send: [content: string]
  retry: [message: ChatMessage]
  loadMore: []
  stop: []
}>()

const { t } = useI18n()
const inputText = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const isComposing = ref(false) // 中文输入法组合状态
const showScrollToBottom = ref(false) // 是否显示滚动到底部按钮
const expandedTools = ref<Set<string>>(new Set()) // 展开的工具消息ID

// 切换工具展开状态
const toggleToolExpand = (messageId: string) => {
  if (expandedTools.value.has(messageId)) {
    expandedTools.value.delete(messageId)
  } else {
    expandedTools.value.add(messageId)
  }
}

// 检查工具是否展开
const isToolExpanded = (messageId: string): boolean => {
  return expandedTools.value.has(messageId)
}

// 快捷指令列表
const commands = [
  { command: '/import', description: t('commands.import') || '导入技能 (例: /import skills/searxng)', example: '/import skills/searxng' },
  { command: '/create', description: t('commands.create') || '创建新技能', example: '/create 天气查询技能' },
  { command: '/list', description: t('commands.list') || '列出所有技能', example: '/list' },
  { command: '/assign', description: t('commands.assign') || '分配技能给专家 (例: /assign weather 给助手)', example: '/assign weather to expert_name' },
  { command: '/help', description: t('commands.help') || '显示帮助信息', example: '/help' },
]

// 过滤后的指令
const filteredCommands = computed(() => {
  const text = inputText.value.trim()
  if (!text.startsWith('/')) return []
  
  const query = text.toLowerCase()
  return commands.filter(cmd => cmd.command.toLowerCase().startsWith(query))
})

// 占位符文本
const placeholderText = computed(() => {
  return props.customPlaceholder || t('chat.placeholder')
})

// 输入处理
const handleInput = () => {
  // 自动调整高度
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.style.height = 'auto'
      inputRef.value.style.height = inputRef.value.scrollHeight + 'px'
    }
  })
}

// 应用指令
const applyCommand = (cmd: typeof commands[0]) => {
  inputText.value = cmd.example
  inputRef.value?.focus()
}

// 记录滚动位置，用于加载更多后恢复
const scrollHeightBeforeLoad = ref(0)
const isLoadingTriggered = ref(false)

// 节流滚动控制 - 使用 requestAnimationFrame 避免频繁滚动
let scrollRafId: number | null = null
const scrollToBottom = () => {
  if (scrollRafId !== null) return // 已有待处理的滚动请求
  
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

// MutationObserver 用于检测消息 DOM 变化（处理异步内容加载）
let mutationObserver: MutationObserver | null = null
const isInitialLoad = ref(true) // 标记是否是初始加载
let scrollStabilizeTimer: ReturnType<typeof setTimeout> | null = null

// 强制滚动到底部（禁用 smooth 动画）
const forceScrollToBottom = () => {
  if (!messagesContainer.value) return
  
  // 临时禁用 smooth 滚动
  const originalBehavior = messagesContainer.value.style.scrollBehavior
  messagesContainer.value.style.scrollBehavior = 'auto'
  
  // 立即滚动
  messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  
  // 恢复 smooth 滚动
  requestAnimationFrame(() => {
    if (messagesContainer.value) {
      messagesContainer.value.style.scrollBehavior = originalBehavior
    }
  })
}

// 设置 MutationObserver 来处理异步内容渲染后的滚动
const setupMutationObserver = () => {
  if (!messagesContainer.value) return
  
  // 清理旧的 observer
  if (mutationObserver) {
    mutationObserver.disconnect()
  }
  
  mutationObserver = new MutationObserver(() => {
    // 只在初始加载时自动滚动到底部
    if (isInitialLoad.value) {
      // 清除之前的定时器
      if (scrollStabilizeTimer) {
        clearTimeout(scrollStabilizeTimer)
      }
      
      // 延迟滚动，等待所有 DOM 更新完成
      scrollStabilizeTimer = setTimeout(() => {
        if (messagesContainer.value && isInitialLoad.value) {
          forceScrollToBottom()
        }
      }, 100)
      
      // 经过一段时间后（内容基本稳定），结束初始加载状态
      setTimeout(() => {
        isInitialLoad.value = false
      }, 1500)
    }
  })
  
  // 监听子元素变化
  mutationObserver.observe(messagesContainer.value, {
    childList: true,
    subtree: true,
    characterData: true,
  })
}

// 格式化缓存 - 避免重复格式化相同内容
const formattedCache = new Map<string, string>()

// 检测是否在底部（距离底部 100px 以内视为在底部）
const isAtBottom = () => {
  if (!messagesContainer.value) return true
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
  return scrollHeight - scrollTop - clientHeight < 100
}

// 滚动处理：检测是否滚动到顶部 + 更新滚动到底部按钮状态
const handleScroll = () => {
  if (!messagesContainer.value) return
  
  // 用户手动滚动时，取消初始加载状态
  if (isInitialLoad.value && !isAtBottom()) {
    isInitialLoad.value = false
    if (scrollStabilizeTimer) {
      clearTimeout(scrollStabilizeTimer)
      scrollStabilizeTimer = null
    }
  }
  
  // 更新滚动到底部按钮状态
  showScrollToBottom.value = !isAtBottom()
  
  if (!props.hasMoreMessages || props.isLoadingMore) return
  
  const { scrollTop } = messagesContainer.value
  
  // 距离顶部 100px 以内时自动触发加载
  if (scrollTop < 100 && !isLoadingTriggered.value) {
    isLoadingTriggered.value = true
    // 记录当前滚动高度，用于加载后恢复位置
    scrollHeightBeforeLoad.value = messagesContainer.value.scrollHeight
    emit('loadMore')
  }
}

// 点击滚动到底部按钮
const handleScrollToBottom = () => {
  scrollToBottom()
  showScrollToBottom.value = false
}

// 手动点击加载更多
const handleLoadMore = () => {
  if (!messagesContainer.value) return
  scrollHeightBeforeLoad.value = messagesContainer.value.scrollHeight
  emit('loadMore')
}

// 监听消息数量变化（处理初始加载、新消息、加载更多）
watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    nextTick(() => {
      if (!messagesContainer.value || newLength === 0) return
      
      // 情况1：加载更多（消息数量增加且之前正在加载）
      if (props.isLoadingMore === false && isLoadingTriggered.value && newLength > (oldLength || 0)) {
        // 恢复滚动位置（保持在原来的消息位置）
        const newScrollHeight = messagesContainer.value.scrollHeight
        messagesContainer.value.scrollTop = newScrollHeight - scrollHeightBeforeLoad.value
        isLoadingTriggered.value = false
        return
      }
      
      // 情况2：初始加载或新消息 -> 设置 MutationObserver 来处理
      if (newLength > (oldLength || 0)) {
        // 标记为初始加载状态，MutationObserver 会处理滚动
        if (oldLength === 0 || oldLength === undefined) {
          isInitialLoad.value = true
          setupMutationObserver()
        } else {
          // 非初始加载的新消息，直接滚动
          scrollToBottom()
        }
        showScrollToBottom.value = false
      }
    })
  },
  { immediate: true } // 立即执行以处理初始加载
)

// 监听最后一条消息的状态变化（用于流式更新时的滚动）
watch(
  () => props.messages[props.messages.length - 1]?.status,
  (status) => {
    if (status === 'streaming') {
      scrollToBottom()
    }
  }
)

// 发送消息
const handleSend = async () => {
  const content = inputText.value.trim()

  if (!content || props.isLoading || props.disabled) return

  emit('send', content)
  inputText.value = ''

  // 调整输入框高度
  if (inputRef.value) {
    inputRef.value.style.height = 'auto'
  }
}

// 处理 Enter 键（检测输入法状态）
const handleEnterKey = (event: KeyboardEvent) => {
  // 检查自定义状态和原生事件属性，确保输入法组合期间不发送
  // event.isComposing 在现代浏览器中于 IME 组合期间为 true
  if (isComposing.value || event.isComposing) return

  event.preventDefault()
  handleSend()
}

// 停止生成
const handleStop = () => {
  emit('stop')
}

// 配置 marked 选项
marked.setOptions({
  breaks: true, // 支持 GitHub 风格的换行
  gfm: true, // 启用 GitHub Flavored Markdown
})

// 格式化消息（支持完整的 markdown，带缓存）
const formatMessage = (content: string) => {
  if (!content) return ''
  
  // 检查缓存
  const cached = formattedCache.get(content)
  if (cached !== undefined) {
    return cached
  }
  
  try {
    // 使用 marked 解析 Markdown
    const rawHtml = marked.parse(content) as string
    
    // 使用 DOMPurify 进行 XSS 防护
    // 允许安全的 HTML 标签和属性
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'hr', 'div', 'span'
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'class',
        'target', 'rel',
        'width', 'height'
      ],
      // 允许 data: URI 用于图片（如 base64 图片）
      ALLOW_DATA_ATTR: true,
    })
    
    // 缓存结果（限制缓存大小）
    if (formattedCache.size > 100) {
      const firstKey = formattedCache.keys().next().value
      if (firstKey) formattedCache.delete(firstKey)
    }
    formattedCache.set(content, cleanHtml)
    
    return cleanHtml
  } catch (error) {
    console.error('Markdown parsing error:', error)
    // 解析失败时返回转义后的原文
    return content
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/\n/g, '<br>')
  }
}

// 格式化时间显示
const formatTime = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  // 1分钟内显示"刚刚"
  if (diffMins < 1) return t('chat.timeJustNow') || '刚刚'
  // 1小时内显示"X分钟前"
  if (diffHours < 1) return t('chat.timeMinutesAgo', { n: diffMins }) || `${diffMins}分钟前`
  // 今天显示"HH:mm"
  if (diffDays < 1) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  // 昨天显示"昨天 HH:mm"
  if (diffDays === 1) {
    return t('chat.timeYesterday') + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  // 一周内显示"X天前"
  if (diffDays < 7) {
    return t('chat.timeDaysAgo', { n: diffDays }) || `${diffDays}天前`
  }
  // 更早显示"MM-DD HH:mm"
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
         date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 自动调整输入框高度
const adjustTextareaHeight = () => {
  if (inputRef.value) {
    inputRef.value.style.height = 'auto'
    inputRef.value.style.height = Math.min(inputRef.value.scrollHeight, 150) + 'px'
  }
}

watch(inputText, adjustTextareaHeight)

onMounted(() => {
  // 设置 MutationObserver 来处理初始加载后的滚动
  setupMutationObserver()
})

onUnmounted(() => {
  // 清理待处理的 RAF
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
  // 清理 MutationObserver
  if (mutationObserver) {
    mutationObserver.disconnect()
    mutationObserver = null
  }
  // 清理定时器
  if (scrollStabilizeTimer) {
    clearTimeout(scrollStabilizeTimer)
    scrollStabilizeTimer = null
  }
  // 清理格式化缓存
  formattedCache.clear()
})

// ==================== Tool 消息处理方法 ====================

interface ToolCallData {
  tool_call_id?: string
  name?: string
  tool_name?: string
  content?: string
  success?: boolean
  duration?: number
  timestamp?: string
  arguments?: Record<string, unknown>
  result?: unknown
  context?: string  // 工具调用前的状态文本上下文
}

/**
 * 解析 tool 消息的 tool_calls 字段
 * 注意：tool_calls 是消息的直接字段，不在 metadata 中
 */
const parseToolCalls = (message: ChatMessage): ToolCallData | null => {
  if (!message.tool_calls) return null
  
  try {
    const toolCalls = typeof message.tool_calls === 'string'
      ? JSON.parse(message.tool_calls)
      : message.tool_calls
    return toolCalls as ToolCallData
  } catch {
    return null
  }
}

/**
 * 获取工具名称
 */
const getToolName = (message: ChatMessage): string => {
  const toolData = parseToolCalls(message)
  if (toolData?.name) return toolData.name
  if (toolData?.tool_name) return toolData.tool_name
  return 'unknown_tool'
}

/**
 * 获取工具执行状态
 */
const getToolStatus = (message: ChatMessage): boolean => {
  const toolData = parseToolCalls(message)
  return toolData?.success ?? true
}

/**
 * 获取工具执行耗时
 */
const getToolDuration = (message: ChatMessage): number | null => {
  const toolData = parseToolCalls(message)
  return toolData?.duration ?? null
}

/**
 * 获取工具参数
 */
const getToolArguments = (message: ChatMessage): Record<string, unknown> | null => {
  const toolData = parseToolCalls(message)
  return toolData?.arguments ?? null
}

/**
 * 获取工具上下文（工具调用前的状态文本）
 */
const getToolContext = (message: ChatMessage): string | null => {
  const toolData = parseToolCalls(message)
  return toolData?.context ?? null
}

/**
 * 格式化工具参数显示
 */
const formatToolArguments = (message: ChatMessage): string => {
  const args = getToolArguments(message)
  if (!args) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

/**
 * 格式化工具结果显示
 */
const formatToolResult = (message: ChatMessage): string => {
  if (!message.content) return ''
  
  // 尝试解析 JSON 格式化显示
  try {
    const parsed = JSON.parse(message.content)
    return JSON.stringify(parsed, null, 2)
  } catch {
    // 非JSON，直接显示（截断过长的内容）
    const maxLength = 500
    if (message.content.length > maxLength) {
      return message.content.substring(0, maxLength) + '\n...(已截断)'
    }
    return message.content
  }
}

defineExpose({
  scrollToBottom
})
</script>

<style scoped>
.chat-window {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--chat-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 0 0 12px 12px;
  overflow: hidden;
  position: relative;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scroll-behavior: smooth;
  position: relative;
}

.messages-bg-avatar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 65px;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  opacity: 0.15;
  filter: blur(2px);
  pointer-events: none;
  z-index: 0;
}

.load-more-top {
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
}

.btn-load-more {
  padding: 8px 16px;
  background: var(--secondary-bg, #f5f5f5);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 16px;
  font-size: 13px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-load-more:hover:not(:disabled) {
  background: var(--hover-bg, #e8e8e8);
  color: var(--primary-color, #2196f3);
}

.btn-load-more:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #666);
  font-size: 14px;
  position: relative;
  z-index: 1;
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--avatar-bg, #f0f0f0);
  border-radius: 50%;
  font-size: 18px;
}

.message-avatar .avatar-image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message.user .message-avatar {
  background: var(--primary-color, #2196f3);
}

.message-content {
  max-width: 70%;
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--message-bg, #f5f5f5);
  word-break: break-word;
}

.message.user .message-content {
  background: var(--user-message-bg, #e3f2fd);
  border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
  border-bottom-left-radius: 4px;
}

.message-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #333);
}

/* Markdown 标题样式 */
.message-text :deep(h1),
.message-text :deep(h2),
.message-text :deep(h3),
.message-text :deep(h4),
.message-text :deep(h5),
.message-text :deep(h6) {
  margin: 16px 0 8px 0;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary, #333);
}

.message-text :deep(h1) { font-size: 1.5em; border-bottom: 1px solid var(--border-color, #e0e0e0); padding-bottom: 8px; }
.message-text :deep(h2) { font-size: 1.35em; border-bottom: 1px solid var(--border-color, #e0e0e0); padding-bottom: 6px; }
.message-text :deep(h3) { font-size: 1.2em; }
.message-text :deep(h4) { font-size: 1.1em; }
.message-text :deep(h5) { font-size: 1em; }
.message-text :deep(h6) { font-size: 0.95em; color: var(--text-secondary, #666); }

/* Markdown 段落样式 */
.message-text :deep(p) {
  margin: 8px 0;
}

.message-text :deep(p:first-child) {
  margin-top: 0;
}

.message-text :deep(p:last-child) {
  margin-bottom: 0;
}

/* Markdown 列表样式 */
.message-text :deep(ul),
.message-text :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.message-text :deep(li) {
  margin: 4px 0;
}

.message-text :deep(ul) {
  list-style-type: disc;
}

.message-text :deep(ol) {
  list-style-type: decimal;
}

.message-text :deep(ul ul) {
  list-style-type: circle;
}

.message-text :deep(ul ul ul) {
  list-style-type: square;
}

/* Markdown 引用块样式 */
.message-text :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 16px;
  border-left: 4px solid var(--primary-color, #2196f3);
  background: var(--blockquote-bg, #f8f9fa);
  color: var(--text-secondary, #666);
  border-radius: 0 4px 4px 0;
}

.message-text :deep(blockquote p) {
  margin: 4px 0;
}

/* Markdown 代码块样式 */
.message-text :deep(pre) {
  background: var(--code-bg, #1e1e1e);
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
  position: relative;
}

.message-text :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #d4d4d4;
  font-size: 13px;
  line-height: 1.5;
  display: block;
}

/* 行内代码样式 */
.message-text :deep(code) {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
}

.message-text :deep(code:not(pre code)) {
  background: var(--code-bg, #f0f0f0);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--code-color, #d63384);
}

/* Markdown 表格样式 */
.message-text :deep(table) {
  border-collapse: collapse;
  margin: 12px 0;
  width: 100%;
  font-size: 13px;
}

.message-text :deep(th),
.message-text :deep(td) {
  border: 1px solid var(--border-color, #e0e0e0);
  padding: 8px 12px;
  text-align: left;
}

.message-text :deep(th) {
  background: var(--table-header-bg, #f5f5f5);
  font-weight: 600;
}

.message-text :deep(tr:nth-child(even)) {
  background: var(--table-row-alt-bg, #fafafa);
}

/* Markdown 水平分割线样式 */
.message-text :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color, #e0e0e0);
  margin: 16px 0;
}

/* Markdown 链接样式 */
.message-text :deep(a) {
  color: var(--primary-color, #2196f3);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s;
}

.message-text :deep(a:hover) {
  border-bottom-color: var(--primary-color, #2196f3);
}

/* Markdown 图片样式 */
.message-text :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 8px 0;
}

/* Markdown 删除线样式 */
.message-text :deep(del),
.message-text :deep(s) {
  color: var(--text-secondary, #666);
  text-decoration: line-through;
}

/* Markdown 强调和加粗样式 */
.message-text :deep(strong) {
  font-weight: 600;
}

.message-text :deep(em) {
  font-style: italic;
}

.message-time {
  font-size: 11px;
  color: var(--text-hint, #999);
  margin-top: 6px;
  text-align: right;
}

.message.assistant .message-time {
  text-align: left;
}

.streaming-indicator {
  display: inline-flex;
  gap: 4px;
  margin-left: 8px;
}

.streaming-indicator .dot {
  width: 6px;
  height: 6px;
  background: var(--primary-color, #2196f3);
  border-radius: 50%;
  animation: pulse 1s infinite;
}

.streaming-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.streaming-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.thinking-indicator {
  color: var(--text-secondary, #666);
  font-style: italic;
}

.error-text {
  color: var(--error-color, #c62828);
  font-size: 12px;
  margin-top: 8px;
}

.retry-btn {
  background: none;
  border: none;
  color: var(--primary-color, #2196f3);
  cursor: pointer;
  text-decoration: underline;
  font-size: 12px;
  margin-left: 8px;
}

.input-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e8e8e8);
  background: var(--input-area-bg, #fafafa);
  position: relative;
}

/* 输入框容器 - 增加精致边框效果 */
.input-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  background: var(--input-row-bg, #fff);
  border: 1.5px solid var(--input-border, #e0e0e0);
  border-radius: 28px;
  padding: 6px 8px 6px 20px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.input-row:focus-within {
  border-color: var(--primary-color, #2196f3);
  box-shadow: 0 4px 16px rgba(33, 150, 243, 0.15), 0 2px 8px rgba(0, 0, 0, 0.06);
}

.message-input {
  flex: 1;
  padding: 12px 0;
  border: none;
  border-radius: 24px;
  font-size: 15px;
  resize: none;
  outline: none;
  background: transparent;
  color: var(--text-primary, #1a1a1a);
  font-family: inherit;
  line-height: 1.5;
  max-height: 150px;
  overflow-y: auto;
  letter-spacing: 0.01em;
}

.message-input:focus {
  border-color: transparent;
}

.message-input:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.message-input::placeholder {
  color: var(--text-placeholder, #a0a0a0);
}

/* 现代滚动条样式 */
.message-input::-webkit-scrollbar {
  width: 6px;
}

.message-input::-webkit-scrollbar-track {
  background: transparent;
}

.message-input::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb, #ccc);
  border-radius: 3px;
}

.message-input::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover, #aaa);
}

.send-button {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--primary-color, #2196f3), var(--primary-gradient-end, #42a5f5));
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(33, 150, 243, 0.3);
}

.send-button:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--primary-hover, #1976d2), var(--primary-color, #2196f3));
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(33, 150, 243, 0.4);
}

.send-button:active:not(:disabled) {
  transform: translateY(0) scale(0.96);
  box-shadow: 0 2px 6px rgba(33, 150, 243, 0.3);
}

.send-button:disabled {
  background: var(--disabled-bg, #e0e0e0);
  cursor: not-allowed;
  box-shadow: none;
}

.send-button span {
  display: flex;
  align-items: center;
  justify-content: center;
}

.stop-button {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--danger-color, #ef4444), var(--danger-gradient-end, #f87171));
  color: white;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.35);
}

.stop-button:hover {
  background: linear-gradient(135deg, var(--danger-hover, #dc2626), var(--danger-color, #ef4444));
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.45);
}

.stop-button:active {
  transform: translateY(0) scale(0.96);
  box-shadow: 0 2px 6px rgba(239, 68, 68, 0.35);
}

.stop-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 快捷指令提示 */
.command-hints {
  position: absolute;
  bottom: 100%;
  left: 16px;
  right: 16px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.1);
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
  margin-bottom: 4px;
}

.command-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.command-item:hover {
  background: var(--bg-hover, #f0f0f0);
}

.command-item:first-child {
  border-radius: 8px 8px 0 0;
}

.command-item:last-child {
  border-radius: 0 0 8px 8px;
}

.command-name {
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-color, #2196f3);
  min-width: 80px;
}

.command-desc {
  font-size: 13px;
  color: var(--text-secondary, #666);
}

/* 滚动到底部按钮 */
.scroll-to-bottom-btn {
  position: absolute;
  bottom: 90px;
  right: 24px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 10;
}

.scroll-to-bottom-btn:hover {
  background: var(--primary-color, #2196f3);
  border-color: var(--primary-color, #2196f3);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(33, 150, 243, 0.3);
}

.scroll-to-bottom-btn:hover svg {
  color: white;
}

.scroll-to-bottom-btn svg {
  width: 20px;
  height: 20px;
  color: var(--text-secondary, #666);
  transition: color 0.2s;
}

/* ==================== Tool 消息样式 ==================== */
.message.tool {
  justify-content: flex-start;  /* 左对齐 */
}

.tool-message-card {
  background: var(--tool-card-bg, #f8f9fa);
  border: 1px solid var(--tool-card-border, #e9ecef);
  border-radius: 12px;
  padding: 10px 14px;
  width: 50%;  /* 固定宽度为 chatbox 的一半 */
  max-width: 50%;
  min-width: 300px;  /* 最小宽度保证可读性 */
  font-size: 13px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;
}

.tool-message-card.expanded {
  background: var(--tool-card-expanded-bg, #fff);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.tool-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tool-name {
  font-weight: 500;
  color: var(--text-primary, #333);
  font-family: 'Consolas', 'Monaco', monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-status {
  font-size: 12px;
  flex-shrink: 0;
}

.tool-status.success {
  color: var(--success-color, #4caf50);
}

.tool-status.error {
  color: var(--error-color, #f44336);
}

.tool-duration {
  font-size: 10px;
  color: var(--text-hint, #999);
  background: var(--chip-bg, #e8e8e8);
  padding: 2px 6px;
  border-radius: 10px;
  flex-shrink: 0;
}

.tool-expand-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.tool-expand-btn svg {
  width: 16px;
  height: 16px;
}

.tool-expand-btn.expanded {
  transform: rotate(180deg);
}

.tool-details {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color, #e8e8e8);
  animation: slideDown 0.2s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tool-section {
  margin-bottom: 10px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.tool-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
  padding: 0 4px;
}

/* Tool context 样式 */
.tool-section.context-section {
  margin-bottom: 12px;
}

.tool-context-text {
  background: var(--tool-context-bg, #f0f7ff);
  border-left: 3px solid var(--primary-color, #2196f3);
  border-radius: 4px;
  padding: 8px 12px;
  color: var(--text-primary, #333);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 150px;
  overflow-y: auto;
}

.tool-section-content {
  background: var(--code-bg, #1e1e1e);
  border-radius: 8px;
  padding: 10px 12px;
  color: #d4d4d4;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}
</style>
