import apiClient, { apiRequest } from './client'
import type {
  User,
  Topic,
  Message,
  AIModel,
  Expert,
  ChatRequest,
  PaginationParams,
  PaginatedResponse,
  UserPreference,
  ModelProvider,
  ProviderFormData,
  ModelFormData,
} from '@/types'

/**
 * API Services
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 */

// 话题相关 API
export const topicApi = {
  // 获取话题列表
  getTopics: (params?: PaginationParams & { search?: string; status?: string; expert_id?: string }) =>
    apiRequest<PaginatedResponse<Topic>>(apiClient.get('/topics', { params })),

  // 获取单个话题
  getTopic: (id: string) => apiRequest<Topic>(apiClient.get(`/topics/${id}`)),

  // 创建话题
  createTopic: (data: { title: string; description?: string; model_id?: string; expert_id?: string }) =>
    apiRequest<Topic>(apiClient.post('/topics', data)),

  // 更新话题
  updateTopic: (id: string, data: Partial<Topic>) =>
    apiRequest<Topic>(apiClient.patch(`/topics/${id}`, data)),

  // 删除话题
  deleteTopic: (id: string) =>
    apiRequest<void>(apiClient.delete(`/topics/${id}`)),

  // 归档话题
  archiveTopic: (id: string) =>
    apiRequest<Topic>(apiClient.post(`/topics/${id}/archive`)),
}

// 消息相关 API
export const messageApi = {
  // 按 expert 加载消息列表（主要入口）
  // 一个 expert 对一个 user 只有一个连续的对话 session
  getMessagesByExpert: (expert_id: string, params?: PaginationParams) =>
    apiRequest<PaginatedResponse<Message>>(apiClient.get(`/messages/expert/${expert_id}`, { params })),

  // 获取消息列表（旧 API，按 topic，保留兼容）
  getMessages: (topic_id: string, params?: PaginationParams) =>
    apiRequest<PaginatedResponse<Message>>(apiClient.get(`/topics/${topic_id}/messages`, { params })),

  // 发送消息给 Expert
  sendMessage: (data: { content: string; expert_id: string; model_id?: string }) =>
    apiRequest<{ message: string; topic_id: string }>(apiClient.post('/chat', data)),

  // 获取 SSE 订阅 URL
  getStreamUrl: (expert_id: string): string => {
    const token = localStorage.getItem('access_token')
    return `${apiClient.defaults.baseURL}/chat/stream?expert_id=${expert_id}&token=${encodeURIComponent(token || '')}`
  },

  // 删除消息
  deleteMessage: (topic_id: string, message_id: string) =>
    apiRequest<void>(apiClient.delete(`/topics/${topic_id}/messages/${message_id}`)),

  // 清空指定 expert 与当前用户的所有消息和话题（仅管理员）
  clearMessagesByExpert: (expert_id: string) =>
    apiRequest<{ message: string; deleted_messages_count: number; deleted_topics_count: number }>(apiClient.delete(`/messages/expert/${expert_id}`)),
}

// 模型相关 API
export const modelApi = {
  // 获取可用模型列表
  getModels: () =>
    apiRequest<AIModel[]>(apiClient.get('/models')),

  // 获取单个模型
  getModel: (id: string) =>
    apiRequest<AIModel>(apiClient.get(`/models/${id}`)),

  // 创建模型
  createModel: (data: ModelFormData) =>
    apiRequest<AIModel>(apiClient.post('/models', data)),

  // 更新模型
  updateModel: (id: string, data: Partial<ModelFormData>) =>
    apiRequest<AIModel>(apiClient.put(`/models/${id}`, data)),

  // 删除模型
  deleteModel: (id: string) =>
    apiRequest<void>(apiClient.delete(`/models/${id}`)),
}

// 专家相关 API
export const expertApi = {
  // 获取专家列表
  getExperts: (params?: { is_active?: boolean }) =>
    apiRequest<Expert[]>(apiClient.get('/experts', { params })),

  // 获取单个专家
  getExpert: (id: string) =>
    apiRequest<Expert>(apiClient.get(`/experts/${id}`)),

  // 创建专家
  createExpert: (data: Partial<Expert>) =>
    apiRequest<Expert>(apiClient.post('/experts', data)),

  // 更新专家
  updateExpert: (id: string, data: Partial<Expert>) =>
    apiRequest<Expert>(apiClient.put(`/experts/${id}`, data)),

  // 删除专家
  deleteExpert: (id: string) =>
    apiRequest<void>(apiClient.delete(`/experts/${id}`)),
}

// 用户相关 API
export const userApi = {
  // 获取当前用户
  getCurrentUser: () =>
    apiRequest<User & { preferences?: UserPreference }>(apiClient.get('/auth/me')),

  // 获取用户配置
  getPreferences: () =>
    apiRequest<UserPreference>(apiClient.get('/auth/me/preferences')),

  // 更新用户配置
  updatePreferences: (data: Partial<UserPreference>) =>
    apiRequest<UserPreference>(apiClient.put('/users/me/preferences', data)),
}

// 认证相关 API
export const authApi = {
  // 登录 - 支持用户名或邮箱
  login: (credentials: { account: string; password: string }) =>
    apiRequest<{ access_token: string; refresh_token: string; user: Pick<User, 'id' | 'username' | 'email' | 'nickname' | 'avatar'> }>(
      apiClient.post('/auth/login', credentials)
    ),

  // 注册
  register: (data: { username: string; email: string; password: string }) =>
    apiRequest<{ id: string; username: string; email: string }>(apiClient.post('/auth/register', data)),

  // 登出
  logout: () =>
    apiRequest<void>(apiClient.post('/auth/logout')),

  // 刷新 Token
  refreshToken: (refresh_token: string) =>
    apiRequest<{ access_token: string; refresh_token: string }>(
      apiClient.post('/auth/refresh', { refresh_token })
    ),
}

// Provider 相关 API
export const providerApi = {
  // 获取所有 Providers
  getProviders: () =>
    apiRequest<ModelProvider[]>(apiClient.get('/providers')),

  // 获取单个 Provider
  getProvider: (id: string) =>
    apiRequest<ModelProvider>(apiClient.get(`/providers/${id}`)),

  // 创建 Provider
  createProvider: (data: ProviderFormData) =>
    apiRequest<ModelProvider>(apiClient.post('/providers', data)),

  // 更新 Provider
  updateProvider: (id: string, data: Partial<ProviderFormData>) =>
    apiRequest<ModelProvider>(apiClient.put(`/providers/${id}`, data)),

  // 删除 Provider
  deleteProvider: (id: string) =>
    apiRequest<void>(apiClient.delete(`/providers/${id}`)),
}
