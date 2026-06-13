<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useContractV2Store } from '@/stores/contract-v2'
import { uploadAttachmentFormData } from '@/api/attachment'
import { createRecord, newID } from '@/api/mini-apps'
import type { OrgNode } from '@/api/contract-v2'
import Pagination from '@/components/Pagination.vue'

const APP_ID = 'contract-mgr-v2'

const emit = defineEmits<{
  'click-contract': [contractId: string]
}>()

const store = useContractV2Store()

const nodeTypeLabels: Record<string, string> = {
  group: '集团',
  party: '甲方',
  project: '项目',
}

const contractTypeLabels: Record<string, string> = {
  strategy: '战略合同',
  framework: '框架合同',
  development: '开发合同',
  supply: '供应合同',
  purchase: '采购合同',
  quality: '质量合同',
  nda: '保密协议',
  technical: '技术合同',
  other: '其他',
}

const statusLabels: Record<string, { label: string; type: string }> = {
  draft: { label: '草稿', type: 'info' },
  active: { label: '生效', type: 'success' },
  expired: { label: '过期', type: 'warning' },
  terminated: { label: '终止', type: 'danger' },
}

const processingStatusLabels: Record<string, { label: string; type: string }> = {
  pending_ocr: { label: '待OCR', type: 'info' },
  ocr_processing: { label: 'OCR中', type: 'warning' },
  pending_clean: { label: '待清洗', type: 'info' },
  pending_metadata: { label: '待提取', type: 'info' },
  pending_chunk: { label: '待分段', type: 'info' },
  pending_embedding: { label: '待向量化', type: 'info' },
  pending_relocate: { label: '待归位', type: 'info' },
  ready: { label: '已完成', type: 'success' },
  error: { label: '处理失败', type: 'danger' },
}

const filterStatus = computed({
  get: () => store.filterStatus,
  set: (val) => { store.filterStatus = val }
})
const filterType = computed({
  get: () => store.filterType,
  set: (val) => { store.filterType = val }
})
const searchText = computed({
  get: () => store.searchText,
  set: (val) => { store.searchText = val }
})

const showCreateDialog = ref(false)
const createForm = ref({
  contract_name: '',
  contract_type: '',
  org_node_id: '' as string,
})
const creating = ref(false)
const selectedFile = ref<File | null>(null)

const filteredContracts = computed(() => {
  let list = store.contracts
  if (searchText.value) {
    const q = searchText.value.toLowerCase()
    list = list.filter(c =>
      c.contract_name.toLowerCase().includes(q)
    )
  }
  if (filterStatus.value) {
    list = list.filter(c => c.status === filterStatus.value)
  }
  if (filterType.value) {
    list = list.filter(c => c.contract_type === filterType.value)
  }
  return list
})

function getProcessingLabel(contract: typeof store.contracts[number]): { label: string; type: string } | null {
  if (!contract.document_id) return null
  const map = store.processingStatusMap
  const entry = map[contract.document_id]
  const status = entry?.status || contract.processing_status
  return status ? (processingStatusLabels[status] || { label: status, type: 'info' }) : null
}

function handlePageChange(page: number) {
  store.loadContracts({
    org_node_id: store.selectedNodeId || undefined,
    include_children: true,
    page,
    page_size: store.contractsPageSize,
  })
}

function openCreateDialog() {
  createForm.value = {
    contract_name: '',
    contract_type: '',
    org_node_id: store.selectedNodeId || '',
  }
  selectedFile.value = null
  showCreateDialog.value = true
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) {
    selectedFile.value = input.files[0]!
  }
  input.value = ''
}

function clearFile() {
  selectedFile.value = null
}

async function handleCreate() {
  if (!createForm.value.contract_name.trim()) return
  creating.value = true
  try {
    const newContract = await store.addContract({
      org_node_id: createForm.value.org_node_id || store.selectedNodeId || '',
      contract_name: createForm.value.contract_name.trim(),
      contract_type: createForm.value.contract_type || undefined,
    })

    if (newContract?.id && selectedFile.value) {
      const file = selectedFile.value
      const att = await uploadAttachmentFormData({
        source_tag: 'mini_app_file',
        source_id: APP_ID,
        file,
      })

      const clientId = await newID(20)
      const record = await createRecord(APP_ID, {}, [att.id], clientId)

      await store.addVersion(newContract.id, {
        row_id: record.id,
        file_id: att.id,
        version_number: '1',
        version_name: file.name,
        version_type: 'draft',
      })

      if (newContract.document_id) {
        store.startPolling()
      }
    }

    showCreateDialog.value = false
    if (newContract?.id) {
      emit('click-contract', newContract.id)
    }
  } catch {} finally {
    creating.value = false
  }
}

function flatTreeNodes(nodes: OrgNode[]): OrgNode[] {
  const result: OrgNode[] = []
  for (const n of nodes) {
    result.push(n)
    if (n.children?.length) result.push(...flatTreeNodes(n.children))
  }
  return result
}

const allNodes = computed(() => flatTreeNodes(store.tree))

onMounted(() => {
  if (store.contracts.length > 0) {
    store.startPolling()
  }
})

onUnmounted(() => {
  store.stopPolling()
})
</script>

