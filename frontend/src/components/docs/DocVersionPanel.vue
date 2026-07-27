<template>
  <div class="doc-version-panel">
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
      :empty-text="$t('docs.workspace.versionPanel.emptyText')"
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
          <template v-if="row.id === resolvedCurrentId">
            <el-tag size="small" type="success">{{ $t('docs.workspace.versionPanel.current') }}</el-tag>
          </template>
          <template v-else>
            <el-button link type="primary" size="small" @click="handleSetCurrent(row.id)">
              {{ $t('docs.workspace.versionPanel.setCurrent') }}
            </el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <!-- Upload Dialog -->
    <el-dialog
      v-model="uploadDialogVisible"
      :title="$t('docs.workspace.versionPanel.uploadDialogTitle')"
      width="480px"
      destroy-on-close
    >
      <el-form label-position="top">
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
      <template #footer>
        <el-button @click="uploadDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="uploading" :disabled="!selectedFile" @click="handleUpload">
          {{ $t('docs.workspace.versionPanel.upload') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Edit, UploadFilled } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useDocStore } from '@/stores/doc'
import { uploadAttachmentFormData } from '@/api/attachment'
import { createIntakeRevision, updateRevisionLabel } from '@/api/docs'
import type { UploadFile } from 'element-plus'
import type { DocRevision } from '@/api/docs'

const props = defineProps<{
  documentId: string
  resolvedCurrentId?: string | null
  versions: DocRevision[]
}>()

const emit = defineEmits<{
  (e: 'version-changed'): void
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

const labelHint = computed(() => {
  const labels = props.versions.map(v => v.revision_label).filter(Boolean)
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
  newVersionLabel.value = ''
  newChangeSummary.value = ''
  selectedFile.value = null
  uploadDialogVisible.value = true
}

async function handleUpload() {
  if (!selectedFile.value) return
  uploading.value = true
  try {
    const uploadResult = await uploadAttachmentFormData({
      file: selectedFile.value,
      source_tag: 'doc-platform',
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

// --------------------- version list ---------------------
const canEditLabel = ref(true)

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
  try {
    await docStore.setCurrent(props.documentId, versionId)
    ElMessage.success(t('docs.workspace.versionPanel.currentSet'))
    emit('version-changed')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t('docs.workspace.versionPanel.currentSetFailed')
    ElMessage.error(msg)
  }
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
</style>
