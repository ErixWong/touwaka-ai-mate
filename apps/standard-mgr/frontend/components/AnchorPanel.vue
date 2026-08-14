<template>
  <div class="sm-anchor-panel">
    <div class="sm-anchor-header">
      <h3>{{ $t('apps.standardMgr.anchors') }}</h3>
      <span class="sm-anchor-count">{{ $t('apps.standardMgr.anchorsCount', { count: anchors.length }) }}</span>
      <el-button size="small" type="primary" class="sm-create-anchor-btn" @click="$emit('create')">
        <el-icon style="margin-right: 2px"><Plus /></el-icon>
        {{ $t('apps.standardMgr.createAnchor') }}
      </el-button>
      <el-button-group class="sm-toggle-all">
        <el-button size="small" @click="collapseAll">{{ $t('apps.standardMgr.collapseAll') }}</el-button>
        <el-button size="small" @click="expandAll">{{ $t('apps.standardMgr.expandAll') }}</el-button>
      </el-button-group>
    </div>

    <div v-if="sections.length === 0 && anchors.length === 0" class="sm-anchor-empty">
      <el-empty :description="$t('apps.standardMgr.noAnchors')" :image-size="60" />
    </div>

    <div v-else class="sm-anchor-body">
      <!-- R9-4: 状态筛选 chips -->
      <div class="sm-anchor-filters">
        <el-button-group size="small" class="sm-filter-group">
          <el-button
            v-for="f in statusFilters"
            :key="f.value"
            :type="filterStatus === f.value ? 'primary' : 'default'"
            @click="filterStatus = f.value"
          >
            {{ f.label }} ({{ f.count }})
          </el-button>
        </el-button-group>
      </div>

      <!-- R19: 多级分级目录树（支持章节标题点击跳转 + 筛选后隐藏空章节） -->
      <div class="sm-anchor-tree">
        <TreeNodeView
          v-for="node in visibleTree"
          :key="node.outline_id + '-' + node.seq"
          :node="node"
          :depth="0"
          :expanded-nodes="expandedNodes"
          :filter-active="filterStatus !== 'all'"
          :selected-anchor-id="selectedAnchorId"
          :anchor-status-tag="anchorStatusTag"
          :anchor-status-label="anchorStatusLabel"
          :can-jump="canJump"
          :has-marker="hasMarker"
          :get-anchors="getSectionAnchors"
          :get-total="getSectionTotalAnchors"
          @toggle="toggleNode"
          @jump-to-section="handleJumpToSection"
          @anchor-click="handleItemClick"
          @jump-to-anchor="handleJump"
          @open-detail="openDetail"
        />
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
        <!-- R9-3: 目标拆分三行 -->
        <el-descriptions-item :label="$t('apps.standardMgr.targetDocTitle')" :span="2">
          {{ detailAnchor.target_document_title || '—' }}
        </el-descriptions-item>
        <el-descriptions-item v-if="detailAnchor.target_document_id" :label="$t('apps.standardMgr.targetDocVersion')" :span="2">
          <code class="sm-id-mono">{{ detailAnchor.target_document_id }}</code>
          <el-button size="small" text @click="copyId(detailAnchor.target_document_id)">
            <el-icon><CopyDocument /></el-icon>
          </el-button>
        </el-descriptions-item>
        <el-descriptions-item v-if="detailAnchor.target_outline_id" :label="$t('apps.standardMgr.targetOutline')" :span="2">
          {{ detailAnchor.target_outline_title || detailAnchor.target_outline_id }}
          <el-button v-if="detailAnchor.target_outline_title" size="small" text @click="copyId(detailAnchor.target_outline_id!)">
            <el-icon><CopyDocument /></el-icon>
          </el-button>
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
import { ref, computed, watch } from 'vue'
import { CopyDocument, Plus } from '@element-plus/icons-vue'
import { i18n } from '@/i18n'
import { useToastStore } from '@/stores/toast'
import TreeNodeView from './TreeNodeView.vue'
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
  /** R9-1: 跳转——传完整 anchor 供上层查找目标 */
  jumpToAnchor: [anchor: RefAnchor]
  fixAnchor: [anchor: RefAnchor]
  /** R19: 章节标题点击 → 中间预览跳转到该章节 */
  jumpToSection: [outlineId: string]
  /** R21: 新建锚点 */
  create: []
}>()

