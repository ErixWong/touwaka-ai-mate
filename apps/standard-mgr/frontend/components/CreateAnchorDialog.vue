<template>
  <el-dialog
    :title="$t('apps.standardMgr.createAnchorTitle')"
    :model-value="true"
    width="620px"
    :close-on-click-modal="false"
    @close="$emit('close')"
    @update:model-value="(val: boolean) => { if (!val) $emit('close') }"
  >
    <div class="sm-create-form">
      <!-- 1. 引用原文片段 -->
      <el-form-item :label="$t('apps.standardMgr.createAnchorSourceText')" required>
        <div class="sm-create-source-row">
          <el-input
            v-model="sourceText"
            :placeholder="$t('apps.standardMgr.createAnchorSourcePlaceholder')"
            @input="onSourceTextInput"
          />
          <el-button @click="$emit('pick')">{{ $t('apps.standardMgr.createAnchorPickBtn') }}</el-button>
        </div>
        <div v-if="sourceMsg" class="sm-create-source-msg" :class="{ error: !sourceValid }">
          {{ sourceMsg }}
        </div>
      </el-form-item>

      <!-- 2. 所在章节 -->
      <el-form-item :label="$t('apps.standardMgr.createAnchorSection')" required>
        <el-select
          v-model="sectionId"
          filterable
          style="width: 100%"
          :placeholder="$t('apps.standardMgr.createAnchorSectionPlaceholder')"
          @change="onSectionChange"
        >
          <el-option
            v-for="sec in sections"
            :key="sec.outline_id"
            :label="`${sec.seq}. ${sec.title}`"
            :value="sec.outline_id"
          />
        </el-select>
        <div v-if="pickSectionId" class="sm-create-pick-hint">
          {{ $t('apps.standardMgr.createAnchorPickSectionHint') }}
        </div>
      </el-form-item>

      <!-- 3. 搜索目标标准（可选，不选则为 gap） -->
      <el-form-item :label="$t('apps.standardMgr.createAnchorTargetStandard')">
        <el-select
          v-model="targetStandardId"
          filterable
          clearable
          style="width: 100%"
          :placeholder="$t('apps.standardMgr.createAnchorTargetStandardPlaceholder')"
          @change="onTargetStandardChange"
        >
          <el-option
            v-for="std in standardOptions"
            :key="std.id"
            :label="`${std.standard_code} ${std.standard_name}`"
            :value="std.id"
          />
        </el-select>
      </el-form-item>

      <!-- 4. 选择目标版本 -->
      <el-form-item :label="$t('apps.standardMgr.createAnchorTargetRevision')">
        <el-select
          v-model="targetRevisionId"
          style="width: 100%"
          :disabled="!targetStandardId || revisions.length === 0"
          :placeholder="$t('apps.standardMgr.createAnchorTargetRevisionPlaceholder')"
        >
          <el-option
            v-for="rev in revisions"
            :key="rev.id"
            :label="rev.revision_label || rev.id"
            :value="rev.id"
          />
        </el-select>
      </el-form-item>

      <!-- 5. 备注（可选） -->
      <el-form-item :label="$t('apps.standardMgr.createAnchorNote')">
        <el-input
          v-model="note"
          type="textarea"
          :rows="2"
          :placeholder="$t('apps.standardMgr.createAnchorNotePlaceholder')"
        />
      </el-form-item>

      <!-- 保存前提示 -->
      <div v-if="dupMsg" class="sm-create-dup-msg">
        {{ dupMsg }}
      </div>
    </div>

    <template #footer>
      <el-button @click="$emit('close')">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSave" @click="handleSubmit">
        {{ $t('apps.standardMgr.createAnchorSave') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useStandardMgrStore } from '../stores/standardMgr'
import { useToastStore } from '@/stores/toast'
import { i18n } from '@/i18n'
import { listStandards, getDocumentRevisions, writeAnchorResult, type RefAnchor, type AnchoredSection } from '../api/standard-mgr'
import type { DocumentRevision } from '../api/standard-mgr'

const props = defineProps<{
  standardId: string
  revisionId: string
  sections: AnchoredSection[]
  anchors: RefAnchor[]
  /** 框选预填：source_text + section_id */
  prefill?: { source_text?: string; section_id?: string } | null
}>()

const emit = defineEmits<{
  close: []
  /** 点击"选取"→ 交给父级进入框选模式 */
  pick: []
  created: []
}>()

const store = useStandardMgrStore()
const submitting = ref(false)

// ==================== 表单状态 ====================

const sourceText = ref(props.prefill?.source_text ?? '')
const sectionId = ref<string | null>(props.prefill?.section_id ?? null)
const pickSectionId = ref<string | null>(props.prefill?.section_id ?? null)
const targetStandardId = ref<string | null>(null)
const targetRevisionId = ref<string | null>(null)
const note = ref('')

/** 目标标准列表（从 store 已纳管标准 + 接口兜底） */
const standardOptions = ref<Array<{ id: string; standard_code: string; standard_name: string; document_id: string | null }>>([])
const revisions = ref<DocumentRevision[]>([])

/** 片段在正文中的出现校验结果 */
const sourceValid = ref(false)
const sourceMsg = ref('')

// ==================== 校验 ====================

const canSave = computed(() => {
  return sourceText.value.trim().length > 0 && !!sectionId.value
})

/** 重复锚点提示：同 revision + 同 section + 同 source_text */
const dupMsg = computed(() => {
  const txt = sourceText.value.trim()
  if (!txt || !sectionId.value) return ''
  const dup = props.anchors.some(a =>
    a.source_revision_id === props.revisionId &&
    a.source_outline_id === sectionId.value &&
    a.source_text === txt,
  )
  return dup ? i18n.global.t('apps.standardMgr.createAnchorDupHint') : ''
})

// ==================== 逻辑 ====================

function onSourceTextInput() {
  validateSourceText()
}

/** 校验片段在所选章节原文中存在（软提示，不阻断） */
function validateSourceText() {
  const txt = sourceText.value.trim()
  if (!txt || !sectionId.value) {
    sourceValid.value = false
    sourceMsg.value = ''
    return
  }
  const sec = props.sections.find(s => s.outline_id === sectionId.value)
  const haystack = sec?.original_text || ''
  if (haystack.includes(txt)) {
    sourceValid.value = true
    sourceMsg.value = ''
  } else {
    // 已选章节不包含 → 检查其他章节
    const other = props.sections.find(s => s.outline_id !== sectionId.value && (s.original_text || '').includes(txt))
    sourceValid.value = false
    sourceMsg.value = other
      ? i18n.global.t('apps.standardMgr.createAnchorSourceInOtherSection', { section: `${other.seq}. ${other.title}` })
      : i18n.global.t('apps.standardMgr.createAnchorSourceNotFound')
  }
}

function onSectionChange() {
  validateSourceText()
}

/** 目标标准变化 → 加载版本 */
async function onTargetStandardChange(stdId: string | null) {
  targetRevisionId.value = null
  revisions.value = []
  if (!stdId) return
  const std = standardOptions.value.find(s => s.id === stdId)
  if (!std?.document_id) return
  try {
    revisions.value = await getDocumentRevisions(std.document_id)
    const current = revisions.value.find(r => r.is_current)
    targetRevisionId.value = current?.id ?? revisions.value[0]?.id ?? null
  } catch {
    // 版本加载失败不阻断，可留空（后端 target_revision_id 允许 null）
  }
}

async function handleSubmit() {
  if (!canSave.value) return
  submitting.value = true
  try {
    const targetStd = standardOptions.value.find(s => s.id === targetStandardId.value)
    const hasTarget = !!targetStd && !!targetRevisionId.value
    await writeAnchorResult({
      standard_id: props.standardId,
      source_revision_id: props.revisionId,
      source_outline_id: sectionId.value!,
      occurrence_index: 0,
      source_text: sourceText.value.trim(),
      ref_type: hasTarget ? 'explicit' : 'implicit',
      status: hasTarget ? 'valid' : 'gap',
      source: 'manual',
      target_document_id: hasTarget ? targetStd.document_id || undefined : undefined,
      target_revision_id: hasTarget ? targetRevisionId.value || undefined : undefined,
      status_reason: note.value.trim() || i18n.global.t('apps.standardMgr.createAnchorDefaultNote'),
    })
    useToastStore().success(i18n.global.t('apps.standardMgr.createAnchorSuccess'))
    emit('created')
    emit('close')
  } catch (err: any) {
    useToastStore().error(err?.message || i18n.global.t('apps.standardMgr.createAnchorFailed'))
  } finally {
    submitting.value = false
  }
}

// ==================== 初始化 ====================

/** 目标标准列表：优先用 store 已纳管标准，缺失时从接口拉取 */
async function loadStandardOptions() {
  const fromStore = store.standards.map(s => ({
    id: s.id,
    standard_code: s.standard_code,
    standard_name: s.standard_name,
    document_id: s.document_id,
  }))
  if (fromStore.length > 0) {
    standardOptions.value = fromStore
    return
  }
  try {
    const list = await listStandards({})
    standardOptions.value = list.map(s => ({
      id: s.id,
      standard_code: s.standard_code,
      standard_name: s.standard_name,
      document_id: s.document_id,
    }))
  } catch {
    standardOptions.value = []
  }
}

watch(
  () => props.prefill,
  (prefill) => {
    if (prefill?.source_text) {
      sourceText.value = prefill.source_text
      validateSourceText()
    }
    if (prefill?.section_id) {
      sectionId.value = prefill.section_id
      pickSectionId.value = prefill.section_id
      validateSourceText()
    }
  },
  { immediate: true },
)

loadStandardOptions()
</script>

<style scoped>
.sm-create-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.sm-create-source-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.sm-create-source-msg {
  font-size: 12px;
  color: #16a34a;
  margin-top: 4px;
  line-height: 1.5;
}
.sm-create-source-msg.error {
  color: #ef4444;
}
.sm-create-pick-hint {
  font-size: 12px;
  color: #2563eb;
  margin-top: 4px;
}
.sm-create-dup-msg {
  margin-top: 4px;
  padding: 8px 12px;
  border-radius: 6px;
  background: #fefce8;
  color: #ca8a04;
  font-size: 12px;
}
</style>
