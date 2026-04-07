<template>
  <div class="kb-view">
    <div class="view-header">
      <h1 class="view-title">{{ $t('knowledgeBase.title') }}</h1>
      <button class="btn-primary" @click="showCreateDialog = true">
        <span class="icon">+</span>
        {{ $t('knowledgeBase.createNew') }}
      </button>
    </div>

    <!-- Search -->
    <div class="kb-filter">
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        :placeholder="$t('knowledgeBase.searchPlaceholder')"
        @keyup.enter="searchQuery.trim() && performGlobalSearch()"
      />
      <button
        class="btn-search"
        @click="performGlobalSearch"
        :disabled="!searchQuery.trim() || kbStore.isSearching"
      >
        🔍 {{ kbStore.isSearching ? $t('common.loading') : $t('knowledgeBase.search') }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="kbStore.isLoading && kbStore.knowledgeBases.length === 0" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <!-- Empty State -->
    <div v-else-if="totalCount === 0" class="empty-state">
      <div class="empty-icon">📚</div>
      <p>{{ $t('knowledgeBase.empty') }}</p>
      <button class="btn-primary" @click="showCreateDialog = true">
        {{ $t('knowledgeBase.addFirst') }}
      </button>
    </div>

    <!-- Knowledge Base Content with Pagination -->
    <template v-else>
      <!-- Scrollable content area -->
      <div class="kb-content-wrapper">
        <div class="kb-grid">
          <!-- KB Cards -->
          <div
            v-for="kb in kbStore.knowledgeBases"
            :key="kb.id"
            class="kb-card"
            @click="openKbDetail(kb)"
            @contextmenu.prevent="showContextMenu($event, kb)"
          >
            <div class="kb-card-header">
              <div class="kb-card-icon">{{ getKbIcon(kb) }}</div>
              <div class="kb-card-name">{{ kb.name }}</div>
              <div class="kb-card-actions">
                <button v-if="kb.can_edit" class="kb-action-btn" @click.stop="editKb(kb)" :title="$t('common.edit')">✏️</button>
                <button v-if="kb.can_delete" class="kb-action-btn danger" @click.stop="deleteKb(kb)" :title="$t('common.delete')">🗑️</button>
              </div>
            </div>
            <div class="kb-card-desc" v-if="kb.description">{{ kb.description }}</div>
            <div class="kb-card-stats">
              <span>{{ $t('knowledgeBase.paragraphCount', { count: kb.paragraph_count || 0 }) }}</span>
              <span class="kb-card-dim">{{ kb.embedding_dim || 384 }}D</span>
              <span class="kb-card-time">{{ formatUpdatedTime(kb.updated_at) }}</span>
            </div>
            <div class="kb-card-footer">
              <span class="visibility-badge" :class="'visibility-' + (kb.visibility || 'owner')">
                {{ $t('knowledgeBase.visibility.' + (kb.visibility || 'owner')) }}
              </span>
              <span v-if="kb.is_owner" class="owner-badge">{{ $t('knowledgeBase.permissionOwner') }}</span>
            </div>
            <div class="kb-card-users">
              <span class="user-badge" :title="$t('knowledgeBase.creator') + ': ' + kb.creator_name">
                👤 {{ kb.creator_name }}
              </span>
              <span class="user-badge" :title="$t('knowledgeBase.owner') + ': ' + kb.owner_name">
                🔑 {{ kb.owner_name }}
              </span>
            </div>
            <div class="kb-card-model" v-if="kb.embedding_model_id && kb.embedding_model_id !== 'local'">
              <span class="model-badge">{{ getModelName(kb.embedding_model_id) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagination - fixed at bottom -->
      <div class="pagination">
        <div class="pagination-debug" v-if="false">
          totalPages: {{ totalPages }}, currentPage: {{ currentPage }}, totalCount: {{ totalCount }}
        </div>
        <button
          class="page-btn"
          :disabled="currentPage === 1"
          @click="changePage(currentPage - 1)"
        >
          ← {{ $t('pagination.prev') }}
        </button>
        <div class="page-info">
          <span>{{ $t('pagination.info', { total: totalCount }) }}</span>
          <span class="page-numbers">
            <button
              v-for="page in visiblePages"
              :key="page"
              class="page-num"
              :class="{ active: page === currentPage }"
              @click="changePage(page)"
            >
              {{ page }}
            </button>
          </span>
          <!-- 每页数量选择器 -->
          <select v-model="pageSize" class="page-size-select" @change="handlePageSizeChange">
            <option v-for="size in pageSizeOptions" :key="size" :value="size">
              {{ size }}/页
            </option>
          </select>
        </div>
        <button
          class="page-btn"
          :disabled="currentPage === totalPages"
          @click="changePage(currentPage + 1)"
        >
          {{ $t('pagination.next') }} →
        </button>
      </div>
    </template>

    <!-- Create/Edit Dialog -->
    <div v-if="showCreateDialog || editingKb" class="dialog-overlay">
      <div class="dialog">
        <h3 class="dialog-title">
          {{ editingKb ? $t('knowledgeBase.editTitle') : $t('knowledgeBase.createTitle') }}
        </h3>
        <div class="dialog-body">
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.nameLabel') }}</label>
            <input
              v-model="formData.name"
              type="text"
              class="form-input"
              :placeholder="$t('knowledgeBase.namePlaceholder')"
            />
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.descriptionLabel') }}</label>
            <textarea
              v-model="formData.description"
              class="form-textarea"
              :placeholder="$t('knowledgeBase.descriptionPlaceholder')"
              rows="3"
            ></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.visibilityLabel') }}</label>
            <select v-model="formData.visibility" class="form-select">
              <option value="owner">{{ $t('knowledgeBase.visibility.owner') }}</option>
              <option value="department">{{ $t('knowledgeBase.visibility.department') }}</option>
              <option value="all">{{ $t('knowledgeBase.visibility.all') }}</option>
            </select>
            <p class="form-hint">{{ $t('knowledgeBase.visibilityHint') }}</p>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('knowledgeBase.embeddingModelLabel') }}</label>
            <select v-model="formData.embedding_model_id" class="form-select" :disabled="embeddingModels.length === 0">
              <option v-for="model in embeddingModels" :key="model.id" :value="model.id">
                {{ model.name }}
              </option>
            </select>
            <p v-if="embeddingModels.length === 0" class="form-error">
              {{ $t('knowledgeBase.noEmbeddingModelError') || '请先配置 Embedding 模型' }}
            </p>
            <p v-else class="form-hint">{{ $t('knowledgeBase.embeddingModelHint') }}</p>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeDialog">{{ $t('common.cancel') }}</button>
          <button
            class="btn-primary"
            :disabled="!formData.name.trim() || isSubmitting"
            @click="submitForm"
          >
            {{ isSubmitting ? $t('common.saving') : $t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Context Menu -->
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <div v-if="contextMenu.kb?.can_edit" class="context-menu-item" @click="editKb(contextMenu.kb!)">
        {{ $t('common.edit') }}
      </div>
      <div v-if="contextMenu.kb?.can_delete" class="context-menu-item danger" @click="deleteKb(contextMenu.kb!)">
        {{ $t('common.delete') }}
      </div>
    </div>

    <!-- Delete Confirm Dialog -->
    <div v-if="deletingKb" class="dialog-overlay">
      <div class="dialog dialog-small">
        <h3 class="dialog-title">{{ $t('knowledgeBase.deleteConfirm') }}</h3>
        <div class="dialog-body">
          <p>{{ $t('knowledgeBase.deleteConfirmMessage', { name: deletingKb.name }) }}</p>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="deletingKb = null">{{ $t('common.cancel') }}</button>
          <button class="btn-danger" @click="confirmDelete">
            {{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Global Search Dialog -->
    <div v-if="showGlobalSearchDialog" class="dialog-overlay">
      <div class="dialog dialog-large">
        <h3 class="dialog-title">{{ $t('knowledgeBase.globalSearch') || '全局搜索' }}</h3>
        <div class="dialog-body">
          <div v-if="kbStore.isSearching" class="search-loading">
            {{ $t('common.loading') }}
          </div>

          <div v-else-if="kbStore.searchResults.length > 0" class="search-results">
            <h4>{{ $t('knowledgeBase.searchResult.title') }} ({{ kbStore.searchResults.length }})</h4>
            <div
              v-for="result in kbStore.searchResults"
              :key="result.paragraph.id"
              class="search-result-item"
            >
              <div class="result-score">
                {{ Math.round(result.score * 100) }}%
              </div>
              <div class="result-content">
                <div class="result-kb" v-if="result.knowledge_base">
                  📚 {{ result.knowledge_base.name }}
                </div>
                <div class="result-location" v-if="result.article">
                  📖 {{ result.article.title }}<span v-if="result.section"> > {{ result.section.title }}</span>
                </div>
                <div class="result-text" v-html="renderMarkdown(result.paragraph.content)"></div>
              </div>
            </div>
          </div>

          <div v-else-if="hasGlobalSearched" class="search-empty">
            {{ $t('knowledgeBase.searchResult.empty') }}
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="closeGlobalSearchDialog">{{ $t('common.close') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { useModelStore } from '@/stores/model'
import { useToastStore } from '@/stores/toast'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { KnowledgeBase } from '@/types'

const { t } = useI18n()
const router = useRouter()
const kbStore = useKnowledgeBaseStore()
const modelStore = useModelStore()
const toast = useToastStore()

// State
const searchQuery = ref('')
const showCreateDialog = ref(false)
const editingKb = ref<KnowledgeBase | null>(null)
const deletingKb = ref<KnowledgeBase | null>(null)
const isSubmitting = ref(false)
const showGlobalSearchDialog = ref(false)
const hasGlobalSearched = ref(false)
const formData = ref({
  name: '',
  description: '',
  visibility: 'owner' as 'owner' | 'department' | 'all',
  embedding_model_id: '' as string | number,
})

// Pagination state
const currentPage = ref(1)
const pageSize = ref(12)
const totalCount = ref(0)
const totalPages = ref(0)

// 可选的每页数量选项
const pageSizeOptions = [8, 12, 16, 24, 32]

// 获取 embedding 模型列表
const embeddingModels = computed(() => {
  return modelStore.models.filter(
    (m: any) => m.model_type === 'embedding'
  )
})

// 获取选中模型的 embedding_dim
const selectedEmbeddingDim = computed(() => {
  if (!formData.value.embedding_model_id) {
    return 384 // 默认本地模型维度
  }
  const model = embeddingModels.value.find(
    (m: any) => m.id === formData.value.embedding_model_id
  )
  return model?.embedding_dim || 384
})

// Context menu
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  kb: null as KnowledgeBase | null,
})

// Computed
// 可见的页码
const visiblePages = computed(() => {
  const pages: number[] = []
  const total = totalPages.value
  const current = currentPage.value

  // 显示当前页前后各2页
  let start = Math.max(1, current - 2)
  let end = Math.min(total, current + 2)

  // 确保至少显示5页
  if (end - start < 4) {
    if (start === 1) {
      end = Math.min(total, start + 4)
    } else if (end === total) {
      start = Math.max(1, end - 4)
    }
  }

  for (let i = start; i <= end; i++) {
    pages.push(i)
  }

  return pages
})

// Methods
const getKbIcon = (kb: KnowledgeBase) => {
  // 可以根据知识库名称或类型返回不同图标
  const icons = ['📚', '📖', '📁', '📝', '🔧', '💡', '📊', '🎯']
  const index = Number(kb.id) % icons.length
  return icons[index]
}

// 获取模型名称
const getModelName = (modelId: string) => {
  const model = modelStore.models.find((m: any) => m.id === modelId)
  return model?.name || modelId
}

const formatUpdatedTime = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return t('tasks.today')
  if (days === 1) return t('tasks.yesterday')
  return t('knowledgeBase.updatedAgo', { time: t('tasks.daysAgo', { count: days }) })
}

const openKbDetail = (kb: KnowledgeBase) => {
  router.push({ name: 'knowledge-detail', params: { kbId: kb.id } })
}

const closeDialog = () => {
  showCreateDialog.value = false
  editingKb.value = null
  formData.value = { name: '', description: '', visibility: 'owner', embedding_model_id: '' }
}

const submitForm = async () => {
  if (!formData.value.name.trim()) return

  // 检查是否有可用的 embedding 模型
  if (embeddingModels.value.length === 0) {
    toast.error(t('knowledgeBase.noEmbeddingModelError') || '请先配置 Embedding 模型')
    return
  }

  // 检查是否选择了 embedding 模型
  if (!formData.value.embedding_model_id) {
    toast.error(t('knowledgeBase.selectEmbeddingModelError') || '请选择 Embedding 模型')
    return
  }

  isSubmitting.value = true
  try {
    // 转换 embedding_model_id 为字符串
    const embeddingModelId = String(formData.value.embedding_model_id)

    if (editingKb.value) {
      await kbStore.updateKnowledgeBase(editingKb.value.id, {
        name: formData.value.name,
        description: formData.value.description,
        visibility: formData.value.visibility,
        embedding_model_id: embeddingModelId,
        embedding_dim: selectedEmbeddingDim.value,
      })
    } else {
      await kbStore.createKnowledgeBase({
        name: formData.value.name,
        description: formData.value.description,
        visibility: formData.value.visibility,
        embedding_model_id: embeddingModelId,
        embedding_dim: selectedEmbeddingDim.value,
      })
      // 创建后刷新当前页
      await loadKbsWithPagination()
    }
    closeDialog()
  } catch (error) {
    console.error('Failed to save knowledge base:', error)
  } finally {
    isSubmitting.value = false
  }
}

const showContextMenu = (event: MouseEvent, kb: KnowledgeBase) => {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    kb,
  }
}

const hideContextMenu = () => {
  contextMenu.value.visible = false
  contextMenu.value.kb = null
}

const editKb = (kb: KnowledgeBase) => {
  hideContextMenu()
  editingKb.value = kb
  formData.value = {
    name: kb.name,
    description: kb.description || '',
    visibility: (kb as any).visibility || 'owner',
    embedding_model_id: (kb as any).embedding_model_id || '',
  }
}

const deleteKb = (kb: KnowledgeBase) => {
  hideContextMenu()
  deletingKb.value = kb
}

const confirmDelete = async () => {
  if (!deletingKb.value) return

  try {
    await kbStore.deleteKnowledgeBase(deletingKb.value.id)
    deletingKb.value = null
    // 删除后刷新当前页
    await loadKbsWithPagination()
  } catch (error) {
    console.error('Failed to delete knowledge base:', error)
  }
}

// Global search
const performGlobalSearch = async () => {
  if (!searchQuery.value.trim()) return

  hasGlobalSearched.value = false
  showGlobalSearchDialog.value = true

  try {
    await kbStore.globalSearch(searchQuery.value, 10, 0.5)
    hasGlobalSearched.value = true
  } catch (error) {
    console.error('Global search failed:', error)
  }
}

const closeGlobalSearchDialog = () => {
  showGlobalSearchDialog.value = false
  hasGlobalSearched.value = false
  kbStore.clearSearchResults()
}

const renderMarkdown = (content: string) => {
  try {
    // 使用 DOMPurify 净化 HTML，防止 XSS 攻击
    const rawHtml = marked(content) as string
    return DOMPurify.sanitize(rawHtml)
  } catch {
    return content
  }
}

// Click outside to close context menu
const handleClickOutside = () => {
  hideContextMenu()
}

// Pagination methods
const loadKbsWithPagination = async () => {
  try {
    // 如果当前页大于总页数（删除后可能出现），则跳转到最后一页或第一页
    if (currentPage.value > totalPages.value && totalPages.value > 0) {
      currentPage.value = totalPages.value
    }

    const response = await kbStore.loadKnowledgeBases({
      page: currentPage.value,
      pageSize: pageSize.value,
    })
    console.log('[KB] API response:', response)
    if (response) {
      // 后端返回符合 API 查询设计规范的嵌套结构：{ items, pagination }
      // 参考：docs/database/api-query-design.md
      const pagination = response.pagination || {}
      totalCount.value = pagination.total || 0
      totalPages.value = pagination.pages || 1

      // 如果删除后当前页没有数据，且不是第一页，则跳转到前一页
      if (kbStore.knowledgeBases.length === 0 && currentPage.value > 1) {
        currentPage.value = currentPage.value - 1
        await loadKbsWithPagination()
        return
      }

      console.log('[KB] Pagination:', { total: totalCount.value, pages: totalPages.value, current: currentPage.value })
    }
  } catch (error) {
    console.error('Failed to load knowledge bases:', error)
  }
}

// 切换每页数量
const handlePageSizeChange = async () => {
  currentPage.value = 1 // 重置到第一页
  await loadKbsWithPagination()
}

const changePage = async (page: number) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  await loadKbsWithPagination()
}

// Lifecycle
onMounted(() => {
  loadKbsWithPagination()
  modelStore.loadModels() // 加载模型列表
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.kb-view *,
.kb-view *::before,
.kb-view *::after {
  box-sizing: border-box;
}

.kb-view {
  padding: 16px 24px;
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  background: #fff;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  border-bottom: 1px dashed rgba(0, 0, 0, 0.06);
}

.view-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
  color: #1e293b;
  letter-spacing: -0.02em;
}

/* Filter */
.kb-filter {
  margin-bottom: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.search-input {
  width: 100%;
  max-width: 360px;
  padding: 10px 16px;
  border: 1px solid rgba(203, 213, 225, 0.8);
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
  transition: all 0.2s ease;
}

.search-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  outline: none;
}

.btn-search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
  white-space: nowrap;
}

.btn-search:hover:not(:disabled) {
  box-shadow: 0 4px 16px rgba(33, 150, 243, 0.4);
  transform: translateY(-1px);
}

.btn-search:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

/* Global Search Dialog */
.dialog-large {
  max-width: 640px;
}

.search-loading,
.search-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-secondary, #666);
}

.search-results h4 {
  margin: 0 0 16px 0;
  font-size: 14px;
  color: var(--text-secondary, #666);
}

.search-result-item {
  display: flex;
  gap: 16px;
  padding: 12px;
  background: var(--secondary-bg, #f8f9fa);
  border-radius: 8px;
  margin-bottom: 12px;
}

.result-score {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary-color, #2196f3);
  min-width: 48px;
}

.result-content {
  flex: 1;
}

.result-kb {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  margin-bottom: 4px;
}

.result-location {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
  margin-bottom: 4px;
}

.result-text {
  font-size: 14px;
  color: var(--text-secondary, #666);
  line-height: 1.5;
}

.result-text :deep(p) {
  margin: 0 0 8px 0;
}

.result-text :deep(code) {
  background: var(--border-color, #e0e0e0);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

/* Loading and Empty */
.loading-state,
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-secondary, #666);
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state p {
  margin-bottom: 24px;
}

/* Knowledge Base Content Wrapper */
.kb-content-wrapper {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Knowledge Base Grid */
.kb-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 8px;
  box-sizing: border-box;
  overflow-y: auto;
  flex: 1;
  align-content: start;
}

.kb-card {
  position: relative;
  padding: 16px;
  padding-left: 20px;
  background: linear-gradient(145deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  min-height: 130px;
  box-sizing: border-box;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.03);
  overflow: hidden;
}

/* 书脊效果 - 左侧彩色条 */
.kb-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%);
  border-radius: 10px 0 0 10px;
  transition: width 0.25s ease;
}

.kb-card:hover {
  box-shadow: 0 8px 25px rgba(59, 130, 246, 0.15);
  transform: translateY(-3px);
  border-color: rgba(59, 130, 246, 0.3);
}

.kb-card:hover::before {
  width: 5px;
}

.kb-card-icon {
  font-size: 28px;
  margin-right: 10px;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
}

.kb-card-header {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
  position: relative;
}

.kb-card-actions {
  position: absolute;
  right: 0;
  top: 0;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.kb-card:hover .kb-card-actions {
  opacity: 1;
}

.kb-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.kb-action-btn:hover {
  background: #fff;
  transform: scale(1.1);
}

.kb-action-btn.danger:hover {
  background: #fee2e2;
}

.kb-card-name {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.4;
}

.kb-card-desc {
  font-size: 12px;
  color: var(--text-secondary, #5a6a7a);
  margin-bottom: 8px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.kb-card-stats {
  font-size: 11px;
  color: var(--text-secondary, #6b7c8c);
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.kb-card-time {
  font-size: 10px;
  color: var(--text-tertiary, #9aa5b1);
}

.kb-card-dim {
  font-size: 10px;
  color: var(--text-tertiary, #9aa5b1);
  background: var(--secondary-bg, #f0f0f0);
  padding: 2px 6px;
  border-radius: 4px;
}

.kb-card-model {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
}

/* 当显示操作按钮时，调整模型徽章位置 */
.kb-card:hover .kb-card-model {
  right: 60px;
}

.model-badge {
  font-size: 10px;
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

/* KB Card Footer - Visibility & Owner badges */
.kb-card-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(0, 0, 0, 0.06);
}

.visibility-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.visibility-badge.visibility-owner {
  color: #6b7280;
  background: rgba(107, 114, 128, 0.1);
}

.visibility-badge.visibility-department {
  color: #059669;
  background: rgba(5, 150, 105, 0.1);
}

.visibility-badge.visibility-all {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
}

.owner-badge {
  font-size: 10px;
  color: #d97706;
  background: rgba(217, 119, 6, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

/* KB Card Users - Creator and Owner */
.kb-card-users {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(0, 0, 0, 0.06);
}

.user-badge {
  font-size: 11px;
  color: #64748b;
  background: rgba(100, 116, 139, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

/* Dialog */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
}

.dialog-small {
  max-width: 400px;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-primary, #333);
}

.dialog-body {
  padding: 24px;
  overflow-y: auto;
  max-height: 60vh;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

/* Form */
.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
  color: var(--text-primary, #333);
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.form-select {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 14px;
  background: white;
  cursor: pointer;
}

.form-select:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
}

.form-hint {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-top: 4px;
}

.form-error {
  font-size: 12px;
  color: #ef4444;
  margin-top: 4px;
}

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
}

.btn-primary:hover:not(:disabled) {
  box-shadow: 0 4px 16px rgba(33, 150, 243, 0.4);
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

.btn-cancel {
  padding: 10px 20px;
  background: #f8f9fa;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 10px;
  font-size: 14px;
  color: var(--text-secondary, #5a6a7a);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel:hover {
  background: #e9ecef;
  border-color: #ced4da;
}

.btn-danger {
  padding: 10px 20px;
  background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(244, 67, 54, 0.3);
}

.btn-danger:hover {
  box-shadow: 0 4px 16px rgba(244, 67, 54, 0.4);
  transform: translateY(-1px);
}

/* Context Menu */
.context-menu {
  position: fixed;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  z-index: 1001;
  min-width: 120px;
}

.context-menu-item {
  padding: 10px 16px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-primary, #333);
}

.context-menu-item:hover {
  background: var(--secondary-bg, #f5f5f5);
}

.context-menu-item.danger {
  color: #f44336;
}

/* Responsive */
@media (max-width: 768px) {
  .kb-view {
    padding: 16px;
  }

  .kb-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .view-header {
    flex-direction: column;
    gap: 16px;
    align-items: stretch;
  }

  .kb-card {
    min-height: 100px;
    padding: 12px;
  }
}

@media (max-width: 600px) {
  .kb-grid {
    grid-template-columns: 1fr;
  }
}

/* Scrollbar */
.kb-grid::-webkit-scrollbar {
  width: 6px;
}

.kb-grid::-webkit-scrollbar-track {
  background: transparent;
}

.kb-grid::-webkit-scrollbar-thumb {
  background: var(--border-color, #e0e0e0);
  border-radius: 3px;
}

/* Pagination */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 6px 0;
  border-top: 1px dashed rgba(203, 213, 225, 0.6);
  background: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
}

.page-btn {
  padding: 4px 10px;
  background: #fff;
  border: 1px solid rgba(203, 213, 225, 0.8);
  border-radius: 5px;
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.page-btn:hover:not(:disabled) {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #3b82f6;
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--text-secondary, #666);
}

.page-numbers {
  display: flex;
  gap: 4px;
}

.page-num {
  min-width: 26px;
  height: 26px;
  padding: 2px 6px;
  background: #fff;
  border: 1px solid rgba(203, 213, 225, 0.8);
  border-radius: 5px;
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.page-num:hover {
  border-color: #3b82f6;
  color: #3b82f6;
}

.page-num.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

/* 每页数量选择器 */
.page-size-select {
  margin-left: 12px;
  padding: 3px 6px;
  border: 1px solid rgba(203, 213, 225, 0.8);
  border-radius: 5px;
  font-size: 12px;
  color: #64748b;
  background: #fff;
  cursor: pointer;
  outline: none;
}

.page-size-select:hover {
  border-color: #3b82f6;
}

.page-size-select:focus {
  border-color: #3b82f6;
}
</style>
