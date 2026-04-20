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
        <!-- tool 消息的特殊渲染 - 简洁内敛风格 -->
        <template v-if="message.role === 'tool'">
          <div class="tool-message-card" :class="{ expanded: isToolExpanded(message.id) }">
            <!-- 工具消息头部 - 与普通消息一致的风格 -->
            <div class="tool-header" @click="toggleToolExpand(message.id)">
              <div class="tool-header-main">
                <span class="tool-icon">🔧</span>
                <span class="tool-name">{{ getToolName(message) }}</span>
                <span class="tool-meta">
                  <span class="tool-time">{{ formatToolTime(message) }}</span>
                  <span v-if="getToolDuration(message)" class="tool-duration">{{ getToolDuration(message) }}ms</span>
                </span>
                <span class="tool-status" :class="getToolStatus(message) ? 'success' : 'error'">
                  {{ getToolStatus(message) ? '✓' : '✗' }}
                </span>
                <span class="tool-expand-btn" :class="{ expanded: isToolExpanded(message.id) }">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </div>
              <!-- 上下文预览 - 专家说的话，正常颜色，不截断 -->
              <div v-if="getToolContext(message)" class="tool-context-line">
                <span class="tool-context-icon">💭</span>
                <span class="tool-context-text">{{ getToolContext(message) }}</span>
              </div>
            </div>
            <!-- 展开状态：显示参数和结果 -->
            <div v-if="isToolExpanded(message.id)" class="tool-details">
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
            <!-- 工具调用卡片（仅 assistant 消息且存在 tool_calls 时显示，用于历史数据兼容） -->
            <div
              v-if="message.role === 'assistant' && message.tool_calls"
              class="tool-calls-section"
            >
              <div
                v-for="(toolCall, index) in parseToolCallsToArray(message)"
                :key="`${message.id}-tool-${index}`"
                class="tool-message-card embedded"
                :class="{ expanded: isToolExpanded(`${message.id}-tool-${index}`) }"
              >
                <!-- 工具消息头部 -->
                <div class="tool-header" @click="toggleToolExpand(`${message.id}-tool-${index}`)">
                  <div class="tool-header-main">
                    <span class="tool-icon">🔧</span>
                    <span class="tool-name">{{ toolCall.name || toolCall.tool_name || 'unknown_tool' }}</span>
                    <span class="tool-meta">
                      <span class="tool-time">{{ formatToolCallTime(toolCall) }}</span>
                      <span v-if="toolCall.duration" class="tool-duration">{{ toolCall.duration }}ms</span>
                    </span>
                    <span class="tool-status" :class="toolCall.success !== false ? 'success' : 'error'">
                      {{ toolCall.success !== false ? '✓' : '✗' }}
                    </span>
                    <span class="tool-expand-btn" :class="{ expanded: isToolExpanded(`${message.id}-tool-${index}`) }">
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </span>
                  </div>
                  <!-- 上下文预览 -->
                  <div v-if="toolCall.context" class="tool-context-line">
                    <span class="tool-context-icon">💭</span>
                    <span class="tool-context-text">{{ toolCall.context }}</span>
                  </div>
                </div>
                <!-- 展开状态：显示参数和结果 -->
                <div v-if="isToolExpanded(`${message.id}-tool-${index}`)" class="tool-details">
                  <div v-if="toolCall.arguments" class="tool-section">
                    <div class="tool-section-title">{{ $t('chat.toolArguments') || '参数' }}</div>
                    <pre class="tool-section-content">{{ formatToolCallArguments(toolCall) }}</pre>
                  </div>
                  <div v-if="toolCall.result" class="tool-section">
                    <div class="tool-section-title">{{ $t('chat.toolResult') || '结果' }}</div>
                    <pre class="tool-section-content">{{ formatToolCallResult(toolCall) }}</pre>
                  </div>
                </div>
              </div>
            </div>
            <!-- 思考内容区域（仅 assistant 消息且存在 reasoning_content 时显示） -->
            <div
              v-if="message.role === 'assistant' && message.reasoning_content"
              class="reasoning-section"
              :class="{ expanded: isReasoningExpanded(message.id) }"
            >
              <div class="reasoning-header" @click="toggleReasoningExpand(message.id)">
                <span class="reasoning-icon">💭</span>
                <span class="reasoning-title">{{ $t('chat.thinkingProcess') || '思考过程' }}</span>
                <span class="reasoning-expand-btn" :class="{ expanded: isReasoningExpanded(message.id) }">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </div>
              <div v-if="isReasoningExpanded(message.id)" class="reasoning-content">
                <pre class="reasoning-text">{{ message.reasoning_content }}</pre>
              </div>
            </div>
            <!-- 消息正文 -->
            <div
              class="message-text"
              :class="{ 'streaming-text': message.status === 'streaming' }"
              v-html="formatStreamingMessage(message)"
            ></div>
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
          :title="$t('chat.send') || '发送'"
        >
          <svg class="send-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Message } from '@/types'
