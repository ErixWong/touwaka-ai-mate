import apiClient, { apiRequest } from './client'

export interface MiniApp {
  id: string
  name: string
  description?: string
  icon: string
  type: 'document' | 'workflow' | 'data' | 'utility'
  component?: string
  fields: AppField[]
  views?: AppViews
  config?: AppConfig
  visibility: 'owner' | 'department' | 'all' | 'role'
  owner_id: string
  creator_id: string
  sort_order: number
  is_active: boolean
  revision: number
  states?: AppState[]
  created_at: string
  updated_at: string
}

export interface AppField {
  name: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'file' | 'link' | 'user' | 'formula' | 'auto_id' | 'group' | 'repeating'
  required?: boolean
  ai_extractable?: boolean
  ai_confidence?: number
  default?: any
  options?: string[]
  fields?: AppField[]
  min_items?: number
  max_items?: number
  summary_fields?: any[]
}

export interface AppViews {
  list?: {
    columns: string[]
    sort?: { field: string; order: string }
    filters?: any[]
    row_actions?: string[]
  }
  form?: any
  detail?: any
}

export interface AppConfig {
  features: string[]
  supported_formats?: string[]
  max_file_size?: number
  batch_enabled?: boolean
  batch_limit?: number
  step_resources?: Record<string, StepResourceConfig>
  prompts?: {
    filter?: string
    extract?: string
  }
}

export interface StepResourceConfig {
  type: 'mcp' | 'internal_llm'
  mcp?: McpResourceTarget
  model_id?: string
  temperature?: number
  judge_model_id?: string
}

export interface McpResourceTarget {
  server: string
  tool: string
  params_mapping?: Record<string, string>
}

export interface McpToolParam {
  name: string
  type?: string
  description?: string
  required?: boolean
}

export interface McpServerResource {
  id: string
  name: string
  display_name: string
  transport_type: string
  tools: {
    name: string
    description: string
    input_schema?: {
      type?: string
      properties?: Record<string, McpToolParam>
      required?: string[]
    } | null
  }[]
}

export interface HandlerOutput {
  key: string
  label: string
  type: string
}

export interface InternalLlmModel {
  id: string
  name: string
  model_name: string
  provider_name: string
}

export interface AvailableResources {
  mcp_servers: McpServerResource[]
  internal_llm: {
    available: boolean
    models?: InternalLlmModel[]
  }
  handler_outputs: Record<string, HandlerOutput[]>
}

export interface AppState {
  id: string
  app_id: string
  name: string
  label: string
  description?: string
  sort_order: number
  is_initial: boolean
  is_terminal: boolean
  is_error: boolean
  handler_id?: string
  success_next_state?: string
  failure_next_state?: string
}

export interface MiniAppRecord {
  id: string
  app_id: string
  user_id: string
  data: Record<string, any>
  title?: string
  ai_extracted: boolean
  ai_confidence?: Record<string, number>
  version?: string
  previous_version_id?: string
  revision: number
  files?: MiniAppFile[]
  created_at: string
  updated_at: string
}

export interface MiniAppFile {
  id: string
  record_id: string
  app_id: string
  attachment_id: string
  field_name?: string
  attachment?: any
}

export interface AppRowHandler {
  id: string
  name: string
  description?: string
  handler: string
  handler_function: string
  concurrency: number
  timeout: number
  max_retries: number
  is_active: boolean
}

export interface StatusSummary {
  total: number
  by_status: Record<string, number>
  completed: number
  processing: number
  failed: number
}

export interface PaginatedRecords {
  items: MiniAppRecord[]
  pagination: {
    page: number
    size: number
    total: number
    pages: number
    has_next: boolean
    has_prev: boolean
  }
}

export interface AppActionLog {
  id: string
  handler_id: string
  record_id: string
  app_id: string
  trigger_status: string
  result_status?: string
  success: boolean
  output_data?: any
  error_message?: string
  duration?: number
  retry_count: number
  created_at: string
}

// ==================== App ====================

export async function getApps(): Promise<MiniApp[]> {
  return apiRequest<MiniApp[]>(apiClient.get('/mini-apps'))
}

export async function getApp(appId: string): Promise<MiniApp> {
  return apiRequest<MiniApp>(apiClient.get(`/mini-apps/${appId}`))
}

