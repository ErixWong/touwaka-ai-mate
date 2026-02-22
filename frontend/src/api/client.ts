import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { ErrorCode, type ApiError } from '@/types'
import { getErrorMessage, getNetworkErrorMessage } from '@/utils/errorMessages'

// API 基础配置
// 使用相对路径以利用 Vite 代理，或从环境变量读取
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

// 创建 axios 实例
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器 - 添加认证头
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('access_token')
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器 - 处理错误和 Token 刷新
// 字段名规则：全栈统一使用 snake_case，不做任何转换
apiClient.interceptors.response.use(
  (response) => {
    // 不再转换字段名，保持 snake_case
    return response
  },
  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    // 处理 401 错误 - Token 过期
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        const refresh_token = localStorage.getItem('refresh_token')
        if (!refresh_token) {
          throw new Error('No refresh token')
        }

        // 调用刷新 Token API
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refresh_token,
        })

        // 后端返回 snake_case 字段名
        const { access_token, refresh_token: new_refresh_token } = response.data.data || response.data

        // 保存新 Token
        localStorage.setItem('access_token', access_token)
        localStorage.setItem('refresh_token', new_refresh_token)

        // 重试原请求
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access_token}`
        }
        return apiClient(originalRequest)
      } catch (refreshError) {
        // 刷新失败，清除 Token 并跳转登录
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        window.location.href = '/login'
        return Promise.reject(refreshError)
      }
    }

    // 处理其他错误
    return Promise.reject(error)
  }
)

// API 错误类
export class APIError extends Error {
  code: ErrorCode
  status?: number
  details?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, status?: number, details?: Record<string, unknown>) {
    super(message)
    this.name = 'APIError'
    this.code = code
    this.status = status
    this.details = details
  }
}

// 处理 API 错误
export function handleApiError(error: AxiosError<ApiError>): APIError {
  // 网络错误
  if (!error.response) {
    return new APIError(
      ErrorCode.UNKNOWN_ERROR,
      getNetworkErrorMessage(error),
      undefined
    )
  }

  const { status, data } = error.response

  // 根据状态码处理
  switch (status) {
    case 401:
      return new APIError(
        ErrorCode.UNAUTHORIZED,
        getErrorMessage(ErrorCode.UNAUTHORIZED),
        status
      )
    case 403:
      return new APIError(
        ErrorCode.FORBIDDEN,
        getErrorMessage(ErrorCode.FORBIDDEN),
        status
      )
    case 404:
      return new APIError(
        ErrorCode.NOT_FOUND,
        getErrorMessage(ErrorCode.NOT_FOUND),
        status
      )
    case 429:
      return new APIError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        getErrorMessage(ErrorCode.RATE_LIMIT_EXCEEDED),
        status
      )
    case 500:
    case 502:
    case 503:
      return new APIError(
        data?.code || ErrorCode.UNKNOWN_ERROR,
        getErrorMessage(data?.code || ErrorCode.UNKNOWN_ERROR),
        status,
        data?.details
      )
    default:
      return new APIError(
        data?.code || ErrorCode.UNKNOWN_ERROR,
        data?.message || getErrorMessage(ErrorCode.UNKNOWN_ERROR),
        status,
        data?.details
      )
  }
}

// 包装 API 响应
export async function apiRequest<T>(
  request: Promise<{ data: { data: T } }>
): Promise<T> {
  try {
    const response = await request
    return response.data.data
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw handleApiError(error)
    }
    throw error
  }
}

export default apiClient