import { renderMermaidInHtml } from '@/utils/mermaid'

export type ChatMessage = Pick<Message, 'id' | 'role' | 'content' | 'status' | 'reasoning_content' | 'tool_calls'> & {
  created_at?: string
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
const expandedReasoning = ref<Set<string>>(new Set()) // 展开的思考内容消息ID

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

// 切换思考内容展开状态
const toggleReasoningExpand = (messageId: string) => {
  if (expandedReasoning.value.has(messageId)) {
    expandedReasoning.value.delete(messageId)
  } else {
    expandedReasoning.value.add(messageId)
  }
}

// 检查思考内容是否展开
const isReasoningExpanded = (messageId: string): boolean => {
  return expandedReasoning.value.has(messageId)
}

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

// ==================== 简化的滚动控制逻辑 ====================
// 核心原则：只有一个状态变量控制是否应该自动滚动

// 用户是否在底部（用于判断是否应该自动滚动到新消息）
const isUserAtBottom = ref(true)

// 加载更多相关状态
const scrollHeightBeforeLoad = ref(0)
const isLoadingTriggered = ref(false)

// 格式化缓存 - 避免重复格式化相同内容
const formattedCache = new Map<string, string>()

// Mermaid 渲染缓存 - 存储每条消息的渲染结果（响应式）
const mermaidRenderedHtml = ref<Map<string, string>>(new Map())

// Mermaid 缓存最大限制
const MERMAID_CACHE_MAX_SIZE = 50

// 正在渲染 Mermaid 的消息 ID 集合
const renderingMermaid = ref<Set<string>>(new Set())

// 检测是否在底部（距离底部 100px 以内视为在底部）
const checkIsAtBottom = () => {
  if (!messagesContainer.value) return true
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
  return scrollHeight - scrollTop - clientHeight < 100
}

// 滚动到底部（支持即时滚动，用于流式输出）
const scrollToBottom = (instant = false) => {
  if (!messagesContainer.value) return
  
  if (instant) {
    // 临时禁用 smooth 滚动，避免流式输出时的"追赶"效果
    const original = messagesContainer.value.style.scrollBehavior
    messagesContainer.value.style.scrollBehavior = 'auto'
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    messagesContainer.value.style.scrollBehavior = original
  } else {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

// 滚动处理：检测是否滚动到顶部 + 更新用户位置状态
const handleScroll = () => {
  if (!messagesContainer.value) return
  
  // 更新用户是否在底部的状态
  isUserAtBottom.value = checkIsAtBottom()
  
  // 更新滚动到底部按钮状态
  showScrollToBottom.value = !isUserAtBottom.value
  
  // 检测是否需要加载更多
  if (!props.hasMoreMessages || props.isLoadingMore) return
  
  const { scrollTop } = messagesContainer.value
  
  // 距离顶部 100px 以内时自动触发加载
  if (scrollTop < 100 && !isLoadingTriggered.value) {
    isLoadingTriggered.value = true
    scrollHeightBeforeLoad.value = messagesContainer.value.scrollHeight
    emit('loadMore')
  }
}

// 点击滚动到底部按钮
const handleScrollToBottom = () => {
  isUserAtBottom.value = true
  scrollToBottom()
  showScrollToBottom.value = false
}

// 手动点击加载更多
const handleLoadMore = () => {
  if (!messagesContainer.value) return
  scrollHeightBeforeLoad.value = messagesContainer.value.scrollHeight
  isLoadingTriggered.value = true
  emit('loadMore')
}

// 监听消息数量变化
watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    nextTick(() => {
      if (!messagesContainer.value || newLength === 0) return
      
      // 情况1：加载更多完成
      if (isLoadingTriggered.value && props.isLoadingMore === false && newLength > (oldLength || 0)) {
        // 恢复滚动位置
        const newScrollHeight = messagesContainer.value.scrollHeight
        messagesContainer.value.scrollTop = newScrollHeight - scrollHeightBeforeLoad.value
        isLoadingTriggered.value = false
        isUserAtBottom.value = checkIsAtBottom()
        return
      }
      
      // 情况2：新消息到达
      if (newLength > (oldLength || 0)) {
        // 初始加载：强制滚动到底部
        if (oldLength === 0 || oldLength === undefined) {
          scrollToBottom()
          isUserAtBottom.value = true
        } else {
          // 非初始加载：只有用户在底部时才滚动
          if (isUserAtBottom.value) {
            scrollToBottom()
          }
        }
        showScrollToBottom.value = !checkIsAtBottom()
      }
    })
  },
  { immediate: true }
)

// 流式输出节流控制
let streamingScrollRaf: number | null = null

// 监听最后一条消息的内容变化（流式更新时保持滚动到底部）
watch(
  () => props.messages[props.messages.length - 1]?.content,
  () => {
    // 流式输出时，如果用户在底部则即时滚动（使用 RAF 节流）
    if (isUserAtBottom.value) {
      if (streamingScrollRaf === null) {
        streamingScrollRaf = requestAnimationFrame(() => {
          streamingScrollRaf = null
          scrollToBottom(true)
        })
      }
    }
  }
)

// 发送消息
const handleSend = () => {
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

// 检测内容是否包含 Mermaid 代码块
const containsMermaid = (content: string): boolean => {
  return /```mermaid\s*[\s\S]*?```/i.test(content)
}

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
    // 允许安全的 HTML 标签和属性（包括 mermaid 相关）
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'hr', 'div', 'span',
        'svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'g', 'title', 'desc', 'defs', 'marker', 'use', 'tspan', 'foreignObject' // Mermaid SVG 标签
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'class',
        'target', 'rel',
        'width', 'height',
        // SVG 属性
        'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
        'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
        'transform', 'viewBox', 'xmlns', 'id', 'points', 'text-anchor',
        'dominant-baseline', 'font-size', 'font-family', 'font-weight', 'font-style',
        'opacity', 'marker-end', 'marker-start', 'marker-mid', 'refX', 'refY',
        'markerWidth', 'markerHeight', 'orient', 'overflow', 'style', 'data-*'
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
    return escapeHtml(content)
  }
}

