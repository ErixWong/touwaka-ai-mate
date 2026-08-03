import type { ChatMessage } from '@/components/ChatWindow.vue'

export interface ToolCallData {
  tool_call_id?: string
  tool_message_id?: string
  name?: string
  tool_name?: string
  content?: string
  success?: boolean
  duration?: number
  timestamp?: string
  arguments?: Record<string, unknown>
  result?: unknown
  result_preview?: string
  context?: string
  /** round03：原子工具执行轨迹（仅 document_retrieval skill） */
  atomic_steps?: string[]
}

export interface NormalizedToolData {
  name: string
  success: boolean
  duration: number | null
  context: string | null
  timestamp: string | null
  arguments: Record<string, unknown> | null
}

type ParsedToolCallsRaw = ToolCallData | ToolCallData[] | null

const parsedToolCallCache = new Map<string, { source: unknown; data: ParsedToolCallsRaw }>()
const normalizedToolDataCache = new Map<string, { source: unknown; data: NormalizedToolData }>()
let toolContextIndexCache = new WeakMap<ChatMessage[], ToolContextIndexCacheEntry>()

interface ToolContextIndexCacheEntry {
  length: number
  last_message_id: string | null
  index: ToolContextIndex
}

export interface ToolContextIndex {
  messageIndexById: Map<string, number>
  contextsByRequestId: Map<string, Array<{ index: number; context: string }>>
}

const parseToolCallsRaw = (message: ChatMessage): ParsedToolCallsRaw => {
  if (!message.tool_calls) return null

  const cached = parsedToolCallCache.get(message.id)
  if (cached && cached.source === message.tool_calls) {
    return cached.data
  }

  try {
    const toolCalls = typeof message.tool_calls === 'string'
      ? JSON.parse(message.tool_calls)
      : message.tool_calls

    const parsed = toolCalls as ToolCallData | ToolCallData[]
    parsedToolCallCache.set(message.id, { source: message.tool_calls, data: parsed })
    return parsed
  } catch (e) {
    console.error('[useToolDataParser] parseToolCalls error:', e)
    parsedToolCallCache.set(message.id, { source: message.tool_calls, data: null })
    return null
  }
}

const parseToolCalls = (message: ChatMessage): ToolCallData | null => {
  const toolCalls = parseToolCallsRaw(message)
  if (!toolCalls) return null
  return Array.isArray(toolCalls) ? (toolCalls[0] ?? null) : toolCalls
}

const getToolData = (message: ChatMessage): NormalizedToolData => {
  const cached = normalizedToolDataCache.get(message.id)
  if (cached && cached.source === message.tool_calls) {
    return cached.data
  }

  const toolData = parseToolCalls(message)
  const normalized: NormalizedToolData = {
    name: toolData?.name || toolData?.tool_name || 'unknown_tool',
    success: toolData?.success ?? true,
    duration: toolData?.duration ?? null,
    context: toolData?.context ?? null,
    timestamp: toolData?.timestamp ?? null,
    arguments: toolData?.arguments ?? null,
  }

  normalizedToolDataCache.set(message.id, { source: message.tool_calls, data: normalized })
  return normalized
}

const parseToolCallsToArray = (message: ChatMessage): ToolCallData[] => {
  const toolCalls = parseToolCallsRaw(message)
  if (!toolCalls) return []
  return Array.isArray(toolCalls) ? toolCalls : [toolCalls]
}

