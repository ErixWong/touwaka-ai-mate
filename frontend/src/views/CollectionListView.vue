<template>
  <div class="docs-home">
    <ContextHeader
      :breadcrumbs="[{ label: $t('docs.navTitle') }]"
      :title="$t('docs.navTitle')"
      :description="isMobileView ? undefined : '文档搜索、检索与管理平台'"
    >
      <template #meta>
        <el-button size="small" @click="activeView = 'documents'" :type="activeView === 'documents' ? 'primary' : 'default'" plain>
          文档
        </el-button>
        <el-button size="small" @click="activeView = 'collections'" :type="activeView === 'collections' ? 'primary' : 'default'" plain>
          集合
        </el-button>
      </template>
      <template #actions>
        <el-button v-if="isAdmin" size="small" @click="showConfigDialog = true">
          <el-icon style="margin-right:4px"><Setting /></el-icon>配置
        </el-button>
        <el-button v-if="activeView === 'collections'" type="primary" @click="showCreateDialog = true">
          新建集合
        </el-button>
      </template>
    </ContextHeader>

    <DocSearchBar
      v-if="activeView === 'documents'"
      :doc-type="filterDocType"
      :recall-query="recallQuery"
      :recall-scope="recallScope"
      :recall-loading="docStore.isLoading"
      @update:doc-type="onDocTypeChange"
      @update:recall-query="recallQuery = $event"
      @update:recall-scope="recallScope = $event"
      @recall="doRecall"
    />

    <div v-if="activeView === 'collections'" class="collection-filter">
      <el-input
        v-model="collectionSearch"
        placeholder="搜索集合名称..."
        @keyup.enter="loadCollections"
      >
        <template #append>
          <el-button @click="loadCollections">搜索</el-button>
        </template>
      </el-input>
    </div>

    <div v-if="activeView === 'documents'">
      <div v-if="docStore.isLoading && docStore.documents.length === 0" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="docStore.documents.length === 0" class="empty-state">
        <p>{{ $t('docs.empty') }}</p>
      </div>

      <div v-else class="doc-table-wrap">
        <el-table :data="docStore.documents" stripe @row-click="openDoc" class="doc-table">
          <el-table-column prop="title" :label="$t('docs.title')" min-width="200">
            <template #default="{ row }">
              <span class="doc-title-link">{{ row.title }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="doc_type" :label="$t('docs.type')" width="110">
            <template #default="{ row }">
              <el-tag :type="docTypeTag(row.doc_type)" size="small">{{ docTypeLabel(row.doc_type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="处理状态" width="120">
            <template #default="{ row }">
              <DocStatusBadge :status="row.processing_status" />
            </template>
          </el-table-column>
          <el-table-column :label="$t('docs.updatedAt')" width="170">
            <template #default="{ row }">
              {{ formatTime(row.updated_at) }}
            </template>
          </el-table-column>
          <el-table-column :label="$t('docs.operations')" width="100" fixed="right">
            <template #default="{ row }">
              <el-button type="danger" link size="small" @click.stop="onDeleteDocument(row)">
                {{ $t('docs.delete') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrap" v-if="docStore.total > docStore.pageSize">
          <el-pagination
            v-model:current-page="docStore.currentPage"
            :page-size="docStore.pageSize"
            :total="docStore.total"
            layout="prev, pager, next"
            @current-change="onDocPageChange"
          />
        </div>
      </div>

      <el-dialog v-model="showRecallDialog" :title="$t('docs.recallResults')" width="700px">
        <div v-if="docStore.recallResults.length === 0" class="empty-state">
          {{ $t('docs.noRecallResults') }}
        </div>
        <div v-else class="recall-list">
          <div v-for="item in docStore.recallResults" :key="item.chunk.id" class="recall-item">
            <div class="recall-header">
              <span class="recall-score">{{ (item.score * 100).toFixed(1) }}%</span>
              <el-tag size="small" :type="docTypeTag(item.document.doc_type)">{{ docTypeLabel(item.document.doc_type) }}</el-tag>
              <span class="recall-doc-title" @click="openDocById(item.document.id, item.document.collection_id)">
                {{ item.document.title }}
              </span>
              <span class="recall-unit-title">{{ item.chunk.title }}</span>
            </div>
            <div class="recall-content">{{ item.chunk.content }}</div>
          </div>
        </div>
      </el-dialog>
    </div>

    <template v-else>
      <div v-if="collStore.isLoading && collStore.collections.length === 0" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="collStore.collections.length === 0" class="empty-state">
        <p>暂无文档集合</p>
        <el-button type="primary" @click="showCreateDialog = true">创建第一个集合</el-button>
      </div>

      <template v-else>
        <div class="collection-grid">
          <CollectionCard
            v-for="col in collStore.collections"
            :key="col.id"
            :collection="col"
            :show-settings="true"
            @open="openCollection(col)"
            @settings="openSettings(col)"
          />
        </div>

        <div class="pagination-wrap" v-if="collStore.total > collStore.pageSize">
          <el-pagination
            v-model:current-page="collStore.currentPage"
            :page-size="collStore.pageSize"
            :total="collStore.total"
            layout="prev, pager, next"
            @current-change="onCollPageChange"
          />
        </div>
      </template>
    </template>

    <CreateCollectionModal
      v-model:visible="showCreateDialog"
      @created="onCreated"
    />

    <DocPipelineConfigDialog v-model="showConfigDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Setting } from '@element-plus/icons-vue'
import { useCollectionStore } from '@/stores/collection'
import { useDocStore } from '@/stores/doc'
import { useUserStore } from '@/stores/user'
import ContextHeader from '@/components/docs/ContextHeader.vue'
import DocSearchBar from '@/components/docs/DocSearchBar.vue'
import DocStatusBadge from '@/components/docs/DocStatusBadge.vue'
import CollectionCard from '@/components/docs/CollectionCard.vue'
import CreateCollectionModal from '@/components/doc-collections/CreateCollectionModal.vue'
import DocPipelineConfigDialog from '@/components/docs/DocPipelineConfigDialog.vue'

const router = useRouter()
const collStore = useCollectionStore()
const docStore = useDocStore()
const userStore = useUserStore()

const isAdmin = computed(() => userStore.isAdmin)

const activeView = ref<'documents' | 'collections'>('documents')
const collectionSearch = ref('')
const showCreateDialog = ref(false)
const showConfigDialog = ref(false)

const filterDocType = ref('')
const recallQuery = ref('')
const recallScope = ref('all')
const showRecallDialog = ref(false)

const isMobileView = ref(false)

try {
  const mq = window.matchMedia('(max-width: 640px)')
  isMobileView.value = mq.matches
  mq.addEventListener('change', (e) => { isMobileView.value = e.matches })
} catch {}

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
  return new Date(t).toLocaleString('zh-CN')
}

function openDoc(row: { id: string; collection_id?: string | null }) {
  const query = row.collection_id ? `?fromCollection=${row.collection_id}` : ''
  router.push(`/docs/${row.id}${query}`)
}

function openDocById(id: string, collectionId?: string | null) {
  const query = collectionId ? `?fromCollection=${collectionId}` : ''
  router.push(`/docs/${id}${query}`)
}

function openCollection(col: { id: string }) {
  router.push(`/docs/collections/${col.id}`)
}

function openSettings(col: { id: string }) {
  router.push(`/docs/collections/${col.id}/settings`)
}

async function loadDocumentList() {
  await docStore.fetchDocuments({ doc_type: filterDocType.value || undefined })
}

async function loadCollections() {
  await collStore.fetchCollections({ query: collectionSearch.value || undefined })
}

function onDocTypeChange(val: string) {
  filterDocType.value = val
  loadDocumentList()
}

function onDocPageChange() {
  loadDocumentList()
}

function onCollPageChange(page: number) {
  collStore.fetchCollections({ page, query: collectionSearch.value || undefined })
}

async function doRecall() {
  if (!recallQuery.value.trim()) return
  await docStore.docRecall({
    query: recallQuery.value,
    scope: recallScope.value as 'all' | 'knowledge' | 'contract',
    top_k: 10,
  })
  showRecallDialog.value = true
}

async function onDeleteDocument(row: { id: string; title: string }) {
  try {
    await ElMessageBox.confirm(
      `确定删除文档「${row.title}」吗？此操作会同时删除文档记录、OCR结果和附件文件。`,
      '删除文档',
      { type: 'warning' },
    )
    const ok = await docStore.removeDocument(row.id)
    if (!ok) {
      ElMessage.error(docStore.error || '删除文档失败')
      return
    }
    ElMessage.success('文档已删除')
    if (docStore.documents.length === 0 && docStore.currentPage > 1) {
      docStore.currentPage -= 1
    }
    await loadDocumentList()
  } catch (error: unknown) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(docStore.error || '删除文档失败')
  }
}

function onCreated() {
  showCreateDialog.value = false
  loadCollections()
}

onMounted(() => {
  loadDocumentList()
  loadCollections()
})
</script>

<style scoped>
.docs-home { max-width: 960px; margin: 0 auto; padding: 24px; }
.collection-filter { margin-bottom: 20px; max-width: 400px; }
.loading-state, .empty-state { text-align: center; padding: 60px 0; color: #999; }
.collection-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.pagination-wrap { margin-top: 24px; display: flex; justify-content: center; }

.doc-table-wrap { background: #fff; border-radius: 8px; border: 1px solid #ebeef5; }
.doc-table { cursor: pointer; }
.doc-title-link { color: #409eff; cursor: pointer; }
.doc-title-link:hover { text-decoration: underline; }

.recall-list { max-height: 500px; overflow-y: auto; }
.recall-item { border-bottom: 1px solid #eee; padding: 12px 0; }
.recall-item:last-child { border-bottom: none; }
.recall-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.recall-score { font-weight: bold; color: #409eff; min-width: 60px; }
.recall-doc-title { font-weight: 500; margin-left: 4px; color: #409eff; cursor: pointer; }
.recall-unit-title { font-weight: 500; }
.recall-content { font-size: 13px; color: #666; line-height: 1.6; max-height: 80px; overflow: hidden; }

@media (max-width: 640px) {
  .docs-home { padding: 16px; max-width: none; }
  .collection-grid { grid-template-columns: 1fr; }
}
</style>
