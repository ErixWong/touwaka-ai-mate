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
  ExpertSkill,
  ExpertSkillConfig,
  UserListResponse,
  UserListItem,
  CreateUserRequest,
  UpdateUserRequest,
  ResetPasswordRequest,
  UpdateUserRolesRequest,
  Role,
  RoleDetail,
  UpdateRoleRequest,
  UpdateRolePermissionsRequest,
  UpdateRoleExpertsRequest,
  Permission,
  ExpertSimple,
  Skill,
  SkillDetail,
  Task,
  CreateTaskRequest,
  TaskFile,
  // 知识库相关类型
  KnowledgeBase,
  Knowledge,
  KnowledgePoint,
  CreateKnowledgeBaseRequest,
  UpdateKnowledgeBaseRequest,
  CreateKnowledgeRequest,
  UpdateKnowledgeRequest,
  CreateKnowledgePointRequest,
  UpdateKnowledgePointRequest,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
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

  // 手动触发压缩 - 检查并更新 topics
  compress: (data?: { expert_id?: string }) =>
    apiRequest<{ message: string; results: any[] }>(apiClient.post('/topics/compress', data || {})),

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
  sendMessage: (data: {
    content: string;
    expert_id: string;
    model_id?: string;
    task_id?: string;
    task_path?: string;  // 当前浏览的目录路径
  }) =>
    apiRequest<{ message: string; topic_id: string }>(apiClient.post('/chat', data)),

  // 删除消息
  deleteMessage: (topic_id: string, message_id: string) =>
    apiRequest<void>(apiClient.delete(`/topics/${topic_id}/messages/${message_id}`)),

  // 清空指定 expert 与当前用户的所有消息和话题（仅管理员）
  clearMessagesByExpert: (expert_id: string) =>
    apiRequest<{ message: string; deleted_messages_count: number; deleted_topics_count: number }>(apiClient.delete(`/messages/expert/${expert_id}`)),

  // 停止生成
  stopGeneration: (expert_id: string) =>
    apiRequest<{ success: boolean }>(apiClient.post('/chat/stop', { expert_id })),
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

  // 获取专家技能列表（包含所有可用技能及启用状态）
  getExpertSkills: (id: string) =>
    apiRequest<{ skills: ExpertSkill[] }>(apiClient.get(`/experts/${id}/skills`)),

  // 批量更新专家技能
  updateExpertSkills: (id: string, skills: ExpertSkillConfig[]) =>
    apiRequest<{ skills: ExpertSkillConfig[] }>(apiClient.post(`/experts/${id}/skills`, { skills })),

  // 刷新专家缓存（技能/人设变更后调用）
  refreshExpert: (id: string) =>
    apiRequest<{ id: string }>(apiClient.post(`/experts/${id}/refresh`)),
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

  // ========== 用户管理 API（管理员专用） ==========

  // 获取用户列表
  getUsers: (params?: { page?: number; size?: number; search?: string }) =>
    apiRequest<UserListResponse>(apiClient.get('/users', { params })),

  // 创建用户
  createUser: (data: CreateUserRequest) =>
    apiRequest<UserListItem>(apiClient.post('/users', data)),

  // 更新用户
  updateUser: (id: string, data: UpdateUserRequest) =>
    apiRequest<void>(apiClient.put(`/users/${id}`, data)),

  // 删除用户
  deleteUser: (id: string) =>
    apiRequest<void>(apiClient.delete(`/users/${id}`)),

  // 重置用户密码
  resetPassword: (id: string, data: ResetPasswordRequest) =>
    apiRequest<void>(apiClient.post(`/users/${id}/reset-password`, data)),

  // 获取角色列表
  getRoles: () =>
    apiRequest<Role[]>(apiClient.get('/users/roles')),

  // 更新用户角色
  updateUserRoles: (id: string, data: UpdateUserRolesRequest) =>
    apiRequest<void>(apiClient.put(`/users/${id}/roles`, data)),
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

// Debug 相关 API
export const debugApi = {
  // 获取最近一次 LLM Payload
  getLLMPayload: (expert_id: string) =>
    apiRequest<{ payload: Record<string, unknown> | null; cached_at?: string; message?: string }>(
      apiClient.get('/debug/llm-payload', { params: { expert_id } })
    ),
}