const formatToolCallTime = (toolCall: ToolCallData): string => {
  if (!toolCall.timestamp) return '--:--:--'
  const date = new Date(toolCall.timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const formatToolCallArguments = (toolCall: ToolCallData): string => {
  if (!toolCall.arguments) return ''
  try {
    const jsonStr = JSON.stringify(toolCall.arguments, null, 2)
    return addLineNumbers(jsonStr)
  } catch {
    return addLineNumbers(String(toolCall.arguments))
  }
}

const formatToolCallResult = (toolCall: ToolCallData): string => {
  if (!toolCall.result) return ''

  try {
    const parsed = typeof toolCall.result === 'string'
      ? JSON.parse(toolCall.result)
      : toolCall.result
    const jsonStr = JSON.stringify(parsed, null, 2)
    return addLineNumbers(jsonStr)
  } catch {
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

const getToolName = (message: ChatMessage): string => {
  return getToolData(message).name
}

const formatToolTime = (message: ChatMessage): string => {
  const timestamp = getToolData(message).timestamp
  if (!timestamp) {
    if (message.created_at) {
      const date = new Date(message.created_at)
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }
    return '--:--:--'
  }

  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const formatToolArguments = (message: ChatMessage): string => {
  const args = getToolData(message).arguments
  if (!args) return ''
  try {
    const jsonStr = JSON.stringify(args, null, 2)
    return addLineNumbers(jsonStr)
  } catch {
    return addLineNumbers(String(args))
  }
}

const formatToolResult = (message: ChatMessage): string => {
  if (!message.content) return ''

  try {
    const parsed = JSON.parse(message.content)
    const jsonStr = JSON.stringify(parsed, null, 2)
    return addLineNumbers(jsonStr)
  } catch {
    const maxLength = 5000
    if (message.content.length > maxLength) {
      return addLineNumbers(message.content.substring(0, maxLength) + '\n...(已截断)')
    }
    return addLineNumbers(message.content)
  }
}

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

const buildToolContextIndex = (allMessages: ChatMessage[]): ToolContextIndex => {
  const messageIndexById = new Map<string, number>()
  const contextsByRequestId = new Map<string, Array<{ index: number; context: string }>>()

  allMessages.forEach((msg, index) => {
    messageIndexById.set(msg.id, index)

    if (msg.role !== 'tool' || !msg.request_id) return

    const context = getToolData(msg).context?.trim()
    if (!context) return

    const contexts = contextsByRequestId.get(msg.request_id) || []
    contexts.push({ index, context })
    contextsByRequestId.set(msg.request_id, contexts)
  })

  return { messageIndexById, contextsByRequestId }
}

const getToolContextIndex = (allMessages: ChatMessage[]): ToolContextIndex => {
  const lastMessage = allMessages[allMessages.length - 1]
  const lastMessageId = lastMessage?.id || null
  const cached = toolContextIndexCache.get(allMessages)
  if (cached && cached.length === allMessages.length && cached.last_message_id === lastMessageId) {
    return cached.index
  }

  const index = buildToolContextIndex(allMessages)
  toolContextIndexCache.set(allMessages, {
    length: allMessages.length,
    last_message_id: lastMessageId,
    index,
  })
  return index
}

const filterAssistantContent = (
  message: ChatMessage,
  allMessages: ChatMessage[],
  prebuiltIndex?: ToolContextIndex
): string => {
  if (!message.content) return ''
  if (message.role !== 'assistant') return message.content
  if (!message.request_id) return message.content

  const index = prebuiltIndex || getToolContextIndex(allMessages)
  const currentIndex = index.messageIndexById.get(message.id)
  if (currentIndex === undefined) return message.content

  const toolContexts = (index.contextsByRequestId.get(message.request_id) || [])
    .filter(item => item.index < currentIndex)
    .map(item => item.context)

  if (toolContexts.length === 0) return message.content

  let filteredContent = message.content
  for (const context of toolContexts) {
    if (filteredContent.includes(context)) {
      filteredContent = filteredContent.replace(context, '')
    }
    const escapedContext = context.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(`>\\s*${escapedContext}`, 'g'),
      new RegExp(`"${escapedContext}"`, 'g'),
      new RegExp(`'${escapedContext}'`, 'g'),
    ]
    for (const pattern of patterns) {
      filteredContent = filteredContent.replace(pattern, '')
    }
  }

  filteredContent = filteredContent.replace(/\n{3,}/g, '\n\n').trim()

  return filteredContent || message.content
}

const clearCaches = () => {
  parsedToolCallCache.clear()
  normalizedToolDataCache.clear()
  toolContextIndexCache = new WeakMap<ChatMessage[], ToolContextIndexCacheEntry>()
}

let instance: ReturnType<typeof createInstance> | null = null

function createInstance() {
  return {
    parseToolCalls,
    parseToolCallsRaw,
    getToolData,
    parseToolCallsToArray,
    formatToolCallTime,
    formatToolCallArguments,
    formatToolCallResult,
    getToolName,
    formatToolTime,
    formatToolArguments,
    formatToolResult,
    addLineNumbers,
    buildToolContextIndex,
    filterAssistantContent,
    clearCaches,
  }
}

export function useToolDataParser() {
  if (!instance) {
    instance = createInstance()
  }
  return instance
}
