<template>
  <div class="sm-detail-view">
    <!-- 标题区 -->
    <div v-if="standard" class="sm-detail-header">
      <h2>{{ standard.standard_code }}</h2>
      <p>{{ standard.standard_name }}</p>
      <div class="sm-detail-meta">
        <el-tag :type="statusTagType(standard.anchor_build_status)" size="small">
          {{ $t('apps.standardMgr.' + statusLabelKey(standard.anchor_build_status)) }}
        </el-tag>
        <span class="sm-counts">
          {{ $t('apps.standardMgr.anchorValid') }} {{ standard.valid_reference_count }} |
          {{ $t('apps.standardMgr.anchorSuspected') }} {{ standard.suspected_reference_count }} |
          {{ $t('apps.standardMgr.anchorGap') }} {{ standard.gap_reference_count }} |
          {{ $t('apps.standardMgr.anchorInvalid') }} {{ standard.invalid_reference_count }}
        </span>
      </div>
      <div class="sm-detail-actions">
        <el-button
          type="primary"
          size="small"
          :loading="rebuildLoading"
          :disabled="standard.anchor_build_status === 'processing'"
          @click="$emit('rebuild')"
        >
          {{ rebuildLoading ? $t('apps.standardMgr.rebuilding') : rebuildLabel }}
        </el-button>
        <!-- R19-2: 基础信息（查看 + 编辑） -->
        <el-button size="small" @click="openBasicInfoDialog">
          {{ $t('apps.standardMgr.basicInfo') }}
        </el-button>
        <!-- R19: 删除标准（最右侧） -->
        <el-button
          type="danger"
          plain
          size="small"
          :disabled="standard.anchor_build_status === 'processing'"
          @click="showDeleteDialog = true"
        >
          {{ $t('apps.standardMgr.deleteStandard') }}
        </el-button>
        <span v-if="rebuildError" class="sm-rebuild-error">{{ rebuildError }}</span>
      </div>
    </div>

    <!-- R19: 删除确认对话框 -->
    <el-dialog
      v-if="standard"
      v-model="showDeleteDialog"
      :title="$t('apps.standardMgr.deleteConfirmTitle')"
      width="440px"
    >
      <p class="sm-delete-warning">
        {{ $t('apps.standardMgr.deleteConfirmMessage') }}
      </p>
      <template #footer>
        <el-button @click="showDeleteDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="danger" :loading="deleting" @click="handleDeleteStandard">
          {{ $t('apps.standardMgr.deleteStandard') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- R19-2: 基础信息对话框（查看模式 → 点击编辑切换为表单） -->
    <el-dialog
      v-if="standard"
      v-model="showEditDialog"
      :title="$t('apps.standardMgr.basicInfoTitle')"
      width="520px"
      destroy-on-close
      @open="resetBasicInfoDialog"
    >
      <!-- 查看模式 -->
      <template v-if="!editingBasicInfo">
        <el-descriptions :column="1" border>
          <el-descriptions-item :label="$t('apps.standardMgr.typeLabel')">
            {{ typeLabelOf(standard.standard_type) }}
          </el-descriptions-item>
          <el-descriptions-item :label="$t('apps.standardMgr.codeLabel')">
            {{ standard.standard_code }}
          </el-descriptions-item>
          <el-descriptions-item :label="$t('apps.standardMgr.nameLabel')">
            {{ standard.standard_name }}
          </el-descriptions-item>
          <el-descriptions-item :label="$t('apps.standardMgr.enterpriseLabel')">
            {{ enterpriseNameOf(standard.enterprise_id) || '—' }}
          </el-descriptions-item>
          <el-descriptions-item :label="$t('apps.standardMgr.docIdLabel')">
            <code class="sm-id-mono">{{ standard.document_id || '—' }}</code>
          </el-descriptions-item>
          <el-descriptions-item :label="$t('apps.standardMgr.versionNoLabel')">
            <template v-if="standard.current_revision_label || standard.current_revision_id">
              <span v-if="standard.current_revision_label" class="sm-revision-label">{{ standard.current_revision_label }}</span>
              <code class="sm-id-mono">{{ standard.current_revision_id || '—' }}</code>
            </template>
            <template v-else>—</template>
          </el-descriptions-item>
        </el-descriptions>
      </template>

      <!-- 编辑模式 -->
      <el-form v-else label-width="100px" @submit.prevent="handleSaveMetadata">
        <el-form-item :label="$t('apps.standardMgr.typeLabel')">
          <el-select v-model="editForm.standard_type" style="width: 100%">
            <el-option
              v-for="opt in standardTypeOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('apps.standardMgr.codeLabel')">
          <el-input v-model="editForm.standard_code" />
        </el-form-item>
        <el-form-item :label="$t('apps.standardMgr.nameLabel')">
          <el-input v-model="editForm.standard_name" />
        </el-form-item>
        <el-form-item :label="$t('apps.standardMgr.enterpriseLabel')">
          <el-select
            v-model="editForm.enterprise_id"
            style="width: 100%"
            clearable
            :placeholder="$t('apps.standardMgr.selectEnterprisePlaceholder')"
          >
            <el-option
              v-for="ent in enterprises"
              :key="ent.id"
              :label="ent.name"
              :value="ent.id"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <!-- 查看模式：编辑 / 关闭 -->
        <template v-if="!editingBasicInfo">
          <el-button type="primary" @click="editingBasicInfo = true">
            {{ $t('apps.standardMgr.editBasicInfo') }}
          </el-button>
          <el-button @click="showEditDialog = false">{{ $t('common.close') }}</el-button>
        </template>
        <!-- 编辑模式：保存 / 取消 -->
        <template v-else>
          <el-button @click="editingBasicInfo = false">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" @click="handleSaveMetadata">{{ $t('common.save') }}</el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 加载中 -->
    <div v-if="!standard" class="sm-detail-loading">
      <el-skeleton :rows="8" animated />
    </div>

    <!-- 正文内容（standard 非空时渲染） -->
    <div
      v-else
      class="sm-detail-content"
      :class="{ 'sm-picking': picking }"
      @mouseup="handleBodyMouseUp"
    >
      <!-- 框选模式提示条 -->
      <div v-if="picking" class="sm-pick-hint" @click.stop>
        <el-icon class="sm-pick-icon"><Pointer /></el-icon>
        <span>{{ $t('apps.standardMgr.createAnchorPickHint') }}</span>
        <el-button size="small" text @click="$emit('cancelPick')">
          {{ $t('apps.standardMgr.cancelPick') }}
        </el-button>
      </div>

      <div v-if="sections.length === 0" class="sm-no-sections">
        <el-empty :description="$t('apps.standardMgr.notCleaned')" :image-size="80">
          <template v-if="standard.anchor_build_status === 'pending'">
            {{ $t('apps.standardMgr.notCleanedHint') }}
          </template>
        </el-empty>
      </div>

      <div v-for="section in sectionsWithAnchors" :key="section.outline_id" class="sm-section-block" :data-outline-id="section.outline_id">
        <div class="sm-section-title" v-if="section.title">
          <span class="sm-section-seq">{{ section.seq }}.</span>
          {{ section.title }}
          <el-tag v-if="section.has_anchored" size="small" type="success" class="sm-section-tag">
            {{ $t('apps.standardMgr.sectionAnchorCount', { n: section.anchor_count }) }}
          </el-tag>
          <el-tag v-else size="small" type="info" class="sm-section-tag">{{ $t('apps.standardMgr.noAnchors') }}</el-tag>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          class="sm-section-text markdown-body"
          v-html="section.renderedHtml"
          @click="handleTextClick"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { Pointer } from '@element-plus/icons-vue'
import { useMarkdownFormatter } from '@/composables/useMarkdownFormatter'
import { renderAnchoredText } from '../utils/anchor-render'
import type { StandardItem, AnchoredSection, RefAnchor, AnchorBuildStatus, StandardType, EnterpriseItem } from '../api/standard-mgr'
import { i18n } from '@/i18n'

const props = defineProps<{
  standard: StandardItem | null
  sections: AnchoredSection[]
  anchors: RefAnchor[]
  anchorStatusMap: Map<string, string>
  selectedAnchorId: string | null
  rebuildLoading: boolean
  rebuildError: string | null
  /** R11-5: 企业列表（用于编辑元数据时选择企业） */
  enterprises?: EnterpriseItem[]
  /** R21: 框选模式——正文中划选文字创建锚点 */
  picking?: boolean
}>()

const emit = defineEmits<{
  anchorClick: [anchorId: string]
  rebuild: []
  selectAnchor: [anchorId: string]
  /** R11-5: 元数据更新 */
  editMetadata: [standardId: string, data: {
    standard_type?: StandardType
    standard_code?: string
    standard_name?: string
    enterprise_id?: string | null
  }]
  /** R19: 删除标准 */
  deleteStandard: [standardId: string]
  /** R21: 框选完成——把选中文字 + 所在章节交给父级 */
  pick: [{ source_text: string; outline_id: string }]
  /** R21: 取消框选 */
  cancelPick: []
}>()

// ---- R21: 框选模式 ----
function handleBodyMouseUp(e: MouseEvent) {
  if (!props.picking) return
  const sel = window.getSelection()
  const text = (sel?.toString() || '').trim()
  if (!text) return
  // 定位所在章节：从选区锚点向上找 data-outline-id
  const anchorNode = sel?.anchorNode as Node | null
  const sectionEl = findOutlineElement(anchorNode)
  const outlineId = sectionEl?.dataset?.outlineId
  if (!sectionEl || !outlineId) return
  // 防止跨章节选择：focusNode 也在同一章节才接受
  const focusNode = sel?.focusNode as Node | null
  const focusSectionEl = findOutlineElement(focusNode)
  if (!focusSectionEl || focusSectionEl.dataset.outlineId !== outlineId) return
  emit('pick', { source_text: text, outline_id: outlineId })
  window.getSelection()?.removeAllRanges()
}

function findOutlineElement(node: Node | null): HTMLElement | null {
  let el = node?.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node?.parentElement || null
  while (el && el !== document.body) {
    if (el.dataset?.outlineId) return el
    el = el.parentElement
  }
  return null
}


// ---- R19: 删除标准 ----
const showDeleteDialog = ref(false)
const deleting = ref(false)

async function handleDeleteStandard() {
  if (!props.standard) return
  deleting.value = true
  try {
    emit('deleteStandard', props.standard.id)
    showDeleteDialog.value = false
  } finally {
    deleting.value = false
  }
}

// ---- R19-2: 基础信息（查看 + 编辑） ----
const showEditDialog = ref(false)
const editingBasicInfo = ref(false)
const editForm = reactive<{
  standard_type: StandardType
  standard_code: string
  standard_name: string
  enterprise_id: string | null
}>({
  standard_type: '' as StandardType,
  standard_code: '',
  standard_name: '',
  enterprise_id: null,
})

const standardTypeOptions = [
  { value: 'national' as StandardType, label: i18n.global.t('apps.standardMgr.treeNational') },
  { value: 'industry' as StandardType, label: i18n.global.t('apps.standardMgr.treeIndustry') },
  { value: 'enterprise' as StandardType, label: i18n.global.t('apps.standardMgr.treeEnterprise') },
  { value: 'international' as StandardType, label: i18n.global.t('apps.standardMgr.treeInternational') },
]

/** 标准类型 → 显示名 */
function typeLabelOf(type: StandardType | '' | undefined): string {
  const opt = standardTypeOptions.find(o => o.value === type)
  return opt ? opt.label : (type || '—')
}

/** 企业 ID → 企业名 */
function enterpriseNameOf(id: string | null | undefined): string {
  if (!id) return ''
  const ent = props.enterprises?.find(e => e.id === id)
  return ent ? ent.name : ''
}

function openBasicInfoDialog() {
  if (!props.standard) return
  showEditDialog.value = true
}

function resetBasicInfoDialog() {
  if (!props.standard) return
  editingBasicInfo.value = false
  editForm.standard_type = props.standard.standard_type || ''
  editForm.standard_code = props.standard.standard_code
  editForm.standard_name = props.standard.standard_name
  editForm.enterprise_id = props.standard.enterprise_id
}

function handleSaveMetadata() {
  if (!props.standard) return
  emit('editMetadata', props.standard.id, {
    standard_type: editForm.standard_type || undefined,
    standard_code: editForm.standard_code,
    standard_name: editForm.standard_name,
    enterprise_id: editForm.enterprise_id,
  })
  showEditDialog.value = false
}

const markdownFormatter = useMarkdownFormatter()

/** 将副本数据与锚点状态结合，生成渲染后的 HTML */
const sectionsWithAnchors = computed(() => {
  return props.sections.map(section => {
    // 使用 anchored_text（如有锚点副本）或 original_text（无锚点原文）
    const text = section.has_anchored ? section.anchored_text : section.original_text
    const anchoredHtml = renderAnchoredText(text, props.anchorStatusMap)
    const formatted = markdownFormatter.formatMessage(anchoredHtml, `sm-${section.outline_id}`)
    return {
      ...section,
      renderedHtml: formatted,
    }
  })
})

function handleTextClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const anchorEl = target.closest('[data-anchor-id]')
  if (anchorEl) {
    const anchorId = anchorEl.getAttribute('data-anchor-id')
    if (anchorId) {
      // 触发选择事件（联动右侧面板和滚动定位）
      const el = document.querySelector(`[data-anchor-id="${anchorId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('anchor-highlight')
        setTimeout(() => el.classList.remove('anchor-highlight'), 2000)
      }
    }
  }
}

function statusTagType(status: AnchorBuildStatus): 'success' | 'warning' | 'danger' | 'info' | '' {
  const map: Record<AnchorBuildStatus, 'success' | 'warning' | 'danger' | 'info' | ''> = {
    pending: 'info',
    processing: 'warning',
    done: 'success',
    error: 'danger',
  }
  return map[status] || 'info'
}

function statusLabelKey(status: AnchorBuildStatus): string {
  const map: Record<AnchorBuildStatus, string> = {
    pending: 'statusPending',
    processing: 'statusProcessing',
    done: 'statusDone',
    error: 'statusError',
  }
  return map[status] || status
}

/** 按钮文字：待清洗→开始清洗，已完成/失败→重新清洗 */
const rebuildLabel = computed(() => {
  if (!props.standard) return ''
  return props.standard.anchor_build_status === 'pending'
    ? i18n.global.t('apps.standardMgr.rebuild')
    : i18n.global.t('apps.standardMgr.rebuildAgain')
})
</script>

<style scoped>
.sm-detail-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sm-detail-header {
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 12px;
}

.sm-detail-header h2 {
  margin: 0 0 4px;
  font-size: 18px;
  color: #303133;
}

.sm-detail-header p {
  margin: 0 0 8px;
  font-size: 14px;
  color: #606266;
}

.sm-detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.sm-counts {
  font-size: 12px;
  color: #909399;
}

.sm-detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sm-rebuild-error {
  font-size: 12px;
  color: #f56c6c;
}

.sm-detail-loading {
  padding: 20px;
}

.sm-detail-content {
  flex: 1;
  overflow-y: auto;
}

/* R21: 框选模式 */
.sm-pick-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border: 1px dashed #2563eb;
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 13px;
}
.sm-pick-icon {
  font-size: 16px;
}
.sm-picking .sm-section-block {
  cursor: crosshair;
}
.sm-picking .sm-section-block:hover {
  outline: 1px dashed #2563eb;
  outline-offset: 2px;
}

.sm-no-sections {
  padding: 40px 0;
}

.sm-section-block {
  margin-bottom: 24px;
}

.sm-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sm-section-seq {
  color: #909399;
  font-weight: 400;
  font-size: 12px;
}

.sm-section-tag {
  margin-left: 4px;
}

.sm-section-text {
  font-size: 14px;
  line-height: 1.8;
  color: #303133;
}
</style>