// 技能管理相关 API（Skills Studio 使用）
export const skill_api = {
  // 列出所有已注册的技能
  list_all_skills: (params?: { include_inactive?: boolean }) =>
    apiRequest<{ success: boolean; total: number; skills: Skill[] }>(
      apiClient.get('/skills', { params })
    ),

  // 获取技能详情
  get_skill_detail: (skill_id: string) =>
    apiRequest<{ success: boolean; skill: SkillDetail }>(
      apiClient.get(`/skills/${skill_id}`)
    ),

  // 注册技能（从本地路径）
  register_skill: (data: { source_path: string; name?: string }) =>
    apiRequest<{ success: boolean; skill_id: string; name: string; action: string; message: string }>(
      apiClient.post('/skills/register', data)
    ),

  // 分配技能给专家
  assign_skill_to_expert: (data: { skill_id: string; expert_id: string }) =>
    apiRequest<{ success: boolean; message: string }>(
      apiClient.post('/skills/assign', data)
    ),

  // 取消技能分配
  unassign_skill_from_expert: (data: { skill_id: string; expert_id: string }) =>
    apiRequest<{ success: boolean; message: string }>(
      apiClient.post('/skills/unassign', data)
    ),

  // 启用/禁用技能
  toggle_skill: (skill_id: string, is_active: boolean) =>
    apiRequest<{ success: boolean; message: string }>(
      apiClient.patch(`/skills/${skill_id}/toggle`, { is_active })
    ),

  // 删除技能
  delete_skill: (skill_id: string) =>
    apiRequest<{ success: boolean; message: string }>(
      apiClient.delete(`/skills/${skill_id}`)
    ),
}

// 角色管理相关 API（管理员专用）
export const roleApi = {
  // 获取角色列表
  getRoles: () =>
    apiRequest<Role[]>(apiClient.get('/roles')),

  // 获取角色详情
  getRole: (id: string) =>
    apiRequest<RoleDetail>(apiClient.get(`/roles/${id}`)),

  // 更新角色
  updateRole: (id: string, data: UpdateRoleRequest) =>
    apiRequest<Role>(apiClient.put(`/roles/${id}`, data)),

  // 获取角色权限
  getRolePermissions: (id: string) =>
    apiRequest<{ permission_ids: string[] }>(apiClient.get(`/roles/${id}/permissions`)),

  // 更新角色权限
  updateRolePermissions: (id: string, data: UpdateRolePermissionsRequest) =>
    apiRequest<void>(apiClient.put(`/roles/${id}/permissions`, data)),

  // 获取角色专家访问权限
  getRoleExperts: (id: string) =>
    apiRequest<{ expert_ids: string[]; is_admin: boolean }>(apiClient.get(`/roles/${id}/experts`)),

  // 更新角色专家访问权限
  updateRoleExperts: (id: string, data: UpdateRoleExpertsRequest) =>
    apiRequest<void>(apiClient.put(`/roles/${id}/experts`, data)),

  // 获取所有权限列表（用于角色管理界面）
  getAllPermissions: () =>
    apiRequest<Permission[]>(apiClient.get('/roles/permissions/all')),

  // 获取所有专家列表（用于角色管理界面）
  getAllExperts: () =>
    apiRequest<ExpertSimple[]>(apiClient.get('/roles/experts/all')),
}

