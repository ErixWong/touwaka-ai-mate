<template>
  <div class="doc-detail-view">
    <div class="back-row">
      <el-button text @click="$router.push('/docs')">← {{ $t('docs.navTitle') }}</el-button>
    </div>

    <div v-if="docStore.isLoading && !docStore.currentDoc" class="loading-state">{{ $t('common.loading') }}</div>
    <div v-else-if="docStore.error" class="error-state">{{ docStore.error }}</div>

    <template v-else-if="docStore.currentDoc">
      <div class="doc-header">
        <h1>{{ docStore.currentDoc.title }}</h1>
        <div class="doc-meta">
          <el-tag :type="docTypeTag(docStore.currentDoc.doc_type)">{{ docTypeLabel(docStore.currentDoc.doc_type) }}</el-tag>
          <span>{{ docStore.currentDoc.source_system }}</span>
          <span class="vis-badge">{{ docStore.currentDoc.visibility }}</span>
          <span>{{ $t('docs.updatedAt') }}: {{ fmt(docStore.currentDoc.updated_at) }}</span>
        </div>
      </div>

      <div class="version-header">
        <h3>{{ $t('docs.versions') }}</h3>
      </div>

      <div v-if="docStore.versions.length === 0" class="empty-state">
        {{ $t('docs.noVersions') }}
      </div>

      <el-table v-else :data="docStore.versions" stripe>
        <el-table-column prop="version_no" label="#" width="60" />
        <el-table-column prop="version_label" :label="$t('docs.versionLabel')" width="120" />
        <el-table-column :label="$t('docs.versionStatus')" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.version_status)" size="small">{{ $t('docs.status.' + row.version_status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('docs.versionCurrent')" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_current" type="success" size="small" effect="dark">●</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="effective_from" :label="$t('docs.versionFrom')" width="120">
          <template #default="{ row }">{{ row.effective_from || '-' }}</template>
        </el-table-column>
        <el-table-column prop="effective_to" :label="$t('docs.versionTo')" width="120">
          <template #default="{ row }">{{ row.effective_to || '-' }}</template>
        </el-table-column>
        <el-table-column :label="$t('docs.versionActions')" min-width="280">
          <template #default="{ row }">
            <template v-for="t in getTransitions(row.version_status)" :key="t">
              <el-button size="small" @click="doTransition(row.id, t)">
                {{ $t('docs.actions.' + t) }}
              </el-button>
            </template>
            <el-button size="small" type="primary" @click="doSetCurrent(row.id)" v-if="!row.is_current && row.version_status === 'approved'">
              {{ $t('docs.actions.setCurrent') }}
            </el-button>
            <el-button size="small" text @click="viewContent(row.id)">{{ $t('docs.actions.viewContent') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <el-dialog v-model="showContentDialog" :title="$t('docs.contentTree')" width="800px">
      <div v-if="docStore.contentTree.length === 0">{{ $t('docs.noContent') }}</div>
      <div v-else class="content-tree">
        <div v-for="unit in flattenTree(docStore.contentTree)" :key="unit.id" class="content-unit" :style="{ paddingLeft: unit.level * 20 + 'px' }">
          <div class="unit-title" v-if="unit.title">{{ unit.title }}</div>
          <div class="unit-content" v-if="unit.content">{{ unit.content }}</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useDocStore } from '@/stores/doc'
import type { DocContentUnit } from '@/api/docs'
import { ElMessage } from 'element-plus'

const route = useRoute()
const docStore = useDocStore()
const showContentDialog = ref(false)

const TRANSITIONS: Record<string, string[]> = {
  draft:    ['review', 'archived'],
  review:   ['approved', 'draft', 'archived'],
  approved: ['effective', 'draft', 'archived'],
  effective:['expired', 'archived'],
  expired:  ['draft', 'archived'],
  archived: [],
}

function getTransitions(from: string): string[] {
  return TRANSITIONS[from] || []
}

function docTypeTag(type: string) {
  const m: Record<string, string> = { knowledge: '', contract: 'warning', department_doc: 'info', standard: 'success' }
  return m[type] || ''
}

function docTypeLabel(type: string) {
  const m: Record<string, string> = { knowledge: 'KB', contract: 'Contract', department_doc: 'Dept', standard: 'Std' }
  return m[type] || type
}

function statusTag(s: string) {
  const m: Record<string, string> = { draft: 'info', review: 'warning', approved: '', effective: 'success', expired: 'danger', archived: 'info' }
  return m[s] || ''
}

function fmt(t: string) {
  return t ? new Date(t).toLocaleString() : ''
}

function flattenTree(tree: DocContentUnit[]): DocContentUnit[] {
  const result: DocContentUnit[] = []
  function walk(units: DocContentUnit[], level: number) {
    for (const u of units) {
      result.push({ ...u, level })
      if (u.children) walk(u.children, level + 1)
    }
  }
  walk(tree, 0)
  return result
}

async function doSetCurrent(versionId: string) {
  const docId = route.params.documentId as string
  await docStore.setCurrent(docId, versionId)
  if (!docStore.error) ElMessage.success('Current version set')
}

async function doTransition(versionId: string, toStatus: string) {
  const docId = route.params.documentId as string
  await docStore.transition(docId, versionId, toStatus)
  if (!docStore.error) ElMessage.success(`Status changed to ${toStatus}`)
}

async function viewContent(versionId: string) {
  const docId = route.params.documentId as string
  await docStore.fetchContentTree(docId, versionId)
  showContentDialog.value = true
}

onMounted(async () => {
  const documentId = route.params.documentId as string
  if (documentId) {
    await docStore.fetchDocument(documentId)
    await docStore.fetchVersions(documentId)
  }
})
</script>

<style scoped>
.doc-detail-view { padding: 20px; max-width: 1000px; margin: 0 auto; }
.back-row { margin-bottom: 16px; }
.doc-header { margin-bottom: 24px; }
.doc-header h1 { margin: 0 0 8px; font-size: 22px; }
.doc-meta { display: flex; gap: 16px; align-items: center; color: #999; font-size: 13px; }
.vis-badge { background: #f0f0f0; padding: 1px 8px; border-radius: 4px; }
.version-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.version-header h3 { margin: 0; }
.loading-state, .error-state, .empty-state { padding: 60px 0; text-align: center; color: #999; }
.content-tree { max-height: 500px; overflow-y: auto; }
.content-unit { margin-bottom: 12px; border-left: 2px solid #e0e0e0; padding-left: 12px; }
.unit-title { font-weight: bold; margin-bottom: 4px; }
.unit-content { color: #666; font-size: 13px; line-height: 1.6; }
</style>
