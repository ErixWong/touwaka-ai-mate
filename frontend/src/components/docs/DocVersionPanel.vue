<template>
  <div class="doc-version-panel" :class="{ compact: compact }">
    <div class="version-panel-header">
      <h3 class="version-panel-title">{{ $t('docs.workspace.versionPanel.title') }}</h3>
      <el-button type="primary" size="small" @click="openUploadDialog">
        {{ $t('docs.workspace.versionPanel.uploadNew') }}
      </el-button>
    </div>

    <el-table
      :data="sortedVersions"
      stripe
      size="small"
      class="version-table"
      :row-class-name="rowClassName"
      :empty-text="$t('docs.workspace.versionPanel.emptyText')"
      @row-click="handlePreviewVersion"
    >
      <el-table-column prop="revision_label" :label="$t('docs.workspace.versionPanel.label')" width="100">
        <template #default="{ row }">
          <template v-if="editingLabelId === row.id">
            <el-input
              v-model="editLabelValue"
              size="small"
              class="label-edit-input"
              @keyup.enter="saveLabel(row)"
              @keyup.escape="cancelEditLabel"
              @blur="saveLabel(row)"
            />
          </template>
          <template v-else>
            <span class="version-label-cell">
              {{ row.revision_label || `v${row.revision_no}` }}
              <el-button
                v-if="canEditLabel"
                link
                type="primary"
                size="small"
                :icon="Edit"
                class="label-edit-btn"
                @click="startEditLabel(row)"
              />
            </span>
          </template>
        </template>
      </el-table-column>
      <el-table-column prop="revision_status" :label="$t('docs.workspace.versionPanel.status')" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="statusTagType(row.revision_status)">{{ statusLabel(row.revision_status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" :label="$t('docs.workspace.versionPanel.createdAt')" width="150">
        <template #default="{ row }">{{ fmt(row.created_at) }}</template>
      </el-table-column>
      <el-table-column :label="$t('docs.workspace.versionPanel.actions')" width="140">
        <template #default="{ row }">
          <template v-if="row.id === effectiveCurrentId">
            <el-tag size="small" type="success">{{ $t('docs.workspace.versionPanel.current') }}</el-tag>
          </template>
          <template v-else>
            <el-button
              link
              type="primary"
              size="small"
              :disabled="row.revision_status === 'archived'"
              @click.stop="handleSetCurrent(row.id)"
            >
              {{ $t('docs.workspace.versionPanel.setCurrent') }}
            </el-button>
          </template>
        </template>
      </el-table-column>
      <el-table-column :label="$t('docs.workspace.versionPanel.delete')" width="70" align="center">
        <template #default="{ row }">
          <el-tooltip
            v-if="row.id === effectiveCurrentId"
            :content="$t('docs.workspace.versionPanel.deleteCurrentForbidden')"
            placement="top"
          >
            <span>
              <el-button link type="danger" size="small" :icon="Delete" disabled />
            </span>
          </el-tooltip>
          <el-button
            v-else
            link
            type="danger"
            size="small"
            :icon="Delete"
            @click.stop="handleDeleteVersion(row)"
          />
        </template>
      </el-table-column>
    </el-table>

    <!-- Upload Dialog -->
    <el-dialog
      v-model="uploadDialogVisible"
      :title="$t('docs.workspace.versionPanel.uploadDialogTitle')"
      width="520px"
      destroy-on-close
    >
      <div class="upload-source-switch">
        <div
          class="source-option"
          :class="{ active: uploadSource === 'local' }"
          @click="uploadSource = 'local'"
        >
          <div class="source-title">{{ $t('docs.workspace.collection.uploadLocal') }}</div>
          <div class="source-desc">{{ $t('docs.workspace.collection.uploadLocalDesc') }}</div>
        </div>
        <div
          class="source-option"
          :class="{ active: uploadSource === 'taskid' }"
          @click="uploadSource = 'taskid'"
        >
          <div class="source-title">{{ $t('docs.workspace.collection.uploadTaskId') }}</div>
          <div class="source-desc">{{ $t('docs.workspace.collection.uploadTaskIdDesc') }}</div>
        </div>
      </div>

      <el-form v-if="uploadSource === 'local'" label-position="top">
        <el-form-item :label="$t('docs.workspace.versionPanel.file')">
          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :limit="1"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg"
            drag
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              {{ $t('docs.workspace.versionPanel.dragOrClick') }}
            </div>
          </el-upload>
        </el-form-item>
        <el-form-item :label="$t('docs.workspace.versionPanel.label') + ' (' + $t('common.optional') + ')'">
          <el-input
            v-model="newVersionLabel"
            :placeholder="labelHint"
            maxlength="20"
          />
        </el-form-item>
        <el-form-item :label="$t('docs.workspace.versionPanel.changeSummary') + ' (' + $t('common.optional') + ')'">
          <el-input
            v-model="newChangeSummary"
            type="textarea"
            :rows="2"
            maxlength="500"
          />
        </el-form-item>
      </el-form>

      <div v-else class="upload-taskid-body">
        <div class="taskid-input-row">
          <el-input
            v-model="taskIdInput"
            :placeholder="$t('docs.workspace.collection.taskIdPlaceholder')"
            clearable
            @keyup.enter="probeTaskId"
          />
          <el-button :loading="taskIdProbing" @click="probeTaskId">{{ $t('docs.workspace.collection.taskIdQuery') }}</el-button>
        </div>

        <el-alert v-if="taskIdError" :title="taskIdError" type="warning" :closable="false" show-icon class="taskid-alert" />

        <div v-if="taskIdProbe?.status === 'completed'" class="taskid-result">
          <div class="taskid-result-row">
            <span class="taskid-label">{{ $t('docs.workspace.collection.taskIdFileName') }}</span>
            <span class="taskid-value">{{ taskIdProbe.filename || taskIdProbe.artifact_name || taskIdProbe.task_id.slice(0, 8) }}</span>
          </div>
          <div class="taskid-result-row">
            <span class="taskid-label">{{ $t('docs.workspace.collection.taskIdStatus') }}</span>
            <el-tag type="success" size="small">{{ $t('docs.workspace.collection.taskIdStatusCompleted') }}</el-tag>
          </div>
          <div v-if="taskIdProbe.completed_at" class="taskid-result-row">
            <span class="taskid-label">{{ $t('docs.workspace.collection.taskIdCompletedAt') }}</span>
            <span class="taskid-value">{{ fmt(taskIdProbe.completed_at) }}</span>
          </div>
          <div class="taskid-result-row">
            <span class="taskid-label">{{ $t('docs.workspace.collection.taskIdImageCount') }}</span>
            <span class="taskid-value">{{ taskIdProbe.image_count ?? 0 }}</span>
          </div>
          <el-input
            v-model="newVersionLabel"
            class="taskid-title-input"
            :placeholder="labelHint"
            maxlength="20"
          >
            <template #prepend>{{ $t('docs.workspace.versionPanel.label') }}</template>
          </el-input>
          <el-input
            v-model="newChangeSummary"
            class="taskid-title-input"
            type="textarea"
            :rows="2"
            maxlength="500"
            :placeholder="$t('docs.workspace.versionPanel.changeSummary')"
          />
        </div>
      </div>
      <template #footer>
        <el-button @click="uploadDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button
          v-if="uploadSource === 'local'"
          type="primary"
          :loading="uploading"
          :disabled="!selectedFile"
          @click="handleUpload"
        >
          {{ $t('docs.workspace.versionPanel.upload') }}
        </el-button>
        <el-button
          v-else
          type="primary"
          :loading="uploading"
          :disabled="taskIdProbe?.status !== 'completed'"
          @click="handleTaskIdImport"
        >
          {{ $t('docs.workspace.collection.confirmImport') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, UploadFilled } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useDocStore } from '@/stores/doc'
import apiClient from '@/api/client'
import { uploadAttachmentFormData } from '@/api/attachment'
import { createIntakeRevision, updateRevisionLabel, probeGatewayTask } from '@/api/docs'
import type { UploadFile } from 'element-plus'
import type { DocRevision, GatewayTaskProbe } from '@/api/docs'

const props = defineProps<{
  documentId: string
  resolvedCurrentId?: string | null
  versions: DocRevision[]
  compact?: boolean
}>()

const emit = defineEmits<{
  (e: 'version-changed'): void
  (e: 'preview-version', revisionId: string): void
}>()

const { t, locale } = useI18n()
const docStore = useDocStore()

// --------------------- upload state ---------------------
const uploadDialogVisible = ref(false)
const uploading = ref(false)
const selectedFile = ref<File | null>(null)
const newVersionLabel = ref('')
const newChangeSummary = ref('')
const uploadRef = ref()
const uploadSource = ref<'local' | 'taskid'>('local')
const taskIdInput = ref('')
const taskIdProbing = ref(false)
const taskIdProbe = ref<GatewayTaskProbe | null>(null)
const taskIdError = ref('')

const labelHint = computed(() => {
  const labels = props.versions.map(v => v.revision_label).filter((l): l is string => Boolean(l))
  if (labels.length === 0) return 'v1'
  // Check for year-based
  const yearCount = labels.filter(l => /^\d{4}$/.test(l)).length
  if (yearCount > 0 && yearCount >= labels.length / 2) {
    return t('docs.workspace.versionPanel.yearHint')
  }
  return t('docs.workspace.versionPanel.autoHint')
})

function handleFileChange(file: UploadFile) {
  selectedFile.value = file.raw || null
}

function handleFileRemove() {
  selectedFile.value = null
}

function openUploadDialog() {
  uploadSource.value = 'local'
  newVersionLabel.value = ''
  newChangeSummary.value = ''
  selectedFile.value = null
  taskIdInput.value = ''
  taskIdProbe.value = null
  taskIdError.value = ''
  uploadDialogVisible.value = true
}

async function handleUpload() {
  if (!selectedFile.value) return
  uploading.value = true
  try {
    const uploadResult = await uploadAttachmentFormData({
      file: selectedFile.value,
      source_tag: 'doc-platform',
      source_id: 'temp',
      access_level: 'private',
    })
    if (!uploadResult?.id) {
      ElMessage.error(t('docs.workspace.versionPanel.uploadFailed'))
      return
    }

    await createIntakeRevision(props.documentId, {
      attachments: [{ id: uploadResult.id }],
      revision_label: newVersionLabel.value || undefined,
      change_summary: newChangeSummary.value || undefined,
    })

    ElMessage.success(t('docs.workspace.versionPanel.uploadSuccess'))
    uploadDialogVisible.value = false
    emit('version-changed')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t('docs.workspace.versionPanel.uploadFailed')
    ElMessage.error(msg)
  } finally {
    uploading.value = false
  }
}

async function probeTaskId() {
  const taskId = taskIdInput.value.trim()
  taskIdError.value = ''
  taskIdProbe.value = null

  if (!taskId) {
    taskIdError.value = t('docs.workspace.collection.taskIdRequired')
    return
  }

  taskIdProbing.value = true
  try {
    const result = await probeGatewayTask(taskId)
    taskIdProbe.value = result
    if (result.status !== 'completed') {
      taskIdError.value = result.message || t('docs.workspace.collection.taskIdNotReady')
    }
  } catch (err: unknown) {
    taskIdError.value = err instanceof Error ? err.message : t('docs.workspace.collection.taskIdQueryFailed')
  } finally {
    taskIdProbing.value = false
  }
}

async function handleTaskIdImport() {
  const taskId = taskIdProbe.value?.task_id || taskIdInput.value.trim()
  if (!taskId) return

  uploading.value = true
  try {
    await apiClient.post(`/docs/documents/${props.documentId}/intake-revision/import-task`, {
      task_id: taskId,
      revision_label: newVersionLabel.value || null,
      change_summary: newChangeSummary.value || null,
      force: true,
    }, { timeout: 300000 })

    ElMessage.success(t('docs.workspace.versionPanel.uploadSuccess'))
    uploadDialogVisible.value = false
    emit('version-changed')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t('docs.workspace.versionPanel.uploadFailed')
    ElMessage.error(msg)
  } finally {
    uploading.value = false
  }
}

// --------------------- version list ---------------------
const canEditLabel = ref(true)

// 当前版本 id：resolvedCurrentId 可能为空（后端未返回 resolved_current_revision_id），
// 兜底用版本列表里的 is_current 标记
const effectiveCurrentId = computed(() =>
  props.resolvedCurrentId || props.versions.find(v => v.is_current)?.id || null
)

// 高亮正在预览的版本行；未预览任何版本时高亮当前版本
const highlightedId = computed(() => docStore.previewRevisionId || effectiveCurrentId.value)

function rowClassName({ row }: { row: DocRevision }) {
  return row.id === highlightedId.value ? 'version-row-active' : ''
}

/**
 * 客户端版本排序：年份 → revision_no DESC → created_at DESC
 * 与后端 sortRevisionList() 保持一致，作为前端防御性兜底
 */
const sortedVersions = computed(() => {
  const list = [...props.versions]
  list.sort((a, b) => {
    const aLabel = a.revision_label || ''
    const bLabel = b.revision_label || ''
    const aYear = /^(\d{4})$/.test(aLabel) ? parseInt(aLabel, 10) : null
    const bYear = /^(\d{4})$/.test(bLabel) ? parseInt(bLabel, 10) : null
    // 年份版本优先，按年份降序
    if (aYear && bYear) return bYear - aYear
    if (aYear) return -1
    if (bYear) return 1
    // revision_no 降序
    if (a.revision_no !== b.revision_no) return b.revision_no - a.revision_no
    // created_at 降序兜底
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
  return list
})

// --------------------- edit label ---------------------
const editingLabelId = ref<string | null>(null)
const editLabelValue = ref('')
const savingLabelFlag = ref(false)

function startEditLabel(version: DocRevision) {
  editingLabelId.value = version.id
  editLabelValue.value = version.revision_label || ''
}

function cancelEditLabel() {
  editingLabelId.value = null
  editLabelValue.value = ''
}

async function saveLabel(version: DocRevision) {
  // 防重入：已退出编辑态或正在提交中则跳过
  if (editingLabelId.value !== version.id || savingLabelFlag.value) return

  const newVal = editLabelValue.value.trim()

  // 无变化则仅退出编辑态，不发请求
  if (!newVal || newVal === version.revision_label) {
    editingLabelId.value = null
    editLabelValue.value = ''
    return
  }

  savingLabelFlag.value = true
  editingLabelId.value = null
  editLabelValue.value = ''

  try {
    await updateRevisionLabel(version.id, newVal)
    ElMessage.success(t('docs.workspace.versionPanel.labelUpdated'))
    emit('version-changed')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t('docs.workspace.versionPanel.labelUpdateFailed')
    ElMessage.error(msg)
  } finally {
    savingLabelFlag.value = false
  }
}

// --------------------- set current ---------------------
async function handleSetCurrent(versionId: string) {
  const ok = await docStore.setCurrent(props.documentId, versionId)
  if (!ok) {
    ElMessage.error(docStore.error || t('docs.workspace.versionPanel.currentSetFailed'))
    return
  }
  ElMessage.success(t('docs.workspace.versionPanel.currentSet'))
  emit('version-changed')
}

function handlePreviewVersion(row: DocRevision) {
  emit('preview-version', row.id)
}

// --------------------- delete version ---------------------
async function handleDeleteVersion(version: DocRevision) {
  const label = version.revision_label || `v${version.revision_no}`
  try {
    await ElMessageBox.confirm(
      t('docs.workspace.versionPanel.deleteConfirm', { label }),
      t('docs.workspace.versionPanel.delete'),
      { type: 'warning', confirmButtonText: t('common.delete'), cancelButtonText: t('common.cancel') },
    )
  } catch {
    return
  }

  const ok = await docStore.removeRevision(props.documentId, version.id)
  if (!ok) {
    ElMessage.error(docStore.error || t('docs.workspace.versionPanel.deleteFailed'))
    return
  }
  ElMessage.success(t('docs.workspace.versionPanel.deleteSuccess'))
  emit('version-changed')
}

// --------------------- helpers ---------------------
function fmt(d: string) {
  if (!d) return '-'
  return new Date(d).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')
}

const STATUS_TAGS: Record<string, string> = {
  draft: 'info',
  review: 'warning',
  approved: '',
  effective: 'success',
  expired: 'danger',
  archived: 'info',
}

function statusTagType(status: string) {
  return STATUS_TAGS[status] || 'info'
}

function statusLabel(status: string) {
  return t(`contractV2.revisionStatuses.${status}`) || status
}
</script>

<style scoped>
.doc-version-panel {
  margin-top: 24px;
  background: #fff;
  border-radius: 8px;
  padding: 16px;
}

.doc-version-panel.compact {
  margin-top: 0;
  border-radius: 0;
  box-shadow: none;
}

.version-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.version-panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: #303133;
}

.version-table {
  width: 100%;
}

.version-table :deep(.el-table__row) {
  cursor: pointer;
}

.version-table :deep(.version-row-active > td) {
  background: var(--el-color-primary-light-8) !important;
}

.version-label-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.label-edit-btn {
  opacity: 0;
  transition: opacity 0.15s;
}

.version-label-cell:hover .label-edit-btn {
  opacity: 1;
}

.label-edit-input {
  width: 100px;
}

.upload-source-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}

.source-option {
  border: 1px solid #dcdfe6;
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.source-option.active {
  border-color: #409eff;
  background: #ecf5ff;
}

.source-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.source-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.upload-taskid-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.taskid-input-row {
  display: flex;
  gap: 8px;
}

.taskid-alert {
  margin-top: 4px;
}

.taskid-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  background: #fafafa;
}

.taskid-result-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.taskid-label {
  color: #909399;
}

.taskid-value {
  color: #303133;
  text-align: right;
  word-break: break-all;
}

.taskid-title-input {
  margin-top: 4px;
}
</style>
