<template>
  <div class="collection-workspace">
    <ContextHeader
      :breadcrumbs="breadcrumbs"
      :title="store.currentCollection?.name || '集合'"
      :description="store.currentCollection?.description || undefined"
    >
      <template #meta>
        <VisibilityTag :visibility="store.currentCollection?.visibility || ''" />
        <span>{{ store.currentCollection?.doc_count || 0 }} 篇文档</span>
        <span v-if="store.currentCollection?.updated_at" class="update-time">
          更新于 {{ formatDate(store.currentCollection.updated_at) }}
        </span>
      </template>
      <template #actions>
        <el-upload
          :show-file-list="false"
          :auto-upload="false"
          :on-change="handleFileChange"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
        >
          <el-button type="primary" :loading="store.isUploadingDocument">上传文档</el-button>
        </el-upload>
        <el-button @click="goSettings">设置</el-button>
      </template>
    </ContextHeader>

    <div v-if="store.isLoading && !store.currentCollection" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <template v-else-if="store.currentCollection">
      <div class="doc-workspace-area">
        <div class="doc-toolbar">
          <div class="toolbar-left">
            <el-input
              v-model="docSearch"
              placeholder="搜索文档标题..."
              class="toolbar-search"
              clearable
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-select v-model="statusFilter" placeholder="处理状态" clearable class="toolbar-select">
              <el-option label="全部状态" value="" />
              <el-option label="待OCR" value="pending_ocr" />
              <el-option label="OCR处理中" value="ocr_processing" />
              <el-option label="待文本清洗" value="pending_clean" />
              <el-option label="已就绪" value="ready" />
              <el-option label="处理失败" value="error" />
            </el-select>
          </div>
        </div>

        <div v-if="store.isLoading && store.collectionDocuments.length === 0" class="loading-state">
          {{ $t('common.loading') }}
        </div>

        <div v-else-if="hasActiveFilter && store.collectionDocuments.length === 0" class="empty-state">
          <p>无匹配文档</p>
          <el-button text type="primary" @click="clearFilters">清除筛选</el-button>
        </div>

        <div v-else-if="store.collectionDocuments.length === 0" class="empty-state">
          <p>暂无文档</p>
        </div>

        <div v-else class="doc-table-wrap">
          <el-table :data="store.collectionDocuments" stripe>
            <el-table-column label="文档标题" min-width="200">
              <template #default="{ row }">
                <span class="doc-title-link" @click="openDoc(row.id)">{{ row.title }}</span>
              </template>
            </el-table-column>
            <el-table-column label="上传时间" width="170">
              <template #default="{ row }">
                {{ formatTime(row.source_attachment?.created_at || row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column label="当前版本" width="120">
              <template #default="{ row }">
                <span>{{ row.current_revision?.revision_label || row.current_revision?.revision_no || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="处理状态" width="120">
              <template #default="{ row }">
                <DocStatusBadge :status="row.processing_status" :ocr-status="row.ocr_status" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="danger" link @click.stop="onDeleteDocument(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-wrap" v-if="store.docTotal > store.pageSize">
            <el-pagination
              v-model:current-page="store.docPage"
              :page-size="store.pageSize"
              :total="store.docTotal"
              layout="prev, pager, next"
              @current-change="onDocPageChange"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCollectionStore } from '@/stores/collection'
import { useDocStore } from '@/stores/doc'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import ContextHeader from '@/components/docs/ContextHeader.vue'
import VisibilityTag from '@/components/docs/VisibilityTag.vue'
import DocStatusBadge from '@/components/docs/DocStatusBadge.vue'

const route = useRoute()
const router = useRouter()
const store = useCollectionStore()
const docStore = useDocStore()

const collectionId = route.params.id as string
const docSearch = ref('')
const statusFilter = ref('')

let searchTimer: ReturnType<typeof setTimeout> | undefined

const breadcrumbs = computed(() => [
  { label: '文档平台', to: '/docs' },
  { label: store.currentCollection?.name || '集合' },
])

const hasActiveFilter = computed(() => !!(docSearch.value || statusFilter.value))

function doSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    store.docPage = 1
    loadDocuments()
  }, 300)
}

watch(docSearch, () => doSearch())
watch(statusFilter, () => doSearch())

function loadDocuments() {
  store.fetchCollectionDocuments(collectionId, {
    page: store.docPage,
    keyword: docSearch.value || undefined,
    processing_status: statusFilter.value || undefined,
  })
}

function clearFilters() {
  docSearch.value = ''
  statusFilter.value = ''
}

function formatDate(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleDateString('zh-CN')
}

function formatTime(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN')
}

function goSettings() {
  router.push(`/docs/collections/${collectionId}/settings`)
}

function openDoc(documentId: string) {
  router.push(`/docs/${documentId}?fromCollection=${collectionId}`)
}

async function handleFileChange(uploadFile: UploadFile) {
  const rawFile = uploadFile.raw
  if (!rawFile) return

  const result = await store.uploadDocumentToCollection(collectionId, rawFile)
  if (!result) {
    ElMessage.error(store.error || '上传文档失败')
    return
  }

  ElMessage.success('文档已上传并提交识别')
  router.push(`/docs/${result.intake.document_id}?fromCollection=${collectionId}`)
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
    await store.fetchCollection(collectionId)
    await loadDocuments()
  } catch (error: unknown) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(docStore.error || '删除文档失败')
  }
}

function onDocPageChange() {
  loadDocuments()
}

onMounted(async () => {
  await store.fetchCollection(collectionId)
  if (store.currentCollection) {
    await loadDocuments()
  }
})
</script>

<style scoped>
.collection-workspace { max-width: 960px; margin: 0 auto; padding: 24px; }
.loading-state, .empty-state { text-align: center; padding: 40px 0; color: #999; }

.doc-workspace-area { margin-top: 8px; }
.doc-toolbar { margin-bottom: 16px; }
.toolbar-left { display: flex; gap: 8px; align-items: center; }
.toolbar-search { width: 220px; }
.toolbar-select { width: 140px; }

.doc-table-wrap { background: #fff; border-radius: 8px; border: 1px solid #ebeef5; }
.doc-title-link { color: #409eff; cursor: pointer; }
.doc-title-link:hover { text-decoration: underline; }
.pagination-wrap { margin-top: 16px; display: flex; justify-content: center; }

.update-time { color: #c0c4cc; }

@media (max-width: 640px) {
  .collection-workspace { padding: 16px; max-width: none; }
  .toolbar-left { flex-wrap: wrap; }
  .toolbar-search { width: 100%; flex-basis: 100%; }
  .toolbar-select { width: calc(50% - 4px); flex-basis: calc(50% - 4px); }
}
</style>
