<script setup lang="ts">
import { computed } from 'vue'
import { useContractV2Store } from '@/stores/contract-v2'

const emit = defineEmits<{
  back: []
}>()

const store = useContractV2Store()

const contract = computed(() => store.currentContract)
const versions = computed(() => store.currentContractVersions)

const versionTypeLabels: Record<string, string> = {
  draft: '草稿',
  signed: '正式签署',
  amendment: '补充协议',
  supplement: '附件',
}

const versionStatusLabels: Record<string, { label: string; type: string }> = {
  draft: { label: '草稿', type: 'info' },
  reviewing: { label: '审核中', type: 'warning' },
  approved: { label: '已审批', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  archived: { label: '已归档', type: '' },
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

async function handleSetCurrent(versionId: string) {
  await store.setVersionCurrent(versionId)
}

async function handleApprove(versionId: string) {
  await store.approveVersionAction(versionId)
}

async function handleDeleteVersion(versionId: string) {
  try {
    await ElMessageBox.confirm('确认删除此版本？', '确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await store.removeVersion(versionId)
  } catch {}
}
</script>

<template>
  <div class="contract-detail" v-if="contract">
    <div class="contract-detail-header">
      <el-button text @click="emit('back')">
        <el-icon><ArrowLeft /></el-icon> 返回列表
      </el-button>
    </div>

    <div class="contract-detail-info">
      <h2 class="contract-detail-title">{{ contract.contract_name }}</h2>
      <div class="contract-detail-meta">
        <el-tag v-if="contract.contract_type">
          {{ contractTypeLabels[contract.contract_type] || contract.contract_type }}
        </el-tag>
        <span class="contract-detail-versions">共 {{ versions.length }} 个版本</span>
      </div>
    </div>

    <el-divider />

    <div class="contract-detail-section">
      <h3>版本历史</h3>
      <el-table :data="versions" stripe>
        <el-table-column prop="version_number" label="版本号" width="100" />
        <el-table-column prop="version_name" label="版本名称" min-width="150">
          <template #default="{ row }">
            {{ row.version_name || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="version_type" label="类型" width="100">
          <template #default="{ row }">
            {{ versionTypeLabels[row.version_type] || row.version_type || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="version_status" label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="(versionStatusLabels[row.version_status]?.type as any) || 'info'" disable-transitions>
              {{ versionStatusLabels[row.version_status]?.label || row.version_status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="is_current" label="当前版本" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_current" type="success" size="small" effect="dark">当前</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="contract_number" label="合同编号" width="130">
          <template #default="{ row }">
            {{ row.contract_number || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="party_a" label="甲方" width="130">
          <template #default="{ row }">
            {{ row.party_a || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="!row.is_current"
              size="small"
              text
              type="primary"
              @click="handleSetCurrent(row.id)"
            >设为当前</el-button>
            <el-button
              v-if="row.version_status === 'draft' || row.version_status === 'reviewing'"
              size="small"
              text
              type="success"
              @click="handleApprove(row.id)"
            >审批</el-button>
            <el-button
              size="small"
              text
              type="danger"
              @click="handleDeleteVersion(row.id)"
            >删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.contract-detail {
  max-width: 1200px;
}

.contract-detail-header {
  margin-bottom: 12px;
}

.contract-detail-info {
  margin-bottom: 8px;
}

.contract-detail-title {
  margin: 0 0 8px 0;
  font-size: 20px;
}

.contract-detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.contract-detail-versions {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.contract-detail-section {
  margin-top: 16px;
}

.contract-detail-section h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
}
</style>
