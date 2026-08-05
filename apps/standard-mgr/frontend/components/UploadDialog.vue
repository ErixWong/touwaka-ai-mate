<template>
  <el-dialog
    :title="$t('apps.standardMgr.uploadTitle')"
    :model-value="dialogVisible"
    width="650px"
    :close-on-click-modal="false"
    @close="$emit('close')"
    @update:model-value="(val: boolean) => { if (!val) $emit('close') }"
  >
    <!-- R8-1: 双模式切换 tabs -->
    <el-tabs v-model="activeMode" v-if="!submitting">
      <el-tab-pane :label="$t('apps.standardMgr.selectFromPlatform')" name="platform">
        <!-- 平台模式：搜索 -->
        <div v-if="platformStep === 'search'" class="sm-platform-search">
          <el-input
            v-model="searchKeyword"
            :placeholder="$t('apps.standardMgr.searchDocsPlaceholder')"
            clearable
            @input="handleSearch"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <div v-loading="docSearchLoading" class="sm-doc-list">
            <div v-if="searchResults.length === 0 && !docSearchLoading" class="sm-doc-empty">
              {{ searchKeyword ? $t('apps.standardMgr.noDocFound') : $t('apps.standardMgr.selectDocHint') }}
            </div>
            <div
              v-for="doc in searchResults"
              :key="doc.id"
              class="sm-doc-item"
              :class="{ onboarded: onboardedDocIds.has(doc.id) }"
              @click="selectPlatformDoc(doc)"
            >
              <div class="sm-doc-item-title">{{ doc.title }}</div>
              <div class="sm-doc-item-meta">
                <el-tag size="small" type="info">{{ doc.doc_type || 'standard' }}</el-tag>
                <span class="sm-doc-item-id">{{ doc.id }}</span>
                <el-tag v-if="onboardedDocIds.has(doc.id)" size="small" type="success">
                  {{ $t('apps.standardMgr.alreadyOnboarded') }}
                </el-tag>
              </div>
            </div>
          </div>
        </div>

        <!-- R9-2: 平台模式：选版本 -->
        <div v-else-if="platformStep === 'revision'" class="sm-platform-revision">
          <el-descriptions v-if="selectedDoc" :column="1" border size="small" style="margin-bottom:12px">
            <el-descriptions-item :label="$t('apps.standardMgr.standardName')">
              {{ selectedDoc.title }}
            </el-descriptions-item>
            <el-descriptions-item label="文档 ID">
              <code class="sm-id-mono">{{ selectedDoc.id }}</code>
            </el-descriptions-item>
          </el-descriptions>
          <div v-loading="revisionLoading" class="sm-revision-list">
            <div v-if="revisions.length === 0 && !revisionLoading" class="sm-doc-empty">
              {{ $t('apps.standardMgr.noRevisions') }}
            </div>
            <el-radio-group v-model="selectedRevisionId" class="sm-revision-group">
              <div
                v-for="rev in revisions"
                :key="rev.id"
                class="sm-revision-item"
                :class="{ current: rev.is_current }"
              >
                <el-radio :value="rev.id">
                  <span class="sm-rev-label">{{ rev.revision_label || `v${rev.revision_no}` }}</span>
                  <code class="sm-id-mono">{{ rev.id }}</code>
                  <el-tag v-if="rev.is_current" size="small" type="success" class="sm-rev-current-tag">
                    {{ $t('apps.standardMgr.currentRevision') }}
                  </el-tag>
                </el-radio>
              </div>
            </el-radio-group>
          </div>
        </div>

        <!-- 平台模式：表单 -->
        <div v-else-if="platformStep === 'form'">
          <el-descriptions v-if="selectedDoc" :column="1" border size="small" style="margin-bottom:16px">
            <el-descriptions-item :label="$t('apps.standardMgr.standardName')">
              {{ selectedDoc.title }}
            </el-descriptions-item>
            <el-descriptions-item label="文档 ID"><code class="sm-id-mono">{{ selectedDoc.id }}</code></el-descriptions-item>
            <el-descriptions-item v-if="selectedRevision" :label="$t('apps.standardMgr.revisionLabel')">
              {{ selectedRevision.revision_label || `v${selectedRevision.revision_no}` }}
              <code class="sm-id-mono">{{ selectedRevision.id }}</code>
            </el-descriptions-item>
          </el-descriptions>
          <el-form :model="form" label-width="100px">
            <el-form-item :label="$t('apps.standardMgr.standardCode')" required>
              <el-input v-model="form.standard_code" :placeholder="$t('apps.standardMgr.standardCodePlaceholder')" />
            </el-form-item>
            <el-form-item :label="$t('apps.standardMgr.standardName')" required>
              <el-input v-model="form.standard_name" :placeholder="$t('apps.standardMgr.standardName')" />
            </el-form-item>
            <el-form-item :label="$t('apps.standardMgr.standardType')" required>
              <el-select v-model="form.standard_type" :placeholder="$t('apps.standardMgr.selectTypePlaceholder')">
                <el-option :label="$t('apps.standardMgr.typeNational')" value="national" />
                <el-option :label="$t('apps.standardMgr.typeIndustry')" value="industry" />
                <el-option :label="$t('apps.standardMgr.typeEnterprise')" value="enterprise" />
                <el-option :label="$t('apps.standardMgr.typeInternational')" value="international" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="$t('apps.standardMgr.uploadNewFile')" name="upload">
        <!-- 上传模式步骤 1：选择文件 -->
        <div v-if="uploadStep === 1">
          <el-upload
            ref="uploadRef"
            drag
            :auto-upload="false"
            :on-change="handleFileChange"
            :limit="1"
            accept=".pdf,.doc,.docx"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">{{ $t('apps.standardMgr.uploadDragHint') }}</div>
            <template #tip>
              <div class="el-upload__tip">{{ $t('apps.standardMgr.uploadTipFormat') }}</div>
            </template>
          </el-upload>
        </div>
        <!-- 上传模式步骤 2：表单 -->
        <div v-else-if="uploadStep === 2">
          <el-form :model="form" label-width="100px">
            <el-form-item :label="$t('apps.standardMgr.standardCode')" required>
              <el-input v-model="form.standard_code" :placeholder="$t('apps.standardMgr.standardCodePlaceholder')" />
            </el-form-item>
            <el-form-item :label="$t('apps.standardMgr.standardName')" required>
              <el-input v-model="form.standard_name" :placeholder="$t('apps.standardMgr.standardName')" />
            </el-form-item>
            <el-form-item :label="$t('apps.standardMgr.standardType')" required>
              <el-select v-model="form.standard_type" :placeholder="$t('apps.standardMgr.selectTypePlaceholder')">
                <el-option :label="$t('apps.standardMgr.typeNational')" value="national" />
                <el-option :label="$t('apps.standardMgr.typeIndustry')" value="industry" />
                <el-option :label="$t('apps.standardMgr.typeEnterprise')" value="enterprise" />
                <el-option :label="$t('apps.standardMgr.typeInternational')" value="international" />
              </el-select>
            </el-form-item>
            <el-form-item :label="$t('apps.standardMgr.collectionLabel')" required>
              <el-select
                v-model="form.collection_id"
                :placeholder="$t('apps.standardMgr.selectCollectionPlaceholder')"
                :loading="collectionLoading"
                filterable
              >
                <el-option
                  v-for="col in collections"
                  :key="col.id"
                  :label="$t('apps.standardMgr.collectionItemFormat', { name: col.name, count: col.doc_count })"
                  :value="col.id"
                />
              </el-select>
            </el-form-item>
          </el-form>
        </div>
        <!-- 上传模式步骤 3：进 度 -->
        <div v-else-if="uploadStep === 3" class="sm-upload-progress">
          <el-steps :active="uploadProgressStep" finish-status="success" align-center>
            <el-step :title="$t('apps.standardMgr.uploadStepUpload')" />
            <el-step :title="$t('apps.standardMgr.uploadStepParse')" />
            <el-step :title="$t('apps.standardMgr.uploadStepDone')" />
          </el-steps>
          <div class="sm-upload-status-text">
            {{ uploadStatusKey ? $t('apps.standardMgr.' + uploadStatusKey, uploadStatusParams) : '' }}
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 提交中 -->
    <div v-else class="sm-upload-progress">
      <div class="sm-upload-status-text">{{ $t('apps.standardMgr.uploadStatusOnboarding') }}</div>
    </div>

    <template #footer>
      <el-button @click="$emit('close')" :disabled="submitting">{{ $t('common.cancel') }}</el-button>

      <template v-if="activeMode === 'platform' && !submitting">
        <el-button v-if="platformStep === 'revision'" @click="platformStep = 'search'">
          {{ $t('apps.standardMgr.prevStep') }}
        </el-button>
        <el-button v-if="platformStep === 'form'" @click="platformStep = 'revision'">
          {{ $t('apps.standardMgr.prevStep') }}
        </el-button>
        <el-button v-if="platformStep === 'search'" type="primary" :disabled="!selectedDoc" @click="goToRevisionSelect">
          {{ $t('apps.standardMgr.nextStep') }}
        </el-button>
        <el-button v-if="platformStep === 'revision'" type="primary" :disabled="!selectedRevisionId" @click="goToPlatformForm">
          {{ $t('apps.standardMgr.nextStep') }}
        </el-button>
        <el-button v-if="platformStep === 'form'" type="primary" :disabled="!canSubmitPlatform" :loading="submitting" @click="handlePlatformSubmit">
          {{ $t('apps.standardMgr.onboard') }}
        </el-button>
      </template>

      <template v-if="activeMode === 'upload' && !submitting">
        <el-button v-if="uploadStep === 1" type="primary" :disabled="!uploadFile" @click="goToUploadForm">
          {{ $t('apps.standardMgr.nextStep') }}
        </el-button>
        <el-button v-if="uploadStep === 2" @click="uploadStep = 1">
          {{ $t('apps.standardMgr.prevStep') }}
        </el-button>
        <el-button v-if="uploadStep === 2" type="primary" :disabled="!canSubmitUpload" :loading="submitting" @click="handleUploadSubmit">
          {{ $t('apps.standardMgr.onboard') }}
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { i18n } from '@/i18n'
import { Search, UploadFilled } from '@element-plus/icons-vue'
import {
  uploadAttachment,
  listCollections,
  intakeDocument,
  getDocumentStatus,
  createStandard,
  searchDocuments,
  getDocumentRevisions,
  type StandardType,
  type DocCollection,
  type DocumentInfo,
  type DocumentRevision,
} from '../api/standard-mgr'
import { useToastStore } from '@/stores/toast'

