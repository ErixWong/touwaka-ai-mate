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
  /** 是否可编辑版本号（写权限联动；未传时默认 false，避免无权限用户误编辑） */
  canEditLabel?: boolean
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

// --------------------- version helpers (与后端 doc-version-utils 对齐) ---------------------
// 尝试从 revision_label 提取年份：任意位置 4 位数字（1900-2099），支持 2012、2012版、v2012 等
function extractYear(label: string | null): number | null {
  if (!label) return null
  const m = label.match(/(\d{4})/)
  if (!m || !m[1]) return null
  const year = parseInt(m[1], 10)
  return year >= 1900 && year <= 2099 ? year : null
}

// 尝试从 revision_label 提取版本编号：v1、v2.0、1.0、2 等 → major*1000+minor
function extractVersionNumber(label: string | null): number | null {
  if (!label) return null
  const m = label.match(/^v?(\d+)(?:\.(\d+))?$/i)
  if (!m || !m[1]) return null
  const major = parseInt(m[1], 10)
  const minor = m[2] ? parseInt(m[2], 10) : 0
  return major * 1000 + minor
}

const labelHint = computed(() => {
  const labels = props.versions.map(v => v.revision_label).filter((l): l is string => Boolean(l))
  if (labels.length === 0) return 'v1'
  // 年份体系检测与后端 generateDefaultRevisionLabel 对齐：超过半数 label 含年份语义
  const yearCount = labels.filter(l => extractYear(l) !== null).length
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
// 当前版本 id：resolvedCurrentId 可能为空（后端未返回 resolved_current_revision_id），
// 兜底用版本列表里的 is_current 标记
const effectiveCurrentId = computed(() =>
  props.resolvedCurrentId || props.versions.find(v => v.is_current)?.id || null
)

// 版本号编辑开关：与后端写权限联动（can_set_current_revision/canWrite），不再恒真
const canEditLabel = computed(() => props.canEditLabel === true)

// 高亮正在预览的版本行；未预览任何版本时高亮当前版本
const highlightedId = computed(() => docStore.previewRevisionId || effectiveCurrentId.value)

function rowClassName({ row }: { row: DocRevision }) {
  return row.id === highlightedId.value ? 'version-row-active' : ''
}

/**
 * 客户端版本排序：与后端 compareRevisions() 完全一致的防御性兜底。
 * 规则：年份优先（降序）→ 版号次之（降序）→ revision_no（降序）→ created_at（降序）。
 * 任一环节无法判定时继续下一 tiebreak，不得提前返回。
 */
const sortedVersions = computed(() => {
  const list = [...props.versions]
  list.sort((a, b) => {
    const yearA = extractYear(a.revision_label)
    const yearB = extractYear(b.revision_label)

    // 双方都有年份 → 按年份降序；单方有年份 → 有年份的优先
    if (yearA !== null && yearB !== null && yearA !== yearB) return yearB - yearA
    if (yearA !== null && yearB === null) return -1
    if (yearB !== null && yearA === null) return 1

    // 双方都没有年份（或年份相同）→ 尝试按版号排序
    const verA = extractVersionNumber(a.revision_label)
    const verB = extractVersionNumber(b.revision_label)
    if (verA !== null && verB !== null && verA !== verB) return verB - verA
    if (verA !== null && verB === null) return -1
    if (verB !== null && verA === null) return 1

    // 兜底：revision_no 降序
    if (a.revision_no !== b.revision_no) return b.revision_no - a.revision_no

    // 最终兜底：created_at 降序
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0
    return timeB - timeA
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
