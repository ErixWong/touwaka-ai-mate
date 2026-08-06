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
          {{ rebuildLoading ? $t('apps.standardMgr.rebuilding') : $t('apps.standardMgr.rebuildAnchorCopy') }}
        </el-button>
        <!-- R11-5: 编辑元数据 -->
        <el-button size="small" @click="openEditDialog">
          {{ $t('apps.standardMgr.editMetadata') }}
        </el-button>
        <span v-if="rebuildError" class="sm-rebuild-error">{{ rebuildError }}</span>
      </div>
    </div>

    <!-- R11-5: 元数据编辑对话框 -->
    <el-dialog
      v-if="standard"
      v-model="showEditDialog"
      :title="$t('apps.standardMgr.editMetadataTitle')"
      width="480px"
      destroy-on-close
    >
      <el-form label-width="100px" @submit.prevent="handleSaveMetadata">
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
        <el-button @click="showEditDialog = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="handleSaveMetadata">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 加载中 -->
    <div v-if="!standard" class="sm-detail-loading">
      <el-skeleton :rows="8" animated />
    </div>

    <!-- 正文内容 -->
    <div v-else class="sm-detail-content">
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
}>()

// ---- R11-5: 元数据编辑 ----
const showEditDialog = ref(false)
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

function openEditDialog() {
  if (!props.standard) return
  editForm.standard_type = props.standard.standard_type || ''
  editForm.standard_code = props.standard.standard_code
  editForm.standard_name = props.standard.standard_name
  editForm.enterprise_id = props.standard.enterprise_id
  showEditDialog.value = true
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
