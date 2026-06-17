import { ref } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { ChatMessage } from '@/components/ChatWindow.vue'
import { renderMermaidInHtml } from '@/utils/mermaid'

marked.setOptions({
  breaks: true,
  gfm: true,
})

const MERMAID_CACHE_MAX_SIZE = 50
const MESSAGE_HTML_CACHE_MAX_SIZE = 200
const FORMULA_TOKEN_PREFIX = 'COPILOT_FORMULA_TOKEN_'

const formattedCache = new Map<string, string>()
const messageHtmlCache = new Map<string, { cacheKey: string; html: string }>()
const mermaidRenderedHtml = ref<Map<string, string>>(new Map())
const renderingMermaid = ref<Set<string>>(new Set())

const sanitizeOptions = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'u', 's', 'del', 'ins',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'div', 'span',
    'svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'g', 'title', 'desc', 'defs', 'marker', 'use', 'tspan', 'foreignObject',
    'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mspace', 'mtext', 'mtable', 'mtr', 'mtd', 'munderover', 'munder', 'mover', 'mpadded', 'mstyle', 'mphantom', 'menclose'
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
    'markerWidth', 'markerHeight', 'orient', 'overflow', 'style', 'data-*',
    'aria-hidden', 'encoding'
  ],
  ALLOW_DATA_ATTR: true,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|ftp|tel|file|blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
}

function sanitizeHtml(html: string): string {
  return String(DOMPurify.sanitize(html, sanitizeOptions))
}

interface FormulaToken {
  token: string
  html: string
}

function extractFormulaTokens(content: string): { text: string; tokens: FormulaToken[] } {
  let working = content
  const tokens: FormulaToken[] = []

  working = working.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formulaContent) => {
    const token = `${FORMULA_TOKEN_PREFIX}${tokens.length}__`
    const html = renderFormula(String(formulaContent || '').trim(), true)
    tokens.push({ token, html })
    return `\n\n${token}\n\n`
  })

  working = working.replace(/(^|[^$])\$([^\n$]+?)\$(?!\$)/g, (_match, prefix, formulaContent) => {
    const token = `${FORMULA_TOKEN_PREFIX}${tokens.length}__`
    const html = renderFormula(String(formulaContent || '').trim(), false)
    tokens.push({ token, html })
    return `${prefix}${token}`
  })

  return { text: working, tokens }
}

function restoreFormulaTokens(html: string, tokens: FormulaToken[]): string {
  let restored = html
  for (const item of tokens) {
    restored = restored.split(item.token).join(item.html)
  }
  return restored
}

function renderFormula(content: string, displayMode: boolean): string {
  if (!content) return ''
  try {
    return katex.renderToString(content, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
    })
  } catch (error) {
    console.error('KaTeX rendering error:', error)
    const escaped = escapeHtml(content)
    return displayMode
      ? `<div class="katex-error katex-display"><code>${escaped}</code></div>`
      : `<span class="katex-error"><code>${escaped}</code></span>`
  }
}

const escapeHtml = (text: string): string => {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

const formatMessage = (content: string) => {
  if (!content) return ''

  const cached = formattedCache.get(content)
  if (cached !== undefined) {
    return cached
  }

  try {
    const { text, tokens } = extractFormulaTokens(content)
    const rawHtml = marked.parse(text) as string
    const htmlWithFormula = restoreFormulaTokens(rawHtml, tokens)
    const cleanHtml = sanitizeHtml(htmlWithFormula)

    if (formattedCache.size > 100) {
      const firstKey = formattedCache.keys().next().value
      if (firstKey) formattedCache.delete(firstKey)
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
