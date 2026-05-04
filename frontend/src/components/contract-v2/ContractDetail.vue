<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useContractV2Store } from '@/stores/contract-v2'
import { uploadAttachment } from '@/api/attachment'
import { createRecord, newID } from '@/api/mini-apps'

const APP_ID = 'contract-mgr-v2'

const emit = defineEmits<{
  back: []
}>()

const store = useContractV2Store()

const contract = computed(() => store.currentContract)
const versions = computed(() => store.currentContractVersions)

const uploading = ref(false)
const showUploadDialog = ref(false)

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

function openUploadDialog() {
  showUploadDialog.value = true
}

async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length || !contract.value) return
  const file = input.files[0]!
  input.value = ''

  uploading.value = true
  try {
    const base64Data = await fileToBase64(file)
    const att = await uploadAttachment({
      source_tag: 'mini_app_file',
      source_id: APP_ID,
      file_name: file.name,
      mime_type: file.type,
      base64_data: base64Data,
    })

    const clientId = await newID(20)
    const record = await createRecord(APP_ID, {}, [att.id], clientId)

    const nextVerNum = String(versions.value.length + 1)
    await store.addVersion(contract.value.id, {
      row_id: record.id,
      file_id: att.id,
      version_number: nextVerNum,
      version_name: file.name,
      version_type: 'draft',
    })

    showUploadDialog.value = false
  } catch (e: any) {
    console.error('Upload failed:', e)
  } finally {
    uploading.value = false
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]!
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
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
      <div class="contract-detail-section-header">
        <h3>版本历史</h3>
        <el-button type="primary" size="small" @click="openUploadDialog">
          + 上传新版本
        </el-button>
      </div>
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
    <el-dialog v-model="showUploadDialog" title="上传合同文件" width="480px" destroy-on-close>
      <div class="upload-zone">
        <div v-if="uploading" class="upload-loading">
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          <span>正在上传并处理中...</span>
        </div>
        <div v-else class="upload-drop">
          <p>点击选择合同文件</p>
          <p class="upload-hint">支持 PDF、DOCX、DOC、JPG、PNG 格式</p>
          <label class="upload-btn">
            选择文件
            <input type="file" accept=".pdf,.docx,.doc,.jpg,.png" @change="handleFileUpload" class="hidden-input" />
          </label>
        </div>
      </div>
    </el-dialog>
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

.contract-detail-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.contract-detail-section-header h3 {
  margin: 0;
}

.upload-zone {
  padding: 20px;
  text-align: center;
}

.upload-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 30px 0;
  color: var(--el-text-color-secondary);
}

.upload-drop {
  padding: 20px 0;
}

.upload-drop p {
  margin: 0 0 8px;
  color: var(--el-text-color-regular);
}

.upload-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 16px !important;
}

.upload-btn {
  display: inline-block;
  padding: 8px 24px;
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.hidden-input {
  display: none;
}
</style>
