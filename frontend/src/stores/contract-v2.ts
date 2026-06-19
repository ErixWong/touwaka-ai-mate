import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import {
  getOrgTree,
  createOrgNode,
  updateOrgNode,
  deleteOrgNode,
  listContracts,
  getContract,
  createContract,
  updateContract,
  deleteContract,
  createVersion,
  approveVersion,
  setCurrentVersion,
  deleteVersion,
  getDashboard,
  type OrgNode,
  type ContractMainRecord,
  type ContractVersion,
  type ContractListResult,
  type DashboardData,
} from '@/api/contract-v2'
import {
  getProcessingStatus,
  retryProcessing,
  setCurrentRevision,
} from '@/api/docs'
import { useToastStore } from './toast'

const POLL_INTERVAL_MS = 10_000
const POLL_CONCURRENCY = 5

export const useContractV2Store = defineStore('contract-v2', () => {
  const toast = useToastStore()

  const tree = ref<OrgNode[]>([])
  const treeLoading = ref(false)
  const selectedNodeId = ref<string | null>(null)

  const selectedNode = computed<OrgNode | null>(() => {
    if (!selectedNodeId.value) return null
    const find = (nodes: OrgNode[]): OrgNode | null => {
      for (const n of nodes) {
        if (n.id === selectedNodeId.value) return n
        if (n.children) {
          const found = find(n.children)
          if (found) return found
        }
      }
      return null
    }
    return find(tree.value)
  })

  const contracts = ref<ContractMainRecord[]>([])
  const contractsTotal = ref(0)
  const contractsPage = ref(1)
  const contractsPageSize = ref(20)
  const contractsLoading = ref(false)

  const filterStatus = ref<string>('')
  const filterType = ref<string>('')
  const searchText = ref<string>('')

  const currentContract = ref<ContractMainRecord | null>(null)
  const currentContractVersions = ref<ContractVersion[]>([])

  const dashboard = ref<DashboardData | null>(null)
  const dashboardLoading = ref(false)

  const processingStatusMap = ref<Record<string, {
    status: string
    errorCode?: string | null
    updatedAt?: string
  }>>({})

  let pollingTimer: ReturnType<typeof setInterval> | null = null

  function resetFilters() {
    filterStatus.value = ''
    filterType.value = ''
    searchText.value = ''
  }

  async function loadTree() {
    treeLoading.value = true
    try {
      tree.value = await getOrgTree()
    } catch (e: unknown) {
      toast.error((e as Error).message || '加载组织树失败')
    } finally {
      treeLoading.value = false
    }
  }

  async function addNode(data: { name: string; node_type: string; parent_id?: string }) {
    try {
      const node = await createOrgNode(data)
      await loadTree()
      return node
    } catch (e: unknown) {
      toast.error((e as Error).message || '创建节点失败')
      throw e
    }
  }

  async function editNode(nodeId: string, data: { name?: string; sort_order?: number }) {
    try {
      const node = await updateOrgNode(nodeId, data)
      await loadTree()
      return node
    } catch (e: unknown) {
      toast.error((e as Error).message || '更新节点失败')
      throw e
    }
  }

  async function removeNode(nodeId: string) {
    try {
      await deleteOrgNode(nodeId)
      if (selectedNodeId.value === nodeId) {
        selectedNodeId.value = null
      }
      await loadTree()
      toast.success('删除成功')
    } catch (e: unknown) {
      toast.error((e as Error).message || '删除节点失败')
    }
  }

  async function loadContracts(params?: {
    org_node_id?: string
    include_children?: boolean
    contract_type?: string
    status?: string
    page?: number
    page_size?: number
  }) {
    contractsLoading.value = true
    try {
      const result: ContractListResult = await listContracts(params)
      contracts.value = result.items
      contractsTotal.value = result.total
      contractsPage.value = result.page
      contractsPageSize.value = result.page_size
      startPolling()
    } catch (e: unknown) {
      toast.error((e as Error).message || '加载合同列表失败')
    } finally {
      contractsLoading.value = false
    }
  }

  async function loadContractDetail(contractId: string) {
    try {
      const contract = await getContract(contractId)
      currentContract.value = contract
      currentContractVersions.value = contract.versions || []
    } catch (e: unknown) {
      toast.error((e as Error).message || '加载合同详情失败')
    }
  }

  async function addContract(data: { org_node_id: string; contract_name: string; contract_type?: string }) {
    try {
      const contract = await createContract(data)
      toast.success('创建成功')
      await loadContracts({
        org_node_id: selectedNodeId.value || undefined,
        page: contractsPage.value,
        page_size: contractsPageSize.value,
      })
      return contract
    } catch (e: unknown) {
      toast.error((e as Error).message || '创建合同失败')
      throw e
    }
  }

  async function editContract(contractId: string, data: Record<string, unknown>) {
    try {
      const contract = await updateContract(contractId, data)
      toast.success('更新成功')
      return contract
    } catch (e: unknown) {
      toast.error((e as Error).message || '更新合同失败')
      throw e
    }
  }

  async function removeContract(contractId: string) {
    try {
      await deleteContract(contractId)
      toast.success('删除成功')
      await loadContracts({
        org_node_id: selectedNodeId.value || undefined,
        page: contractsPage.value,
        page_size: contractsPageSize.value,
      })
    } catch (e: unknown) {
      toast.error((e as Error).message || '删除合同失败')
    }
  }

  async function addVersion(contractId: string, data: { row_id: string; file_id?: string; version_number?: string; version_name?: string; version_type?: string }) {
    try {
      const version = await createVersion(contractId, data)
      toast.success('版本创建成功')
      await loadContractDetail(contractId)
      return version
    } catch (e: unknown) {
      toast.error((e as Error).message || '创建版本失败')
      throw e
    }
  }

  async function setVersionCurrent(versionId: string) {
    try {
      await setCurrentVersion(versionId)
      toast.success('已设为当前版本')
      if (currentContract.value) {
        await loadContractDetail(currentContract.value.id)
      }
    } catch (e: unknown) {
      toast.error((e as Error).message || '设置失败')
    }
  }

  async function approveVersionAction(versionId: string) {
    try {
      await approveVersion(versionId)
      toast.success('审批通过')
      if (currentContract.value) {
        await loadContractDetail(currentContract.value.id)
      }
    } catch (e: unknown) {
      toast.error((e as Error).message || '审批失败')
    }
  }

  async function removeVersion(versionId: string) {
    try {
      await deleteVersion(versionId)
      toast.success('版本已删除')
      if (currentContract.value) {
        await loadContractDetail(currentContract.value.id)
      }
    } catch (e: unknown) {
      toast.error((e as Error).message || '删除版本失败')
    }
  }

  async function loadDashboard() {
    dashboardLoading.value = true
    try {
      dashboard.value = await getDashboard()
    } catch (e: unknown) {
      toast.error((e as Error).message || '加载Dashboard失败')
    } finally {
      dashboardLoading.value = false
    }
  }

  async function fetchProcessingStatus(documentId: string) {
    try {
      const result = await getProcessingStatus(documentId)
      processingStatusMap.value[documentId] = {
        status: result.processing_status,
        errorCode: result.processing_error_code,
        updatedAt: result.processing_updated_at,
      }
    } catch {
      processingStatusMap.value[documentId] = {
        status: 'unknown',
        errorCode: 'FETCH_FAILED',
        updatedAt: new Date().toISOString(),
      }
    }
  }

  async function fetchProcessingStatusBatch(documentIds: string[]) {
    for (let i = 0; i < documentIds.length; i += POLL_CONCURRENCY) {
      const batch = documentIds.slice(i, i + POLL_CONCURRENCY)
      await Promise.all(batch.map(id => fetchProcessingStatus(id)))
    }
  }

  async function retryDocProcessing(documentId: string) {
    try {
      const result = await retryProcessing(documentId)
      processingStatusMap.value[documentId] = {
        status: result.processing_status,
        errorCode: null,
        updatedAt: new Date().toISOString(),
      }
      toast.success('已重新提交处理')
    } catch (e: unknown) {
      toast.error((e as Error).message || '重试失败')
    }
  }

  async function setDocRevisionCurrent(revisionId: string) {
    try {
      await setCurrentRevision(revisionId)
      toast.success('已设为当前版本')
      if (currentContract.value) {
        await loadContractDetail(currentContract.value.id)
      }
    } catch (e: unknown) {
      toast.error((e as Error).message || '设置失败')
    }
  }

  function getPollableDocIds(): string[] {
    const ids: string[] = []
    for (const c of contracts.value) {
      if (c.document_id) {
        const existing = processingStatusMap.value[c.document_id]
        if (!existing || existing.status !== 'ready') {
          ids.push(c.document_id)
        }
      }
    }
    return ids
  }

  async function pollTick() {
    const ids = getPollableDocIds()
    if (ids.length === 0) return
    await fetchProcessingStatusBatch(ids)
  }

  function startPolling() {
    stopPolling()
    const ids = getPollableDocIds()
    if (ids.length === 0) return
    pollTick()
    pollingTimer = setInterval(pollTick, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (pollingTimer !== null) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  return {
    tree,
    treeLoading,
    selectedNodeId,
    selectedNode,
    contracts,
    contractsTotal,
    contractsPage,
    contractsPageSize,
    contractsLoading,
    filterStatus,
    filterType,
    searchText,
    resetFilters,
    currentContract,
    currentContractVersions,
    dashboard,
    dashboardLoading,
    processingStatusMap,
    loadTree,
    addNode,
    editNode,
    removeNode,
    loadContracts,
    loadContractDetail,
    addContract,
    editContract,
    removeContract,
    addVersion,
    setVersionCurrent,
    approveVersionAction,
    removeVersion,
    loadDashboard,
    fetchProcessingStatus,
    fetchProcessingStatusBatch,
    retryDocProcessing,
    setDocRevisionCurrent,
    startPolling,
    stopPolling,
  }
})
