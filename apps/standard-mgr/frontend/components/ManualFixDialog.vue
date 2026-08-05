<template>
  <el-dialog
    title="人工修正引用"
    :visible="true"
    width="600px"
    :close-on-click-modal="false"
    @close="$emit('close')"
  >
    <div class="sm-fix-form">
      <!-- 当前引用信息 -->
      <el-descriptions :column="1" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item label="引用原文">{{ anchor.source_text }}</el-descriptions-item>
        <el-descriptions-item label="当前状态">
          <el-tag :type="statusTag(anchor.status)" size="small">
            {{ statusLabel(anchor.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item v-if="anchor.status_reason" label="原因">
          {{ anchor.status_reason }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- 修正表单 -->
      <el-form :model="fixForm" label-width="100px">
        <el-form-item label="目标状态" required>
          <el-radio-group v-model="fixForm.status">
            <el-radio value="valid">有效</el-radio>
            <el-radio value="invalid">无效</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="fixForm.status === 'valid'">
          <el-form-item label="目标文档">
            <el-input v-model="fixForm.targetDocumentId" placeholder="输入文档 ID（可选）" clearable />
          </el-form-item>
          <el-form-item label="目标版本">
            <el-input v-model="fixForm.targetRevisionId" placeholder="输入版本 ID（可选）" clearable />
          </el-form-item>
          <el-form-item label="目标章节">
            <el-input v-model="fixForm.targetOutlineId" placeholder="输入章节 ID（可选）" clearable />
          </el-form-item>
        </template>

        <el-form-item label="修正说明">
          <el-input
            v-model="fixForm.status_reason"
            type="textarea"
            :rows="2"
            placeholder="修正原因说明"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="$emit('close')">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        提交修正
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useStandardMgrStore } from '../stores/standardMgr'
import type { RefAnchor, RefStatus } from '../api/standard-mgr'

const props = defineProps<{
  anchor: RefAnchor
  standardId: string
}>()

const emit = defineEmits<{
  close: []
  fixed: []
}>()

const store = useStandardMgrStore()
const submitting = ref(false)

const fixForm = reactive({
  status: 'valid' as 'valid' | 'invalid',
  targetDocumentId: '',
  targetRevisionId: '',
  targetOutlineId: '',
  status_reason: '',
})

async function handleSubmit() {
  submitting.value = true
  try {
    await store.submitManualFix({
      standard_id: props.standardId,
      source_revision_id: props.anchor.source_revision_id,
      source_outline_id: props.anchor.source_outline_id,
      occurrence_index: props.anchor.occurrence_index,
      source_text: props.anchor.source_text,
      ref_type: props.anchor.ref_type,
      status: fixForm.status,
      target_document_id: fixForm.targetDocumentId || undefined,
      target_revision_id: fixForm.targetRevisionId || undefined,
      target_outline_id: fixForm.targetOutlineId || undefined,
      status_reason: fixForm.status_reason || undefined,
    })
    emit('fixed')
  } finally {
    submitting.value = false
  }
}

function statusTag(status: RefStatus): 'success' | 'warning' | 'danger' | 'info' | '' {
  const map: Record<RefStatus, 'success' | 'warning' | 'danger' | 'info' | ''> = {
    valid: 'success',
    suspected: 'warning',
    gap: 'danger',
    invalid: 'info',
  }
  return map[status] || 'info'
}

function statusLabel(status: RefStatus): string {
  const map: Record<RefStatus, string> = {
    valid: '有效',
    suspected: '存疑',
    gap: '缺口',
    invalid: '无效',
  }
  return map[status] || status
}
</script>

<style scoped>
.sm-fix-form {
  padding: 4px;
}
</style>
