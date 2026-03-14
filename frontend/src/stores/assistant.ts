import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Assistant, AssistantRequest, AssistantMessage } from '@/types'
import { assistantApi } from '@/api/services'

export const useAssistantStore = defineStore('assistant', () => {
  // State
  const assistants = ref<Assistant[]>([])
  const requests = ref<AssistantRequest[]>([])
  const activeRequest = ref<AssistantRequest | null>(null)
  const activeRequestMessages = ref<AssistantMessage[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // 轮询定时器
  let pollingTimer: ReturnType<typeof setInterval> | null = null

  // Getters
  const activeAssistants = computed(() =>
    assistants.value.filter(a => a.is_active)
  )

  const pendingRequests = computed(() =>
    requests.value.filter(r => r.status === 'pending' || r.status === 'running')
  )

  const completedRequests = computed(() =>
    requests.value.filter(r => r.status === 'completed' || r.status === 'failed')
  )

  // Actions
  async function fetchAssistants() {
    try {
      isLoading.value = true
      const data = await assistantApi.getAssistants()
      assistants.value = data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch assistants'
      console.error('Failed to fetch assistants:', e)
    } finally {
      isLoading.value = false
    }
  }

  async function getAssistant(type: string) {
    try {
      isLoading.value = true
      const data = await assistantApi.getAssistant(type)
      return data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch assistant'
      console.error('Failed to fetch assistant:', e)
      return null
    } finally {
      isLoading.value = false
    }
  }

  async function updateAssistant(type: string, updates: Partial<Assistant>) {
    try {
      isLoading.value = true
      const data = await assistantApi.updateAssistant(type, updates)
      // 更新本地列表中的助理
      const index = assistants.value.findIndex(a => a.assistant_type === type)
      if (index !== -1) {
        assistants.value[index] = data
      }
      return data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update assistant'
      console.error('Failed to update assistant:', e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function createAssistant(data: Partial<Assistant> & { assistant_type: string; name: string }) {
    try {
      isLoading.value = true
      const newAssistant = await assistantApi.createAssistant(data)
      // 添加到本地列表
      assistants.value.push(newAssistant)
      return newAssistant
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create assistant'
      console.error('Failed to create assistant:', e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function deleteAssistant(type: string) {
    try {
      isLoading.value = true
      await assistantApi.deleteAssistant(type)
      // 从本地列表中移除
      assistants.value = assistants.value.filter(a => a.assistant_type !== type)
      return { success: true, assistant_type: type }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete assistant'
      console.error('Failed to delete assistant:', e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function fetchRequests(expertId?: string) {
    try {
      isLoading.value = true
      const data = await assistantApi.getRequests({ expert_id: expertId, limit: 20 })
      requests.value = data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch requests'
      console.error('Failed to fetch requests:', e)
    } finally {
      isLoading.value = false
    }
  }

  async function fetchRequestDetail(requestId: string) {
    try {
      isLoading.value = true
      const data = await assistantApi.getRequest(requestId)
      activeRequest.value = data
      return data
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch request detail'
      console.error('Failed to fetch request detail:', e)
      return null
    } finally {
      isLoading.value = false
    }
  }

  async function fetchRequestMessages(requestId: string, debug = false) {
    try {
      const data = await assistantApi.getMessages(requestId, debug)
      activeRequestMessages.value = data.messages
      return data.messages
    } catch (e) {
      console.error('Failed to fetch request messages:', e)
      return []
    }
  }

  async function summonAssistant(
    assistantType: string,
    task: string,
    input: Record<string, unknown>,
    options?: {
      background?: string
      expected_output?: Record<string, unknown>
      inherited_tools?: string[]
    }
  ) {
    try {
      isLoading.value = true
      const response = await assistantApi.summon({
        assistant_type: assistantType,
        task,
        input,
        ...options
      })

      // 刷新委托列表
      await fetchRequests()

      return response
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to summon assistant'
      console.error('Failed to summon assistant:', e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  // 开始轮询（用于自动刷新处理中的委托）
  function startPolling(expertId?: string, interval = 3000) {
    if (pollingTimer) {
      stopPolling()
    }

    pollingTimer = setInterval(async () => {
      // 只在有处理中的委托时才轮询
      if (pendingRequests.value.length > 0) {
        await fetchRequests(expertId)
      }
    }, interval)
  }

  // 停止轮询
  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  // 清除活动委托
  function clearActiveRequest() {
    activeRequest.value = null
    activeRequestMessages.value = []
  }

  // 归档委托
  async function archiveRequest(requestId: string) {
    try {
      await assistantApi.archiveRequest(requestId)
      // 从列表中移除或更新
      const index = requests.value.findIndex(r => r.request_id === requestId)
      if (index !== -1 && requests.value[index]) {
        const request = requests.value[index]
        requests.value[index] = { ...request, is_archived: 1 }
      }
    } catch (e) {
      console.error('Failed to archive request:', e)
      throw e
    }
  }

  // 取消归档
  async function unarchiveRequest(requestId: string) {
    try {
      await assistantApi.unarchiveRequest(requestId)
      const index = requests.value.findIndex(r => r.request_id === requestId)
      if (index !== -1 && requests.value[index]) {
        const request = requests.value[index]
        requests.value[index] = { ...request, is_archived: 0 }
      }
    } catch (e) {
      console.error('Failed to unarchive request:', e)
      throw e
    }
  }

  // 删除委托
  async function deleteRequest(requestId: string) {
    try {
      await assistantApi.deleteRequest(requestId)
      // 从列表中移除
      requests.value = requests.value.filter(r => r.request_id !== requestId)
      // 如果是当前选中的，清除选中
      if (activeRequest.value?.request_id === requestId) {
        clearActiveRequest()
      }
    } catch (e) {
      console.error('Failed to delete request:', e)
      throw e
    }
  }

  return {
    // State
    assistants,
    requests,
    activeRequest,
    activeRequestMessages,
    isLoading,
    error,

    // Getters
    activeAssistants,
    pendingRequests,
    completedRequests,

    // Actions
    fetchAssistants,
    getAssistant,
    createAssistant,
    deleteAssistant,
    updateAssistant,
    fetchRequests,
    fetchRequestDetail,
    fetchRequestMessages,
    summonAssistant,
    startPolling,
    stopPolling,
    clearActiveRequest,
    archiveRequest,
    unarchiveRequest,
    deleteRequest,
  }
})