// 任务工作空间相关 API
export const taskApi = {
  // 获取任务列表
  getTasks: (params?: { status?: string; page?: number; limit?: number }) =>
    apiRequest<PaginatedResponse<Task>>(apiClient.get('/tasks', { params })),

  // 获取单个任务
  getTask: (id: string) =>
    apiRequest<Task>(apiClient.get(`/tasks/${id}`)),

  // 创建任务
  createTask: (data: CreateTaskRequest) =>
    apiRequest<Task>(apiClient.post('/tasks', data)),

  // 更新任务
  updateTask: (id: string, data: Partial<Task>) =>
    apiRequest<Task>(apiClient.put(`/tasks/${id}`, data)),

  // 删除任务（归档）
  deleteTask: (id: string) =>
    apiRequest<void>(apiClient.delete(`/tasks/${id}`)),

  // 获取任务文件列表
  getTaskFiles: (id: string, subdir?: string) =>
    apiRequest<{ files: TaskFile[] }>(apiClient.get(`/tasks/${id}/files`, { params: { subdir } })),

  // 上传文件到任务工作空间
  uploadFile: (id: string, file: File, subdir?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    if (subdir) {
      formData.append('subdir', subdir)
    }
    return apiRequest<{ path: string; size: number }>(
      apiClient.post(`/tasks/${id}/files`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
    )
  },

  // 下载文件
  downloadFile: (id: string, filePath: string) =>
    apiClient.get(`/tasks/${id}/files/download`, { params: { path: filePath }, responseType: 'blob' }),

  // 删除文件
  deleteFile: (id: string, filePath: string) =>
    apiRequest<void>(apiClient.delete(`/tasks/${id}/files`, { params: { path: filePath } })),

  // 保存文件内容（更新文本文件）
  saveFileContent: (id: string, filePath: string, content: string) =>
    apiRequest<{ message: string }>(apiClient.put(`/tasks/${id}/files/content`, { path: filePath, content })),
}

// ============================================
// 知识库相关 API
// ============================================

export const knowledgeBaseApi = {
  // ========== 知识库管理 ==========

  // 获取知识库列表
  getKnowledgeBases: (params?: PaginationParams) =>
    apiRequest<PaginatedResponse<KnowledgeBase>>(apiClient.get('/kb', { params })),

  // 获取知识库详情
  getKnowledgeBase: (id: string | number) =>
    apiRequest<KnowledgeBase>(apiClient.get(`/kb/${id}`)),

  // 创建知识库
  createKnowledgeBase: (data: CreateKnowledgeBaseRequest) =>
    apiRequest<KnowledgeBase>(apiClient.post('/kb', data)),

  // 更新知识库
  updateKnowledgeBase: (id: string | number, data: UpdateKnowledgeBaseRequest) =>
    apiRequest<KnowledgeBase>(apiClient.put(`/kb/${id}`, data)),

  // 删除知识库
  deleteKnowledgeBase: (id: string | number) =>
    apiRequest<void>(apiClient.delete(`/kb/${id}`)),

  // ========== 文章管理 ==========

  // 获取文章树
  getKnowledgeTree: (kbId: string | number) =>
    apiRequest<Knowledge[]>(apiClient.get(`/kb/${kbId}/knowledges/tree`)),

  // 获取文章详情
  getKnowledge: (kbId: string | number, knowledgeId: string | number) =>
    apiRequest<Knowledge>(apiClient.get(`/kb/${kbId}/knowledges/${knowledgeId}`)),

  // 创建文章
  createKnowledge: (kbId: string | number, data: CreateKnowledgeRequest) =>
    apiRequest<Knowledge>(apiClient.post(`/kb/${kbId}/knowledges`, data)),

  // 更新文章
  updateKnowledge: (kbId: string | number, knowledgeId: string | number, data: UpdateKnowledgeRequest) =>
    apiRequest<Knowledge>(apiClient.put(`/kb/${kbId}/knowledges/${knowledgeId}`, data)),

  // 删除文章
  deleteKnowledge: (kbId: string | number, knowledgeId: string | number) =>
    apiRequest<void>(apiClient.delete(`/kb/${kbId}/knowledges/${knowledgeId}`)),

  // ========== 知识点管理 ==========

  // 获取知识点列表
  getKnowledgePoints: (kbId: string | number, knowledgeId: string | number, params?: PaginationParams) =>
    apiRequest<PaginatedResponse<KnowledgePoint>>(apiClient.get(`/kb/${kbId}/knowledges/${knowledgeId}/points`, { params })),

  // 获取知识点详情
  getKnowledgePoint: (kbId: string | number, knowledgeId: string | number, pointId: string | number) =>
    apiRequest<KnowledgePoint>(apiClient.get(`/kb/${kbId}/knowledges/${knowledgeId}/points/${pointId}`)),

  // 创建知识点
  createKnowledgePoint: (kbId: string | number, knowledgeId: string | number, data: CreateKnowledgePointRequest) =>
    apiRequest<KnowledgePoint>(apiClient.post(`/kb/${kbId}/knowledges/${knowledgeId}/points`, data)),

  // 更新知识点
  updateKnowledgePoint: (kbId: string | number, knowledgeId: string | number, pointId: string | number, data: UpdateKnowledgePointRequest) =>
    apiRequest<KnowledgePoint>(apiClient.put(`/kb/${kbId}/knowledges/${knowledgeId}/points/${pointId}`, data)),

  // 删除知识点
  deleteKnowledgePoint: (kbId: string | number, knowledgeId: string | number, pointId: string | number) =>
    apiRequest<void>(apiClient.delete(`/kb/${kbId}/knowledges/${knowledgeId}/points/${pointId}`)),

  // ========== 搜索 ==========

  // 语义搜索（单个知识库内）
  search: (kbId: string | number, data: KnowledgeSearchRequest) =>
    apiRequest<KnowledgeSearchResult[]>(apiClient.post(`/kb/${kbId}/search`, data)),

  // 全局语义搜索（跨所有知识库）
  globalSearch: (data: KnowledgeSearchRequest) =>
    apiRequest<KnowledgeSearchResult[]>(apiClient.post('/kb/search', data)),

  // ========== 向量化 ==========

  // 重新向量化知识库所有知识点
  revectorize: (kbId: string | number) =>
    apiRequest<{ job_id: string; total: number; success: number; failed: number; embedding_dim: number }>(
      apiClient.post(`/kb/${kbId}/revectorize`, {}, { timeout: 600000 })
    ),

  // 获取重新向量化进度
  getRevectorizeProgress: (kbId: string | number, jobId: string) =>
    apiRequest<{ total: number; success: number; failed: number; current: number; status: string; embedding_dim: number }>(
      apiClient.get(`/kb/${kbId}/revectorize/${jobId}`)
    ),
}
