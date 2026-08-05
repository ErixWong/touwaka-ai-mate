<template>
  <div class="sm-anchor-panel">
    <div class="sm-anchor-header">
      <h3>{{ $t('apps.standardMgr.anchors') }}</h3>
      <span class="sm-anchor-count">{{ $t('apps.standardMgr.anchorsCount', { count: anchors.length }) }}</span>
      <el-button-group class="sm-toggle-all">
        <el-button size="small" @click="collapseAll">{{ $t('apps.standardMgr.collapseAll') }}</el-button>
        <el-button size="small" @click="expandAll">{{ $t('apps.standardMgr.expandAll') }}</el-button>
      </el-button-group>
    </div>

    <div v-if="sections.length === 0 && anchors.length === 0" class="sm-anchor-empty">
      <el-empty :description="$t('apps.standardMgr.noAnchors')" :image-size="60" />
    </div>

    <!-- R8-2: 全量章节目录树 -->
    <div v-else class="sm-anchor-tree">
      <div v-for="section in sortedSections" :key="section.outline_id" class="sm-tree-chapter">
        <div class="sm-tree-chapter-header" @click="toggleChapter(section.outline_id)">
          <el-icon class="sm-tree-arrow" :class="{ expanded: expandedChapters.has(section.outline_id) }">
            <ArrowRight />
          </el-icon>
          <span class="sm-tree-chapter-title">{{ section.title || `${section.seq}` }}</span>
          <el-tag v-if="getSectionAnchorCount(section.outline_id) > 0" size="small" type="info" class="sm-tree-chapter-badge">
            {{ getSectionAnchorCount(section.outline_id) }}
          </el-tag>
        </div>

        <div v-show="expandedChapters.has(section.outline_id)" class="sm-tree-chapter-body">
          <!-- 无锚点章节 -->
          <div v-if="getSectionAnchors(section.outline_id).length === 0" class="sm-tree-empty-chapter">
            {{ $t('apps.standardMgr.chapterEmpty') }}
          </div>

          <!-- 锚点条目 -->
          <div
            v-for="anchor in getSectionAnchors(section.outline_id)"
            :key="anchor.id"
            class="sm-tree-anchor-item"
            :class="{
              active: anchor.id === selectedAnchorId,
              'status-valid': anchor.status === 'valid',
              'status-gap': anchor.status === 'gap',
              'status-suspected': anchor.status === 'suspected',
              'status-invalid': anchor.status === 'invalid',
            }"
          >
            <div class="sm-tree-anchor-top">
              <el-tag :type="anchorStatusTag(anchor.status)" size="small">
                {{ $t(anchorStatusLabel(anchor.status)) }}
              </el-tag>
              <span class="sm-tree-anchor-text">{{ anchor.source_text?.slice(0, 60) }}{{ (anchor.source_text?.length || 0) > 60 ? '...' : '' }}</span>
            </div>
            <div class="sm-tree-anchor-actions">
              <el-tooltip
                v-if="!hasMarker(anchor)"
                :content="$t('apps.standardMgr.anchorNoMarker')"
                placement="top"
              >
                <el-button size="small" disabled>
                  {{ $t('apps.standardMgr.jumpToAnchor') }}
                </el-button>
              </el-tooltip>
              <el-button
                v-else
                size="small"
                type="primary"
                link
                @click.stop="handleJump(anchor)"
              >
                {{ $t('apps.standardMgr.jumpToAnchor') }}
              </el-button>
              <el-button
                size="small"
                link
                @click.stop="openDetail(anchor)"
              >
                {{ $t('apps.standardMgr.detailView') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- R8-2: 锚点详情弹窗 -->
    <el-dialog
      v-if="detailAnchor"
      :model-value="true"
      :title="$t('apps.standardMgr.detailView')"
      width="550px"
      @update:model-value="detailAnchor = null"
    >
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item :label="$t('apps.standardMgr.manualFixSourceText')" :span="2">
          {{ detailAnchor.source_text }}
        </el-descriptions-item>
        <el-descriptions-item :label="$t('apps.standardMgr.manualFixCurrentStatus')">
          <el-tag :type="anchorStatusTag(detailAnchor.status)" size="small">
            {{ $t(anchorStatusLabel(detailAnchor.status)) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="来源">{{ detailAnchor.source }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ detailAnchor.ref_type }}</el-descriptions-item>
        <el-descriptions-item label="重试次数">{{ detailAnchor.retry_count }}</el-descriptions-item>
        <el-descriptions-item v-if="detailAnchor.status_reason" :label="$t('apps.standardMgr.manualFixReason')" :span="2">
          {{ detailAnchor.status_reason }}
        </el-descriptions-item>
        <el-descriptions-item v-if="detailAnchor.target_document_id" label="目标文档">
          {{ detailAnchor.target_document_id?.slice(0, 12) }}...
        </el-descriptions-item>
        <el-descriptions-item v-if="detailAnchor.target_revision_id" label="目标版本">
          {{ detailAnchor.target_revision_id?.slice(0, 12) }}...
        </el-descriptions-item>
        <el-descriptions-item v-if="detailAnchor.context_text" :label="$t('apps.standardMgr.manualFixTargetDoc')" :span="2">
          <span class="sm-context-text">{{ detailAnchor.context_text }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <template #footer>
        <el-button @click="detailAnchor = null">{{ $t('common.close') }}</el-button>
        <el-button
          v-if="detailAnchor.status === 'gap'"
          type="primary"
          @click="handleFixFromDetail"
        >
          {{ $t('apps.standardMgr.fixAction') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import type { RefAnchor, RefStatus, AnchoredSection } from '../api/standard-mgr'

const props = defineProps<{
  anchors: RefAnchor[]
  selectedAnchorId: string | null
  standardId: string | null
  /** R8-2: 全量章节（含无锚点章节） */
  sections: AnchoredSection[]
}>()

const emit = defineEmits<{
  anchorClick: [anchorId: string]
  jumpToAnchor: [anchorId: string]
  fixAnchor: [anchor: RefAnchor]
}>()

// ==================== 展开/收起 ====================

const expandedChapters = ref(new Set<string>())

// 初始化展开所有含锚点章节
const initExpand = () => {
  const anchorOutlineIds = new Set(props.anchors.map(a => a.source_outline_id))
  expandedChapters.value = new Set(anchorOutlineIds)
}
initExpand()

function toggleChapter(outlineId: string) {
  if (expandedChapters.value.has(outlineId)) {
    expandedChapters.value.delete(outlineId)
  } else {
    expandedChapters.value.add(outlineId)
  }
}

function collapseAll() { expandedChapters.value = new Set() }
function expandAll() {
  expandedChapters.value = new Set(props.sections.map(s => s.outline_id))
}

// ==================== 章节排序 ====================

/** R8-2: 全量章节按 seq 升序 */
const sortedSections = computed(() => {
  return [...props.sections].sort((a, b) => a.seq - b.seq)
})

// ==================== 锚点分组 ====================

/** 按 outline_id 分组的锚点 */
const anchorsByOutline = computed(() => {
  const map: Record<string, RefAnchor[]> = {}
  for (const a of props.anchors) {
    const key = a.source_outline_id
    if (!map[key]) map[key] = []
    map[key].push(a)
  }
  return map
})

function getSectionAnchors(outlineId: string): RefAnchor[] {
  return anchorsByOutline.value[outlineId] || []
}

function getSectionAnchorCount(outlineId: string): number {
  return getSectionAnchors(outlineId).length
}

// ==================== 标记检测 ====================

/** 检查锚点在副本中是否有 marker */
function hasMarker(anchor: RefAnchor): boolean {
  if (!anchor.source_outline_id) return false
  const section = props.sections.find(s => s.outline_id === anchor.source_outline_id)
  if (!section || !section.anchored_text) return false
  return section.anchored_text.includes(`data-anchor-id="${anchor.id}"`)
}

// ==================== 跳转 ====================

function handleJump(anchor: RefAnchor) {
  emit('jumpToAnchor', anchor.id)
}

// ==================== 详情弹窗 ====================

const detailAnchor = ref<RefAnchor | null>(null)

function openDetail(anchor: RefAnchor) {
  detailAnchor.value = anchor
}

function handleFixFromDetail() {
  if (detailAnchor.value) {
    emit('fixAnchor', detailAnchor.value)
    detailAnchor.value = null
  }
}

// ==================== 状态工具 ====================

function anchorStatusTag(status: RefStatus): 'success' | 'warning' | 'danger' | 'info' | '' {
  const map: Record<RefStatus, 'success' | 'warning' | 'danger' | 'info' | ''> = {
    valid: 'success', suspected: 'warning', gap: 'danger', invalid: 'info',
  }
  return map[status] || ''
}

function anchorStatusLabel(status: RefStatus): string {
  const map: Record<RefStatus, string> = {
    valid: 'apps.standardMgr.anchorValid',
    suspected: 'apps.standardMgr.anchorSuspected',
    gap: 'apps.standardMgr.anchorGap',
    invalid: 'apps.standardMgr.anchorInvalid',
  }
  return map[status] || 'apps.standardMgr.anchorInvalid'
}
</script>

<style scoped>
.sm-anchor-panel { padding: 12px; }
.sm-anchor-header {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; flex-wrap: wrap;
}
.sm-anchor-header h3 { margin: 0; font-size: 16px; }
.sm-anchor-count { color: #909399; font-size: 13px; }
.sm-toggle-all { margin-left: auto; }
.sm-anchor-empty { padding: 20px 0; }

.sm-anchor-tree { max-height: calc(100vh - 200px); overflow-y: auto; }

.sm-tree-chapter { margin-bottom: 2px; }
.sm-tree-chapter-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 6px; cursor: pointer; border-radius: 4px;
  background: #f5f7fa; transition: background .2s;
}
.sm-tree-chapter-header:hover { background: #e8eaed; }
.sm-tree-arrow { transition: transform .2s; font-size: 12px; }
.sm-tree-arrow.expanded { transform: rotate(90deg); }
.sm-tree-chapter-title { font-weight: 600; font-size: 13px; flex: 1; }
.sm-tree-chapter-badge { flex-shrink: 0; }
.sm-tree-chapter-body { padding-left: 8px; }

.sm-tree-empty-chapter {
  padding: 8px 12px; color: #c0c4cc; font-size: 12px; font-style: italic;
}

.sm-tree-anchor-item {
  padding: 8px 10px; margin: 4px 0; border-radius: 4px;
  border-left: 3px solid #dcdfe6; background: #fff;
  transition: border-color .2s;
}
.sm-tree-anchor-item:hover { background: #f5f7fa; }
.sm-tree-anchor-item.active { background: #ecf5ff; }
.sm-tree-anchor-item.status-valid { border-left-color: #67c23a; }
.sm-tree-anchor-item.status-gap { border-left-color: #f56c6c; }
.sm-tree-anchor-item.status-suspected { border-left-color: #e6a23c; }
.sm-tree-anchor-item.status-invalid { border-left-color: #909399; }

.sm-tree-anchor-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.sm-tree-anchor-text { font-size: 13px; color: #303133; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sm-tree-anchor-actions { display: flex; gap: 4px; }

.sm-context-text { font-size: 12px; color: #606266; white-space: pre-wrap; max-height: 120px; overflow-y: auto; }
</style>
