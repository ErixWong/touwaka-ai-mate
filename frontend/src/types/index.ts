/**
 * 类型定义文件
 * 
 * 字段名规则：全栈统一使用数据库字段名（snake_case），不做任何转换
 */

// 用户相关类型
export interface User {
  id: string
  username: string
  email: string
  nickname: string
  avatar?: string
  roles?: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

// 用户配置
export interface UserPreference {
  user_id: string
  theme: 'light' | 'dark' | 'auto'
  language: 'zh-CN' | 'en-US'
  enable_stream: boolean
  created_at: string
  updated_at: string
}

// 话题类型
export interface Topic {
  id: string
  user_id: string
  title: string
  description?: string
  expert_id?: string
  model_id: string
  status: 'active' | 'archived' | 'deleted'
  message_count: number
  created_at: string
  updated_at: string
}

// 消息角色
export type MessageRole = 'user' | 'assistant' | 'system'

// 消息状态
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'error' | 'cancelled'

// 消息类型
// 核心设计：消息按 expert + user 组织，topic_id 只是对话历史的阶段性总结标记
export interface Message {
  id: string
  expert_id: string      // 所属专家
  user_id?: string       // 所属用户
  topic_id?: string      // 可选，阶段总结标记
  role: MessageRole
  content: string
  status: MessageStatus
  metadata?: MessageMetadata
  parent_id?: string
  created_at: string
  updated_at: string
}

// 消息元数据
export interface MessageMetadata {
  tokens?: TokenUsage
  cost?: number
  latency?: number
  model?: string
  provider?: string
  error?: string
  cached?: boolean
}

// Token 使用情况
export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

// AI 模型 (匹配后端 ai_models 表)
export interface AIModel {
  id: string
  name: string
  model_name: string  // API调用使用的模型标识符
  provider_id: string
  provider_name: string
  description?: string
  max_tokens: number
  cost_per_1k_input: number
  cost_per_1k_output: number
  is_active: boolean
}

// 模型能力
export type ModelCapability = 'chat' | 'vision' | 'function_calling' | 'json_mode'

// 创建/更新模型的请求数据
export interface ModelFormData {
  name: string
  model_name: string  // API调用使用的模型标识符
  provider_id: string
  max_tokens?: number
  cost_per_1k_input?: number
  cost_per_1k_output?: number
  description?: string
  is_active?: boolean
}

// 模型提供商 (匹配后端 providers 表)
export interface ModelProvider {
  id: string
  name: string
  base_url: string
  api_key: string  // 脱敏显示，如 ****sk-1234
  timeout: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// 创建/更新 Provider 的请求数据
export interface ProviderFormData {
  name: string
  base_url: string
  api_key: string
  timeout: number
  is_active: boolean
}

// 专家类型 (匹配后端 experts 表)
export interface Expert {
  id: string
  name: string
  introduction?: string
  speaking_style?: string
  core_values?: string
  behavioral_guidelines?: string
  taboos?: string
  emotional_tone?: string
  expressive_model_id?: string
  reflective_model_id?: string
  prompt_template?: string
  // 上下文压缩配置
  context_threshold?: number    // 压缩阈值，默认 0.70
  // LLM 参数配置
  temperature?: number          // Expressive Mind 温度，默认 0.70
  reflective_temperature?: number // Reflective Mind 温度，默认 0.30
  top_p?: number                // 核采样，默认 1.0
  frequency_penalty?: number    // 频率惩罚，默认 0.0
  presence_penalty?: number     // 存在惩罚，默认 0.0
  // 头像
  avatar_base64?: string        // 小头像 Base64（日常使用）
  avatar_large_base64?: string  // 大头像 Base64（对话框背景）
  is_active: boolean
  created_at: string
  updated_at?: string
}

// API 响应包装
export interface ApiResponse<T> {
  code: number
  data: T
  message?: string
  timestamp: number
}

// API 错误
export interface ApiError {
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
}

// 错误码
export enum ErrorCode {
  UNKNOWN_ERROR = 1000,
  INVALID_REQUEST = 1001,
  UNAUTHORIZED = 1002,
  FORBIDDEN = 1003,
  NOT_FOUND = 1004,
  TOKEN_EXPIRED = 2000,
  TOKEN_INVALID = 2001,
  MODEL_UNAVAILABLE = 3000,
  RATE_LIMIT_EXCEEDED = 3001,
  CONTENT_TOO_LONG = 3002,
  CONTENT_VIOLATION = 3003,
  QUOTA_EXCEEDED = 3004,
  AI_PROVIDER_ERROR = 4000,
  AI_TIMEOUT = 4001,
}

// 分页参数
export interface PaginationParams {
  page?: number
  limit?: number
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

// 分页响应
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  total_pages: number
}

// 聊天请求
export interface ChatRequest {
  topic_id?: string
  content: string
  model_id?: string
  expert_id?: string
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

// 聊天响应（非流式）
export interface ChatResponse {
  message: Message
  usage: TokenUsage
  cost: number
}

// SSE 事件类型
export type SSEEventType = 'message_start' | 'content_delta' | 'message_complete' | 'error'

// SSE 事件
export interface SSEEvent {
  id: string
  type: SSEEventType
  data: unknown
}

// ============================================
// 右侧面板相关类型
// ============================================

/**
 * 统一分页查询参数
 * 所有列表查询 API 都应支持此格式
 */
export interface PageQuery {
  /** 当前页码，从 1 开始 */
  page: number
  /** 每页条数，默认 10，最大 100 */
  size: number
  /** 排序字段 */
  sort_by?: string
  /** 排序方向 */
  sort_order?: 'asc' | 'desc'
}

/**
 * 统一分页响应格式
 * 所有列表 API 都应返回此格式
 */
export interface PageResponse<T> {
  /** 数据列表 */
  items: T[]
  /** 总条数 */
  total: number
  /** 当前页码 */
  page: number
  /** 每页条数 */
  size: number
  /** 总页数 */
  pages: number
}

/**
 * 阶段性成果文档
 */
export interface Doc {
  id: string
  topic_id: string
  expert_id: string
  user_id: string
  title: string
  content: string          // Markdown 内容
  content_type: 'markdown' | 'code' | 'text'
  status: 'draft' | 'final' | 'archived'
  version: number
  tags: string[]
  created_at: string
  updated_at: string
}

/**
 * 创建/更新文档的请求数据
 */
export interface DocFormData {
  expert_id: string
  topic_id?: string
  title: string
  content: string
  content_type?: 'markdown' | 'code' | 'text'
  tags?: string[]
}

// ============================================
// 技能管理相关类型
// ============================================

/**
 * 技能来源类型
 */
export type SkillSourceType = 'url' | 'zip' | 'local'

/**
 * 工具类型
 */
export type SkillToolType = 'http' | 'script' | 'builtin'

/**
 * 技能工具（AI 解析生成）
 */
export interface SkillTool {
  id: number
  skill_id: string
  name: string
  description?: string
  type: SkillToolType
  usage?: string
  command?: string
  endpoint?: string
  method?: string
}

/**
 * 技能（匹配后端 skills 表）
 */
export interface Skill {
  id: string
  name: string
  description?: string
  version?: string
  author?: string
  tags?: string[]
  