// ==================== 多级目录树构建（R19） ====================

/** 章节节点 */
interface SectionNode {
  outline_id: string
  seq: number
  title: string
  /** 去掉数字前缀后的标题，如 "5.2.1 外观检查" → "外观检查" */
  displayTitle: string
  /** 数字层级：5 → 1 级；5.2 → 2 级；无数字前缀 → 0（顶层） */
  level: number
  children: SectionNode[]
}

/** 解析标题开头的数字前缀："5.2.1 外观检查" → { parts: [5,2,1], prefix: '5.2.1' } */
function parseSectionNumber(title: string): { parts: number[]; prefix: string } | null {
  const m = title.match(/^(\d+(?:\.\d+)*)\s*(.*)$/)
  if (!m) return null
  const prefix = m[1] ?? ''
  return { parts: prefix.split('.').map(Number), prefix }
}

/** 按数字前缀把扁平章节列表构建成多级树（保持文档 seq 顺序） */
function buildSectionTree(sections: AnchoredSection[]): SectionNode[] {
  const roots: SectionNode[] = []
  const byKey = new Map<string, SectionNode>()

  for (const s of sections) {
    const parsed = parseSectionNumber(s.title || '')
    const node: SectionNode = {
      outline_id: s.outline_id,
      seq: s.seq,
      title: s.title || '',
      displayTitle: s.title || `#${s.seq}`,
      level: parsed ? parsed.parts.length : 0,
      children: [],
    }

    if (!parsed) {
      roots.push(node)
      continue
    }
    if (parsed.parts.length === 1) {
      roots.push(node)
      byKey.set(parsed.prefix, node)
      continue
    }
    // 多级：尝试挂到父级；父级缺失时降级为顶层
    const parentKey = parsed.parts.slice(0, -1).join('.')
    const parent = byKey.get(parentKey)
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
    byKey.set(parsed.prefix, node)
  }
  return roots
}

const treeRoots = computed(() => buildSectionTree(sortedSections.value))

/** 按 seq 升序的原始章节列表（树构建输入） */
const sortedSections = computed(() => {
  return [...props.sections].sort((a, b) => a.seq - b.seq)
})

// ==================== 展开/收起（多级） ====================

const expandedNodes = ref(new Set<string>())
const filterStatus = ref<string>('all')

function isExpanded(outlineId: string): boolean {
  return expandedNodes.value.has(outlineId)
}

function toggleNode(outlineId: string) {
  const next = new Set(expandedNodes.value)
  if (next.has(outlineId)) next.delete(outlineId)
  else next.add(outlineId)
  expandedNodes.value = next
}

/** 初始化展开：展开所有含锚点章节的祖先链 + 自身 */
const initExpand = () => {
  const next = new Set<string>()
  const walk = (nodes: SectionNode[], ancestors: string[]) => {
    for (const node of nodes) {
      if ((anchorsByOutline.value[node.outline_id] || []).length > 0) {
        for (const a of ancestors) next.add(a)
        next.add(node.outline_id)
      }
      walk(node.children, [...ancestors, node.outline_id])
    }
  }
  walk(treeRoots.value, [])
  expandedNodes.value = next
}

// 数据变化后重新构建展开状态
watch(() => [props.sections, props.anchors], () => {
  if (expandedNodes.value.size === 0 && filterStatus.value === 'all') return
  initExpand()
})

function collapseAll() { expandedNodes.value = new Set() }
function expandAll() {
  const next = new Set<string>()
  const walk = (nodes: SectionNode[]) => {
    for (const node of nodes) {
      next.add(node.outline_id)
      walk(node.children)
    }
  }
  walk(treeRoots.value)
  expandedNodes.value = next
}

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
  const list = anchorsByOutline.value[outlineId] || []
  if (filterStatus.value === 'all') return list
  return list.filter(a => a.status === filterStatus.value)
}

function getSectionAnchorCount(outlineId: string): number {
  return getSectionAnchors(outlineId).length
}

/** R9-4: 某章节的总锚点数（不筛选） */
function getSectionTotalAnchors(outlineId: string): number {
  return (anchorsByOutline.value[outlineId] || []).length
}

// ==================== 筛选生效（R19） ====================

/**
 * 筛选状态下判断节点是否可见：
 * 自身有匹配锚点，或有可见子节点 → 可见；否则整棵子树隐藏
 */
