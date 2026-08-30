<template>
  <div class="sm-list-panel">
    <div class="sm-list-header">
      <h3>{{ $t('apps.standardMgr.listTitle') }}</h3>
      <div class="sm-list-header-actions">
        <el-tooltip v-if="showSettings" :content="$t('apps.standardMgr.configTooltip')" placement="bottom">
          <el-button size="small" :icon="Setting" @click="$emit('settingsClick')">
            {{ $t('apps.standardMgr.configButton') }}
          </el-button>
        </el-tooltip>
        <el-button type="primary" size="small" :icon="Plus" @click="$emit('uploadClick')">
          {{ $t('apps.standardMgr.onboard') }}
        </el-button>
      </div>
    </div>

    <div class="sm-list-filters">
      <el-input
        v-model="searchKeyword"
        clearable
        :placeholder="$t('apps.standardMgr.searchStandardsPlaceholder')"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <div class="sm-list-filter-row">
        <el-select
          v-model="statusFilter"
          class="sm-list-filter-status"
          :placeholder="$t('apps.standardMgr.statusFilterPlaceholder')"
        >
          <el-option :label="$t('common.all')" value="all" />
          <el-option :label="$t('apps.standardMgr.statusPending')" value="pending" />
          <el-option :label="$t('apps.standardMgr.statusProcessing')" value="processing" />
          <el-option :label="$t('apps.standardMgr.statusDone')" value="done" />
          <el-option :label="$t('apps.standardMgr.statusFailed')" value="error" />
          <el-option :label="$t('apps.standardMgr.statusNeedsReview')" value="needs_review" />
        </el-select>
        <div class="sm-list-filter-inactive">
          <span>{{ $t('apps.standardMgr.showInactiveStandards') }}</span>
          <el-switch
            v-model="showInactive"
            :disabled="loading"
            @change="handleShowInactiveChange"
          />
        </div>
      </div>
    </div>

    <div v-loading="loading" class="sm-list-body">
      <el-empty v-if="!loading && standards.length === 0" :description="$t('apps.standardMgr.noStandards')" />
      <el-empty
        v-else-if="!loading && filteredStandards.length === 0"
        :description="$t('apps.standardMgr.noMatchingStandards')"
      />
      <el-empty
        v-else-if="!loading && normalizedSearchKeyword && searchMatchedStandards.length === 0"
        :description="$t('apps.standardMgr.noMatchingStandards')"
      />
      <el-tree
        v-else
        ref="treeRef"
        :data="treeData"
        :props="{ children: 'children', label: 'label' }"
        node-key="id"
        :default-expand-all="false"
        :expand-on-click-node="false"
        highlight-current
        :filter-node-method="filterNode"
        @node-click="handleNodeClick"
      >
        <template #default="{ node, data }">
          <div
            v-if="data.type === 'group'"
            class="sm-tree-group"
          >
            <span class="sm-tree-group-label">{{ data.label }}</span>
            <span v-if="data.count != null" class="sm-tree-group-count">({{ data.count }})</span>
          </div>
          <div
            v-else
            class="sm-tree-item"
            :class="{ active: data.standard_id === selectedId }"
          >
            <div class="sm-item-code">{{ data.standard_code }}</div>
            <div class="sm-item-name">{{ data.standard_name }}</div>
            <div class="sm-item-meta">
              <el-tag size="small" :type="data.statusTagType">
                {{ $t(data.statusLabel) }}
              </el-tag>
              <el-tag v-if="data.is_active === false" size="small" type="info">
                {{ $t('apps.standardMgr.statusInactive') }}
              </el-tag>
              <el-tooltip
                v-if="data.has_new_version"
                :content="$t('apps.standardMgr.newVersionHint')"
                placement="top"
              >
                <el-tag size="small" type="warning">
                  {{ $t('apps.standardMgr.newVersionTag') }}
                </el-tag>
              </el-tooltip>
              <el-tooltip
                v-if="data.needs_review"
                :content="data.needs_review_tip || $t('apps.standardMgr.needsReviewFallback')"
                placement="top"
              >
                <el-badge
                  value="!"
                  class="sm-item-badge"
                  type="warning"
                />
              </el-tooltip>
            </div>
          </div>
        </template>
      </el-tree>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { i18n } from '@/i18n'
