<template>
  <el-dialog
    title="纳管标准"
    :visible="true"
    width="600px"
    :close-on-click-modal="false"
    @close="$emit('close')"
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
        <div class="el-upload__text">将标准文档拖到此处或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">支持 PDF / DOC / DOCX 格式</div>
        </template>
      </el-upload>
    </div>

    <!-- 步骤 2：填写元数据 -->
    <div v-else-if="step === 2">
      <el-form :model="form" label-width="100px">
        <el-form-item label="标准编号" required>
          <el-input v-model="form.standard_code" placeholder="如 GB/T 19001-2016" />
        </el-form-item>
        <el-form-item label="标准名称" required>
          <el-input v-model="form.standard_name" placeholder="标准名称" />
        </el-form-item>
        <el-form-item label="标准类型" required>
          <el-select v-model="form.standard_type" placeholder="选择类型">
            <el-option label="国家标准" value="national" />
            <el-option label="行业标准" value="industry" />
            <el-option label="企业标准" value="enterprise" />
            <el-option label="国际标准" value="international" />
          </el-select>
        </el-form-item>
        <el-form-item label="所属集合" required>
          <el-select
            v-model="form.collection_id"
            placeholder="选择文档集合"
            :loading="collectionLoading"
            filterable
          >
            <el-option
              v-for="col in collections"
              :key="col.id"
              :label="`${col.name} (${col.doc_count} 文档)`"
              :value="col.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
    </div>

    <!-- 步骤 3：处理中 -->
    <div v-else-if="step === 3" class="sm-upload-progress">
      <el-steps :active="uploadStep" finish-status="success" align-center>
        <el-step title="上传文件" />
        <el-step title="文档解析" />
        <el-step title="完成纳管" />
      </el-steps>
      <div class="sm-upload-status-text">{{ uploadStatusText }}</div>
    </div>

    <template #footer>
      <el-button @click="$emit('close')">取消</el-button>
      <el-button
        v-if="step === 1"
        type="primary"
        :disabled="!uploadFile"
        @click="goToStep2"
      >
        下一步
      </el-button>
      <el-button
        v-if="step === 2"
        @click="step = 1"
      >
        上一步
      </el-button>
      <el-button
        v-if="step === 2"
        type="primary"
        :disabled="!canSubmit"
        :loading="submitting"
        @click="handleSubmit"
      >
        纳管
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
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

const emit = defineEmits<{
  close: []
  onboarded: []
}>()

const step = ref(1)
const uploadFile = ref<File | null>(null)
const uploadStep = ref(0)
const uploadStatusText = ref('')
const submitting = ref(false)
const collectionLoading = ref(false)
const collections = ref<DocCollection[]>([])

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
      useToastStore().error('加载集合列表失败')
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
    uploadStatusText.value = '正在上传文件...'
    const attachment = await uploadAttachment(uploadFile.value)

    // 步骤 2：纳管文档到平台
    uploadStep.value = 1
    uploadStatusText.value = '正在创建文档...'
    const intake = await intakeDocument({
      app_id: 'standard-mgr',
      collection_id: form.value.collection_id,
      attachments: [{ id: attachment.id }],
    })

    // 步骤 3：轮询等待处理完成
    uploadStatusText.value = '等待文档处理完成...'
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
          throw new Error(status.error_message || '文档处理失败')
        }
        uploadStatusText.value = `文档处理中 (${status.processing_status})...`
      } catch (pollErr: any) {
        if (pollErr.message?.includes('文档处理失败')) throw pollErr
        // 其他错误继续轮询
      }
    }

    if (!ready) {
      throw new Error('文档处理超时（超过 10 分钟）')
    }

    // 步骤 4：纳管为标准
    uploadStep.value = 2
    uploadStatusText.value = '正在纳管...'
    await createStandard({
      document_id: intake.document_id,
      standard_type: form.value.standard_type,
      standard_code: form.value.standard_code,
      standard_name: form.value.standard_name,
    })

    useToastStore().success('纳管成功！可在详情页触发清洗')
    emit('onboarded')
  } catch (err: any) {
    useToastStore().error(err?.message || '纳管失败')
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
