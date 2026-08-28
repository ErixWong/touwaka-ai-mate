<template>
  <div class="docs-home">
    <ContextHeader
      :breadcrumbs="[{ label: $t('docs.navTitle') }]"
      :title="$t('docs.navTitle')"
      :description="isMobileView ? undefined : $t('docs.workspace.home.description')"
    >
      <template #actions>
        <el-tooltip :content="$t('docs.workspace.home.pipelineConfigTooltip')" placement="bottom">
          <el-button v-if="isAdmin" size="small" @click="showConfigDialog = true">
            <el-icon style="margin-right:4px"><Setting /></el-icon>{{ $t('docs.workspace.home.pipelineConfig') }}
          </el-button>
        </el-tooltip>
        <el-button type="primary" @click="showCreateDialog = true">
          {{ $t('docs.workspace.home.createCollection') }}
        </el-button>
      </template>
    </ContextHeader>

    <div class="collection-filter">
      <el-input
        v-model="collectionSearch"
        :placeholder="$t('docs.workspace.home.searchCollectionPlaceholder')"
        @keyup.enter="loadCollections"
      >
        <template #append>
          <el-button @click="loadCollections">{{ $t('common.search') }}</el-button>
        </template>
      </el-input>
    </div>

    <div v-if="collStore.isLoading && collStore.collections.length === 0" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="collStore.collections.length === 0" class="empty-state">
      <p>{{ $t('docs.workspace.home.noCollections') }}</p>
      <el-button type="primary" @click="showCreateDialog = true">{{ $t('docs.workspace.home.createFirstCollection') }}</el-button>
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
import { Setting } from '@element-plus/icons-vue'
import { useCollectionStore } from '@/stores/collection'
import { useUserStore } from '@/stores/user'
import ContextHeader from '@/components/docs/ContextHeader.vue'
import CollectionCard from '@/components/docs/CollectionCard.vue'
import CreateCollectionModal from '@/components/doc-collections/CreateCollectionModal.vue'
import DocPipelineConfigDialog from '@/components/docs/DocPipelineConfigDialog.vue'

const router = useRouter()
const collStore = useCollectionStore()
const userStore = useUserStore()

const isAdmin = computed(() => userStore.isAdmin)

const collectionSearch = ref('')
const showCreateDialog = ref(false)
const showConfigDialog = ref(false)

const isMobileView = ref(false)

try {
  const mq = window.matchMedia('(max-width: 640px)')
  isMobileView.value = mq.matches
  mq.addEventListener('change', (e) => { isMobileView.value = e.matches })
} catch (error) {
  console.error('matchMedia not supported:', error)
}

function openCollection(col: { id: string }) {
  router.push(`/docs/collections/${col.id}`)
}

function openSettings(col: { id: string }) {
  router.push(`/docs/collections/${col.id}/settings`)
}

async function loadCollections() {
  await collStore.fetchCollections({ query: collectionSearch.value || undefined })
}

function onCollPageChange(page: number) {
  collStore.fetchCollections({ page, query: collectionSearch.value || undefined })
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
.docs-home { width: 100%; max-width: 1400px; margin: 0 auto; padding: 24px; }
.collection-filter { margin-bottom: 20px; max-width: 400px; }
.loading-state, .empty-state { text-align: center; padding: 60px 0; color: #999; }
.collection-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.pagination-wrap { margin-top: 24px; display: flex; justify-content: center; }

@media (max-width: 640px) {
  .docs-home { padding: 16px; max-width: none; }
  .collection-grid { grid-template-columns: 1fr; }
}
</style>
