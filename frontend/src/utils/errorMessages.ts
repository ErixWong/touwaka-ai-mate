import { ErrorCode } from '@/types'
import { getLocale } from '@/i18n'

// 错误消息映射
const errorMessages: Record<string, Record<number, string>> = {
  'zh-CN': {
    [ErrorCode.UNKNOWN_ERROR]: '发生未知错误',
    [ErrorCode.INVALID_REQUEST]: '请求参数错误',
    [ErrorCode.UNAUTHORIZED]: '请先登录',
    [ErrorCode.FORBIDDEN]: '您没有权限执行此操作',
    [ErrorCode.NOT_FOUND]: '请求的资源不存在',
    [ErrorCode.TOKEN_EXPIRED]: '登录已过期，请重新登录',
    [ErrorCode.TOKEN_INVALID]: '登录状态无效',
    [ErrorCode.MODEL_UNAVAILABLE]: '当前模型不可用',
    [ErrorCode.RATE_LIMIT_EXCEEDED]: '请求过于频繁，请稍后再试',
    [ErrorCode.CONTENT_TOO_LONG]: '消息内容过长',
    [ErrorCode.CONTENT_VIOLATION]: '内容不符合规范',
    [ErrorCode.QUOTA_EXCEEDED]: 'API 额度已用完',
    [ErrorCode.AI_PROVIDER_ERROR]: 'AI 服务暂时不可用',
    [ErrorCode.AI_TIMEOUT]: 'AI 响应超时',
  },
  'en-US': {
    [ErrorCode.UNKNOWN_ERROR]: 'An unknown error occurred',
    [ErrorCode.INVALID_REQUEST]: 'Invalid request parameters',
    [ErrorCode.UNAUTHORIZED]: 'Please sign in first',
    [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action',
    [ErrorCode.NOT_FOUND]: 'The requested resource was not found',
    [ErrorCode.TOKEN_EXPIRED]: 'Session expired, please sign in again',
    [ErrorCode.TOKEN_INVALID]: 'Invalid session',
    [ErrorCode.MODEL_UNAVAILABLE]: 'The selected model is unavailable',
    [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Too many requests, please try again later',
    [ErrorCode.CONTENT_TOO_LONG]: 'Message content is too long',
    [ErrorCode.CONTENT_VIOLATION]: 'Content violates usage policy',
    [ErrorCode.QUOTA_EXCEEDED]: 'API quota exceeded',
    [ErrorCode.AI_PROVIDER_ERROR]: 'AI service temporarily unavailable',
    [ErrorCode.AI_TIMEOUT]: 'AI response timeout',
  },
}

// 获取错误消息
export function getErrorMessage(code: ErrorCode, locale?: string): string {
  const lang = locale || getLocale()
  const messages = errorMessages[lang] || errorMessages['zh-CN']
  if (!messages) return 'Unknown error'
  return messages[code] || messages[ErrorCode.UNKNOWN_ERROR] || 'Unknown error'
}

// 网络错误消息映射
const networkErrorMessages: Record<string, Record<string, string>> = {
  'zh-CN': {
    'Network Error': '网络连接错误，请检查网络设置',
    'timeout': '请求超时，请稍后重试',
    'ECONNABORTED': '连接被中止',
    'ECONNREFUSED': '连接被拒绝',
  },
  'en-US': {
    'Network Error': 'Network error, please check your connection',
    'timeout': 'Request timeout, please try again later',
    'ECONNABORTED': 'Connection aborted',
    'ECONNREFUSED': 'Connection refused',
  },
}

// 网络错误消息
export function getNetworkErrorMessage(error: Error, locale?: string): string {
  const lang = locale || getLocale()
  const defaultLang = 'zh-CN'
  const langMessages = networkErrorMessages[lang] || networkErrorMessages[defaultLang]

  // 检查错误消息是否匹配已知错误
  if (langMessages) {
    for (const [key, message] of Object.entries(langMessages)) {
      if (error.message?.includes(key)) {
        return message
      }
    }
    return langMessages['Network Error'] || 'Network error'
  }

  return 'Network error'
}
