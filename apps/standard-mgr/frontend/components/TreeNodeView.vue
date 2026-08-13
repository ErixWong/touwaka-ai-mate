<template>
  <div class="sm-tree-node">
    <!-- 章节头：点击标题 → 跳转中间栏；点击箭头 → 仅展开/收起 -->
    <div
      class="sm-tree-chapter-header"
      :style="{ paddingLeft: `${depth * 14 + 6}px` }"
      @click.stop="handleHeaderClick"
    >
      <el-icon
        v-if="hasExpandable"
        class="sm-tree-arrow"
        :class="{ expanded: isExpanded }"
        @click.stop="toggle"
      >
        <ArrowRight />
      </el-icon>
      <span v-else class="sm-tree-arrow-spacer" />
      <span class="sm-tree-chapter-title" :title="node.title">
        {{ node.displayTitle }}
      </span>
      <el-tag v-if="total > 0" size="small" type="info" class="sm-tree-chapter-badge">
        {{ total }}
      </el-tag>
    </div>

    <div v-show="isExpanded" class="sm-tree-chapter-body">
      <!-- 递归子章节 -->
      <TreeNodeView
        v-for="child in node.children"
        :key="child.outline_id + '-' + child.seq"
        :node="child"
        :depth="depth + 1"
        :expanded-nodes="expandedNodes"
        :filter-active="filterActive"
        :selected-anchor-id="selectedAnchorId"
        :anchor-status-tag="anchorStatusTag"
        :anchor-status-label="anchorStatusLabel"
        :can-jump="canJump"
        :has-marker="hasMarker"
        :get-anchors="getAnchors"
        :get-total="getTotal"
        @toggle="emit('toggle', $event)"
        @jump-to-section="emit('jumpToSection', $event)"
        @anchor-click="emit('anchorClick', $event)"
        @jump-to-anchor="emit('jumpToAnchor', $event)"
        @open-detail="emit('openDetail', $event)"
      />

      <!-- 锚点条目：点击条目本身 → 滚动中间栏到该锚点所在章节 -->
      <template v-if="anchors.length > 0">
        <div
          v-for="anchor in anchors"
          :key="anchor.id"
          class="sm-tree-anchor-item"
          :class="{
            active: anchor.id === selectedAnchorId,
            'status-valid': anchor.status === 'valid',
            'status-gap': anchor.status === 'gap',
            'status-suspected': anchor.status === 'suspected',
            'status-invalid': anchor.status === 'invalid',
          }"
          :style="{ marginLeft: `${(depth + 1) * 14}px` }"
          @click="emit('anchorClick', anchor.id)"
        >
          <div class="sm-tree-anchor-top">
            <el-tag :type="anchorStatusTag(anchor.status)" size="small">
              {{ $t(anchorStatusLabel(anchor.status)) }}
            </el-tag>
            <span class="sm-tree-anchor-text">
              {{ anchor.source_text?.slice(0, 60) }}{{ (anchor.source_text?.length || 0) > 60 ? '...' : '' }}
            </span>
          </div>
          <div class="sm-tree-anchor-actions">
            <el-tooltip
              v-if="!canJump(anchor)"
              :content="$t('apps.standardMgr.anchorNoMarker')"
              placement="top"
            >
              <el-button size="small" disabled>
                {{ $t('apps.standardMgr.jumpToAnchor') }}
              </el-button>
            </el-tooltip>
            <el-tooltip
              v-else-if="!hasMarker(anchor)"
              :content="$t('apps.standardMgr.anchorNoSourceMarker')"
              placement="top"
            >
              <el-button
                size="small"
                type="primary"
                link
                @click.stop="emit('jumpToAnchor', anchor)"
              >
                {{ $t('apps.standardMgr.jumpToAnchor') }}
              </el-button>
            </el-tooltip>
            <el-button
              v-else
              size="small"
              type="primary"
              link
              @click.stop="emit('jumpToAnchor', anchor)"
            >
              {{ $t('apps.standardMgr.jumpToAnchor') }}
            </el-button>
            <el-button
              size="small"
              link
              @click.stop="emit('openDetail', anchor)"
            >
              {{ $t('apps.standardMgr.detailView') }}
            </el-button>
          </div>
        </div>
      </template>

      <!-- 无锚点章节占位（仅在未筛选时展示） -->
      <div
        v-else-if="!filterActive && !hasVisibleChildren"
        class="sm-tree-empty-chapter"
        :style="{ marginLeft: `${(depth + 1) * 14}px` }"
      >
        {{ $t('apps.standardMgr.chapterEmpty') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import type { RefAnchor, RefStatus, AnchoredSection } from '../api/standard-mgr'

interface SectionNode {
  outline_id: string
  seq: number
  title: string
  displayTitle: string
  level: number
  children: SectionNode[]
}

const props = defineProps<{
  node: SectionNode
  depth: number
  expandedNodes: Set<string>
  filterActive: boolean
  selectedAnchorId: string | null
  anchorStatusTag: (status: RefStatus) => 'success' | 'warning' | 'danger' | 'info' | ''
  anchorStatusLabel: (status: RefStatus) => string
  canJump: (anchor: RefAnchor) => boolean
  hasMarker: (anchor: RefAnchor) => boolean
  getAnchors: (outlineId: string) => RefAnchor[]
  getTotal: (outlineId: string) => number
}>()

const emit = defineEmits<{
  toggle: [outlineId: string]
  jumpToSection: [outlineId: string]
  anchorClick: [anchorId: string]
  jumpToAnchor: [anchor: RefAnchor]
  openDetail: [anchor: RefAnchor]
}>()

const isExpanded = computed(() => props.expandedNodes.has(props.node.outline_id))

const anchors = computed(() => props.getAnchors(props.node.outline_id))

/**
 * 章节徽标总数 = 自身锚点 + 全部子孙章节锚点。
 * 父章节（如"6 零部件标识构成"）显示整棵子树的锚点总数，
 * 而不只是挂在自己 outline 上的那部分。
 */
const total = computed(() => {
  let count = props.getTotal(props.node.outline_id)
  const walk = (nodes: SectionNode[]) => {
    for (const n of nodes) {
      count += props.getTotal(n.outline_id)
      walk(n.children)
    }
  }
  walk(props.node.children)
  return count
})

/** 是否有可展开内容（子章节或有锚点） */
const hasExpandable = computed(() => props.node.children.length > 0 || total.value > 0)

/** 子节点中是否有可见项（用于占位判断） */
const hasVisibleChildren = computed(() => props.node.children.length > 0)

/** 点击章节头：展开 + 跳转 */
function handleHeaderClick() {
  if (hasExpandable.value && !isExpanded.value) {
    emit('toggle', props.node.outline_id)
  }
  emit('jumpToSection', props.node.outline_id)
}

function toggle() {
  emit('toggle', props.node.outline_id)
}
</script>

<style scoped>
.sm-tree-node { margin-bottom: 2px; }

.sm-tree-chapter-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; cursor: pointer; border-radius: 4px;
  background: #f5f7fa; border: 1px solid #e4e7ed;
  transition: background .2s, border-color .2s;
}
.sm-tree-chapter-header:hover { background: #e8eaed; border-color: #c0c4cc; }
.sm-tree-arrow { transition: transform .2s; font-size: 12px; flex-shrink: 0; color: #909399; }
.sm-tree-arrow.expanded { transform: rotate(90deg); color: #409eff; }
.sm-tree-arrow-spacer { width: 12px; flex-shrink: 0; }
.sm-tree-chapter-title { font-weight: 600; font-size: 13px; flex: 1; cursor: pointer; color: #303133; }
.sm-tree-chapter-title:hover { color: #409eff; }
.sm-tree-chapter-badge { flex-shrink: 0; }
.sm-tree-chapter-body { padding-top: 2px; }

.sm-tree-empty-chapter {
  padding: 8px 12px; color: #c0c4cc; font-size: 12px; font-style: italic;
}

.sm-tree-anchor-item {
  padding: 8px 10px; margin: 4px 0; border-radius: 4px;
  border: 1px solid #ebeef5; border-left: 3px solid #dcdfe6; background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .03);
  transition: border-color .2s, background .2s, box-shadow .2s;
}
.sm-tree-anchor-item:hover { background: #f5f7fa; box-shadow: 0 1px 4px rgba(0, 0, 0, .06); }
.sm-tree-anchor-item.active { background: #ecf5ff; border-color: #a0cfff; }
.sm-tree-anchor-item.status-valid { border-left-color: #67c23a; }
.sm-tree-anchor-item.status-gap { border-left-color: #f56c6c; }
.sm-tree-anchor-item.status-suspected { border-left-color: #e6a23c; }
.sm-tree-anchor-item.status-invalid { border-left-color: #909399; }

.sm-tree-anchor-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.sm-tree-anchor-text { font-size: 13px; color: #303133; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sm-tree-anchor-actions { display: flex; gap: 4px; }
</style>