const emit = defineEmits<{
  close: []
  onboarded: []
}>()

const props = defineProps<{
  onboardedDocIds?: Set<string>
}>()

const dialogVisible = ref(true)

// ==================== 模式 ====================
type OnboardMode = 'platform' | 'upload'
const activeMode = ref<OnboardMode>('platform')

// ==================== 平台模式 ====================
const platformStep = ref<'search' | 'revision' | 'form'>('search')
const searchKeyword = ref('')
const docSearchLoading = ref(false)
const searchResults = ref<DocumentInfo[]>([])
const selectedDoc = ref<DocumentInfo | null>(null)
const onboardedDocIds = computed(() => props.onboardedDocIds || new Set<string>())

// R9-2: 版本选择
const revisionLoading = ref(false)
const revisions = ref<DocumentRevision[]>([])
const selectedRevisionId = ref<string | null>(null)
const selectedRevision = computed(() => revisions.value.find(r => r.id === selectedRevisionId.value) || null)

// ==================== 上传模式 ====================
const uploadStep = ref(1)
const uploadFile = ref<File | null>(null)
const uploadProgressStep = ref(0)
const uploadStatusKey = ref('')
const uploadStatusParams = ref<Record<string, string>>({})
const collectionLoading = ref(false)
const collections = ref<DocCollection[]>([])