/**
 * 转义 HTML 特殊字符（用于纯文本渲染）
 */
const escapeHtml = (text: string): string => {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

/**
 * 异步渲染消息中的 Mermaid 图表
 * @param message 消息对象
 * @param html 已格式化的 HTML
 */
const renderMermaidAsync = async (message: ChatMessage, html: string) => {
  const messageId = message.id
  
  // 标记正在渲染
  renderingMermaid.value.add(messageId)
  
  try {
    // 渲染 Mermaid 图表
    const renderedHtml = await renderMermaidInHtml(html)
    
    // 限制缓存大小
    limitMermaidCache()
    
    // 更新渲染结果
    mermaidRenderedHtml.value.set(messageId, renderedHtml)
    // 触发响应式更新
    mermaidRenderedHtml.value = new Map(mermaidRenderedHtml.value)
  } catch (error) {
    console.error('Mermaid rendering error:', error)
    // 渲染失败时使用原始 HTML
    mermaidRenderedHtml.value.set(messageId, html)
    mermaidRenderedHtml.value = new Map(mermaidRenderedHtml.value)
  } finally {
    // 移除渲染中标记
    renderingMermaid.value.delete(messageId)
  }
}

/**
 * 格式化消息（流式输出优化）
 * - 流式输出时：跳过 Markdown 解析，直接显示纯文本（性能优化）
 * - 输出完成后：正常解析 Markdown，并异步渲染 Mermaid 图表
 */
const formatStreamingMessage = (message: ChatMessage): string => {
  if (!message.content) return ''
  
  // 流式输出时跳过 Markdown 解析，避免频繁的 CPU 密集操作
  if (message.status === 'streaming') {
    return escapeHtml(message.content)
  }
  
  const filteredContent = filterAssistantContent(message)
  
  // 检查是否有缓存的 Mermaid 渲染结果
  const cachedRendered = mermaidRenderedHtml.value.get(message.id)
  if (cachedRendered) {
    return cachedRendered
  }
  
  // 正常解析 Markdown
  const html = formatMessage(filteredContent)
  
  // 检测是否包含 Mermaid 代码块
  if (containsMermaid(filteredContent)) {
    // 如果正在渲染，返回原始 HTML
    if (renderingMermaid.value.has(message.id)) {
      return html
    }
    
    // 异步渲染 Mermaid（不阻塞当前渲染）
    renderMermaidAsync(message, html)
    
    // 先返回原始 HTML，渲染完成后会自动更新
    return html
  }
  
  return html
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

// 注意：初始滚动由 watch 的 immediate: true 处理，无需在 onMounted 中重复

/**
 * 限制 Mermaid 缓存大小
 */
const limitMermaidCache = () => {
  if (mermaidRenderedHtml.value.size > MERMAID_CACHE_MAX_SIZE) {
    const keysToDelete = mermaidRenderedHtml.value.size - MERMAID_CACHE_MAX_SIZE
    const keys = Array.from(mermaidRenderedHtml.value.keys()).slice(0, keysToDelete)
    keys.forEach(key => mermaidRenderedHtml.value.delete(key))
  }
}

onUnmounted(() => {
  // 清理格式化缓存
  formattedCache.clear()
  // 清理 Mermaid 渲染缓存
  mermaidRenderedHtml.value.clear()
  renderingMermaid.value.clear()
  // 清理流式滚动 RAF
  if (streamingScrollRaf !== null) {
    cancelAnimationFrame(streamingScrollRaf)
    streamingScrollRaf = null
  }
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
  } catch (e) {
    console.error('[ChatWindow] parseToolCalls error:', e, 'tool_calls:', message.tool_calls)
    return null
  }
}

/**
 * 解析 tool_calls 字段为数组（支持单个对象或数组）
 */
const parseToolCallsToArray = (message: ChatMessage): ToolCallData[] => {
  if (!message.tool_calls) return []
  
  try {
    const toolCalls = typeof message.tool_calls === 'string'
      ? JSON.parse(message.tool_calls)
      : message.tool_calls
    
    // 如果是数组，直接返回
    if (Array.isArray(toolCalls)) {
      return toolCalls as ToolCallData[]
    }
    // 如果是单个对象，包装成数组
    return [toolCalls as ToolCallData]
  } catch {
    return []
  }
}

/**
 * 格式化工具调用时间（用于嵌入式的工具卡片）
 */
const formatToolCallTime = (toolCall: ToolCallData): string => {
  if (!toolCall.timestamp) {
    return '--:--:--'
  }
  const date = new Date(toolCall.timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * 格式化工具调用参数（用于嵌入式的工具卡片）
 */
const formatToolCallArguments = (toolCall: ToolCallData): string => {
  if (!toolCall.arguments) return ''
  try {
    const jsonStr = JSON.stringify(toolCall.arguments, null, 2)
    return addLineNumbers(jsonStr)
  } catch {
    return addLineNumbers(String(toolCall.arguments))
  }
}

/**
 * 格式化工具调用结果（用于嵌入式的工具卡片）
 */
const formatToolCallResult = (toolCall: ToolCallData): string => {
  if (!toolCall.result) return ''
  
  // 尝试解析 JSON 格式化显示
  try {
    const parsed = typeof toolCall.result === 'string'
      ? JSON.parse(toolCall.result)
      : toolCall.result
    const jsonStr = JSON.stringify(parsed, null, 2)
    return addLineNumbers(jsonStr)
  } catch {
    // 非JSON，直接显示（截断过长的内容）
    const resultStr = typeof toolCall.result === 'string'
      ? toolCall.result
      : JSON.stringify(toolCall.result)
    const maxLength = 5000
    if (resultStr.length > maxLength) {
      return addLineNumbers(resultStr.substring(0, maxLength) + '\n...(已截断)')
    }
    return addLineNumbers(resultStr)
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
 * 获取工具时间戳
 */
const getToolTimestamp = (message: ChatMessage): string | null => {
  const toolData = parseToolCalls(message)
  return toolData?.timestamp ?? null
}

/**
 * 格式化工具时间显示（完整时间 HH:mm:ss）
 */
const formatToolTime = (message: ChatMessage): string => {
  const timestamp = getToolTimestamp(message)
  if (!timestamp) {
    // 如果没有 timestamp，使用 message.created_at
    if (message.created_at) {
      const date = new Date(message.created_at)
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }
    return '--:--:--'
  }
  
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * 过滤 assistant 消息内容，移除之前 tool call 的 context
 * 在工具调用结束后，专家回复中可能包含之前几步的 context，需要过滤掉
 */
const filterAssistantContent = (message: ChatMessage): string => {
  if (!message.content) return ''
  if (message.role !== 'assistant') return message.content

  // 获取当前消息之前的所有 tool 消息的 context
  const currentIndex = props.messages.findIndex(m => m.id === message.id)
  if (currentIndex === -1) return message.content

  // 收集当前消息之前所有 tool 消息的 context
  const toolContexts: string[] = []
  for (let i = 0; i < currentIndex; i++) {
    const msg = props.messages[i]
    if (msg && msg.role === 'tool') {
      const context = getToolContext(msg)
      if (context && context.trim()) {
        toolContexts.push(context.trim())
      }
    }
  }

  // 如果没有 tool context，直接返回原内容
  if (toolContexts.length === 0) return message.content

  // 过滤掉 message.content 中包含的 tool context
  let filteredContent = message.content
  for (const context of toolContexts) {
    // 使用正则表达式移除 context，支持多种格式
    // 1. 直接匹配 context 文本
    if (filteredContent.includes(context)) {
      filteredContent = filteredContent.replace(context, '')
    }
    // 2. 处理可能带有引号或 markdown 格式的 context
    const escapedContext = context.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(`>\\s*${escapedContext}`, 'g'), // 引用格式
      new RegExp(`"${escapedContext}"`, 'g'), // 引号格式
      new RegExp(`'${escapedContext}'`, 'g'), // 单引号格式
    ]
    for (const pattern of patterns) {
      filteredContent = filteredContent.replace(pattern, '')
    }
  }

  // 清理多余的空行
  filteredContent = filteredContent.replace(/\n{3,}/g, '\n\n').trim()

  return filteredContent || message.content // 如果过滤后为空，返回原内容
}

/**
 * 格式化工具参数显示（带行号）
 */
const formatToolArguments = (message: ChatMessage): string => {
  const args = getToolArguments(message)
  if (!args) return ''
  try {
    const jsonStr = JSON.stringify(args, null, 2)
    return addLineNumbers(jsonStr)
  } catch {
    return addLineNumbers(String(args))
  }
}

/**
 * 格式化工具结果显示（带行号）
 */
const formatToolResult = (message: ChatMessage): string => {
  if (!message.content) return ''

  // 尝试解析 JSON 格式化显示
  try {
    const parsed = JSON.parse(message.content)
    const jsonStr = JSON.stringify(parsed, null, 2)
    return addLineNumbers(jsonStr)
  } catch {
    // 非JSON，直接显示（截断过长的内容）
    const maxLength = 5000
    if (message.content.length > maxLength) {
      return addLineNumbers(message.content.substring(0, maxLength) + '\n...(已截断)')
    }
    return addLineNumbers(message.content)
  }
}

/**
 * 为代码添加行号
 */
const addLineNumbers = (code: string): string => {
  if (!code) return ''
  const lines = code.split('\n')
  const lineNumberWidth = String(lines.length).length
  return lines
    .map((line, index) => {
      const lineNum = String(index + 1).padStart(lineNumberWidth, ' ')
      return `${lineNum} | ${line}`
    })
    .join('\n')
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

/* 流式输出时的纯文本样式 */
.message-text.streaming-text {
  white-space: pre-wrap;
  word-wrap: break-word;
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

/* ==================== 思考内容样式 ==================== */
.reasoning-section {
  margin-bottom: 12px;
  background: var(--reasoning-bg, #f8f9fa);
  border-radius: 12px;
  border: 1px solid var(--reasoning-border, #e0e0e0);
  overflow: hidden;
}

.reasoning-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.reasoning-header:hover {
  background: var(--reasoning-header-hover, #f0f0f0);
}

.reasoning-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.reasoning-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  flex: 1;
}

.reasoning-expand-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.reasoning-expand-btn svg {
  width: 16px;
  height: 16px;
}

.reasoning-expand-btn.expanded {
  transform: rotate(180deg);
}

.reasoning-content {
  padding: 0 14px 12px 14px;
  animation: slideDown 0.2s ease;
}

.reasoning-text {
  margin: 0;
  padding: 12px;
  background: var(--code-bg, #fff);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
  color: var(--text-primary, #333);
  font-family: inherit;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border-color, #e8e8e8);
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

/* 商务简约风格 - 输入区域 */
.input-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e5e7eb);
  background: var(--input-area-bg, #f9fafb);
  position: relative;
}

/* 商务简约风格 - 输入框容器 */
.input-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  background: var(--input-row-bg, #ffffff);
  border: 1px solid var(--input-border, #e5e7eb);
  border-radius: 12px;
  padding: 8px 12px 8px 16px;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.input-row:focus-within {
  border-color: var(--primary-color, #2563eb);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
}

/* 商务简约风格 - 输入框 */
.message-input {
  flex: 1;
  padding: 10px 0;
  border: none;
  border-radius: 0;
  font-size: 15px;
  resize: none;
  outline: none;
  background: transparent;
  color: var(--text-primary, #1f2937);
  font-family: inherit;
  line-height: 1.6;
  max-height: 150px;
  overflow-y: auto;
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

/* 商务简约风格 - 发送按钮 */
.send-button {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color, #2563eb);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.2);
}

.send-button:hover:not(:disabled) {
  background: var(--primary-hover, #1d4ed8);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
}

.send-button:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.2);
}

.send-button:disabled {
  background: var(--disabled-bg, #e5e7eb);
  cursor: not-allowed;
  box-shadow: none;
}

.send-button:disabled .send-icon {
  color: var(--text-disabled, #9ca3af);
}

.send-icon {
  width: 18px;
  height: 18px;
  color: white;
  transition: transform 0.2s ease;
}

.send-button:hover:not(:disabled) .send-icon {
  transform: translateX(1px);
}

/* 商务简约风格 - 停止按钮 */
.stop-button {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: var(--danger-color, #dc2626);
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(220, 38, 38, 0.2);
}

.stop-button:hover {
  background: var(--danger-hover, #b91c1c);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25);
}

.stop-button:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(220, 38, 38, 0.2);
}

.stop-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
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

/* ==================== Tool 消息样式 - 简洁内敛风格 ==================== */
.message.tool {
  justify-content: flex-start;
}

.tool-message-card {
  background: var(--message-bg, #f5f5f5);
  border-radius: 16px;
  padding: 12px 16px;
  max-width: 70%;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #333);
  word-break: break-word;
}

.tool-message-card.expanded {
  background: var(--message-bg, #f5f5f5);
}

.tool-header {
  cursor: pointer;
  user-select: none;
}

.tool-header-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-icon {
  font-size: 16px;
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

.tool-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.tool-time {
  font-family: 'Consolas', 'Monaco', monospace;
}

.tool-duration {
  color: var(--text-hint, #999);
}

.tool-status {
  font-size: 14px;
  flex-shrink: 0;
  font-weight: 500;
}

.tool-status.success {
  color: var(--success-color, #4caf50);
}

.tool-status.error {
  color: var(--error-color, #f44336);
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

/* 上下文预览 - 专家说的话，正常颜色，不截断 */
.tool-context-line {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  font-size: 14px;
  color: var(--text-primary, #333);
  line-height: 1.6;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.tool-context-icon {
  flex-shrink: 0;
  font-size: 14px;
  margin-top: 1px;
}

.tool-context-text {
  white-space: pre-wrap;
  word-wrap: break-word;
  flex: 1;
}

.tool-details {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #e0e0e0);
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
  margin-bottom: 12px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.tool-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  margin-bottom: 8px;
}

.tool-context-text {
  background: var(--code-bg, #f0f0f0);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text-primary, #333);
  font-size: 13px;
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
  white-space: pre;
  word-wrap: normal;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

/* ==================== 嵌入式工具调用卡片样式 ==================== */
.tool-calls-section {
  margin-bottom: 12px;
}

.tool-message-card.embedded {
  background: var(--tool-card-bg, #f8f9fa);
  border: 1px solid var(--tool-card-border, #e0e0e0);
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 8px;
  max-width: 100%;
}

.tool-message-card.embedded:last-child {
  margin-bottom: 0;
}

.tool-message-card.embedded .tool-header-main {
  flex-wrap: wrap;
}

.tool-message-card.embedded .tool-name {
  font-size: 13px;
}

.tool-message-card.embedded .tool-expand-btn {
  width: 18px;
  height: 18px;
}

.tool-message-card.embedded .tool-expand-btn svg {
  width: 14px;
  height: 14px;
}

.tool-message-card.embedded .tool-context-line {
  font-size: 13px;
}

.tool-message-card.embedded .tool-details {
  margin-top: 10px;
  padding-top: 10px;
}

.tool-message-card.embedded .tool-section-content {
  font-size: 11px;
  padding: 8px 10px;
  max-height: 150px;
}

/* ==================== Mermaid 图表样式 ==================== */
.message-text :deep(.mermaid-container) {
  margin: 12px 0;
  padding: 16px;
  background: var(--mermaid-bg, #f8f9fa);
  border-radius: 12px;
  overflow-x: auto;
  border: 1px solid var(--border-color, #e0e0e0);
}

.message-text :deep(.mermaid-container svg) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}

/* Mermaid 加载状态 */
.message-text :deep(.mermaid-loading) {
  padding: 16px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-style: italic;
  background: var(--mermaid-bg, #f8f9fa);
  border-radius: 8px;
}

/* Mermaid 错误状态 */
.message-text :deep(.mermaid-error) {
  padding: 12px 16px;
  background: var(--error-bg, #fff5f5);
  border: 1px solid var(--error-border, #ffcdd2);
  border-radius: 8px;
  color: var(--error-color, #c62828);
}

.message-text :deep(.mermaid-error-icon) {
  margin-right: 8px;
}

.message-text :deep(.mermaid-error-text) {
  font-weight: 500;
  display: block;
  margin-bottom: 8px;
}

.message-text :deep(.mermaid-error-code) {
  margin: 8px 0 0 0;
  padding: 8px 12px;
  background: var(--code-bg, #1e1e1e);
  color: #d4d4d4;
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Mermaid 流程图样式优化 */
.message-text :deep(.mermaid-container .flowchart-link) {
  stroke: var(--mermaid-line-color, #666);
  stroke-width: 1.5px;
}

.message-text :deep(.mermaid-container .flowchart-node rect) {
  fill: var(--mermaid-node-bg, #fff);
  stroke: var(--mermaid-node-border, #2196f3);
  stroke-width: 1.5px;
}

.message-text :deep(.mermaid-container .flowchart-node text) {
  fill: var(--text-primary, #333);
  font-size: 14px;
}

/* Mermaid 时序图样式优化 */
.message-text :deep(.mermaid-container .actor) {
  stroke: var(--mermaid-actor-border, #2196f3);
  fill: var(--mermaid-actor-bg, #e3f2fd);
}

.message-text :deep(.mermaid-container .sequenceNumber) {
  fill: var(--mermaid-sequence-number, #fff);
}

.message-text :deep(.mermaid-container #arrowhead) {
  fill: var(--mermaid-arrow-color, #666);
}

/* Mermaid 类图样式优化 */
.message-text :deep(.mermaid-container .classBox) {
  stroke: var(--mermaid-class-border, #4caf50);
  fill: var(--mermaid-class-bg, #e8f5e9);
}

/* Mermaid 状态图样式优化 */
.message-text :deep(.mermaid-container .statediagram-state) {
  stroke: var(--mermaid-state-border, #ff9800);
  fill: var(--mermaid-state-bg, #fff3e0);
}

/* Mermaid 甘特图样式优化 */
.message-text :deep(.mermaid-container .section) {
  stroke: none;
  opacity: 0.2;
}

.message-text :deep(.mermaid-container .grid .tick) {
  stroke: var(--border-color, #e0e0e0);
  opacity: 0.3;
}

/* 暗色主题适配 */
@media (prefers-color-scheme: dark) {
  .message-text :deep(.mermaid-container) {
    background: var(--mermaid-bg-dark, #1e1e1e);
    border-color: var(--border-color-dark, #333);
  }
  
  .message-text :deep(.mermaid-container .flowchart-node rect) {
    fill: var(--mermaid-node-bg-dark, #2d2d2d);
    stroke: var(--mermaid-node-border-dark, #42a5f5);
  }
  
  .message-text :deep(.mermaid-container .flowchart-node text) {
    fill: var(--text-primary-dark, #e0e0e0);
  }
}
</style>
