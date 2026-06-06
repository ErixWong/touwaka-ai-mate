<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useContractV2Store } from '@/stores/contract-v2'
import type { ContractVersion } from '@/api/contract-v2'
import { uploadAttachment } from '@/api/attachment'
import { createRecord, newID, getDocumentContent, type DocumentContent } from '@/api/mini-apps'
import { getRevisions, getDocumentPermissions, type DocRevision, type DocPermissions } from '@/api/docs'
import DocumentContentViewer from '@/components/apps/DocumentContentViewer.vue'

const APP_ID = 'contract-mgr-v2'

const emit = defineEmits<{
  back: []
}>()

const store = useContractV2Store()

const contract = computed(() => store.currentContract)
const versions = computed(() => store.currentContractVersions)

const uploading = ref(false)
const showUploadDialog = ref(false)
const showContentDialog = ref(false)
const documentContent = ref<DocumentContent | null>(null)
const contentLoading = ref(false)
const contentVersionName = ref('')

const docRevisions = ref<DocRevision[]>([])
const docRevisionsLoading = ref(false)
const docCurrentRevisionId = ref<string | null>(null)
const docPermissions = ref<DocPermissions | null>(null)

const retryingProcessing = ref(false)

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

const processingStatusLabels: Record<string, { label: string; type: string }> = {
  pending_ocr: { label: '待OCR识别', type: 'info' },
  ocr_processing: { label: 'OCR识别中', type: 'warning' },
  pending_clean: { label: '待文本清洗', type: 'info' },
  pending_metadata: { label: '待元数据提取', type: 'info' },
  pending_chunk: { label: '待段落分段', type: 'info' },
  pending_embedding: { label: '待向量化', type: 'info' },
  pending_relocate: { label: '待版本归位', type: 'info' },
  ready: { label: '已完成', type: 'success' },
  error: { label: '处理失败', type: 'danger' },
}

const classificationItems = computed(() => {
  return contract.value?.classification_json || []
})

const processingInfo = computed(() => {
  if (!contract.value?.document_id) return null
  const map = store.processingStatusMap
  const entry = map[contract.value.document_id]
  const status = entry?.status || contract.value.processing_status
  if (!status) return null
  const label = processingStatusLabels[status] || { label: status, type: 'info' }
  return {
    status,
    label: label.label,
    type: label.type,
    errorCode: entry?.errorCode || contract.value.processing_error_code,
  }
})

const classificationConfidenceType = (confidence: number): string => {
  if (confidence >= 0.8) return 'success'
  if (confidence >= 0.5) return 'warning'
  return 'info'
}

async function loadDocRevisions() {
  if (!contract.value?.document_id) return
  docRevisionsLoading.value = true
  try {
    const result = await getRevisions(contract.value.document_id)
    docCurrentRevisionId.value = result.current_revision_id
    docRevisions.value = result.items
  } catch {
    docRevisions.value = []
  } finally {
    docRevisionsLoading.value = false
  }
}

async function loadDocPermissions() {
  if (!contract.value?.document_id) return
  try {
    docPermissions.value = await getDocumentPermissions(contract.value.document_id)
  } catch {
    docPermissions.value = null
  }
}

watch(() => contract.value?.id, () => {
  if (contract.value) {
    loadDocRevisions()
    loadDocPermissions()
    if (contract.value.document_id) {
      store.fetchProcessingStatus(contract.value.document_id)
    }
  }
}, { immediate: true })