function nodeVisible(node: SectionNode): boolean {
  if (getSectionAnchorCount(node.outline_id) > 0) return true
  return node.children.some(child => nodeVisible(child))
}

/** 可见树：筛选时过滤掉无匹配章节（含其子树） */
const visibleTree = computed<SectionNode[]>(() => {
  if (filterStatus.value === 'all') return treeRoots.value
  const filterNodes = (nodes: SectionNode[]): SectionNode[] => {
    const out: SectionNode[] = []
    for (const node of nodes) {
      const visibleChildren = filterNodes(node.children)
      if (getSectionAnchorCount(node.outline_id) > 0 || visibleChildren.length > 0) {
        out.push({ ...node, children: visibleChildren })
      }
    }
    return out
  }
  return filterNodes(treeRoots.value)
})

// 切换筛选时：自动展开有匹配锚点章节的祖先链，确保结果可见
watch(filterStatus, () => {
  if (filterStatus.value === 'all') return
  const next = new Set(expandedNodes.value)
  const walk = (nodes: SectionNode[], ancestors: string[]) => {
    for (const node of nodes) {
      if (getSectionAnchorCount(node.outline_id) > 0) {
        for (const a of ancestors) next.add(a)
        next.add(node.outline_id)
      }
      walk(node.children, [...ancestors, node.outline_id])
    }
  }
  walk(treeRoots.value, [])
  expandedNodes.value = next
})

// R9-4: 筛选选项
const statusCounts = computed(() => {
  const counts: Record<string, number> = { all: props.anchors.length }
  for (const a of props.anchors) {
    counts[a.status] = (counts[a.status] || 0) + 1
  }
  return counts
})

const statusFilters = computed(() => {
  const statuses = ['valid', 'suspected', 'gap', 'invalid'] as const
  return [
    { value: 'all', label: i18n.global.t('common.all'), count: statusCounts.value.all },
    ...statuses.map(s => ({
      value: s,
      label: i18n.global.t(anchorStatusLabel(s)),
      count: statusCounts.value[s] || 0,
    })),
  ]
})

/** R19: 章节标题点击 → 中间预览跳转到该章节 */
function handleJumpToSection(outlineId: string) {
  emit('jumpToSection', outlineId)
}

// ==================== 标记检测 ====================

/** R9-0: 检查锚点在副本中是否有 marker。API 返回原始 <anchor+id> 格式 */
function hasMarker(anchor: RefAnchor): boolean {
  if (!anchor.source_outline_id) return false
  const section = props.sections.find(s => s.outline_id === anchor.source_outline_id)
  if (!section || !section.anchored_text) return false
  return section.anchored_text.includes(`<anchor+${anchor.id}>`)
}

// ==================== 条目点击：选中 + 通知上层滚动到对应章节 ====================

function handleItemClick(anchorId: string) {
  emit('anchorClick', anchorId)
}

// ==================== 跳转：始终打开目标文档新页签 ====================

/** 是否可跳转——仅 gap 锚点（无目标）禁用 */
function canJump(anchor: RefAnchor): boolean {
  return anchor.status !== 'gap'
}

function handleJump(anchor: RefAnchor) {
  emit('jumpToAnchor', anchor)
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

/** R9-3: 复制 ID 到剪贴板 */
async function copyId(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    useToastStore().success(i18n.global.t('common.copied'))
  } catch {
    // fallback: 静默忽略
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

// 所有依赖（treeRoots/anchorsByOutline 等）定义完成后，再执行初始展开
initExpand()
</script>

<style scoped>
.sm-anchor-panel { padding: 12px; }
.sm-anchor-header {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; flex-wrap: wrap;
}
.sm-anchor-header h3 { margin: 0; font-size: 16px; }
.sm-anchor-count { color: #909399; font-size: 13px; }
.sm-create-anchor-btn { margin-left: auto; }
.sm-toggle-all { margin-left: 0; }
.sm-anchor-empty { padding: 20px 0; }

/* R9-4: 筛选 chips */
.sm-anchor-filters { margin-bottom: 10px; }
.sm-filter-group { display: flex; flex-wrap: wrap; }

.sm-anchor-tree { max-height: calc(100vh - 260px); overflow-y: auto; }

.sm-context-text { font-size: 12px; color: #606266; white-space: pre-wrap; max-height: 120px; overflow-y: auto; }
</style>