  // 来源信息
  source_type: SkillSourceType
  source_path?: string
  source_url?: string
  
  // 文件内容
  skill_md?: string
  
  // 安全信息
  security_score: number
  security_warnings?: string[]
  
  // 配置
  config?: string
  
  // 工具清单（关联查询）
  tools?: SkillTool[]
  
  // 状态
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * 创建/更新技能的请求数据
 */
export interface SkillFormData {
  name?: string
  description?: string
  is_active?: boolean
  config?: string
}

/**
 * 专家技能关联（用于配置界面）
 */
export interface ExpertSkill {
  id: string
  name: string
  description?: string
  source_type: SkillSourceType
  is_builtin: boolean
  is_enabled: boolean
  expert_config?: string
  created_at: string
}

/**
 * 更新专家技能的请求数据
 */
export interface ExpertSkillConfig {
  skill_id: string
  is_enabled: boolean
  config?: string
}

/**
 * 安装技能的请求数据
 */
export interface InstallSkillFromUrlRequest {
  url: string
}

export interface InstallSkillFromPathRequest {
  path: string
}

// ============================================
// 用户管理相关类型
// ============================================

/**
 * 用户状态
 */
export type UserStatus = 'active' | 'inactive' | 'banned'

/**
 * 用户性别
 */
export type UserGender = 'male' | 'female' | 'other'

/**
 * 用户管理列表项（匹配后端返回）
 */
export interface UserListItem {
  id: string
  username: string
  email: string
  nickname: string
  avatar?: string
  gender?: UserGender
  birthday?: string
  occupation?: string
  location?: string
  status: UserStatus
  roles?: string[]
  last_login?: string
  created_at: string
  updated_at?: string
}

/**
 * 创建用户的请求数据
 */
export interface CreateUserRequest {
  username: string
  email: string
  password: string
  nickname?: string
  gender?: UserGender
  birthday?: string
  occupation?: string
  location?: string
  status?: UserStatus
}

/**
 * 更新用户的请求数据
 */
export interface UpdateUserRequest {
  username?: string
  email?: string
  nickname?: string
  avatar?: string
  gender?: UserGender
  birthday?: string
  occupation?: string
  location?: string
  status?: UserStatus
}

/**
 * 重置密码的请求数据
 */
export interface ResetPasswordRequest {
  password: string
}

/**
 * 角色信息
 */
export interface Role {
  id: string
  name: string
  label: string
  description?: string
  is_system: boolean
}

/**
 * 更新用户角色的请求数据
 */
export interface UpdateUserRolesRequest {
  roleIds: string[]
}

/**
 * 用户列表响应（遵循项目 PageResponse 格式）
 */
export type UserListResponse = PageResponse<UserListItem>
