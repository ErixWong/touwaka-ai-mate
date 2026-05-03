import apiClient, { apiRequest } from './client'

export interface OrgNode {
  id: string
  parent_id: string | null
  node_type: 'group' | 'party' | 'project'
  name: string
  path: string
  level: number
  sort_order: number
  is_active: boolean
  children?: OrgNode[]
  created_at: string
  updated_at: string
}

export interface ContractMainRecord {
  id: string
  org_node_id: string
  contract_name: string
  contract_type: string | null
  current_version_id: string | null
  version_count: number
  status: 'draft' | 'active' | 'expired' | 'terminated'
  created_by: string
  created_at: string
  updated_at: string
  versions?: ContractVersion[]
}

export interface ContractVersion {
  id: string
  contract_id: string
  row_id: string
  file_id: string | null
  version_number: string
  version_name: string | null
  version_type: 'draft' | 'signed' | 'amendment' | 'supplement' | null
  version_status: 'draft' | 'reviewing' | 'approved' | 'rejected' | 'archived'
  effective_date: string | null
  expiry_date: string | null
  contract_number: string | null
  party_a: string | null
  party_b: string | null
  total_amount: number | null
  change_summary: string | null
  is_current: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface ContractListResult {
  items: ContractMainRecord[]
  total: number
  page: number
  page_size: number
}

export interface DashboardData {
  total_contracts: number
  total_versions: number
  total_nodes: number
  by_status: Record<string, number>
  by_type: Record<string, number>
  recent_contracts: ContractMainRecord[]
}

export interface OrgNodeStats {
  node_id: string
  node_name: string
  node_type: string
  direct_contracts: number
  total_contracts: number
}

export async function getOrgTree(): Promise<OrgNode[]> {
  return apiRequest<OrgNode[]>(apiClient.get('/contract-v2/org-nodes/tree'))
}

export async function createOrgNode(data: { name: string; node_type: string; parent_id?: string }): Promise<OrgNode> {
  return apiRequest<OrgNode>(apiClient.post('/contract-v2/org-nodes', data))
}

export async function updateOrgNode(nodeId: string, data: { name?: string; sort_order?: number }): Promise<OrgNode> {
  return apiRequest<OrgNode>(apiClient.put(`/contract-v2/org-nodes/${nodeId}`, data))
}

export async function deleteOrgNode(nodeId: string): Promise<void> {
  return apiRequest<void>(apiClient.delete(`/contract-v2/org-nodes/${nodeId}`))
}

export async function getOrgNodeStats(nodeId: string): Promise<OrgNodeStats> {
  return apiRequest<OrgNodeStats>(apiClient.get(`/contract-v2/org-nodes/${nodeId}/stats`))
}

export async function listContracts(params?: {
  org_node_id?: string
  include_children?: boolean
  contract_type?: string
  status?: string
  page?: number
  page_size?: number
}): Promise<ContractListResult> {
  return apiRequest<ContractListResult>(apiClient.get('/contract-v2/contracts', { params }))
}

export async function getContract(contractId: string): Promise<ContractMainRecord> {
  return apiRequest<ContractMainRecord>(apiClient.get(`/contract-v2/contracts/${contractId}`))
}

export async function createContract(data: {
  org_node_id: string
  contract_name: string
  contract_type?: string
}): Promise<ContractMainRecord> {
  return apiRequest<ContractMainRecord>(apiClient.post('/contract-v2/contracts', data))
}

export async function updateContract(contractId: string, data: {
  contract_name?: string
  contract_type?: string
  status?: string
}): Promise<ContractMainRecord> {
  return apiRequest<ContractMainRecord>(apiClient.put(`/contract-v2/contracts/${contractId}`, data))
}

export async function deleteContract(contractId: string): Promise<void> {
  return apiRequest<void>(apiClient.delete(`/contract-v2/contracts/${contractId}`))
}

export async function createVersion(contractId: string, data: {
  row_id: string
  file_id?: string
  version_number?: string
  version_name?: string
  version_type?: string
}): Promise<ContractVersion> {
  return apiRequest<ContractVersion>(apiClient.post(`/contract-v2/contracts/${contractId}/versions`, data))
}

export async function listVersions(contractId: string): Promise<ContractVersion[]> {
  return apiRequest<ContractVersion[]>(apiClient.get(`/contract-v2/contracts/${contractId}/versions`))
}

export async function updateVersion(versionId: string, data: Record<string, any>): Promise<ContractVersion> {
  return apiRequest<ContractVersion>(apiClient.put(`/contract-v2/versions/${versionId}`, data))
}

export async function approveVersion(versionId: string): Promise<ContractVersion> {
  return apiRequest<ContractVersion>(apiClient.put(`/contract-v2/versions/${versionId}/approve`))
}

export async function setCurrentVersion(versionId: string): Promise<ContractVersion> {
  return apiRequest<ContractVersion>(apiClient.put(`/contract-v2/versions/${versionId}/current`))
}

export async function deleteVersion(versionId: string): Promise<void> {
  return apiRequest<void>(apiClient.delete(`/contract-v2/versions/${versionId}`))
}

export async function getDashboard(): Promise<DashboardData> {
  return apiRequest<DashboardData>(apiClient.get('/contract-v2/dashboard'))
}