<template>
  <div class="contract-list">
    <div v-if="store.selectedNode" class="contract-list-node-header">
      <el-tag size="large" effect="plain">
        {{ nodeTypeLabels[store.selectedNode.node_type] || store.selectedNode.node_type }}
      </el-tag>
      <span class="contract-list-node-name">{{ store.selectedNode.name }}</span>
      <span class="contract-list-node-count">{{ $t('contractV2.list.totalContracts', { count: store.contractsTotal }) }}</span>
    </div>
    <div v-else class="contract-list-node-header">
      <span class="contract-list-node-name">{{ $t('contractV2.allContracts') }}</span>
      <span class="contract-list-node-count">{{ $t('contractV2.list.totalCount', { count: store.contractsTotal }) }}</span>
    </div>

    <div class="contract-list-filters">
      <el-input
        v-model="searchText"
        :placeholder="$t('contractV2.list.searchPlaceholder')"
        prefix-icon="Search"
        clearable
        style="width: 220px;"
      />
      <el-select v-model="filterStatus"         :placeholder="$t('contractV2.list.allStatus')" clearable style="width: 120px;">
        <el-option v-for="(v, k) in statusLabels" :key="k" :label="v.label" :value="k" />
      </el-select>
      <el-select v-model="filterType"         :placeholder="$t('contractV2.list.allType')" clearable style="width: 130px;">
        <el-option v-for="(v, k) in contractTypeLabels" :key="k" :label="v" :value="k" />
      </el-select>
      <el-button type="primary" @click="openCreateDialog" style="margin-left: auto;">
        {{ $t('contractV2.newContract') }}
      </el-button>
    </div>

    <div class="contract-list-cards" v-loading="store.contractsLoading">
      <div v-if="filteredContracts.length === 0 && !store.contractsLoading" class="contract-list-empty">
        <el-empty :description="$t('contractV2.list.noContract')" />
      </div>
      <div
        v-for="contract in filteredContracts"
        :key="contract.id"
        class="contract-card"
        @click="emit('click-contract', contract.id)"
      >
        <div class="contract-card-header">
          <span class="contract-card-name">{{ contract.contract_name }}</span>
          <span class="contract-card-tags">
            <el-tag
              v-if="getProcessingLabel(contract)"
              size="small"
              :type="(getProcessingLabel(contract)!.type as any)"
              disable-transitions
              class="contract-card-processing"
            >
              {{ getProcessingLabel(contract)!.label }}
            </el-tag>
            <el-tag size="small" :type="(statusLabels[contract.status]?.type as any) || 'info'" disable-transitions>
              {{ statusLabels[contract.status]?.label || contract.status }}
            </el-tag>
          </span>
        </div>
        <div class="contract-card-meta">
          <span class="contract-card-type">
            {{ contractTypeLabels[contract.contract_type ?? ''] || contract.contract_type || '-' }}
          </span>
          <span class="contract-card-versions">{{ $t('contractV2.list.versionsCount', { count: contract.version_count }) }}</span>
          <span class="contract-card-date">
            {{ contract.updated_at?.slice(0, 10) }}
          </span>
        </div>
      </div>
    </div>

    <div class="contract-list-pagination" v-if="store.contractsTotal > store.contractsPageSize">
      <Pagination
        :current-page="store.contractsPage"
        :total-pages="Math.ceil(store.contractsTotal / store.contractsPageSize)"
        :total="store.contractsTotal"
        @change="handlePageChange"
      />
    </div>

    <el-dialog v-model="showCreateDialog" :title="$t('contractV2.newContract')" width="520px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item :label="$t('contractV2.form.contractName')" required>
          <el-input v-model="createForm.contract_name" :placeholder="$t('contractV2.form.contractNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('contractV2.form.contractType')">
          <el-select v-model="createForm.contract_type" :placeholder="$t('contractV2.form.contractTypePlaceholder')" clearable style="width: 100%;">
            <el-option v-for="(v, k) in contractTypeLabels" :key="k" :label="v" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('contractV2.form.orgNode')">
          <el-select v-model="createForm.org_node_id" :placeholder="$t('contractV2.form.orgNodePlaceholder')" clearable style="width: 100%;">
            <el-option
              v-for="node in allNodes"
              :key="node.id"
              :label="'　'.repeat(node.level - 1) + (nodeTypeLabels[node.node_type] || '') + ' ' + node.name"
              :value="node.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="合同文件">
          <div class="create-file-upload">
            <div v-if="selectedFile" class="create-file-selected">
              <el-icon><Document /></el-icon>
              <span class="create-file-name">{{ selectedFile.name }}</span>
              <el-button size="small" text type="danger" @click="clearFile">
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
            <label v-else class="create-file-trigger">
              <el-icon><Upload /></el-icon>
              <span>{{ $t('contractV2.selectFile') }}</span>
              <input type="file" accept=".pdf,.docx,.doc,.jpg,.png" @change="handleFileSelect" class="hidden-input" />
            </label>
            <div class="create-file-hint">{{ $t('contractV2.fileHint') }}</div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleCreate" :disabled="!createForm.contract_name.trim()" :loading="creating">
          {{ $t('contractV2.uploadAndCreate') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.contract-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.contract-list-node-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--el-border-color);
}

.contract-list-node-name {
  font-size: 18px;
  font-weight: 600;
}

.contract-list-node-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-left: auto;
}

.contract-list-filters {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.contract-list-cards {
  flex: 1;
  overflow-y: auto;
}

.contract-list-empty {
  padding: 40px 0;
}

.contract-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.contract-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.contract-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.contract-card-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.contract-card:hover .contract-card-name {
  color: var(--el-color-primary);
}

.contract-card-tags {
  display: flex;
  gap: 6px;
  align-items: center;
}

.contract-card-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.contract-card-type {
  background: var(--el-fill-color-light);
  padding: 2px 8px;
  border-radius: 4px;
}

.contract-card-versions {
  color: var(--el-color-primary);
}

.contract-card-date {
  margin-left: auto;
}

.contract-list-pagination {
  display: flex;
  justify-content: center;
  margin-top: 16px;
  padding-top: 12px;
}

.create-file-upload {
  width: 100%;
}

.create-file-selected {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.create-file-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.create-file-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-color-regular);
  transition: border-color 0.2s;
}

.create-file-trigger:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.create-file-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 6px;
}
</style>