async function handleSetCurrent(revisionId: string) {
  try {
    await ElMessageBox.confirm('确认设为此版为当前版本？', '确认', {
      confirmButtonText: '设为当前',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await store.setDocRevisionCurrent(revisionId)
    await loadDocRevisions()
  } catch {}
}

async function handleRetryProcessing() {
  if (!contract.value?.document_id) return
  retryingProcessing.value = true
  try {
    await store.retryDocProcessing(contract.value.document_id)
  } finally {
    retryingProcessing.value = false
  }
}

async function handleRefreshStatus() {
  if (contract.value?.document_id) {
    await store.fetchProcessingStatus(contract.value.document_id)
  }
}

async function handleSetBusinessCurrent(versionId: string) {
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

async function handleViewContent(row: ContractVersion) {
  if (!row.row_id) return
  contentLoading.value = true
  contentVersionName.value = row.version_name || `V${row.version_number}`
  showContentDialog.value = true
  try {
    documentContent.value = await getDocumentContent(APP_ID, row.row_id)
  } catch {
    documentContent.value = null
  } finally {
    contentLoading.value = false
  }
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
  } catch (e: unknown) {
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
        <el-icon><ArrowLeft /></el-icon> {{ $t('common.back') }}
      </el-button>
    </div>

    <div class="contract-detail-info">
      <h2 class="contract-detail-title">{{ contract.contract_name }}</h2>
      <div class="contract-detail-meta">
        <el-tag v-if="contract.contract_type">
          {{ contractTypeLabels[contract.contract_type] || contract.contract_type }}
        </el-tag>
        <span class="contract-detail-versions">{{ $t('contractV2.list.versionsCount', { count: versions.length }) }}</span>
      </div>
    </div>

    <el-divider />

    <div v-if="contract.document_id" class="contract-detail-section">
      <div class="contract-detail-section-header">
        <h3>{{ $t('contractV2.processing.title') }}</h3>
        <el-button size="small" text @click="handleRefreshStatus">
          <el-icon><Refresh /></el-icon> {{ $t('contractV2.processing.refresh') }}
        </el-button>
      </div>
      <div v-if="processingInfo" class="processing-status-area">
        <div class="processing-status-row">
          <el-tag :type="(processingInfo.type as any)" size="large" effect="plain">
            {{ processingInfo.label }}
          </el-tag>
          <el-button
            v-if="processingInfo.status === 'error'"
            type="danger"
            size="small"
            :loading="retryingProcessing"
            @click="handleRetryProcessing"
            style="margin-left: 12px;"
          >
            {{ $t('contractV2.processing.retry') }}
          </el-button>
        </div>
        <div v-if="processingInfo.errorCode" class="processing-error-info">
          <span class="processing-error-label">{{ $t('contractV2.processing.errorCode') }}：</span>
          <span class="processing-error-code">{{ processingInfo.errorCode }}</span>
        </div>
        <div v-if="processingInfo.status !== 'ready' && processingInfo.status !== 'error'" class="processing-pending-hint">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>{{ $t('contractV2.processing.hint') }}，{{ processingInfo.label }}...</span>
        </div>
      </div>
      <div v-else class="processing-status-area">
        <el-tag type="info" size="large" effect="plain">{{ $t('contractV2.processing.notStarted') }}</el-tag>
      </div>
    </div>

    <div v-if="docRevisions.length > 0" class="contract-detail-section">
      <div class="contract-detail-section-header">
        <h3>{{ $t('contractV2.revisions.title') }}</h3>
      </div>
      <el-table :data="docRevisions" stripe v-loading="docRevisionsLoading">
        <el-table-column prop="revision_no" label="版本号" width="100" />
        <el-table-column prop="revision_label" label="版本标签" min-width="150">
          <template #default="{ row }">
            {{ row.revision_label || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="is_current" label="当前版本" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_current" type="success" size="small" effect="dark">{{ $t('contractV2.revisions.current') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="effective_from" label="生效日期" width="120">
          <template #default="{ row }">
            {{ row.effective_from || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="revision_status" label="状态" width="90" align="center">
          <template #default="{ row }">
            {{ row.revision_status }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="!row.is_current"
              size="small"
              text
              type="primary"
              @click="handleSetCurrent(row.id)"
            >{{ $t('contractV2.revisions.setCurrent') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="classificationItems.length > 0" class="contract-detail-section">
      <div class="contract-detail-section-header">
        <h3>{{ $t('contractV2.classification.title') }}</h3>
      </div>
      <div class="classification-list">
        <div
          v-for="(item, idx) in classificationItems"
          :key="idx"
          class="classification-item"
        >
          <div class="classification-item-header">
            <span class="classification-title">{{ item.title }}</span>
            <el-tag :type="classificationConfidenceType(item.confidence)" size="small" effect="plain">
              {{ (item.confidence * 100).toFixed(0) }}%
            </el-tag>
          </div>
          <div class="classification-reasons">
            <span
              v-for="(reason, rIdx) in item.reasons"
              :key="rIdx"
              class="classification-reason-tag"
            >{{ reason }}</span>
          </div>
        </div>
      </div>
    </div>

    <el-divider />

    <div class="contract-detail-section">
      <div class="contract-detail-section-header">
        <h3>{{ $t('contractV2.businessVersions.title') }}</h3>
        <el-button type="primary" size="small" @click="openUploadDialog">
          {{ $t('contractV2.uploadNewVersion') }}
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
            <el-tag v-if="row.is_current" type="success" size="small" effect="dark">{{ $t('contractV2.revisions.current') }}</el-tag>
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
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.row_id"
              size="small"
              text
              @click="handleViewContent(row)"
            >{{ $t('contractV2.actions.view') }}</el-button>
            <el-button
              v-if="!row.is_current"
              size="small"
              text
              type="primary"
              @click="handleSetBusinessCurrent(row.id)"
            >{{ $t('contractV2.revisions.setCurrent') }}</el-button>
            <el-button
              v-if="row.version_status === 'draft' || row.version_status === 'reviewing'"
              size="small"
              text
              type="success"
              @click="handleApprove(row.id)"
            >{{ $t('contractV2.actions.approve') }}</el-button>
            <el-button
              size="small"
              text
              type="danger"
              @click="handleDeleteVersion(row.id)"
            >{{ $t('contractV2.actions.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="showUploadDialog" title="上传合同文件" width="480px" destroy-on-close>
      <div class="upload-zone">
        <div v-if="uploading" class="upload-loading">
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          <span>{{ $t('contractV2.upload.uploading') }}</span>
        </div>
        <div v-else class="upload-drop">
          <p>{{ $t('contractV2.upload.selectHint') }}</p>
          <p class="upload-hint">{{ $t('contractV2.upload.formatHint') }}</p>
          <label class="upload-btn">
            {{ $t('contractV2.upload.selectBtn') }}
            <input type="file" accept=".pdf,.docx,.doc,.jpg,.png" @change="handleFileUpload" class="hidden-input" />
          </label>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="showContentDialog"
      :title="`文档内容 - ${contentVersionName}`"
      width="1200px"
      top="5vh"
      destroy-on-close
    >
      <div v-if="contentLoading" style="text-align: center; padding: 60px 0;">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <p>{{ $t('common.loading') }}</p>
      </div>
      <div v-else-if="documentContent && documentContent.has_content">
        <el-tabs>
          <el-tab-pane label="基本信息">
            <div class="detail-grid">
              <template v-if="documentContent.extract_json">
                <div v-for="(val, key) in documentContent.extract_json" :key="key" class="detail-row">
                  <span class="detail-label">{{ key }}</span>
                  <span class="detail-value">{{ val ?? '-' }}</span>
                </div>
              </template>
              <div v-if="documentContent.extract_at" class="detail-row">
                <span class="detail-label">{{ $t('contractV2.content.extractTime') }}</span>
                <span class="detail-value">{{ documentContent.extract_at }}</span>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="文档内容">
            <DocumentContentViewer
              :content-text="documentContent.filtered_text || documentContent.ocr_text || ''"
              :sections="documentContent.sections || []"
            />
          </el-tab-pane>
        </el-tabs>
      </div>
      <div v-else style="text-align: center; padding: 60px 0; color: var(--el-text-color-placeholder);">
        {{ $t('contractV2.content.noContent') }}
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.contract-detail {
  padding: 0 4px;
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

.processing-status-area {
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
}

.processing-status-row {
  display: flex;
  align-items: center;
}

.processing-error-info {
  margin-top: 8px;
  font-size: 13px;
}

.processing-error-label {
  color: var(--el-text-color-secondary);
}

.processing-error-code {
  color: var(--el-color-danger);
  font-family: monospace;
}

.processing-pending-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.classification-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.classification-item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 12px 16px;
}

.classification-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.classification-title {
  font-size: 14px;
  font-weight: 500;
}

.classification-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.classification-reason-tag {
  display: inline-block;
  padding: 2px 8px;
  font-size: 12px;
  background: var(--el-fill-color);
  border-radius: 4px;
  color: var(--el-text-color-secondary);
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

.detail-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px 16px;
  padding: 8px 0;
}

.detail-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.detail-value {
  font-size: 13px;
  color: var(--el-text-color-primary);
}
</style>
