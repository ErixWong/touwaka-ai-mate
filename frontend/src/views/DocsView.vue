<template>
  <div class="docs-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('docs.title') }}</h1>
    </div>

    <div class="doc-filter">
      <el-select v-model="filterDocType" :placeholder="$t('docs.filterType')" clearable @change="loadDocuments">
        <el-option :label="$t('docs.typeAll')" value="" />
        <el-option label="KB" value="knowledge" />
        <el-option label="Contract" value="contract" />
        <el-option label="Department" value="department_doc" />
        <el-option label="Standard" value="standard" />
      </el-select>
      <el-select v-model="recallScope" :placeholder="$t('docs.recallScope')" class="scope-select">
        <el-option label="All" value="all" />
        <el-option label="KB" value="knowledge" />
        <el-option label="Contract" value="contract" />
      </el-select>
      <el-input
        v-model="recallQuery"
        :placeholder="$t('docs.recallPlaceholder')"
        class="recall-input"
        @keyup.enter="doRecall"
      >
        <template #append>
          <el-button @click="doRecall" :loading="docStore.isLoading">
            {{ $t('common.search') }}
          </el-button>
        </template>
      </el-input>
    </div>

    <div v-if="docStore.isLoading" class="loading-state">{{ $t('common.loading') }}</div>

    <div v-else-if="docStore.documents.length === 0" class="empty-state">
      <p>{{ $t('docs.empty') }}</p>
    </div>

    <div v-else class="doc-table-wrap">
      <el-table :data="docStore.documents" stripe @row-click="openDoc" style="cursor:pointer">
        <el-table-column prop="title" :label="$t('docs.title')" min-width="200" />
        <el-table-column prop="doc_type" :label="$t('docs.type')" width="120">
          <template #default="{ row }">
            <el-tag :type="docTypeTag(row.doc_type)" size="small">{{ docTypeLabel(row.doc_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="source_system" :label="$t('docs.source')" width="150" />
        <el-table-column prop="visibility" :label="$t('docs.visibility')" width="100" />
        <el-table-column :label="$t('docs.updatedAt')" width="180">
          <template #default="{ row }">
            {{ formatTime(row.updated_at) }}
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap" v-if="docStore.total > docStore.pageSize">
        <el-pagination
          v-model:current-page="docStore.currentPage"
          :page-size="docStore.pageSize"
          :total="docStore.total"
          layout="prev, pager, next"
          @current-change="loadDocuments"
        />
      </div>
    </div>

    <el-dialog
      v-model="showRecallDialog"
      :title="$t('docs.recallResults')"
      width="700px"
    >
      <div v-if="docStore.recallResults.length === 0" class="empty-state">
        {{ $t('docs.noRecallResults') }}
      </div>
      <div v-else class="recall-list">
        <div v-for="item in docStore.recallResults" :key="item.content_unit.id" class="recall-item">
          <div class="recall-header">
            <span class="recall-score">{{ (item.score * 100).toFixed(1) }}%</span>
            <el-tag size="small" :type="docTypeTag(item.document.doc_type)">{{ docTypeLabel(item.document.doc_type) }}</el-tag>
            <span class="recall-doc-title" @click="openDocById(item.document.id)" style="cursor:pointer;color:#409eff">
              {{ item.document.title }}
            </span>
            <span class="recall-unit-title">{{ item.content_unit.title }}</span>
          </div>
          <div class="recall-content">{{ item.content_unit.content }}</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDocStore } from '@/stores/doc'

const router = useRouter()
const docStore = useDocStore()

const filterDocType = ref('')
const recallQuery = ref('')
const recallScope = ref('all')
const showRecallDialog = ref(false)

function docTypeTag(type: string) {
  const m: Record<string, string> = { knowledge: '', contract: 'warning', department_doc: 'info', standard: 'success' }
  return m[type] || ''
}

function docTypeLabel(type: string) {
  const m: Record<string, string> = { knowledge: 'KB', contract: 'Contract', department_doc: 'Dept', standard: 'Std' }
  return m[type] || type
}

function formatTime(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleString()
}

function openDoc(row: any) {
  router.push(`/docs/${row.id}`)
}

function openDocById(id: string) {
  router.push(`/docs/${id}`)
}

async function loadDocuments() {
  await docStore.fetchDocuments({ doc_type: filterDocType.value || undefined })
}

async function doRecall() {
  if (!recallQuery.value.trim()) return
  await docStore.docRecall({
    query: recallQuery.value,
    scope: recallScope.value as any,
    top_k: 10,
  })
  showRecallDialog.value = true
}

onMounted(() => {
  loadDocuments()
})
</script>

<style scoped>
.docs-view { padding: 20px; max-width: 1200px; margin: 0 auto; }
.view-header { display: flex; align-items: center; margin-bottom: 16px; }
.view-title { font-size: 24px; margin: 0; }

.doc-filter { display: flex; gap: 12px; margin-bottom: 16px; }
.scope-select { width: 140px; }
.recall-input { flex: 1; }

.loading-state, .empty-state { padding: 60px 0; text-align: center; color: #999; font-size: 16px; }

.doc-table-wrap { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.pagination-wrap { margin-top: 16px; display: flex; justify-content: center; }

.recall-list { max-height: 500px; overflow-y: auto; }
.recall-item { border-bottom: 1px solid #eee; padding: 12px 0; }
.recall-item:last-child { border-bottom: none; }
.recall-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.recall-score { font-weight: bold; color: #409eff; min-width: 60px; }
.recall-doc-title { font-weight: 500; margin-left: 4px; }
.recall-unit-title { font-weight: 500; }
.recall-content { font-size: 13px; color: #666; line-height: 1.6; max-height: 80px; overflow: hidden; }
</style>
