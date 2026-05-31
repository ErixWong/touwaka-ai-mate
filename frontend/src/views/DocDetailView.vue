<template>
  <div class="doc-detail-view">
    <div class="back-row">
      <el-button text @click="$router.push('/docs')">← {{ $t('docs.navTitle') }}</el-button>
    </div>

    <div v-if="docStore.isLoading" class="loading-state">{{ $t('common.loading') }}</div>
    <div v-else-if="docStore.error" class="error-state">{{ docStore.error }}</div>

    <template v-else-if="docStore.currentDoc">
      <div class="doc-header">
        <h1>{{ docStore.currentDoc.title }}</h1>
        <div class="doc-meta">
          <el-tag :type="docTypeTag(docStore.currentDoc.doc_type)">{{ docStore.currentDoc.doc_type }}</el-tag>
          <span>{{ docStore.currentDoc.source_system }}</span>
          <span>{{ docStore.currentDoc.visibility }}</span>
        </div>
      </div>

      <h3>{{ $t('docs.versions') }}</h3>
      <div v-if="docStore.versions.length === 0" class="empty-state">
        {{ $t('docs.noVersions') }}
      </div>
      <el-table v-else :data="docStore.versions" stripe>
        <el-table-column prop="version_no" label="#" width="60" />
        <el-table-column prop="version_label" label="Label" width="100" />
        <el-table-column prop="version_status" label="Status" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.version_status)" size="small">{{ row.version_status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Current" width="80">
          <template #default="{ row }">
            <span v-if="row.is_current">✓</span>
          </template>
        </el-table-column>
        <el-table-column prop="effective_from" label="Effective From" width="120" />
        <el-table-column prop="effective_to" label="To" width="120" />
        <el-table-column prop="change_summary" label="Changes" min-width="200" />
        <el-table-column label="Actions" width="140">
          <template #default="{ row }">
            <el-button size="small" text @click="setCurrent(row.id)" v-if="!row.is_current">
              Set Current
            </el-button>
            <el-button size="small" text @click="viewContent(row.id)">Content</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <el-dialog v-model="showContentDialog" title="Content Tree" width="800px">
      <div v-if="docStore.contentTree.length === 0">No content</div>
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

const route = useRoute()
const docStore = useDocStore()
const showContentDialog = ref(false)

function docTypeTag(type: string) {
  const m: Record<string, string> = { knowledge: '', contract: 'warning', department_doc: 'info', standard: 'success' }
  return m[type] || ''
}

function statusTag(s: string) {
  const m: Record<string, string> = { draft: 'info', review: 'warning', approved: '', effective: 'success', expired: 'danger', archived: 'info' }
  return m[s] || ''
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

async function setCurrent(versionId: string) {
  const docId = route.params.documentId as string
  // Simple set-current via transition to effective
  await fetch(`/api/docs/${docId}/versions/${versionId}/set-current`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  await docStore.fetchVersions(docId)
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
.doc-meta { display: flex; gap: 12px; align-items: center; color: #999; }
.loading-state, .error-state, .empty-state { padding: 60px 0; text-align: center; color: #999; }
.content-tree { max-height: 500px; overflow-y: auto; }
.content-unit { margin-bottom: 12px; border-left: 2px solid #e0e0e0; padding-left: 12px; }
.unit-title { font-weight: bold; margin-bottom: 4px; }
.unit-content { color: #666; font-size: 13px; line-height: 1.6; }
</style>