export async function createApp(data: Partial<MiniApp>): Promise<MiniApp> {
  return apiRequest<MiniApp>(apiClient.post('/mini-apps', data))
}

export async function updateApp(appId: string, data: Partial<MiniApp>): Promise<MiniApp> {
  return apiRequest<MiniApp>(apiClient.put(`/mini-apps/${appId}`, data))
}

export async function deleteApp(appId: string): Promise<void> {
  return apiRequest<void>(apiClient.delete(`/mini-apps/${appId}`))
}

// ==================== Config ====================

export async function getAppConfig(appId: string): Promise<AppConfig> {
  return apiRequest<AppConfig>(apiClient.get(`/mini-apps/${appId}/config`))
}

export async function updateAppConfig(appId: string, config: Partial<AppConfig>): Promise<AppConfig> {
  return apiRequest<AppConfig>(apiClient.put(`/mini-apps/${appId}/config`, config))
}

export async function getAvailableResources(appId: string): Promise<AvailableResources> {
  return apiRequest<AvailableResources>(apiClient.get(`/mini-apps/${appId}/available-resources`))
}

// ==================== Records ====================

export async function getRecords(appId: string, params?: {
  page?: number
  size?: number
  filter?: string
}): Promise<PaginatedRecords> {
  return apiRequest<PaginatedRecords>(apiClient.get(`/mini-apps/${appId}/data`, { params }))
}

export async function getRecord(appId: string, recordId: string): Promise<MiniAppRecord> {
  return apiRequest<MiniAppRecord>(apiClient.get(`/mini-apps/${appId}/data/${recordId}`))
}

export async function createRecord(appId: string, data: Record<string, any>, attachments?: string[]): Promise<MiniAppRecord> {
  return apiRequest<MiniAppRecord>(apiClient.post(`/mini-apps/${appId}/data`, { data, attachments }))
}

export async function updateRecord(appId: string, recordId: string, data: Record<string, any>): Promise<MiniAppRecord> {
  return apiRequest<MiniAppRecord>(apiClient.put(`/mini-apps/${appId}/data/${recordId}`, { data }))
}

export async function deleteRecord(appId: string, recordId: string): Promise<void> {
  return apiRequest<void>(apiClient.delete(`/mini-apps/${appId}/data/${recordId}`))
}

export async function confirmRecord(appId: string, recordId: string, data: Record<string, any>): Promise<MiniAppRecord> {
  return apiRequest<MiniAppRecord>(apiClient.put(`/mini-apps/${appId}/data/${recordId}/confirm`, { data }))
}

export async function batchUpload(appId: string, attachments: string[]): Promise<{
  upload_time: string
  count: number
  records: MiniAppRecord[]
}> {
  return apiRequest(apiClient.post(`/mini-apps/${appId}/data/batch`, { attachments }))
}

export async function getStatusSummary(appId: string, createdAfter?: string): Promise<StatusSummary> {
  return apiRequest<StatusSummary>(apiClient.get(`/mini-apps/${appId}/status-summary`, {
    params: createdAfter ? { created_after: createdAfter } : undefined,
  }))
}

// ==================== States ====================

export async function getStates(appId: string): Promise<AppState[]> {
  return apiRequest<AppState[]>(apiClient.get(`/mini-apps/${appId}/states`))
}

// ==================== Handlers ====================

export async function getHandlers(): Promise<AppRowHandler[]> {
  return apiRequest<AppRowHandler[]>(apiClient.get('/handlers'))
}

export async function getHandlerLogs(handlerId: string, limit?: number): Promise<AppActionLog[]> {
  return apiRequest<AppActionLog[]>(apiClient.get(`/handlers/${handlerId}/logs`, { params: { limit } }))
}

export async function getHandler(handlerId: string): Promise<AppRowHandler> {
  return apiRequest<AppRowHandler>(apiClient.get(`/handlers/${handlerId}`))
}

export async function createHandler(data: Partial<AppRowHandler>): Promise<AppRowHandler> {
  return apiRequest<AppRowHandler>(apiClient.post('/handlers', data))
}

export async function updateHandler(handlerId: string, data: Partial<AppRowHandler>): Promise<AppRowHandler> {
  return apiRequest<AppRowHandler>(apiClient.put(`/handlers/${handlerId}`, data))
}

export async function deleteHandler(handlerId: string): Promise<void> {
  return apiRequest<void>(apiClient.delete(`/handlers/${handlerId}`))
}