import { Plus, Search, Setting } from '@element-plus/icons-vue'
import type { StandardItem, AnchorBuildStatus, EnterpriseItem } from '../api/standard-mgr'

const props = defineProps<{
  standards: StandardItem[]
  selectedId: string | null
  loading: boolean
  enterprises?: EnterpriseItem[]
  /** 是否显示设置按钮（管理员） */
  showSettings?: boolean
}>()

const emit = defineEmits<{
  select: [standardId: string]
  uploadClick: []
  settingsClick: []
  showInactiveChange: [showInactive: boolean]
}>()

type StatusFilter = AnchorBuildStatus | 'all' | 'needs_review'

const searchKeyword = ref('')
const statusFilter = ref<StatusFilter>('all')
const showInactive = ref(false)

interface StandardTreeInstance {
  filter: (value: string) => void
  getNode: (data: string) => { expanded: boolean } | null | undefined
}

const treeRef = ref<StandardTreeInstance | null>(null)

// ============================================================
// Tree data
// ============================================================

interface TreeNode {
  id: string
  label: string
  type: 'group' | 'standard'
  standard_id?: string
  standard_code?: string
  standard_name?: string
  is_active?: boolean
  statusTagType?: string
  statusLabel?: string
  has_new_version?: boolean
  needs_review?: boolean
  needs_review_tip?: string
  children?: TreeNode[]
  count?: number
}

/** enterprise_id → name 映射 */
const enterpriseNameMap = computed(() => {
  const map: Record<string, string> = {}
  if (props.enterprises) {
    for (const ent of props.enterprises) {
      map[ent.id] = ent.name
    }
  }
  return map
})

const normalizedSearchKeyword = computed(() => searchKeyword.value.trim().toLowerCase())

const filteredStandards = computed(() => {
  if (statusFilter.value === 'all') return props.standards
  if (statusFilter.value === 'needs_review') {
    return props.standards.filter(std => std.needs_review)
  }
  return props.standards.filter(std => std.anchor_build_status === statusFilter.value)
})

const searchMatchedStandards = computed(() => {
  const keyword = normalizedSearchKeyword.value
  if (!keyword) return filteredStandards.value
  return filteredStandards.value.filter(std =>
    [std.standard_code, std.standard_name]
      .some(value => value?.toLowerCase().includes(keyword)),
  )
})

const treeData = computed<TreeNode[]>(() => {
  const t = i18n.global.t
  const groups: Record<string, { label: string; items: StandardItem[]; subGroups?: Record<string, StandardItem[]> }> = {
    national: { label: t('apps.standardMgr.treeNational'), items: [] },
    industry: { label: t('apps.standardMgr.treeIndustry'), items: [] },
    enterprise: {
      label: t('apps.standardMgr.treeEnterprise'),
      items: [],
      subGroups: {},
    },
    international: { label: t('apps.standardMgr.treeInternational'), items: [] },
    '': { label: t('apps.standardMgr.uncategorized'), items: [] },
  }

  const entMap = enterpriseNameMap.value

  for (const std of filteredStandards.value) {
    const type = std.standard_type || ''
    const grp = groups[type]
    if (!grp) {
      const uncat = groups['']
      if (uncat) uncat.items.push(std)
      continue
    }

    if (type === 'enterprise') {
      const entId = std.enterprise_id
      if (entId && grp.subGroups) {
        if (!grp.subGroups[entId]) {
          grp.subGroups[entId] = []
        }
        grp.subGroups[entId].push(std)
      } else {
        grp.items.push(std)
      }
    } else {
      grp.items.push(std)
    }
  }

  const typeOrder = ['national', 'industry', 'enterprise', 'international', '']

  const nodes: TreeNode[] = []
  for (const type of typeOrder) {
    const grp = groups[type]
    if (!grp) continue

    if (type === 'enterprise') {
      // Collect enterprise sub-group children + unassigned
      const subNodes: TreeNode[] = []

      // Unassigned enterprise standards
      if (grp.items.length > 0) {
        subNodes.push({
          id: `group_enterprise_unassigned`,
          label: t('apps.standardMgr.treeUnassignedEnterprise'),
          type: 'group',
          count: grp.items.length,
          children: buildVersionedNodes(grp.items),
        })
      }

      // Per-enterprise groups
      const subGroups = grp.subGroups || {}
      const entKeys = Object.keys(subGroups)
      entKeys.sort((a, b) => (entMap[a] || a).localeCompare(entMap[b] || b))
      for (const entId of entKeys) {
        const items = subGroups[entId]
        if (!items || items.length === 0) continue
        const entName = entMap[entId] || entId
        subNodes.push({
          id: `group_enterprise_${entId}`,
          label: entName,
          type: 'group',
          count: items.length,
          children: buildVersionedNodes(items),
        })
      }

      if (subNodes.length > 0) {
        nodes.push({
          id: `group_${type}`,
          label: grp.label,
          type: 'group',
          count: grp.items.length + Object.values(subGroups).reduce((sum, arr) => sum + arr.length, 0),
          children: subNodes,
        })
      } else {
        // Always show enterprise group even when empty
        nodes.push({
          id: `group_${type}`,
          label: grp.label,
          type: 'group',
          count: 0,
          children: [],
        })
      }
    } else {
      nodes.push({
        id: `group_${type}`,
        label: grp.label,
        type: 'group',
        count: grp.items.length,
        children: buildVersionedNodes(grp.items),
      })
    }
  }

  return nodes
})

