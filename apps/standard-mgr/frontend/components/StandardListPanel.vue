<template>
  <div class="sm-list-panel">
    <div class="sm-list-header">
      <h3>{{ $t('apps.standardMgr.listTitle') }}</h3>
      <el-button type="primary" size="small" :icon="Plus" @click="$emit('uploadClick')">
        {{ $t('apps.standardMgr.onboard') }}
      </el-button>
    </div>

    <div v-loading="loading" class="sm-list-body">
      <div
        v-for="item in standards"
        :key="item.id"
        class="sm-list-item"
        :class="{ active: item.id === selectedId }"
        @click="$emit('select', item.id)"
      >
        <div class="sm-item-code">{{ item.standard_code }}</div>
        <div class="sm-item-name">{{ item.standard_name }}</div>
        <div class="sm-item-meta">
          <el-tag size="small" :type="statusTagType(item.anchor_build_status)">
            {{ $t(statusLabel(item.anchor_build_status)) }}
          </el-tag>
          <el-badge
            v-if="item.needs_review"
            value="!"
            class="sm-item-badge"
            type="warning"
          />
          <el-tooltip
            v-if="hasNewerVersion(item)"
            :content="$t('apps.standardMgr.newVersionHint')"
            placement="top"
          >
            <el-tag size="small" type="warning" class="sm-version-hint">{{ $t('apps.standardMgr.newVersionTag') }}</el-tag>
          </el-tooltip>
          <span class="sm-item-counts">
            {{ $t('apps.standardMgr.countsFormat', { ref: item.reference_count, valid: item.valid_reference_count, gap: item.gap_reference_count }) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus } from '@element-plus/icons-vue'
import type { StandardItem, AnchorBuildStatus } from '../api/standard-mgr'

const props = defineProps<{
  standards: StandardItem[]
  selectedId: string | null
  loading: boolean
}>()

defineEmits<{
  select: [standardId: string]
  uploadClick: []
}>()

/** R2-8: 检测平台是否有比已清洗版本更新的版本 */
function hasNewerVersion(item: StandardItem): boolean {
  if (!item.document_current_revision_id || !item.current_revision_id) return false
  return item.document_current_revision_id !== item.current_revision_id
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
}

.sm-list-header h3 {
  margin: 0;
  font-size: 15px;
  color: #303133;
}

.sm-list-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.sm-list-item {
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f5f5f5;
  transition: background-color 0.2s;
}

.sm-list-item:hover {
  background-color: #f0f7ff;
}

.sm-list-item.active {
  background-color: #ecf5ff;
  border-left: 3px solid #409eff;
}

.sm-item-code {
  font-weight: 600;
  font-size: 13px;
  color: #303133;
}

.sm-item-name {
  font-size: 12px;
  color: #606266;
  margin: 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.sm-item-badge {
  margin-right: 4px;
}

.sm-item-counts {
  font-size: 11px;
  color: #909399;
}
</style>
