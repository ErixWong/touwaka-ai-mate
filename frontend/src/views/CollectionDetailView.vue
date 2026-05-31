<template>
  <div class="collection-detail-view">
    <div class="view-header">
      <el-button text @click="goBack">← 返回集合列表</el-button>
      <div class="header-right">
        <el-button @click="goSettings">设置</el-button>
      </div>
    </div>

    <div v-if="store.isLoading && !store.currentCollection" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <template v-else-if="store.currentCollection">
      <div class="collection-info">
        <h1 class="collection-name">{{ store.currentCollection.name }}</h1>
        <p v-if="store.currentCollection.description" class="collection-desc">{{ store.currentCollection.description }}</p>
        <div class="collection-meta">
          <el-tag size="small" :type="visibilityTagType(store.currentCollection.visibility)">
            {{ visibilityLabel(store.currentCollection.visibility) }}
          </el-tag>
          <span>{{ store.currentCollection.doc_count || 0 }} 篇文档</span>
        </div>
      </div>

      <div class="doc-list-section">
        <div class="section-header">
          <h3>文档列表</h3>
        </div>

        <div v-if="store.isLoading && store.collectionDocuments.length === 0" class="loading-state">
          {{ $t('common.loading') }}
        </div>

        <div v-else-if="store.collectionDocuments.length === 0" class="empty-state">
          <p>暂无文档</p>
        </div>

        <div v-else class="doc-table-wrap">
          <el-table :data="store.collectionDocuments" stripe>
            <el-table-column label="文档标题">
              <template #default="{ row }">
                <span class="doc-title-link" @click="openDoc(row.document.id)">{{ row.document.title }}</span>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="120">
              <template #default="{ row }">
                <el-tag size="small">{{ row.document.doc_type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="row.document.lifecycle_status === 'active' ? 'success' : 'info'">
                  {{ row.document.lifecycle_status === 'active' ? '活跃' : '已归档' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="更新时间" width="180">
              <template #default="{ row }">
                {{ formatTime(row.document.updated_at) }}
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
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCollectionStore } from '@/stores/collection'

const route = useRoute()
const router = useRouter()
const store = useCollectionStore()

const collectionId = route.params.id as string

function visibilityLabel(v: string) {
  const map: Record<string, string> = { private: '私有', department: '部门', public: '公开' }
  return map[v] || v
}

function visibilityTagType(v: string) {
  const map: Record<string, string> = { private: 'info', department: 'warning', public: 'success' }
  return map[v] || 'info'
}

function formatTime(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleDateString('zh-CN')
}

function goBack() {
  router.push('/docs')
}

function goSettings() {
  router.push(`/docs/collections/${collectionId}/settings`)
}

function openDoc(documentId: string) {
  router.push(`/docs/${documentId}`)
}

function onDocPageChange(page: number) {
  store.fetchCollectionDocuments(collectionId, { page })
}

onMounted(async () => {
  await store.fetchCollection(collectionId)
  if (store.currentCollection) {
    await store.fetchCollectionDocuments(collectionId)
  }
})
</script>

<style scoped>
.collection-detail-view { max-width: 960px; margin: 0 auto; padding: 24px; }
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.collection-info { margin-bottom: 32px; }
.collection-name { font-size: 24px; font-weight: 600; margin: 0 0 8px 0; }
.collection-desc { color: #606266; margin: 0 0 12px 0; }
.collection-meta { display: flex; gap: 12px; align-items: center; font-size: 13px; color: #909399; }
.doc-list-section { margin-top: 24px; }
.section-header { margin-bottom: 12px; }
.section-header h3 { margin: 0; font-size: 16px; }
.doc-title-link { color: #409eff; cursor: pointer; }
.doc-title-link:hover { text-decoration: underline; }
.pagination-wrap { margin-top: 16px; display: flex; justify-content: center; }
.loading-state, .empty-state { text-align: center; padding: 40px 0; color: #999; }
</style>
