/**
 * current-feature-analyzer 错误消息归一化
 *
 * 职责：将各种 API 错误形态统一为标准错误消息字符串。
 * 优先消费 APIError（通过 apiRequest 抛出），兼容原始 AxiosError（直接使用 apiClient 的场景如 exportReport）。
 */

import { APIError } from '@/api/client'

export function normalizeApiError(err: unknown, fallback = '操作失败'): string {
  if (err instanceof APIError) {
    return err.message || fallback
  }

  const e = err as Record<string, unknown>
  const respData = e?.response as Record<string, unknown> | undefined
  return (respData?.data as Record<string, unknown>)?.message as string
    || (respData?.data as Record<string, unknown>)?.data as string
    || (err as { message?: string })?.message
    || fallback
}

export function enhanceApiError(err: unknown, context?: { batchId?: string | null }): string {
  const baseMsg = normalizeApiError(err)

  let status: number | undefined
  if (err instanceof APIError) {
    status = err.status
  } else {
    status = (err as { response?: { status?: number } }).response?.status
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
