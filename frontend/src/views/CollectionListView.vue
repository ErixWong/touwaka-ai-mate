<template>
  <div class="collection-list-view">
    <div class="view-header">
      <h1 class="view-title">文档集合</h1>
      <el-button type="primary" @click="showCreateDialog = true">新建集合</el-button>
    </div>

    <div class="collection-filter">
      <el-input
        v-model="searchQuery"
        placeholder="搜索集合名称..."
        @keyup.enter="loadCollections"
      >
        <template #append>
          <el-button @click="loadCollections">搜索</el-button>
        </template>
      </el-input>
    </div>

    <div v-if="store.isLoading && store.collections.length === 0" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="store.collections.length === 0" class="empty-state">
      <p>暂无文档集合</p>
      <el-button type="primary" @click="showCreateDialog = true">创建第一个集合</el-button>
    </div>

    <template v-else>
      <div class="collection-grid">
        <div
          v-for="col in store.collections"
          :key="col.id"
          class="collection-card"
          @click="openCollection(col)"
        >
          <div class="card-header">
            <div class="card-name">{{ col.name }}</div>
            <div class="card-actions">
              <el-button size="small" text @click.stop="openSettings(col)" title="设置">
                ⚙
              </el-button>
            </div>
          </div>
          <div class="card-desc" v-if="col.description">{{ col.description }}</div>
          <div class="card-stats">
            <span>{{ col.doc_count || 0 }} 篇文档</span>
            <span class="card-time">{{ formatTime(col.updated_at) }}</span>
          </div>
          <div class="card-footer">
            <el-tag size="small" :type="visibilityTagType(col.visibility)">
              {{ visibilityLabel(col.visibility) }}
            </el-tag>
          </div>
        </div>
      </div>

      <div class="pagination-wrap" v-if="store.total > store.pageSize">
        <el-pagination
          v-model:current-page="store.currentPage"
          :page-size="store.pageSize"
          :total="store.total"
          layout="prev, pager, next"
          @current-change="onPageChange"
        />
      </div>
    </template>

    <CreateCollectionModal
      v-model:visible="showCreateDialog"
      @created="onCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCollectionStore } from '@/stores/collection'
import CreateCollectionModal from '@/components/doc-collections/CreateCollectionModal.vue'

const router = useRouter()
const store = useCollectionStore()

const searchQuery = ref('')
const showCreateDialog = ref(false)

function visibilityLabel(v: string) {
  const map: Record<string, string> = {
    private: '私有',
    department: '部门',
    public: '公开',
  }
  return map[v] || v
}

function visibilityTagType(v: string) {
  const map: Record<string, string> = {
    private: 'info',
    department: 'warning',
    public: 'success',
  }
  return map[v] || 'info'
}

function formatTime(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleDateString('zh-CN')
}

function loadCollections() {
  store.fetchCollections({ query: searchQuery.value || undefined })
}

function onPageChange(page: number) {
  store.fetchCollections({ page, query: searchQuery.value || undefined })
}

function openCollection(col: any) {
  router.push(`/docs/collections/${col.id}`)
}

function openSettings(col: any) {
  router.push(`/docs/collections/${col.id}/settings`)
}

function onCreated() {
  showCreateDialog.value = false
  loadCollections()
}

onMounted(() => {
  loadCollections()
})
</script>

<style scoped>
.collection-list-view {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}
.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.view-title { font-size: 24px; font-weight: 600; margin: 0; }
.collection-filter { margin-bottom: 20px; max-width: 400px; }
.loading-state, .empty-state { text-align: center; padding: 60px 0; color: #999; }
.collection-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.collection-card {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.2s;
}
.collection-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.card-name { font-size: 16px; font-weight: 600; }
.card-desc { font-size: 13px; color: #909399; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-stats { display: flex; justify-content: space-between; font-size: 12px; color: #909399; margin-bottom: 12px; }
.card-footer { display: flex; gap: 8px; }
.pagination-wrap { margin-top: 24px; display: flex; justify-content: center; }
</style>
