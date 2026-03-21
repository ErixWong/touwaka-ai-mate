import apiClient, { apiRequest } from './client'
import type {
  User,
  Topic,
  Message,
  AIModel,
  Expert,
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
  KbArticle,
  KbSection,
  KbParagraph,
  KbTag,
  CreateKnowledgeBaseRequest,
  UpdateKnowledgeBaseRequest,
  CreateKbArticleRequest,
  UpdateKbArticleRequest,
  CreateKbSectionRequest,
  UpdateKbSectionRequest,
  MoveKbSectionRequest,
  CreateKbParagraphRequest,
  UpdateKbParagraphRequest,
  MoveKbParagraphRequest,
  CreateKbTagRequest,
  UpdateKbTagRequest,
  KbSearchRequest,
  KbSearchResult,
  // 组织架构相关类型
  Department,
  CreateDepartmentRequest,
  UpdateDepartmentRequest,
  Position,
  CreatePositionRequest,
  UpdatePositionRequest,
  UserOrganization,
  UpdateUserOrganizationRequest,
  // 助理系统相关类型
  Assistant,
  AssistantRequest,
  AssistantSummonRequest,
  AssistantSummonResponse,
  AssistantMessage,
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

  // 获取指定消息及其之前的 N 条消息（用于 SSE 完成后获取真实消息，包括 tool 消息）
  getMessagesWithBefore: (expert_id: string, message_id: string, params?: { limit?: number }) =>
    apiRequest<Message[]>(apiClient.get(`/messages/expert/${expert_id}/with-before/${message_id}`, { params })),
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

  // 修改当前用户密码
  changePassword: (data: { old_password: string; new_password: string }) =>
    apiRequest<void>(apiClient.put('/users/me/password', data)),

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
    apiRequest<{ skills: Skill[] }>(
      apiClient.get('/skills', { params })
    ),

  // 列出所有技能目录（包括未注册的）
  list_skill_directories: () =>
    apiRequest<{ directories: Array<{
      name: string;
      path: string;
      description: string;
      is_registered: boolean;
      skill_id: string | null;
    }> }>(
      apiClient.get('/skills/directories')
    ),

  // 获取技能详情
  get_skill_detail: (skill_id: string) =>
    apiRequest<{ skill: SkillDetail }>(
      apiClient.get(`/skills/${skill_id}`)
    ),

  // 更新技能
  update_skill: (skill_id: string, data: { name?: string; description?: string; is_active?: boolean }) =>
    apiRequest<{ id: string }>(
      apiClient.put(`/skills/${skill_id}`, data)
    ),

  // 获取技能参数
  get_skill_parameters: (skill_id: string) =>
    apiRequest<{ parameters: Array<{ id: string; skill_id: string; param_name: string; param_value: string; is_secret: boolean }> }>(
      apiClient.get(`/skills/${skill_id}/parameters`)
    ),

  // 保存技能参数（全量替换）
  save_skill_parameters: (skill_id: string, data: { parameters: Array<{ param_name: string; param_value: string; is_secret?: boolean }> }) =>
    apiRequest<{ parameters: Array<{ id: string; param_name: string; param_value: string; is_secret: boolean }> }>(
      apiClient.post(`/skills/${skill_id}/parameters`, data)
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

  // 批量更新技能工具
  update_skill_tools: (skill_id: string, tools: Array<{
    id: string;
    name?: string;
    description?: string;
    script_path?: string;
    parameters?: string;
    is_resident?: boolean;
  }>) =>
    apiRequest<{ updated: number }>(
      apiClient.put(`/skills/${skill_id}/tools`, { tools })
    ),

  // 更新单个工具
  update_skill_tool: (skill_id: string, tool_id: string, data: {
    name?: string;
    description?: string;
    script_path?: string;
    parameters?: string;
    is_resident?: boolean;
  }) =>
    apiRequest<{ id: string }>(
      apiClient.put(`/skills/${skill_id}/tools/${tool_id}`, data)
    ),

  // 获取技能目录文件列表
  get_skill_files: (skill_id: string, subdir?: string) =>
    apiRequest<{ files: Array<{
      name: string;
      type: 'directory' | 'file';
      path: string;
      size: number;
      modified_at: string;
    }> }>(
      apiClient.get(`/skills/${skill_id}/files`, { params: { subdir } })
    ),

  // 获取技能文件内容
  get_skill_file_content: (skill_id: string, filePath: string) =>
    apiRequest<{ content: string; path: string; size: number; modified_at: string }>(
      apiClient.get(`/skills/${skill_id}/files/content`, { params: { path: filePath } })
    ),

  // 创建新技能目录
  create_skill_directory: (data: { name: string; description?: string }) =>
    apiRequest<{ name: string; path: string; message: string }>(
      apiClient.post('/skills/directories', data)
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
    // 创建新 File 对象，文件名用 encodeURIComponent 编码，解决中文文件名乱码问题
    const encodedFile = new File([file], encodeURIComponent(file.name), { type: file.type })
    formData.append('file', encodedFile)
    if (subdir) {
      formData.append('subdir', subdir)
    }
    return apiRequest<{ path: string; size: number }>(
      apiClient.post(`/tasks/${id}/files`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
    )
  },

  // 删除文件
  deleteFile: (id: string, filePath: string) =>
    apiRequest<void>(apiClient.delete(`/tasks/${id}/files`, { params: { path: filePath } })),

  // 保存文件内容（更新文本文件）
  saveFileContent: (id: string, filePath: string, content: string) =>
    apiRequest<{ message: string }>(apiClient.put(`/tasks/${id}/files/content`, { path: filePath, content })),

  // 获取预览 Token（用于嵌入式文件预览）
  getPreviewToken: (id: string) =>
    apiRequest<{ token: string; expires_at: string }>(apiClient.get(`/tasks/${id}/preview-token`)),

  // 刷新预览 Token
  refreshPreviewToken: (id: string) =>
    apiRequest<{ token: string; expires_at: string }>(apiClient.post(`/tasks/${id}/preview-token/refresh`)),
}

// ============================================
// 知识库相关 API
// ============================================

export const knowledgeBaseApi = {
  // ========== 知识库管理 ==========
  // 注意：知识库本身的 CRUD 仍使用旧 API（后续可迁移）

  // 获取知识库列表
  getKnowledgeBases: (params?: PaginationParams) =>
    apiRequest<PaginatedResponse<KnowledgeBase>>(apiClient.get('/kb', { params })),

  // 获取知识库详情
  getKnowledgeBase: (id: string) =>
    apiRequest<KnowledgeBase>(apiClient.get(`/kb/${id}`)),

  // 创建知识库
  createKnowledgeBase: (data: CreateKnowledgeBaseRequest) =>
    apiRequest<KnowledgeBase>(apiClient.post('/kb', data)),

  // 更新知识库
  updateKnowledgeBase: (id: string, data: UpdateKnowledgeBaseRequest) =>
    apiRequest<KnowledgeBase>(apiClient.put(`/kb/${id}`, data)),

  // 删除知识库
  deleteKnowledgeBase: (id: string) =>
    apiRequest<void>(apiClient.delete(`/kb/${id}`)),

  // ========== 文章管理 ==========

  // 获取文章列表
  getArticles: (kbId: string, params?: PaginationParams) =>
    apiRequest<PaginatedResponse<KbArticle>>(apiClient.get(`/kb/${kbId}/articles`, {
      params,
      // 序列化数组为逗号分隔的字符串，如 tag_ids=xxx,yyy
      paramsSerializer: (p: any) => {
        const searchParams = new URLSearchParams()
        for (const [key, value] of Object.entries(p)) {
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              searchParams.append(key, value.join(','))
            } else {
              searchParams.append(key, String(value))
            }
          }
        }
        return searchParams.toString()
      },
    })),

  // 获取文章详情
  getArticle: (kbId: string, articleId: string) =>
    apiRequest<KbArticle>(apiClient.get(`/kb/${kbId}/articles/${articleId}`)),

  // 创建文章
  createArticle: (kbId: string, data: CreateKbArticleRequest) =>
    apiRequest<KbArticle>(apiClient.post(`/kb/${kbId}/articles`, data)),

  // 更新文章
  updateArticle: (kbId: string, articleId: string, data: UpdateKbArticleRequest) =>
    apiRequest<KbArticle>(apiClient.put(`/kb/${kbId}/articles/${articleId}`, data)),

  // 删除文章
  deleteArticle: (kbId: string, articleId: string) =>
    apiRequest<void>(apiClient.delete(`/kb/${kbId}/articles/${articleId}`)),

  // 获取文章节树
  getArticleTree: (kbId: string, articleId: string) =>
    apiRequest<{ article: KbArticle; tree: KbSection[] }>(apiClient.get(`/kb/${kbId}/articles/${articleId}/tree`)),

  // ========== 章节管理 ==========

  // 创建章节
  createSection: (kbId: string, data: CreateKbSectionRequest) =>
    apiRequest<KbSection>(apiClient.post(`/kb/${kbId}/sections`, data)),

  // 更新章节
  updateSection: (kbId: string, sectionId: string, data: UpdateKbSectionRequest) =>
    apiRequest<KbSection>(apiClient.put(`/kb/${kbId}/sections/${sectionId}`, data)),

  // 删除章节
  deleteSection: (kbId: string, sectionId: string) =>
    apiRequest<void>(apiClient.delete(`/kb/${kbId}/sections/${sectionId}`)),

  // 移动章节（上移/下移）
  moveSection: (kbId: string, sectionId: string, data: MoveKbSectionRequest) =>
    apiRequest<{ success: boolean }>(apiClient.post(`/kb/${kbId}/sections/${sectionId}/move`, data)),

  // ========== 段落管理 ==========

  // 查询段落列表
  queryParagraphs: (kbId: string, data: { section_id?: string; pagination?: PaginationParams }) =>
    apiRequest<PaginatedResponse<KbParagraph>>(apiClient.post(`/kb/${kbId}/paragraphs/query`, {
      filter: data.section_id ? { section_id: data.section_id } : undefined,
      pagination: data.pagination,
    })),

  // 创建段落
  createParagraph: (kbId: string, data: CreateKbParagraphRequest) =>
    apiRequest<KbParagraph>(apiClient.post(`/kb/${kbId}/paragraphs`, data)),

  // 更新段落
  updateParagraph: (kbId: string, paragraphId: string, data: UpdateKbParagraphRequest) =>
    apiRequest<KbParagraph>(apiClient.put(`/kb/${kbId}/paragraphs/${paragraphId}`, data)),

  // 删除段落
  deleteParagraph: (kbId: string, paragraphId: string) =>
    apiRequest<void>(apiClient.delete(`/kb/${kbId}/paragraphs/${paragraphId}`)),

  // 移动段落（上移/下移）
  moveParagraph: (kbId: string, paragraphId: string, data: MoveKbParagraphRequest) =>
    apiRequest<{ success: boolean }>(apiClient.post(`/kb/${kbId}/paragraphs/${paragraphId}/move`, data)),

  // ========== 标签管理 ==========

  // 获取标签列表
  getTags: (kbId: string) =>
    apiRequest<PaginatedResponse<KbTag>>(apiClient.get(`/kb/${kbId}/tags`)),

  // 创建标签
  createTag: (kbId: string, data: CreateKbTagRequest) =>
    apiRequest<KbTag>(apiClient.post(`/kb/${kbId}/tags`, data)),

  // 更新标签
  updateTag: (kbId: string, tagId: string, data: UpdateKbTagRequest) =>
    apiRequest<KbTag>(apiClient.put(`/kb/${kbId}/tags/${tagId}`, data)),

  // 删除标签
  deleteTag: (kbId: string, tagId: string) =>
    apiRequest<void>(apiClient.delete(`/kb/${kbId}/tags/${tagId}`)),

  // ========== 搜索 ==========

  // 语义搜索（单个知识库内）
  search: (kbId: string, data: KbSearchRequest) =>
    apiRequest<KbSearchResult[]>(apiClient.post(`/kb/${kbId}/search`, data)),

  // 全局语义搜索（跨所有知识库）
  globalSearch: (data: KbSearchRequest) =>
    apiRequest<KbSearchResult[]>(apiClient.post('/kb/search', data)),

  // ========== 向量化（待实现） ==========

  // 重新向量化知识库所有段落
  revectorize: (kbId: string) =>
    apiRequest<{ job_id: string; total: number; success: number; failed: number; embedding_dim: number }>(
      apiClient.post(`/kb/${kbId}/revectorize`, {}, { timeout: 600000 })
    ),

  // 获取重新向量化进度
  getRevectorizeProgress: (kbId: string, jobId: string) =>
    apiRequest<{ total: number; success: number; failed: number; current: number; status: string; embedding_dim: number }>(
      apiClient.get(`/kb/${kbId}/revectorize/${jobId}`)
    ),
}

