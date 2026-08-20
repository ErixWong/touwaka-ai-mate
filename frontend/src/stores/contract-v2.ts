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
  createVersionFromAttachment,
  approveVersion,
  setCurrentVersion,
  deleteVersion,
  getDashboard,
  getVersionProcessingStatus,
  extractMetadata,
  getVersionMetadata,
  updateVersionMetadata,
  createCompareRun,
  getCompareRunResult,
  compareVersionsWithLlm,
  getVersionCompareResult,
  type OrgNode,
  type ContractMainRecord,
  type ContractVersion,
  type ContractListResult,
  type DashboardData,
  type CompareRunResult,
  type LlmCompareResult,
  type VersionMetadata,
} from '@/api/contract-v2'
import {
  getProcessingStatus,
  retryProcessing,
  setCurrentRevision,
} from '@/api/docs'
import { useToastStore } from './toast'

export function getProcessingStatusLabel(status: string) {
  const processingStatusLabels: Record<string, { label: string; type: string }> = {
    pending_ocr: { label: '处理中', type: 'info' },
    ocr_processing: { label: '处理中', type: 'warning' },
    pending_clean: { label: '处理中', type: 'info' },
    pending_outline: { label: '处理中', type: 'info' },
    pending_chunk: { label: '处理中', type: 'info' },
    pending_embedding: { label: '处理中', type: 'info' },
    ready: { label: '已完成', type: 'success' },
    error: { label: '处理失败', type: 'danger' },
  }

  return processingStatusLabels[status] || { label: status, type: 'info' }
}

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
      contractsTotal.value = result.pagination.total
      contractsPage.value = result.pagination.page
      contractsPageSize.value = result.pagination.size
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

  async function addVersionFromAttachment(contractId: string, data: {
    file_id: string
    contract_type: string
    version_number?: string
    version_name?: string
    version_type?: string
    document_mode?: 'new' | 'existing'
    existing_document_id?: string
  }) {
    try {
      const version = await createVersionFromAttachment(contractId, data)
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
    for (const documentId of documentIds) {
      await fetchProcessingStatus(documentId)
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

  async function fetchVersionProcessingStatus(versionId: string) {
    return await getVersionProcessingStatus(versionId)
  }

  async function doExtractMetadata(versionId: string) {
    try {
      const result = await extractMetadata(versionId)
      toast.success('元数据提取成功')
      return result
    } catch (e: unknown) {
      toast.error((e as Error).message || '元数据提取失败')
      throw e
    }
  }

  async function doGetVersionMetadata(versionId: string): Promise<VersionMetadata> {
    try {
      return await getVersionMetadata(versionId)
    } catch (e: unknown) {
      toast.error((e as Error).message || '获取元数据失败')
      throw e
    }
  }

  async function doUpdateVersionMetadata(versionId: string, metadata: {
    contract_number?: string | null
    party_a?: string | null
    party_b?: string | null
    contract_amount?: number | null
  }) {
    try {
      const result = await updateVersionMetadata(versionId, metadata)
      toast.success('元数据保存成功')
      return result
    } catch (e: unknown) {
      toast.error((e as Error).message || '保存元数据失败')
      throw e
    }
  }

  async function doCreateCompareRun(versionIdA: string, versionIdB: string) {
    try {
      // v2 已切换到 LLM 语义比对（qwen3.6:35b）：compare 接口需要 row_id，
      // 由调用方（组件）从 versions 映射后传入；此处保留旧签名兼容
      const result = await createCompareRun(versionIdA, versionIdB)
      toast.success('比对任务已创建')
      return result
    } catch (e: unknown) {
      toast.error((e as Error).message || '创建比对失败')
      throw e
    }
  }

  async function doCompareVersionsWithLlm(
    rowIdA: string,
    rowIdB: string,
    options?: { model_id?: string; temperature?: number; concurrency?: number },
  ): Promise<LlmCompareResult> {
    try {
      const result = await compareVersionsWithLlm(rowIdA, rowIdB, options)
      toast.success('语义比对完成')
      return result
    } catch (e: unknown) {
      toast.error((e as Error).message || '语义比对失败')
      throw e
    }
  }

  async function doGetCompareRunResult(runId: string): Promise<CompareRunResult> {
    return await getCompareRunResult(runId)
  }

  async function doGetVersionCompareResult(rowId: string): Promise<LlmCompareResult | null> {
    return await getVersionCompareResult(rowId)
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
    addVersionFromAttachment,
    setVersionCurrent,
    approveVersionAction,
    removeVersion,
    loadDashboard,
    fetchProcessingStatus,
    fetchProcessingStatusBatch,
    fetchVersionProcessingStatus,
    doExtractMetadata,
    doGetVersionMetadata,
    doUpdateVersionMetadata,
    doCreateCompareRun,
    doGetCompareRunResult,
    doCompareVersionsWithLlm,
    doGetVersionCompareResult,
    retryDocProcessing,
    setDocRevisionCurrent,
  }
})
