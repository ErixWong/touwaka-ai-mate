<template>
  <el-dialog
    :title="$t('apps.standardMgr.manualFixTitle')"
    :model-value="dialogVisible"
    width="600px"
    :close-on-click-modal="false"
    @close="$emit('close')"
    @update:model-value="(val: boolean) => { if (!val) $emit('close') }"
  >
    <div class="sm-fix-form">
      <!-- 当前引用信息 -->
      <el-descriptions :column="1" border size="small" style="margin-bottom: 16px">
        <el-descriptions-item :label="$t('apps.standardMgr.manualFixSourceText')">{{ anchor.source_text }}</el-descriptions-item>
        <el-descriptions-item :label="$t('apps.standardMgr.manualFixCurrentStatus')">
          <el-tag :type="statusTag(anchor.status)" size="small">
            {{ $t(statusLabel(anchor.status)) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item v-if="anchor.status_reason" :label="$t('apps.standardMgr.manualFixReason')">
          {{ anchor.status_reason }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- 修正表单 -->
      <el-form :model="fixForm" label-width="100px">
        <el-form-item :label="$t('apps.standardMgr.manualFixTargetStatus')" required>
          <el-radio-group v-model="fixForm.status">
            <el-radio value="valid">{{ $t('apps.standardMgr.anchorValid') }}</el-radio>
            <el-radio value="invalid">{{ $t('apps.standardMgr.anchorInvalid') }}</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="fixForm.status === 'valid'">
          <el-form-item :label="$t('apps.standardMgr.manualFixTargetDoc')">
            <el-select
              v-model="fixForm.target_standard_id"
              filterable
              clearable
              style="width: 100%"
              :placeholder="$t('apps.standardMgr.createAnchorTargetStandardPlaceholder')"
              @change="onTargetStandardChange"
            >
              <el-option
                v-for="std in store.standards"
                :key="std.id"
                :label="`${std.standard_code} ${std.standard_name}`"
                :value="std.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('apps.standardMgr.manualFixTargetRevision')">
            <el-select
              v-model="fixForm.target_revision_id"
              style="width: 100%"
              :disabled="!fixForm.target_standard_id || revisions.length === 0"
              :placeholder="$t('apps.standardMgr.createAnchorTargetRevisionPlaceholder')"
              @change="onTargetRevisionChange"
            >
              <el-option
                v-for="rev in revisions"
                :key="rev.id"
                :label="rev.revision_label || rev.id"
                :value="rev.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('apps.standardMgr.manualFixTargetOutline')">
            <el-select
              v-model="fixForm.target_outline_id"
              filterable
              clearable
              style="width: 100%"
              :disabled="!fixForm.target_standard_id || !targetRevisionIsCurrent || targetSections.length === 0"
              :placeholder="$t('apps.standardMgr.manualFixTargetOutlinePlaceholder')"
            >
              <el-option
                v-for="section in targetSections"
                :key="section.outline_id"
                :label="`${section.seq}. ${section.title}`"
                :value="section.outline_id"
              />
            </el-select>
            <div v-if="fixForm.target_revision_id && !targetRevisionIsCurrent" class="sm-fix-hint">
              {{ $t('apps.standardMgr.manualFixTargetOutlineCurrentOnlyHint') }}
            </div>
          </el-form-item>
        </template>

        <el-form-item :label="$t('apps.standardMgr.manualFixNote')">
          <el-input
            v-model="fixForm.status_reason"
            type="textarea"
            :rows="2"
            :placeholder="$t('apps.standardMgr.placeholderFixReason')"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="$emit('close')">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleSubmit">
        {{ $t('apps.standardMgr.manualFixSubmit') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useStandardMgrStore } from '../stores/standardMgr'
import { useToastStore } from '@/stores/toast'
import { i18n } from '@/i18n'
import { getDocumentRevisions, listAnchoredSections, type AnchoredSection, type DocumentRevision } from '../api/standard-mgr'
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
const dialogVisible = ref(true)
const revisions = ref<DocumentRevision[]>([])
const targetSections = ref<AnchoredSection[]>([])
let targetRequestToken = 0

const fixForm = reactive({
  status: (props.anchor.status === 'invalid' ? 'invalid' : 'valid') as 'valid' | 'invalid',
  target_standard_id: null as string | null,
  target_revision_id: null as string | null,
  target_outline_id: null as string | null,
  status_reason: '',
})

const selectedTargetStandard = computed(() => {
  return store.standards.find(std => std.id === fixForm.target_standard_id) || null
})

const targetRevisionIsCurrent = computed(() => {
  const currentRevision = revisions.value.find(revision => revision.is_current)
  return !!fixForm.target_revision_id && fixForm.target_revision_id === currentRevision?.id
})

const canSubmit = computed(() => {
  if (fixForm.status !== 'valid') return true
  return !!selectedTargetStandard.value?.document_id && !!fixForm.target_revision_id
})

async function onTargetStandardChange(stdId: string | null) {
  const requestToken = ++targetRequestToken
  fixForm.target_revision_id = null
  fixForm.target_outline_id = null
  revisions.value = []
  targetSections.value = []
  if (!stdId) return

  const std = store.standards.find(item => item.id === stdId)
  if (!std?.document_id) return

  const [revisionsResult, sectionsResult] = await Promise.allSettled([
    getDocumentRevisions(std.document_id),
    listAnchoredSections(std.id),
  ])
  if (requestToken !== targetRequestToken) return

  if (revisionsResult.status === 'rejected') {
    useToastStore().error(
      revisionsResult.reason instanceof Error
        ? revisionsResult.reason.message
        : i18n.global.t('apps.standardMgr.loadRevisionsFailed'),
    )
  } else {
    revisions.value = revisionsResult.value
    const current = revisions.value.find(revision => revision.is_current)
    fixForm.target_revision_id = current?.id ?? revisions.value[0]?.id ?? null

    if (sectionsResult.status === 'fulfilled' && current?.id === fixForm.target_revision_id) {
      targetSections.value = sectionsResult.value
    }
  }

  if (sectionsResult.status === 'rejected') {
    useToastStore().error(
      sectionsResult.reason instanceof Error
        ? sectionsResult.reason.message
        : i18n.global.t('apps.standardMgr.loadAnchorsFailed'),
    )
  }
}

async function onTargetRevisionChange(revisionId: string | null) {
  const requestToken = ++targetRequestToken
  fixForm.target_outline_id = null
  targetSections.value = []

  if (!revisionId || !fixForm.target_standard_id || !targetRevisionIsCurrent.value) return

  const std = store.standards.find(item => item.id === fixForm.target_standard_id)
  if (!std) return

  try {
    const sections = await listAnchoredSections(std.id)
    if (requestToken !== targetRequestToken || fixForm.target_revision_id !== revisionId) return
    targetSections.value = sections
  } catch (err: unknown) {
    if (requestToken !== targetRequestToken) return
    useToastStore().error(err instanceof Error ? err.message : i18n.global.t('apps.standardMgr.loadAnchorsFailed'))
  }
}

async function handleSubmit() {
  if (!canSubmit.value) return
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
      target_document_id: fixForm.status === 'valid' ? selectedTargetStandard.value?.document_id || undefined : undefined,
      target_revision_id: fixForm.status === 'valid' ? fixForm.target_revision_id || undefined : undefined,
      target_outline_id: fixForm.status === 'valid' ? fixForm.target_outline_id || undefined : undefined,
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
    valid: 'apps.standardMgr.anchorValid',
    suspected: 'apps.standardMgr.anchorSuspected',
    gap: 'apps.standardMgr.anchorGap',
    invalid: 'apps.standardMgr.anchorInvalid',
  }
  return map[status] || status
}
</script>

<style scoped>
.sm-fix-form {
  padding: 4px;
}

.sm-fix-hint {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
