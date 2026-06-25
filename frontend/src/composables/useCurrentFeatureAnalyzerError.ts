/**
 * current-feature-analyzer 错误消息归一化
 *
 * 职责：将各种 API 错误形态统一为标准错误消息字符串。
 * 优先消费 APIError（通过 apiRequest 抛出），兼容原始 AxiosError（直接使用 apiClient 的场景如 exportReport）。
 */

import { APIError } from '@/api/client'

/**
 * 归一化 API 错误为可展示的消息字符串
 */
export function normalizeApiError(err: unknown, fallback = '操作失败'): string {
  // 优一：APIError（apiRequest 统一抛出的错误模型）
  if (err instanceof APIError) {
    return err.message || fallback
  }

  // 兜底：原始 AxiosError（直接使用 apiClient 未经过 apiRequest 的场景，如 export blob 下载）
  const e = err as Record<string, unknown>
  const respData = e?.response as Record<string, unknown> | undefined
  return (respData?.data as Record<string, unknown>)?.message as string
    || (respData?.data as Record<string, unknown>)?.data as string
    || (err as { message?: string })?.message
    || fallback
}

/**
 * 根据 HTTP 状态码和上下文增强错误消息
 */
export function enhanceApiError(err: unknown, context?: { batchId?: string | null }): string {
  const baseMsg = normalizeApiError(err)

  // 优一：从 APIError 取 status
  let status: number | undefined
  if (err instanceof APIError) {
    status = err.status
  } else {
    // 兜底：从 AxiosError.response.status 取
    status = (err as Record<string, unknown>)?.response?.status as number | undefined
  }

  if (status === 413) {
    return '文件过大，请确保单个文件不超过 50MB'
  }

  if (status === 404 && context?.batchId) {
    return '分析会话已过期，请重新上传文件'
  }

  if (status === 400) {
    return `分析请求参数错误: ${baseMsg}`
  }

  if (status === 409) {
    return baseMsg || '操作冲突，请稍后重试'
  }

  return baseMsg
}