// ============================================
// 组织架构相关 API
// ============================================

export const departmentApi = {
  // 获取部门树
  getDepartmentTree: () =>
    apiRequest<Department[]>(apiClient.get('/departments/tree')),

  // 获取部门详情
  getDepartment: (id: string) =>
    apiRequest<Department>(apiClient.get(`/departments/${id}`)),

  // 创建部门
  createDepartment: (data: CreateDepartmentRequest) =>
    apiRequest<Department>(apiClient.post('/departments', data)),

  // 更新部门
  updateDepartment: (id: string, data: UpdateDepartmentRequest) =>
    apiRequest<Department>(apiClient.put(`/departments/${id}`, data)),

  // 删除部门
  deleteDepartment: (id: string) =>
    apiRequest<void>(apiClient.delete(`/departments/${id}`)),

  // 获取部门职位列表
  getDepartmentPositions: (id: string) =>
    apiRequest<Position[]>(apiClient.get(`/departments/${id}/positions`)),

  // 获取部门负责人
  getDepartmentManagers: (id: string) =>
    apiRequest<UserListItem[]>(apiClient.get(`/departments/${id}/managers`)),
}

export const positionApi = {
  // 获取职位详情
  getPosition: (id: string) =>
    apiRequest<Position>(apiClient.get(`/positions/${id}`)),

  // 创建职位
  createPosition: (data: CreatePositionRequest) =>
    apiRequest<Position>(apiClient.post('/positions', data)),

  // 更新职位
  updatePosition: (id: string, data: UpdatePositionRequest) =>
    apiRequest<Position>(apiClient.put(`/positions/${id}`, data)),

  // 删除职位
  deletePosition: (id: string) =>
    apiRequest<void>(apiClient.delete(`/positions/${id}`)),

  // 获取职位成员列表
  getPositionMembers: (id: string) =>
    apiRequest<UserListItem[]>(apiClient.get(`/positions/${id}/members`)),

  // 获取部门下的所有职位
  getDepartmentPositions: (departmentId: string) =>
    apiRequest<Position[]>(apiClient.get(`/positions/department/${departmentId}`)),
}

