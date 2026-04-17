import apiClient, { apiRequest } from './client'

export interface AppMarketIndex {
  version: string
  updated_at: string
  apps: AppSummary[]
  categories: Category[]
}

export interface AppSummary {
  id: string
  name: string
  version: string
  icon: string
  type: string
  description: string
  author: string
  tags: string[]
  path: string
}

export interface Category {
  id: string
  name: string
  icon: string
  description?: string
}

export interface AppManifest {
  id: string
  name: string
  version: string
  description: string
  icon: string
  type: 'document' | 'workflow' | 'data' | 'utility'
  author: string
  license: string
  repository?: string
  keywords: string[]
  compatibility: {
    min_platform_version: string
    requires: {
      mcp?: string[]
      skills?: string[]
    }
  }
  fields: FieldDefinition[]
  views: {
    list: {
      columns: string[]
      sort: { field: string; order: 'asc' | 'desc' }
    }
  }
  config: {
    features: string[]
    supported_formats: string[]
    max_file_size: number
  }
  states: AppStateDefinition[]
  component: string | null
  visibility: 'owner' | 'department' | 'all' | 'role'
}

export interface FieldDefinition {
  name: string
  label: string
  type: string
  required?: boolean
  ai_extractable?: boolean
  options?: string[]
  default?: any
}

export interface AppStateDefinition {
  name: string
  label: string
  sort_order: number
  is_initial: boolean
  is_terminal: boolean
  is_error: boolean
  handler: string | null
  success_next: string | null
  failure_next: string | null
}

export interface DependencyCheckResult {
  satisfied: boolean
  missing: {
    mcp: string[]
    skills: string[]
    platform_version: boolean
  }
}

export interface InstallResult {
  success: boolean
  app_id: string
  name: string
  version: string
  installed_handlers: string[]
}

export interface UpdateCheckResult {
  has_update: boolean
  local_version: string
  registry_version: string
  changelog: string
}

export interface RegistryConfig {
  registry_url: string
  registry_branch: string
  auto_check_updates: boolean
  check_interval_hours: number
  offline_mode: boolean
  cache_ttl_hours: number
  last_check_at: string | null
}

// 获取 Registry 索引（可用 App 列表）
export async function getAppMarketIndex(): Promise<AppMarketIndex> {
  return apiRequest(apiClient.get('/app-market/index'))
}

// 获取 App 详情（从 Registry 拉取 manifest）
export async function getAppManifest(appId: string): Promise<AppManifest> {
  return apiRequest(apiClient.get(`/app-market/apps/${appId}`))
}

// 检查依赖
export async function checkAppDependencies(appId: string): Promise<DependencyCheckResult> {
  return apiRequest(apiClient.post('/app-market/check-dependencies', { app_id: appId }))
}

// 安装 App
export async function installAppFromMarket(
  appId: string,
  visibility?: string
): Promise<InstallResult> {
  return apiRequest(
    apiClient.post('/app-market/install', { app_id: appId, visibility })
  )
}

// 卸载 App
export async function uninstallAppFromMarket(
  appId: string,
  keepData?: boolean
): Promise<{ success: boolean; app_id: string; keepData: boolean }> {
  return apiRequest(
    apiClient.delete(`/app-market/apps/${appId}`, { data: { keep_data: keepData } })
  )
}

// 检查更新
export async function checkAppUpdate(appId: string): Promise<UpdateCheckResult> {
  return apiRequest(apiClient.get(`/app-market/apps/${appId}/check-update`))
}

// 更新 App
export async function updateAppFromMarket(appId: string): Promise<InstallResult> {
  return apiRequest(apiClient.put(`/app-market/apps/${appId}/update`))
}

// 获取 Registry 配置
export async function getRegistryConfig(): Promise<RegistryConfig> {
  return apiRequest(apiClient.get('/app-market/settings'))
}

// 更新 Registry 配置
export async function updateRegistryConfig(
  config: Partial<RegistryConfig>
): Promise<{ message: string }> {
  return apiRequest(apiClient.put('/app-market/settings', config))
}

// 获取组件代码（用于动态加载）
export async function getAppComponent(appId: string): Promise<{
  name: string
  code: string
  css: string | null
  version: string
}> {
  return apiRequest(apiClient.get(`/app-market/component/${appId}`))
}