function nodeMatchesSearch(node: TreeNode, keyword: string): boolean {
  if (node.type === 'standard') {
    return [node.standard_code, node.standard_name]
      .some(value => value?.toLowerCase().includes(keyword))
  }
  return node.children?.some(child => nodeMatchesSearch(child, keyword)) ?? false
}

function filterNode(value: string, data: TreeNode): boolean {
  const keyword = value.trim().toLowerCase()
  return !keyword || nodeMatchesSearch(data, keyword)
}

function collectMatchingGroupIds(nodes: TreeNode[], keyword: string, groupIds: string[]) {
  for (const node of nodes) {
    if (node.type !== 'group') continue
    if ((!keyword || nodeMatchesSearch(node, keyword)) && node.children?.length) {
      groupIds.push(node.id)
    }
    if (node.children) {
      collectMatchingGroupIds(node.children, keyword, groupIds)
    }
  }
}

async function applyTreeFilter() {
  await nextTick()
  const tree = treeRef.value
  if (!tree) return

  const keyword = normalizedSearchKeyword.value
  tree.filter(keyword)
  await nextTick()

  const groupIds: string[] = []
  collectMatchingGroupIds(treeData.value, keyword, groupIds)
  for (const groupId of groupIds) {
    const node = tree.getNode(groupId)
    if (node) node.expanded = true
  }
}

watch([searchKeyword, statusFilter, treeData], applyTreeFilter, { flush: 'post' })

onMounted(() => {
  applyTreeFilter()
})

/**
 * 版本化分组（树状展开）
 *
 * 规则（Eric 确认）：同一 `document_id` 下存在多条标准记录、且 `current_revision_id`
 * 各不相同 → 说明是同一标准的不同版本（同一份文档多次修订），
 * 打包成「版本组 → 各版本」两层树节点；否则保持原样平铺。
 */
function buildVersionedNodes(items: StandardItem[]): TreeNode[] {
  const byDoc = new Map<string, StandardItem[]>()
  const singles: StandardItem[] = []

  for (const std of items) {
    if (std.document_id) {
      const arr = byDoc.get(std.document_id)
      if (arr) {
        arr.push(std)
      } else {
        byDoc.set(std.document_id, [std])
      }
    } else {
      singles.push(std)
    }
  }

  const nodes: TreeNode[] = []
  for (const [docId, group] of byDoc) {
    const revisionSet = new Set(group.map(g => g.current_revision_id))
    if (group.length > 1 && revisionSet.size > 1) {
      // 同一文档的多版本 → 版本组
      const sorted = [...group].sort((a, b) => (b.standard_name || '').localeCompare(a.standard_name || ''))
      const first = sorted[0]
      nodes.push({
        id: `version_${docId}`,
        label: (first && (first.standard_code || first.standard_name)) || docId,
        type: 'group',
        count: group.length,
        children: sorted.map(std => ({
          ...buildStandardNode(std),
          // 版本子节点用含年份的标准名作 label，便于区分版本
          label: std.standard_name || std.standard_code || std.id,
        })),
      })
    } else {
      singles.push(...group)
    }
  }

  nodes.push(...singles.map(buildStandardNode))
  return nodes
}