// ==================== 共享 ====================
const submitting = ref(false)

const form = ref({
  standard_code: '',
  standard_name: '',
  standard_type: 'national' as StandardType,
  collection_id: '',
})

const canSubmitPlatform = computed(() =>
  form.value.standard_code && form.value.standard_name && form.value.standard_type && selectedDoc.value
)
const canSubmitUpload = computed(() =>
  form.value.standard_code && form.value.standard_name && form.value.standard_type && form.value.collection_id
)

// ==================== 平台模式逻辑 ====================

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function handleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    docSearchLoading.value = true
    try {
      const result = await searchDocuments({
        keyword: searchKeyword.value || undefined,
        doc_type: 'standard',
        processing_status: 'ready',
        page_size: 50,
      })
      searchResults.value = result.items || []
    } catch {
      useToastStore().error(i18n.global.t('apps.standardMgr.loadListFailed'))
    } finally {
      docSearchLoading.value = false
    }
  }, 300)
}

watch(activeMode, (mode) => { if (mode === 'platform') handleSearch() }, { immediate: true })

function selectPlatformDoc(doc: DocumentInfo) {
  if (onboardedDocIds.value.has(doc.id)) return
  selectedDoc.value = doc
  form.value.standard_code = doc.title
  form.value.standard_name = doc.title
}

/** R9-2: 选中文档后获取版本列表 */
async function goToRevisionSelect() {
  if (!selectedDoc.value) return
  revisionLoading.value = true
  revisions.value = []
  selectedRevisionId.value = null
  try {
    revisions.value = await getDocumentRevisions(selectedDoc.value.id)
    // 默认选中当前版本
    const current = revisions.value.find(r => (r as any).is_current)
    if (current) selectedRevisionId.value = current.id
    else {
      const first = revisions.value[0]
      if (first) selectedRevisionId.value = first.id
    }
  } catch {
    useToastStore().error(i18n.global.t('apps.standardMgr.loadRevisionsFailed'))
    return
  } finally {
    revisionLoading.value = false
  }
  platformStep.value = 'revision'
}

