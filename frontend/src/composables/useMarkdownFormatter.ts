import { ref } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage } from '@/components/ChatWindow.vue'
import { renderMermaidInHtml } from '@/utils/mermaid'

marked.setOptions({
  breaks: true,
  gfm: true,
})

const MERMAID_CACHE_MAX_SIZE = 50
const MESSAGE_HTML_CACHE_MAX_SIZE = 200
const FORMATTED_CACHE_MAX_SIZE = 256

const formattedCache = new Map<string, string>()
const messageHtmlCache = new Map<string, { cacheKey: string; html: string }>()
const mermaidRenderedHtml = ref<Map<string, string>>(new Map())
const renderingMermaid = ref<Set<string>>(new Set())

const escapeHtml = (text: string): string => {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

const escapeAttribute = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const INLINE_MATH_HINT_RE = /(?:\\[a-zA-Z]+|[=^_{}]|\d\s*[+\-*/]\s*\d|[A-Za-z]\s*[+\-*/=^_]\s*[A-Za-z\d])/

const looksLikeInlineMath = (formula: string): boolean => {
  const normalized = formula.trim()
  if (!normalized) return false

  // Treat plain money/percentage/unit snippets as normal text, not math.
  if (/^\d+(?:[.,]\d+)?(?:\s*(?:%|[A-Za-z]{1,5}|[\u4e00-\u9fa5]{1,3}))?$/.test(normalized)) {
    return false
  }

  return INLINE_MATH_HINT_RE.test(normalized)
}

const normalizeInlineMath = (content: string): string => {
  return content.replace(/(^|[^\\\w])\$([^\n$]+)\$(?!\$)/g, (_, prefix: string, formula: string) => {
    if (!looksLikeInlineMath(formula)) {
      return `${prefix}$${formula}$`
    }
    return `${prefix}<code class="inline-math" data-inline-math="${escapeAttribute(formula.trim())}"></code>`
  })
}

const sanitizeMarkdownHtml = (rawHtml: string): string => {
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr', 'div', 'span',
      'svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'g', 'title', 'desc', 'defs', 'marker', 'use', 'tspan'
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class',
      'target', 'rel',
      'width', 'height',
      'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
      'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
      'transform', 'viewBox', 'xmlns', 'id', 'points', 'text-anchor',
      'dominant-baseline', 'font-size', 'font-family', 'font-weight', 'font-style',
      'opacity', 'marker-end', 'marker-start', 'marker-mid', 'refX', 'refY',
      'markerWidth', 'markerHeight', 'orient', 'overflow', 'data-*'
    ],
    ALLOW_DATA_ATTR: true,
  })
}

const formatMessage = (content: string) => {
  if (!content) return ''

  const cached = formattedCache.get(content)
  if (cached !== undefined) {
    return cached
  }

  try {
    const normalizedContent = normalizeInlineMath(content)
    const rawHtml = marked.parse(normalizedContent) as string
    const cleanHtml = sanitizeMarkdownHtml(rawHtml)

    if (formattedCache.size > FORMATTED_CACHE_MAX_SIZE) {
      const keysToDelete = formattedCache.size - FORMATTED_CACHE_MAX_SIZE
      const keys = Array.from(formattedCache.keys()).slice(0, keysToDelete)
      keys.forEach(key => formattedCache.delete(key))
    }
    formattedCache.set(content, cleanHtml)

    return cleanHtml
  } catch (error) {
    console.error('Markdown parsing error:', error)
    return escapeHtml(content)
  }
}

const containsMermaid = (content: string): boolean => {
  return /```mermaid\s*[\s\S]*?```/i.test(content)
}

const renderMermaidAsync = async (message: ChatMessage, html: string) => {
  const messageId = message.id

  renderingMermaid.value.add(messageId)

  try {
    const renderedHtml = await renderMermaidInHtml(html)

    if (mermaidRenderedHtml.value.size > MERMAID_CACHE_MAX_SIZE) {
      const keysToDelete = mermaidRenderedHtml.value.size - MERMAID_CACHE_MAX_SIZE
      const keys = Array.from(mermaidRenderedHtml.value.keys()).slice(0, keysToDelete)
      keys.forEach(key => mermaidRenderedHtml.value.delete(key))
    }

    mermaidRenderedHtml.value.set(messageId, renderedHtml)
    mermaidRenderedHtml.value = new Map(mermaidRenderedHtml.value)
  } catch (error) {
    console.error('Mermaid rendering error:', error)
    mermaidRenderedHtml.value.set(messageId, html)
    mermaidRenderedHtml.value = new Map(mermaidRenderedHtml.value)
  } finally {
    renderingMermaid.value.delete(messageId)
  }
}

const buildMessageCacheKey = (message: ChatMessage, filteredContent: string): string => {
  return [
    message.status || '',
    message.updated_at || '',
    message.reasoning_content || '',
    filteredContent,
  ].join('||')
}

const limitMessageHtmlCache = () => {
  if (messageHtmlCache.size <= MESSAGE_HTML_CACHE_MAX_SIZE) return
  const keysToDelete = messageHtmlCache.size - MESSAGE_HTML_CACHE_MAX_SIZE
  const keys = Array.from(messageHtmlCache.keys()).slice(0, keysToDelete)
  keys.forEach(key => messageHtmlCache.delete(key))
}

const formatStreamingMessage = (message: ChatMessage, filteredContent: string): string => {
  if (!message.content) return ''

  if (message.status === 'streaming') {
    return escapeHtml(message.content)
  }

  const cacheKey = buildMessageCacheKey(message, filteredContent)
  const cachedHtml = messageHtmlCache.get(message.id)

  if (cachedHtml?.cacheKey === cacheKey) {
    return cachedHtml.html
  }

  const cachedRendered = mermaidRenderedHtml.value.get(message.id)
  if (cachedRendered) {
    messageHtmlCache.set(message.id, { cacheKey, html: cachedRendered })
    limitMessageHtmlCache()
    return cachedRendered
  }

  const html = formatMessage(filteredContent)

  if (containsMermaid(filteredContent)) {
    if (renderingMermaid.value.has(message.id)) {
      messageHtmlCache.set(message.id, { cacheKey, html })
      limitMessageHtmlCache()
      return html
    }

    renderMermaidAsync(message, html)

    messageHtmlCache.set(message.id, { cacheKey, html })
    limitMessageHtmlCache()
    return html
  }

  messageHtmlCache.set(message.id, { cacheKey, html })
  limitMessageHtmlCache()
  return html
}

const clearCaches = () => {
  formattedCache.clear()
  messageHtmlCache.clear()
  mermaidRenderedHtml.value.clear()
  renderingMermaid.value.clear()
}

let instance: ReturnType<typeof createInstance> | null = null

function createInstance() {
  return {
    escapeHtml,
    formatMessage,
    sanitizeMarkdownHtml,
    containsMermaid,
    formatStreamingMessage,
    mermaidRenderedHtml,
    clearCaches,
  }
}

export function useMarkdownFormatter() {
  if (!instance) {
    instance = createInstance()
  }
  return instance
}