function buildStandardNode(std: StandardItem): TreeNode {
  return {
    id: `standard_${std.id}`,
    label: std.standard_code,
    type: 'standard',
    standard_id: std.id,
    standard_code: std.standard_code,
    standard_name: std.standard_name,
    is_active: std.is_active,
    statusTagType: statusTagType(std.anchor_build_status),
    statusLabel: statusLabel(std.anchor_build_status),
    has_new_version: Boolean(
      std.current_revision_id &&
      std.document_current_revision_id &&
      std.current_revision_id !== std.document_current_revision_id,
    ),
    needs_review: std.needs_review,
    needs_review_tip: buildNeedsReviewTip(std),
  }
}

/** R4-x: 组装感叹号 tooltip 原因（缺口/存疑/无效计数 + 构建错误） */
function buildNeedsReviewTip(std: StandardItem): string {
  const t = i18n.global.t
  const parts: string[] = []
  if ((std.gap_reference_count || 0) > 0) parts.push(t('apps.standardMgr.needsReviewGap', { count: std.gap_reference_count }))
  if ((std.suspected_reference_count || 0) > 0) parts.push(t('apps.standardMgr.needsReviewSuspected', { count: std.suspected_reference_count }))
  if ((std.invalid_reference_count || 0) > 0) parts.push(t('apps.standardMgr.needsReviewInvalid', { count: std.invalid_reference_count }))
  if (std.last_anchor_build_error) parts.push(t('apps.standardMgr.needsReviewBuildError', { error: std.last_anchor_build_error }))
  return parts.length > 0 ? parts.join('；') : t('apps.standardMgr.needsReviewFallback')
}

function handleNodeClick(data: TreeNode) {
  if (data.type === 'standard' && data.standard_id) {
    emit('select', data.standard_id)
  }
}

function handleShowInactiveChange(value: boolean | string | number) {
  emit('showInactiveChange', Boolean(value))
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

function statusLabel(status: AnchorBuildStatus): string {
  const map: Record<AnchorBuildStatus, string> = {
    pending: 'apps.standardMgr.statusPending',
    processing: 'apps.standardMgr.statusProcessing',
    done: 'apps.standardMgr.statusDone',
    error: 'apps.standardMgr.statusError',
  }
  return map[status] || status
}
</script>

<style scoped>
.sm-list-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sm-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}

.sm-list-header h3 {
  margin: 0;
  font-size: 15px;
  color: #303133;
}

.sm-list-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sm-list-filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}

.sm-list-filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sm-list-filter-status {
  flex: 1;
  min-width: 0;
}

.sm-list-filter-inactive {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  color: #606266;
  font-size: 12px;
  white-space: nowrap;
}

.sm-list-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

/* R11-4: tree group nodes */
.sm-tree-group {
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.sm-tree-group-count {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  color: #909399;
}

/* R11-4: tree standard leaf */
.sm-tree-item {
  padding: 4px 0;
  cursor: pointer;
}

.sm-tree-item.active .sm-item-code {
  color: #409eff;
  font-weight: 700;
}

.sm-item-code {
  font-weight: 600;
  font-size: 13px;
  color: #303133;
}

.sm-item-name {
  font-size: 12px;
  color: #606266;
  margin: 2px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.sm-item-badge {
  margin-right: 4px;
}

.sm-item-counts {
  font-size: 11px;
  color: #909399;
}

/* R11-4: override el-tree node height for multi-line leaf content */
:deep(.el-tree-node__content) {
  height: auto;
  align-items: flex-start;
  padding: 2px 0;
}
</style>