function goToPlatformForm() {
  if (!selectedRevisionId.value) return
  platformStep.value = 'form'
}

async function handlePlatformSubmit() {
  if (!selectedDoc.value) return
  submitting.value = true
  try {
    await createStandard({
      document_id: selectedDoc.value.id,
      standard_type: form.value.standard_type,
      standard_code: form.value.standard_code,
      standard_name: form.value.standard_name,
      ...(selectedRevisionId.value ? { revision_id: selectedRevisionId.value } : {}),
    })
    useToastStore().success(i18n.global.t('apps.standardMgr.uploadSuccess'))
    emit('onboarded')
  } catch (err: any) {
    useToastStore().error(err?.message || i18n.global.t('apps.standardMgr.uploadFailed'))
  } finally {
    submitting.value = false
  }
}

// ==================== 上传模式逻辑 ====================

function handleFileChange(file: any) {
  uploadFile.value = file.raw
}

async function goToUploadForm() {
  if (collections.value.length === 0) {
    collectionLoading.value = true
    try {
      collections.value = await listCollections()
    } catch {
      useToastStore().error(i18n.global.t('apps.standardMgr.loadCollectionsFailed'))
      return
    } finally {
      collectionLoading.value = false
    }
  }
  uploadStep.value = 2
}

async function handleUploadSubmit() {
  if (!uploadFile.value) return
  submitting.value = true
  uploadStep.value = 3
  uploadProgressStep.value = 0

  try {
    uploadStatusKey.value = 'uploadStatusUploading'
    const attachment = await uploadAttachment(uploadFile.value)

    uploadProgressStep.value = 1
    uploadStatusKey.value = 'uploadStatusCreatingDoc'
    const intake = await intakeDocument({
      app_id: 'standard-mgr',
      collection_id: form.value.collection_id,
      attachments: [{ id: attachment.id }],
    })

    uploadStatusKey.value = 'uploadStatusWaiting'
    let ready = false
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000))
      try {
        const status = await getDocumentStatus(intake.document_id)
        if (status.processing_status === 'ready' || status.processing_status === 'completed') { ready = true; break }
        if (status.processing_status === 'error') {
          throw new Error(status.error_message || i18n.global.t('apps.standardMgr.docProcessFailed'))
        }
        uploadStatusKey.value = 'uploadStatusProcessing'
        uploadStatusParams.value = { status: status.processing_status }
      } catch (pollErr: any) {
        if (pollErr.message?.includes(i18n.global.t('apps.standardMgr.docProcessFailed'))) throw pollErr
      }
    }
    if (!ready) throw new Error(i18n.global.t('apps.standardMgr.docProcessTimeout'))

    uploadProgressStep.value = 2
    uploadStatusKey.value = 'uploadStatusOnboarding'
    await createStandard({
      document_id: intake.document_id,
      standard_type: form.value.standard_type,
      standard_code: form.value.standard_code,
      standard_name: form.value.standard_name,
    })

    useToastStore().success(i18n.global.t('apps.standardMgr.uploadSuccess'))
    emit('onboarded')
  } catch (err: any) {
    useToastStore().error(err?.message || i18n.global.t('apps.standardMgr.uploadFailed'))
    uploadStep.value = 1
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.sm-platform-search { min-height: 200px; }
.sm-doc-list { margin-top: 12px; max-height: 300px; overflow-y: auto; }
.sm-doc-empty { text-align: center; color: #909399; padding: 40px 0; }
.sm-doc-item {
  padding: 10px 12px; border: 1px solid #e4e7ed;
  border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: border-color .2s;
}
.sm-doc-item:hover { border-color: #409eff; }
.sm-doc-item.onboarded { opacity: .5; cursor: not-allowed; }
.sm-doc-item-title { font-size: 14px; font-weight: 500; margin-bottom: 4px; }
.sm-doc-item-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.sm-doc-item-id { font-size: 11px; color: #909399; font-family: monospace; }
.sm-id-mono { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 12px; background: #f5f7fa; padding: 1px 4px; border-radius: 3px; }
.sm-platform-revision { min-height: 200px; }
.sm-revision-list { margin-top: 12px; }
.sm-revision-group { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.sm-revision-item { padding: 6px 0; }
.sm-revision-item.current { font-weight: 500; }
.sm-rev-label { margin: 0 8px 0 4px; }
.sm-rev-current-tag { margin-left: 8px; }
.sm-upload-progress { padding: 20px; min-height: 150px; }
.sm-upload-status-text { text-align: center; margin-top: 20px; font-size: 14px; color: #606266; }
</style>
