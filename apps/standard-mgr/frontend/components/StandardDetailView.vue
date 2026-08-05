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
        <span v-if="rebuildError" class="sm-rebuild-error">{{ rebuildError }}</span>
      </div>
    </div>

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
import { computed } from 'vue'
import { useMarkdownFormatter } from '@/composables/useMarkdownFormatter'
import { renderAnchoredText } from '../utils/anchor-render'
import type { StandardItem, AnchoredSection, RefAnchor, AnchorBuildStatus } from '../api/standard-mgr'

const props = defineProps<{
  standard: StandardItem | null
  sections: AnchoredSection[]
  anchors: RefAnchor[]
  anchorStatusMap: Map<string, string>
  selectedAnchorId: string | null
  rebuildLoading: boolean
  rebuildError: string | null
}>()

defineEmits<{
  anchorClick: [anchorId: string]
  rebuild: []
  selectAnchor: [anchorId: string]
}>()

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
