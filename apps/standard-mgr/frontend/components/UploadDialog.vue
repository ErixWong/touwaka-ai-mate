<template>
  <el-dialog
    :title="$t('apps.standardMgr.uploadTitle')"
    :model-value="dialogVisible"
    width="600px"
    :close-on-click-modal="false"
    @close="$emit('close')"
    @update:model-value="(val: boolean) => { if (!val) $emit('close') }"
  >
    <!-- 步骤 1：上传文件 -->
    <div v-if="step === 1">
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

    <!-- 步骤 2：填写元数据 -->
    <div v-else-if="step === 2">
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

    <!-- 步骤 3：处理中 -->
    <div v-else-if="step === 3" class="sm-upload-progress">
      <el-steps :active="uploadStep" finish-status="success" align-center>
        <el-step :title="$t('apps.standardMgr.uploadStepUpload')" />
        <el-step :title="$t('apps.standardMgr.uploadStepParse')" />
        <el-step :title="$t('apps.standardMgr.uploadStepDone')" />
      </el-steps>
      <div class="sm-upload-status-text">{{ uploadStatusKey ? $t('apps.standardMgr.' + uploadStatusKey, uploadStatusParams) : '' }}</div>
    </div>

    <template #footer>
      <el-button @click="$emit('close')">{{ $t('common.cancel') }}</el-button>
      <el-button
        v-if="step === 1"
        type="primary"
        :disabled="!uploadFile"
        @click="goToStep2"
      >
        {{ $t('apps.standardMgr.nextStep') }}
      </el-button>
      <el-button
        v-if="step === 2"
        @click="step = 1"
      >
        {{ $t('apps.standardMgr.prevStep') }}
      </el-button>
      <el-button
        v-if="step === 2"
        type="primary"
        :disabled="!canSubmit"
        :loading="submitting"
        @click="handleSubmit"
      >
        {{ $t('apps.standardMgr.onboard') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { UploadFilled } from '@element-plus/icons-vue'
import {
  uploadAttachment,
  listCollections,
  intakeDocument,
  getDocumentStatus,
  createStandard,
  type StandardType,
  type DocCollection,
} from '../api/standard-mgr'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()

const emit = defineEmits<{
  close: []
  onboarded: []
}>()

const step = ref(1)
const uploadFile = ref<File | null>(null)
const uploadStep = ref(0)
const uploadStatusKey = ref('')
const uploadStatusParams = ref<Record<string, string>>({})
const submitting = ref(false)
const collectionLoading = ref(false)
const collections = ref<DocCollection[]>([])
const dialogVisible = ref(true)

const form = ref({
  standard_code: '',
  standard_name: '',
  standard_type: 'national' as StandardType,
  collection_id: '',
})

const canSubmit = computed(() => {
  return form.value.standard_code && form.value.standard_name
    && form.value.standard_type && form.value.collection_id
})

function handleFileChange(file: any) {
  uploadFile.value = file.raw
}

async function goToStep2() {
  // 加载集合列表
  if (collections.value.length === 0) {
    collectionLoading.value = true
    try {
      collections.value = await listCollections()
    } catch {
      useToastStore().error(t('apps.standardMgr.loadCollectionsFailed'))
      return
    } finally {
      collectionLoading.value = false
    }
  }
  step.value = 2
}

async function handleSubmit() {
  if (!uploadFile.value) return
  submitting.value = true
  step.value = 3
  uploadStep.value = 0

  try {
    // 步骤 1：上传附件
    uploadStatusKey.value = 'uploadStatusUploading'
    const attachment = await uploadAttachment(uploadFile.value)

    // 步骤 2：纳管文档到平台
    uploadStep.value = 1
    uploadStatusKey.value = 'uploadStatusCreatingDoc'
    const intake = await intakeDocument({
      app_id: 'standard-mgr',
      collection_id: form.value.collection_id,
      attachments: [{ id: attachment.id }],
    })

    // 步骤 3：轮询等待处理完成
    uploadStatusKey.value = 'uploadStatusWaiting'
    const maxAttempts = 120 // 最多等 10 分钟（每 5 秒）
    let ready = false
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      try {
        const status = await getDocumentStatus(intake.document_id)
        if (status.processing_status === 'ready' || status.processing_status === 'completed') {
          ready = true
          break
        }
        if (status.processing_status === 'error') {
          throw new Error(status.error_message || t('apps.standardMgr.docProcessFailed'))
        }
        uploadStatusKey.value = 'uploadStatusProcessing'
        uploadStatusParams.value = { status: status.processing_status }
      } catch (pollErr: any) {
        if (pollErr.message?.includes(t('apps.standardMgr.docProcessFailed'))) throw pollErr
        // 其他错误继续轮询
      }
    }

    if (!ready) {
      throw new Error(t('apps.standardMgr.docProcessTimeout'))
    }

    // 步骤 4：纳管为标准
    uploadStep.value = 2
    uploadStatusKey.value = 'uploadStatusOnboarding'
    await createStandard({
      document_id: intake.document_id,
      standard_type: form.value.standard_type,
      standard_code: form.value.standard_code,
      standard_name: form.value.standard_name,
    })

    useToastStore().success(t('apps.standardMgr.uploadSuccess'))
    emit('onboarded')
  } catch (err: any) {
    useToastStore().error(err?.message || t('apps.standardMgr.uploadFailed'))
    step.value = 1
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.sm-upload-progress {
  padding: 20px;
}

.sm-upload-status-text {
  text-align: center;
  margin-top: 20px;
  font-size: 14px;
  color: #606266;
}
</style>
