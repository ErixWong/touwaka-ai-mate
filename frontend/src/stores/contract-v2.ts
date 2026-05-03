import { ref } from 'vue'
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
  listVersions,
  updateVersion,
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
import { useToastStore } from './toast'

export const useContractV2Store = defineStore('contract-v2', () => {
  const toast = useToastStore()

  const tree = ref<OrgNode[]>([])
  const treeLoading = ref(false)
  const selectedNodeId = ref<string | null>(null)

  const contracts = ref<ContractMainRecord[]>([])
  const contractsTotal = ref(0)
  const contractsPage = ref(1)
  const contractsPageSize = ref(20)
  const contractsLoading = ref(false)

  const currentContract = ref<ContractMainRecord | null>(null)
  const currentContractVersions = ref<ContractVersion[]>([])

  const dashboard = ref<DashboardData | null>(null)
  const dashboardLoading = ref(false)

  async function loadTree() {
    treeLoading.value = true
    try {
      tree.value = await getOrgTree()
    } catch (e: any) {
      toast.error(e.message || '加载组织树失败')
    } finally {
      treeLoading.value = false
    }
  }

  async function addNode(data: { name: string; node_type: string; parent_id?: string }) {
    try {
      const node = await createOrgNode(data)
      await loadTree()
      return node
    } catch (e: any) {
      toast.error(e.message || '创建节点失败')
      throw e
    }
  }

  async function editNode(nodeId: string, data: { name?: string; sort_order?: number }) {
    try {
      const node = await updateOrgNode(nodeId, data)
      await loadTree()
      return node
    } catch (e: any) {
      toast.error(e.message || '更新节点失败')
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
    } catch (e: any) {
      toast.error(e.message || '删除节点失败')
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
    } catch (e: any) {
      toast.error(e.message || '加载合同列表失败')
    } finally {
      contractsLoading.value = false
    }
  }

  async function loadContractDetail(contractId: string) {
    try {
      const contract = await getContract(contractId)
      currentContract.value = contract
      currentContractVersions.value = contract.versions || []
    } catch (e: any) {
      toast.error(e.message || '加载合同详情失败')
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
    } catch (e: any) {
      toast.error(e.message || '创建合同失败')
      throw e
    }
  }

  async function editContract(contractId: string, data: Record<string, any>) {
    try {
      const contract = await updateContract(contractId, data)
      toast.success('更新成功')
      return contract
    } catch (e: any) {
      toast.error(e.message || '更新合同失败')
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
    } catch (e: any) {
      toast.error(e.message || '删除合同失败')
    }
  }

  async function addVersion(contractId: string, data: { row_id: string; file_id?: string; version_number?: string; version_name?: string; version_type?: string }) {
    try {
      const version = await createVersion(contractId, data)
      toast.success('版本创建成功')
      await loadContractDetail(contractId)
      return version
    } catch (e: any) {
      toast.error(e.message || '创建版本失败')
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
    } catch (e: any) {
      toast.error(e.message || '设置失败')
    }
  }

  async function approveVersionAction(versionId: string) {
    try {
      await approveVersion(versionId)
      toast.success('审批通过')
      if (currentContract.value) {
        await loadContractDetail(currentContract.value.id)
      }
    } catch (e: any) {
      toast.error(e.message || '审批失败')
    }
  }

  async function removeVersion(versionId: string) {
    try {
      await deleteVersion(versionId)
      toast.success('版本已删除')
      if (currentContract.value) {
        await loadContractDetail(currentContract.value.id)
      }
    } catch (e: any) {
      toast.error(e.message || '删除版本失败')
    }
  }

  async function loadDashboard() {
    dashboardLoading.value = true
    try {
      dashboard.value = await getDashboard()
    } catch (e: any) {
      toast.error(e.message || '加载Dashboard失败')
    } finally {
      dashboardLoading.value = false
    }
  }

  return {
    tree,
    treeLoading,
    selectedNodeId,
    contracts,
    contractsTotal,
    contractsPage,
    contractsPageSize,
    contractsLoading,
    currentContract,
    currentContractVersions,
    dashboard,
    dashboardLoading,
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
  }
})
