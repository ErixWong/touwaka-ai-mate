/**
 * Package Whitelist Store
 * 管理包白名单配置
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import apiClient, { apiRequest } from '@/api/client'

interface PackageInfo {
  name: string
  version: string
}

interface PackageList {
  node: PackageInfo[]
  python: PackageInfo[]
}

interface WhitelistConfig {
  allowed_node_modules: string[]
  allowed_python_packages: string[]
}

export interface InstallResult {
  success: boolean
  message: string
  package?: PackageInfo
}

export const usePackageWhitelistStore = defineStore('packageWhitelist', () => {
  // 状态
  const packages = ref<PackageList>({ node: [], python: [] })
  const whitelist = ref<WhitelistConfig>({
    allowed_node_modules: [],
    allowed_python_packages: [],
  })
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // 计算属性
  const nodePackages = computed(() => packages.value.node)
  const pythonPackages = computed(() => packages.value.python)
  const allowedNodeModules = computed(() => whitelist.value.allowed_node_modules)
  const allowedPythonPackages = computed(() => whitelist.value.allowed_python_packages)

  // 获取已安装的包列表
  async function loadPackages() {
    isLoading.value = true
    error.value = null
    try {
      const result = await apiRequest<PackageList>(apiClient.get('/system/packages'))
      packages.value = result || { node: [], python: [] }
    } catch (e: any) {
      error.value = e.message
      console.error('Failed to load packages:', e)
    } finally {
      isLoading.value = false
    }
  }

  // 获取白名单配置
  async function loadWhitelist() {
    isLoading.value = true
    error.value = null
    try {
      const result = await apiRequest<WhitelistConfig>(apiClient.get('/system/packages/whitelist'))
      whitelist.value = result || {
        allowed_node_modules: [],
        allowed_python_packages: [],
      }
    } catch (e: any) {
      error.value = e.message
      console.error('Failed to load whitelist:', e)
    } finally {
      isLoading.value = false
    }
  }

  // 更新白名单配置
  async function updateWhitelist(config: Partial<WhitelistConfig>) {
    isLoading.value = true
    error.value = null
    try {
      const result = await apiRequest<WhitelistConfig>(apiClient.patch('/system/packages/whitelist', config))
      whitelist.value = result
      return true
    } catch (e: any) {
      error.value = e.message
      console.error('Failed to update whitelist:', e)
      return false
    } finally {
      isLoading.value = false
    }
  }

  // 重置白名单为默认值
  async function resetWhitelist() {
    isLoading.value = true
    error.value = null
    try {
      const result = await apiRequest<WhitelistConfig>(apiClient.post('/system/packages/whitelist/reset'))
      whitelist.value = result
      return true
    } catch (e: any) {
      error.value = e.message
      console.error('Failed to reset whitelist:', e)
      return false
    } finally {
      isLoading.value = false
    }
  }

  // 安装包
  async function installPackage(type: 'nodejs' | 'python', name: string, version?: string): Promise<InstallResult> {
    isLoading.value = true
    error.value = null
    try {
      const result = await apiRequest<InstallResult>(apiClient.post('/system/packages/install', {
        type,
        name,
        version: version || undefined,
      }))
      if (result?.success) {
        // 安装成功后刷新包列表
        await loadPackages()
      }
      return result || { success: false, message: 'No response from server' }
    } catch (e: any) {
      error.value = e.message
      console.error('Failed to install package:', e)
      return { success: false, message: e.message }
    } finally {
      isLoading.value = false
    }
  }

  return {
    // 状态
    packages,
    whitelist,
    isLoading,
    error,
    // 计算属性
    nodePackages,
    pythonPackages,
    allowedNodeModules,
    allowedPythonPackages,
    // 方法
    loadPackages,
    loadWhitelist,
    updateWhitelist,
    resetWhitelist,
    installPackage,
  }
})