export const organizationApi = {
  // 获取用户组织信息
  getUserOrganization: (userId: string) =>
    apiRequest<UserOrganization>(apiClient.get(`/users/${userId}/organization`)),

  // 更新用户组织信息
  updateUserOrganization: (userId: string, data: UpdateUserOrganizationRequest) =>
    apiRequest<UserOrganization>(apiClient.put(`/users/${userId}/organization`, data)),
}

// ============================================
// 助理系统相关 API
// ============================================

export const assistantApi = {
  // 获取可用助理列表
  getAssistants: () =>
    apiRequest<Assistant[]>(apiClient.get('/assistants')),

  // 获取单个助理详情
  getAssistant: (type: string) =>
    apiRequest<Assistant>(apiClient.get(`/assistants/${type}`)),

  // 更新助理配置
  updateAssistant: (type: string, data: Partial<Assistant>) =>
    apiRequest<Assistant>(apiClient.put(`/assistants/${type}`, data)),

  // 创建助理
  createAssistant: (data: Partial<Assistant> & { assistant_type: string; name: string }) =>
    apiRequest<Assistant>(apiClient.post('/assistants', data)),

  // 删除助理
  deleteAssistant: (type: string) =>
    apiRequest<{ success: boolean; assistant_type: string }>(apiClient.delete(`/assistants/${type}`)),

  // 召唤助理
  summon: (data: AssistantSummonRequest) =>
    apiRequest<AssistantSummonResponse>(apiClient.post('/assistants/call', data)),

  // 查询委托状态
  getRequest: (requestId: string) =>
    apiRequest<AssistantRequest>(apiClient.get(`/assistants/requests/${requestId}`)),

  // 查询委托列表
  getRequests: (params?: {
    status?: string
    expert_id?: string
    user_id?: string
    assistant_type?: string
    limit?: number
  }) =>
    apiRequest<AssistantRequest[]>(apiClient.get('/assistants/requests', { params })),

  // 获取委托消息列表
  getMessages: (requestId: string, debug = false) =>
    apiRequest<{ request_id: string; messages: AssistantMessage[] }>(
      apiClient.get(`/assistants/requests/${requestId}/messages`, { params: { debug } })
    ),

  // 归档委托
  archiveRequest: (requestId: string) =>
    apiRequest<{ request_id: string; is_archived: boolean }>(
      apiClient.post(`/assistants/requests/${requestId}/archive`)
    ),

  // 取消归档
  unarchiveRequest: (requestId: string) =>
    apiRequest<{ request_id: string; is_archived: boolean }>(
      apiClient.post(`/assistants/requests/${requestId}/unarchive`)
    ),

  // 删除委托
  deleteRequest: (requestId: string) =>
    apiRequest<{ request_id: string; deleted: boolean }>(
      apiClient.delete(`/assistants/requests/${requestId}`)
    ),
}
