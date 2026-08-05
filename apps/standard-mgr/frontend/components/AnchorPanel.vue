<template>
  <div class="sm-anchor-panel">
    <div class="sm-anchor-header">
      <h3>{{ $t('apps.standardMgr.anchors') }}</h3>
      <span class="sm-anchor-count">{{ $t('apps.standardMgr.anchorsCount', { count: anchors.length }) }}</span>
    </div>

    <div v-if="anchors.length === 0" class="sm-anchor-empty">
      <el-empty :description="$t('apps.standardMgr.noAnchors')" :image-size="60" />
    </div>

    <!-- R2-8: 按章节目录树组织锚点列表 -->
    <div v-else class="sm-anchor-list">
      <template v-for="group in groupedAnchors" :key="group.outline_id">
        <div class="sm-anchor-group-header">
          <span class="sm-anchor-group-icon">📄</span>
          <span class="sm-anchor-group-title">{{ group.section_title || $t('apps.standardMgr.uncategorized') }}</span>
          <el-tag size="small" type="info">{{ group.anchors.length }}</el-tag>
        </div>
        <div
          v-for="anchor in group.anchors"
          :key="anchor.id"
          class="sm-anchor-item"
          :class="{
            active: anchor.id === selectedAnchorId,
            'status-valid': anchor.status === 'valid',
            'status-gap': anchor.status === 'gap',
            'status-suspected': anchor.status === 'suspected',
            'status-invalid': anchor.status === 'invalid',
          }"
          @click="$emit('anchorClick', anchor.id)"
        >
          <div class="sm-anchor-item-header">
            <el-tag :type="anchorStatusTag(anchor.status)" size="small">
              {{ $t(anchorStatusLabel(anchor.status)) }}
            </el-tag>
            <el-tag size="small" type="info" v-if="anchor.source !== 'auto'">
              {{ anchor.source }}
            </el-tag>
          </div>
          <div class="sm-anchor-text">{{ anchor.source_text }}</div>
          <div class="sm-anchor-target">
            <template v-if="anchor.status === 'valid' && anchor.target_document_id">
              → {{ anchor.target_document_id?.slice(0, 8) }}...
            </template>
            <template v-else-if="anchor.status_reason">
              <span class="sm-anchor-reason">{{ anchor.status_reason }}</span>
            </template>
            <template v-else>
              <span class="sm-anchor-reason">{{ $t('apps.standardMgr.pending') }}</span>
            </template>
          </div>
          <div class="sm-anchor-actions" v-if="anchor.status === 'gap'">
            <el-button type="primary" link size="small" @click.stop="emit('fixAnchor', anchor)">
              {{ $t('apps.standardMgr.fixAction') }}
            </el-button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RefAnchor, RefStatus, AnchoredSection } from '../api/standard-mgr'

const props = defineProps<{
  anchors: RefAnchor[]
  anchorsByOutline: Record<string, RefAnchor[]>
  selectedAnchorId: string | null
  standardId: string | null
  sections: AnchoredSection[]
}>()

const emit = defineEmits<{
  anchorClick: [anchorId: string]
  fixAnchor: [anchor: RefAnchor]
}>()

/** R2-8: 将锚点按 section 分组，附带 section 标题 */
const groupedAnchors = computed(() => {
  // 构建 outline_id → section title 映射
  const titleMap: Record<string, string> = {}
  for (const s of props.sections) {
    titleMap[s.outline_id] = s.title || `${s.seq}`
  }

  const groups: Array<{ outline_id: string; section_title: string; anchors: RefAnchor[] }> = []
  const seen = new Set<string>()

  for (const a of props.anchors) {
    const oid = a.source_outline_id
    if (!seen.has(oid)) {
      seen.add(oid)
      const groupAnchors = props.anchorsByOutline[oid] || [a]
      groups.push({
        outline_id: oid,
        section_title: titleMap[oid] || '',
        anchors: groupAnchors,
      })
    }
  }

  // 按 section seq 排序（提取数字前缀）
  groups.sort((a, b) => {
    const seqA = parseInt(a.section_title, 10) || 999
    const seqB = parseInt(b.section_title, 10) || 999
    return seqA - seqB
  })

  return groups
})

function anchorStatusTag(status: RefStatus): 'success' | 'warning' | 'danger' | 'info' | '' {
  const map: Record<RefStatus, 'success' | 'warning' | 'danger' | 'info' | ''> = {
    valid: 'success',
    suspected: 'warning',
    gap: 'danger',
    invalid: 'info',
  }
  return map[status] || 'info'
}

function anchorStatusLabel(status: RefStatus): string {
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
.sm-anchor-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sm-anchor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
}

.sm-anchor-header h3 {
  margin: 0;
  font-size: 15px;
  color: #303133;
}

.sm-anchor-count {
  font-size: 12px;
  color: #909399;
}

.sm-anchor-empty {
  padding: 40px 0;
}

.sm-anchor-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.sm-anchor-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px 4px;
  font-size: 12px;
  color: #606266;
  background: #fafbfc;
  border-bottom: 1px solid #ebeef5;
  position: sticky;
  top: 0;
  z-index: 1;
}

.sm-anchor-group-icon {
  font-size: 14px;
}

.sm-anchor-group-title {
  flex: 1;
  font-weight: 500;
}

.sm-anchor-item {
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f5f5f5;
  border-left: 3px solid transparent;
  transition: all 0.2s;
}

.sm-anchor-item:hover {
  background-color: #f0f7ff;
}

.sm-anchor-item.active {
  background-color: #ecf5ff;
  border-left-color: #409eff;
}

.sm-anchor-item.status-valid {
  border-left-color: #67c23a;
}

.sm-anchor-item.status-gap {
  border-left-color: #f56c6c;
}

.sm-anchor-item.status-suspected {
  border-left-color: #e6a23c;
}

.sm-anchor-item.status-invalid {
  border-left-color: #909399;
}

.sm-anchor-item-header {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.sm-anchor-text {
  font-size: 13px;
  color: #303133;
  margin: 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.sm-anchor-target {
  font-size: 11px;
  color: #909399;
}

.sm-anchor-reason {
  color: #f56c6c;
  font-style: italic;
}

.sm-anchor-actions {
  margin-top: 4px;
}
</style>
